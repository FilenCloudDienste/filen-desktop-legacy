process.noAsar = true

const { app, BrowserWindow, powerMonitor, powerSaveBlocker, Menu } = require("electron")
const { createWindows, createUpdate } = require("./lib/windows")
const log = require("electron-log")
const is = require("electron-is")
const { autoUpdater } = require("electron-updater")
const ipc = require("./lib/ipc")
const db = require("./lib/db")
const { v4: uuidv4 } = require("uuid")

Object.assign(console, log.functions)

let CHECK_UPDATE_INTERVAL = undefined
let POWER_SAVE_BLOCKER = null
let UPDATE_WINDOW_SHOWN = false

autoUpdater.logger = log
autoUpdater.allowDowngrade = false
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = false

const initWindows = () => {
	log.info("Initializing startup windows")

	createWindows().then(() => {
		log.info("Init startup windows done")
	}).catch((err) => {
		log.error("Startup windows error")
		log.error(err)
	})
}

//app.commandLine.appendSwitch("wm-window-animations-disabled")
app.commandLine.appendSwitch("disable-renderer-backgrounding")
app.commandLine.appendSwitch("disable-pinch")
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=8192")

if(is.dev()){
	app.commandLine.appendSwitch("ignore-certificate-errors")
	app.commandLine.appendSwitch("allow-insecure-localhost", "true")
}

autoUpdater.on("checking-for-update", () => {
	log.info("Checking if an update is available")

	ipc.emitGlobal("checkingForUpdate")
})

autoUpdater.on("update-available", (info) => {
	log.info("Update available:", info)

	ipc.emitGlobal("updateAvailable", info)
})

autoUpdater.on("update-not-available", (info) => {
	log.info("No update available:", info)

	ipc.emitGlobal("updateNotAvailable", info)
})

autoUpdater.on("error", (err) => {
	log.info(err)

	ipc.emitGlobal("updateError", err)
})

autoUpdater.on("download-progress", (progress) => {
	log.info("Downloading update:", progress)

	ipc.emitGlobal("updateDownloadProgress", progress)
})

autoUpdater.on("update-downloaded", (info) => {
	log.info("Update downloaded:", info)

	ipc.emitGlobal("updateDownloaded", info)

	if(!UPDATE_WINDOW_SHOWN){
		UPDATE_WINDOW_SHOWN = true
		autoUpdater.autoInstallOnAppQuit = false

		setTimeout(() => {
			createUpdate(uuidv4(), info.version).catch((err) => {
				log.error(err)
	
				UPDATE_WINDOW_SHOWN = false
			})
		}, 5000)
	}
})

app.on("window-all-closed", () => {
  	if(process.platform !== "darwin"){
    	app.quit()
  	}
})

app.on("activate", () => {
  	if(BrowserWindow.getAllWindows().length == 0){
    	initWindows()
  	}
})

powerMonitor.on("shutdown", () => {
	powerSaveBlocker.stop(POWER_SAVE_BLOCKER)

	app.exit(0)
})

powerMonitor.on("lock-screen", () => {
	db.set("suspend", true).catch(log.error)
})

powerMonitor.on("suspend", () => {
	db.set("suspend", true).catch(log.error)
})

powerMonitor.on("resume", () => {
	setTimeout(() => db.set("suspend", false).catch(log.error), 5000)
})

powerMonitor.on("unlock-screen", () => {
	setTimeout(() => db.set("suspend", false).catch(log.error), 5000)
})

if(!app.requestSingleInstanceLock()){
	app.quit()
}
else{
	app.whenReady().then(() => {
		Menu.setApplicationMenu(Menu.buildFromTemplate([
			{
				label: "Application",
				submenu: [
					{
						label: "About Application",
						selector: "orderFrontStandardAboutPanel:"
					},
					{
						type: "separator"
					},
					{
						label: "Quit",
						accelerator: "Command+Q",
						click: () => {
							app.quit()
						} 
					}
				]
			},
			{
				label: "Edit",
				submenu: [
					{
						label: "Undo",
						accelerator: "CmdOrCtrl+Z",
						selector: "undo:"
					},
					{
						label: "Redo",
						accelerator: "Shift+CmdOrCtrl+Z",
						selector: "redo:"
					},
					{
						type: "separator"
					},
					{
						label: "Cut",
						accelerator: "CmdOrCtrl+X",
						selector: "cut:"
					},
					{
						label: "Copy",
						accelerator: "CmdOrCtrl+C",
						selector: "copy:"
					},
					{
						label: "Paste",
						accelerator: "CmdOrCtrl+V",
						selector: "paste:"
					},
					{
						label: "Select All",
						accelerator: "CmdOrCtrl+A",
						selector: "selectAll:"
					}
				]
			}
		]))

		POWER_SAVE_BLOCKER = powerSaveBlocker.start("prevent-app-suspension")

		autoUpdater.checkForUpdates().catch(log.error)
	
		clearInterval(CHECK_UPDATE_INTERVAL)
	
		CHECK_UPDATE_INTERVAL = setInterval(() => {
			autoUpdater.checkForUpdates().catch(log.error)
		}, 300000)
	
		initWindows()
		
		ipc.updateKeybinds().catch(log.error)
	})
}