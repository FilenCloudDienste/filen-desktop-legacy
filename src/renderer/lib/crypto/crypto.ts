import memoryCache from "../memoryCache"
import { arrayBufferToHex, base64ToArrayBuffer, arrayBufferToBase64, generateRandomString, convertArrayBufferToBinaryString, convertWordArrayToArrayBuffer } from "../helpers"

const CryptoJS = window.require("crypto-js")
const md2 = window.require("js-md2")
const md4 = window.require("js-md4")
const md5 = window.require("js-md5")
const sha256 = window.require("js-sha256")
const sha1 = window.require("js-sha1")
const sha512 = window.require("js-sha512")
const sha384 = window.require("js-sha512").sha384
const log = window.require("electron-log")

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const deriveKeyFromPassword = ({ password, salt, iterations, hash, bitLength, returnHex }: { password: string, salt: string, iterations: number, hash: string, bitLength: number, returnHex: boolean }): Promise<any> => {
    return new Promise(async (resolve, reject) => {
        const cacheKey = "deriveKeyFromPassword:" + password + ":" + salt + ":" + iterations + ":" + hash + ":" + bitLength + ":" + returnHex.toString()

        if(memoryCache.has(cacheKey)){
            return resolve(memoryCache.get(cacheKey))
        }

        try{
            var bits = await window.crypto.subtle.deriveBits({
                name: "PBKDF2",
                salt: textEncoder.encode(salt),
                iterations: iterations,
                hash: {
                    name: hash
                }
            }, await window.crypto.subtle.importKey("raw", textEncoder.encode(password), {
                name: "PBKDF2"
            }, false, ["deriveBits"]), bitLength)
        }
        catch(e){
            return reject(e)
        }

        const key = returnHex ? arrayBufferToHex(bits) : bits
    
        resolve(key)

        memoryCache.set(cacheKey, key)

        return true
    })
}

export const generatePasswordAndMasterKeysBasedOnAuthVersion = ({ rawPassword, authVersion, salt }: { rawPassword: string, authVersion: number, salt: string }): Promise<{ derivedMasterKeys: string, derivedPassword: string }> => {
    return new Promise(async (resolve, reject) => {
        let derivedPassword = ""
        let derivedMasterKeys: any = undefined

        if(authVersion == 1){
            try{
                derivedPassword = hashPassword(rawPassword)
                derivedMasterKeys = hashFn(rawPassword)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(authVersion == 2){
            try{
                const derivedKey = await deriveKeyFromPassword({
                    password: rawPassword,
                    salt,
                    iterations: 200000,
                    hash: "SHA-512",
                    bitLength: 512,
                    returnHex: true
                })
    
                derivedMasterKeys = derivedKey.substring(0, (derivedKey.length / 2))
                derivedPassword = derivedKey.substring((derivedKey.length / 2), derivedKey.length)
                derivedPassword = CryptoJS.SHA512(derivedPassword).toString()
            }
            catch(e){
                return reject(e)
            }
        }
        else{
            return reject("Invalid auth version")
        }

        return resolve({
            derivedMasterKeys,
            derivedPassword
        })
    })
}

export const hashPassword = (password: string): string => { //old & deprecated, not in use anymore, just here for backwards compatibility
    return sha512(sha384(sha256(sha1(password)))) + sha512(md5(md4(md2(password))))
}

export const hashFn = (str: string): string => {
    return sha1(sha512(str))
}

export const decryptMetadata = (data: string, key: any): Promise<string> => {
    return new Promise(async (resolve, reject) => {
        const cacheKey = "decryptMetadata:" + data.toString() + ":" + key

        if(memoryCache.has(cacheKey)){
            return resolve(memoryCache.get(cacheKey))
        }

        const sliced = data.slice(0, 8)

        if(sliced == "U2FsdGVk"){ //old deprecated
            try{
                const decrypted = CryptoJS.AES.decrypt(data, key).toString(CryptoJS.enc.Utf8)

                memoryCache.set(cacheKey, decrypted)

                return resolve(decrypted)
            }
            catch(e){
                return resolve("")
            }
        }
        else{
            const version = data.slice(0, 3)
    
            if(version == "002"){
                try{
                    key = await deriveKeyFromPassword({ password: key, salt: key, iterations: 1, hash: "SHA-512", bitLength: 256, returnHex: false }) //transform variable length input key to 256 bit (32 bytes) as fast as possible since it's already derived and safe
    
                    const iv = textEncoder.encode(data.slice(3, 15))
                    const encrypted = base64ToArrayBuffer(data.slice(15))
    
                    const decrypted = await window.crypto.subtle.decrypt({
                        name: "AES-GCM",
                        iv
                    }, await window.crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]), encrypted)

                    const result = textDecoder.decode(new Uint8Array(decrypted))

                    memoryCache.set(cacheKey, result)
    
                    return resolve(result)
                }
                catch(e){
                    return resolve("")
                }
            }
            else{
                return resolve("")
            }
        }
    })
}

export const decryptFolderName = (metadata: string, masterKeys: string[]): Promise<string> => {
    return new Promise(async (resolve, reject) => {
        if(metadata.toLowerCase() == "default"){
            return resolve("Default")
        }

        if(!Array.isArray(masterKeys)){
            log.error(new Error("Master keys not array"))

            return resolve("")
        }

        if(masterKeys.length == 0){
            log.error(new Error("Master keys empty"))

            return resolve("")
        }

        const cacheKey = "decryptFolderName:" + metadata.toString()

        if(memoryCache.has(cacheKey)){
            return resolve(memoryCache.get(cacheKey))
        }

        let folderName = ""

        for(let i = 0; i < masterKeys.length; i++){
            try{
                const obj = JSON.parse(await decryptMetadata(metadata, masterKeys[i]))

                if(obj && typeof obj == "object"){
                    if(typeof obj.name == "string"){
                        if(obj.name.length > 0){
                            folderName = obj.name

                            break
                        }
                    }
                }
            }
            catch(e){
                continue
            }
        }

        if(typeof folderName == "string"){
            if(folderName.length > 0){
                memoryCache.set(cacheKey, folderName)
            }
        }

        return resolve(folderName)
    })
}

export const encryptMetadata = (data: string, key: any): Promise<string> => {
    return new Promise(async (resolve, reject) => {
        try{
			key = await deriveKeyFromPassword({ password: key, salt: key, iterations: 1, hash: "SHA-512", bitLength: 256, returnHex: false }) //transform variable length input key to 256 bit (32 bytes) as fast as possible since it's already derived and safe

			const iv = generateRandomString(12)
			const string = textEncoder.encode(data)

			const encrypted = await window.crypto.subtle.encrypt({
				name: "AES-GCM",
				iv: textEncoder.encode(iv)
			}, await window.crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]), string)

			return resolve("002" + iv + arrayBufferToBase64(new Uint8Array(encrypted)))
		}
		catch(e){
            log.error(e)

			return resolve("")
		}
    })
}

export const encryptData = (data: any, key: string): Promise<string | Buffer> => {
    return new Promise(async (resolve, reject) => {
        if(typeof data == "undefined"){
            return resolve("")
        }

        if(typeof data.byteLength == "undefined"){
            return resolve("")
        }

        if(data.byteLength == 0){
            return resolve("")
        }

        try{
            const iv = generateRandomString(12)

            const encrypted = await window.crypto.subtle.encrypt({
                name: "AES-GCM",
                iv: textEncoder.encode(iv)
            }, await window.crypto.subtle.importKey("raw", textEncoder.encode(key), "AES-GCM", false, ["encrypt"]), data)

            return resolve(Buffer.concat([Buffer.from(iv, "utf8"), new Uint8Array(encrypted)]))
        }
        catch(e){
            log.error(e)

            return resolve("")
        }
    })
}

export const decryptData = (data: any, key: string, version: number): Promise<Uint8Array> => {
    return new Promise(async (resolve, reject) => {
        if(version == 1){ //old & deprecated, not in use anymore, just here for backwards compatibility
            try{
                const sliced = convertArrayBufferToBinaryString(new Uint8Array(data.slice(0, 16)))

                if(sliced.indexOf("Salted") !== -1){
                    return resolve(convertWordArrayToArrayBuffer(CryptoJS.AES.decrypt(arrayBufferToBase64(data), key)))
                }
                else if(sliced.indexOf("U2FsdGVk") !== -1){
                    return resolve(convertWordArrayToArrayBuffer(CryptoJS.AES.decrypt(convertArrayBufferToBinaryString(new Uint8Array(data)), key)))
                }
                else{
                    const iv = textEncoder.encode(key).slice(0, 16)

                    const decrypted = await window.crypto.subtle.decrypt({
                        name: "AES-CBC",
                        iv
                    }, await window.crypto.subtle.importKey("raw", textEncoder.encode(key), "AES-CBC", false, ["decrypt"]), data)

                    return resolve(new Uint8Array(decrypted))
                }
            }
            catch(e){
                log.error(e)
    
                return reject(e)
            }
        }
        else{
            try{
                const iv = data.slice(0, 12)
				const encData = data.slice(12)
                
                const decrypted = await window.crypto.subtle.decrypt({
                    name: "AES-GCM",
                    iv,
                }, await window.crypto.subtle.importKey("raw", textEncoder.encode(key), "AES-GCM", false, ["decrypt"]), encData)
    
                return resolve(new Uint8Array(decrypted))
            }
            catch(e){
                log.error(e)
    
                return reject(e)
            }
        }
    })
}

export const decryptFileMetadata = (metadata: string, masterKeys: string[]): Promise<any> => {
    return new Promise(async (resolve, reject) => {
        const cacheKey = "decryptFileMetadata:" + metadata

        if(memoryCache.has(cacheKey)){
            return resolve(memoryCache.get(cacheKey))
        }

        let fileName = ""
        let fileSize = 0
        let fileMime = ""
        let fileKey = ""
        let fileLastModified = 0

        for(let i = 0; i < masterKeys.length; i++){
            try{
                const obj = JSON.parse(await decryptMetadata(metadata, masterKeys[i]))
    
                if(obj && typeof obj == "object"){
                    if(typeof obj.name == "string"){
                        if(obj.name.length > 0){
                            fileName = obj.name
                            fileSize = parseInt(obj.size)
                            fileMime = obj.mime
                            fileKey = obj.key
                            fileLastModified = parseInt(obj.lastModified)
    
                            break
                        }
                    }
                }
            }
            catch(e){
                continue
            }
        }
    
        const obj = {
            name: fileName,
            size: fileSize,
            mime: fileMime,
            key: fileKey,
            lastModified: fileLastModified
        }
    
        if(typeof obj.name == "string"){
            if(obj.name.length > 0){
                memoryCache.set(cacheKey, obj)
            }
        }
    
        return resolve(obj)
    })
}

export const decryptFolderLinkKey = (metadata: string, masterKeys: string[]): Promise<string> => {
    return new Promise(async (resolve, reject) => {
        const cacheKey = "decryptFolderLinkKey:" + metadata

        if(memoryCache.has(cacheKey)){
            return resolve(memoryCache.get(cacheKey))
        }

        let link = ""

        for(let i = 0; i < masterKeys.length; i++){
            try{
                const obj = await decryptMetadata(metadata, masterKeys[i])
    
                if(obj && typeof obj == "string"){
                    if(obj.length >= 16){
                        link = obj
    
                        break
                    }
                }
            }
            catch(e){
                continue
            }
        }

        if(typeof link == "string"){
            if(link.length > 0){
                memoryCache.set(cacheKey, link)
            }
        }
    
        return resolve(link)
    })
}

export const decryptFolderNameLink = (metadata: string, linkKey: string): Promise<string> => {
    return new Promise(async (resolve, reject) => {
        if(metadata.toLowerCase() == "default"){
            return resolve("Default")
        }

        const cacheKey = "decryptFolderNameLink:" + metadata

        if(memoryCache.has(cacheKey)){
            return resolve(memoryCache.get(cacheKey))
        }

        let folderName = ""

        try{
            const obj = JSON.parse(await decryptMetadata(metadata, linkKey))

            if(obj && typeof obj == "object"){
                if(typeof obj.name == "string"){
                    if(obj.name.length > 0){
                        folderName = obj.name
                    }
                }
            }
        }
        catch(e){
            log.error(e)
        }

        if(typeof folderName == "string"){
            if(folderName.length > 0){
                memoryCache.set(cacheKey, folderName)
            }
        }

        return resolve(folderName)
    })
}

export const decryptFileMetadataLink = (metadata: string, linkKey: string): Promise<any> => {
    return new Promise(async (resolve, reject) => {
        const cacheKey = "decryptFileMetadataLink:" + metadata

        if(memoryCache.has(cacheKey)){
            return resolve(memoryCache.get(cacheKey))
        }

        let fileName = ""
        let fileSize = 0
        let fileMime = ""
        let fileKey = ""
        let fileLastModified = 0

        try{
            const obj = JSON.parse(await decryptMetadata(metadata, linkKey))

            if(obj && typeof obj == "object"){
                if(typeof obj.name == "string"){
                    if(obj.name.length > 0){
                        fileName = obj.name
                        fileSize = parseInt(obj.size)
                        fileMime = obj.mime
                        fileKey = obj.key
                        fileLastModified = obj.lastModified
                    }
                }
            }
        }
        catch(e){
            log.error(e)
        }

        const obj = {
            name: fileName,
            size: fileSize,
            mime: fileMime,
            key: fileKey,
            lastModified: fileLastModified
        }

        if(typeof obj.name == "string"){
            if(obj.name.length >= 1){
                memoryCache.set(cacheKey, obj)
            }
        }

        return resolve(obj)
    })
}

export const decryptFolderNamePrivateKey = (metadata: string, privateKey: any): Promise<string> => {
    return new Promise(async (resolve, reject) => {
        if(metadata.toLowerCase() == "default"){
            return resolve("Default")
        }

        const cacheKey = "decryptFolderNamePrivateKey:" + metadata

        if(memoryCache.has(cacheKey)){
            return resolve(memoryCache.get(cacheKey))
        }

        let folderName = ""

        try{
            const decrypted = await window.crypto.subtle.decrypt({
                name: "RSA-OAEP"
            }, privateKey, base64ToArrayBuffer(metadata))

            folderName = JSON.parse(textDecoder.decode(decrypted)).name
        }
        catch(e){
           log.error(e)
        }

        if(typeof folderName == "string"){
            if(folderName.length > 0){
                memoryCache.set(cacheKey, folderName)
            }
        }

        return resolve(folderName)
    })
}

export const decryptFileMetadataPrivateKey = (metadata: string, privateKey: any): Promise<any> => {
    return new Promise(async (resolve, reject) => {
        const cacheKey = "decryptFileMetadataPrivateKey:" + metadata

        if(memoryCache.has(cacheKey)){
            return resolve(memoryCache.get(cacheKey))
        }

        let fileName = ""
        let fileSize = 0
        let fileMime = ""
        let fileKey = ""
        let fileLastModified = 0

        try{
            let decrypted = await window.crypto.subtle.decrypt({
                name: "RSA-OAEP"
            }, privateKey, base64ToArrayBuffer(metadata))

            decrypted = JSON.parse(textDecoder.decode(decrypted))

            if(decrypted && typeof decrypted == "object"){
                fileName = decrypted.name
                fileSize = parseInt(decrypted.size)
                fileMime = decrypted.mime
                fileKey = decrypted.key
                fileLastModified = decrypted.lastModified
            }
        }
        catch(e){
            log.error(e)
        }

        const obj = {
            name: fileName,
            size: fileSize,
            mime: fileMime,
            key: fileKey,
            lastModified: fileLastModified
        }

        if(typeof obj.name == "string"){
            if(obj.name.length >= 1){
                memoryCache.set(cacheKey, obj)
            }
        }

        return resolve(obj)
    })
}

export const encryptMetadataPublicKey = ({ data, publicKey }: { data: string, publicKey: string }): Promise<string> => {
    return new Promise((resolve, reject) => {
        window.crypto.subtle.importKey("spki", base64ToArrayBuffer(publicKey), {
            name: "RSA-OAEP",
            hash: "SHA-512",
        }, true, ["encrypt"]).then((pubKey) => {
            window.crypto.subtle.encrypt({
                name: "RSA-OAEP"
            }, pubKey, textEncoder.encode(data)).then((encrypted) => {
                return resolve(arrayBufferToBase64(encrypted))
            }).catch(reject)
        }).catch(reject)
    })
}

export const generateKeypair = (): Promise<any> => {
    return new Promise((resolve, reject) => {
        window.crypto.subtle.generateKey({
            name: "RSA-OAEP",
            modulusLength: 4096,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-512"
        }, true, ["encrypt", "decrypt"]).then((keyPair) => {
            window.crypto.subtle.exportKey("spki", keyPair.publicKey).then((pubKey) => {
                const b64PubKey = arrayBufferToBase64(pubKey)

                window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey).then((privKey) => {
                    const b64PrivKey = arrayBufferToBase64(privKey)

                    if(b64PubKey.length > 16 && b64PrivKey.length > 16){
                        return resolve({
                            publicKey: b64PubKey,
                            privateKey: b64PrivKey
                        })
                    }
                    else{
                        return reject(new Error("Key lengths invalid"))
                    }
                }).catch(reject)
            }).catch(reject)
        }).catch(reject)
    })
}