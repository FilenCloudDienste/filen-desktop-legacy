import { memo, useEffect, useRef, useState, useCallback } from "react"
import { listen } from "../../lib/worker/ipc"
import sync from "../../lib/worker/sync"
import { updateKeys } from "../../lib/user"
import db from "../../lib/db"
import useIsOnline from "../../lib/hooks/useIsOnline"
import ipc from "../../lib/ipc"
import useDb from "../../lib/hooks/useDb"
import eventListener from "../../lib/eventListener"
import useAppVersion from "../../lib/hooks/useAppVersion"
import { SyncIssue, Location } from "../../../types"
import { listen as socketListen } from "../../lib/worker/socket"
import { debounce } from "lodash"
import { initLocalTrashDirs } from "../../lib/fs/local"
import useSyncIssues from "../../lib/hooks/useSyncIssues"
import { i18n } from "../../lib/i18n"
import useLang from "../../lib/hooks/useLang"

const log = window.require("electron-log")

export const checkInternet = async () => {
	await db.set("isOnline", window.navigator.onLine).catch(log.error)

	return window.navigator.onLine
}

const WorkerWindow = memo(({ userId }: { userId: number }) => {
	const initDone = useRef<boolean>(false)
	const isOnline = useIsOnline()
	const syncIssues = useSyncIssues()
	const paused: boolean = useDb("paused", false)
	const [runningSyncTasks, setRunningSyncTasks] = useState<number>(0)
	const appVersion = useAppVersion()
	const isLoggedIn: boolean = useDb("isLoggedIn", false)
	const lang = useLang()
	const syncLocations: Location[] = useDb("syncLocations:" + userId, [])

	const init = async () => {
		if (initDone.current) {
			return false
		}

		await new Promise<void>(resolve => {
			const wait = async () => {
				try {
					const loggedIn: boolean | null = await db.get("isLoggedIn")

					if (typeof loggedIn === "boolean" && loggedIn && window.navigator.onLine) {
						resolve()

						return
					}
				} catch (e) {
					log.error(e)
				}

				setTimeout(wait, 100)

				return
			}

			wait()
		})

		if (!initDone.current) {
			initDone.current = true

			socketListen()

			try {
				await updateKeys()

				await Promise.all([
					db.set("paused", false),
					db.set("maxStorageReached", false),
					db.set("suspend", false),
					db.set("uploadPaused", false),
					db.set("downloadPaused", false),
					db.set("isOnline", true)
				])

				initLocalTrashDirs()
				checkInternet().catch(log.error)
				sync()
			} catch (e) {
				log.error(e)
			}
		}
	}

	const updateTray = useCallback(
		(icon: "paused" | "error" | "sync" | "normal", message: string) => {
			ipc.updateTrayIcon(icon)
			ipc.updateTrayTooltip("Filen v" + appVersion + "\n" + message)
		},
		[appVersion]
	)

	const processTray = useCallback(
		debounce(
			(
				isLoggedIn: boolean,
				isOnline: boolean,
				paused: boolean,
				syncIssues: SyncIssue[],
				runningSyncTasks: number,
				syncLocations: Location[]
			) => {
				if (!isLoggedIn) {
					updateTray("paused", i18n(lang, "pleaseLogin"))

					return
				}

				if (!isOnline) {
					updateTray("error", i18n(lang, "youAreOffline"))

					return
				}

				if (paused) {
					updateTray("paused", i18n(lang, "paused"))

					return
				}

				if (syncIssues.filter(issue => issue.type == "critical").length > 0) {
					updateTray("error", i18n(lang, "traySyncIssues", true, ["__NUM__"], [syncIssues.length.toString()]))

					return
				}

				if (runningSyncTasks > 0) {
					updateTray("sync", i18n(lang, "traySyncing", true, ["__NUM__"], [runningSyncTasks.toString()]))

					return
				}

				if (Array.isArray(syncLocations) && syncLocations.length > 0) {
					if (syncLocations.filter(item => typeof item.remoteUUID == "string").length > 0) {
						const warnings = syncIssues.filter(issue => issue.type == "conflict" || issue.type == "warning").length

						if (warnings > 0) {
							updateTray("paused", i18n(lang, "trayWarnings", true, ["__NUM__"], [warnings.toString()]))
						} else {
							updateTray("normal", i18n(lang, "everythingSynced"))
						}
					} else {
						updateTray("paused", i18n(lang, "trayNoSyncRemoteSetup"))
					}
				} else {
					updateTray("paused", i18n(lang, "trayNoSyncSetup"))
				}
			},
			250
		),
		[appVersion, lang]
	)

	useEffect(() => {
		processTray(isLoggedIn, isOnline, paused, syncIssues, runningSyncTasks, syncLocations)
	}, [isLoggedIn, isOnline, paused, syncIssues, runningSyncTasks, syncLocations])

	useEffect(() => {
		if (!paused) {
			ipc.emitGlobal("global-message", {
				type: "forceSync"
			}).catch(log.error)
		}
	}, [paused])

	useEffect(() => {
		const syncTasksToDoListener = eventListener.on("syncTasksToDo", setRunningSyncTasks)

		listen()
		init()

		const onlineListener = () => {
			checkInternet().catch(log.error)
		}

		window.addEventListener("online", onlineListener)
		window.addEventListener("offline", onlineListener)

		return () => {
			syncTasksToDoListener.remove()

			window.removeEventListener("online", onlineListener)
			window.removeEventListener("offline", onlineListener)
		}
	}, [])

	return null
})

export default WorkerWindow
