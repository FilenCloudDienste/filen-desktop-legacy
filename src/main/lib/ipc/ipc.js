const { ipcMain, dialog, app, systemPreferences, globalShortcut } = require("electron")
const db = require("../db")
const shared = require("../shared")
const windows = require("../windows")
const log = require("electron-log")
const watcher = require("../watcher")
const fs = require("fs-extra")
const pathModule = require("path")
const tray = require("../tray")
const memoryCache = require("../memoryCache")
const trayMenu = require("../trayMenu")
const { v4: uuidv4 } = require("uuid")

const handleMessage = (type, data) => {
    return new Promise((resolve, reject) => {
        if(type == "ping"){
            return resolve("pong")
        }
        else if(type == "getAppPath"){
            const { path } = data

            try{
                return resolve(app.getPath(path))
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "db"){
            const { action, key, value } = data

            if(action == "get"){
                db.get(key).then(resolve).catch(reject)
            }
            else if(action == "set"){
                db.set(key, value).then(() => {
                    resolve(true)

                    emitGlobal("global-message", {
                        type: "dbSet",
                        data: {
                            key,
                            value
                        }
                    })

                    return true
                }).catch(reject)
            }
            else if(action == "remove"){
                db.remove(key).then(() => {
                    resolve(true)

                    emitGlobal("global-message", {
                        type: "dbRemove",
                        data: {
                            key
                        }
                    })

                    return true
                }).catch(reject)
            }
            else if(action == "clear"){
                db.clear().then(() => {
                    resolve(true)

                    emitGlobal("global-message", {
                        type: "dbClear"
                    })

                    return true
                }).catch(reject)
            }
            else if(action == "keys"){
                db.keys().then(resolve).catch(reject)
            }
            else{
                return reject("Invalid db action: " + action.toString())
            }
        }
        else if(type == "closeAuthWindow"){
            if(typeof shared.get("AUTH_WINDOW") == "undefined"){
                return resolve(true)
            }

            try{
                shared.get("AUTH_WINDOW").close()
            }
            catch(e){
                return reject(e)
            }

            return resolve(true)
        }
        else if(type == "createMainWindow"){
            if(typeof shared.get("MAIN_WINDOW") !== "undefined"){
                return resolve(true)
            }

            windows.createMain().then(() => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "loginDone"){
            if(typeof shared.get("MAIN_WINDOW") !== "undefined"){
                try{
                    shared.get("MAIN_WINDOW").close()
                }
                catch(e){
                   log.error(e)
                }
            }

            if(typeof shared.get("AUTH_WINDOW") !== "undefined"){
                try{
                    shared.get("AUTH_WINDOW").close()
                }
                catch(e){
                   log.error(e)
                }
            }

            windows.createMain().then(() => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "openSettingsWindow"){
            if(typeof shared.get("SETTINGS_WINDOW") !== "undefined"){
                try{
                    shared.get("SETTINGS_WINDOW").close()
                }
                catch(e){
                    return reject(e)
                }
            }

            windows.createSettings(data.page).then(() => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "selectFolder"){
            let selectWindow = shared.get("WORKER_WINDOW")

            if(typeof selectWindow == "undefined"){
                selectWindow = shared.get("MAIN_WINDOW")
            }

            dialog.showOpenDialog(selectWindow, {
                properties: ["openDirectory"]
            }).then(resolve).catch(reject)
        }
        else if(type == "openSelectFolderRemoteWindow"){
            const { windowId } = data

            windows.createCloud(windowId, "selectFolder").then((window) => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "selectRemoteFolder"){
            const { windowId } = data

            windows.createCloud(windowId, "selectFolder").then((window) => {
                ipcMain.once("remoteFolderSelected", (_, data) => {
                    if(data.windowId !== windowId){
                        return false
                    }

                    window.close()
    
                    return resolve(data)
                })

                window.once("closed", () => {
                    return resolve({
                        canceled: true,
                        windowId
                    })
                })
            }).catch(reject)
        }
        else if(type == "restartApp"){
            try{
                app.relaunch()

                return resolve(true)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "watchDirectory"){
            const { path, locationUUID } = data

            watcher(path, locationUUID).then(() => {
                return resolve(true)
            }).catch((err) => {
                return reject(err)
            })
        }
        else if(type == "minimizeWindow"){
            try{
                if(data.window == "settings"){
                    const windows = shared.get("SETTINGS_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].minimize()
                        }
                    }
                }
                else if(data.window == "auth"){
                    shared.get("AUTH_WINDOW").minimize()
                }
                else if(data.window == "cloud"){
                    const windows = shared.get("CLOUD_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].minimize()
                        }
                    }
                }
                else if(data.window == "download"){
                    const windows = shared.get("DOWNLOAD_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].minimize()
                        }
                    }
                }
                else if(data.window == "upload"){
                    const windows = shared.get("UPLOAD_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].minimize()
                        }
                    }
                }
                else if(data.window == "selectiveSync"){
                    const windows = shared.get("SELECTIVE_SYNC_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].minimize()
                        }
                    }
                }
                else if(data.window == "main"){
                    shared.get("MAIN_WINDOW").minimize()
                }

                return resolve(true)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "closeWindow"){
            try{
                if(data.window == "settings"){
                    const windows = shared.get("SETTINGS_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].close()
                        }
                    }
                }
                else if(data.window == "auth"){
                    app.quit()
                }
                else if(data.window == "cloud"){
                    const windows = shared.get("CLOUD_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].close()
                        }
                    }
                }
                else if(data.window == "download"){
                    const windows = shared.get("DOWNLOAD_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].close()
                        }
                    }
                }
                else if(data.window == "upload"){
                    const windows = shared.get("UPLOAD_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].close()
                        }
                    }
                }
                else if(data.window == "selectiveSync"){
                    const windows = shared.get("SELECTIVE_SYNC_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].close()
                        }
                    }
                }
                else if(data.window == "main"){
                    shared.get("MAIN_WINDOW").minimize()
                }

                return resolve(true)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "setOpenOnStartup"){
            const { open } = data

            try{
                app.setLoginItemSettings({
                    openAtLogin: open,
                    openAsHidden: true,
                    path: app.getPath("exe"),
                    name: "Filen",
                    args: [
                        "--processStart", `"${app.getPath("exe")}"`,
                        "--process-start-args", `"--hidden"`
                    ]
                })

                return resolve(e)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "getOpenOnStartup"){
            try{
                return resolve(app.getLoginItemSettings().openAtLogin)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "getVersion"){
            try{
                return resolve(app.getVersion())
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "saveLogs"){
            let selectWindow = shared.get("WORKER_WINDOW")

            if(typeof selectWindow == "undefined"){
                selectWindow = shared.get("MAIN_WINDOW")
            }

            dialog.showOpenDialog(selectWindow, {
                properties: ["openDirectory"]
            }).then((result) => {
                if(result.canceled){
                    return resolve(false)
                }
    
                const paths = result.filePaths
    
                if(!Array.isArray(paths)){
                    return resolve(false)
                }
    
                const localPath = paths[0]
    
                if(typeof localPath !== "string"){
                    return resolve(false)
                }

                try{
                    var logsPath = pathModule.normalize(pathModule.join(log.transports.file.getFile().path, "../"))
                    var savePath = pathModule.normalize(localPath + "/filenLogs/")
                }
                catch(e){
                    return reject(e)
                }

                fs.copy(logsPath, savePath, {
                    overwrite: true,
                    recursive: true
                }).then(() => {
                    return resolve(true)
                }).catch(reject)
            }).catch(reject)
        }
        else if(type == "updateTrayIcon"){
            const { type } = data

            try{
                tray.updateTrayIcon(type)

                return resolve(true)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "updateTrayMenu"){
            const { type } = data

            try{
                tray.updateTrayMenu(type)

                return resolve(true)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "updateTrayTooltip"){
            const { text } = data

            try{
                tray.updateTrayTooltip(text)

                return resolve(true)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "getFileIcon"){
            const { path } = data

            if(memoryCache.has("fileIcon:" + path)){
                return resolve(memoryCache.get("fileIcon:" + path))
            }

            app.getFileIcon(pathModule.normalize(path)).then((image) => {
                try{
                    const dataURL = image.toDataURL()

                    memoryCache.set("fileIcon:" + path, dataURL)

                    return resolve(dataURL)
                }
                catch(e){
                    return reject(e)
                }
            }).catch(reject)
        }
        else if(type == "getFileIconExt"){
            const { ext } = data

            if(memoryCache.has("fileIconExt:" + ext)){
                return resolve(memoryCache.get("fileIconExt:" + ext))
            }

            const tempPath = pathModule.normalize(pathModule.join(app.getPath("temp"), uuidv4() + (typeof ext == "string" && ext.length > 0 ? (ext.indexOf(".") == -1 ? "" : "." + ext) : "")))

            fs.writeFile(tempPath, "").then(() => {
                app.getFileIcon(tempPath).then((image) => {
                    try{
                        var dataURL = image.toDataURL()
                    }
                    catch(e){
                        return reject(e)
                    }

                    fs.unlink(tempPath).then(() => {
                        memoryCache.set("fileIconExt:" + ext, dataURL)
    
                        return resolve(dataURL)
                    }).catch(reject)
                }).catch(reject)
            })
        }
        else if(type == "getFileIconName"){
            const { name } = data

            if(memoryCache.has("getFileIconName:" + name)){
                return resolve(memoryCache.get("getFileIconName:" + name))
            }

            const tempPath = pathModule.normalize(pathModule.join(app.getPath("temp"), uuidv4() + "_" + name))

            fs.writeFile(tempPath, "").then(() => {
                app.getFileIcon(tempPath).then((image) => {
                    try{
                        var dataURL = image.toDataURL()
                    }
                    catch(e){
                        return reject(e)
                    }

                    fs.unlink(tempPath).then(() => {
                        memoryCache.set("getFileIconName:" + name, dataURL)
    
                        return resolve(dataURL)
                    }).catch(reject)
                }).catch(reject)
            })
        }
        else if(type == "quitApp"){
            dialog.showMessageBox(undefined, {
                message: "Are you sure you want to quit?",
                type: "warning",
                buttons: [
                    "Close",
                    "Cancel"
                ],
                defaultId: 0,
                title: "Filen",
                cancelId: 0
            }).then(({ response }) => {
                if(response == 1){
                    return resolve(true)
                }

                app.quit()

                return resolve(true)
            }).catch(reject)
        }
        else if(type == "openDownloadWindow"){
            windows.createDownload(data.args).then(() => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "openSelectiveSyncWindow"){
            windows.createSelectiveSync(uuidv4(), data.args).then(() => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "getSystemColor"){
            try{
                return resolve(systemPreferences.getColor(data.type))
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "updateKeybinds"){
            updateKeybinds().then(resolve).catch(reject)
        }
        else if(type == "disableKeybinds"){
            try{
                globalShortcut.unregisterAll()

                return resolve(true)
            }
            catch(e){
                return reject(e)
            }
        }
        else{
            return reject("Invalid message type: " + type.toString())
        }

        return true
    })
}

const updateKeybinds = () => {
    return new Promise((resolve, reject) => {
        db.get("keybinds").then((keybinds) => {
            if(!Array.isArray(keybinds)){
                keybinds = []
            }

            try{
                globalShortcut.unregisterAll()

                for(let i = 0; i < keybinds.length; i++){
                    if(typeof keybinds[i].keybind !== "string"){
                        continue
                    }

                    globalShortcut.register(keybinds[i].keybind, () => {
                        if(keybinds[i].type == "uploadFolders"){
                            trayMenu.upload("folders")
                        }
                        else if(keybinds[i].type == "uploadFiles"){
                            trayMenu.upload("files")
                        }
                        else if(keybinds[i].type == "download"){
                            trayMenu.download()
                        }
                        else if(keybinds[i].type == "openSettings"){
                            windows.createSettings().catch(log.error)
                        }
                        else if(keybinds[i].type == "pauseSync"){
                            db.set("paused", true).catch(log.error)
                        }
                        else if(keybinds[i].type == "resumeSync"){
                            db.set("paused", false).catch(log.error)
                        }
                    })
                }

                return resolve(true)
            }
            catch(e){
                return reject(e)
            }
        }).catch(reject)
    })
}

const emitGlobal = (channel = "global-message", data) => {
    try{
        if(typeof shared.get("MAIN_WINDOW") !== "undefined"){
            shared.get("MAIN_WINDOW").webContents.send(channel, data)
        }
    
        if(typeof shared.get("WORKER_WINDOW") !== "undefined"){
            shared.get("WORKER_WINDOW").webContents.send(channel, data)
        }
    
        if(typeof shared.get("AUTH_WINDOW") !== "undefined"){
            shared.get("AUTH_WINDOW").webContents.send(channel, data)
        }
    
        const settingsWindows = shared.get("SETTINGS_WINDOWS")

        if(typeof settingsWindows == "object"){
            for(const id in settingsWindows){
                settingsWindows[id].webContents.send(channel, data)
            }
        }

        const downloadWindows = shared.get("DOWNLOAD_WINDOWS")

        if(typeof downloadWindows == "object"){
            for(const id in downloadWindows){
                downloadWindows[id].webContents.send(channel, data)
            }
        }

        const cloudWindows = shared.get("CLOUD_WINDOWS")

        if(typeof cloudWindows == "object"){
            for(const id in cloudWindows){
                cloudWindows[id].webContents.send(channel, data)
            }
        }

        const uploadWindows = shared.get("UPLOAD_WINDOWS")

        if(typeof uploadWindows == "object"){
            for(const id in uploadWindows){
                uploadWindows[id].webContents.send(channel, data)
            }
        }

        const selectiveSyncWindows = shared.get("SELECTIVE_SYNC_WINDOWS")

        if(typeof selectiveSyncWindows == "object"){
            for(const id in selectiveSyncWindows){
                selectiveSyncWindows[id].webContents.send(channel, data)
            }
        }
    }
    catch(e){
        log.error(e)
    }

    return true
}

const listen = () => {
    return new Promise((resolve, reject) => {
        ipcMain.on("message", (event, request) => {
            const { messageId, messageSender, type, data } = request
    
            if(!messageId || !messageSender || !type){
                return false
            }
    
            handleMessage(type, data).then((response) => {
                return event.sender.send("message", {
                    messageId,
                    messageSender,
                    response
                })
            }).catch((err) => {
                return event.sender.send("message", {
                    messageId,
                    messageSender,
                    err
                })
            })
        })
    
        ipcMain.on("proxy-global-message", (_, data) => {
            emitGlobal("global-message", data)
        })
    
        ipcMain.on("proxy-from-worker", (_, data) => {
            emitGlobal("from-worker", data)
        })
    
        ipcMain.on("proxy-for-worker", (_, data) => {
            emitGlobal("for-worker", data)
        })

        return resolve(true)
    })
}

module.exports = {
    listen,
    emitGlobal,
    updateKeybinds
}