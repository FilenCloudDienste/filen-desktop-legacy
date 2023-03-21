import { ipcMain, dialog, app, globalShortcut, BrowserWindow } from "electron"
import log from "electron-log"
import fs from "fs-extra"
import pathModule from "path"
import { v4 as uuidv4 } from "uuid"
import AutoLaunch from "auto-launch"
import { autoUpdater } from "electron-updater"
import is from "electron-is"
import db from "../db"
import { SyncIssue } from "../../../types"
import memoryCache from "../memoryCache"
import { createMain, createSettings, createCloud, createDownload, createSelectiveSync } from "../windows"
import { updateTrayIcon, updateTrayMenu, updateTrayTooltip } from "../tray"
import { upload } from "../trayMenu"
import * as fsLocal from "../fs/local"
import { watch } from "../watcher"

const autoLauncher = new AutoLaunch({
    name: "Filen",
    path: app.getPath("exe"),
})

let syncIssues: SyncIssue[] = []

ipcMain.handle("db", async (_, { action, key, value }) => {
    if(action == "get"){
        return await db.get(key)
    }
    else if(action == "set"){
        await db.set(key, value)
    }
    else if(action == "remove"){
        await db.remove(key)
    }
    else if(action == "clear"){
        await db.clear()
    }
    else if(action == "keys"){
        return db.keys()
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
    if(!memoryCache.has("AUTH_WINDOW")){
        return
    }

    try{
        memoryCache.get("AUTH_WINDOW").close()
    }
    catch(e){
        log.error(e)
    }
})

ipcMain.handle("createMainWindow", async () => {
    if(memoryCache.has("MAIN_WINDOW")){
        return
    }

    await createMain(true)
})

ipcMain.handle("loginDone", async () => {
    if(memoryCache.has("MAIN_WINDOW")){
        try{
            memoryCache.get("MAIN_WINDOW").close()
        }
        catch(e){
           log.error(e)
        }
    }

    await createMain(true)

    if(memoryCache.has("AUTH_WINDOW")){
        try{
            memoryCache.get("AUTH_WINDOW").close()
        }
        catch(e){
           log.error(e)
        }
    }

    return true
})

ipcMain.handle("openSettingsWindow", async (_, { page }) => {
    await createSettings(page)
})

ipcMain.handle("selectFolder", async () => {
    let selectWindow = BrowserWindow.getFocusedWindow()

    if(!selectWindow){
        selectWindow = memoryCache.get("WORKER_WINDOW")

        if(!selectWindow){
            selectWindow = memoryCache.get("MAIN_WINDOW")
        }
    }

    if(!selectWindow){
        return
    }

    return await dialog.showOpenDialog(selectWindow, {
        properties: ["openDirectory"]
    })
})

ipcMain.handle("selectRemoteFolder", async () => {
    const window = await createCloud("selectFolder")
    const windowId = window.id

    return await new Promise((resolve, reject) => {
        const listener = (_: any, data: any) => {
            if(parseInt(data.windowId) !== windowId){
                return
            }

            window.close()

            ipcMain.removeListener("remoteFolderSelected", listener)

            resolve(data)
        }

        ipcMain.on("remoteFolderSelected", listener)

        window.once("closed", () => resolve({
            canceled: true
        }))
    })
})

ipcMain.handle("restartApp", async () => {
    app.relaunch()
    app.exit()
})

ipcMain.handle("minimizeWindow", async (_, { window, windowId }) => {
    if(window == "settings"){
        const windows = memoryCache.get("SETTINGS_WINDOWS")

        if(windows){
            for(const prop in windows){
                if(parseInt(windowId) == windows[prop].id){
                    windows[prop].minimize()
                }
            }
        }
    }
    else if(window == "auth"){
        try{
            memoryCache.get("AUTH_WINDOW").minimize()
        }
        catch(e){
            log.error(e)
        }
    }
    else if(window == "cloud"){
        const windows = memoryCache.get("CLOUD_WINDOWS")

        if(windows){
            for(const prop in windows){
                if(parseInt(windowId) == windows[prop].id){
                    windows[prop].minimize()
                }
            }
        }
    }
    else if(window == "download"){
        const windows = memoryCache.get("DOWNLOAD_WINDOWS")

        if(windows){
            for(const prop in windows){
                if(parseInt(windowId) == windows[prop].id){
                    windows[prop].minimize()
                }
            }
        }
    }
    else if(window == "upload"){
        const windows = memoryCache.get("UPLOAD_WINDOWS")

        if(windows){
            for(const prop in windows){
                if(parseInt(windowId) == windows[prop].id){
                    windows[prop].minimize()
                }
            }
        }
    }
    else if(window == "selectiveSync"){
        const windows = memoryCache.get("SELECTIVE_SYNC_WINDOWS")

        if(windows){
            for(const prop in windows){
                if(parseInt(windowId) == windows[prop].id){
                    windows[prop].minimize()
                }
            }
        }
    }
    else if(window == "main"){
        try{
            memoryCache.get("MAIN_WINDOW").minimize()
        }
        catch(e){
            log.error(e)
        }
    }
    else if(window == "update"){
        try{
            memoryCache.get("UPDATE_WINDOW").minimize()
        }
        catch(e){
            log.error(e)
        }
    }

    return true
})

ipcMain.handle("closeWindow", async (_, { window, windowId }) => {
    if(window == "settings"){
        const windows = memoryCache.get("SETTINGS_WINDOWS")

        if(windows){
            for(const prop in windows){
                if(parseInt(windowId) == windows[prop].id){
                    windows[prop].close()
                }
            }
        }
    }
    else if(window == "auth"){
        app.quit()
    }
    else if(window == "cloud"){
        const windows = memoryCache.get("CLOUD_WINDOWS")

        if(windows){
            for(const prop in windows){
                if(parseInt(windowId) == windows[prop].id){
                    windows[prop].close()
                }
            }
        }
    }
    else if(window == "download"){
        const windows = memoryCache.get("DOWNLOAD_WINDOWS")

        if(windows){
            for(const prop in windows){
                if(parseInt(windowId) == windows[prop].id){
                    windows[prop].close()
                }
            }
        }
    }
    else if(window == "upload"){
        const windows = memoryCache.get("UPLOAD_WINDOWS")

        if(windows){
            for(const prop in windows){
                if(parseInt(windowId) == windows[prop].id){
                    windows[prop].close()
                }
            }
        }
    }
    else if(window == "selectiveSync"){
        const windows = memoryCache.get("SELECTIVE_SYNC_WINDOWS")

        if(windows){
            for(const prop in windows){
                if(parseInt(windowId) == windows[prop].id){
                    windows[prop].close()
                }
            }
        }
    }
    else if(window == "main"){
        try{
            memoryCache.get("MAIN_WINDOW").minimize()
        }
        catch(e){
            log.error(e)
        }
    }
    else if(window == "update"){
        try{
            memoryCache.get("UPDATE_WINDOW").close()
        }
        catch(e){
            log.error(e)
        }
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
        selectWindow = memoryCache.get("WORKER_WINDOW")

        if(selectWindow){
            selectWindow = memoryCache.get("MAIN_WINDOW")
        }
    }

    if(!selectWindow){
        return
    }

    const result = await dialog.showOpenDialog(selectWindow, {
        properties: ["openDirectory"]
    })

    if(result.canceled){
        return
    }

    const paths = result.filePaths

    if(!Array.isArray(paths)){
        return
    }

    const localPath = paths[0]

    if(typeof localPath !== "string"){
        return
    }

    const logsPath = pathModule.normalize(pathModule.join(log.transports.file.getFile().path, "../"))
    const savePath = pathModule.normalize(localPath + "/filenLogs/")

    await fs.copy(logsPath, savePath, {
        overwrite: true,
        recursive: true
    })
})

ipcMain.handle("updateTrayIcon", async (_, { type }) => {
    updateTrayIcon(type)

    return true
})

ipcMain.handle("updateTrayMenu", async () => {
    updateTrayMenu()

    return true
})

ipcMain.handle("updateTrayTooltip", async (_, { text }) => {
    updateTrayTooltip(text)

    return true
})

ipcMain.handle("getFileIcon", async (_, { path }) => {
    if(memoryCache.has("fileIcon:" + path)){
        return memoryCache.get("fileIcon:" + path)
    }

    const image = await app.getFileIcon(pathModule.normalize(path))
    const dataURL = image.toDataURL()

    memoryCache.set("fileIcon:" + path, dataURL)

    return dataURL
})

ipcMain.handle("getFileIconExt", async (_, { ext }) => {
    if(memoryCache.has("fileIconExt:" + ext)){
        return memoryCache.get("fileIconExt:" + ext)
    }

    const tempPath = pathModule.normalize(pathModule.join(app.getPath("temp"), uuidv4() + (typeof ext == "string" && ext.length > 0 ? (ext.indexOf(".") == -1 ? "" : "." + ext) : "")))

    await fs.writeFile(tempPath, "")

    const image = await app.getFileIcon(tempPath)
    const dataURL = image.toDataURL()

    await fs.unlink(tempPath)

    memoryCache.set("fileIconExt:" + ext, dataURL)

    return dataURL
})

ipcMain.handle("getFileIconName", async (_, { name }) => {
    if(memoryCache.has("getFileIconName:" + name)){
        return memoryCache.get("getFileIconName:" + name)
    }

    const tempPath = pathModule.normalize(pathModule.join(app.getPath("temp"), uuidv4() + "_" + name))

    await fs.writeFile(tempPath, "")

    const image = await app.getFileIcon(tempPath)
    const dataURL = image.toDataURL()

    await fs.unlink(tempPath)

    memoryCache.set("getFileIconName:" + name, dataURL)

    return dataURL
})

ipcMain.handle("quitApp", async () => {
    app.exit(0)
})

ipcMain.handle("exitApp", async () => {
    app.exit(0)
})

ipcMain.handle("openDownloadWindow", async (_, { args }) => {
    await createDownload(args)
})

ipcMain.handle("openSelectiveSyncWindow", async (_, { args }) => {
    await createSelectiveSync(args)
})

ipcMain.handle("updateKeybinds", async () => {
    return await updateKeybinds()
})

ipcMain.handle("disableKeybinds", async () => {
    globalShortcut.unregisterAll()
})

ipcMain.handle("openUploadWindow", async (_, { type }) => {
    upload(type)
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
    const trayAvailable = memoryCache.get("trayAvailable")

    if(typeof trayAvailable == "boolean"){
        return trayAvailable
    }

    return false
})

ipcMain.handle("initWatcher", async (_, { path, locationUUID }) => {
    await watch(path, locationUUID)
})

ipcMain.handle("addSyncIssue", async (_, { syncIssue }) => {
    syncIssues.push(syncIssue)
})

ipcMain.handle("removeSyncIssue", async (_, { uuid }) => {
    syncIssues = syncIssues.filter(issue => issue.uuid !== uuid)
})

ipcMain.handle("getSyncIssues", async () => {
    return syncIssues
})

ipcMain.handle("clearSyncIssues", async () => {
    syncIssues = []
})

ipcMain.handle("fsNormalizePath", async (_, path) => {
    return fsLocal.normalizePath(path)
})

ipcMain.handle("fsGetTempDir", async () => {
    return fsLocal.getTempDir()
})

ipcMain.handle("fsGracefulLStat", async (_, path) => {
    return await fsLocal.gracefulLStat(path)
})

ipcMain.handle("fsExists", async (_, path) => {
    return await fsLocal.exists(path)
})

ipcMain.handle("fsDoesExistLocally", async (_, path) => {
    return await fsLocal.doesExistLocally(path)
})

ipcMain.handle("fsCanReadWriteAtPath", async (_, path) => {
    return await fsLocal.canReadWriteAtPath(path)
})

ipcMain.handle("fsSmokeTest", async (_, path) => {
    return await fsLocal.smokeTest(path)
})

ipcMain.handle("fsReadChunk", async (_, { path, offset, length }) => {
    return await fsLocal.readChunk(path, offset, length)
})

ipcMain.handle("fsRm", async (_, { path, location }) => {
    return await fsLocal.rm(path, location)
})

ipcMain.handle("fsRmPermanent", async (_, path) => {
    return await fsLocal.rmPermanent(path)
})

ipcMain.handle("fsMkdir", async (_, { path, location }) => {
    return await fsLocal.mkdir(path, location)
})

ipcMain.handle("fsMove", async (_, { before, after, overwrite }) => {
    return await fsLocal.move(before, after, overwrite)
})

ipcMain.handle("fsRename", async (_, { before, after }) => {
    return await fsLocal.rename(before, after)
})

ipcMain.handle("fsCreateLocalTrashDirs", async () => {
    return await fsLocal.createLocalTrashDirs()
})

ipcMain.handle("fsClearLocalTrashDirs", async (_, clearNow) => {
    return await fsLocal.clearLocalTrashDirs(clearNow)
})

ipcMain.handle("fsInitLocalTrashDirs", async () => {
    fsLocal.initLocalTrashDirs()
})

ipcMain.handle("fsCheckLastModified", async (_, path) => {
    return await fsLocal.checkLastModified(path)
})

ipcMain.handle("fsCanReadAtPath", async (_, path) => {
    return await fsLocal.canReadAtPath(path)
})

ipcMain.handle("fsIsFileBusy", async (_, path) => {
    return await fsLocal.isFileBusy(path)
})

ipcMain.handle("fsDirectoryTree", async (_, { path, skipCache, location }) => {
    return await fsLocal.directoryTree(path, skipCache, location)
})

ipcMain.handle("fsUnlink", async (_, path) => {
    return await fsLocal.unlink(path)
})

ipcMain.handle("fsUtimes", async (_, { path, atime, mtime }) => {
    return await fsLocal.utimes(path, atime, mtime)
})

ipcMain.handle("fsRemove", async (_, path) => {
    return await fsLocal.remove(path)
})

ipcMain.handle("fsMkdirNormal", async (_, { path, options }) => {
    return await fsLocal.mkdirNormal(path, options)
})

ipcMain.handle("fsAccess", async (_, { path, mode }) => {
    return await fsLocal.access(path, mode)
})

ipcMain.handle("fsAppendFile", async (_, { path, data, options }) => {
    return await fsLocal.appendFile(path, data, options)
})

export const updateKeybinds = () => {
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
                            upload("folders")
                        }
                        else if(keybinds[i].type == "uploadFiles"){
                            upload("files")
                        }
                        else if(keybinds[i].type == "openSettings"){
                            createSettings().catch(log.error)
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

export const emitGlobal = (channel: string = "global-message", data: any) => {
    try{
        if(memoryCache.has("MAIN_WINDOW")){
           memoryCache.get("MAIN_WINDOW").webContents.send(channel, data)
        }
    
        if(memoryCache.has("WORKER_WINDOW")){
            memoryCache.get("WORKER_WINDOW").webContents.send(channel, data)
        }
    
        if(memoryCache.has("AUTH_WINDOW")){
            memoryCache.get("AUTH_WINDOW").webContents.send(channel, data)
        }

        if(memoryCache.has("UPDATE_WINDOW")){
            memoryCache.get("UPDATE_WINDOW").webContents.send(channel, data)
        }
    
        const settingsWindows = memoryCache.get("SETTINGS_WINDOWS")

        if(settingsWindows){
            for(const id in settingsWindows){
                settingsWindows[id].webContents.send(channel, data)
            }
        }

        const downloadWindows = memoryCache.get("DOWNLOAD_WINDOWS")

        if(downloadWindows){
            for(const id in downloadWindows){
                downloadWindows[id].webContents.send(channel, data)
            }
        }

        const cloudWindows = memoryCache.get("CLOUD_WINDOWS")

        if(cloudWindows){
            for(const id in cloudWindows){
                cloudWindows[id].webContents.send(channel, data)
            }
        }

        const uploadWindows = memoryCache.get("UPLOAD_WINDOWS")

        if(uploadWindows){
            for(const id in uploadWindows){
                uploadWindows[id].webContents.send(channel, data)
            }
        }

        const selectiveSyncWindows = memoryCache.get("SELECTIVE_SYNC_WINDOWS")

        if(selectiveSyncWindows){
            for(const id in selectiveSyncWindows){
                selectiveSyncWindows[id].webContents.send(channel, data)
            }
        }
    }
    catch(e){
        log.error(e)
    }
}

export const listen = async () => {
    ipcMain.on("proxy-global-message", (_, data) => {
        emitGlobal("global-message", data)
    })

    ipcMain.on("proxy-from-worker", (_, data) => {
        emitGlobal("from-worker", data)
    })

    ipcMain.on("proxy-for-worker", (_, data) => {
        emitGlobal("for-worker", data)
    })
}

export const addSyncIssue = (issue: SyncIssue) => {
    syncIssues.push(issue)
}