import eventListener from "../eventListener"
import { v4 as uuidv4 } from "uuid"
import db from "../db"
import { sendToAllPorts } from "../worker/ipc"
import { SyncIssue, Location } from "../../../types"

const { ipcRenderer } = window.require("electron")
const log = window.require("electron-log")

const MESSAGE_SENDER: string = uuidv4()
const resolves: Record<string, (value: any) => void> = {}
const rejects: Record<string, (reason?: any) => void> = {}
let DEBOUNCE_WATCHER_EVENT: any = {}

export const decodeError = ({ name, message, extra }: { name: string, message: string, extra: any }) => {
    const e = new Error(message)

    e.name = name

    Object.assign(e, extra)

    return e
}

export const invokeProxy = async <T>(channel: string, ...args: any[]): Promise<T> => {
    const { error, result } = await ipcRenderer.invoke(channel, ...args)

    if(error){
        throw decodeError(error)
    }

    return result
}

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
                    new Promise<void>((resolve) => {
                        const sub = eventListener.on("syncLoopDone", () => {
                            sub.remove()
        
                            return resolve()
                        })
                    }).then(() => {
                        for(let i = 0; i < syncLocations.length; i++){
                            Promise.all([
                                db.set("localDataChanged:" + syncLocations[i].uuid, true),
                                db.set("remoteDataChanged:" + syncLocations[i].uuid, true)
                            ]).then(() => {
                                sendToAllPorts({
                                    type: "syncStatus",
                                    data: {
                                        type: "dataChanged",
                                        data: {
                                            locationUUID: syncLocations[i].uuid
                                        }
                                    }
                                })
                            }).catch(console.error)
                        }  
                    })
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
            new Promise<void>((resolve) => {
                const sub = eventListener.on("syncLoopDone", () => {
                    sub.remove()

                    return resolve()
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
        return new Promise((resolve, reject) => {
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
        return invokeProxy("getAppPath", {
            path
        })
    },
    db: (action: string, key?: string, value?: any): Promise<any> => {
        return invokeProxy("db", {
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
        return invokeProxy("closeAuthWindow")
    },
    createMainWindow: (): Promise<any> => {
        return invokeProxy("createMainWindow")
    },
    loginDone: (): Promise<any> => {
        return invokeProxy("loginDone")
    },
    openSettingsWindow: (page: string = "general"): Promise<any> => {
        return invokeProxy("openSettingsWindow", {
            page
        })
    },
    selectFolder: (): Promise<any> => {
        return invokeProxy("selectFolder")
    },
    selectRemoteFolder: (): Promise<any> => {
        return invokeProxy("selectRemoteFolder")
    },
    remoteFolderSelected: (data: {
        uuid: string,
        path: string,
        name: string,
        canceled: boolean,
        windowId: number
    }) => {
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
        return invokeProxy("minimizeWindow", {
            window,
            windowId
        })
    },
    closeWindow: (window: string = "settings", windowId: string = uuidv4()): Promise<any> => {
        return invokeProxy("closeWindow", {
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
        return invokeProxy("setOpenOnStartup", {
            open
        })
    },
    getOpenOnStartup: (): Promise<boolean> => {
        return invokeProxy("getOpenOnStartup")
    },
    getVersion: (): Promise<string> => {
        return invokeProxy("getVersion")
    },
    saveLogs: (): Promise<boolean> => {
        return invokeProxy("saveLogs")
    },
    updateTrayIcon: (type: string = "normal"): Promise<boolean> => {
        return invokeProxy("updateTrayIcon", {
            type
        })
    },
    updateTrayMenu: (): Promise<void> => {
        return invokeProxy("updateTrayMenu")
    },
    updateTrayTooltip: (text: string = "Filen"): Promise<any> => {
        return invokeProxy("updateTrayTooltip", {
            text
        })
    },
    getFileIcon: (path: string): Promise<string> => {
        return invokeProxy("getFileIcon", {
            path
        })
    },
    getFileIconExt: (ext: string = ""): Promise<string> => {
        return invokeProxy("getFileIconExt", {
            ext
        })
    },
    getFileIconName: (name: string = "name"): Promise<string> => {
        return invokeProxy("getFileIconName", {
            name
        })
    },
    quitApp: (): Promise<void> => {
        return invokeProxy("quitApp")
    },
    exitApp: (): Promise<void> => {
        return invokeProxy("exitApp")
    },
    openDownloadWindow: (args: any): Promise<any> => {
        return invokeProxy("openDownloadWindow", {
            args
        })
    },
    openSelectiveSyncWindow: (location: Location): Promise<any> => {
        return invokeProxy("openSelectiveSyncWindow", location)
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
    updateKeybinds: (): Promise<void> => {
        return invokeProxy("updateKeybinds")
    },
    disableKeybinds: (): Promise<void> => {
        return invokeProxy("disableKeybinds")
    },
    restartApp: (): Promise<void> => {
        return invokeProxy("restartApp")
    },
    openUploadWindow: (type: string = "files"): Promise<any> => {
        return invokeProxy("openUploadWindow", {
            type
        })
    },
    installUpdate: (): Promise<void> => {
        return invokeProxy("installUpdate")
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
        return invokeProxy("trayAvailable")
    },
    initWatcher: (path: string, locationUUID: string): Promise<void> => {
        return invokeProxy("initWatcher", {
            path,
            locationUUID
        })
    },
    getSyncIssues: (): Promise<SyncIssue[]> => {
        return invokeProxy("getSyncIssues")
    },
    addSyncIssue: (syncIssue: SyncIssue): Promise<void> => {
        return invokeProxy("addSyncIssue", syncIssue)
    },
    removeSyncIssue: (uuid: string): Promise<void> => {
        return invokeProxy("removeSyncIssue", uuid)
    },
    clearSyncIssues: (): Promise<void> => {
        return invokeProxy("clearSyncIssues")
    },
    emitGlobal: (channel: string, data: any): Promise<void> => {
        return invokeProxy("emitGlobal", {
            channel,
            data
        })
    },
    loadApplyDoneTasks: (locationUUID: string): Promise<any[]> => {
        return invokeProxy("loadApplyDoneTasks", locationUUID)
    },
    clearApplyDoneTasks: (locationUUID: string): Promise<void> => {
        return invokeProxy("clearApplyDoneTasks", locationUUID)
    },
    addToApplyDoneTasks: (locationUUID: string, task: any): Promise<void> => {
        return invokeProxy("addToApplyDoneTasks", {
            locationUUID,
            task
        })
    }
}

export default ipc