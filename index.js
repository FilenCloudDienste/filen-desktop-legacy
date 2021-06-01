process.noAsar = true

process.on("uncaughtException", (err) => {
	console.error(err)

	if(err.toString().toLowerCase().indexOf("openerror") !== -1 || err.toString().toLowerCase().indexOf("corruption") !== -1 && err.toString().toLowerCase().indexOf("level") !== -1){
		let electron = require("electron")
		let rmrf = require("rimraf")
		let dbPath = electron.app.getPath("userData") + "/db/index"

		if(process.platform == "linux" || process.platform == "darwin"){
			dbPath = electron.app.getPath("userData") + "/index"
		}

		return rmrf(dbPath, () => {
			electron.app.exit(0)
		})
	}
})

const { app, BrowserWindow, Menu, ipcMain, Tray, dialog, powerMonitor, globalShortcut, nativeImage, screen } = require("electron")
const path = require("path")

console.log("platform = " + process.platform)
console.log("exePath = " + app.getPath("exe"))
console.log("userDataPath = " + app.getPath("userData"))

if(process.platform == "darwin"){
	app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, "icons", "png", "512x512.png")))

	app.dock.hide()
}

const level = require("level")
const fs = require("fs-extra")
const copy = require("recursive-copy")
const rimraf = require("rimraf")
const { autoUpdater } = require("electron-updater")
const log = require("electron-log")
const Positioner = require('electron-positioner')
const child_process = require("child_process")

let db = undefined
let dbPath = undefined
let positioner = undefined

if(process.platform == "linux" || process.platform == "darwin"){
	dbPath = app.getPath("userData") + "/index"
}
else{
	dbPath = app.getPath("userData") + "/db/index"
}

try{
	db = level(dbPath)
}
catch(e){
	return rimraf(dbPath, () => {
		app.exit(0)
	})
}

let tray = null
let rendererReady = false
let userHomePath = undefined
let userSyncDir = undefined
let userDownloadPath = undefined
let browserWindow = undefined
let appPath = undefined
let doCheckIfSyncDirectoryExists = true
let syncingPaused = false
let syncTasks = 0
let isSyncing = false
let currentTrayIcon = undefined
let toggleAutostartTimeout = 0

autoUpdater.logger = log
autoUpdater.logger.transports.file.level = "info"

let nativeImageAppIcon = path.join(__dirname, "lib", "assets", "logo.png")
let nativeImageTrayIconNormal = path.join(__dirname, "lib", "assets", "logo.png")
let nativeImageTrayIconSyncing = path.join(__dirname, "lib", "assets", "tray_sync.png")
let nativeImageTrayIconPaused = path.join(__dirname, "lib", "assets", "tray_paused.png")

if(process.platform == "darwin"){
	nativeImageTrayIconNormal = path.join(__dirname, "lib", "assets", "logo_16.png")
	nativeImageTrayIconSyncing = path.join(__dirname, "lib", "assets", "tray_sync_16.png")
	nativeImageTrayIconPaused = path.join(__dirname, "lib", "assets", "tray_paused_16.png")
}

const sendUserDirs = () => {
	try{
		browserWindow.webContents.send("user-dirs", {
			userHomePath,
			userSyncDir,
			appPath,
			userDownloadPath
		})
	}
	catch(e){
		console.log(e)
	}
}

const init = () => {
	setInterval(() => {
		if(typeof browserWindow == "undefined" || typeof userSyncDir == "undefined" || typeof userHomePath == "undefined"){
			return
		}

		try{
			sendUserDirs()

			browserWindow.webContents.send("app-platform", {
				appPlatform: getPlatform()
			})

			browserWindow.webContents.send("app-version", {
				version: app.getVersion()
			})

			browserWindow.webContents.send("idle-time", {
				seconds: powerMonitor.getSystemIdleTime()
			})
		}
		catch(e){
			console.log(e)
		}
	}, 1000)
}

const getPlatform = () => {
	if(process.platform == "win32" || process.platform == "win64"){
		return "windows"
	}

	if(process.platform == "linux"){
		return "linux"
	}

	if(process.platform == "darwin"){
		return "mac"
	}
}

const winOrUnixFilePath = (path) => {
	if(getPlatform() == "windows"){
		return path.split("/").join("\\")
	}
	else{
		return path.split("\\").join("/")
	}
}

const checkIfSyncDirectoryExists = () => {
	if(!doCheckIfSyncDirectoryExists){
		return
	}

	let syncDirPath = userHomePath + "/" + "Filen Sync"
	
	userSyncDir = syncDirPath

	fs.access(winOrUnixFilePath(syncDirPath), (err) => {
		if(err && err.code == "ENOENT"){
			if(!doCheckIfSyncDirectoryExists){
				return
			}

			if(typeof browserWindow !== "undefined"){
				browserWindow.webContents.send("pause-syncing")
			}

			fs.mkdir(winOrUnixFilePath(syncDirPath), {
				recursive: true,
				overwrite: true
			}, (err) => {
				if(err){
					console.log("Could not create sync dir:", err)
				}
				else{
					if(typeof browserWindow !== "undefined"){
						browserWindow.webContents.send("unpause-syncing")
						browserWindow.webContents.send("clear-db")
					}

					console.log("Sync dir created:", syncDirPath)
				}
			})
		}
	})
}

const toggleAutoLaunch = (enable = true) => {
	if(typeof app == "undefined"){
		return false
	}

	if(process.platform == "linux"){
		return false
	}

	/*let isDevelopment = process.env.NODE_ENV !== "production"

	if(isDevelopment){
		return false
	}*/

	try{
		if(process.platform == "linux" || process.platform == "darwin"){
			app.setLoginItemSettings({
				openAtLogin: (enable ? true : false),
				openAsHidden: true
			})
		}
		else{
			app.setLoginItemSettings({
				openAtLogin: (enable ? true : false),
				openAsHidden: true,
				path: app.getPath("exe"),
				args: [
				  	"--processStart",
				  	`"${app.getPath("exe")}"`,
				  	"--process-start-args",
				  	`"--hidden"`
				]
			 })
		}
	}
	catch(e){
		console.log(err)

		return false
	}

	return true
}

const hideWindow = () => {
	if(typeof browserWindow == "undefined"){
		return false
	}

	return browserWindow.hide()
}

const showWindow = () => {
	if(typeof browserWindow == "undefined"){
		return false
	}

	moveWindow()

	browserWindow.show()

	return browserWindow.focus()
}

const getTrayPosition = () => {
	if(typeof browserWindow == "undefined" || typeof positioner == "undefined" || typeof tray == "undefined"){
		return false
	}

	let windowBounds = browserWindow.getBounds()
	let trayBounds = tray.getBounds()

	// Center window horizontally below the tray icon
	let x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2))

	// Position window 4 pixels vertically below the tray icon
	let y = Math.round(trayBounds.y + trayBounds.height + 3)

	return {
		x,
		y
	}
}

const moveWindow = () => {
	if(typeof browserWindow == "undefined" || typeof tray == "undefined"){
		return false
	}

	let trayPosition = getTrayPosition()

	if(!trayPosition){
		return false
	}

	return browserWindow.setPosition(trayPosition.x, trayPosition.y, false)
}

const createWindow = async () => {
	if(process.platform !== "linux"){
		let autostartEnabledSetter = false

		try{
			let getAutostartEnabled = app.getLoginItemSettings()['openAtLogin']

			if(getAutostartEnabled){
				toggleAutoLaunch(true)

				autostartEnabledSetter = true
			}
			else{
				toggleAutoLaunch(false)

				autostartEnabledSetter = false
			}
		}
		catch(e){
			toggleAutoLaunch(false)

			autostartEnabledSetter = true
		}

		try{
			await db.put("autostartEnabled", autostartEnabledSetter.toString())

			console.log("autostartEnabled", autostartEnabledSetter.toString())
		}
		catch(e){
			console.log(e)
		}
	}

	browserWindow = new BrowserWindow({
		width: 350,
		height: 550,
		icon: nativeImageAppIcon,
		webPreferences: {
			nodeIntegration: true,
			nodeIntegrationInWorker: true,
			backgroundThrottling: false,
			enableRemoteModule: true
		},
		maximizable: false,
		fullscreenable: false,
		title: "Filen Sync",
		darkTheme: true,
		resizable: false,
		show: false,
		frame: false,
		skipTaskbar: true
	})

	browserWindow.setResizable(false)
	//browserWindow.setVisibleOnAllWorkspaces(true)
	browserWindow.setMenuBarVisibility(false)
	//browserWindow.toggleDevTools()

	tray = new Tray(nativeImageTrayIconNormal)

	positioner = new Positioner(browserWindow)

	let normalTrayMenu = Menu.buildFromTemplate(
		[
	        {
	            label: "Show",
	            click: () => {
	               	return showWindow()
	            }
	        },
	        {
	        	label: "Open sync folder",
	        	click: () => {
	        		return browserWindow.webContents.send("open-sync-folder", {
	        			userHomePath,
	        			userSyncDir,
	        			appPath,
	        			userDownloadPath
	        		})
	        	}
	        },
	        {
	        	label: "Pause syncing",
	        	click: () => {
	        		return browserWindow.webContents.send("pause-syncing")
	        	}
	        },
	        {
	            label: "Quit",
	            click: () => {
	            	return app.exit(0)
	            }
	        }
    	]
    )

    let unpauseTrayMenu = Menu.buildFromTemplate(
		[
	        {
	            label: "Show",
	            click: () => {
	               	return showWindow()
	            }
	        },
	        {
	        	label: "Open sync folder",
	        	click: () => {
	        		return browserWindow.webContents.send("open-sync-folder", {
	        			userHomePath,
	        			userSyncDir,
	        			appPath,
	        			userDownloadPath
	        		})
	        	}
	        },
	        {
	        	label: "Resume syncing",
	        	click: () => {
	        		return browserWindow.webContents.send("unpause-syncing")
	        	}
	        },
	        {
	            label: "Quit",
	            click: () => {
	            	return app.exit(0)
	            }
	        }
    	]
    )

	if(process.platform !== "darwin"){
		tray.setTitle("Filen Sync")
	}

	tray.setContextMenu(normalTrayMenu)

    tray.on("double-click", () => {
    	return showWindow()
    })

    tray.on("click", () => {
    	return showWindow()
    })

	browserWindow.on("close", (event) => {
        event.preventDefault()

        return hideWindow()
    })

    browserWindow.on("minimize", (event) => {
        event.preventDefault()

        return hideWindow()
    })

    ipcMain.on("minimize", (event, data) => {
    	return hideWindow()
    })

    ipcMain.on("relaunch-app", (event, data) => {
    	app.relaunch()

    	return app.exit(0)
    })

    ipcMain.on("is-syncing", (event, data) => {
    	return isSyncing = data.isSyncing
    })

    ipcMain.on("is-syncing-paused", (event, data) => {
    	return syncingPaused = data.paused
    })

    ipcMain.on("toggle-autostart", async (event, data) => {
    	let autostartEnabled = false

		try{
			let getAutostartEnabled = await db.get("autostartEnabled")

			if(getAutostartEnabled == "true"){
				autostartEnabled = true
			}
			else{
				autostartEnabled = false
			}
		}
		catch(e){
			autostartEnabled = false
		}

		if(Math.floor((+new Date()) / 1000) < toggleAutostartTimeout){
			browserWindow.webContents.send("autostart-enabled-res", {
				autostartEnabled: autostartEnabled
			})

			return false
		}

		toggleAutostartTimeout = (Math.floor((+new Date()) / 1000) + 3)

		if(autostartEnabled){
			toggleAutoLaunch(false)

			try{
				await db.put("autostartEnabled", "false")
			}
			catch(e){
				console.log(e)
			}

			browserWindow.webContents.send("autostart-enabled-res", {
				autostartEnabled: false
			})
		}
		else{
			toggleAutoLaunch(true)

			try{
				await db.put("autostartEnabled", "true")
			}
			catch(e){
				console.log(e)
			}

			browserWindow.webContents.send("autostart-enabled-res", {
				autostartEnabled: true
			})
		}
    })

	ipcMain.on("renderer-ready", async (event, data) => {
		let autostartEnabled = false

		try{
			let getAutostartEnabled = await db.get("autostartEnabled")

			if(getAutostartEnabled == "true"){
				autostartEnabled = true
			}
			else{
				autostartEnabled = false
			}
		}
		catch(e){
			autostartEnabled = false
		}

		browserWindow.webContents.send("autostart-enabled-res", {
			autostartEnabled: autostartEnabled
		})

  		return rendererReady = true
	})

	ipcMain.on("download-folder-screen-opened", (event, data) => {
		return showWindow()
	})

	ipcMain.on("download-file-screen-opened", (event, data) => {
		return showWindow()
	})

	ipcMain.on("open-window", (event, data) => {
		return showWindow()
	})

	ipcMain.on("change-download-folder-path", async (event, data) => {
		let result = await dialog.showOpenDialog(browserWindow, {
		    properties: [
		    	"openDirectory"
		    ]
		})

		if(result.canceled){
			return browserWindow.webContents.send("change-download-folder-path-res", {
				path: userDownloadPath
			})
		}

		if(typeof result.filePaths == "undefined"){
			return browserWindow.webContents.send("change-download-folder-path-res", {
				path: userDownloadPath
			})
		}

		if(typeof result.filePaths[0] == "undefined"){
			return browserWindow.webContents.send("change-download-folder-path-res", {
				path: userDownloadPath
			}) 
		}

		let selectedPath = result.filePaths[0].split("\\").join("/")

		return browserWindow.webContents.send("change-download-folder-path-res", {
			path: selectedPath
		})
	})

	ipcMain.on("open-path-selection", async (event, data) => {
		let result = await dialog.showOpenDialog(browserWindow, {
		    properties: [
		    	"openDirectory"
		    ]
		})

		if(result.canceled){
			return browserWindow.webContents.send("unpause-syncing")
		}

		if(typeof result.filePaths == "undefined"){
			return browserWindow.webContents.send("unpause-syncing")
		}

		if(typeof result.filePaths[0] == "undefined"){
			return browserWindow.webContents.send("unpause-syncing")
		}

		let lastUserHomePath = userHomePath
		let lastUserSyncDir = userSyncDir

		browserWindow.webContents.send("show-big-loading", {
			message: "Restarting.."
		})

		browserWindow.webContents.send("pause-syncing")
		doCheckIfSyncDirectoryExists = false

		let wait = setInterval(async () => {
			if(syncTasks == 0){
				clearInterval(wait)

				let selectedPath = result.filePaths[0].split("\\").join("/")

				userHomePath = selectedPath

				let newSyncDirPath = userHomePath + "/" + "Filen Sync"

				try{
					await db.put("altHomePath", selectedPath)
				}
				catch(e){
					return console.log(e)
				}

				sendUserDirs()

				const copyOldFilesOver = () => {
					sendUserDirs()

					copy(winOrUnixFilePath(lastUserSyncDir), winOrUnixFilePath(newSyncDirPath), {
						overwrite: true,
						expand: false,
						dot: true,
						junk: true
					}, (err, res) => {
						if(err){
							console.log(err)
						}
						else{
							rimraf(winOrUnixFilePath(lastUserSyncDir), () => {
								sendUserDirs()
								
								browserWindow.webContents.send("rewrite-saved-sync-data", {
									lastUserHomePath,
									newUserHomePath: userHomePath
								})
							})
						}
					})
				}

				fs.access(winOrUnixFilePath(newSyncDirPath), (err) => {
					if(err && err.code == "ENOENT"){
						fs.mkdir(winOrUnixFilePath(newSyncDirPath), (err) => {
							if(err){
								console.log(err)
							}
							else{
								copyOldFilesOver()
							}
						})
					}
					else{
						copyOldFilesOver()
					}
				})
			}
		}, 100)
	})

	ipcMain.on("rewrite-saved-sync-data-done", (event, data) => {
		let waitForSyncToFinishInterval = setInterval(() => {
    		if(syncTasks == 0){
    			clearInterval(waitForSyncToFinishInterval)

    			return app.exit(0)
    		}
    	}, 100)
	})

	ipcMain.on("exit-app", (event, data) => {
		return app.exit(0)
	})

	ipcMain.on("restart-for-update", (event, data) => {
		return autoUpdater.quitAndInstall()
	})

	ipcMain.on("set-tray-tooltip", (event, data) => {
		if(syncingPaused){
			return
		}

		tray.setToolTip(data.tooltip)

		syncTasks = data.tasks
	})

	let altHomePath = ""

	try{
		let altHomePathDb = await db.get("altHomePath")

		if(altHomePathDb.length > 0){
			altHomePath = altHomePathDb
		}
	}
	catch(e){
		altHomePath = ""
	}

	if(altHomePath.length > 0){
		userHomePath = altHomePath.split("\\").join("/")
	}
	else{
		userHomePath = app.getPath("home").split("\\").join("/")
	}

	appPath = app.getAppPath().split("\\").join("/")
	userDownloadPath = app.getPath("downloads").split("\\").join("/")

	checkIfSyncDirectoryExists()

	//setInterval(checkIfSyncDirectoryExists, 3000)

  	browserWindow.loadFile(path.join(__dirname, "lib", "assets", "index.html"))

  	moveWindow()

  	setInterval(() => {
  		autoUpdater.checkForUpdatesAndNotify()
  	}, 60000)

  	autoUpdater.on("update-downloaded", () => {
		return browserWindow.webContents.send("update-available")
	})

	setInterval(() => {
		if(syncingPaused){
			tray.setContextMenu(unpauseTrayMenu)

			if(currentTrayIcon !== nativeImageTrayIconPaused){
				currentTrayIcon = nativeImageTrayIconPaused

				tray.setImage(nativeImageTrayIconPaused)
			}
		}
		else{
			tray.setContextMenu(normalTrayMenu)

			if(syncTasks > 0){
				if(currentTrayIcon !== nativeImageTrayIconSyncing){
					currentTrayIcon = nativeImageTrayIconSyncing
	
					tray.setImage(nativeImageTrayIconSyncing)
				}
			}
			else{
				if(currentTrayIcon !== nativeImageTrayIconNormal){
					currentTrayIcon = nativeImageTrayIconNormal
	
					tray.setImage(nativeImageTrayIconNormal)
				}
			}
		}
	}, 100)

  	const initInterval = setInterval(() => {
  		if(rendererReady){
  			clearInterval(initInterval)

  			return init()
  		}
  	}, 10)
}

app.commandLine.appendSwitch("disable-renderer-backgrounding")

if(!app.requestSingleInstanceLock()){
  	return app.quit()
}
else{
	app.on("second-instance", (event, commandLine, workingDirectory) => {
		if(browserWindow){
			if(browserWindow.isMinimized()){
				browserWindow.restore()
			}

			browserWindow.focus()

			showWindow()
		}
	})

	app.whenReady().then(() => {
		return createWindow()
	})
}

app.on("window-all-closed", () => {
  	if(getPlatform() !== "mac"){
    	return app.exit(0)
  	}
})

app.on("activate", () => {
  	if(BrowserWindow.getAllWindows().length == 0){
    	return createWindow()
  	}
})

app.on("browser-window-focus", () => {
    globalShortcut.register("CommandOrControl+R", () => {
        console.log("CommandOrControl+R is pressed: Shortcut Disabled")
    })

    globalShortcut.register("F5", () => {
        console.log("F5 is pressed: Shortcut Disabled")
    })
})

app.on("browser-window-blur", () => {
    globalShortcut.unregister("CommandOrControl+R")
    globalShortcut.unregister("F5")
})

powerMonitor.on("shutdown", () => {
  	return app.exit(0)
})