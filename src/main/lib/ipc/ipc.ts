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
	path: app.getPath("exe")
})

let syncIssues: SyncIssue[] = []

export const encodeError = (e: any) => {
	return {
		name: e.name,
		message: e.message,
		extra: {
			...e
		}
	}
}

export const handlerProxy = (channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => {
	ipcMain.handle(channel, async (...args) => {
		try {
			return {
				result: await Promise.resolve(handler(...args))
			}
		} catch (e) {
			return {
				error: encodeError(e)
			}
		}
	})
}

handlerProxy("db", async (_, { action, key, value }) => {
	if (action == "get") {
		return await db.get(key)
	} else if (action == "set") {
		await db.set(key, value)
	} else if (action == "remove") {
		await db.remove(key)
	} else if (action == "clear") {
		await db.clear()
	} else if (action == "keys") {
		return db.keys()
	} else {
		throw new Error("Invalid db action: " + action.toString())
	}
})

handlerProxy("ping", async () => {
	return "pong"
})

handlerProxy("getAppPath", async (_, { path }) => {
	return app.getPath(path)
})

handlerProxy("closeAuthWindow", async () => {
	if (!memoryCache.has("AUTH_WINDOW")) {
		return
	}

	try {
		memoryCache.get("AUTH_WINDOW").close()
	} catch (e) {
		log.error(e)
	}
})

handlerProxy("createMainWindow", async () => {
	if (memoryCache.has("MAIN_WINDOW")) {
		return
	}

	await createMain(true)
})

handlerProxy("loginDone", async () => {
	if (memoryCache.has("MAIN_WINDOW")) {
		try {
			memoryCache.get("MAIN_WINDOW").close()
		} catch (e) {
			log.error(e)
		}
	}

	await createMain(true)

	if (memoryCache.has("AUTH_WINDOW")) {
		try {
			memoryCache.get("AUTH_WINDOW").close()
		} catch (e) {
			log.error(e)
		}
	}

	return true
})

handlerProxy("openSettingsWindow", async (_, { page }) => {
	await createSettings(page)
})

handlerProxy("selectFolder", async () => {
	let selectWindow = BrowserWindow.getFocusedWindow()

	if (!selectWindow) {
		selectWindow = memoryCache.get("WORKER_WINDOW")

		if (!selectWindow) {
			selectWindow = memoryCache.get("MAIN_WINDOW")
		}
	}

	if (!selectWindow) {
		return
	}

	return await dialog.showOpenDialog(selectWindow, {
		properties: ["openDirectory"]
	})
})

handlerProxy("selectRemoteFolder", async () => {
	const window = await createCloud("selectFolder")
	const windowId = window.id

	return await new Promise((resolve, reject) => {
		const listener = (_: any, data: any) => {
			if (parseInt(data.windowId) !== windowId) {
				return
			}

			window.close()

			ipcMain.removeListener("remoteFolderSelected", listener)

			resolve(data)
		}

		ipcMain.on("remoteFolderSelected", listener)

		window.once("closed", () =>
			resolve({
				canceled: true
			})
		)
	})
})

handlerProxy("restartApp", async () => {
	app.relaunch()
	app.exit()
})

handlerProxy("minimizeWindow", async (_, { window, windowId }) => {
	if (window == "settings") {
		const windows = memoryCache.get("SETTINGS_WINDOWS")

		if (windows) {
			for (const prop in windows) {
				if (parseInt(windowId) == windows[prop].id) {
					windows[prop].minimize()
				}
			}
		}
	} else if (window == "auth") {
		try {
			memoryCache.get("AUTH_WINDOW").minimize()
		} catch (e) {
			log.error(e)
		}
	} else if (window == "cloud") {
		const windows = memoryCache.get("CLOUD_WINDOWS")

		if (windows) {
			for (const prop in windows) {
				if (parseInt(windowId) == windows[prop].id) {
					windows[prop].minimize()
				}
			}
		}
	} else if (window == "download") {
		const windows = memoryCache.get("DOWNLOAD_WINDOWS")

		if (windows) {
			for (const prop in windows) {
				if (parseInt(windowId) == windows[prop].id) {
					windows[prop].minimize()
				}
			}
		}
	} else if (window == "upload") {
		const windows = memoryCache.get("UPLOAD_WINDOWS")

		if (windows) {
			for (const prop in windows) {
				if (parseInt(windowId) == windows[prop].id) {
					windows[prop].minimize()
				}
			}
		}
	} else if (window == "selectiveSync") {
		const windows = memoryCache.get("SELECTIVE_SYNC_WINDOWS")

		if (windows) {
			for (const prop in windows) {
				if (parseInt(windowId) == windows[prop].id) {
					windows[prop].minimize()
				}
			}
		}
	} else if (window == "main") {
		try {
			memoryCache.get("MAIN_WINDOW").minimize()
		} catch (e) {
			log.error(e)
		}
	} else if (window == "update") {
		try {
			memoryCache.get("UPDATE_WINDOW").minimize()
		} catch (e) {
			log.error(e)
		}
	}

	return true
})

handlerProxy("closeWindow", async (_, { window, windowId }) => {
	if (window == "settings") {
		const windows = memoryCache.get("SETTINGS_WINDOWS")

		if (windows) {
			for (const prop in windows) {
				if (parseInt(windowId) == windows[prop].id) {
					windows[prop].close()
				}
			}
		}
	} else if (window == "auth") {
		app.quit()
	} else if (window == "cloud") {
		const windows = memoryCache.get("CLOUD_WINDOWS")

		if (windows) {
			for (const prop in windows) {
				if (parseInt(windowId) == windows[prop].id) {
					windows[prop].close()
				}
			}
		}
	} else if (window == "download") {
		const windows = memoryCache.get("DOWNLOAD_WINDOWS")

		if (windows) {
			for (const prop in windows) {
				if (parseInt(windowId) == windows[prop].id) {
					windows[prop].close()
				}
			}
		}
	} else if (window == "upload") {
		const windows = memoryCache.get("UPLOAD_WINDOWS")

		if (windows) {
			for (const prop in windows) {
				if (parseInt(windowId) == windows[prop].id) {
					windows[prop].close()
				}
			}
		}
	} else if (window == "selectiveSync") {
		const windows = memoryCache.get("SELECTIVE_SYNC_WINDOWS")

		if (windows) {
			for (const prop in windows) {
				if (parseInt(windowId) == windows[prop].id) {
					windows[prop].close()
				}
			}
		}
	} else if (window == "main") {
		try {
			memoryCache.get("MAIN_WINDOW").minimize()
		} catch (e) {
			log.error(e)
		}
	} else if (window == "update") {
		try {
			memoryCache.get("UPDATE_WINDOW").close()
		} catch (e) {
			log.error(e)
		}
	}

	return true
})

handlerProxy("setOpenOnStartup", async (_, { open }) => {
	const promise = open ? autoLauncher.enable() : autoLauncher.disable()

	await promise

	return true
})

handlerProxy("getOpenOnStartup", async () => {
	return await autoLauncher.isEnabled()
})

handlerProxy("getVersion", async () => {
	return app.getVersion()
})

handlerProxy("saveLogs", async () => {
	let selectWindow = BrowserWindow.getFocusedWindow()

	if (selectWindow == null) {
		selectWindow = memoryCache.get("WORKER_WINDOW")

		if (selectWindow) {
			selectWindow = memoryCache.get("MAIN_WINDOW")
		}
	}

	if (!selectWindow) {
		return
	}

	const result = await dialog.showOpenDialog(selectWindow, {
		properties: ["openDirectory"]
	})

	if (result.canceled) {
		return
	}

	const paths = result.filePaths

	if (!Array.isArray(paths)) {
		return
	}

	const localPath = paths[0]

	if (typeof localPath !== "string") {
		return
	}

	const logsPath = pathModule.normalize(pathModule.join(log.transports.file.getFile().path, "../"))
	const savePath = pathModule.normalize(localPath + "/filenLogs/")

	await fs.copy(logsPath, savePath, {
		overwrite: true,
		recursive: true
	})
})

handlerProxy("updateTrayIcon", async (_, { type }) => {
	updateTrayIcon(type)
})

handlerProxy("updateTrayMenu", async () => {
	await updateTrayMenu()
})

handlerProxy("updateTrayTooltip", async (_, { text }) => {
	updateTrayTooltip(text)
})

handlerProxy("getFileIcon", async (_, { path }) => {
	if (memoryCache.has("fileIcon:" + path)) {
		return memoryCache.get("fileIcon:" + path)
	}

	const image = await app.getFileIcon(pathModule.normalize(path))
	const dataURL = image.toDataURL()

	memoryCache.set("fileIcon:" + path, dataURL)

	return dataURL
})

handlerProxy("getFileIconExt", async (_, { ext }) => {
	if (memoryCache.has("fileIconExt:" + ext)) {
		return memoryCache.get("fileIconExt:" + ext)
	}

	const tempPath = pathModule.normalize(
		pathModule.join(
			app.getPath("temp"),
			uuidv4() + (typeof ext == "string" && ext.length > 0 ? (ext.indexOf(".") == -1 ? "" : "." + ext) : "")
		)
	)

	await fs.writeFile(tempPath, "")

	const image = await app.getFileIcon(tempPath)
	const dataURL = image.toDataURL()

	await fs.unlink(tempPath)

	memoryCache.set("fileIconExt:" + ext, dataURL)

	return dataURL
})

handlerProxy("getFileIconName", async (_, { name }) => {
	if (memoryCache.has("getFileIconName:" + name)) {
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

handlerProxy("quitApp", async () => {
	app.exit(0)
})

handlerProxy("exitApp", async () => {
	app.exit(0)
})

handlerProxy("openDownloadWindow", async (_, { args }) => {
	await createDownload(args)
})

handlerProxy("openSelectiveSyncWindow", async (_, location) => {
	await createSelectiveSync(location)
})

handlerProxy("updateKeybinds", async () => {
	return await updateKeybinds()
})

handlerProxy("disableKeybinds", async () => {
	globalShortcut.unregisterAll()
})

handlerProxy("openUploadWindow", async (_, { type }) => {
	upload(type)
})

handlerProxy("installUpdate", async () => {
	await new Promise(resolve => {
		setTimeout(() => {
			try {
				app.removeAllListeners("window-all-closed")

				const allWindows = BrowserWindow.getAllWindows()

				for (let i = 0; i < allWindows.length; i++) {
					allWindows[i].destroy()
				}

				autoUpdater.quitAndInstall(false, true)

				if (is.windows()) {
					setTimeout(() => app.exit(0), 1000)
				}

				return resolve(true)
			} catch (e) {
				log.error(e)

				return resolve(true)
			}
		}, 1000)
	})
})

handlerProxy("trayAvailable", async () => {
	const trayAvailable = memoryCache.get("trayAvailable")

	if (typeof trayAvailable == "boolean") {
		return trayAvailable
	}

	return false
})

handlerProxy("initWatcher", async (_, { path, locationUUID }) => {
	await watch(path, locationUUID)
})

handlerProxy("addSyncIssue", async (_, syncIssue) => {
	syncIssues.push(syncIssue)
})

handlerProxy("removeSyncIssue", async (_, uuid) => {
	syncIssues = syncIssues.filter(issue => issue.uuid !== uuid)
})

handlerProxy("getSyncIssues", async () => {
	return syncIssues
})

handlerProxy("clearSyncIssues", async () => {
	syncIssues = []
})

handlerProxy("fsNormalizePath", async (_, path) => {
	return fsLocal.normalizePath(path)
})

handlerProxy("fsGetTempDir", async () => {
	return fsLocal.getTempDir()
})

handlerProxy("fsGracefulLStat", async (_, path) => {
	return await fsLocal.gracefulLStat(path)
})

handlerProxy("fsExists", async (_, path) => {
	return await fsLocal.exists(path)
})

handlerProxy("fsDoesExistLocally", async (_, path) => {
	return await fsLocal.doesExistLocally(path)
})

handlerProxy("fsCanReadWriteAtPath", async (_, path) => {
	return await fsLocal.canReadWriteAtPath(path)
})

handlerProxy("fsSmokeTest", async (_, path) => {
	return await fsLocal.smokeTest(path)
})

handlerProxy("fsReadChunk", async (_, { path, offset, length }) => {
	return await fsLocal.readChunk(path, offset, length)
})

handlerProxy("fsRm", async (_, { path, location }) => {
	return await fsLocal.rm(path, location)
})

handlerProxy("fsRmPermanent", async (_, path) => {
	return await fsLocal.rmPermanent(path)
})

handlerProxy("fsMkdir", async (_, { path, location }) => {
	return await fsLocal.mkdir(path, location)
})

handlerProxy("fsMove", async (_, { before, after, overwrite }) => {
	return await fsLocal.move(before, after, overwrite)
})

handlerProxy("fsRename", async (_, { before, after }) => {
	return await fsLocal.rename(before, after)
})

handlerProxy("fsCreateLocalTrashDirs", async () => {
	return await fsLocal.createLocalTrashDirs()
})

handlerProxy("fsClearLocalTrashDirs", async (_, clearNow) => {
	return await fsLocal.clearLocalTrashDirs(clearNow)
})

handlerProxy("fsInitLocalTrashDirs", async () => {
	fsLocal.initLocalTrashDirs()
})

handlerProxy("fsCheckLastModified", async (_, path) => {
	return await fsLocal.checkLastModified(path)
})

handlerProxy("fsCanReadAtPath", async (_, path) => {
	return await fsLocal.canReadAtPath(path)
})

handlerProxy("fsIsFileBusy", async (_, path) => {
	return await fsLocal.isFileBusy(path)
})

handlerProxy("fsDirectoryTree", async (_, { path, skipCache, location }) => {
	return await fsLocal.directoryTree(path, skipCache, location)
})

handlerProxy("fsUnlink", async (_, path) => {
	return await fsLocal.unlink(path)
})

handlerProxy("fsUtimes", async (_, { path, atime, mtime }) => {
	return await fsLocal.utimes(path, atime, mtime)
})

handlerProxy("fsRemove", async (_, path) => {
	return await fsLocal.remove(path)
})

handlerProxy("fsMkdirNormal", async (_, { path, options }) => {
	return await fsLocal.mkdirNormal(path, options)
})

handlerProxy("fsAccess", async (_, { path, mode }) => {
	return await fsLocal.access(path, mode)
})

handlerProxy("fsAppendFile", async (_, { path, data, options }) => {
	return await fsLocal.appendFile(path, data, options)
})

handlerProxy("fsEnsureDir", async (_, path) => {
	return await fsLocal.ensureDir(path)
})

handlerProxy("emitGlobal", async (_, { channel, data }) => {
	emitGlobal(channel, data)
})

handlerProxy("loadApplyDoneTasks", async (_, locationUUID) => {
	return await fsLocal.loadApplyDoneTasks(locationUUID)
})

handlerProxy("clearApplyDoneTasks", async (_, locationUUID) => {
	return await fsLocal.clearApplyDoneTasks(locationUUID)
})

handlerProxy("addToApplyDoneTasks", async (_, { locationUUID, task }) => {
	return await fsLocal.addToApplyDoneTasks(locationUUID, task)
})

export const updateKeybinds = async (): Promise<void> => {
	let keybinds = await db.get("keybinds")

	if (!Array.isArray(keybinds)) {
		keybinds = []
	}

	globalShortcut.unregisterAll()

	for (let i = 0; i < keybinds.length; i++) {
		if (typeof keybinds[i].keybind !== "string") {
			continue
		}

		globalShortcut.register(keybinds[i].keybind, () => {
			if (keybinds[i].type == "uploadFolders") {
				upload("folders")
			} else if (keybinds[i].type == "uploadFiles") {
				upload("files")
			} else if (keybinds[i].type == "openSettings") {
				createSettings().catch(log.error)
			} else if (keybinds[i].type == "pauseSync") {
				db.set("paused", true).catch(log.error)
			} else if (keybinds[i].type == "resumeSync") {
				db.set("paused", false).catch(log.error)
			}
		})
	}
}

export const emitGlobal = (channel: string = "global-message", data: any) => {
	try {
		if (memoryCache.has("MAIN_WINDOW")) {
			memoryCache.get("MAIN_WINDOW").webContents.send(channel, data)
		}

		if (memoryCache.has("WORKER_WINDOW")) {
			memoryCache.get("WORKER_WINDOW").webContents.send(channel, data)
		}

		if (memoryCache.has("AUTH_WINDOW")) {
			memoryCache.get("AUTH_WINDOW").webContents.send(channel, data)
		}

		if (memoryCache.has("UPDATE_WINDOW")) {
			memoryCache.get("UPDATE_WINDOW").webContents.send(channel, data)
		}

		const settingsWindows = memoryCache.get("SETTINGS_WINDOWS")

		if (settingsWindows) {
			for (const id in settingsWindows) {
				settingsWindows[id].webContents.send(channel, data)
			}
		}

		const downloadWindows = memoryCache.get("DOWNLOAD_WINDOWS")

		if (downloadWindows) {
			for (const id in downloadWindows) {
				downloadWindows[id].webContents.send(channel, data)
			}
		}

		const cloudWindows = memoryCache.get("CLOUD_WINDOWS")

		if (cloudWindows) {
			for (const id in cloudWindows) {
				cloudWindows[id].webContents.send(channel, data)
			}
		}

		const uploadWindows = memoryCache.get("UPLOAD_WINDOWS")

		if (uploadWindows) {
			for (const id in uploadWindows) {
				uploadWindows[id].webContents.send(channel, data)
			}
		}

		const selectiveSyncWindows = memoryCache.get("SELECTIVE_SYNC_WINDOWS")

		if (selectiveSyncWindows) {
			for (const id in selectiveSyncWindows) {
				selectiveSyncWindows[id].webContents.send(channel, data)
			}
		}
	} catch (e) {
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
