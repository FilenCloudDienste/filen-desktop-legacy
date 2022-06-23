import { apiRequest } from "../api"
import { decryptMetadata, encryptMetadata, generateKeypair } from "../crypto"
import db from "../db"

const log = window.require("electron-log")

export const updateKeypair = ({ publicKey, privateKey }) => {
    return new Promise((resolve, reject) => {
        Promise.all([
            db.get("apiKey"),
            db.get("masterKeys")
        ]).then(([apiKey, masterKeys]) => {
            if(!Array.isArray(masterKeys)){
                return reject(new Error("No master keys array found"))
            }

            if(masterKeys.length == 0){
                return reject(new Error("No master keys found"))
            }

            encryptMetadata(privateKey, masterKeys[masterKeys.length - 1]).then((encryptedPrivateKey) => {
                apiRequest({
                    method: "POST",
                    endpoint: "/v1/user/keyPair/update",
                    data: {
                        apiKey,
                        publicKey,
                        privateKey: encryptedPrivateKey
                    }
                }).then((response) => {
                    if(!response.status){
                        if(response.message.toLowerCase().indexOf("api key not found") !== -1){
                            return reject(new Error("API key not found"))
                        }

                        return reject(new Error(response.message))
                    }

                    return resolve(true)
                }).catch(reject)
            }).catch(reject)
        }).catch(reject)
    })
}

export const setKeypair = ({ publicKey, privateKey }) => {
    return new Promise((resolve, reject) => {
        Promise.all([
            db.get("apiKey"),
            db.get("masterKeys")
        ]).then(([apiKey, masterKeys]) => {
            if(!Array.isArray(masterKeys)){
                return reject(new Error("No master keys array found"))
            }

            if(masterKeys.length == 0){
                return reject(new Error("No master keys found"))
            }
        
            encryptMetadata(privateKey, masterKeys[masterKeys.length - 1]).then((encryptedPrivateKey) => {
                apiRequest({
                    method: "POST",
                    endpoint: "/v1/user/keyPair/set",
                    data: {
                        apiKey,
                        publicKey,
                        privateKey: encryptedPrivateKey
                    }
                }).then((response) => {
                    if(!response.status){
                        if(response.message.toLowerCase().indexOf("api key not found") !== -1){
                            return reject(new Error("API key not found"))
                        }

                        return reject(new Error(response.message))
                    }
        
                    return resolve(true)
                }).catch(reject)
            }).catch(reject)
        }).catch(reject)
    })
}

export const updatePublicAndPrivateKey = () => {
    return new Promise((resolve, reject) => {
        Promise.all([
            db.get("apiKey"),
            db.get("masterKeys")
        ]).then(([apiKey, masterKeys]) => {
            if(!Array.isArray(masterKeys)){
                return reject(new Error("No master keys array found"))
            }

            if(masterKeys.length == 0){
                return reject(new Error("No master keys found"))
            }
    
            apiRequest({
                method: "POST",
                endpoint: "/v1/user/keyPair/info",
                data: {
                    apiKey
                }
            }).then(async (response) => {
                if(!response.status){
                    if(response.message.toLowerCase().indexOf("api key not found") !== -1){
                        return reject(new Error("API key not found"))
                    }
    
                    return reject(new Error(response.message))
                }
    
                if(response.data.publicKey.length > 16 && response.data.privateKey.length > 16){
                    let privateKey = ""
    
                    for(let i = 0; i < masterKeys.length; i++){
                        try{
                            let decrypted = await decryptMetadata(response.data.privateKey, masterKeys[i])
    
                            if(typeof decrypted == "string"){
                                if(decrypted.length > 16){
                                    privateKey = decrypted
                                }
                            }
                        }
                        catch(e){
                            continue
                        }
                    }
    
                    if(privateKey.length > 16){
                        try{
                            await db.set("publicKey", response.data.publicKey)
                            await db.set("privateKey", privateKey)
                        }
                        catch(e){
                            return reject(e)
                        }
    
                        log.info("Public and private key updated.")
    
                        updateKeypair({ publicKey: response.data.publicKey, privateKey }).then(() => {
                            log.info("User keypair updated.")
    
                            return resolve(true)
                        }).catch((err) => {
                            return reject(err)
                        })
                    }
                    else{
                        log.info("Could not decrypt private key.")
    
                        return resolve(true)
                    }
                }
                else{
                    try{
                        const generatedKeypair = await generateKeypair()
                        const b64PubKey = generatedKeypair.publicKey
                        const b64PrivKey = generatedKeypair.privateKey
        
                        if(b64PubKey.length > 16 && b64PrivKey.length > 16){
                            setKeypair({ publicKey: b64PubKey, privateKey: b64PrivKey }).then(async () => {
                                try{
                                    await db.set("publicKey", b64PubKey)
                                    await db.set("privateKey", b64PrivKey)
                                }
                                catch(err){
                                    return reject(err)
                                }
    
                                log.info("User keypair generated and updated.")
    
                                return resolve(true)
                            }).catch((err) => {
                                return reject(err)
                            })
                        }
                        else{
                            return reject(new Error("Key lengths invalid"))
                        }
                    }
                    catch(e){
                        return reject(e)
                    }
                }
            }).catch(reject)
        }).catch(reject)
    })
}

export const updateKeys = () => {
    return new Promise((resolve, reject) => {
        Promise.all([
            db.get("apiKey"),
            db.get("masterKeys")
        ]).then(([apiKey, masterKeys]) => {
            if(!Array.isArray(masterKeys)){
                return reject(new Error("No master keys array found"))
            }

            if(masterKeys.length == 0){
                return reject(new Error("No master keys found"))
            }
    
            encryptMetadata(masterKeys.join("|"), masterKeys[masterKeys.length - 1]).then((encryptedMasterKeys) => {
                apiRequest({
                    method: "POST",
                    endpoint: "/v1/user/masterKeys",
                    data: {
                        apiKey,
                        masterKeys: encryptedMasterKeys
                    }
                }).then(async (response) => {
                    if(!response.status){
                        if(response.message.toLowerCase().indexOf("api key not found") !== -1){
                            return reject(new Error("API key not found"))
                        }
    
                        return reject(new Error(response.message))
                    }
    
                    let newMasterKeys = ""
    
                    for(let i = 0; i < masterKeys.length; i++){
                        try{
                            let decrypted = await decryptMetadata(response.data.keys, masterKeys[i])
                
                            if(typeof decrypted == "string"){
                                if(decrypted.length > 16){
                                    newMasterKeys = decrypted
                                }
                            }
                        }
                        catch(e){
                            continue
                        }
                    }
    
                    if(newMasterKeys.length > 16){
                        try{
                            newMasterKeys = newMasterKeys.split("|")
    
                            await db.set("masterKeys", newMasterKeys)
    
                            masterKeys = newMasterKeys
                        }
                        catch(e){
                            return reject(e)
                        }
    
                        console.log("Master keys updated.")
    
                        updatePublicAndPrivateKey().then(() => {
                            return resolve(true)
                        }).catch((err) => {
                            log.error(err)

                            return resolve(true)
                        })
                    }
                    else{
                        console.log("Could not decrypt master keys.")
    
                        updatePublicAndPrivateKey().then(() => {
                            return resolve(true)
                        }).catch((err) => {
                            log.error(err)

                            return resolve(true)
                        })
                    }
                }).catch(reject)
            }).catch(reject)
        }).catch(reject)
    })
}