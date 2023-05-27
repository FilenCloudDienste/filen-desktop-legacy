import * as fsLocal from "../../fs/local"
import * as fsRemote from "../../fs/remote"
import db from "../../db"
import { v4 as uuidv4 } from "uuid"
import { Semaphore, convertTimestampToMs } from "../../helpers"
import { isSyncLocationPaused, emitSyncStatus, emitSyncStatusLocation, removeRemoteLocation } from "./sync.utils"
import { Location, SyncIssue } from "../../../../types"
import { checkInternet } from "../../../windows/worker/worker"
import ipc from "../../ipc"
import eventListener from "../../eventListener"
import { consumeTasks } from "./sync.tasks"
import { getDeltas, consumeDeltas } from "./sync.deltas"
import constants from "../../../../constants.json"

const pathModule = window.require("path")
const log = window.require("electron-log")

let SYNC_RUNNING = false
const SYNC_TIMEOUT = 5000
let NEXT_SYNC = Date.now() - SYNC_TIMEOUT
const IS_FIRST_REQUEST: Record<string, boolean> = {}
const WATCHERS: Record<string, boolean> = {}
const syncMutex = new Semaphore(1)

const applyDoneTasksToSavedState = async ({
	doneTasks,
	localTreeNow,
	remoteTreeNow
}: {
	doneTasks: any
	localTreeNow: any
	remoteTreeNow: any
}): Promise<{ localTreeNowApplied: any; remoteTreeNowApplied: any }> => {
	const order: Record<string, number> = {
		renameInRemote: 1,
		renameInLocal: 2,
		moveInRemote: 3,
		moveInLocal: 4,
		deleteInRemote: 5,
		deleteInLocal: 6,
		uploadToRemote: 7,
		downloadFromRemote: 8
	}

	const sortedDoneTasks = doneTasks
		.filter(
			(task: any) =>
				typeof task !== "undefined" &&
				task !== null &&
				typeof task.task !== "undefined" &&
				task.task !== null &&
				typeof task.task.path === "string" &&
				task.task.path.length > 0
		)
		.sort((a: any, b: any) => order[a] - order[b])

	for (const doneTask of sortedDoneTasks) {
		const { type, task } = doneTask

		if (type == "renameInRemote" || type == "moveInRemote") {
			if (typeof task.from !== "string" || typeof task.to !== "string") {
				continue
			}

			if (remoteTreeNow.folders[task.from]) {
				if (task.type === "folder") {
					remoteTreeNow.folders[task.to] = remoteTreeNow.folders[task.from]
				} else {
					remoteTreeNow.files[task.to] = remoteTreeNow.files[task.from]
				}
			}

			delete remoteTreeNow.folders[task.from]
			delete remoteTreeNow.files[task.from]

			for (const uuid in remoteTreeNow.uuids) {
				const path = remoteTreeNow.uuids[uuid].path

				if (task.from === path) {
					remoteTreeNow.uuids[uuid].path = task.to
				}
			}
		}

		if (type == "renameInLocal" || type == "moveInLocal") {
			if (typeof task.from !== "string" || typeof task.to !== "string") {
				continue
			}

			if (localTreeNow.folders[task.from]) {
				if (task.type == "folder") {
					localTreeNow.folders[task.to] = localTreeNow.folders[task.from]
				} else {
					localTreeNow.files[task.to] = localTreeNow.files[task.from]
				}
			}

			delete localTreeNow.folders[task.from]
			delete localTreeNow.files[task.from]

			for (const prop in localTreeNow.ino) {
				const path = localTreeNow.ino[prop].path

				if (task.from == path) {
					localTreeNow.ino[prop].path = task.to
				}
			}
		}

		if (type == "deleteInRemote" || type == "deleteInLocal") {
			if (type == "deleteInRemote") {
				if (task.type == "folder") {
					delete remoteTreeNow.folders[task.path]
				} else {
					delete remoteTreeNow.files[task.path]
				}

				for (const prop in remoteTreeNow.uuids) {
					const path = remoteTreeNow.uuids[prop].path

					if (task.path == path) {
						delete remoteTreeNow.uuids[prop]
					}
				}
			} else {
				if (task.type == "folder") {
					delete localTreeNow.folders[task.path]
				} else {
					delete localTreeNow.files[task.path]
				}

				for (const prop in localTreeNow.ino) {
					const path = localTreeNow.ino[prop].path

					if (task.path == path) {
						delete localTreeNow.ino[prop]
					}
				}
			}
		}

		if (type == "uploadToRemote") {
			if (task.type == "folder") {
				remoteTreeNow.folders[task.path] = {
					name: task.item.name,
					parent: task.info.parent,
					path: task.path,
					type: "folder",
					uuid: task.item.uuid
				}

				remoteTreeNow.uuids[task.item.uuid] = {
					type: "folder",
					path: task.path
				}
			} else {
				remoteTreeNow.files[task.path] = {
					bucket: task.info.bucket,
					chunks: task.info.chunks,
					metadata: task.info.metadata,
					parent: task.info.parent,
					path: task.path,
					region: task.info.region,
					type: "file",
					uuid: task.item.uuid,
					version: task.info.version
				}

				remoteTreeNow.uuids[task.item.uuid] = {
					type: "file",
					path: task.path
				}
			}
		}

		if (type == "downloadFromRemote") {
			if (task.type == "folder") {
				localTreeNow.folders[task.path] = {
					name: task.item.name,
					lastModified: convertTimestampToMs(task.info.mtimeMs)
				}

				localTreeNow.ino[task.info.ino] = {
					type: "folder",
					path: task.path
				}
			} else {
				localTreeNow.files[task.path] = {
					name: task.item.metadata.name,
					lastModified: convertTimestampToMs(task.info.mtimeMs),
					size: task.info.size
				}

				localTreeNow.ino[task.info.ino] = {
					type: "file",
					path: task.path
				}
			}
		}
	}

	return {
		localTreeNowApplied: localTreeNow,
		remoteTreeNowApplied: remoteTreeNow
	}
}

const syncLocation = async (location: Location): Promise<void> => {
	if (location.paused) {
		emitSyncStatusLocation("paused", {
			status: "paused",
			location
		})

		log.info(
			"Sync location " + location.uuid + " -> " + location.local + " <-> " + location.remote + " [" + location.type + "] is paused"
		)

		return
	}

	if (await isSyncLocationPaused(location.uuid)) {
		return
	}

	log.info(
		"Starting sync task for location " +
			location.uuid +
			" -> " +
			location.local +
			" <-> " +
			location.remote +
			" [" +
			location.type +
			"] (" +
			JSON.stringify(location) +
			")"
	)
	log.info("Smoke testing location " + location.uuid)

	emitSyncStatusLocation("smokeTest", {
		status: "start",
		location
	})

	try {
		await fsLocal.smokeTest(pathModule.normalize(location.local))
	} catch (e: any) {
		log.error("Smoke test for location " + location.uuid + " failed")
		log.error(e)

		ipc.addSyncIssue({
			uuid: uuidv4(),
			type: "critical",
			where: "local",
			path: pathModule.normalize(location.local),
			err: e,
			info: "Smoke test for location " + location.uuid + " failed",
			timestamp: Date.now()
		}).catch(console.error)

		emitSyncStatusLocation("smokeTest", {
			status: "err",
			location,
			err: e
		})

		return
	}

	try {
		await fsRemote.smokeTest(location.remoteUUID!)
	} catch (e: any) {
		log.error(e)

		if (e.toString().toLowerCase().indexOf("folder does not exist") !== -1) {
			await removeRemoteLocation(location)
		}

		return
	}

	emitSyncStatusLocation("smokeTest", {
		status: "done",
		location
	})

	if (
		typeof WATCHERS[location.local] == "undefined" &&
		(location.type == "localBackup" || location.type == "localToCloud" || location.type == "twoWay")
	) {
		log.info("Starting local directory watcher for location " + location.uuid)

		emitSyncStatusLocation("initWatcher", {
			status: "start",
			location
		})

		try {
			await ipc.initWatcher(pathModule.normalize(location.local), location.uuid)

			WATCHERS[location.local] = true

			emitSyncStatusLocation("initWatcher", {
				status: "done",
				location
			})
		} catch (e: any) {
			log.error("Could not start local directory watcher for location " + location.uuid)
			log.error(e)

			ipc.addSyncIssue({
				uuid: uuidv4(),
				type: "warning",
				where: "local",
				path: pathModule.normalize(location.local),
				err: e,
				info: "Could not start local directory watcher at path " + pathModule.normalize(location.local),
				timestamp: Date.now()
			}).catch(console.error)

			emitSyncStatusLocation("initWatcher", {
				status: "err",
				location,
				err: e
			})
		}
	}

	if (await isSyncLocationPaused(location.uuid)) {
		return
	}

	log.info("Getting directory trees for location " + location.uuid)

	emitSyncStatusLocation("getTrees", {
		status: "start",
		location
	})

	try {
		var [{ data: localTreeNow, changed: localDataChanged }, { data: remoteTreeNow, changed: remoteDataChanged }] = await Promise.all([
			fsLocal.directoryTree(pathModule.normalize(location.local), typeof IS_FIRST_REQUEST[location.uuid] === "undefined", location),
			fsRemote.directoryTree(location.remoteUUID!, typeof IS_FIRST_REQUEST[location.uuid] === "undefined", location)
		])

		if (typeof IS_FIRST_REQUEST[location.uuid] !== "undefined") {
			await Promise.all([db.set("localDataChanged:" + location.uuid, false), db.set("remoteDataChanged:" + location.uuid, false)])
		}

		IS_FIRST_REQUEST[location.uuid] = false
	} catch (e: any) {
		if (e.toString().toLowerCase().indexOf("folder not found") !== -1) {
			await removeRemoteLocation(location)
		} else {
			log.error("Could not get directory trees for location " + location.uuid)
			log.error(e)

			emitSyncStatusLocation("getTrees", {
				status: "err",
				location,
				err: e
			})

			if (e && e.code && constants.fsErrors.includes(e.code)) {
				ipc.addSyncIssue({
					uuid: uuidv4(),
					type: "warning",
					where: "local",
					path: pathModule.normalize(location.local),
					err: e,
					info: "Could not get directory tree for location " + pathModule.normalize(location.local),
					timestamp: Date.now()
				}).catch(console.error)
			}
		}

		delete IS_FIRST_REQUEST[location.uuid]

		return
	}

	if (!localDataChanged && !remoteDataChanged && typeof IS_FIRST_REQUEST[location.uuid] !== "undefined") {
		log.info("Data did not change since last sync, skipping cycle")

		return
	}

	try {
		var [lastLocalTree, lastRemoteTree, applyDoneTasksPast] = await Promise.all([
			db.get("lastLocalTree:" + location.uuid),
			db.get("lastRemoteTree:" + location.uuid),
			fsLocal.loadApplyDoneTasks(location.uuid)
		])

		if (applyDoneTasksPast && Array.isArray(applyDoneTasksPast) && applyDoneTasksPast.length > 0) {
			log.info("Applying " + applyDoneTasksPast.length + " done tasks (past) to saved state for location " + location.uuid)

			const { localTreeNowApplied, remoteTreeNowApplied } = await applyDoneTasksToSavedState({
				doneTasks: applyDoneTasksPast,
				localTreeNow: lastLocalTree,
				remoteTreeNow: lastRemoteTree
			})

			lastLocalTree = localTreeNowApplied
			lastRemoteTree = remoteTreeNowApplied
		}
	} catch (e: any) {
		log.error("Could not get last local/remote tree for location " + location.uuid)
		log.error(e)

		ipc.addSyncIssue({
			uuid: uuidv4(),
			type: "critical",
			where: "local",
			path: pathModule.normalize(location.local),
			err: e,
			info: "Could not get last local/remote directory tree for location " + location.uuid,
			timestamp: Date.now()
		}).catch(console.error)

		emitSyncStatusLocation("getTrees", {
			status: "err",
			location,
			err: e
		})

		return
	}

	emitSyncStatusLocation("getTrees", {
		status: "done",
		location
	})

	if (!lastLocalTree || !lastRemoteTree) {
		log.info("lastLocalTree/lastRemoteTree for location " + location.uuid + " empty, skipping")

		try {
			await Promise.all([
				db.set("lastLocalTree:" + location.uuid, localTreeNow),
				db.set("lastRemoteTree:" + location.uuid, remoteTreeNow)
			])

			delete IS_FIRST_REQUEST[location.uuid]
		} catch (e: any) {
			log.error("Could not save lastLocalTree/lastRemoteTree to DB for location " + location.uuid)
			log.error(e)
		}

		return
	}

	if (await isSyncLocationPaused(location.uuid)) {
		return
	}

	log.info("Getting deltas for location " + location.uuid)

	emitSyncStatusLocation("getDeltas", {
		status: "start",
		location
	})

	try {
		var [localDeltas, remoteDeltas] = await Promise.all([
			getDeltas("local", lastLocalTree, localTreeNow),
			getDeltas("remote", lastRemoteTree, remoteTreeNow)
		])
	} catch (e: any) {
		log.error("Could not get deltas for location " + location.uuid)
		log.error(e)

		ipc.addSyncIssue({
			uuid: uuidv4(),
			type: "critical",
			where: "local",
			path: pathModule.normalize(location.local),
			err: e,
			info: "Could not get deltas for location " + location.uuid,
			timestamp: Date.now()
		}).catch(console.error)

		emitSyncStatusLocation("getDeltas", {
			status: "err",
			location,
			err: e
		})

		return
	}

	emitSyncStatusLocation("getDeltas", {
		status: "done",
		location
	})

	if (await isSyncLocationPaused(location.uuid)) {
		return
	}

	log.info("Consuming deltas for location " + location.uuid)

	emitSyncStatusLocation("consumeDeltas", {
		status: "start",
		location
	})

	try {
		var {
			uploadToRemote,
			downloadFromRemote,
			renameInLocal,
			renameInRemote,
			moveInLocal,
			moveInRemote,
			deleteInLocal,
			deleteInRemote
		} = await consumeDeltas({ localDeltas, remoteDeltas, lastLocalTree, lastRemoteTree, localTreeNow, remoteTreeNow, location })
	} catch (e: any) {
		log.error("Could not consume deltas for location " + location.uuid)
		log.error(e)

		ipc.addSyncIssue({
			uuid: uuidv4(),
			type: "critical",
			where: "local",
			path: pathModule.normalize(location.local),
			err: e,
			info: "Could not get consume deltas for location " + location.uuid,
			timestamp: Date.now()
		}).catch(console.error)

		emitSyncStatusLocation("consumeDeltas", {
			status: "err",
			location,
			err: e
		})

		return
	}

	emitSyncStatusLocation("consumeDeltas", {
		status: "done",
		location
	})

	if (await isSyncLocationPaused(location.uuid)) {
		return
	}

	log.info("Consuming tasks for location " + location.uuid)

	emitSyncStatusLocation("consumeTasks", {
		status: "start",
		location
	})

	try {
		var { doneTasks, resync } = await consumeTasks({
			uploadToRemote,
			downloadFromRemote,
			renameInLocal,
			renameInRemote,
			moveInLocal,
			moveInRemote,
			deleteInLocal,
			deleteInRemote,
			remoteTreeNow,
			location
		})
	} catch (e: any) {
		log.error("Could not consume tasks for location " + location.uuid)
		log.error(e)

		emitSyncStatusLocation("consumeTasks", {
			status: "err",
			location,
			err: e
		})

		return
	}

	log.info("Tasks for location " + location.uuid + " consumed")

	emitSyncStatusLocation("consumeTasks", {
		status: "done",
		location
	})

	try {
		const syncIssues = await ipc.getSyncIssues()

		if (syncIssues.filter(issue => issue.type === "critical").length > 0) {
			log.info("Got critical sync issues after consume, won't apply anything to saved state")

			return
		}
	} catch (e: any) {
		log.error("Could not get sync issues after consume for location " + location.uuid)
		log.error(e)

		return
	}

	log.info("Applying " + doneTasks.length + " done tasks to saved state for location " + location.uuid)

	emitSyncStatusLocation("applyDoneTasksToSavedState", {
		status: "start",
		location
	})

	try {
		var { localTreeNowApplied, remoteTreeNowApplied } = await applyDoneTasksToSavedState({ doneTasks, localTreeNow, remoteTreeNow })
	} catch (e: any) {
		log.error("Could not apply " + doneTasks.length + " done tasks to saved state for location " + location.uuid)
		log.error(e)

		ipc.addSyncIssue({
			uuid: uuidv4(),
			type: "critical",
			where: "local",
			path: pathModule.normalize(location.local),
			err: e,
			info: "Could not apply " + doneTasks.length + " done tasks to saved state for location " + location.uuid,
			timestamp: Date.now()
		}).catch(console.error)

		emitSyncStatusLocation("applyDoneTasksToSavedState", {
			status: "err",
			location,
			err: e
		})

		return
	}

	emitSyncStatusLocation("applyDoneTasksToSavedState", {
		status: "done",
		location
	})

	emitSyncStatusLocation("cleanup", {
		status: "start",
		location
	})

	log.info("Cleaning up " + location.uuid)

	try {
		await Promise.all([
			db.set("lastLocalTree:" + location.uuid, doneTasks.length > 0 ? localTreeNowApplied : localTreeNow),
			db.set("lastRemoteTree:" + location.uuid, doneTasks.length > 0 ? remoteTreeNowApplied : remoteTreeNow),
			fsLocal.clearApplyDoneTasks(location.uuid),
			...(doneTasks.length > 0 || resync
				? [db.set("localDataChanged:" + location.uuid, true), db.set("remoteDataChanged:" + location.uuid, true)]
				: [])
		])
	} catch (e: any) {
		log.error("Could not save lastLocalTree to DB for location " + location.uuid)
		log.error(e)

		ipc.addSyncIssue({
			uuid: uuidv4(),
			type: "critical",
			where: "local",
			path: pathModule.normalize(location.local),
			err: e,
			info: "Could not save lastLocalTree to DB for location " + location.uuid,
			timestamp: Date.now()
		}).catch(console.error)

		emitSyncStatusLocation("cleanup", {
			status: "err",
			location,
			err: e
		})

		return
	}

	log.info("Cleanup done " + location.uuid)

	emitSyncStatusLocation("cleanup", {
		status: "done",
		location
	})

	return
}

const startSyncLoop = () => {
	return setTimeout(sync, SYNC_TIMEOUT)
}

const sync = async (): Promise<any> => {
	await syncMutex.acquire()

	eventListener.emit("syncLoopStart")

	if (SYNC_RUNNING || Date.now() < NEXT_SYNC) {
		syncMutex.release()

		eventListener.emit("syncLoopDone")

		return
	}

	try {
		if (!(await db.get("isLoggedIn"))) {
			syncMutex.release()

			eventListener.emit("syncLoopDone")

			return startSyncLoop()
		}
	} catch (e: any) {
		syncMutex.release()

		eventListener.emit("syncLoopDone")

		log.error(e)

		return startSyncLoop()
	}

	emitSyncStatus("init", {
		status: "start"
	})

	try {
		var [userId, masterKeys, syncIssues, paused]: [number | null, string[] | null, SyncIssue[], boolean | null] = await Promise.all([
			db.get("userId"),
			db.get("masterKeys"),
			ipc.getSyncIssues(),
			db.get("paused")
		])

		var syncLocations: Location[] | null = await db.get("syncLocations:" + userId)
	} catch (e: any) {
		syncMutex.release()

		eventListener.emit("syncLoopDone")

		log.error("Could not fetch syncLocations from DB")
		log.error(e)

		emitSyncStatus("init", {
			status: "err",
			err: e
		})

		return startSyncLoop()
	}

	if (syncIssues.filter(issue => issue.type === "critical").length > 0) {
		syncMutex.release()

		eventListener.emit("syncLoopDone")

		log.info("Will not continue, got critical sync issue, need user intervention")

		emitSyncStatus("init", {
			status: "err",
			err: "Will not continue, got critical sync issue, need user intervention"
		})

		return startSyncLoop()
	}

	if (Number.isNaN(userId)) {
		syncMutex.release()

		eventListener.emit("syncLoopDone")

		log.info("User id not found, instead found: " + typeof userId)

		emitSyncStatus("init", {
			status: "err",
			err: "User id not found, instead found: " + typeof userId
		})

		return startSyncLoop()
	}

	if (!Array.isArray(masterKeys)) {
		syncMutex.release()

		eventListener.emit("syncLoopDone")

		log.info("Master keys not found, instead found: " + typeof masterKeys)

		emitSyncStatus("init", {
			status: "err",
			err: "Master keys not found, instead found: " + typeof masterKeys
		})

		return startSyncLoop()
	}

	if (!Array.isArray(syncLocations)) {
		syncMutex.release()

		eventListener.emit("syncLoopDone")

		log.info("Sync locations not array, instead found: " + typeof syncLocations)

		emitSyncStatus("init", {
			status: "err",
			err: "Sync locations not array, instead found: " + typeof syncLocations
		})

		return startSyncLoop()
	}

	if (syncLocations.length === 0) {
		syncMutex.release()

		eventListener.emit("syncLoopDone")

		emitSyncStatus("init", {
			status: "done",
			syncLocations: []
		})

		log.info("Sync locations empty")

		return startSyncLoop()
	}

	emitSyncStatus("init", {
		status: "done",
		syncLocations
	})

	if (paused) {
		syncMutex.release()

		eventListener.emit("syncLoopDone")

		return startSyncLoop()
	}

	if (!(await checkInternet())) {
		syncMutex.release()

		eventListener.emit("syncLoopDone")

		return startSyncLoop()
	}

	if (SYNC_RUNNING || Date.now() < NEXT_SYNC) {
		syncMutex.release()

		eventListener.emit("syncLoopDone")

		return
	}

	SYNC_RUNNING = true

	try {
		log.info("Starting sync task")
		log.info(syncLocations.length + " syncLocations to sync")

		emitSyncStatus("sync", {
			status: "start",
			syncLocations
		})

		for (const location of syncLocations) {
			if (
				typeof location.remote === "undefined" ||
				typeof location.remoteUUID === "undefined" ||
				typeof location.remoteName === "undefined"
			) {
				continue
			}

			try {
				await syncLocation(location)
			} catch (e: any) {
				log.error("Sync task for location " + location.uuid + " failed, reason:")
				log.error(e)

				emitSyncStatus("sync", {
					status: "err",
					syncLocations,
					err: e
				})
			}
		}

		emitSyncStatus("sync", {
			status: "done",
			syncLocations
		})

		log.info("Cleaning up")

		emitSyncStatus("cleanup", {
			status: "start"
		})

		emitSyncStatus("cleanup", {
			status: "done"
		})
	} catch (e) {
		log.error(e)
	}

	SYNC_RUNNING = false
	NEXT_SYNC = Date.now() + SYNC_TIMEOUT

	syncMutex.release()

	eventListener.emit("syncLoopDone")

	return startSyncLoop()
}

setInterval(startSyncLoop, SYNC_TIMEOUT * 1.5)

export default sync
