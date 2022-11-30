const { BrowserWindow, app, nativeImage, ipcMain } = require("electron")
const path = require("path")
const is = require("electron-is")
const log = require("electron-log")
const { v4: uuidv4 } = require("uuid")
const { Base64 } = require("js-base64")

const STATIC_PATH = is.dev() ? "http://localhost:3000/" : "file://" + path.join(__dirname, "../../../../build/index.html")
const DEV_TOOLS = is.dev() ? true : false
let activeWindows = []

const wasOpenedAtSystemStart = () => {
    try{
        if(is.macOS()){
            const loginSettings = app.getLoginItemSettings()

            return loginSettings.wasOpenedAtLogin
        }

        return app.commandLine.hasSwitch("hidden")
    }
    catch(e){
        log.error(e)

        return false
    }
}

const createMain = (show = false) => {
    return new Promise(async (resolve, reject) => {
        try{
            if(is.linux()){
                show = true
            }

            if(wasOpenedAtSystemStart()){
                show = false
            }

            if(typeof require("../shared").get("MAIN_WINDOW") !== "undefined"){
                try{
                    require("../shared").get("MAIN_WINDOW").close()
                }
                catch(e){
                    log.error(e)
                }
            }

            const windowId = uuidv4()

            const window = new BrowserWindow({
                width: 370,
                height: 550,
                webPreferences: {
                    nodeIntegration: true,
                    backgroundThrottling: false,
                    contextIsolation: false
                },
                frame: false,
				transparent: true,
                resizable: false,
                titleBarStyle: is.macOS() ? "default" : "hidden",
                skipTaskbar: (is.macOS() || is.windows()) ? true : false,
                fullscreenable: false,
                maximizable: false,
                minimizable: true,
                hasShadow: false,
                show: is.linux() ? true : false,
                backgroundColor: "rgba(0, 0, 0, 0)",
                ...(
                    (is.linux() && !is.dev()) ? { icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png")) }
                    : (is.windows() && !is.dev()) ? { icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico") }
                    : { icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns") }
                )
            })

            window.windowId = windowId

            window.setResizable(false)
            window.setMenu(null)
            
            if((is.macOS() || is.windows())){
                window.setAlwaysOnTop(true, "screen")
                window.setMenuBarVisibility(false)
            }

            const windowTray = require("../tray").createTray()

            window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "#main")

            if(DEV_TOOLS){
                window.webContents.openDevTools({ mode: "detach" })
            }

            window.on("close", (e) => {
                e.preventDefault()
                
                window.hide()
            })

			window.once("closed", () => {
				require("../shared").remove("MAIN_WINDOW")

                activeWindows = activeWindows.filter(window => window.id !== windowId)
			})

			window.once("show", () => {
                require("../tray").positionWindowAtTray(window, windowTray)
                
                setTimeout(() => {
                    window.on("blur", () => {
                        if(is.linux()){
                            return false
                        }
        
                        try{
                            window.hide()
                        }
                        catch(e){
                            log.error(e)
                        }
                    })
                }, 1000)

                setTimeout(() => window.focus(), 250)
            })

            ipcMain.once("window-ready", (_, id) => {
                require("../tray").positionWindowAtTray(window, windowTray)

                if(id == windowId && show){
                    window.show()
                }
            })

            require("../shared").set("MAIN_WINDOW", window)
            
            activeWindows.push({ id: windowId, type: "MAIN_WINDOW" })

            require("../tray").positionWindowAtTray(window, windowTray)

            return resolve(window)
        }
        catch(e){
            return reject(e)
        }
    })
}

const createSettings = (page = "general", windowId = uuidv4()) => {
    return new Promise(async (resolve, reject) => {
        try{
            const currentSettingsWindows = require("../shared").get("SETTINGS_WINDOWS")

            for(const id in currentSettingsWindows){
                if(id !== windowId){
                    currentSettingsWindows[id].close()
                }
            }

            const window = new BrowserWindow({
                width: 700,
                height: 600,
                webPreferences: {
                    nodeIntegration: true,
                    backgroundThrottling: false,
                    contextIsolation: false
                },
                frame: false,
                transparent: true,
                titleBarStyle: is.macOS() ? "hidden" : "default",
                titleBarOverlay: true,
                resizable: false,
                skipTaskbar: false,
                fullscreenable: false,
                maximizable: false,
                minimizable: true,
                hasShadow: false,
                title: "Settings",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)",
                ...(
                    (is.linux() && !is.dev()) ? { icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png")) }
                    : (is.windows() && !is.dev()) ? { icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico") }
                    : { icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns") }
                )
            })

            window.windowId = windowId

            window.loadURL(STATIC_PATH + "?page=" + page + "&id=" + encodeURIComponent(windowId) + "#settings")

            if(DEV_TOOLS){
                window.webContents.openDevTools({ mode: "detach" })
            }

			window.once("closed", () => {
				const settingsWindows = require("../shared").get("SETTINGS_WINDOWS")

                if(typeof settingsWindows == "object"){
                    for(const id in settingsWindows){
                        if(id == windowId){
                            delete settingsWindows[id]
                        }
                    }

                    require("../shared").set("SETTINGS_WINDOWS", settingsWindows)
                }

                activeWindows = activeWindows.filter(window => window.id !== windowId)

                if(is.macOS()){
                    const active = JSON.stringify(activeWindows.map(window => window.type))

                    if(
                        JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active
                        || JSON.stringify(["MAIN_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW"]) == active
                    ){
                        app.dock.hide()
                    }
                }
			})

			window.once("show", () => setTimeout(() => window.focus(), 250))
            
            ipcMain.once("window-ready", (_, id) => {
                if(id == windowId){
                    window.show()
                }
            })

            if(is.macOS()){
                window.once("show", () => {
                    app.dock.show().catch(log.error)
                })
            }

            let settingsWindows = require("../shared").get("SETTINGS_WINDOWS")

            if(typeof settingsWindows == "object"){
                settingsWindows[windowId] = window
            }
            else{
                settingsWindows = {}
                settingsWindows[windowId] = window
            }

            require("../shared").set("SETTINGS_WINDOWS", settingsWindows)
            activeWindows.push({ id: windowId, type: "SETTINGS_WINDOWS" })

            return resolve(window)
        }
        catch(e){
            return reject(e)
        }
    })
}

const createUpload = (args = {}, windowId = uuidv4()) => {
    return new Promise(async (resolve, reject) => {
        try{
            const window = new BrowserWindow({
                width: 500,
                height: 400,
                webPreferences: {
                    nodeIntegration: true,
                    backgroundThrottling: false,
                    contextIsolation: false
                },
                frame: false,
                transparent: true,
                titleBarStyle: is.macOS() ? "hidden" : "default",
                titleBarOverlay: true,
                resizable: false,
                skipTaskbar: false,
                fullscreenable: false,
                maximizable: false,
                minimizable: true,
                hasShadow: false,
                title: "Upload",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)",
                ...(
                    (is.linux() && !is.dev()) ? { icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png")) }
                    : (is.windows() && !is.dev()) ? { icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico") }
                    : { icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns") }
                )
            })

            window.windowId = windowId

            window.loadURL(STATIC_PATH + "?args=" + encodeURIComponent(Base64.encode(JSON.stringify(args))) + "&id=" + encodeURIComponent(windowId) + "#upload")

            if(DEV_TOOLS){
                window.webContents.openDevTools({ mode: "detach" })
            }

            window.once("closed", () => {
				const currentUploadWindows = require("../shared").get("UPLOAD_WINDOWS")

                if(typeof currentUploadWindows == "object"){
                    for(const id in currentUploadWindows){
                        if(id == windowId){
                            delete currentUploadWindows[id]
                        }
                    }

                    require("../shared").set("UPLOAD_WINDOWS", currentUploadWindows)
                }

                activeWindows = activeWindows.filter(window => window.id !== windowId)

                if(is.macOS()){
                    const active = JSON.stringify(activeWindows.map(window => window.type))

                    if(
                        JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active
                        || JSON.stringify(["MAIN_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW"]) == active
                    ){
                        app.dock.hide()
                    }
                }
			})

			window.once("show", () => setTimeout(() => window.focus(), 250))
            
            ipcMain.once("window-ready", (_, id) => {
                if(id == windowId){
                    window.show()
                }
            })

            if(is.macOS()){
                window.once("show", () => {
                    app.dock.show().catch(log.error)
                })
            }

            let uploadWindows = require("../shared").get("UPLOAD_WINDOWS")

            if(typeof uploadWindows == "object"){
                uploadWindows[windowId] = window
            }
            else{
                uploadWindows = {}
                uploadWindows[windowId] = window
            }

            require("../shared").set("UPLOAD_WINDOWS", uploadWindows)
            activeWindows.push({ id: windowId, type: "UPLOAD_WINDOWS" })

            return resolve(window)
        }
        catch(e){
            return reject(e)
        }
    })
}

const createDownload = (args = {}, windowId = uuidv4()) => {
    return new Promise(async (resolve, reject) => {
        try{
            const window = new BrowserWindow({
                width: 500,
                height: 400,
                webPreferences: {
                    nodeIntegration: true,
                    backgroundThrottling: false,
                    contextIsolation: false
                },
                frame: false,
                transparent: true,
                titleBarStyle: is.macOS() ? "hidden" : "default",
                titleBarOverlay: true,
                resizable: false,
                skipTaskbar: false,
                fullscreenable: false,
                maximizable: false,
                minimizable: true,
                hasShadow: false,
                title: "Download",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)",
                ...(
                    (is.linux() && !is.dev()) ? { icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png")) }
                    : (is.windows() && !is.dev()) ? { icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico") }
                    : { icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns") }
                )
            })

            window.windowId = windowId

            window.loadURL(STATIC_PATH + "?args=" + encodeURIComponent(Base64.encode(JSON.stringify(args))) + "&id=" + encodeURIComponent(windowId) + "#download")

            if(DEV_TOOLS){
                window.webContents.openDevTools({ mode: "detach" })
            }

            window.once("closed", () => {
				const currentDownloadWindows = require("../shared").get("DOWNLOAD_WINDOWS")

                if(typeof currentDownloadWindows == "object"){
                    for(const id in currentDownloadWindows){
                        if(id == windowId){
                            delete currentDownloadWindows[id]
                        }
                    }

                    require("../shared").set("DOWNLOAD_WINDOWS", currentDownloadWindows)
                }

                activeWindows = activeWindows.filter(window => window.id !== windowId)

                if(is.macOS()){
                    const active = JSON.stringify(activeWindows.map(window => window.type))

                    if(
                        JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active
                        || JSON.stringify(["MAIN_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW"]) == active
                    ){
                        app.dock.hide()
                    }
                }
			})

			window.once("show", () => setTimeout(() => window.focus(), 250))
            
            ipcMain.once("window-ready", (_, id) => {
                if(id == windowId){
                    window.show()
                }
            })

            if(is.macOS()){
                window.once("show", () => {
                    app.dock.show().catch(log.error)
                })
            }

            let downloadWindows = require("../shared").get("DOWNLOAD_WINDOWS")

            if(typeof downloadWindows == "object"){
                downloadWindows[windowId] = window
            }
            else{
                downloadWindows = {}
                downloadWindows[windowId] = window
            }

            require("../shared").set("DOWNLOAD_WINDOWS", downloadWindows)
            activeWindows.push({ id: windowId, type: "DOWNLOAD_WINDOWS" })

            return resolve(window)
        }
        catch(e){
            return reject(e)
        }
    })
}

const createCloud = (windowId = uuidv4(), mode = "selectFolder") => {
    return new Promise(async (resolve, reject) => {
        try{
            const window = new BrowserWindow({
                width: 700,
                height: 600,
                webPreferences: {
                    nodeIntegration: true,
                    backgroundThrottling: false,
                    contextIsolation: false
                },
                frame: false,
                transparent: true,
                titleBarStyle: is.macOS() ? "hidden" : "default",
                resizable: false,
                skipTaskbar: false,
                fullscreenable: false,
                maximizable: false,
                minimizable: true,
                hasShadow: false,
                title: "Cloud",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)",
                ...(
                    (is.linux() && !is.dev()) ? { icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png")) }
                    : (is.windows() && !is.dev()) ? { icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico") }
                    : { icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns") }
                )
            })

            window.windowId = windowId

            window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "&mode=" + mode + "#cloud")

            if(DEV_TOOLS){
                window.webContents.openDevTools({ mode: "detach" })
            }

			window.once("closed", () => {
				const cloudWindows = require("../shared").get("CLOUD_WINDOWS")

                if(typeof cloudWindows == "object"){
                    for(const id in cloudWindows){
                        if(id == windowId){
                            delete cloudWindows[id]
                        }
                    }

                    require("../shared").set("CLOUD_WINDOWS", cloudWindows)
                }

                activeWindows = activeWindows.filter(window => window.id !== windowId)

                if(is.macOS()){
                    const active = JSON.stringify(activeWindows.map(window => window.type))

                    if(
                        JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active
                        || JSON.stringify(["MAIN_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW"]) == active
                    ){
                        app.dock.hide()
                    }
                }
			})

			window.once("show", () => setTimeout(() => window.focus(), 250))
            
            ipcMain.once("window-ready", (_, id) => {
                if(id == windowId){
                    window.show()
                }
            })

            if(is.macOS()){
                window.once("show", () => {
                    app.dock.show().catch(log.error)
                })
            }

            let cloudWindows = require("../shared").get("CLOUD_WINDOWS")

            if(typeof cloudWindows == "object"){
                cloudWindows[windowId] = window
            }
            else{
                cloudWindows = {}
                cloudWindows[windowId] = window
            }

            require("../shared").set("CLOUD_WINDOWS", cloudWindows)
            activeWindows.push({ id: windowId, type: "CLOUD_WINDOWS" })

            return resolve(window)
        }
        catch(e){
            return reject(e)
        }
    })
}

const createSelectiveSync = (windowId = uuidv4(), args = {}) => {
    return new Promise(async (resolve, reject) => {
        try{
            const window = new BrowserWindow({
                width: 700,
                height: 600,
                webPreferences: {
                    nodeIntegration: true,
                    backgroundThrottling: false,
                    contextIsolation: false
                },
                frame: false,
                transparent: true,
                titleBarStyle: is.macOS() ? "hidden" : "default",
                resizable: false,
                skipTaskbar: false,
                fullscreenable: false,
                maximizable: false,
                minimizable: true,
                hasShadow: false,
                title: "Selective sync",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)",
                ...(
                    (is.linux() && !is.dev()) ? { icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png")) }
                    : (is.windows() && !is.dev()) ? { icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico") }
                    : { icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns") }
                )
            })

            window.windowId = windowId

            window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "&args=" + encodeURIComponent(Base64.encode(JSON.stringify(args))) + "#selectiveSync")

            if(DEV_TOOLS){
                window.webContents.openDevTools({ mode: "detach" })
            }

			window.once("closed", () => {
				const selectiveSyncWindows = require("../shared").get("SELECTIVE_SYNC_WINDOWS")

                if(typeof selectiveSyncWindows == "object"){
                    for(const id in selectiveSyncWindows){
                        if(id == windowId){
                            delete selectiveSyncWindows[id]
                        }
                    }

                    require("../shared").set("SELECTIVE_SYNC_WINDOWS", selectiveSyncWindows)
                }

                activeWindows = activeWindows.filter(window => window.id !== windowId)

                if(is.macOS()){
                    const active = JSON.stringify(activeWindows.map(window => window.type))

                    if(
                        JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active
                        || JSON.stringify(["MAIN_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW"]) == active
                    ){
                        app.dock.hide()
                    }
                }
			})

			window.once("show", () => setTimeout(() => window.focus(), 250))
            
            ipcMain.once("window-ready", (_, id) => {
                if(id == windowId){
                    window.show()
                }
            })

            if(is.macOS()){
                window.once("show", () => {
                    app.dock.show().catch(log.error)
                })
            }

            let selectiveSyncWindows = require("../shared").get("SELECTIVE_SYNC_WINDOWS")

            if(typeof selectiveSyncWindows == "object"){
                selectiveSyncWindows[windowId] = window
            }
            else{
                selectiveSyncWindows = {}
                selectiveSyncWindows[windowId] = window
            }

            require("../shared").set("SELECTIVE_SYNC_WINDOWS", selectiveSyncWindows)
            activeWindows.push({ id: windowId, type: "SELECTIVE_SYNC_WINDOWS" })

            return resolve(window)
        }
        catch(e){
            return reject(e)
        }
    })
}

const createAuth = () => {
    return new Promise(async (resolve, reject) => {
        try{
            if(typeof require("../shared").get("AUTH_WINDOW") !== "undefined"){
                try{
                    require("../shared").get("AUTH_WINDOW").close()
                }
                catch(e){
                    log.error(e)
                }
            }

            const windowId = uuidv4()

            const window = new BrowserWindow({
                width: 350,
                height: 500,
                webPreferences: {
                    nodeIntegration: true,
                    backgroundThrottling: false,
                    contextIsolation: false
                },
                frame: false,
                transparent: true,
                titleBarStyle: "hidden",
                resizable: false,
                skipTaskbar: false,
                fullscreenable: false,
                maximizable: false,
                minimizable: true,
                hasShadow: false,
                title: "Login",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)",
                ...(
                    (is.linux() && !is.dev()) ? { icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png")) }
                    : (is.windows() && !is.dev()) ? { icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico") }
                    : { icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns") }
                )
            })

            window.windowId = windowId

            window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "#auth")

            if(DEV_TOOLS){
                window.webContents.openDevTools({ mode: "detach" })
            }

			window.once("closed", () => {
				require("../shared").remove("AUTH_WINDOW")

                setTimeout(() => {
                    if(typeof require("../shared").get("MAIN_WINDOW") == "undefined"){
                        app.quit()
                    }
                }, 3000)

                activeWindows = activeWindows.filter(window => window.id !== windowId)

                if(is.macOS()){
                    const active = JSON.stringify(activeWindows.map(window => window.type))

                    if(
                        JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active
                        || JSON.stringify(["MAIN_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW"]) == active
                    ){
                        app.dock.hide()
                    }
                }
			})

			window.once("show", () => setTimeout(() => window.focus(), 250))
            
            ipcMain.once("window-ready", (_, id) => {
                if(id == windowId){
                    window.show()
                }
            })

            if(is.macOS()){
                window.once("show", () => {
                    app.dock.show().catch(log.error)
                })
            }

            require("../shared").set("AUTH_WINDOW", window)
            activeWindows.push({ id: windowId, type: "AUTH_WINDOW" })

            return resolve(window)
        }
        catch(e){
            return reject(e)
        }
    })
}

const createUpdate = (windowId = uuidv4(), toVersion = "1") => {
    return new Promise(async (resolve, reject) => {
        try{
            if(typeof require("../shared").get("UPDATE_WINDOW") !== "undefined"){
                require("../shared").get("UPDATE_WINDOW").close()
            }

            const window = new BrowserWindow({
                width: 500,
                height: 400,
                webPreferences: {
                    nodeIntegration: true,
                    backgroundThrottling: false,
                    contextIsolation: false
                },
                frame: false,
                transparent: true,
                titleBarStyle: is.macOS() ? "hidden" : "default",
                titleBarOverlay: true,
                resizable: false,
                skipTaskbar: false,
                fullscreenable: false,
                maximizable: false,
                minimizable: true,
                hasShadow: false,
                title: "Download",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)",
                ...(
                    (is.linux() && !is.dev()) ? { icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png")) }
                    : (is.windows() && !is.dev()) ? { icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico") }
                    : { icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns") }
                )
            })

            window.windowId = windowId

            window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "&toVersion=" + toVersion + "#update")

            if(DEV_TOOLS){
                window.webContents.openDevTools({ mode: "detach" })
            }

            window.once("closed", () => {
                require("../shared").remove("UPDATE_WINDOW")

                activeWindows = activeWindows.filter(window => window.id !== windowId)

                if(is.macOS()){
                    const active = JSON.stringify(activeWindows.map(window => window.type))

                    if(
                        JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active
                        || JSON.stringify(["MAIN_WINDOW"]) == active
                        || JSON.stringify(["WORKER_WINDOW"]) == active
                    ){
                        app.dock.hide()
                    }
                }
			})

			window.once("show", () => setTimeout(() => window.focus(), 250))
            
            ipcMain.once("window-ready", (_, id) => {
                if(id == windowId){
                    window.show()
                }
            })

            if(is.macOS()){
                window.once("show", () => {
                    app.dock.show().catch(log.error)
                })
            }

            require("../shared").set("UPDATE_WINDOW", window)

            return resolve(window)
        }
        catch(e){
            return reject(e)
        }
    })
}

const createWorker = () => {
    return new Promise(async (resolve, reject) => {
        try{
            if(typeof require("../shared").get("WORKER_WINDOW") !== "undefined"){
                try{
                    require("../shared").get("WORKER_WINDOW").close()
                }
                catch(e){
                    log.error(e)
                }
            }

            const windowId = uuidv4()

            const window = new BrowserWindow({
                width: 0,
                height: 0,
                webPreferences: {
                    nodeIntegration: true,
                    backgroundThrottling: false,
                    contextIsolation: false
                },
                frame: false,
                show: false,
                skipTaskbar: true,
                alwaysOnTop: false,
                transparent: true,
                opacity: 0
            })

            window.windowId = windowId

            await window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "#worker")
            
            if(DEV_TOOLS){
                window.webContents.openDevTools({ mode: "detach" })
            }

            window.webContents.session.enableNetworkEmulation({
                offline: true
            })

			window.once("closed", () => {
				require("../shared").remove("WORKER_WINDOW")
                require("../shared").remove("WORKER_WINDOW_DEBUGGER")

                activeWindows = activeWindows.filter(window => window.id !== windowId)
			})

            require("../shared").set("WORKER_WINDOW", window)
            activeWindows.push({ id: windowId, type: "WORKER_WINDOW" })
    
            return resolve(window)
        }
        catch(e){
            return reject(e)
        }
    })
}

const createWindows = () => {
    return new Promise(async (resolve, reject) => {
        try{
            await require("../ipc").listen()
            await require("../socket").listen()

            const langSetManually = await require("../db").get("langSetManually")

            if(!langSetManually){
                const locale = app.getLocale()
            
                if(["en", "de"].includes(locale)){
                    await require("../db").set("lang", locale)
                }
            }

            var [isLoggedIn, deviceId, _] = await Promise.all([
                require("../db").get("isLoggedIn"),
                require("../db").get("deviceId")
            ])

            await createWorker()

            if(is.macOS()){
                app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, "../src/assets/icons/png/512x512.png")))
                app.dock.hide()
            }

            if(!deviceId){
				await require("../db").set("deviceId", uuidv4())
			}

            if(isLoggedIn){
                await createMain(false)
            }
            else{
                await createAuth()
            }
        }
        catch(e){
            return reject(e)
        }

        return resolve(true)
    })
}

module.exports = {
    createMain,
    createAuth,
    createWorker,
	createSettings,
    createWindows,
    createDownload,
	createCloud,
    createUpload,
    createSelectiveSync,
    createUpdate
}