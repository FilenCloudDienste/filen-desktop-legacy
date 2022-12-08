process.noAsar = true

const { app, BrowserWindow, powerMonitor, Menu } = require("electron")
const log = require("electron-log")
const is = require("electron-is")
const { autoUpdater } = require("electron-updater")
const { v4: uuidv4 } = require("uuid")
const Sentry = require("@sentry/electron/main")

app.disableHardwareAcceleration()
//app.commandLine.appendSwitch("wm-window-animations-disabled")
app.commandLine.appendSwitch("disable-renderer-backgrounding")
app.commandLine.appendSwitch("disable-pinch")
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=16384")
app.commandLine.appendSwitch("no-sandbox")
app.commandLine.appendSwitch("no-proxy-server")

if(is.dev()){
	app.commandLine.appendSwitch("ignore-certificate-errors")
	app.commandLine.appendSwitch("allow-insecure-localhost", "true")
}

if(!is.dev()){
	Sentry.init({
		dsn: "https://765df844a3364aff92ec3648f1815ff8@o4504039703314432.ingest.sentry.io/4504205266321408",
		onFatalError: (err) => {
			log.error(err)
		},
		beforeSend: (event, hint) =>{
            try{
                log.error(hint?.originalException)
				log.error(event?.exception?.values)
            }
            catch(e){
                console.error(e)
            }

            return event
        }
	})
}

let CHECK_UPDATE_INTERVAL = undefined
let UPDATE_WINDOW_SHOWN = false

autoUpdater.logger = log
autoUpdater.allowDowngrade = false
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = false

const initWindows = () => {
	log.info("Initializing startup windows")

	require("./lib/windows").createWindows().then(() => {
		log.info("Init startup windows done")
	}).catch((err) => {
		log.error("Startup windows error")
		log.error(err)
	})
}

autoUpdater.on("checking-for-update", () => {
	log.info("Checking if an update is available")

	require("./lib/ipc").emitGlobal("checkingForUpdate")
})

autoUpdater.on("update-available", (info) => {
	log.info("Update available:", info)

	require("./lib/ipc").emitGlobal("updateAvailable", info)
})

autoUpdater.on("update-not-available", (info) => {
	//log.info("No update available:", info)

	require("./lib/ipc").emitGlobal("updateNotAvailable", info)
})

autoUpdater.on("error", (err) => {
	log.info(err)

	require("./lib/ipc").emitGlobal("updateError", err)
})

autoUpdater.on("download-progress", (progress) => {
	log.info("Downloading update:", progress)

	require("./lib/ipc").emitGlobal("updateDownloadProgress", progress)
})

autoUpdater.on("update-downloaded", (info) => {
	log.info("Update downloaded:", info)

	require("./lib/ipc").emitGlobal("updateDownloaded", info)

	if(!UPDATE_WINDOW_SHOWN){
		UPDATE_WINDOW_SHOWN = true

		autoUpdater.autoInstallOnAppQuit = false

		setTimeout(() => {
			require("./lib/windows").createUpdate(uuidv4(), info.version).catch((err) => {
				log.error(err)
	
				UPDATE_WINDOW_SHOWN = false
			})
		}, 60000)
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

app.on("second-instance", () => {
	require("./lib/tray").positionWindow()
	require("./lib/tray").toggleMainWindow()
})

powerMonitor.on("shutdown", () => {
	app.exit(0)
})

powerMonitor.on("lock-screen", () => {
	require("./lib/db").set("suspend", true).catch(log.error)
})

powerMonitor.on("suspend", () => {
	require("./lib/db").set("suspend", true).catch(log.error)
})

powerMonitor.on("resume", () => {
	setTimeout(() => require("./lib/db").set("suspend", false).catch(log.error), 5000)
})

powerMonitor.on("unlock-screen", () => {
	setTimeout(() => require("./lib/db").set("suspend", false).catch(log.error), 5000)
})

if(!app.requestSingleInstanceLock()){
	app.quit()
}
else{
	app.whenReady().then(() => {
		app.setAccessibilitySupportEnabled(false)

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

		autoUpdater.checkForUpdates().catch(log.error)
	
		clearInterval(CHECK_UPDATE_INTERVAL)
	
		CHECK_UPDATE_INTERVAL = setInterval(() => {
			autoUpdater.checkForUpdates().catch(log.error)
		}, 300000)
	
		initWindows()
		
		require("./lib/ipc").updateKeybinds().catch(log.error)
	})
}