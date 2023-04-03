import { BrowserWindow, app, nativeImage, ipcMain } from "electron"
import path from "path"
import is from "electron-is"
import log from "electron-log"
import { v4 as uuidv4 } from "uuid"
import { Base64 } from "js-base64"
import memoryCache from "../memoryCache"
import { positionWindow, createTray } from "../tray"
import { listen } from "../ipc"
import db from "../db"
import { Location } from "../../../types"

const STATIC_PATH = is.dev()
	? "http://localhost:3000/"
	: "file://" + path.join(__dirname, "../../../../build/index.html")
const DEV_TOOLS = is.dev() ? true : false
let activeWindows: { id: number; type: string }[] = []

export const wasOpenedAtSystemStart = (): boolean => {
	try {
		if (is.macOS()) {
			const loginSettings = app.getLoginItemSettings()

			return loginSettings.wasOpenedAtLogin
		}

		return app.commandLine.hasSwitch("hidden")
	} catch (e) {
		log.error(e)

		return false
	}
}

export const createMain = async (show: boolean = false): Promise<BrowserWindow> => {
	if (!memoryCache.has("trayAvailable")) {
		show = true
	}

	if (wasOpenedAtSystemStart()) {
		show = false
	}

	if (memoryCache.has("MAIN_WINDOW")) {
		try {
			memoryCache.get("MAIN_WINDOW").close()
		} catch (e) {
			log.error(e)
		}
	}

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
		skipTaskbar: is.macOS() || is.windows() ? true : false,
		fullscreenable: false,
		maximizable: false,
		minimizable: true,
		hasShadow: false,
		show,
		backgroundColor: "rgba(0, 0, 0, 0)",
		...(is.linux() && !is.dev()
			? {
					icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png"))
			  }
			: is.windows() && !is.dev()
			? {
					icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico")
			  }
			: {
					icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns")
			  })
	})

	const windowId = window.id

	window.setResizable(false)
	window.setMenu(null)

	if (is.macOS() || is.windows()) {
		window.setAlwaysOnTop(true, "pop-up-menu")
		window.setMenuBarVisibility(false)
	}

	createTray().catch(log.error)

	window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "#main")

	if (DEV_TOOLS) {
		window.webContents.openDevTools({ mode: "detach" })
	}

	window.on("close", e => {
		e.preventDefault()

		window.hide()
	})

	window.once("closed", () => {
		memoryCache.delete("MAIN_WINDOW")

		activeWindows = activeWindows.filter(w => w.id !== windowId)
	})

	window.once("show", () => {
		positionWindow()

		setTimeout(() => {
			window.on("blur", () => {
				if (!memoryCache.has("trayAvailable")) {
					return
				}

				window.hide()
			})
		}, 1000)

		setTimeout(() => window.focus(), 250)
	})

	ipcMain.once("window-ready", (_, id) => {
		positionWindow()

		if (parseInt(id) == windowId && show) {
			window.show()
		}
	})

	memoryCache.set("MAIN_WINDOW", window)

	activeWindows.push({ id: windowId, type: "MAIN_WINDOW" })

	positionWindow()

	return window
}

export const createSettings = async (page: string = "general"): Promise<BrowserWindow> => {
	const currentSettingsWindows = memoryCache.get("SETTINGS_WINDOWS")

	if (currentSettingsWindows) {
		for (const id in currentSettingsWindows) {
			try {
				currentSettingsWindows[id].close()
			} catch (e) {
				log.error(e)
			}
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
		...(is.linux() && !is.dev()
			? {
					icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png"))
			  }
			: is.windows() && !is.dev()
			? {
					icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico")
			  }
			: {
					icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns")
			  })
	})

	const windowId = window.id

	window.loadURL(STATIC_PATH + "?page=" + page + "&id=" + encodeURIComponent(windowId) + "#settings")

	if (DEV_TOOLS) {
		window.webContents.openDevTools({ mode: "detach" })
	}

	window.once("closed", () => {
		const settingsWindows = memoryCache.get("SETTINGS_WINDOWS")

		if (settingsWindows) {
			for (const id in settingsWindows) {
				if (parseInt(id) == windowId) {
					delete settingsWindows[id]
				}
			}

			memoryCache.set("SETTINGS_WINDOWS", settingsWindows)
		}

		activeWindows = activeWindows.filter(w => w.id !== windowId)

		if (is.macOS()) {
			const active = JSON.stringify(activeWindows.map(w => w.type))

			if (
				JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active ||
				JSON.stringify(["MAIN_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW"]) == active
			) {
				app.dock.hide()
			}
		}
	})

	window.once("show", () => setTimeout(() => window.focus(), 250))

	ipcMain.once("window-ready", (_, id) => {
		if (parseInt(id) == windowId) {
			window.show()
		}
	})

	if (is.macOS()) {
		window.once("show", () => {
			app.dock.show().catch(log.error)
		})
	}

	let settingsWindows = memoryCache.get("SETTINGS_WINDOWS")

	if (settingsWindows) {
		settingsWindows[windowId] = window
	} else {
		settingsWindows = {}
		settingsWindows[windowId] = window
	}

	memoryCache.set("SETTINGS_WINDOWS", settingsWindows)

	activeWindows.push({ id: windowId, type: "SETTINGS_WINDOWS" })

	return window
}

export const createUpload = async (args: Record<string, unknown> = {}): Promise<BrowserWindow> => {
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
		...(is.linux() && !is.dev()
			? {
					icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png"))
			  }
			: is.windows() && !is.dev()
			? {
					icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico")
			  }
			: {
					icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns")
			  })
	})

	const windowId = window.id

	window.loadURL(
		STATIC_PATH +
			"?args=" +
			encodeURIComponent(Base64.encode(JSON.stringify(args))) +
			"&id=" +
			encodeURIComponent(windowId) +
			"#upload"
	)

	if (DEV_TOOLS) {
		window.webContents.openDevTools({ mode: "detach" })
	}

	window.once("closed", () => {
		const currentUploadWindows = memoryCache.get("UPLOAD_WINDOWS")

		if (currentUploadWindows) {
			for (const id in currentUploadWindows) {
				if (parseInt(id) == windowId) {
					delete currentUploadWindows[id]
				}
			}

			memoryCache.set("UPLOAD_WINDOWS", currentUploadWindows)
		}

		activeWindows = activeWindows.filter(w => w.id !== windowId)

		if (is.macOS()) {
			const active = JSON.stringify(activeWindows.map(w => w.type))

			if (
				JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active ||
				JSON.stringify(["MAIN_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW"]) == active
			) {
				app.dock.hide()
			}
		}
	})

	window.once("show", () => setTimeout(() => window.focus(), 250))

	ipcMain.once("window-ready", (_, id) => {
		if (parseInt(id) == windowId) {
			window.show()
		}
	})

	if (is.macOS()) {
		window.once("show", () => {
			app.dock.show().catch(log.error)
		})
	}

	let uploadWindows = memoryCache.get("UPLOAD_WINDOWS")

	if (uploadWindows) {
		uploadWindows[windowId] = window
	} else {
		uploadWindows = {}
		uploadWindows[windowId] = window
	}

	memoryCache.set("UPLOAD_WINDOWS", uploadWindows)

	activeWindows.push({ id: windowId, type: "UPLOAD_WINDOWS" })

	return window
}

export const createDownload = async (args: Record<string, unknown> = {}): Promise<BrowserWindow> => {
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
		...(is.linux() && !is.dev()
			? {
					icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png"))
			  }
			: is.windows() && !is.dev()
			? {
					icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico")
			  }
			: {
					icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns")
			  })
	})

	const windowId = window.id

	window.loadURL(
		STATIC_PATH +
			"?args=" +
			encodeURIComponent(Base64.encode(JSON.stringify(args))) +
			"&id=" +
			encodeURIComponent(windowId) +
			"#download"
	)

	if (DEV_TOOLS) {
		window.webContents.openDevTools({ mode: "detach" })
	}

	window.once("closed", () => {
		const currentDownloadWindows = memoryCache.get("DOWNLOAD_WINDOWS")

		if (currentDownloadWindows) {
			for (const id in currentDownloadWindows) {
				if (parseInt(id) == windowId) {
					delete currentDownloadWindows[id]
				}
			}

			memoryCache.set("DOWNLOAD_WINDOWS", currentDownloadWindows)
		}

		activeWindows = activeWindows.filter(w => w.id !== windowId)

		if (is.macOS()) {
			const active = JSON.stringify(activeWindows.map(w => w.type))

			if (
				JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active ||
				JSON.stringify(["MAIN_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW"]) == active
			) {
				app.dock.hide()
			}
		}
	})

	window.once("show", () => setTimeout(() => window.focus(), 250))

	ipcMain.once("window-ready", (_, id) => {
		if (parseInt(id) == windowId) {
			window.show()
		}
	})

	if (is.macOS()) {
		window.once("show", () => {
			app.dock.show().catch(log.error)
		})
	}

	let downloadWindows = memoryCache.get("DOWNLOAD_WINDOWS")

	if (downloadWindows) {
		downloadWindows[windowId] = window
	} else {
		downloadWindows = {}
		downloadWindows[windowId] = window
	}

	memoryCache.set("DOWNLOAD_WINDOWS", downloadWindows)

	activeWindows.push({ id: windowId, type: "DOWNLOAD_WINDOWS" })

	return window
}

export const createCloud = async (mode: string = "selectFolder"): Promise<BrowserWindow> => {
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
		...(is.linux() && !is.dev()
			? {
					icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png"))
			  }
			: is.windows() && !is.dev()
			? {
					icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico")
			  }
			: {
					icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns")
			  })
	})

	const windowId = window.id

	window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "&mode=" + mode + "#cloud")

	if (DEV_TOOLS) {
		window.webContents.openDevTools({ mode: "detach" })
	}

	window.once("closed", () => {
		const cloudWindows = memoryCache.get("CLOUD_WINDOWS")

		if (cloudWindows) {
			for (const id in cloudWindows) {
				if (parseInt(id) == windowId) {
					delete cloudWindows[id]
				}
			}

			memoryCache.set("CLOUD_WINDOWS", cloudWindows)
		}

		activeWindows = activeWindows.filter(w => w.id !== windowId)

		if (is.macOS()) {
			const active = JSON.stringify(activeWindows.map(w => w.type))

			if (
				JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active ||
				JSON.stringify(["MAIN_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW"]) == active
			) {
				app.dock.hide()
			}
		}
	})

	window.once("show", () => setTimeout(() => window.focus(), 250))

	ipcMain.once("window-ready", (_, id) => {
		if (parseInt(id) == windowId) {
			window.show()
		}
	})

	if (is.macOS()) {
		window.once("show", () => {
			app.dock.show().catch(log.error)
		})
	}

	let cloudWindows = memoryCache.get("CLOUD_WINDOWS")

	if (cloudWindows) {
		cloudWindows[windowId] = window
	} else {
		cloudWindows = {}
		cloudWindows[windowId] = window
	}

	memoryCache.set("CLOUD_WINDOWS", cloudWindows)

	activeWindows.push({ id: windowId, type: "CLOUD_WINDOWS" })

	return window
}

export const createSelectiveSync = async (location: Location): Promise<BrowserWindow> => {
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
		...(is.linux() && !is.dev()
			? {
					icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png"))
			  }
			: is.windows() && !is.dev()
			? {
					icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico")
			  }
			: {
					icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns")
			  })
	})

	const windowId = window.id

	window.loadURL(
		STATIC_PATH +
			"?id=" +
			encodeURIComponent(windowId) +
			"&args=" +
			encodeURIComponent(Base64.encode(JSON.stringify(location))) +
			"#selectiveSync"
	)

	if (DEV_TOOLS) {
		window.webContents.openDevTools({ mode: "detach" })
	}

	window.once("closed", () => {
		const selectiveSyncWindows = memoryCache.get("SELECTIVE_SYNC_WINDOWS")

		if (selectiveSyncWindows) {
			for (const id in selectiveSyncWindows) {
				if (parseInt(id) == windowId) {
					delete selectiveSyncWindows[id]
				}
			}

			memoryCache.set("SELECTIVE_SYNC_WINDOWS", selectiveSyncWindows)
		}

		activeWindows = activeWindows.filter(w => w.id !== windowId)

		if (is.macOS()) {
			const active = JSON.stringify(activeWindows.map(w => w.type))

			if (
				JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active ||
				JSON.stringify(["MAIN_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW"]) == active
			) {
				app.dock.hide()
			}
		}
	})

	window.once("show", () => setTimeout(() => window.focus(), 250))

	ipcMain.once("window-ready", (_, id) => {
		if (parseInt(id) == windowId) {
			window.show()
		}
	})

	if (is.macOS()) {
		window.once("show", () => {
			app.dock.show().catch(log.error)
		})
	}

	let selectiveSyncWindows = memoryCache.get("SELECTIVE_SYNC_WINDOWS")

	if (selectiveSyncWindows) {
		selectiveSyncWindows[windowId] = window
	} else {
		selectiveSyncWindows = {}
		selectiveSyncWindows[windowId] = window
	}

	memoryCache.set("SELECTIVE_SYNC_WINDOWS", selectiveSyncWindows)

	activeWindows.push({ id: windowId, type: "SELECTIVE_SYNC_WINDOWS" })

	return window
}

export const createAuth = async (): Promise<BrowserWindow> => {
	if (memoryCache.has("AUTH_WINDOW")) {
		try {
			memoryCache.get("AUTH_WINDOW").get("AUTH_WINDOW").close()
		} catch (e) {
			log.error(e)
		}
	}

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
		...(is.linux() && !is.dev()
			? {
					icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png"))
			  }
			: is.windows() && !is.dev()
			? {
					icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico")
			  }
			: {
					icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns")
			  })
	})

	const windowId = window.id

	window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "#auth")

	if (DEV_TOOLS) {
		window.webContents.openDevTools({ mode: "detach" })
	}

	window.once("closed", () => {
		memoryCache.delete("AUTH_WINDOW")

		setTimeout(() => {
			if (memoryCache.get("MAIN_WINDOW")) {
				app.quit()
			}
		}, 3000)

		activeWindows = activeWindows.filter(w => w.id !== windowId)

		if (is.macOS()) {
			const active = JSON.stringify(activeWindows.map(w => w.type))

			if (
				JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active ||
				JSON.stringify(["MAIN_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW"]) == active
			) {
				app.dock.hide()
			}
		}
	})

	window.once("show", () => setTimeout(() => window.focus(), 250))

	ipcMain.once("window-ready", (_, id) => {
		if (parseInt(id) == windowId) {
			window.show()
		}
	})

	if (is.macOS()) {
		window.once("show", () => {
			app.dock.show().catch(log.error)
		})
	}

	memoryCache.set("AUTH_WINDOW", window)

	activeWindows.push({ id: windowId, type: "AUTH_WINDOW" })

	return window
}

export const createUpdate = async (toVersion: string = "1"): Promise<BrowserWindow> => {
	if (memoryCache.has("UPDATE_WINDOW")) {
		try {
			memoryCache.get("UPDATE_WINDOW").close()
		} catch (e) {
			log.error(e)
		}
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
		...(is.linux() && !is.dev()
			? {
					icon: nativeImage.createFromPath(path.join(__dirname, "../../../../assets/icons/png/1024x1024.png"))
			  }
			: is.windows() && !is.dev()
			? {
					icon: path.join(__dirname, "../../../../assets/icons/win/icon.ico")
			  }
			: {
					icon: path.join(__dirname, "../../../../assets/icons/mac/icon.icns")
			  })
	})

	const windowId = window.id

	window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "&toVersion=" + toVersion + "#update")

	if (DEV_TOOLS) {
		window.webContents.openDevTools({ mode: "detach" })
	}

	window.once("closed", () => {
		memoryCache.delete("UPDATE_WINDOW")

		activeWindows = activeWindows.filter(w => w.id !== windowId)

		if (is.macOS()) {
			const active = JSON.stringify(activeWindows.map(w => w.type))

			if (
				JSON.stringify(["MAIN_WINDOW", "WORKER_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW", "MAIN_WINDOW"]) == active ||
				JSON.stringify(["MAIN_WINDOW"]) == active ||
				JSON.stringify(["WORKER_WINDOW"]) == active
			) {
				app.dock.hide()
			}
		}
	})

	window.once("show", () => setTimeout(() => window.focus(), 250))

	ipcMain.once("window-ready", (_, id) => {
		if (parseInt(id) == windowId) {
			window.show()
		}
	})

	if (is.macOS()) {
		window.once("show", () => {
			app.dock.show().catch(log.error)
		})
	}

	memoryCache.set("UPDATE_WINDOW", window)

	return window
}

export const createWorker = async (): Promise<BrowserWindow> => {
	if (memoryCache.has("WORKER_WINDOW")) {
		try {
			memoryCache.get("WORKER_WINDOW").close()
		} catch (e) {
			log.error(e)
		}
	}

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

	const windowId = window.id

	await window.loadURL(STATIC_PATH + "?id=" + encodeURIComponent(windowId) + "#worker")

	if (DEV_TOOLS) {
		window.webContents.openDevTools({ mode: "detach" })
	}

	window.once("closed", () => {
		memoryCache.delete("WORKER_WINDOW")
		memoryCache.delete("WORKER_WINDOW_DEBUGGER")

		activeWindows = activeWindows.filter(w => w.id !== windowId)
	})

	memoryCache.set("WORKER_WINDOW", window)

	activeWindows.push({ id: windowId, type: "WORKER_WINDOW" })

	return window
}

export const createWindows = async (): Promise<void> => {
	await listen()

	const langSetManually = db.get("langSetManually")

	if (!langSetManually) {
		const locale = app.getLocale()

		if (["en", "de"].includes(locale)) {
			db.set("lang", locale)
		}
	}

	const [isLoggedIn, deviceId] = await Promise.all([db.get("isLoggedIn"), db.get("deviceId")])

	await createWorker()

	if (is.macOS()) {
		app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, "../src/assets/icons/png/512x512.png")))
		app.dock.hide()
	}

	if (!deviceId) {
		await db.set("deviceId", uuidv4())
	}

	if (isLoggedIn) {
		await createMain(false)
	} else {
		await createAuth()
	}
}
