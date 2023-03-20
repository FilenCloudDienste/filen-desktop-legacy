const { ipcMain, dialog, app, globalShortcut, BrowserWindow } = require("electron")
const log = require("electron-log")
const fs = require("fs-extra")
const pathModule = require("path")
const { v4: uuidv4 } = require("uuid")
const AutoLaunch = require("auto-launch")
const { autoUpdater } = require("electron-updater")
const is = require("electron-is")

const autoLauncher = new AutoLaunch({
    name: "Filen",
    path: app.getPath("exe"),
})

let syncIssues = []

ipcMain.handle("db", async (_, { action, key, value }) => {
    if(action == "get"){
        return await require("../db").get(key)
    }
    else if(action == "set"){
        await require("../db").set(key, value)

        return true
    }
    else if(action == "remove"){
        await require("../db").remove(key)

        return true
    }
    else if(action == "clear"){
        await require("../db").clear()

        return true
    }
    else if(action == "keys"){
        return require("../db").keys()
    }
    else{
        throw new Error("Invalid db action: " + action.toString())
    }
})

ipcMain.handle("ping", async () => {
    return "pong"
})

ipcMain.handle("getAppPath", async (_, { path }) => {
    return app.getPath(path)
})

ipcMain.handle("closeAuthWindow", async () => {
    if(typeof require("../shared").get("AUTH_WINDOW") == "undefined"){
        return true
    }

    try{
        require("../shared").get("AUTH_WINDOW").close()
    }
    catch(e){
        log.error(e)

        return false
    }

    return true
})

ipcMain.handle("createMainWindow", async () => {
    if(typeof require("../shared").get("MAIN_WINDOW") !== "undefined"){
        return true
    }

    await require("../windows").createMain(true)

    return true
})

ipcMain.handle("loginDone", async () => {
    if(typeof require("../shared").get("MAIN_WINDOW") !== "undefined"){
        try{
            require("../shared").get("MAIN_WINDOW").close()
        }
        catch(e){
           log.error(e)
        }
    }

    await require("../windows").createMain(true)

    if(typeof require("../shared").get("AUTH_WINDOW") !== "undefined"){
        try{
            require("../shared").get("AUTH_WINDOW").close()
        }
        catch(e){
           log.error(e)
        }
    }

    return true
})

ipcMain.handle("openSettingsWindow", async (_, { page }) => {
    if(typeof require("../shared").get("SETTINGS_WINDOW") !== "undefined"){
        try{
            require("../shared").get("SETTINGS_WINDOW").close()
        }
        catch(e){
            throw e
        }
    }

    await require("../windows").createSettings(page)

    return true
})

ipcMain.handle("selectFolder", async () => {
    let selectWindow = BrowserWindow.getFocusedWindow()

    if(selectWindow == null){
        selectWindow = require("../shared").get("WORKER_WINDOW")

        if(typeof selectWindow == "undefined"){
            selectWindow = require("../shared").get("MAIN_WINDOW")
        }
    }

    return dialog.showOpenDialog(selectWindow, {
        properties: ["openDirectory"]
    })
})

ipcMain.handle("openSelectFolderRemoteWindow", async (_, { windowId }) => {
    const window = await require("../windows").createCloud(windowId, "selectFolder")

    return window
})

ipcMain.handle("selectRemoteFolder", async (_, { windowId }) => {
    const window = await require("../windows").createCloud(windowId, "selectFolder")

    return await new Promise((resolve, reject) => {
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
    })
})

ipcMain.handle("restartApp", async () => {
    app.relaunch()
    app.exit()

    return true
})

ipcMain.handle("minimizeWindow", async (_, { window, windowId }) => {
    if(window == "settings"){
        const windows = require("../shared").get("SETTINGS_WINDOWS")

        for(const prop in windows){
            if(windowId == windows[prop].windowId){
                windows[prop].minimize()
            }
        }
    }
    else if(window == "auth"){
        require("../shared").get("AUTH_WINDOW").minimize()
    }
    else if(window == "cloud"){
        const windows = require("../shared").get("CLOUD_WINDOWS")

        for(const prop in windows){
            if(windowId == windows[prop].windowId){
                windows[prop].minimize()
            }
        }
    }
    else if(window == "download"){
        const windows = require("../shared").get("DOWNLOAD_WINDOWS")

        for(const prop in windows){
            if(windowId == windows[prop].windowId){
                windows[prop].minimize()
            }
        }
    }
    else if(window == "upload"){
        const windows = require("../shared").get("UPLOAD_WINDOWS")

        for(const prop in windows){
            if(windowId == windows[prop].windowId){
                windows[prop].minimize()
            }
        }
    }
    else if(window == "selectiveSync"){
        const windows = require("../shared").get("SELECTIVE_SYNC_WINDOWS")

        for(const prop in windows){
            if(windowId == windows[prop].windowId){
                windows[prop].minimize()
            }
        }
    }
    else if(window == "main"){
        require("../shared").get("MAIN_WINDOW").minimize()
    }
    else if(window == "update"){
        require("../shared").get("UPDATE_WINDOW").minimize()
    }

    return true
})

ipcMain.handle("closeWindow", async (_, { window, windowId }) => {
    if(window == "settings"){
        const windows = require("../shared").get("SETTINGS_WINDOWS")

        for(const prop in windows){
            if(windowId == windows[prop].windowId){
                windows[prop].close()
            }
        }
    }
    else if(window == "auth"){
        app.quit()
    }
    else if(window == "cloud"){
        const windows = require("../shared").get("CLOUD_WINDOWS")

        for(const prop in windows){
            if(windowId == windows[prop].windowId){
                windows[prop].close()
            }
        }
    }
    else if(window == "download"){
        const windows = require("../shared").get("DOWNLOAD_WINDOWS")

        for(const prop in windows){
            if(windowId == windows[prop].windowId){
                windows[prop].close()
            }
        }
    }
    else if(window == "upload"){
        const windows = require("../shared").get("UPLOAD_WINDOWS")

        for(const prop in windows){
            if(windowId == windows[prop].windowId){
                windows[prop].close()
            }
        }
    }
    else if(window == "selectiveSync"){
        const windows = require("../shared").get("SELECTIVE_SYNC_WINDOWS")

        for(const prop in windows){
            if(windowId == windows[prop].windowId){
                windows[prop].close()
            }
        }
    }
    else if(window == "main"){
        require("../shared").get("MAIN_WINDOW").minimize()
    }
    else if(window == "update"){
        require("../shared").get("UPDATE_WINDOW").close()
    }

    return true
})

ipcMain.handle("setOpenOnStartup", async (_, { open }) => {
    const promise = open ? autoLauncher.enable() : autoLauncher.disable()

    await promise

    return true
})

ipcMain.handle("getOpenOnStartup", async () => {
    return await autoLauncher.isEnabled()
})

ipcMain.handle("getVersion", async () => {
    return app.getVersion()
})

ipcMain.handle("saveLogs", async () => {
    let selectWindow = BrowserWindow.getFocusedWindow()

    if(selectWindow == null){
        selectWindow = require("../shared").get("WORKER_WINDOW")

        if(typeof selectWindow == "undefined"){
            selectWindow = require("../shared").get("MAIN_WINDOW")
        }
    }

    const result = await dialog.showOpenDialog(selectWindow, {
        properties: ["openDirectory"]
    })

    if(result.canceled){
        return false
    }

    const paths = result.filePaths

    if(!Array.isArray(paths)){
        return false
    }

    const localPath = paths[0]

    if(typeof localPath !== "string"){
        return false
    }

    const logsPath = pathModule.normalize(pathModule.join(log.transports.file.getFile().path, "../"))
    const savePath = pathModule.normalize(localPath + "/filenLogs/")

    await fs.copy(logsPath, savePath, {
        overwrite: true,
        recursive: true
    })

    return true
})

ipcMain.handle("updateTrayIcon", async (_, { type }) => {
    require("../tray").updateTrayIcon(type)

    return true
})

ipcMain.handle("updateTrayMenu", async (_, { type }) => {
    require("../tray").updateTrayMenu(type)

    return true
})

ipcMain.handle("updateTrayTooltip", async (_, { text }) => {
    require("../tray").updateTrayTooltip(text)

    return true
})

ipcMain.handle("getFileIcon", async (_, { path }) => {
    if(require("../memoryCache").has("fileIcon:" + path)){
        return require("../memoryCache").get("fileIcon:" + path)
    }

    const image = await app.getFileIcon(pathModule.normalize(path))
    const dataURL = image.toDataURL()

    require("../memoryCache").set("fileIcon:" + path, dataURL)

    return dataURL
})

ipcMain.handle("getFileIconExt", async (_, { ext }) => {
    if(require("../memoryCache").has("fileIconExt:" + ext)){
        return require("../memoryCache").get("fileIconExt:" + ext)
    }

    const tempPath = pathModule.normalize(pathModule.join(app.getPath("temp"), uuidv4() + (typeof ext == "string" && ext.length > 0 ? (ext.indexOf(".") == -1 ? "" : "." + ext) : "")))

    await fs.writeFile(tempPath, "")

    const image = await app.getFileIcon(tempPath)
    const dataURL = image.toDataURL()

    await fs.unlink(tempPath)

    require("../memoryCache").set("fileIconExt:" + ext, dataURL)

    return dataURL
})

ipcMain.handle("getFileIconName", async (_, { name }) => {
    if(require("../memoryCache").has("getFileIconName:" + name)){
        return require("../memoryCache").get("getFileIconName:" + name)
    }

    const tempPath = pathModule.normalize(pathModule.join(app.getPath("temp"), uuidv4() + "_" + name))

    await fs.writeFile(tempPath, "")

    const image = await app.getFileIcon(tempPath)
    const dataURL = image.toDataURL()

    await fs.unlink(tempPath)

    require("../memoryCache").set("getFileIconName:" + name, dataURL)

    return dataURL
})

ipcMain.handle("quitApp", async () => {
    app.exit(0)

    return true
})

ipcMain.handle("exitApp", async () => {
    app.exit(0)

    return true
})

ipcMain.handle("openDownloadWindow", async (_, { args }) => {
    await require("../windows").createDownload(args)

    return true
})

ipcMain.handle("openSelectiveSyncWindow", async (_, { args }) => {
    await require("../windows").createSelectiveSync(uuidv4(), args)

    return true
})

ipcMain.handle("updateKeybinds", async () => {
    return await updateKeybinds()
})

ipcMain.handle("disableKeybinds", async () => {
    globalShortcut.unregisterAll()

    return true
})

ipcMain.handle("openUploadWindow", async (_, { type }) => {
    require("../trayMenu").upload(type)

    return true
})

ipcMain.handle("installUpdate", async () => {
    await new Promise((resolve) => {
        setTimeout(() => {
            try{
                app.removeAllListeners("window-all-closed")

                const allWindows = BrowserWindow.getAllWindows()

                for(let i = 0; i < allWindows.length; i++){
                    allWindows[i].destroy()
                }

                autoUpdater.quitAndInstall(false, true)

                if(is.windows()){
                    setTimeout(() => app.exit(0), 1000)
                }

                return resolve(true)
            }
            catch(e){
                log.error(e)

                return resolve(true)
            }
        }, 1000)
    })

    return true
})

ipcMain.handle("trayAvailable", async () => {
    const trayAvailable = require("../shared").get("trayAvailable")

    if(typeof trayAvailable == "boolean"){
        return trayAvailable
    }

    return false
})

ipcMain.handle("initWatcher", async (_, { path, locationUUID }) => {
    await require("../watcher").watch(path, locationUUID)

    return false
})

ipcMain.handle("addSyncIssue", async (_, { syncIssue }) => {
    syncIssues.push(syncIssue)

    return true
})

ipcMain.handle("removeSyncIssue", async (_, { uuid }) => {
    syncIssues = syncIssues.filter(issue => issue.uuid !== uuid)

    return true
})

ipcMain.handle("getSyncIssues", async () => {
    return syncIssues
})

ipcMain.handle("clearSyncIssues", async () => {
    syncIssues = []

    return true
})

ipcMain.handle("fsNormalizePath", async (_, path) => {
    return require("../fs/local").normalizePath(path)
})

ipcMain.handle("fsGetTempDir", async () => {
    return require("../fs/local").getTempDir()
})

ipcMain.handle("fsGracefulLStat", async (_, path) => {
    return await require("../fs/local").gracefulLStat(path)
})

ipcMain.handle("fsExists", async (_, path) => {
    return await require("../fs/local").exists(path)
})

ipcMain.handle("fsDoesExistLocally", async (_, path) => {
    return await require("../fs/local").doesExistLocally(path)
})

ipcMain.handle("fsCanReadWriteAtPath", async (_, path) => {
    return await require("../fs/local").canReadWriteAtPath(path)
})

ipcMain.handle("fsSmokeTest", async (_, path) => {
    return await require("../fs/local").smokeTest(path)
})

ipcMain.handle("fsReadChunk", async (_, { path, offset, length }) => {
    return await require("../fs/local").readChunk(path, offset, length)
})

ipcMain.handle("fsRm", async (_, { path, location }) => {
    return await require("../fs/local").rm(path, location)
})

ipcMain.handle("fsRmPermanent", async (_, path) => {
    return await require("../fs/local").rmPermanent(path)
})

ipcMain.handle("fsMkdir", async (_, { path, location }) => {
    return await require("../fs/local").mkdir(path, location)
})

ipcMain.handle("fsMove", async (_, { before, after, overwrite }) => {
    return await require("../fs/local").move(before, after, overwrite)
})

ipcMain.handle("fsRename", async (_, { before, after }) => {
    return await require("../fs/local").rename(before, after)
})

ipcMain.handle("fsCreateLocalTrashDirs", async () => {
    return await require("../fs/local").createLocalTrashDirs()
})

ipcMain.handle("fsClearLocalTrashDirs", async (_, clearNow) => {
    return await require("../fs/local").clearLocalTrashDirs(clearNow)
})

ipcMain.handle("fsInitLocalTrashDirs", async (_, interval) => {
    require("../fs/local").initLocalTrashDirs(interval)

    return true
})

ipcMain.handle("fsCheckLastModified", async (_, path) => {
    return await require("../fs/local").checkLastModified(path)
})

ipcMain.handle("fsCanReadAtPath", async (_, path) => {
    return await require("../fs/local").canReadAtPath(path)
})

ipcMain.handle("fsIsFileBusy", async (_, path) => {
    return await require("../fs/local").isFileBusy(path)
})

ipcMain.handle("fsDirectoryTree", async (_, { path, skipCache, location }) => {
    return await require("../fs/local").directoryTree(path, skipCache, location)
})

ipcMain.handle("fsUnlink", async (_, path) => {
    return await require("../fs/local").unlink(path)
})

ipcMain.handle("fsUtimes", async (_, { path, atime, mtime }) => {
    return await require("../fs/local").utimes(path, atime, mtime)
})

ipcMain.handle("fsRemove", async (_, path) => {
    return await require("../fs/local").remove(path)
})

ipcMain.handle("fsMkdirNormal", async (_, { path, options }) => {
    return await require("../fs/local").mkdirNormal(path, options)
})

ipcMain.handle("fsAccess", async (_, { path, mode }) => {
    return await require("../fs/local").access(path, mode)
})

ipcMain.handle("fsAppendFile", async (_, { path, data, options }) => {
    return await require("../fs/local").appendFile(path, data, options)
})

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

const addSyncIssue = (issue) => {
    syncIssues.push(issue)
}

module.exports = {
    listen,
    emitGlobal,
    updateKeybinds,
    addSyncIssue
}