process.noAsar = true

process.on("uncaughtException", (err) => {
  	console.log("Caught exception:", err)
})

const { app, BrowserWindow, Menu, ipcMain, Tray, dialog, powerMonitor, globalShortcut, nativeImage } = require("electron")
const path = require("path")

if(process.platform == "darwin"){
	app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, "icons", "png", "512x512.png")))
}

const level = require("level")
const fs = require("fs-extra")
const AutoLaunch = require("auto-launch")
const copy = require("recursive-copy")
const rimraf = require("rimraf")
const { autoUpdater } = require("electron-updater")
const log = require("electron-log")
const child_process = require("child_process")

let db = undefined

try{
	if(process.platform == "linux" || process.platform == "darwin"){
		db = level(app.getPath("userData") + "/index")
	}
	else{
		db = level(app.getPath("userData") + "/db/index")
	}
}
catch(e){
	return app.exit(0)
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

const createWindow = async () => {
	const autoLaunch = new AutoLaunch({
	    name: "Filen Sync",
	    path: app.getPath("exe"),
	    isHidden: true
	})

	autoLaunch.isEnabled().then((isEnabled) => {
	    /*if(!isEnabled){
	    	autoLaunch.enable()
	    }*/

	    autoLaunch.disable()
	})

	browserWindow = new BrowserWindow({
		width: 400,
		height: 600,
		icon: nativeImageAppIcon,
		webPreferences: {
			nodeIntegration: true,
			nodeIntegrationInWorker: true,
			backgroundThrottling: false,
			enableRemoteModule: true
		},
		center: true,
		maximizable: false,
		fullscreenable: false,
		title: "Filen Sync",
		darkTheme: true,
		resizable: false
	})

	browserWindow.setResizable(false)
	browserWindow.setVisibleOnAllWorkspaces(true)
	browserWindow.setMenuBarVisibility(false)
	//browserWindow.toggleDevTools()

	tray = new Tray(nativeImageTrayIconNormal)

	let normalTrayMenu = Menu.buildFromTemplate(
		[
	        {
	            label: "Show",
	            click: () => {
	               	browserWindow.show()

					return browserWindow.focus()
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
	               	browserWindow.show()

					return browserWindow.focus()
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
    	browserWindow.show()

		return browserWindow.focus()
    })

	browserWindow.on("close", (event) => {
        event.preventDefault()

        return browserWindow.hide()
    })

    browserWindow.on("minimize", (event) => {
        event.preventDefault()

        return browserWindow.hide()
    })

    ipcMain.on("is-syncing-paused", (event, data) => {
    	return syncingPaused = data.paused
    })

	ipcMain.on("renderer-ready", (event, data) => {
  		return rendererReady = true
	})

	ipcMain.on("download-folder-screen-opened", (event, data) => {
		browserWindow.show()

		return browserWindow.focus()
	})

	ipcMain.on("download-file-screen-opened", (event, data) => {
		browserWindow.show()

		return browserWindow.focus()
	})

	ipcMain.on("open-window", (event, data) => {
		browserWindow.show()

		return browserWindow.focus()
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

		setTimeout(async () => {
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
					expamd: false,
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
		}, 5000)
	})

	ipcMain.on("rewrite-saved-sync-data-done", (event, data) => {
		return app.exit(0)
	})

	ipcMain.on("exit-app", (event, data) => {
		return app.exit(0)
	})

	ipcMain.on("restart-for-update", (event, data) => {
		autoUpdater.quitAndInstall()
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

  	setInterval(() => {
  		autoUpdater.checkForUpdatesAndNotify()
  	}, 300000)

  	autoUpdater.on("update-downloaded", () => {
		browserWindow.webContents.send("update-available")
	})

	setInterval(() => {
		if(syncingPaused){
			tray.setContextMenu(unpauseTrayMenu)
			tray.setImage(nativeImageTrayIconPaused)
		}
		else{
			tray.setContextMenu(normalTrayMenu)

			if(syncTasks > 0){
				tray.setImage(nativeImageTrayIconSyncing)
			}
			else{
				tray.setImage(nativeImageTrayIconNormal)
			}
		}
	}, 1000)

  	const initInterval = setInterval(() => {
  		if(rendererReady){
  			clearInterval(initInterval)

  			return init()
  		}
  	}, 50)
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