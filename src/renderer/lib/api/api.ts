import { apiServers, uploadServers, downloadServers, maxRetryAPIRequest, retryAPIRequestTimeout, maxRetryUpload, maxRetryDownload, retryUploadTimeout, retryDownloadTimeout, maxConcurrentAPIRequest, maxConcurrentUploads, maxConcurrentDownloads } from "../constants"
import { getRandomArbitrary, Semaphore, nodeBufferToArrayBuffer } from "../helpers"
import { hashFn, encryptMetadata, encryptMetadataPublicKey, decryptFolderLinkKey, decryptFileMetadata, decryptFolderName } from "../crypto"
import db from "../db"
import { sendToAllPorts } from "../worker/ipc"
import { logout } from "../../windows/settings/settings"
import striptags from "striptags"
import { isSyncLocationPaused } from "../worker/sync/sync.utils"
import memoryCache from "../memoryCache"

const https = window.require("https")
const log = window.require("electron-log")
const { ThrottleGroup } = window.require("speed-limiter")
const { Readable } = window.require("stream")
const progress = window.require("progress-stream")

export const createFolderSemaphore = new Semaphore(1)
export const apiRequestSemaphore = new Semaphore(maxConcurrentAPIRequest)
export const throttleGroupUpload = new ThrottleGroup({ rate: 1024 * 1024 * 1024 })
export const throttleGroupDownload = new ThrottleGroup({ rate: 1024 * 1024 * 1024 })

const httpsAPIAgent = new https.Agent({
    keepAlive: true,
    maxSockets: maxConcurrentAPIRequest,
    timeout: 86400000
})

const httpsUploadAgent = new https.Agent({
    keepAlive: true,
    maxSockets: maxConcurrentUploads,
    timeout: 86400000
})

const httpsDownloadAgent = new https.Agent({
    keepAlive: true,
    maxSockets: maxConcurrentDownloads,
    timeout: 86400000
})

export const isOnline = () => {
    return new Promise((resolve) => {
        if(!window.navigator.onLine){
            return resolve(false)
        }

        db.get("isOnline").then((online) => {
            if(!online){
                return resolve(false)
            }

            return resolve(true)
        }).catch((err) => {
            log.error(err)

            return resolve(true)
        })
    })
}

export const getAPIServer = () => {
    return apiServers[getRandomArbitrary(0, (apiServers.length - 1))]
}

export const getUploadServer = () => {
    return uploadServers[getRandomArbitrary(0, (uploadServers.length - 1))]
}

export const getDownloadServer = () => {
    return downloadServers[getRandomArbitrary(0, (downloadServers.length - 1))]
}

export const apiRequest = ({ method = "POST", endpoint = "/v1/", data = {}, timeout = 500000 }): Promise<any> => {
    return new Promise((resolve, reject) => {
        let currentTries = 0

        const doRequest = async (): Promise<any> => {
            if(!(await isOnline())){
                return setTimeout(doRequest, retryAPIRequestTimeout)
            }

            if(currentTries >= maxRetryAPIRequest){
                return reject(new Error("Maximum retries (" + maxRetryAPIRequest + ") reached for API request: " + JSON.stringify({
                    method,
                    endpoint,
                    data,
                    timeout
                })))
            }

            currentTries += 1

            apiRequestSemaphore.acquire().then(() => {
                const req = https.request({
                    method: method.toUpperCase(),
                    hostname: "api.filen.io",
                    path: endpoint,
                    port: 443,
                    timeout: 86400000,
                    agent: httpsAPIAgent,
                    headers: {
                        "Content-Type": "application/json",
                        "User-Agent": "filen-desktop"
                    }
                }, (response: any) => {
                    if(response.statusCode !== 200){
                        log.error(new Error("API response " + response.statusCode + ", method: " + method.toUpperCase() + ", endpoint: " + endpoint + ", data: " + JSON.stringify(data)))

                        apiRequestSemaphore.release()
    
                        return setTimeout(doRequest, retryAPIRequestTimeout) 
                    }

                    const res: Buffer[] = []

                    response.on("data", (chunk: Buffer) => {
                        res.push(chunk)
                    })

                    response.on("end", () => {
                        try{
                            const obj = JSON.parse(Buffer.concat(res).toString())
    
                            if(typeof obj.message == "string"){
                                if(obj.message.toLowerCase().indexOf("invalid api key") !== -1){
                                    logout().catch(log.error)
    
                                    return reject(new Error(obj.message))
                                }

                                if(obj.message.toLowerCase().indexOf("api key not found") !== -1){
                                    logout().catch(log.error)
    
                                    return reject(new Error(obj.message))
                                }
                            }

                            apiRequestSemaphore.release()

                            return resolve(obj)
                        }
                        catch(e){
                            log.error(e)

                            apiRequestSemaphore.release()
        
                            return reject(e)
                        }
                    })
                })

                req.on("error", (err: any) => {
                    log.error(err)

                    apiRequestSemaphore.release()
    
                    return setTimeout(doRequest, retryAPIRequestTimeout)
                })

                req.write(JSON.stringify(data))
                req.end()
            })
        }

        return doRequest()
    })
}

export const authInfo = ({ email }: { email: string }): Promise<any> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/auth/info",
            data: {
                email
            }
        }).then((response: any) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(response.data)
        }).catch(reject)
    })
}

export const login = ({ email, password, twoFactorCode, authVersion }: { email: string, password: string, twoFactorCode: string | number, authVersion: number }): Promise<any> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/login",
            data: {
                email,
                password,
                twoFactorKey: twoFactorCode,
                authVersion
            }
        }).then((response: any) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(response.data)
        }).catch(reject)
    })
}

export const userInfo = ({ apiKey }: { apiKey: string }): Promise<any> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/user/info",
            data: {
                apiKey
            }
        }).then((response: any) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(response.data)
        }).catch(reject)
    })
}

export const baseFolders = ({ apiKey }: { apiKey: string }): Promise<any> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/user/baseFolders",
            data: {
                apiKey,
                includeDefault: "true"
            }
        }).then((response: any) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(response.data)
        }).catch(reject)
    })
}

export const folderContent = ({ apiKey, uuid }: { apiKey: string, uuid: string }): Promise<any> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/dir/content",
            data: {
                apiKey,
                app: "true",
                folders: JSON.stringify(["default"]),
                page: 1,
                uuid
            }
        }).then((response: any) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(response.data)
        }).catch(reject)
    })
}

export const folderPresent = ({ apiKey, uuid }: { apiKey: string, uuid: string }): Promise<any> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/dir/present",
            data: {
                apiKey,
                uuid
            }
        }).then((response: any) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(response.data)
        }).catch(reject)
    })
}

export const dirTree = ({ apiKey, uuid, deviceId, skipCache = false }: { apiKey: string, uuid: string, deviceId: string, skipCache: boolean }): Promise<any> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/dir/tree",
            data: {
                apiKey,
                uuid,
                deviceId,
                skipCache: skipCache ? 1 : 0
            }
        }).then((response: any) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(response.data)
        }).catch(reject)
    })
}

export const acquireLock = ({ apiKey, id }: { apiKey: string, id: string | number }): Promise<any> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/lock/acquire",
            data: {
                apiKey,
                id
            }
        }).then((response: any) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(response.data)
        }).catch(reject)
    })
}

export const releaseLock = ({ apiKey, id }: { apiKey: string, id: string | number }): Promise<any> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/lock/release",
            data: {
                apiKey,
                id
            }
        }).then((response: any) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(response.data)
        }).catch(reject)
    })
}

export const holdLock = ({ apiKey, id }: { apiKey: string, id: string | number }): Promise<any> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/lock/hold",
            data: {
                apiKey,
                id
            }
        }).then((response: any) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(response.data)
        }).catch(reject)
    })
}

export const createFolder = ({ uuid, name, parent }: { uuid: string, name: string, parent: string }): Promise<any> => {
    return new Promise((resolve, reject) => {
        createFolderSemaphore.acquire().then(() => {
            const nameHashed = hashFn(name.toLowerCase())

            db.get("apiKey").then((apiKey) => {
                db.get("masterKeys").then((masterKeys) => {
                    encryptMetadata(JSON.stringify({ name }), masterKeys[masterKeys.length - 1]).then((encrypted) => {
                        apiRequest({
                            method: "POST",
                            endpoint: "/v1/dir/sub/create",
                            data: {
                                apiKey,
                                uuid,
                                name: encrypted,
                                nameHashed,
                                parent
                            }
                        }).then((response: any) => {
                            if(!response.status){
                                createFolderSemaphore.release()

                                if(typeof response.data !== "undefined"){
                                    if(typeof response.data.existsUUID !== "undefined"){
                                        return resolve(response.data.existsUUID)
                                    }
                                }

                                return reject(response.message)
                            }
            
                            checkIfItemParentIsShared({
                                type: "folder",
                                parent,
                                metaData: {
                                    uuid,
                                    name
                                }
                            }).then(() => {
                                createFolderSemaphore.release()

                                memoryCache.saveMetadataToDisk("decryptFolderName:" + encrypted, name)

                                return resolve(uuid)
                            }).catch((err) => {
                                createFolderSemaphore.release()

                                return reject(err)
                            })
                        }).catch((err) => {
                            createFolderSemaphore.release()

                            return reject(err)
                        })
                    }).catch((err) => {
                        createFolderSemaphore.release()

                        return reject(err)
                    })
                }).catch((err) => {
                    createFolderSemaphore.release()

                    return reject(err)
                })
            }).catch((err) => {
                createFolderSemaphore.release()

                return reject(err)
            })
        }).catch(reject)
    })
}

export const fileExists = ({ name, parent }: { name: string, parent: string }): Promise<{ exists: boolean, existsUUID: string }> => {
    return new Promise((resolve, reject) => {
        const nameHashed = hashFn(name.toLowerCase())

        db.get("apiKey").then((apiKey) => {
            apiRequest({
                method: "POST",
                endpoint: "/v1/file/exists",
                data: {
                    apiKey,
                    parent,
                    nameHashed
                }
            }).then((response: any) => {
                if(!response.status){
                    return reject(response.message)
                }

                return resolve({
                    exists: (response.data.exists ? true : false),
                    existsUUID: response.data.uuid
                })
            }).catch(reject)
        }).catch(reject)
    })
}

export const folderExists = ({ name, parent }: { name: string, parent: string }): Promise<{ exists: boolean, existsUUID: string }> => {
    return new Promise((resolve, reject) => {
        const nameHashed = hashFn(name.toLowerCase())

        db.get("apiKey").then((apiKey) => {
            apiRequest({
                method: "POST",
                endpoint: "/v1/dir/exists",
                data: {
                    apiKey,
                    parent,
                    nameHashed
                }
            }).then((response: any) => {
                if(!response.status){
                    return reject(response.message)
                }

                return resolve({
                    exists: (response.data.exists ? true : false),
                    existsUUID: response.data.uuid
                })
            }).catch(reject)
        }).catch(reject)
    })
}

export const archiveFile = ({ existsUUID, updateUUID }: { existsUUID: string, updateUUID: string }): Promise<any> => {
    return new Promise((resolve, reject) => {
        db.get("apiKey").then((apiKey) => {
            apiRequest({
                method: "POST",
                endpoint: "/v1/file/archive",
                data: {
                    apiKey,
                    uuid: existsUUID,
                    updateUUID
                }
            }).then((response: any) => {
                if(!response.status){
                    return reject(response.message)
                }
    
                return resolve(response.data)
            }).catch(reject)
        }).catch(reject)
    })
}

export const isSharingFolder = ({ uuid }: { uuid: string }): Promise<any> => {
    return new Promise((resolve, reject) => {
        db.get("apiKey").then((apiKey) => {
            apiRequest({
                method: "POST",
                endpoint: "/v1/share/dir/status",
                data: {
                    apiKey,
                    uuid
                }
            }).then((response: any) => {
                if(!response.status){
                    return reject(response.message)
                }
    
                return resolve({
                    sharing: (response.data.sharing ? true : false),
                    users: response.data.users
                })
            }).catch(reject)
        }).catch(reject)
    })
}

export const isPublicLinkingFolder = ({ uuid }: {uuid: string }): Promise<any> => {
    return new Promise((resolve, reject) => {
        db.get("apiKey").then((apiKey) => {
            apiRequest({
                method: "POST",
                endpoint: "/v1/link/dir/status",
                data: {
                    apiKey,
                    uuid
                }
            }).then((response: any) => {
                if(!response.status){
                    return reject(response.message)
                }
    
                return resolve({
                    linking: (response.data.link ? true : false),
                    links: response.data.links
                })
            }).catch(reject)
        }).catch(reject)
    })
}

export const addItemToPublicLink = ({ data }: { data: any }): Promise<any> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/dir/link/add",
            data
        }).then((response) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(true)
        }).catch(reject)
    })
}

export const shareItem = ({ data }: { data: any }): Promise<any> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/share",
            data
        }).then((response) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(true)
        }).catch(reject)
    })
}

export const isSharingItem = ({ uuid }: { uuid: string }): Promise<any> => {
    return new Promise((resolve, reject) => {
        db.get("apiKey").then((apiKey) => {
            apiRequest({
                method: "POST",
                endpoint: "/v1/user/shared/item/status",
                data: {
                    apiKey,
                    uuid
                }
            }).then((response) => {
                if(!response.status){
                    return reject(response.message)
                }
    
                return resolve({
                    sharing: (response.data.sharing ? true : false),
                    users: response.data.users
                })
            }).catch(reject)
        }).catch(reject)
    })
}

export const isItemInPublicLink = ({ uuid }: { uuid: string }): Promise<any> => {
    return new Promise((resolve, reject) => {
        db.get("apiKey").then((apiKey) => {
            apiRequest({
                method: "POST",
                endpoint: "/v1/link/dir/item/status",
                data: {
                    apiKey,
                    uuid
                }
            }).then((response) => {
                if(!response.status){
                    return reject(response.message)
                }
    
                return resolve({
                    linking: (response.data.link ? true : false),
                    links: response.data.links
                })
            }).catch(reject)
        }).catch(reject)
    })
}

export const renameItemInPublicLink = ({ data }: { data: any }): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/link/dir/item/rename",
            data
        }).then((response) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(true)
        }).catch(reject)
    })
}

export const renameSharedItem = ({ data }: { data: any }): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        apiRequest({
            method: "POST",
            endpoint: "/v1/user/shared/item/rename",
            data
        }).then((response) => {
            if(!response.status){
                return reject(response.message)
            }

            return resolve(true)
        }).catch(reject)
    })
}

export const getFolderContents = ({ uuid }: { uuid: string }): Promise<any> => {
    return new Promise((resolve, reject) => {
        db.get("apiKey").then((apiKey) => {
            apiRequest({
                method: "POST",
                endpoint: "/v1/download/dir",
                data: {
                    apiKey,
                    uuid
                }
            }).then((response) => {
                if(!response.status){
                    return reject(response.message)
                }
    
                return resolve(response.data)
            }).catch(reject)
        }).catch(reject)
    })
}

export const checkIfItemParentIsShared = ({ type, parent, metaData }: { type: string, parent: string, metaData: any }): Promise<any> => {
    return new Promise((resolve, reject) => {
        db.get("apiKey").then((apiKey) => {
            db.get("masterKeys").then((masterKeys) => {
                let shareCheckDone = false
                let linkCheckDone = false
                let resolved = false
                let doneInterval: any = undefined

                const done = () => {
                    if(shareCheckDone && linkCheckDone){
                        clearInterval(doneInterval)

                        if(!resolved){
                            resolved = true

                            resolve(true)
                        }

                        return true
                    }

                    return false
                }

                doneInterval = setInterval(done, 100)

                isSharingFolder({ uuid: parent }).then((data: any) => {
                    if(!data.sharing){
                        shareCheckDone = true

                        return done()
                    }

                    const totalUsers = data.users.length

                    if(type == "file"){
                        let doneUsers = 0

                        const doneSharing = () => {
                            doneUsers += 1

                            if(doneUsers >= totalUsers){
                                shareCheckDone = true

                                done()
                            }

                            return true
                        }

                        for(let i = 0; i < totalUsers; i++){
                            const user = data.users[i]
                            const itemMetadata = JSON.stringify({
                                name: metaData.name,
                                size: metaData.size,
                                mime: metaData.mime,
                                key: metaData.key,
                                lastModified: metaData.lastModified
                            })

                            encryptMetadataPublicKey({ data: itemMetadata, publicKey: user.publicKey }).then((encrypted) => {
                                shareItem({
                                    data: {
                                        apiKey,
                                        uuid: metaData.uuid,
                                        parent,
                                        email: user.email,
                                        type,
                                        metadata: encrypted
                                    }
                                }).then(() => {
                                    return doneSharing()
                                }).catch((err) => {
                                    console.log(err)
            
                                    return doneSharing()
                                })
                            }).catch((err) => {
                                console.log(err)
            
                                return doneSharing()
                            })
                        }
                    }
                    else{
                        getFolderContents({ uuid: metaData.uuid }).then(async (contents: any) => {
                            const itemsToShare = []

                            itemsToShare.push({
                                uuid: metaData.uuid,
                                parent,
                                metadata: metaData.name,
                                type: "folder"
                            })

                            const files = contents.files
                            const folders = contents.folders

                            for(let i = 0; i < files.length; i++){
                                try{
                                    var decrypted = await decryptFileMetadata(files[i].metadata, masterKeys)
                                }
                                catch(e){
                                    //console.log(e)
                                }

                                if(typeof decrypted == "object"){
                                    if(typeof decrypted.name == "string"){
                                        decrypted.name = striptags(decrypted.name)

                                        if(decrypted.name.length > 0){
                                            itemsToShare.push({
                                                uuid: files[i].uuid,
                                                parent: files[i].parent,
                                                metadata: {
                                                    name: decrypted.name,
                                                    size: parseInt(decrypted.size),
                                                    mime: striptags(decrypted.mime),
                                                    key: decrypted.key,
                                                    lastModified: parseInt(decrypted.lastModified)
                                                },
                                                type: "file"
                                            })
                                        }
                                    }
                                }
                            }

                            for(let i = 0; i < folders.length; i++){
                                try{
                                    var decrypted: any = striptags(await decryptFolderName(folders[i].name, masterKeys))
                                }
                                catch(e){
                                    //console.log(e)
                                }

                                if(typeof decrypted == "string"){
                                    if(decrypted.length > 0){
                                        if(folders[i].uuid !== metaData.uuid && folders[i].parent !== "base"){
                                            itemsToShare.push({
                                                uuid: folders[i].uuid,
                                                parent: (i == 0 ? "none" : folders[i].parent),
                                                metadata: decrypted,
                                                type: "folder"
                                            })
                                        }
                                    }
                                }
                            }

                            let itemsShared = 0

                            const doneSharingItem = () => {
                                itemsShared += 1

                                if(itemsShared >= (itemsToShare.length * totalUsers)){
                                    shareCheckDone = true

                                    done()
                                }

                                return true
                            }

                            for(let i = 0; i < itemsToShare.length; i++){
                                const itemToShare = itemsToShare[i]

                                for(let x = 0; x < totalUsers; x++){
                                    const user = data.users[x]
                                    let itemMetadata = ""

                                    if(itemToShare.type == "file"){
                                        itemMetadata = JSON.stringify({
                                            name: itemToShare.metadata.name,
                                            size: itemToShare.metadata.size,
                                            mime: itemToShare.metadata.mime,
                                            key: itemToShare.metadata.key,
                                            lastModified: itemToShare.metadata.lastModified
                                        })
                                    }
                                    else{
                                        itemMetadata = JSON.stringify({
                                            name: itemToShare.metadata
                                        })
                                    }

                                    encryptMetadataPublicKey({ data: itemMetadata, publicKey: user.publicKey }).then((encrypted) => {
                                        shareItem({
                                            data: {
                                                apiKey,
                                                uuid: itemToShare.uuid,
                                                parent: itemToShare.parent,
                                                email: user.email,
                                                type: itemToShare.type,
                                                metadata: encrypted
                                            }
                                        }).then(() => {
                                            return doneSharingItem()
                                        }).catch((err) => {
                                            console.log(err)
                    
                                            return doneSharingItem()
                                        })
                                    }).catch((err) => {
                                        console.log(err)
                    
                                        return doneSharingItem()
                                    })
                                }
                            }
                        }).catch((err) => {
                            console.log(err)

                            shareCheckDone = true

                            return done()
                        })
                    }
                }).catch((err) => {
                    console.log(err)

                    shareCheckDone = true

                    return done()
                })

                isPublicLinkingFolder({ uuid: parent }).then(async (data: any) => {
                    if(!data.linking){
                        linkCheckDone = true

                        return done()
                    }

                    const totalLinks = data.links.length

                    if(type == "file"){
                        let linksDone = 0

                        const doneLinking = () => {
                            linksDone += 1

                            if(linksDone >= totalLinks){
                                linkCheckDone = true

                                done()
                            }

                            return true
                        }

                        for(let i = 0; i < totalLinks; i++){
                            const link = data.links[i]

                            try{
                                var key: any = await decryptFolderLinkKey(link.linkKey, masterKeys)
                            }
                            catch(e){
                                //console.log(e)
                            }

                            if(typeof key == "string"){
                                if(key.length > 0){
                                    try{
                                        var encrypted: any = await encryptMetadata(JSON.stringify({
                                            name: metaData.name,
                                            size: metaData.size,
                                            mime: metaData.mime,
                                            key: metaData.key,
                                            lastModified: metaData.lastModified
                                        }), key)
                                    }
                                    catch(e){
                                        //console.log(e)
                                    }

                                    if(typeof encrypted == "string"){
                                        if(encrypted.length > 0){
                                            addItemToPublicLink({
                                                data: {
                                                    apiKey,
                                                    uuid: metaData.uuid,
                                                    parent,
                                                    linkUUID: link.linkUUID,
                                                    type,
                                                    metadata: encrypted,
                                                    key: link.linkKey,
                                                    expiration: "never",
                                                    password: "empty",
                                                    passwordHashed: "8f83dfba6522ce8c34c5afefa64878e3a4ac554d", //hashFn("empty")
                                                    downloadBtn: "enable"
                                                }
                                            }).then(() => {
                                                return doneLinking()
                                            }).catch((err) => {
                                                console.log(err)

                                                return doneLinking()
                                            })
                                        }
                                        else{
                                            doneLinking()
                                        }
                                    }
                                    else{
                                        doneLinking()
                                    }
                                }
                                else{
                                    doneLinking()
                                }
                            }
                            else{
                                doneLinking()
                            }
                        }
                    }
                    else{
                        getFolderContents({ uuid: metaData.uuid }).then(async (contents: any) => {
                            const itemsToLink = []

                            itemsToLink.push({
                                uuid: metaData.uuid,
                                parent,
                                metadata: metaData.name,
                                type: "folder"
                            })

                            const files = contents.files
                            const folders = contents.folders

                            for(let i = 0; i < files.length; i++){
                                try{
                                    var decrypted = await decryptFileMetadata(files[i].metadata, masterKeys)
                                }
                                catch(e){
                                    //console.log(e)
                                }

                                if(typeof decrypted == "object"){
                                    if(typeof decrypted.name == "string"){
                                        decrypted.name = striptags(decrypted.name)

                                        if(decrypted.name.length > 0){
                                            itemsToLink.push({
                                                uuid: files[i].uuid,
                                                parent: files[i].parent,
                                                metadata: {
                                                    name: decrypted.name,
                                                    size: parseInt(decrypted.size),
                                                    mime: striptags(decrypted.mime),
                                                    key: decrypted.key,
                                                    lastModified: parseInt(decrypted.lastModified)
                                                },
                                                type: "file"
                                            })
                                        }
                                    }
                                }
                            }

                            for(let i = 0; i < folders.length; i++){
                                try{
                                    var decrypted: any = striptags(await decryptFolderName(folders[i].name, masterKeys))
                                }
                                catch(e){
                                    //console.log(e)
                                }

                                if(typeof decrypted == "string"){
                                    if(decrypted.length > 0){
                                        if(folders[i].uuid !== metaData.uuid && folders[i].parent !== "base"){
                                            itemsToLink.push({
                                                uuid: folders[i].uuid,
                                                parent: (i == 0 ? "none" : folders[i].parent),
                                                metadata: decrypted,
                                                type: "folder"
                                            })
                                        }
                                    }
                                }
                            }

                            let itemsLinked = 0

                            const itemLinked = () => {
                                itemsLinked += 1

                                if(itemsLinked >= (itemsToLink.length * totalLinks)){
                                    linkCheckDone = true

                                    done()
                                }

                                return true
                            }

                            for(let i = 0; i < itemsToLink.length; i++){
                                const itemToLink = itemsToLink[i]

                                for(let x = 0; x < totalLinks; x++){
                                    const link = data.links[x]

                                    try{
                                        var key: any = await decryptFolderLinkKey(link.linkKey, masterKeys)
                                    }
                                    catch(e){
                                        //console.log(e)
                                    }

                                    if(typeof key == "string"){
                                        if(key.length > 0){
                                            let itemMetadata = ""

                                            if(itemToLink.type == "file"){
                                                itemMetadata = JSON.stringify({
                                                    name: itemToLink.metadata.name,
                                                    size: itemToLink.metadata.size,
                                                    mime: itemToLink.metadata.mime,
                                                    key: itemToLink.metadata.key,
                                                    lastModified: itemToLink.metadata.lastModified
                                                })
                                            }
                                            else{
                                                itemMetadata = JSON.stringify({
                                                    name: itemToLink.metadata
                                                })
                                            }

                                            try{
                                                var encrypted: any = await encryptMetadata(itemMetadata, key)
                                            }
                                            catch(e){
                                                //console.log(e)
                                            }

                                            if(typeof encrypted == "string"){
                                                if(encrypted.length > 0){
                                                    addItemToPublicLink({
                                                        data: {
                                                            apiKey,
                                                            uuid: itemToLink.uuid,
                                                            parent: itemToLink.parent,
                                                            linkUUID: link.linkUUID,
                                                            type: itemToLink.type,
                                                            metadata: encrypted,
                                                            key: link.linkKey,
                                                            expiration: "never",
                                                            password: "empty",
                                                            passwordHashed: "8f83dfba6522ce8c34c5afefa64878e3a4ac554d", //hashFn("empty")
                                                            downloadBtn: "enable"
                                                        }
                                                    }).then(() => {
                                                        return itemLinked()
                                                    }).catch((err) => {
                                                        console.log(err)

                                                        return itemLinked()
                                                    })
                                                }
                                                else{
                                                    itemLinked()
                                                }
                                            }
                                            else{
                                                itemLinked()
                                            }
                                        }
                                        else{
                                            itemLinked()
                                        }
                                    }
                                    else{
                                        itemLinked()
                                    }
                                }
                            }
                        }).catch((err) => {
                            console.log(err)

                            linkCheckDone = true

                            return done()
                        })
                    }
                }).catch((err) => {
                    console.log(err)

                    linkCheckDone = true

                    return done()
                })
            }).catch(reject)
        }).catch(reject)
    })
}

export const checkIfItemIsSharedForRename = ({ type, uuid, metaData }: { type: string, uuid: string, metaData: any }): Promise<any> => {
    return new Promise((resolve, reject) => {
        db.get("apiKey").then((apiKey) => {
            db.get("masterKeys").then((masterKeys) => {
                let shareCheckDone = false
                let linkCheckDone = false
                let resolved = false
                let doneInterval: any = undefined

                const done = () => {
                    if(shareCheckDone && linkCheckDone){
                        clearInterval(doneInterval)

                        if(!resolved){
                            resolved = true

                            resolve(true)
                        }

                        return true
                    }

                    return false
                }

                doneInterval = setInterval(done, 100)

                isSharingItem({ uuid }).then((data: any) => {
                    if(!data.sharing){
                        shareCheckDone = true

                        return done()
                    }

                    const totalUsers = data.users.length
                    let doneUsers = 0

                    const doneSharing = () => {
                        doneUsers += 1

                        if(doneUsers >= totalUsers){
                            shareCheckDone = true

                            done()
                        }

                        return true
                    }

                    for(let i = 0; i < totalUsers; i++){
                        const user = data.users[i]
                        let itemMetadata = ""

                        if(type == "file"){
                            itemMetadata = JSON.stringify({
                                name: metaData.name,
                                size: metaData.size,
                                mime: metaData.mime,
                                key: metaData.key,
                                lastModified: metaData.lastModified
                            })
                        }
                        else{
                            itemMetadata = JSON.stringify({
                                name: metaData.name
                            })
                        }

                        encryptMetadataPublicKey({ data: itemMetadata, publicKey: user.publicKey }).then((encrypted) => {
                            renameSharedItem({
                                data: {
                                    apiKey,
                                    uuid,
                                    receiverId: user.id,
                                    metadata: encrypted
                                }
                            }).then(() => {
                                return doneSharing()
                            }).catch((err) => {
                                console.log(err)

                                return doneSharing()
                            })
                        }).catch((err) => {
                            console.log(err)

                            return doneSharing()
                        })
                    }
                }).catch((err) => {
                    console.log(err)

                    shareCheckDone = true

                    return done()
                })

                isItemInPublicLink({ uuid }).then((data: any) => {
                    if(!data.linking){
                        linkCheckDone = true

                        return done()
                    }

                    const totalLinks = data.links.length
                    let linksDone = 0

                    const doneLinking = () => {
                        linksDone += 1

                        if(linksDone >= totalLinks){
                            linkCheckDone = true

                            done()
                        }

                        return true
                    }

                    for(let i = 0; i < totalLinks; i++){
                        const link = data.links[i]

                        decryptFolderLinkKey(link.linkKey, masterKeys).then((key) => {
                            let itemMetadata = ""

                            if(type == "file"){
                                itemMetadata = JSON.stringify({
                                    name: metaData.name,
                                    size: metaData.size,
                                    mime: metaData.mime,
                                    key: metaData.key,
                                    lastModified: metaData.lastModified
                                })
                            }
                            else{
                                itemMetadata = JSON.stringify({
                                    name: metaData.name
                                })
                            }

                            encryptMetadata(itemMetadata, key).then((encrypted) => {
                                renameItemInPublicLink({
                                    data: {
                                        apiKey,
                                        uuid,
                                        linkUUID: link.linkUUID,
                                        metadata: encrypted
                                    }
                                }).then(() => {
                                    return doneLinking()
                                }).catch((err) => {
                                    console.log(err)

                                    return doneLinking()
                                })
                            }).catch((err) => {
                                console.log(err)

                                return doneLinking()
                            })
                        }).catch((err) => {
                            console.log(err)

                            return doneLinking()
                        })
                    }
                }).catch((err) => {
                    console.log(err)

                    linkCheckDone = true

                    return done()
                })
            }).catch(reject)
        }).catch(reject)
    })
}

export const uploadChunk = ({ queryParams, data, timeout = 86400000, from = "sync", location = undefined }: { queryParams: any, data: any, timeout: number, from: string, location?: any }): Promise<any> => {
    return new Promise((resolve, reject) => {
        Promise.all([
            db.get("networkingSettings"),
            db.get("maxStorageReached")
        ]).then(async ([networkingSettings, maxStorageReached]) => {
            if(maxStorageReached){
                return reject(new Error("Max storage reached"))
            }

            await new Promise((resolve) => {
                const getPausedStatus = () => {
                    if(from == "sync"){
                        if(typeof location !== "undefined" && typeof location.uuid == "string"){
                            Promise.all([
                                db.get("paused"),
                                isSyncLocationPaused(location.uuid)
                            ]).then(([paused, locationPaused]) => {
                                if(paused || locationPaused){
                                    return setTimeout(getPausedStatus, 1000)
                                }
        
                                return resolve(true)
                            }).catch((err) => {
                                log.error(err)
        
                                return setTimeout(getPausedStatus, 1000)
                            })
                        }
                        else{
                            db.get("paused").then((paused) => {
                                if(paused){
                                    return setTimeout(getPausedStatus, 1000)
                                }
        
                                return resolve(true)
                            }).catch((err) => {
                                log.error(err)
        
                                return setTimeout(getPausedStatus, 1000)
                            })
                        }
                    }
                    else{
                        db.get(from.indexOf("download") !== -1 ? "downloadPaused" : from.indexOf("upload") !== -1 ? "uploadPaused" : "paused").then((paused) => {
                            if(paused){
                                return setTimeout(getPausedStatus, 1000)
                            }
    
                            return resolve(true)
                        }).catch((err) => {
                            log.error(err)
    
                            return setTimeout(getPausedStatus, 1000)
                        })
                    }
                }

                return getPausedStatus()
            })

            const urlParams = new URLSearchParams(queryParams)
            const uuid = urlParams.get("uuid") || ""

            let bps = (122070 * 1024)

            if(networkingSettings !== null && typeof networkingSettings == "object" && from == "sync"){
                if(typeof networkingSettings.uploadKbps !== "undefined" && networkingSettings.uploadKbps > 0){
                    bps = Math.floor(networkingSettings.uploadKbps * 1024)
                }
            }

            throttleGroupUpload.setRate(bps)

            let currentTries = 0

            const doRequest = async (): Promise<any> => {
                if(!(await isOnline())){
                    return setTimeout(doRequest, retryUploadTimeout)
                }

                if(currentTries >= maxRetryUpload){
                    return reject(new Error("Max retries reached for upload " + uuid))
                }

                currentTries += 1

                let lastBytes = 0
                const throttle = throttleGroupUpload.throttle()

                const calcProgress = (written: number) => {
                    let bytes = written

                    if(lastBytes == 0){
                        lastBytes = written
                    }
                    else{
                        bytes = Math.floor(written - lastBytes)
                        lastBytes = written
                    }

                    sendToAllPorts({
                        type: from == "sync" ? "uploadProgress" : "uploadProgressSeperate",
                        data: {
                            uuid,
                            bytes,
                            from
                        }
                    })
                }

                const req = https.request({
                    method: "POST",
                    hostname: "up.filen.io",
                    path: "/v2/upload?" + queryParams,
                    port: 443,
                    timeout: 86400000,
                    agent: httpsUploadAgent,
                    headers: {
                        "User-Agent": "filen-desktop"
                    }
                }, (response: any) => {
                    if(response.statusCode !== 200){
                        log.error(new Error("Upload failed, status code: " + response.statusCode))

                        throttle.destroy()

                        return setTimeout(doRequest, retryUploadTimeout)
                    }

                    const res: Buffer[] = []

                    response.on("data", (chunk: Buffer) => {
                        res.push(chunk)
                    })

                    response.on("end", () => {
                        try{
                            const obj = JSON.parse(Buffer.concat(res).toString())

                            if(!obj.status){
                                if(obj.message.toLowerCase().indexOf("storage") !== -1){
                                    db.set("paused", true)
                                    db.set("maxStorageReached", true)
                                }
        
                                throttle.destroy()
        
                                return reject(obj.message)
                            }
        
                            return resolve(obj)
                        }
                        catch(e){
                            return reject(e)
                        }
                    })
                })

                req.on("error", (err: any) => {
                    log.error(err)

                    throttle.destroy()

                    return reject(err)
                })

                const str = progress({
                    length: data.byteLength,
                    time: 100
                })
                 
                str.on("progress", (info: any) => calcProgress(info.transferred))

                Readable.from([data]).pipe(str.on("end", () => str.destroy())).pipe(throttle.on("end", () => throttle.destroy())).pipe(req)
            }

            return doRequest()
        }).catch(reject)
    })
}

export const markUploadAsDone = ({ uuid, uploadKey }: { uuid: string, uploadKey: string }): Promise<any> => {
    return new Promise((resolve, reject) => {
        const max = 32
        let current = 0
        const timeout = 1000

        const req = () => {
            if(current > max){
                return reject(new Error("Could not mark upload " + uuid + " as done, max tries reached"))
            }

            current += 1

            apiRequest({
                method: "POST",
                endpoint: "/v1/upload/done",
                data: {
                    uuid,
                    uploadKey
                }
            }).then((response) => {
                if(!response.status){
                    if(
                        response.message.toString().toLowerCase().indexOf("chunks are not matching") !== -1
                        || response.message.toString().toLowerCase().indexOf("done yet") !== -1
                        || response.message.toString().toLowerCase().indexOf("finished yet") !== -1
                        || response.message.toString().toLowerCase().indexOf("chunks not found") !== -1
                    ){
                        return setTimeout(req, timeout)
                    }

                    return reject(response.message)
                }
    
                return resolve(true)
            }).catch(reject)
        }

        req()
    })
}

export const downloadChunk = ({ region, bucket, uuid, index, from = "sync", location = undefined }: { region: string, bucket: string, uuid: string, index: number, from: string, location?: any }): Promise<any> => {
    return new Promise((resolve, reject) => {
        db.get("networkingSettings").then(async (networkingSettings) => {
            await new Promise((resolve) => {
                const getPausedStatus = () => {
                    if(from == "sync"){
                        if(typeof location !== "undefined" && typeof location.uuid == "string"){
                            Promise.all([
                                db.get("paused"),
                                isSyncLocationPaused(location.uuid)
                            ]).then(([paused, locationPaused]) => {
                                if(paused || locationPaused){
                                    return setTimeout(getPausedStatus, 1000)
                                }
        
                                return resolve(true)
                            }).catch((err) => {
                                log.error(err)
        
                                return setTimeout(getPausedStatus, 1000)
                            })
                        }
                        else{
                            db.get("paused").then((paused) => {
                                if(paused){
                                    return setTimeout(getPausedStatus, 1000)
                                }
        
                                return resolve(true)
                            }).catch((err) => {
                                log.error(err)
        
                                return setTimeout(getPausedStatus, 1000)
                            })
                        }
                    }
                    else{
                        db.get(from.indexOf("download") !== -1 ? "downloadPaused" : from.indexOf("upload") !== -1 ? "uploadPaused" : "paused").then((paused) => {
                            if(paused){
                                return setTimeout(getPausedStatus, 1000)
                            }
    
                            return resolve(true)
                        }).catch((err) => {
                            log.error(err)
    
                            return setTimeout(getPausedStatus, 1000)
                        })
                    }
                }

                return getPausedStatus()
            })

            let bps = (122070 * 1024)

            if(networkingSettings !== null && typeof networkingSettings == "object" && from == "sync"){
                if(typeof networkingSettings.downloadKbps !== "undefined" && networkingSettings.downloadKbps > 0){
                    bps = Math.floor(networkingSettings.downloadKbps * 1024)
                }
            }

            throttleGroupDownload.setRate(bps)

            let currentTries = 0

            const doRequest = async (): Promise<any> => {
                if(!(await isOnline())){
                    return setTimeout(doRequest, retryDownloadTimeout)
                }

                if(currentTries >= maxRetryDownload){
                    return reject(new Error("Max retries reached for /" + region + "/" + bucket + "/" + uuid + "/" + index))
                }

                const throttle = throttleGroupDownload.throttle()

                currentTries += 1

                const request = https.request({
                    host: "down.filen.io",
                    port: 443,
                    path: "/" + region + "/" + bucket + "/" + uuid + "/" + index,
                    method: "GET",
                    agent: httpsDownloadAgent,
                    timeout: 86400000,
                    headers: {
                        "User-Agent": "filen-desktop"
                    }
                })
        
                request.on("response", (response: any) => {
                    if(response.statusCode !== 200){
                        log.error("Invalid http statuscode: " + response.statusCode)

                        throttle.destroy()

                        return setTimeout(doRequest, retryDownloadTimeout)
                    }

                    const res: Buffer[] = []

                    response.pipe(throttle).on("data", (chunk: Buffer) => {
                        res.push(chunk)
        
                        sendToAllPorts({
                            type: from == "sync" ? "downloadProgress" : "downloadProgressSeperate",
                            data: {
                                uuid,
                                bytes: chunk.length,
                                from
                            }
                        })
                    }).on("end", () => {
                        try{
                            resolve(nodeBufferToArrayBuffer(Buffer.concat(res)))
                        }
                        catch(e){
                            reject(e)
                        }

                        throttle.destroy()

                        return true
                    })
                })
        
                request.on("error", (err: Error) => {
                    log.error(err)

                    throttle.destroy()

                    return reject(err)
                })
        
                request.end()
            }

            return doRequest()
        }).catch(reject)
    })
}

export const trashItem = ({ type, uuid }: { type: string, uuid: string }): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        db.get("apiKey").then((apiKey) => {
            apiRequest({
                method: "POST",
                endpoint: type == "folder" ? "/v1/dir/trash" : "/v1/file/trash",
                data: {
                    apiKey,
                    uuid
                }
            }).then((response) => {
                if(!response.status){
                    if(
                        response.message.toString().toLowerCase().indexOf("already") !== -1
                        || response.message.toString().toLowerCase().indexOf("does not exist") !== -1
                        || (response.message.toString().toLowerCase().indexOf("not found") !== -1 && response.message.toString().toLowerCase().indexOf("api") == -1)
                    ){
                        return resolve(true)
                    }

                    return reject(response.message)
                }
    
                return resolve(true)
            }).catch(reject)
        }).catch(reject)
    })
}

export const moveFile = ({ file, parent }: { file: any, parent: string }): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        db.get("apiKey").then((apiKey) => {
            apiRequest({
                method: "POST",
                endpoint: "/v1/file/move",
                data: {
                    apiKey,
                    fileUUID: file.uuid,
                    folderUUID: parent
                }
            }).then((response) => {
                if(!response.status){
                    if(
                        response.message.toString().toLowerCase().indexOf("already") !== -1
                        || response.message.toString().toLowerCase().indexOf("does not exist") !== -1
                        || (response.message.toString().toLowerCase().indexOf("not found") !== -1 && response.message.toString().toLowerCase().indexOf("api") == -1)
                    ){
                        return resolve(true)
                    }

                    return reject(response.message)
                }
    
                checkIfItemParentIsShared({
                    type: "file",
                    parent,
                    metaData: {
                        uuid: file.uuid,
                        name: file.name,
                        size: file.size,
                        mime: file.mime,
                        key: file.key,
                        lastModified: file.lastModified
                    }
                }).then(() => {
                    return resolve(true)
                }).catch(reject)
            }).catch(reject)
        }).catch(reject)
    })
}

export const moveFolder = ({ folder, parent }: { folder: any, parent: string }): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        db.get("apiKey").then((apiKey) => {
            apiRequest({
                method: "POST",
                endpoint: "/v1/dir/move",
                data: {
                    apiKey,
                    uuid: folder.uuid,
                    folderUUID: parent
                }
            }).then((response) => {
                if(!response.status){
                    if(
                        response.message.toString().toLowerCase().indexOf("already") !== -1
                        || response.message.toString().toLowerCase().indexOf("does not exist") !== -1
                        || response.message.toString().toLowerCase().indexOf("not found") !== -1
                    ){
                        return resolve(true)
                    }

                    return reject(response.message)
                }
    
                checkIfItemParentIsShared({
                    type: "folder",
                    parent,
                    metaData: {
                        name: folder.name,
                        uuid: folder.uuid
                    }
                }).then(() => {
                    return resolve(true)
                }).catch(reject)
            }).catch(reject)
        }).catch(reject)
    })
}

export const renameFile = ({ file, name }: { file: any, name: string }): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        const nameHashed = hashFn(name.toLowerCase())

        Promise.all([
            db.get("apiKey"),
            db.get("masterKeys")
        ]).then(([apiKey, masterKeys]) => {
            Promise.all([
                encryptMetadata(JSON.stringify({
                    name,
                    size: file.size,
                    mime: file.mime,
                    key: file.key,
                    lastModified: file.lastModified
                }), masterKeys[masterKeys.length - 1]),
                encryptMetadata(name, file.key)
            ]).then(([encrypted, encryptedName]) => {
                apiRequest({
                    method: "POST",
                    endpoint: "/v1/file/rename",
                    data: {
                        apiKey,
                        uuid: file.uuid,
                        name: encryptedName,
                        nameHashed,
                        metaData: encrypted
                    }
                }).then((response) => {
                    if(!response.status){
                        if(
                            response.message.toString().toLowerCase().indexOf("already") !== -1
                            || response.message.toString().toLowerCase().indexOf("does not exist") !== -1
                            || (response.message.toString().toLowerCase().indexOf("not found") !== -1 && response.message.toString().toLowerCase().indexOf("api") == -1)
                        ){
                            return resolve(true)
                        }

                        return reject(response.message)
                    }
        
                    checkIfItemIsSharedForRename({
                        type: "file",
                        uuid: file.uuid,
                        metaData: {
                            name,
                            size: file.size,
                            mime: file.mime,
                            key: file.key,
                            lastModified: file.lastModified
                        }
                    }).then(() => {
                        return resolve(true)
                    }).catch(reject)
                }).catch(reject)
            }).catch(reject)
        }).catch(reject)
    })
}

export const renameFolder = ({ folder, name }: { folder: any, name: string }): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        const nameHashed = hashFn(name.toLowerCase())

        Promise.all([
            db.get("apiKey"),
            db.get("masterKeys")
        ]).then(([apiKey, masterKeys]) => {
            encryptMetadata(JSON.stringify({ name }), masterKeys[masterKeys.length - 1]).then((encrypted) => {
                apiRequest({
                    method: "POST",
                    endpoint: "/v1/dir/rename",
                    data: {
                        apiKey,
                        uuid: folder.uuid,
                        name: encrypted,
                        nameHashed
                    }
                }).then((response) => {
                    if(!response.status){
                        if(
                            response.message.toString().toLowerCase().indexOf("already") !== -1
                            || response.message.toString().toLowerCase().indexOf("does not exist") !== -1
                            || (response.message.toString().toLowerCase().indexOf("not found") !== -1 && response.message.toString().toLowerCase().indexOf("api") == -1)
                        ){
                            return resolve(true)
                        }
                        
                        return reject(response.message)
                    }
        
                    checkIfItemIsSharedForRename({
                        type: "folder",
                        uuid: folder.uuid,
                        metaData: {
                            name
                        }
                    }).then(() => {
                        return resolve(true)
                    }).catch(reject)
                }).catch(reject)
            }).catch(reject)
        }).catch(reject)
    })
}