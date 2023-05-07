import pathModule from "path"
import log from "electron-log"
import nodeWatch from "node-watch"
import is from "electron-is"
import { powerMonitor } from "electron"
import { emitGlobal } from "../ipc"
import { getRandomArbitrary } from "../helpers"
import fs from "fs-extra"

const POLLING_TIME = 60000
const SUBS: Record<string, ReturnType<typeof nodeWatch>> = {}
const SUBS_INFO: Record<string, string> = {}
const pollingTimeout: Record<string, NodeJS.Timer> = {}
const lastEvent: Record<string, number> = {}
const didCloseDueToResume: Record<string, boolean> = {}

export const isNetworkPath = async (path: string): Promise<boolean> => {
	// Not reliable on linux or mac
	try {
		const realPath = await fs.realpath(path)

		return realPath.startsWith("\\\\") || realPath.startsWith("//")
	} catch (e) {
		log.error(e)

		return false
	}
}

export const emitToWorker = (data: any) => {
	emitGlobal("global-message", {
		type: "watcher-event",
		data
	})
}

export const resumeWatchers = async () => {
	if (is.linux()) {
		return
	}

	for (const path in SUBS_INFO) {
		if (await isNetworkPath(path)) {
			continue
		}

		const locationUUID = SUBS_INFO[path]

		try {
			if (typeof SUBS[path] !== "undefined" && typeof SUBS[path].isClosed === "function") {
				if (!SUBS[path].isClosed()) {
					didCloseDueToResume[path] = true

					SUBS[path].close()
				}

				delete SUBS[path]
			}
		} catch (e) {
			log.error(e)
		}

		watch(path, locationUUID).catch(log.error)
	}
}

export const restartWatcher = async (path: string, locationUUID: string) => {
	if (is.linux() || (await isNetworkPath(path))) {
		return
	}

	setTimeout(() => {
		if (typeof didCloseDueToResume[path] == "undefined") {
			delete SUBS[path]
			delete SUBS_INFO[path]

			emitToWorker({
				event: "dummy",
				name: "dummy",
				watchPath: path,
				locationUUID
			})

			watch(path, locationUUID).catch(log.error)
		}

		delete didCloseDueToResume[path]
	}, 5000)
}

powerMonitor.on("resume", () => resumeWatchers())
powerMonitor.on("unlock-screen", () => resumeWatchers())
powerMonitor.on("user-did-become-active", () => resumeWatchers())

export const watch = (path: string, locationUUID: string) => {
	return new Promise(async (resolve, reject) => {
		if (is.linux() || (await isNetworkPath(path))) {
			clearInterval(pollingTimeout[path])

			pollingTimeout[path] = setInterval(() => {
				emitToWorker({
					event: "dummy",
					name: "dummy",
					watchPath: path,
					locationUUID
				})
			}, getRandomArbitrary(Math.floor(POLLING_TIME - 15000), POLLING_TIME))

			resolve(SUBS[path])

			return
		}

		if (typeof SUBS[path] !== "undefined") {
			resolve(SUBS[path])

			return
		}

		try {
			SUBS[path] = nodeWatch(pathModule.normalize(path), {
				recursive: true,
				delay: 1000,
				persistent: true
			})

			SUBS[path].on("change", (event, name) => {
				lastEvent[path] = Date.now()

				emitToWorker({ event, name, watchPath: path, locationUUID })
			})

			SUBS[path].on("error", err => {
				log.error(err)

				delete didCloseDueToResume[path]
				delete SUBS[path]
				delete SUBS_INFO[path]

				restartWatcher(path, locationUUID)
			})

			SUBS[path].on("close", () => {
				restartWatcher(path, locationUUID)
			})

			SUBS[path].on("ready", () => {
				SUBS_INFO[path] = locationUUID

				resolve(SUBS[path])
			})
		} catch (e) {
			log.error(e)

			reject(e)

			return
		}
	})
}
