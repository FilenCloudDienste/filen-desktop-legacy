process.noAsar = true

const { app, BrowserWindow, powerMonitor, powerSaveBlocker, Menu } = require("electron")
const { createWindows } = require("./lib/windows")
const log = require("electron-log")
const is = require("electron-is")
const { autoUpdater } = require("electron-updater")
const ipc = require("./lib/ipc")
const db = require("./lib/db")

let CHECK_UPDATE_INTERVAL = undefined
let POWER_SAVE_BLOCKER = null

autoUpdater.logger = log
autoUpdater.allowDowngrade = false
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

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
})

autoUpdater.on("update-available", (info) => {
	log.info("Update available:", info)
})

autoUpdater.on("update-not-available", (info) => {
	log.info("No update available:", info)
})

autoUpdater.on("error", (err) => {
	log.info(err)
})

autoUpdater.on("download-progress", (progress) => {
	log.info("Downloading update:", progress)
})

autoUpdater.on("update-downloaded", (info) => {
	log.info("Update downloaded:", info)
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
	db.set("suspend", false).catch(log.error)
})

powerMonitor.on("unlock-screen", () => {
	db.set("suspend", false).catch(log.error)
})

if(!app.requestSingleInstanceLock()){
	app.quit()
}
else{
	app.whenReady().then(() => {
		Menu.setApplicationMenu(Menu.buildFromTemplate([]))

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