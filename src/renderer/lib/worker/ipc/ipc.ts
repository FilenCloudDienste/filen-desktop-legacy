import { apiRequest, throttleGroupUpload, throttleGroupDownload, uploadChunk, downloadChunk } from "../../api"
import { 
    decryptFolderName,
    decryptMetadata,
    hashFn,
    hashPassword,
    deriveKeyFromPassword,
    generatePasswordAndMasterKeysBasedOnAuthVersion,
    decryptData,
    decryptFileMetadata,
    encryptData,
    encryptMetadata,
    decryptFileMetadataPrivateKey,
    decryptFileMetadataLink,
    decryptFolderLinkKey,
    decryptFolderNameLink,
    decryptFolderNamePrivateKey
} from "../../crypto"
import db from "../../db"
import * as fsLocal from "../../fs/local"
import * as fsRemote from "../../fs/remote"
import { isFileOrFolderNameIgnoredByDefault } from "../../helpers"
import ipc from "../../ipc"
import eventListener from "../../eventListener"

const { ipcRenderer } = window.require("electron")
const pathModule = window.require("path")
const log = window.require("electron-log")

let IS_SYNCING: boolean = false
let DEBOUNCE_WATCHER_EVENT: any = null

const handleMessage = (type: string, request: any) => {
    return new Promise((resolve, reject) => {
        if(type == "ping"){
            return resolve("pong")
        }
        else if(type == "apiRequest"){
            const { method, endpoint, timeout, data } = request

            apiRequest({ method, endpoint, data, timeout }).then(resolve).catch(reject)
        }
        else if(type == "decryptFolderName"){
            const { name } = request

            db.get("masterKeys").then((masterKeys) => {
                decryptFolderName(name, masterKeys).then(resolve).catch(reject)
            }).catch(reject)
        }
        else if(type == "decryptMetadata"){
            const { data, key } = request

            decryptMetadata(data, key).then(resolve).catch(reject)
        }
        else if(type == "hashPassword"){
            const { password } = request

            try{
                return resolve(hashPassword(password))
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "hashFn"){
            const { data } = request

            try{
                return resolve(hashFn(data))
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "deriveKeyFromPassword"){
            const { password, salt, iterations, hash, bitLength, returnHex } = request

            deriveKeyFromPassword({ password, salt, iterations, hash, bitLength, returnHex }).then(resolve).catch(reject)
        }
        else if(type == "generatePasswordAndMasterKeysBasedOnAuthVersion"){
            const { rawPassword, authVersion, salt } = request

            generatePasswordAndMasterKeysBasedOnAuthVersion({ rawPassword, authVersion, salt }).then(resolve).catch(reject)
        }
        else if(type == "decryptData"){
            const { data, key, version } = request

            decryptData(data, key, version).then(resolve).catch(reject)
        }
        else if(type == "decryptFileMetadata"){
            const { metadata, masterKeys } = request

            decryptFileMetadata(metadata, masterKeys).then(resolve).catch(reject)
        }
        else if(type == "encryptMetadata"){
            const { data, key } = request

            encryptMetadata(data, key).then(resolve).catch(reject)
        }
        else if(type == "encryptData"){
            const { data, key } = request

            encryptData(data, key).then(resolve).catch(reject)
        }
        else if(type == "decryptFileMetadataPrivateKey"){
            const { metadata, privateKey } = request

            decryptFileMetadataPrivateKey(metadata, privateKey).then(resolve).catch(reject)
        }
        else if(type == "decryptFileMetadataLink"){
            const { metadata, linkKey } = request

            decryptFileMetadataLink(metadata, linkKey).then(resolve).catch(reject)
        }
        else if(type == "decryptFolderLinkKey"){
            const { metadata, masterKeys } = request

            decryptFolderLinkKey(metadata, masterKeys).then(resolve).catch(reject)
        }
        else if(type == "decryptFolderNameLink"){
            const { metadata, linkKey } = request

            decryptFolderNameLink(metadata, linkKey).then(resolve).catch(reject)
        }
        else if(type == "decryptFolderNamePrivateKey"){
            const { metadata, privateKey } = request

            decryptFolderNamePrivateKey(metadata, privateKey).then(resolve).catch(reject)
        }
        else if(type == "selectiveSyncDirectoryTrees"){
            const { location } = request

            Promise.all([
                fsLocal.directoryTree(location.local),
                fsRemote.directoryTree(location.remoteUUID, true)
            ]).then(([localTree, remoteTree]) => {
                return resolve({
                    localTree,
                    remoteTree
                })
            }).catch(reject)
        }
        else if(type == "remoteTree"){
            const { location } = request

            fsRemote.directoryTree(location.remoteUUID, true).then(resolve).catch(reject)
        }
        else if(type == "localTree"){
            const { location } = request

            fsLocal.directoryTree(location.local, true).then(resolve).catch(reject)
        }
        else if(type == "updateThrottles"){
            const { uploadKbps, downloadKbps } = request

            try{
                throttleGroupUpload.setRate(uploadKbps)
                throttleGroupDownload.setRate(downloadKbps)

                return resolve(true)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "uploadChunk"){
            const { queryParams, data, timeout, from } = request

            uploadChunk({ queryParams, data, timeout, from }).then(resolve).catch(reject)
        }
        else if(type == "downloadChunk"){
            const { region, bucket, uuid, index, from } = request

            downloadChunk({ region, bucket, uuid, index, from }).then(resolve).catch(reject)
        }
        else{
            return reject("Invalid message type: " + type.toString())
        }

        return true
    })
}

export const listen = () => {
    ipcRenderer.on("for-worker", (_: any, request: any) => {
        const { messageId, messageSender, type, data } = request

        if(!messageId || !messageSender || !type){
            return false
        }

        handleMessage(type, data).then((response) => {
            return ipcRenderer.send("proxy-from-worker", {
                messageId,
                messageSender,
                response
            })
        }).catch((err) => {
            return ipcRenderer.send("proxy-from-worker", {
                messageId,
                messageSender,
                err
            })
        })
    })

    ipcRenderer.on("watcher-event", (_: any, data: any) => {
        if(data.err){
            return log.error(data.err)
        }

        clearTimeout(DEBOUNCE_WATCHER_EVENT)

        DEBOUNCE_WATCHER_EVENT = setTimeout(() => {
            const watchPath = data.watchPath
            const locationUUID = data.locationUUID
            const event = data.event
            const name = data.name
            const basename = pathModule.basename(name)
            const path = name.slice(watchPath.length + 1)

            if(isFileOrFolderNameIgnoredByDefault(basename)){
                return false
            }

            new Promise((resolve) => {
                const check = (): any => {
                    if(!IS_SYNCING){
                        return resolve(true)
                    }

                    return setTimeout(check, 25)
                }
                
                return check()
            }).then(() => {
                db.set("localDataChanged:" + locationUUID, true).catch(log.error)

                sendToAllPorts({
                    type: "syncStatus",
                    data: {
                        type: "dataChanged",
                        data: {
                            locationUUID
                        }
                    }
                })
            })
        }, 100)
    })

    eventListener.on("syncStatus", (data: any) => {
        const { type } = data

        if(type == "acquireSyncLock"){
            IS_SYNCING = true
        }
        else if(type == "releaseSyncLock"){
            IS_SYNCING = false
        }
    })

    ipcRenderer.on("socket-event", (_: any, res: any) => {
        const { type, data } = res
        const { args } = data

        if(type == "fm-to-sync-client-message"){
            db.get("masterKeys").then(async (masterKeys) => {
                if(!Array.isArray(masterKeys)){
                    masterKeys = []
                }

                let gotArgs = undefined

                for(let i = 0; i < masterKeys.length; i++){
                    try{
                        const obj = JSON.parse(await decryptMetadata(args, masterKeys[i]))

                        if(obj && typeof obj == "object"){
                            gotArgs = obj
                        }
                    }
                    catch(e){
                        continue
                    }
                }

                if(typeof gotArgs == "undefined"){
                    return log.error(new Error("[fm-to-sync-client-message] gotArgs undefined"))
                }

                if(gotArgs.type == "download-folder"){
                    ipc.openDownloadWindow(gotArgs).catch(log.error)
                }
            }).catch(log.error)
        }
    })
}

export const sendToAllPorts = (data: any) => {
    return ipcRenderer.send("proxy-global-message", data)
}