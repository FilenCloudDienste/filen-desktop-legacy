const { ipcMain, dialog, app, systemPreferences, globalShortcut, BrowserWindow } = require("electron")
const log = require("electron-log")
const fs = require("fs-extra")
const pathModule = require("path")
const { v4: uuidv4 } = require("uuid")
const AutoLaunch = require("auto-launch")
const { autoUpdater } = require("electron-updater")

const autoLauncher = new AutoLaunch({
    name: "Filen",
    path: app.getPath("exe"),
})

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
                require("../db").get(key).then(resolve).catch(reject)
            }
            else if(action == "set"){
                require("../db").set(key, value).then(() => {
                    resolve(true)

                    emitGlobal("global-message", {
                        type: "dbSet",
                        data: {
                            key
                        }
                    })

                    return true
                }).catch(reject)
            }
            else if(action == "remove"){
                require("../db").remove(key).then(() => {
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
                require("../db").clear().then(() => {
                    resolve(true)

                    emitGlobal("global-message", {
                        type: "dbClear"
                    })

                    return true
                }).catch(reject)
            }
            else if(action == "keys"){
                require("../db").keys().then(resolve).catch(reject)
            }
            else{
                return reject("Invalid db action: " + action.toString())
            }
        }
        else if(type == "closeAuthWindow"){
            if(typeof require("../shared").get("AUTH_WINDOW") == "undefined"){
                return resolve(true)
            }

            try{
                require("../shared").get("AUTH_WINDOW").close()
            }
            catch(e){
                return reject(e)
            }

            return resolve(true)
        }
        else if(type == "createMainWindow"){
            if(typeof require("../shared").get("MAIN_WINDOW") !== "undefined"){
                return resolve(true)
            }

            require("../windows").createMain(true).then(() => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "loginDone"){
            if(typeof require("../shared").get("MAIN_WINDOW") !== "undefined"){
                try{
                    require("../shared").get("MAIN_WINDOW").close()
                }
                catch(e){
                   log.error(e)
                }
            }

            require("../windows").createMain(true).then(() => {
                if(typeof require("../shared").get("AUTH_WINDOW") !== "undefined"){
                    try{
                        require("../shared").get("AUTH_WINDOW").close()
                    }
                    catch(e){
                       log.error(e)
                    }
                }

                return resolve(true)
            }).catch(reject)
        }
        else if(type == "openSettingsWindow"){
            if(typeof require("../shared").get("SETTINGS_WINDOW") !== "undefined"){
                try{
                    require("../shared").get("SETTINGS_WINDOW").close()
                }
                catch(e){
                    return reject(e)
                }
            }

            require("../windows").createSettings(data.page).then(() => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "selectFolder"){
            let selectWindow = BrowserWindow.getFocusedWindow()

            if(selectWindow == null){
                selectWindow = require("../shared").get("WORKER_WINDOW")

                if(typeof selectWindow == "undefined"){
                    selectWindow = require("../shared").get("MAIN_WINDOW")
                }
            }

            dialog.showOpenDialog(selectWindow, {
                properties: ["openDirectory"]
            }).then(resolve).catch(reject)
        }
        else if(type == "openSelectFolderRemoteWindow"){
            const { windowId } = data

            require("../windows").createCloud(windowId, "selectFolder").then((window) => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "selectRemoteFolder"){
            const { windowId } = data

            require("../windows").createCloud(windowId, "selectFolder").then((window) => {
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
                app.exit()
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "watchDirectory"){
            const { path, locationUUID } = data

            require("../watcher")(path, locationUUID).then(() => {
                return resolve(true)
            }).catch((err) => {
                return reject(err)
            })
        }
        else if(type == "minimizeWindow"){
            try{
                if(data.window == "settings"){
                    const windows = require("../shared").get("SETTINGS_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].minimize()
                        }
                    }
                }
                else if(data.window == "auth"){
                    require("../shared").get("AUTH_WINDOW").minimize()
                }
                else if(data.window == "cloud"){
                    const windows = require("../shared").get("CLOUD_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].minimize()
                        }
                    }
                }
                else if(data.window == "download"){
                    const windows = require("../shared").get("DOWNLOAD_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].minimize()
                        }
                    }
                }
                else if(data.window == "upload"){
                    const windows = require("../shared").get("UPLOAD_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].minimize()
                        }
                    }
                }
                else if(data.window == "selectiveSync"){
                    const windows = require("../shared").get("SELECTIVE_SYNC_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].minimize()
                        }
                    }
                }
                else if(data.window == "main"){
                    require("../shared").get("MAIN_WINDOW").minimize()
                }
                else if(data.window == "update"){
                    require("../shared").get("UPDATE_WINDOW").minimize()
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
                    const windows = require("../shared").get("SETTINGS_WINDOWS")

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
                    const windows = require("../shared").get("CLOUD_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].close()
                        }
                    }
                }
                else if(data.window == "download"){
                    const windows = require("../shared").get("DOWNLOAD_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].close()
                        }
                    }
                }
                else if(data.window == "upload"){
                    const windows = require("../shared").get("UPLOAD_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].close()
                        }
                    }
                }
                else if(data.window == "selectiveSync"){
                    const windows = require("../shared").get("SELECTIVE_SYNC_WINDOWS")

                    for(const prop in windows){
                        if(data.windowId == windows[prop].windowId){
                            windows[prop].close()
                        }
                    }
                }
                else if(data.window == "main"){
                    require("../shared").get("MAIN_WINDOW").minimize()
                }
                else if(data.window == "update"){
                    require("../shared").get("UPDATE_WINDOW").close()
                }

                return resolve(true)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "setOpenOnStartup"){
            const { open } = data

            if(open){
                var promise = autoLauncher.enable()
            }
            else{
                var promise = autoLauncher.disable()
            }

            promise.then(() => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "getOpenOnStartup"){
            autoLauncher.isEnabled().then(resolve).catch(reject)
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
            let selectWindow = BrowserWindow.getFocusedWindow()

            if(selectWindow == null){
                selectWindow = require("../shared").get("WORKER_WINDOW")

                if(typeof selectWindow == "undefined"){
                    selectWindow = require("../shared").get("MAIN_WINDOW")
                }
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
                require("../tray").updateTrayIcon(type)

                return resolve(true)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "updateTrayMenu"){
            const { type } = data

            try{
                require("../tray").updateTrayMenu(type)

                return resolve(true)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "updateTrayTooltip"){
            const { text } = data

            try{
                require("../tray").updateTrayTooltip(text)

                return resolve(true)
            }
            catch(e){
                return reject(e)
            }
        }
        else if(type == "getFileIcon"){
            const { path } = data

            if(require("../memoryCache").has("fileIcon:" + path)){
                return resolve(require("../memoryCache").get("fileIcon:" + path))
            }

            app.getFileIcon(pathModule.normalize(path)).then((image) => {
                try{
                    const dataURL = image.toDataURL()

                    require("../memoryCache").set("fileIcon:" + path, dataURL)

                    return resolve(dataURL)
                }
                catch(e){
                    return reject(e)
                }
            }).catch(reject)
        }
        else if(type == "getFileIconExt"){
            const { ext } = data

            if(require("../memoryCache").has("fileIconExt:" + ext)){
                return resolve(require("../memoryCache").get("fileIconExt:" + ext))
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
                        require("../memoryCache").set("fileIconExt:" + ext, dataURL)
    
                        return resolve(dataURL)
                    }).catch(reject)
                }).catch(reject)
            })
        }
        else if(type == "getFileIconName"){
            const { name } = data

            if(require("../memoryCache").has("getFileIconName:" + name)){
                return resolve(require("../memoryCache").get("getFileIconName:" + name))
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
                        require("../memoryCache").set("getFileIconName:" + name, dataURL)
    
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
                    "Quit",
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
            }).catch(reject)
        }
        else if(type == "exitApp"){
            app.quit()
        }
        else if(type == "openDownloadWindow"){
            require("../windows").createDownload(data.args).then(() => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "openSelectiveSyncWindow"){
            require("../windows").createSelectiveSync(uuidv4(), data.args).then(() => {
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
        else if(type == "openUploadWindow"){
            require("../trayMenu").upload(data.type)

            return resolve(true)
        }
        else if(type == "acquireSyncLock"){
            require("../syncLock").acquireSyncLock("sync").then(() => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "releaseSyncLock"){
            require("../syncLock").releaseSyncLock("sync").then(() => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "openUpdateWindow"){
            require("../windows").createUpdate().then(() => {
                return resolve(true)
            }).catch(reject)
        }
        else if(type == "installUpdate"){
            try{
                autoUpdater.autoInstallOnAppQuit = false
                autoUpdater.quitAndInstall(false, true)

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
        require("../db").get("keybinds").then((keybinds) => {
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
                            require("../trayMenu").upload("folders")
                        }
                        else if(keybinds[i].type == "uploadFiles"){
                            require("../trayMenu").upload("files")
                        }
                        else if(keybinds[i].type == "download"){
                            require("../trayMenu").download()
                        }
                        else if(keybinds[i].type == "openSettings"){
                            require("../windows").createSettings().catch(log.error)
                        }
                        else if(keybinds[i].type == "pauseSync"){
                            require("../db").set("paused", true).catch(log.error)
                        }
                        else if(keybinds[i].type == "resumeSync"){
                            require("../db").set("paused", false).catch(log.error)
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
        if(typeof require("../shared").get("MAIN_WINDOW") !== "undefined"){
            require("../shared").get("MAIN_WINDOW").webContents.send(channel, data)
        }
    
        if(typeof require("../shared").get("WORKER_WINDOW") !== "undefined"){
            require("../shared").get("WORKER_WINDOW").webContents.send(channel, data)
        }
    
        if(typeof require("../shared").get("AUTH_WINDOW") !== "undefined"){
            require("../shared").get("AUTH_WINDOW").webContents.send(channel, data)
        }

        if(typeof require("../shared").get("UPDATE_WINDOW") !== "undefined"){
            require("../shared").get("UPDATE_WINDOW").webContents.send(channel, data)
        }
    
        const settingsWindows = require("../shared").get("SETTINGS_WINDOWS")

        if(typeof settingsWindows == "object"){
            for(const id in settingsWindows){
                settingsWindows[id].webContents.send(channel, data)
            }
        }

        const downloadWindows = require("../shared").get("DOWNLOAD_WINDOWS")

        if(typeof downloadWindows == "object"){
            for(const id in downloadWindows){
                downloadWindows[id].webContents.send(channel, data)
            }
        }

        const cloudWindows = require("../shared").get("CLOUD_WINDOWS")

        if(typeof cloudWindows == "object"){
            for(const id in cloudWindows){
                cloudWindows[id].webContents.send(channel, data)
            }
        }

        const uploadWindows = require("../shared").get("UPLOAD_WINDOWS")

        if(typeof uploadWindows == "object"){
            for(const id in uploadWindows){
                uploadWindows[id].webContents.send(channel, data)
            }
        }

        const selectiveSyncWindows = require("../shared").get("SELECTIVE_SYNC_WINDOWS")

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
                if(typeof event !== "undefined" && typeof event.sender !== "undefined"){
                    if(!event.sender.isDestroyed()){
                        try{
                            event.sender.send("message", {
                                messageId,
                                messageSender,
                                response
                            })
                        }
                        catch(e){
                            log.error(e)
                        }
                    }
                    else{
                        log.info("Could not handle message, sender destroyed")
                    }
                }
                else{
                    log.info("Could not handle message, sender destroyed")
                }
            }).catch((err) => {
                if(typeof event !== "undefined" && typeof event.sender !== "undefined"){
                    if(!event.sender.isDestroyed()){
                        try{
                            event.sender.send("message", {
                                messageId,
                                messageSender,
                                err
                            })
                        }
                        catch(e){
                            log.error(e)
                        }
                    }
                    else{
                        log.info("Could not handle message, sender destroyed")
                    }
                }
                else{
                    log.info("Could not handle message, sender destroyed")
                }
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