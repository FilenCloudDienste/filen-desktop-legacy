import eventListener from "../eventListener"
import { v4 as uuidv4 } from "uuid"
import db from "../db"
import { sendToAllPorts } from "../worker/ipc"
import { SyncIssue, Location } from "../../../types"

const { ipcRenderer } = window.require("electron")
const log = window.require("electron-log")

const DEBOUNCE_WATCHER_EVENT: Record<string, NodeJS.Timer> = {}

export const decodeError = ({ name, message, extra }: { name: string; message: string; extra: any }) => {
	const e = new Error(message)

	e.name = name

	Object.assign(e, extra)

	return e
}

export const invokeProxy = async <T>(channel: string, ...args: any[]): Promise<T> => {
	const { error, result } = await ipcRenderer.invoke(channel, ...args)

	if (error) {
		throw decodeError(error)
	}

	return result
}

ipcRenderer.on("global-message", (_: any, data: any) => {
	return handleGlobalMessage(data)
})

const handleGlobalMessage = (data: any) => {
	const { type } = data

	if (type == "dbSet") {
		const { key } = data.data

		eventListener.emit("dbSet", {
			key
		})
	} else if (type == "dbRemove") {
		const { key } = data.data

		eventListener.emit("dbRemove", {
			key
		})
	} else if (type == "dbClear") {
		eventListener.emit("dbClear")
	} else if (
		data.type == "uploadProgress" ||
		data.type == "downloadProgress" ||
		data.type == "syncTask" ||
		data.type == "syncStatus" ||
		data.type == "syncStatusLocation" ||
		data.type == "downloadProgressSeperate" ||
		data.type == "uploadProgressSeperate" ||
		data.type == "syncTasksToDo"
	) {
		eventListener.emit(data.type, data.data)
	} else if (type == "forceSync" && window.location.href.indexOf("#worker") !== -1) {
		db.get("userId")
			.then(userId => {
				db.get("syncLocations:" + userId)
					.then(syncLocations => {
						if (Array.isArray(syncLocations)) {
							new Promise<void>(resolve => {
								const sub = eventListener.on("syncLoopDone", () => {
									sub.remove()

									resolve()
								})
							}).then(() => {
								for (let i = 0; i < syncLocations.length; i++) {
									Promise.all([
										db.set("localDataChanged:" + syncLocations[i].uuid, true),
										db.set("remoteDataChanged:" + syncLocations[i].uuid, true)
									])
										.then(() => {
											sendToAllPorts({
												type: "syncStatus",
												data: {
													type: "dataChanged",
													data: {
														locationUUID: syncLocations[i].uuid
													}
												}
											})
										})
										.catch(console.error)
								}
							})
						}
					})
					.catch(console.error)
			})
			.catch(console.error)
	} else if (type == "doneTasksCleared") {
		eventListener.emit("doneTasksCleared")
	} else if (type == "watcher-event" && window.location.href.indexOf("#worker") !== -1) {
		const locationUUID: string = data.data.locationUUID

		clearTimeout(DEBOUNCE_WATCHER_EVENT[locationUUID])

		DEBOUNCE_WATCHER_EVENT[locationUUID] = setTimeout(() => {
			new Promise<void>(resolve => {
				const sub = eventListener.on("syncLoopDone", () => {
					sub.remove()

					resolve()
				})
			}).then(() => {
				db.set("localDataChanged:" + locationUUID, true)
					.then(() => {
						sendToAllPorts({
							type: "syncStatus",
							data: {
								type: "dataChanged",
								data: {
									locationUUID
								}
							}
						})
					})
					.catch(log.error)
			})
		}, 1000)
	}

	return true
}

const ipc = {
	getAppPath: (path: string): Promise<string> => {
		return invokeProxy("getAppPath", {
			path
		})
	},
	db: (action: string, key?: string, value?: any): Promise<any> => {
		return invokeProxy("db", {
			action,
			key,
			value
		})
	},
	closeAuthWindow: (): Promise<void> => {
		return invokeProxy("closeAuthWindow")
	},
	createMainWindow: (): Promise<void> => {
		return invokeProxy("createMainWindow")
	},
	loginDone: (): Promise<void> => {
		return invokeProxy("loginDone")
	},
	openSettingsWindow: (page: string = "general"): Promise<void> => {
		return invokeProxy("openSettingsWindow", {
			page
		})
	},
	selectFolder: (): Promise<any> => {
		return invokeProxy("selectFolder")
	},
	selectRemoteFolder: (): Promise<any> => {
		return invokeProxy("selectRemoteFolder")
	},
	remoteFolderSelected: (data: { uuid: string; path: string; name: string; canceled: boolean; windowId: number }) => {
		return ipcRenderer.send("remoteFolderSelected", data)
	},
	minimizeWindow: (window: string = "settings", windowId: string = uuidv4()): Promise<void> => {
		return invokeProxy("minimizeWindow", {
			window,
			windowId
		})
	},
	closeWindow: (window: string = "settings", windowId: string = uuidv4()): Promise<void> => {
		return invokeProxy("closeWindow", {
			window,
			windowId
		})
	},
	setOpenOnStartup: (open: boolean = true): Promise<void> => {
		return invokeProxy("setOpenOnStartup", {
			open
		})
	},
	getOpenOnStartup: (): Promise<boolean> => {
		return invokeProxy("getOpenOnStartup")
	},
	getVersion: (): Promise<string> => {
		return invokeProxy("getVersion")
	},
	saveLogs: (): Promise<boolean> => {
		return invokeProxy("saveLogs")
	},
	updateTrayIcon: (type: string = "normal"): Promise<boolean> => {
		return invokeProxy("updateTrayIcon", {
			type
		})
	},
	updateTrayMenu: (): Promise<void> => {
		return invokeProxy("updateTrayMenu")
	},
	updateTrayTooltip: (text: string = "Filen"): Promise<void> => {
		return invokeProxy("updateTrayTooltip", {
			text
		})
	},
	getFileIconName: (name: string = "name"): Promise<string> => {
		return invokeProxy("getFileIconName", {
			name
		})
	},
	quitApp: (): Promise<void> => {
		return invokeProxy("quitApp")
	},
	exitApp: (): Promise<void> => {
		return invokeProxy("exitApp")
	},
	openDownloadWindow: (args: any): Promise<void> => {
		return invokeProxy("openDownloadWindow", {
			args
		})
	},
	openSelectiveSyncWindow: (location: Location): Promise<void> => {
		return invokeProxy("openSelectiveSyncWindow", location)
	},
	updateKeybinds: (): Promise<void> => {
		return invokeProxy("updateKeybinds")
	},
	disableKeybinds: (): Promise<void> => {
		return invokeProxy("disableKeybinds")
	},
	restartApp: (): Promise<void> => {
		return invokeProxy("restartApp")
	},
	openUploadWindow: (type: string = "files"): Promise<void> => {
		return invokeProxy("openUploadWindow", {
			type
		})
	},
	installUpdate: (): Promise<void> => {
		return invokeProxy("installUpdate")
	},
	setFileKey: (uuid: string, key: string): Promise<void> => {
		return invokeProxy("setFileKey", {
			uuid,
			key
		})
	},
	getFileKey: (uuid: string): Promise<string> => {
		return invokeProxy("getFileKey", {
			uuid
		})
	},
	trayAvailable: (): Promise<boolean> => {
		return invokeProxy("trayAvailable")
	},
	initWatcher: (path: string, locationUUID: string): Promise<void> => {
		return invokeProxy("initWatcher", {
			path,
			locationUUID
		})
	},
	getSyncIssues: (): Promise<SyncIssue[]> => {
		return invokeProxy("getSyncIssues")
	},
	addSyncIssue: (syncIssue: SyncIssue): Promise<void> => {
		return invokeProxy("addSyncIssue", syncIssue)
	},
	removeSyncIssue: (uuid: string): Promise<void> => {
		return invokeProxy("removeSyncIssue", uuid)
	},
	clearSyncIssues: (): Promise<void> => {
		return invokeProxy("clearSyncIssues")
	},
	emitGlobal: (channel: string, data: any): Promise<void> => {
		return invokeProxy("emitGlobal", {
			channel,
			data
		})
	},
	loadApplyDoneTasks: (locationUUID: string): Promise<any[]> => {
		return invokeProxy("loadApplyDoneTasks", locationUUID)
	},
	clearApplyDoneTasks: (locationUUID: string): Promise<void> => {
		return invokeProxy("clearApplyDoneTasks", locationUUID)
	},
	addToApplyDoneTasks: (locationUUID: string, task: any): Promise<void> => {
		return invokeProxy("addToApplyDoneTasks", {
			locationUUID,
			task
		})
	}
}

export default ipc
