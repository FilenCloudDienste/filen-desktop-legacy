import eventListener from "../eventListener"
import { v4 as uuidv4 } from "uuid"
import db from "../db"
import { sendToAllPorts } from "../worker/ipc"

const { ipcRenderer } = window.require("electron")
const log = window.require("electron-log")

const MESSAGE_SENDER: string = uuidv4()
const resolves: any = {}
const rejects: any = {}
let DEBOUNCE_WATCHER_EVENT: any = {}

ipcRenderer.on("global-message", (_: any, data: any) => {
    return handleGlobalMessage(data)
})

ipcRenderer.on("from-worker", (_: any, data: any) => {
    const { messageId, messageSender, response, err } = data

    if(typeof messageId == "undefined" || typeof response == "undefined" || typeof messageSender == "undefined"){
        return false
    }

    if(messageSender !== MESSAGE_SENDER){
        return false
    }

    const resolve = resolves[messageId]
    const reject = rejects[messageId]

    if(!resolve || !reject){
        return false
    }

    if(err){
        reject(err)
    }
    else{
        resolve(response)
    }

    delete resolves[messageId]
    delete rejects[messageId]

    return true
})

const handleGlobalMessage = (data: any) => {
    const { type } = data

    if(type == "dbSet"){
        const { key } = data.data

        eventListener.emit("dbSet", {
            key
        })
    }
    else if(type == "dbRemove"){
        const { key } = data.data

        eventListener.emit("dbRemove", {
            key
        })
    }
    else if(type == "dbClear"){
        eventListener.emit("dbClear")
    }
    else if(
        data.type == "uploadProgress"
        || data.type == "downloadProgress"
        || data.type == "syncTask"
        || data.type == "syncStatus"
        || data.type == "syncStatusLocation"
        || data.type == "downloadProgressSeperate"
        || data.type == "uploadProgressSeperate"
        || data.type == "syncTasksToDo"
    ){
        eventListener.emit(data.type, data.data)
    }
    else if(type == "forceSync" && window.location.href.indexOf("#worker") !== -1){
        db.get("userId").then((userId) => {
            db.get("syncLocations:" + userId).then((syncLocations) => {
                if(Array.isArray(syncLocations)){
                    for(let i = 0; i < syncLocations.length; i++){
                        new Promise((resolve) => {
                            const sub = eventListener.on("syncLoopDone", () => {
                                sub.remove()
            
                                return resolve(true)
                            })
                        }).then(() => {
                            Promise.all([
                                db.set("localDataChanged:" + syncLocations[i].uuid, true),
                                db.set("remoteDataChanged:" + syncLocations[i].uuid, true)
                            ]).catch(console.error)
                        })
                    }
                }
            }).catch(console.error)
        }).catch(console.error)
    }
    else if(type == "doneTasksCleared"){
        eventListener.emit("doneTasksCleared")
    }
    else if(type == "watcher-event" && window.location.href.indexOf("#worker") !== -1){
        const locationUUID: string = data.data.locationUUID

        clearTimeout(DEBOUNCE_WATCHER_EVENT[locationUUID])

        DEBOUNCE_WATCHER_EVENT[locationUUID] = setTimeout(() => {
            new Promise((resolve) => {
                const sub = eventListener.on("syncLoopDone", () => {
                    sub.remove()

                    return resolve(true)
                })
            }).then(() => {
                db.set("localDataChanged:" + locationUUID, true).then(() => {
                    sendToAllPorts({
                        type: "syncStatus",
                        data: {
                            type: "dataChanged",
                            data: {
                                locationUUID
                            }
                        }
                    })
                }).catch(log.error)
            })
        }, 1000)
    }

    return true
}

const ipc = {
    ping: () => {
        return new Promise((resolve, reject): Promise<any> => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "ping"
            })
        })
    },
    getAppPath: (path: string): Promise<string> => {
        return ipcRenderer.invoke("getAppPath", {
            path
        })
    },
    db: (action: string, key?: string, value?: any): Promise<any> => {
        return ipcRenderer.invoke("db", {
            action,
            key,
            value
        })
    },
    apiRequest: ({ method, endpoint, data = {}, timeout = 864000000 }: { method: string, endpoint: string, data: any, timeout: number }): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "apiRequest",
                data: {
                    method,
                    endpoint,
                    data,
                    timeout
                }
            })
        })
    },
    closeAuthWindow: (): Promise<any> => {
        return ipcRenderer.invoke("closeAuthWindow")
    },
    createMainWindow: (): Promise<any> => {
        return ipcRenderer.invoke("createMainWindow")
    },
    loginDone: (): Promise<any> => {
        return ipcRenderer.invoke("loginDone")
    },
    openSettingsWindow: (page: string = "general"): Promise<any> => {
        return ipcRenderer.invoke("openSettingsWindow", {
            page
        })
    },
    selectFolder: (): Promise<any> => {
        return ipcRenderer.invoke("selectFolder")
    },
    openSelectFolderRemoteWindow: (windowId: string = uuidv4()): Promise<any> => {
        return ipcRenderer.invoke("openSelectFolderRemoteWindow", {
            windowId
        })
    },
    selectRemoteFolder: (windowId = uuidv4()): Promise<any> => {
        return ipcRenderer.invoke("selectRemoteFolder", {
            windowId
        })
    },
    remoteFolderSelected: (data: any): Promise<any> => {
        return ipcRenderer.send("remoteFolderSelected", data)
    },
    decryptFolderName: (name: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "decryptFolderName",
                data: {
                    name
                }
            })
        })
    },
    decryptFolderNamePrivateKey: (metadata: string, privateKey: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "decryptFolderNamePrivateKey",
                data: {
                    metadata,
                    privateKey
                }
            })
        })
    },
    decryptFolderNameLink: (metadata: string, linkKey: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "decryptFolderNameLink",
                data: {
                    metadata,
                    linkKey
                }
            })
        })
    },
    decryptFileMetadataLink: (metadata: string, linkKey: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "decryptFileMetadataLink",
                data: {
                    metadata,
                    linkKey
                }
            })
        })
    },
    decryptFileMetadataPrivateKey: (metadata: string, privateKey: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "decryptFileMetadataPrivateKey",
                data: {
                    metadata,
                    privateKey
                }
            })
        })
    },
    decryptFileMetadata: (metadata: string, masterKeys: string[]): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "decryptFileMetadata",
                data: {
                    metadata,
                    masterKeys
                }
            })
        })
    },
    decryptMetadata: (data: string, key: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "decryptMetadata",
                data: {
                    data,
                    key
                }
            })
        })
    },
    hashPassword: (password: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "hashPassword",
                data: {
                    password
                }
            })
        })
    },
    hashFn: (data: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "hashFn",
                data: {
                    data
                }
            })
        })
    },
    deriveKeyFromPassword: ({ password, salt, iterations, hash, bitLength, returnHex }: { password: string, salt: string, iterations: number, hash: string, bitLength: number, returnHex: boolean }): Promise<string> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "deriveKeyFromPassword",
                data: {
                    password,
                    salt,
                    iterations,
                    hash,
                    bitLength,
                    returnHex
                }
            })
        })
    },
    generatePasswordAndMasterKeysBasedOnAuthVersion: ({ rawPassword, authVersion, salt }: { rawPassword: string, authVersion: number, salt: string }): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "generatePasswordAndMasterKeysBasedOnAuthVersion",
                data: {
                    rawPassword,
                    authVersion,
                    salt
                }
            })
        })
    },
    remoteTree: (location: any): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "remoteTree",
                data: {
                    location
                }
            })
        })
    },
    localTree: (location: any): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "localTree",
                data: {
                    location
                }
            })
        })
    },
    minimizeWindow: (window: string = "settings", windowId: string = uuidv4()): Promise<any> => {
        return ipcRenderer.invoke("minimizeWindow", {
            window,
            windowId
        })
    },
    closeWindow: (window: string = "settings", windowId: string = uuidv4()): Promise<any> => {
        return ipcRenderer.invoke("closeWindow", {
            window,
            windowId
        })
    },
    updateThrottles: (uploadKbps: number, downloadKbps: number): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "updateThrottles",
                data: {
                    uploadKbps,
                    downloadKbps
                }
            })
        })
    },
    setOpenOnStartup: (open: boolean = true): Promise<boolean> => {
        return ipcRenderer.invoke("setOpenOnStartup", {
            open
        })
    },
    getOpenOnStartup: (): Promise<boolean> => {
        return ipcRenderer.invoke("getOpenOnStartup")
    },
    getVersion: (): Promise<string> => {
        return ipcRenderer.invoke("getVersion")
    },
    saveLogs: (): Promise<boolean> => {
        return ipcRenderer.invoke("saveLogs")
    },
    updateTrayIcon: (type: string = "normal"): Promise<boolean> => {
        return ipcRenderer.invoke("updateTrayIcon", {
            type
        })
    },
    updateTrayMenu: (type: string = "default"): Promise<any> => {
        return ipcRenderer.invoke("updateTrayMenu", {
            type
        })
    },
    updateTrayTooltip: (text: string = "Filen"): Promise<any> => {
        return ipcRenderer.invoke("updateTrayTooltip", {
            text
        })
    },
    getFileIcon: (path: string): Promise<string> => {
        return ipcRenderer.invoke("getFileIcon", {
            path
        })
    },
    getFileIconExt: (ext: string = ""): Promise<string> => {
        return ipcRenderer.invoke("getFileIconExt", {
            ext
        })
    },
    getFileIconName: (name: string = "name"): Promise<string> => {
        return ipcRenderer.invoke("getFileIconName", {
            name
        })
    },
    quitApp: (): Promise<any> => {
        return ipcRenderer.invoke("quitApp")
    },
    exitApp: (): Promise<any> => {
        return ipcRenderer.invoke("exitApp")
    },
    openDownloadWindow: (args: any): Promise<any> => {
        return ipcRenderer.invoke("openDownloadWindow", {
            args
        })
    },
    openSelectiveSyncWindow: (args: any): Promise<any> => {
        return ipcRenderer.invoke("openSelectiveSyncWindow", {
            args
        })
    },
    uploadChunk: ({ queryParams, data, timeout = 86400000, from = "sync" }: { queryParams: any, data: any, timeout: number, from: string }): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "uploadChunk",
                data: {
                    queryParams,
                    data,
                    timeout,
                    from
                }
            })
        })
    },
    downloadChunk: ({ region, bucket, uuid, index, from = "sync" }: { region: string, bucket: string, uuid: string, index: number, from: string }): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "downloadChunk",
                data: {
                    region,
                    bucket,
                    uuid,
                    index,
                    from
                }
            })
        })
    },
    decryptData: ({ data, key, version }: { data: any, key: string, version: number }): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "decryptData",
                data: {
                    data,
                    key,
                    version
                }
            })
        })
    },
    encryptData: (data: any, key: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "encryptData",
                data: {
                    data,
                    key
                }
            })
        })
    },
    encryptMetadata: (data: string, key: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "encryptMetadata",
                data: {
                    data,
                    key
                }
            })
        })
    },
    updateKeybinds: (): Promise<any> => {
        return ipcRenderer.invoke("updateKeybinds")
    },
    disableKeybinds: (): Promise<any> => {
        return ipcRenderer.invoke("disableKeybinds")
    },
    restartApp: (): Promise<any> => {
        return ipcRenderer.invoke("restartApp")
    },
    openUploadWindow: (type: string = "files"): Promise<any> => {
        return ipcRenderer.invoke("openUploadWindow", {
            type
        })
    },
    installUpdate: (): Promise<any> => {
        return ipcRenderer.invoke("installUpdate")
    },
    getFileKey: (uuid: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "getFileKey",
                data: {
                    uuid
                }
            })
        })
    },
    trayAvailable: (): Promise<boolean> => {
        return ipcRenderer.invoke("trayAvailable")
    },
    initWatcher: (path: string, locationUUID: string): Promise<boolean> => {
        return ipcRenderer.invoke("initWatcher", {
            path,
            locationUUID
        })
    }
}

export default ipc