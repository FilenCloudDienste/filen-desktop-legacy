process.noAsar = true

BigInt.prototype.toJSON = function(){
	return this.toString()
}

const log = require("electron-log")

Object.assign(console, log.functions)

process.on("uncaughtException", (err) => {
	console.log(err)

	try{
		if(err.toString().toLowerCase().indexOf("openerror") !== -1 || err.toString().toLowerCase().indexOf("corruption") !== -1 && err.toString().toLowerCase().indexOf("level") !== -1){
			let electron = require("electron")
			let fs = require("fs-extra")
			let dbPath = electron.app.getPath("userData") + "/db/index"

			if(process.platform == "linux" || process.platform == "darwin"){
				dbPath = electron.app.getPath("userData") + "/index"
			}

			return fs.remove(dbPath, (err) => {
				electron.app.exit(0)
			})
		}
	}
	catch(e){
		console.log(e)
	}
})

const { app, BrowserWindow, Menu, ipcMain, Tray, dialog, powerMonitor, globalShortcut, nativeImage, shell } = require("electron")
const path = require("path")
const level = require("level")
const fs = require("fs-extra")
const copy = require("recursive-copy")
const { autoUpdater } = require("electron-updater")
const positioner = require("electron-traywindow-positioner")
const is = require("electron-is")
const AutoLaunch = require("auto-launch")

console.log("platform = " + process.platform)
console.log("exePath = " + app.getPath("exe"))
console.log("userDataPath = " + app.getPath("userData"))

if(is.macOS()){
	app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, "icons", "png", "512x512.png")))

	app.dock.hide()
}

let tray = null,
	rendererReady = false,
	userHomePath = undefined,
	userSyncDir = undefined,
	userDownloadPath = undefined,
	browserWindow = undefined,
	appPath = undefined,
	doCheckIfSyncDirectoryExists = true,
	syncingPaused = false,
	syncTasks = 0,
	isSyncing = false,
	currentTrayIcon = undefined,
	toggleAutostartTimeout = 0,
	db = undefined,
	dbPath = undefined,
	autoLauncher = undefined,
	lastTrayMenuName = "",
	localTrashBinName = ".filen.trash.local"

if(is.linux() || is.macOS()){
	dbPath = app.getPath("userData") + "/index"
}
else{
	dbPath = app.getPath("userData") + "/db/index"
}

try{
	db = level(dbPath)
}
catch(e){
	return fs.remove(dbPath, (err) => {
		app.exit(0)
	})
}

autoUpdater.logger = log
autoUpdater.logger.transports.file.level = "info"

let nativeImageAppIcon = path.join(__dirname, "src", "img", "logo.png")
let nativeImageTrayIconNormal = path.join(__dirname, "src", "img", "logo.png")
let nativeImageTrayIconSyncing = path.join(__dirname, "src", "img", "tray_sync.png")
let nativeImageTrayIconPaused = path.join(__dirname, "src", "img", "tray_paused.png")

if(is.macOS() || is.windows() || is.linux()){
	nativeImageTrayIconNormal = nativeImage.createFromPath(nativeImageTrayIconNormal).resize({
		width: 16,
		height: 16,
		quality: "best"
	})

	nativeImageTrayIconSyncing = nativeImage.createFromPath(nativeImageTrayIconSyncing).resize({
		width: 16,
		height: 16,
		quality: "best"
	})
	
	nativeImageTrayIconPaused = nativeImage.createFromPath(nativeImageTrayIconPaused).resize({
		width: 16,
		height: 16,
		quality: "best"
	})
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

	return true
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
	if(is.windows()){
		return "windows"
	}

	if(is.linux()){
		return "linux"
	}

	if(is.macOS()){
		return "mac"
	}
}

const winOrUnixFilePath = (path) => {
	if(is.windows()){
		return path.split("/").join("\\")
	}
	else{
		return path.split("\\").join("/")
	}
}

const createTrashBin = (syncDirPath) => {
	fs.access(winOrUnixFilePath(syncDirPath + "/" + localTrashBinName), (err) => {
		if(err && err.code == "ENOENT"){
			fs.mkdir(winOrUnixFilePath(syncDirPath + "/" + localTrashBinName), {
				recursive: true
			}, (err) => {
				if(err){
					console.log("Could not create sync dir:", err)
				}
			})
		}
	})
}

const checkIfSyncDirectoryExists = async () => {
	if(!doCheckIfSyncDirectoryExists){
		return false
	}

	userHomePath = userHomePath.split("\\").join("/")

	if(userHomePath.slice(-1) == "/"){
		userHomePath.substring(0, userHomePath.length - 1)
	}

	let syncDirPath = userHomePath + "/" + "Filen Sync"

	try{
		let res = await db.get("removeFilenSyncEnding")

		if(typeof res == "string"){
			if(res == "true"){
				syncDirPath = userHomePath
			}
		}
	}
	catch(e){
		syncDirPath = userHomePath + "/" + "Filen Sync"
	}
	
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
				recursive: true
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

					createTrashBin(syncDirPath)
				}
			})
		}
		else{
			createTrashBin(syncDirPath)
		}
	})
}

const showBeforeCloseDialog = async () => {
	try{
		await dialog.showMessageBox({
			icon: nativeImage.createFromPath(path.join(__dirname, "icons", "png", "512x512.png")),
			title: "Filen",
			buttons: [
				"Keep open"
			],
			defaultId: 0,
			cancelId: 0,
			type: "warning",
			message: "Filen is still syncing with the cloud. Closing the application now could result into loss or corruption of data."
		})
	}
	catch(e){
		console.log(e)

		return false
	}

	return true
}

const attemptGracefulClose = async () => {
	let close = false

	if(syncTasks > 0){
		let res = await showBeforeCloseDialog()

		if(res){
			close = true
		}
	}

	if(close){
		return app.exit(0)
	}

	return false
}

const toggleAutoLaunch = async (enable = true) => {
	if(typeof app == "undefined" || typeof autoLauncher == "undefined"){
		return false
	}

	if(enable){
		autoLauncher.enable()
	}
	else{
		autoLauncher.disable()
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

	browserWindow.webContents.send("skip-blur")

	moveWindow()

	browserWindow.show()

	return browserWindow.focus()
}

const moveWindow = () => {
	if(typeof browserWindow == "undefined" || typeof tray == "undefined"){
		return false
	}

	return positioner.position(browserWindow, tray.getBounds())
}

const createWindow = async () => {
	browserWindow = new BrowserWindow({
		width: 360,
		height: 600,
		icon: nativeImageAppIcon,
		webPreferences: {
			nodeIntegration: true,
			nodeIntegrationInWorker: true,
			backgroundThrottling: false,
			enableRemoteModule: true,
			contextIsolation: false
		},
		title: "Filen",
		maximizable: false,
		minimizable: false,
		fullscreenable: false,
		resizable: false,
		show: false,
		frame: false,
		skipTaskbar: true,
		transparent: true
	})

	browserWindow.setResizable(false)
	//browserWindow.setVisibleOnAllWorkspaces(true)
	browserWindow.setMenuBarVisibility(false)
	browserWindow.setAlwaysOnTop(true, "screen")
	browserWindow.setSkipTaskbar(true)

	tray = new Tray(nativeImageTrayIconNormal)

	autoLauncher = new AutoLaunch({
	    name: "Filen",
	    path: app.getPath("exe"),
	})

	let normalTrayMenu = Menu.buildFromTemplate(
		[
	        {
	            label: "Show",
	            click: () => {
	               	return showWindow()
	            }
	        },
	        {
	        	label: "Open Sync Folder",
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
				label: "Open Local Trash",
				click: () => {
					try{
						shell.openPath(winOrUnixFilePath(userSyncDir + "/" + localTrashBinName)).catch((err) => {
							console.log(err)
						})
					}
					catch(e){
						console.log(e)
					}
				}
			},
	        {
	        	label: "Pause",
	        	click: () => {
	        		return browserWindow.webContents.send("pause-syncing")
	        	}
	        },
			{
	        	label: "Force Sync",
	        	click: () => {
	        		return browserWindow.webContents.send("force-sync")
	        	}
	        },
	        {
	            label: "Quit",
	            click: () => {
	            	return attemptGracefulClose()
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
	        	label: "Open Sync Folder",
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
				label: "Open Local Trash",
				click: () => {
					try{
						shell.openPath(winOrUnixFilePath(userSyncDir + "/" + localTrashBinName)).catch((err) => {
							console.log(err)
						})
					}
					catch(e){
						console.log(e)
					}
				}
			},
	        {
	        	label: "Resume",
	        	click: () => {
	        		return browserWindow.webContents.send("unpause-syncing")
	        	}
	        },
	        {
	            label: "Quit",
	            click: () => {
	            	return attemptGracefulClose()
	            }
	        }
    	]
    )

    if(is.macOS()){
    	browserWindow.setTitle("Filen")

    	app.dock.hide()
    }

	tray.setContextMenu(normalTrayMenu)

	lastTrayMenuName = "normal"

	tray.on("right-click", () => {
    	return showWindow()
    })

    tray.on("double-click", () => {
    	return showWindow()
    })

    tray.on("click", () => {
    	return showWindow()
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
			autostartEnabled = await autoLauncher.isEnabled()
		}
		catch(e){
			console.log(e)
		}

		if(Math.floor((+new Date()) / 1000) < toggleAutostartTimeout){
			browserWindow.webContents.send("autostart-enabled-res", {
				autostartEnabled
			})

			return false
		}

		toggleAutostartTimeout = (Math.floor((+new Date()) / 1000) + 5)

		toggleAutoLaunch(!autostartEnabled)

		browserWindow.webContents.send("autostart-enabled-res", {
			autostartEnabled: !autostartEnabled
		})
    })

	ipcMain.on("renderer-ready", async (event, data) => {
		let autostartEnabled = false

		try{
			autostartEnabled = await autoLauncher.isEnabled()
		}
		catch(e){
			console.log(e)
		}

		browserWindow.webContents.send("autostart-enabled-res", {
			autostartEnabled
		})

  		return rendererReady = true
	})

	ipcMain.on("download-folder-screen-opened", (event, data) => {
		return showWindow()
	})

	ipcMain.on("open-window", (event, data) => {
		return showWindow()
	})

	ipcMain.on("open-window-login", (event, data) => {
		if(typeof browserWindow == "undefined"){
			return false
		}

		if(browserWindow.isVisible()){
			return false
		}

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

	ipcMain.on("select-path", async (event, data) => {
		let result = await dialog.showOpenDialog(browserWindow, {
		    properties: [
		    	"openDirectory"
		    ]
		})

		if(result.canceled){
			return browserWindow.webContents.send("select-path-res", {
				status: false,
				id: data.id
			})
		}

		if(typeof result.filePaths == "undefined"){
			return browserWindow.webContents.send("select-path-res", {
				status: false,
				id: data.id
			})
		}

		if(typeof result.filePaths[0] == "undefined"){
			return browserWindow.webContents.send("select-path-res", {
				status: false,
				id: data.id
			})
		}

		let selectedPath = result.filePaths[0].split("\\").join("/")

		return browserWindow.webContents.send("select-path-res", {
			status: true,
			id: data.id,
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

		browserWindow.webContents.send("show-big-loading")

		browserWindow.webContents.send("pause-syncing")
		doCheckIfSyncDirectoryExists = false

		let wait = setInterval(async () => {
			if(syncTasks == 0){
				clearInterval(wait)

				let selectedPath = result.filePaths[0].split("\\").join("/")

				if(selectedPath.slice(-1) == "/"){
					selectedPath = selectedPath.substring(0, selectedPath.length - 1)
				}

				userHomePath = selectedPath

				let newSyncDirPath = userHomePath

				try{
					await db.put("altHomePath", selectedPath)
					await db.put("removeFilenSyncEnding", "true")
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
							fs.remove(winOrUnixFilePath(lastUserSyncDir), (err) => {
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
					if(err){
						if(err.code == "ENOENT"){
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
							console.log(err)
						}
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

    			app.relaunch()

    			return app.exit(0)
    		}
    	}, 100)
	})

	ipcMain.on("exit-app", (event, data) => {
		return attemptGracefulClose()
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

	userHomePath = userHomePath.split("\\").join("/")

	if(userHomePath.slice(-1) == "/"){
		userHomePath.substring(0, userHomePath.length - 1)
	}

	appPath = app.getAppPath().split("\\").join("/")
	userDownloadPath = app.getPath("downloads").split("\\").join("/")

	checkIfSyncDirectoryExists()

	//setInterval(checkIfSyncDirectoryExists, 3000)

  	browserWindow.loadFile(path.join(__dirname, "src", "html", "index.html"))

  	if(is.dev()){
		browserWindow.webContents.openDevTools({
			mode: "detach"
		})
	}

  	moveWindow()

  	autoUpdater.checkForUpdates()

  	setInterval(() => {
  		autoUpdater.checkForUpdates()
  	}, (3600000 * 1))

  	autoUpdater.on("update-downloaded", () => {
		//return browserWindow.webContents.send("update-available")
	})

	setInterval(() => {
		if(syncingPaused){
			if(lastTrayMenuName !== "unpause"){
				lastTrayMenuName = "unpause"

				tray.setContextMenu(unpauseTrayMenu)
			}

			if(currentTrayIcon !== nativeImageTrayIconPaused){
				currentTrayIcon = nativeImageTrayIconPaused

				tray.setImage(nativeImageTrayIconPaused)
			}
		}
		else{
			if(lastTrayMenuName !== "normal"){
				lastTrayMenuName = "normal"

				tray.setContextMenu(normalTrayMenu)
			}

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
app.commandLine.appendSwitch("disable-pinch")
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=4096")

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

	app.on("ready", () => {
		return createWindow()
	})
}

app.on("before-quit", (event) => {
	event.preventDefault()

	return attemptGracefulClose()
})

app.on("window-all-closed", () => {
  	if(!is.macOS()){
    	return app.exit(0)
  	}
})

app.on("activate", () => {
  	if(typeof BrowserWindow !== "undefined"){
  		if(BrowserWindow.getAllWindows().length == 0){
	    	return createWindow()
	  	}
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

    if(is.dev()){
    	return false
    }

    return hideWindow()
})

powerMonitor.on("shutdown", () => {
	return attemptGracefulClose()
})