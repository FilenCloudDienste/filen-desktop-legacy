import eventListener from "../eventListener"
// @ts-ignore
import { v4 as uuidv4 } from "uuid"

const { ipcRenderer } = window.require("electron")

const MESSAGE_SENDER: string = uuidv4()
const resolves: any = {}
const rejects: any = {}

ipcRenderer.on("message", (_: any, data: any) => {
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
        const { key, value } = data.data

        eventListener.emit("dbSet", {
            key,
            value
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
        data.type == "uploadProgress" || 
        data.type == "downloadProgress" || 
        data.type == "syncTask" || 
        data.type == "syncStatus" || 
        data.type == "syncStatusLocation" || 
        data.type == "downloadProgressSeperate" ||
        data.type == "uploadProgressSeperate"
    ){
        eventListener.emit(data.type, data.data)
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
    getAppPath: (path: string) => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "getAppPath",
                data: {
                    path
                }
            })
        })
    },
    db: (action: string, key: string, value: any) => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "db",
                data: {
                    action,
                    key,
                    value
                }
            })
        })
    },
    apiRequest: ({ method, endpoint, data = {}, timeout = 864000000 }: { method: string, endpoint: string, data: any, timeout: number }) => {
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
    closeAuthWindow: () => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "closeAuthWindow"
            })
        })
    },
    createMainWindow: () => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "createMainWindow"
            })
        })
    },
    loginDone: () => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "loginDone"
            })
        })
    },
    openSettingsWindow: (page = "general") => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "openSettingsWindow",
                data: {
                    page
                }
            })
        })
    },
    selectFolder: () => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "selectFolder"
            })
        })
    },
    openSelectFolderRemoteWindow: (windowId = uuidv4()) => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "openSelectFolderRemoteWindow",
                data: {
                    windowId
                }
            })
        })
    },
    selectRemoteFolder: (windowId = uuidv4()) => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "selectRemoteFolder",
                data: {
                    windowId
                }
            })
        })
    },
    remoteFolderSelected: (data: any) => {
        return ipcRenderer.send("remoteFolderSelected", data)
    },
    decryptFolderName: (name: string) => {
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
    decryptFolderNamePrivateKey: (metadata: string, privateKey: string) => {
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
    decryptFolderNameLink: (metadata: string, linkKey: string) => {
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
    decryptFileMetadataLink: (metadata: string, linkKey: string) => {
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
    decryptFileMetadataPrivateKey: (metadata: string, privateKey: string) => {
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
    decryptFileMetadata: (metadata: string, masterKeys: string[]) => {
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
    decryptMetadata: (data: string, key: string) => {
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
    hashPassword: (password: string) => {
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
    hashFn: (data: string) => {
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
    deriveKeyFromPassword: ({ password, salt, iterations, hash, bitLength, returnHex }: { password: string, salt: string, iterations: number, hash: string, bitLength: number, returnHex: boolean }) => {
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
    watchDirectory: (path: string, locationUUID: string) => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "watchDirectory",
                data: {
                    path,
                    locationUUID
                }
            })
        })
    },
    selectiveSyncDirectoryTrees: (location: any) => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("proxy-for-worker", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "selectiveSyncDirectoryTrees",
                data: {
                    location
                }
            })
        })
    },
    remoteTree: (location: any) => {
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
    localTree: (location: any) => {
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
    minimizeWindow: (window: string = "settings", windowId: string = uuidv4()) => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "minimizeWindow",
                data: {
                    window,
                    windowId
                }
            })
        })
    },
    closeWindow: (window: string = "settings", windowId: string = uuidv4()) => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "closeWindow",
                data: {
                    window,
                    windowId
                }
            })
        })
    },
    updateThrottles: (uploadKbps: number, downloadKbps: number) => {
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
    setOpenOnStartup: (open: boolean = true) => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "setOpenOnStartup",
                data: {
                    open
                }
            })
        })
    },
    getOpenOnStartup: () => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "getOpenOnStartup"
            })
        })
    },
    getVersion: (): Promise<string> => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "getVersion"
            })
        })
    },
    saveLogs: () => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "saveLogs"
            })
        })
    },
    updateTrayIcon: (type = "normal") => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "updateTrayIcon",
                data: {
                    type
                }
            })
        })
    },
    updateTrayMenu: (type = "default") => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "updateTrayMenu",
                data: {
                    type
                }
            })
        })
    },
    updateTrayTooltip: (text = "Filen") => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "updateTrayTooltip",
                data: {
                    text
                }
            })
        })
    },
    getFileIcon: (path: string) => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "getFileIcon",
                data: {
                    path
                }
            })
        })
    },
    getFileIconExt: (ext: string = "") => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "getFileIconExt",
                data: {
                    ext
                }
            })
        })
    },
    getFileIconName: (name: string = "name") => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "getFileIconName",
                data: {
                    name
                }
            })
        })
    },
    quitApp: () => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "quitApp"
            })
        })
    },
    openDownloadWindow: (args: any) => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "openDownloadWindow",
                data: {
                    args
                }
            })
        })
    },
    openSelectiveSyncWindow: (args: any) => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "openSelectiveSyncWindow",
                data: {
                    args
                }
            })
        })
    },
    uploadChunk: ({ queryParams, data, timeout = 86400000, from = "sync" }: { queryParams: any, data: any, timeout: number, from: string }) => {
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
    downloadChunk: ({ region, bucket, uuid, index, from = "sync" }: { region: string, bucket: string, uuid: string, index: number, from: string }) => {
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
    decryptData: ({ data, key, version }: { data: any, key: string, version: number }) => {
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
    encryptData: (data: any, key: string) => {
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
    encryptMetadata: (data: string, key: string) => {
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
    updateKeybinds: () => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "updateKeybinds"
            })
        })
    },
    disableKeybinds: () => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "disableKeybinds"
            })
        })
    },
    restartApp: () => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "restartApp"
            })
        })
    },
    openUploadWindow: (type = "files") => {
        return new Promise((resolve, reject) => {
            const messageId = uuidv4()

            resolves[messageId] = resolve
            rejects[messageId] = reject

            return ipcRenderer.send("message", {
                messageId,
                messageSender: MESSAGE_SENDER,
                type: "openUploadWindow",
                data: {
                    type
                }
            })
        })
    },
}

export default ipc