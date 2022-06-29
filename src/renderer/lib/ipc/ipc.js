import eventListener from "../eventListener"
import { v4 as uuidv4 } from "uuid"

const { ipcRenderer } = window.require("electron")

const MESSAGE_SENDER = uuidv4()
const resolves = {}
const rejects = {}

ipcRenderer.on("message", (_, data) => {
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

ipcRenderer.on("global-message", (_, data) => {
    return handleGlobalMessage(data)
})

ipcRenderer.on("from-worker", (_, data) => {
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

const handleGlobalMessage = (data) => {
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
    getAppPath: (path) => {
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
    db: (action, key, value) => {
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
    apiRequest: ({ method, endpoint, data = {}, timeout = 864000000 }) => {
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
    remoteFolderSelected: (data) => {
        return ipcRenderer.send("remoteFolderSelected", data)
    },
    decryptFolderName: (name) => {
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
    decryptFolderNamePrivateKey: (metadata, privateKey) => {
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
    decryptFolderNameLink: (metadata, linkKey) => {
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
    decryptFileMetadataLink: (metadata, linkKey) => {
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
    decryptFileMetadataPrivateKey: (metadata, privateKey) => {
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
    decryptFileMetadata: (metadata, masterKeys) => {
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
    decryptMetadata: (data, key) => {
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
    hashPassword: (password) => {
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
    hashFn: (data) => {
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
    deriveKeyFromPassword: ({ password, salt, iterations, hash, bitLength, returnHex }) => {
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
    generatePasswordAndMasterKeysBasedOnAuthVersion: ({ rawPassword, authVersion, salt }) => {
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
    watchDirectory: (path, locationUUID) => {
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
    selectiveSyncDirectoryTrees: (location) => {
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
    remoteTree: (location) => {
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
    localTree: (location) => {
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
    minimizeWindow: (window = "settings", windowId = uuidv4()) => {
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
    closeWindow: (window = "settings", windowId = uuidv4()) => {
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
    updateThrottles: (uploadKbps, downloadKbps) => {
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
    setOpenOnStartup: (open = true) => {
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
    getVersion: () => {
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
    getFileIcon: (path) => {
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
    getFileIconExt: (ext = "") => {
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
    getFileIconName: (name = "name") => {
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
    openDownloadWindow: (args) => {
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
    openSelectiveSyncWindow: (args) => {
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
    uploadChunk: ({ queryParams, data, timeout = 86400000, from = "sync" }) => {
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
    downloadChunk: ({ region, bucket, uuid, index, from = "sync" }) => {
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
    decryptData: ({ data, key, version }) => {
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
    encryptData: (data, key) => {
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
    encryptMetadata: (data, key) => {
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