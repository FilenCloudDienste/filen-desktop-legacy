const { BrowserWindow, app, nativeImage, ipcMain } = require("electron")
const path = require("path")
const isDev = require("electron-is-dev")
const db = require("../db")
const is = require("electron-is")
const tray = require("../tray")
const shared = require("../shared")
const log = require("electron-log")
const { v4: uuidv4 } = require("uuid")
const { Base64 } = require("js-base64")

const STATIC_PATH = isDev ? "http://localhost:3000/" : "file://" + path.join(__dirname, "../../../../build/index.html")

const createMain = (show = false) => {
    return new Promise(async (resolve, reject) => {
		if(typeof shared.get("MAIN_WINDOW") !== "undefined"){
			try{
				shared.get("MAIN_WINDOW").close()
			}
			catch(e){
				log.error(e)
			}
		}

        try{
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
                skipTaskbar: false,
                fullscreenable: false,
                maximizable: false,
                minimizable: true,
                hasShadow: false,
                title: "Filen",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)"
            })

            window.windowId = windowId

            window.setMenuBarVisibility(false)
            window.setAlwaysOnTop(true, "screen")
            window.setResizable(false)
            window.setMenu(null)
            
            if((is.macOS() || is.windows())){
                window.setSkipTaskbar(true)
            }

            if(is.macOS() && !isDev){
                app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, "../src/assets/icons/png/512x512.png")))
                app.dock.hide()
            }

            const windowTray = tray.createTray()

            window.loadURL(STATIC_PATH + "#main")

            if(isDev){
                window.webContents.openDevTools({ mode: "detach" })
            }

			window.once("closed", () => {
				shared.remove("MAIN_WINDOW")
			})

			window.once("show", () => {
                tray.positionWindowAtTray(window, windowTray)
                
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
                }, 3000)

                setTimeout(() => window.focus(), 250)
            })

            if(show){
                ipcMain.once("window-ready", (_, id) => {
                    if(id == windowId){
                        window.show()
    
                        tray.positionWindowAtTray(window, windowTray)
                    }
                })
            }

            shared.set("MAIN_WINDOW", window)

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
            const currentSettingsWindows = shared.get("SETTINGS_WINDOWS")

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
                title: "Filen",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)"
            })

            window.windowId = windowId

            window.loadURL(STATIC_PATH + "?page=" + page + "&id=" + encodeURIComponent(windowId) + "#settings")

            if(isDev){
                window.webContents.openDevTools({ mode: "detach" })
            }

			window.once("closed", () => {
				const settingsWindows = shared.get("SETTINGS_WINDOWS")

                if(typeof settingsWindows == "object"){
                    for(const id in settingsWindows){
                        if(id == windowId){
                            delete settingsWindows[id]
                        }
                    }

                    shared.set("SETTINGS_WINDOWS", settingsWindows)
                }
			})

			window.once("show", () => setTimeout(() => window.focus(), 250))
            
            ipcMain.once("window-ready", (_, id) => {
                if(id == windowId){
                    window.show()
                }
            })

            let settingsWindows = shared.get("SETTINGS_WINDOWS")

            if(typeof settingsWindows == "object"){
                settingsWindows[windowId] = window
            }
            else{
                settingsWindows = {}
                settingsWindows[windowId] = window
            }

            shared.set("SETTINGS_WINDOWS", settingsWindows)

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
                title: "Filen",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)"
            })

            window.windowId = windowId

            window.loadURL(STATIC_PATH + "?args=" + encodeURIComponent(Base64.encode(JSON.stringify(args))) + "&id=" + encodeURIComponent(windowId) + "#upload")

            if(isDev){
                window.webContents.openDevTools({ mode: "detach" })
            }

            window.once("closed", () => {
				const currentUploadWindows = shared.get("UPLOAD_WINDOWS")

                if(typeof currentUploadWindows == "object"){
                    for(const id in currentUploadWindows){
                        if(id == windowId){
                            delete currentUploadWindows[id]
                        }
                    }

                    shared.set("UPLOAD_WINDOWS", currentUploadWindows)
                }
			})

			window.once("show", () => setTimeout(() => window.focus(), 250))
            
            ipcMain.once("window-ready", (_, id) => {
                if(id == windowId){
                    window.show()
                }
            })

            let uploadWindows = shared.get("UPLOAD_WINDOWS")

            if(typeof uploadWindows == "object"){
                uploadWindows[windowId] = window
            }
            else{
                uploadWindows = {}
                uploadWindows[windowId] = window
            }

            shared.set("UPLOAD_WINDOWS", uploadWindows)

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
                title: "Filen",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)"
            })

            window.windowId = windowId

            window.loadURL(STATIC_PATH + "?args=" + encodeURIComponent(Base64.encode(JSON.stringify(args))) + "&id=" + encodeURIComponent(windowId) + "#download")

            if(isDev){
                window.webContents.openDevTools({ mode: "detach" })
            }

            window.once("closed", () => {
				const currentDownloadWindows = shared.get("DOWNLOAD_WINDOWS")

                if(typeof currentDownloadWindows == "object"){
                    for(const id in currentDownloadWindows){
                        if(id == windowId){
                            delete currentDownloadWindows[id]
                        }
                    }

                    shared.set("DOWNLOAD_WINDOWS", currentDownloadWindows)
                }
			})

			window.once("show", () => setTimeout(() => window.focus(), 250))
            
            ipcMain.once("window-ready", (_, id) => {
                if(id == windowId){
                    window.show()
                }
            })

            let downloadWindows = shared.get("DOWNLOAD_WINDOWS")

            if(typeof downloadWindows == "object"){
                downloadWindows[windowId] = window
            }
            else{
                downloadWindows = {}
                downloadWindows[windowId] = window
            }

            shared.set("DOWNLOAD_WINDOWS", downloadWindows)

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
                title: "Filen",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)"
            })

            window.windowId = windowId

            window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "&mode=" + mode + "#cloud")

            if(isDev){
                window.webContents.openDevTools({ mode: "detach" })
            }

			window.once("closed", () => {
				const cloudWindows = shared.get("CLOUD_WINDOWS")

                if(typeof cloudWindows == "object"){
                    for(const id in cloudWindows){
                        if(id == windowId){
                            delete cloudWindows[id]
                        }
                    }

                    shared.set("CLOUD_WINDOWS", cloudWindows)
                }
			})

			window.once("show", () => setTimeout(() => window.focus(), 250))
            
            ipcMain.once("window-ready", (_, id) => {
                if(id == windowId){
                    window.show()
                }
            })

            let cloudWindows = shared.get("CLOUD_WINDOWS")

            if(typeof cloudWindows == "object"){
                cloudWindows[windowId] = window
            }
            else{
                cloudWindows = {}
                cloudWindows[windowId] = window
            }

            shared.set("CLOUD_WINDOWS", cloudWindows)

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
                title: "Filen",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)"
            })

            window.windowId = windowId

            window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "&args=" + encodeURIComponent(Base64.encode(JSON.stringify(args))) + "#selectiveSync")

            if(isDev){
                window.webContents.openDevTools({ mode: "detach" })
            }

			window.once("closed", () => {
				const selectiveSyncWindows = shared.get("SELECTIVE_SYNC_WINDOWS")

                if(typeof selectiveSyncWindows == "object"){
                    for(const id in selectiveSyncWindows){
                        if(id == windowId){
                            delete selectiveSyncWindows[id]
                        }
                    }

                    shared.set("SELECTIVE_SYNC_WINDOWS", selectiveSyncWindows)
                }
			})

			window.once("show", () => setTimeout(() => window.focus(), 250))
            
            ipcMain.once("window-ready", (_, id) => {
                if(id == windowId){
                    window.show()
                }
            })

            let selectiveSyncWindows = shared.get("SELECTIVE_SYNC_WINDOWS")

            if(typeof selectiveSyncWindows == "object"){
                selectiveSyncWindows[windowId] = window
            }
            else{
                selectiveSyncWindows = {}
                selectiveSyncWindows[windowId] = window
            }

            shared.set("SELECTIVE_SYNC_WINDOWS", selectiveSyncWindows)

            return resolve(window)
        }
        catch(e){
            return reject(e)
        }
    })
}

const createAuth = () => {
    return new Promise(async (resolve, reject) => {
		if(typeof shared.get("AUTH_WINDOW") !== "undefined"){
			try{
				shared.get("AUTH_WINDOW").close()
			}
			catch(e){
				log.error(e)
			}
		}

        try{
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
                title: "Filen",
                show: false,
                backgroundColor: "rgba(0, 0, 0, 0)"
            })

            window.windowId = windowId

            window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "#auth")

            if(isDev){
                window.webContents.openDevTools({ mode: "detach" })
            }

			window.once("closed", () => {
				shared.remove("AUTH_WINDOW")
			})

			window.once("show", () => setTimeout(() => window.focus(), 250))
            
            ipcMain.once("window-ready", (_, id) => {
                if(id == windowId){
                    window.show()
                }
            })

            shared.set("AUTH_WINDOW", window)

            return resolve(window)
        }
        catch(e){
            return reject(e)
        }
    })
}

const createWorker = () => {
    return new Promise(async (resolve, reject) => {
		if(typeof shared.get("WORKER_WINDOW") !== "undefined"){
			try{
				shared.get("WORKER_WINDOW").close()
			}
			catch(e){
				log.error(e)
			}
		}

        try{
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
            
            if(isDev){
                window.webContents.openDevTools({ mode: "detach" })
            }

            window.webContents.session.enableNetworkEmulation({
                offline: true
            })

			window.once("closed", () => {
				shared.remove("WORKER_WINDOW")
                shared.remove("WORKER_WINDOW_DEBUGGER")
			})

            shared.set("WORKER_WINDOW", window)
    
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

            const langSetManually = await db.get("langSetManually")

            if(!langSetManually){
                const locale = app.getLocale()
            
                if(["en", "de"].includes(locale)){
                    await db.set("lang", locale)
                }
            }

            var [isLoggedIn, deviceId, _] = await Promise.all([
                db.get("isLoggedIn"),
                db.get("deviceId"),
                createWorker()
            ])
        }
        catch(e){
            return reject(e)
        }

        try{
			if(!deviceId){
				await db.set("deviceId", uuidv4())
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
    createSelectiveSync
}