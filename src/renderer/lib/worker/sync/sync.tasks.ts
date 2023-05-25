import { filePresent, folderPresent } from "../../api"
import {
	getIgnored,
	getSyncMode,
	onlyGetBaseParentMove,
	onlyGetBaseParentDelete,
	sortMoveRenameTasks,
	emitSyncTask,
	isPathIncluded,
	isIgnoredBySelectiveSync
} from "./sync.utils"
import { sendToAllPorts } from "../ipc"
import constants from "../../../../constants.json"
import { Location } from "../../../../types"
import { Semaphore, chunkedPromiseAll } from "../../helpers"
import ipc from "../../ipc"
import { v4 as uuidv4 } from "uuid"
import * as fsLocal from "../../fs/local"
import * as fsRemote from "../../fs/remote"

const log = window.require("electron-log")
const pathModule = window.require("path")

export const maxConcurrentUploadsSemaphore = new Semaphore(constants.maxConcurrentUploads)
export const maxConcurrentDownloadsSemaphore = new Semaphore(constants.maxConcurrentDownloads)
export const maxSyncTasksSemaphore = new Semaphore(constants.maxConcurrentSyncTasks)

// Sorting the tasks so we don't have duplicates or for example delete something that has been renamed or move something that has been renamed etc.
// We also filter for ignored files/folders here + the sync mode

export const sortTasks = async ({
	uploadToRemote,
	downloadFromRemote,
	renameInLocal,
	renameInRemote,
	moveInLocal,
	moveInRemote,
	deleteInLocal,
	deleteInRemote,
	location
}: {
	uploadToRemote: any
	downloadFromRemote: any
	renameInLocal: any
	renameInRemote: any
	moveInLocal: any
	moveInRemote: any
	deleteInLocal: any
	deleteInRemote: any
	location: Location
}): Promise<any> => {
	const ignored = []

	const [{ selectiveSyncRemoteIgnore, filenIgnore }, syncMode] = await Promise.all([getIgnored(location), getSyncMode(location)])

	// Filter by ignored

	for (let i = 0; i < renameInLocal.length; i++) {
		if (filenIgnore.denies(renameInLocal[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, renameInLocal[i].path)) {
			ignored.push(renameInLocal[i].path)
			renameInLocal.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < renameInRemote.length; i++) {
		if (filenIgnore.denies(renameInRemote[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, renameInRemote[i].path)) {
			ignored.push(renameInRemote[i].path)
			renameInRemote.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < moveInLocal.length; i++) {
		if (filenIgnore.denies(moveInLocal[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, moveInLocal[i].path)) {
			ignored.push(moveInLocal[i].path)
			moveInLocal.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < moveInRemote.length; i++) {
		if (filenIgnore.denies(moveInRemote[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, moveInRemote[i].path)) {
			ignored.push(moveInRemote[i].path)
			moveInRemote.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < deleteInLocal.length; i++) {
		if (filenIgnore.denies(deleteInLocal[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, deleteInLocal[i].path)) {
			ignored.push(deleteInLocal[i].path)
			deleteInLocal.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < deleteInRemote.length; i++) {
		if (filenIgnore.denies(deleteInRemote[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, deleteInRemote[i].path)) {
			ignored.push(deleteInRemote[i].path)
			deleteInRemote.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < uploadToRemote.length; i++) {
		if (filenIgnore.denies(uploadToRemote[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, uploadToRemote[i].path)) {
			ignored.push(uploadToRemote[i].path)
			uploadToRemote.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < downloadFromRemote.length; i++) {
		if (
			filenIgnore.denies(downloadFromRemote[i].path) ||
			isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, downloadFromRemote[i].path)
		) {
			ignored.push(downloadFromRemote[i].path)
			downloadFromRemote.splice(i, 1)

			i -= 1
		}
	}

	let uploadToRemoteTasks: any[] = []
	let downloadFromRemoteTasks: any[] = []
	let renameInLocalTasks: any[] = []
	let renameInRemoteTasks: any[] = []
	let moveInLocalTasks: any[] = []
	let moveInRemoteTasks: any[] = []
	let deleteInLocalTasks: any[] = []
	let deleteInRemoteTasks: any[] = []

	const renameInRemoteTasksSorted = sortMoveRenameTasks(renameInRemote)
	const renamedInRemote: any[] = []
	const moveInRemoteTasksSorted = sortMoveRenameTasks(moveInRemote)
	const movedInRemote: any[] = []

	const renameInLocalTasksSorted = sortMoveRenameTasks(renameInLocal)
	const renamedInLocal: any[] = []
	const moveInLocalTasksSorted = sortMoveRenameTasks(moveInLocal)
	const movedInLocal: any[] = []

	for (let i = 0; i < renameInRemoteTasksSorted.length; i++) {
		if (
			typeof renameInRemoteTasksSorted[i] == "undefined" ||
			renameInRemoteTasksSorted[i] == null ||
			typeof renameInRemoteTasksSorted[i].from !== "string" ||
			typeof renameInRemoteTasksSorted[i].to !== "string" ||
			typeof renameInRemoteTasksSorted[i].path !== "string"
		) {
			continue
		}

		if (!isPathIncluded(movedInRemote, renameInRemoteTasksSorted[i].path)) {
			renameInRemoteTasks.push(renameInRemoteTasksSorted[i])

			//renamedInRemote.push(renameInRemoteTasksSorted[i].from)
			//renamedInRemote.push(renameInRemoteTasksSorted[i].to)
		}
	}

	for (let i = 0; i < renameInLocalTasksSorted.length; i++) {
		if (
			typeof renameInLocalTasksSorted[i] == "undefined" ||
			renameInLocalTasksSorted[i] == null ||
			typeof renameInLocalTasksSorted[i].from !== "string" ||
			typeof renameInLocalTasksSorted[i].to !== "string" ||
			typeof renameInLocalTasksSorted[i].path !== "string"
		) {
			continue
		}

		if (!isPathIncluded(movedInLocal, renameInLocalTasksSorted[i].path)) {
			renameInLocalTasks.push(renameInLocalTasksSorted[i])

			//renamedInLocal.push(renameInLocalTasksSorted[i].from)
			//renamedInLocal.push(renameInLocalTasksSorted[i].to)
		}
	}

	for (let i = 0; i < moveInRemoteTasksSorted.length; i++) {
		if (
			typeof moveInRemoteTasksSorted[i] == "undefined" ||
			moveInRemoteTasksSorted[i] == null ||
			typeof moveInRemoteTasksSorted[i].from !== "string" ||
			typeof moveInRemoteTasksSorted[i].to !== "string" ||
			typeof moveInRemoteTasksSorted[i].path !== "string"
		) {
			continue
		}

		if (!isPathIncluded(movedInRemote, moveInRemoteTasksSorted[i].path)) {
			moveInRemoteTasks.push(moveInRemoteTasksSorted[i])

			//movedInRemote.push(moveInRemoteTasksSorted[i].from)
			//movedInRemote.push(moveInRemoteTasksSorted[i].to)
		}
	}

	for (let i = 0; i < moveInLocalTasksSorted.length; i++) {
		if (
			typeof moveInLocalTasksSorted[i] == "undefined" ||
			moveInLocalTasksSorted[i] == null ||
			typeof moveInLocalTasksSorted[i].from !== "string" ||
			typeof moveInLocalTasksSorted[i].to !== "string" ||
			typeof moveInLocalTasksSorted[i].path !== "string"
		) {
			continue
		}

		if (!isPathIncluded(movedInLocal, moveInLocalTasksSorted[i].path)) {
			moveInLocalTasks.push(moveInLocalTasksSorted[i])

			//movedInLocal.push(moveInLocalTasksSorted[i].from)
			//movedInLocal.push(moveInLocalTasksSorted[i].to)
		}
	}

	for (let i = 0; i < deleteInRemote.length; i++) {
		if (typeof deleteInRemote[i] == "undefined" || deleteInRemote[i] == null || typeof deleteInRemote[i].path !== "string") {
			continue
		}

		if (!isPathIncluded(renamedInLocal, deleteInRemote[i].path) && !isPathIncluded(movedInLocal, deleteInRemote[i].path)) {
			deleteInRemoteTasks.push(deleteInRemote[i])
		}
	}

	for (let i = 0; i < deleteInLocal.length; i++) {
		if (typeof deleteInLocal[i] == "undefined" || deleteInLocal[i] == null || typeof deleteInLocal[i].path !== "string") {
			continue
		}

		if (!isPathIncluded(renamedInRemote, deleteInLocal[i].path) && !isPathIncluded(movedInRemote, deleteInLocal[i].path)) {
			deleteInLocalTasks.push(deleteInLocal[i])
		}
	}

	for (let i = 0; i < uploadToRemote.length; i++) {
		if (typeof uploadToRemote[i] == "undefined" || uploadToRemote[i] == null || typeof uploadToRemote[i].path !== "string") {
			continue
		}

		if (!isPathIncluded(renamedInLocal, uploadToRemote[i].path) && !isPathIncluded(movedInLocal, uploadToRemote[i].path)) {
			uploadToRemoteTasks.push(uploadToRemote[i])
		}
	}

	for (let i = 0; i < downloadFromRemote.length; i++) {
		if (
			typeof downloadFromRemote[i] == "undefined" ||
			downloadFromRemote[i] == null ||
			typeof downloadFromRemote[i].path !== "string"
		) {
			continue
		}

		if (!isPathIncluded(renamedInRemote, downloadFromRemote[i].path) && !isPathIncluded(movedInRemote, downloadFromRemote[i].path)) {
			downloadFromRemoteTasks.push(downloadFromRemote[i])
		}
	}

	//moveInRemoteTasks = onlyGetBaseParentMove(moveInRemoteTasks)
	//moveInLocalTasks = onlyGetBaseParentMove(moveInLocalTasks)
	//deleteInRemoteTasks = onlyGetBaseParentDelete(deleteInRemoteTasks)
	//deleteInLocalTasks = onlyGetBaseParentDelete(deleteInLocalTasks)

	return {
		renameInRemoteTasks: syncMode == "twoWay" || syncMode == "localToCloud" || syncMode == "localBackup" ? renameInRemoteTasks : [],
		renameInLocalTasks: syncMode == "twoWay" || syncMode == "cloudToLocal" || syncMode == "cloudBackup" ? renameInLocalTasks : [],
		moveInRemoteTasks: syncMode == "twoWay" || syncMode == "localToCloud" || syncMode == "localBackup" ? moveInRemoteTasks : [],
		moveInLocalTasks: syncMode == "twoWay" || syncMode == "cloudToLocal" || syncMode == "cloudBackup" ? moveInLocalTasks : [],
		deleteInRemoteTasks: syncMode == "twoWay" || syncMode == "localToCloud" ? deleteInRemoteTasks : [],
		deleteInLocalTasks: syncMode == "twoWay" || syncMode == "cloudToLocal" ? deleteInLocalTasks : [],
		uploadToRemoteTasks: syncMode == "twoWay" || syncMode == "localToCloud" || syncMode == "localBackup" ? uploadToRemoteTasks : [],
		downloadFromRemoteTasks:
			syncMode == "twoWay" || syncMode == "cloudToLocal" || syncMode == "cloudBackup" ? downloadFromRemoteTasks : []
	}
}

export const consumeTasks = async ({
	uploadToRemote,
	downloadFromRemote,
	renameInLocal,
	renameInRemote,
	moveInLocal,
	moveInRemote,
	deleteInLocal,
	deleteInRemote,
	lastLocalTree,
	lastRemoteTree,
	localTreeNow,
	remoteTreeNow,
	location
}: {
	uploadToRemote: any
	downloadFromRemote: any
	renameInLocal: any
	renameInRemote: any
	moveInLocal: any
	moveInRemote: any
	deleteInLocal: any
	deleteInRemote: any
	lastLocalTree: any
	lastRemoteTree: any
	localTreeNow: any
	remoteTreeNow: any
	location: Location
}): Promise<{
	doneTasks: any[]
	resync: boolean
}> => {
	log.info("renameInRemote", renameInRemote)
	log.info("renameInLocal", renameInLocal)
	log.info("moveInRemote", moveInRemote)
	log.info("moveInLocal", moveInLocal)
	log.info("deleteInRemote", deleteInRemote)
	log.info("deleteInLocal", deleteInLocal)
	log.info("uploadToRemote", uploadToRemote)
	log.info("downloadFromRemote", downloadFromRemote)

	const {
		uploadToRemoteTasks,
		downloadFromRemoteTasks,
		renameInLocalTasks,
		renameInRemoteTasks,
		moveInLocalTasks,
		moveInRemoteTasks,
		deleteInLocalTasks,
		deleteInRemoteTasks
	} = await sortTasks({
		uploadToRemote,
		downloadFromRemote,
		renameInLocal,
		renameInRemote,
		moveInLocal,
		moveInRemote,
		deleteInLocal,
		deleteInRemote,
		location
	})

	console.log("---------------------------------------------------------")

	log.info("renameInRemote", renameInRemoteTasks.length)
	log.info("renameInLocal", renameInLocalTasks.length)
	log.info("moveInRemote", moveInRemoteTasks.length)
	log.info("moveInLocal", moveInLocalTasks.length)
	log.info("deleteInRemote", deleteInRemoteTasks.length)
	log.info("deleteInLocal", deleteInLocalTasks.length)
	log.info("uploadToRemote", uploadToRemoteTasks.length)
	log.info("downloadFromRemote", downloadFromRemoteTasks.length)

	//await new Promise(resolve => setTimeout(resolve, 86400000))

	let resync = false
	const doneTasks: any[] = []
	let syncTasksToDo: number =
		renameInRemoteTasks.length +
		renameInLocalTasks.length +
		moveInRemoteTasks.length +
		moveInLocalTasks.length +
		deleteInRemoteTasks.length +
		deleteInLocalTasks.length +
		uploadToRemoteTasks.length +
		downloadFromRemoteTasks.length

	sendToAllPorts({
		type: "syncTasksToDo",
		data: syncTasksToDo
	})

	const updateSyncTasksToDo = () => {
		syncTasksToDo -= 1

		sendToAllPorts({
			type: "syncTasksToDo",
			data: syncTasksToDo
		})
	}

	if (renameInRemoteTasks.length > 0) {
		await chunkedPromiseAll([
			...renameInRemoteTasks.map(
				(task: any) =>
					new Promise(resolve => {
						if (typeof task !== "object" || typeof task.item !== "object" || typeof task.item.uuid !== "string") {
							updateSyncTasksToDo()

							return resolve(true)
						}

						maxSyncTasksSemaphore.acquire().then(() => {
							emitSyncTask("renameInRemote", {
								status: "start",
								task,
								location
							})

							let currentTries = 0

							const doTask = (lastErr?: any) => {
								if (currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined") {
									maxSyncTasksSemaphore.release()

									log.error("renameInRemote task failed: " + JSON.stringify(task))
									log.error(lastErr)

									ipc.addSyncIssue({
										uuid: uuidv4(),
										type: "conflict",
										where: "remote",
										path: pathModule.normalize(location.local + "/" + task.path),
										err: lastErr,
										info: "Could not rename " + pathModule.normalize(location.local + "/" + task.path) + " remotely",
										timestamp: Date.now()
									}).catch(console.error)

									emitSyncTask("renameInRemote", {
										status: "err",
										task,
										location,
										err: lastErr
									})

									updateSyncTasksToDo()

									return resolve(true)
								}

								currentTries += 1

								fsRemote
									.rename(task.type, task)
									.then(done => {
										emitSyncTask("renameInRemote", {
											status: "done",
											task,
											location
										})

										const doneTask = {
											type: "renameInRemote",
											task,
											location
										}

										doneTasks.push(doneTask)

										updateSyncTasksToDo()

										fsLocal
											.addToApplyDoneTasks(location.uuid, doneTask)
											.then(() => {
												maxSyncTasksSemaphore.release()

												return resolve(done)
											})
											.catch(err => {
												log.error(err)

												maxSyncTasksSemaphore.release()

												return resolve(done)
											})
									})
									.catch(err => {
										log.error(err)

										return setTimeout(() => {
											doTask(err)
										}, constants.retrySyncTaskTimeout)
									})
							}

							return doTask()
						})
					})
			)
		])

		for (let i = 0; i < renameInRemoteTasks.length; i++) {
			maxSyncTasksSemaphore.release()
		}
	}

	if (renameInLocalTasks.length > 0) {
		await chunkedPromiseAll([
			...renameInLocalTasks.map(
				(task: any) =>
					new Promise(resolve => {
						if (typeof task !== "object" || typeof task.from !== "string" || typeof task.to !== "string") {
							updateSyncTasksToDo()

							return resolve(true)
						}

						maxSyncTasksSemaphore.acquire().then(() => {
							emitSyncTask("renameInLocal", {
								status: "start",
								task,
								location
							})

							let currentTries = 0

							const doTask = (lastErr?: any) => {
								if (currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined") {
									maxSyncTasksSemaphore.release()

									log.error("renameInLocal task failed: " + JSON.stringify(task))
									log.error(lastErr)

									ipc.addSyncIssue({
										uuid: uuidv4(),
										type: "conflict",
										where: "local",
										path: pathModule.normalize(location.local + "/" + task.path),
										err: lastErr,
										info: "Could not rename " + pathModule.normalize(location.local + "/" + task.path) + " locally",
										timestamp: Date.now()
									}).catch(console.error)

									emitSyncTask("renameInLocal", {
										status: "err",
										task,
										location,
										err: lastErr
									})

									updateSyncTasksToDo()

									return resolve(true)
								}

								currentTries += 1

								fsLocal
									.rename(
										pathModule.normalize(location.local + "/" + task.from),
										pathModule.normalize(location.local + "/" + task.to)
									)
									.then(done => {
										emitSyncTask("renameInLocal", {
											status: "done",
											task,
											location
										})

										const doneTask = {
											type: "renameInLocal",
											task,
											location
										}

										doneTasks.push(doneTask)

										updateSyncTasksToDo()

										fsLocal
											.addToApplyDoneTasks(location.uuid, doneTask)
											.then(() => {
												maxSyncTasksSemaphore.release()

												return resolve(done)
											})
											.catch(err => {
												log.error(err)

												maxSyncTasksSemaphore.release()

												return resolve(done)
											})
									})
									.catch(async err => {
										if (
											!(await fsRemote.doesExistLocally(
												pathModule.normalize(pathModule.join(location.local, task.path))
											))
										) {
											emitSyncTask("renameInLocal", {
												status: "err",
												task,
												location,
												err
											})

											maxSyncTasksSemaphore.release()

											updateSyncTasksToDo()

											return resolve(true)
										}

										if (
											err.toString() == "eperm" ||
											(typeof err.code == "string" && err.code == "EPERM") ||
											(typeof err.code == "string" && err.code == "EBUSY") ||
											err.toString() == "deletedLocally"
										) {
											emitSyncTask("renameInLocal", {
												status: "err",
												task,
												location,
												err: err
											})

											maxSyncTasksSemaphore.release()

											updateSyncTasksToDo()

											resync = true

											return resolve(true)
										}

										if (typeof err.code == "string" && err.code == "ENOENT") {
											updateSyncTasksToDo()

											maxSyncTasksSemaphore.release()

											resync = true

											return resolve(true)
										}

										log.error(err)

										return setTimeout(() => {
											doTask(err)
										}, constants.retrySyncTaskTimeout)
									})
							}

							return doTask()
						})
					})
			)
		])

		for (let i = 0; i < renameInLocal.length; i++) {
			maxSyncTasksSemaphore.release()
		}
	}

	if (moveInRemoteTasks.length > 0) {
		await chunkedPromiseAll([
			...moveInRemoteTasks.map(
				(task: any) =>
					new Promise(resolve => {
						if (typeof task !== "object" || typeof task.item !== "object" || typeof task.item.uuid !== "string") {
							updateSyncTasksToDo()

							return resolve(true)
						}

						maxSyncTasksSemaphore.acquire().then(() => {
							emitSyncTask("moveInRemote", {
								status: "start",
								task,
								location
							})

							let currentTries = 0

							const doTask = (lastErr?: any) => {
								if (currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined") {
									maxSyncTasksSemaphore.release()

									log.error("moveInRemote task failed: " + JSON.stringify(task))
									log.error(lastErr)

									ipc.addSyncIssue({
										uuid: uuidv4(),
										type: "conflict",
										where: "remote",
										path: pathModule.normalize(location.local + "/" + task.path),
										err: lastErr,
										info: "Could not move " + pathModule.normalize(location.local + "/" + task.path) + " remotely",
										timestamp: Date.now()
									}).catch(console.error)

									emitSyncTask("moveInRemote", {
										status: "err",
										task,
										location,
										err: lastErr
									})

									updateSyncTasksToDo()

									return resolve(true)
								}

								currentTries += 1

								fsRemote
									.move(task.type, task, location, remoteTreeNow)
									.then(done => {
										emitSyncTask("moveInRemote", {
											status: "done",
											task,
											location
										})

										const doneTask = {
											type: "moveInRemote",
											task,
											location
										}

										doneTasks.push(doneTask)

										updateSyncTasksToDo()

										fsLocal
											.addToApplyDoneTasks(location.uuid, doneTask)
											.then(() => {
												maxSyncTasksSemaphore.release()

												return resolve(done)
											})
											.catch(err => {
												log.error(err)

												maxSyncTasksSemaphore.release()

												return resolve(done)
											})
									})
									.catch(err => {
										log.error(err)

										return setTimeout(() => {
											doTask(err)
										}, constants.retrySyncTaskTimeout)
									})
							}

							return doTask()
						})
					})
			)
		])

		for (let i = 0; i < moveInRemoteTasks.length; i++) {
			maxSyncTasksSemaphore.release()
		}
	}

	if (moveInLocalTasks.length > 0) {
		await chunkedPromiseAll([
			...moveInLocalTasks.map(
				(task: any) =>
					new Promise(resolve => {
						if (typeof task !== "object" || typeof task.from !== "string" || typeof task.to !== "string") {
							updateSyncTasksToDo()

							return resolve(true)
						}

						maxSyncTasksSemaphore.acquire().then(() => {
							emitSyncTask("moveInLocal", {
								status: "start",
								task,
								location
							})

							let currentTries = 0

							const doTask = (lastErr?: any) => {
								if (currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined") {
									maxSyncTasksSemaphore.release()

									log.error("moveInLocal task failed: " + JSON.stringify(task))
									log.error(lastErr)

									ipc.addSyncIssue({
										uuid: uuidv4(),
										type: "conflict",
										where: "local",
										path: pathModule.normalize(location.local + "/" + task.path),
										err: lastErr,
										info: "Could not move " + pathModule.normalize(location.local + "/" + task.path) + " locally",
										timestamp: Date.now()
									}).catch(console.error)

									emitSyncTask("moveInLocal", {
										status: "err",
										task,
										location,
										err: lastErr
									})

									updateSyncTasksToDo()

									return resolve(true)
								}

								currentTries += 1

								fsLocal
									.move(
										pathModule.normalize(location.local + "/" + task.from),
										pathModule.normalize(location.local + "/" + task.to)
									)
									.then(done => {
										emitSyncTask("moveInLocal", {
											status: "done",
											task,
											location
										})

										const doneTask = {
											type: "moveInLocal",
											task,
											location
										}

										doneTasks.push(doneTask)

										updateSyncTasksToDo()

										fsLocal
											.addToApplyDoneTasks(location.uuid, doneTask)
											.then(() => {
												maxSyncTasksSemaphore.release()

												return resolve(done)
											})
											.catch(err => {
												log.error(err)

												maxSyncTasksSemaphore.release()

												return resolve(done)
											})
									})
									.catch(async err => {
										if (
											!(await fsRemote.doesExistLocally(
												pathModule.normalize(pathModule.join(location.local, task.path))
											))
										) {
											emitSyncTask("moveInLocal", {
												status: "err",
												task,
												location,
												err
											})

											maxSyncTasksSemaphore.release()

											updateSyncTasksToDo()

											return resolve(true)
										}

										if (
											err.toString() == "eperm" ||
											(typeof err.code == "string" && err.code == "EPERM") ||
											(typeof err.code == "string" && err.code == "EBUSY") ||
											err.toString() == "deletedLocally"
										) {
											emitSyncTask("moveInLocal", {
												status: "err",
												task,
												location,
												err: err
											})

											maxSyncTasksSemaphore.release()

											updateSyncTasksToDo()

											resync = true

											return resolve(true)
										}

										if (typeof err.code == "string" && err.code == "ENOENT") {
											updateSyncTasksToDo()

											maxSyncTasksSemaphore.release()

											resync = true

											return resolve(true)
										}

										log.error(err)

										return setTimeout(() => {
											doTask(err)
										}, constants.retrySyncTaskTimeout)
									})
							}

							return doTask()
						})
					})
			)
		])

		for (let i = 0; i < moveInLocalTasks.length; i++) {
			maxSyncTasksSemaphore.release()
		}
	}

	if (deleteInRemoteTasks.length > 0) {
		await chunkedPromiseAll([
			...deleteInRemoteTasks.map(
				(task: any) =>
					new Promise(resolve => {
						if (typeof task !== "object" || typeof task.item !== "object" || typeof task.item.uuid !== "string") {
							updateSyncTasksToDo()

							return resolve(true)
						}

						maxSyncTasksSemaphore.acquire().then(() => {
							emitSyncTask("deleteInRemote", {
								status: "start",
								task,
								location
							})

							let currentTries = 0

							const doTask = (lastErr?: any) => {
								if (currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined") {
									maxSyncTasksSemaphore.release()

									log.error("deleteInRemote task failed: " + JSON.stringify(task))
									log.error(lastErr)

									ipc.addSyncIssue({
										uuid: uuidv4(),
										type: "conflict",
										where: "remote",
										path: pathModule.normalize(location.local + "/" + task.path),
										err: lastErr,
										info: "Could not delete " + pathModule.normalize(location.local + "/" + task.path) + " remotely",
										timestamp: Date.now()
									}).catch(console.error)

									emitSyncTask("deleteInRemote", {
										status: "err",
										task,
										location,
										err: lastErr
									})

									updateSyncTasksToDo()

									return resolve(true)
								}

								currentTries += 1

								fsRemote
									.rm(task.type, task.item.uuid)
									.then(done => {
										emitSyncTask("deleteInRemote", {
											status: "done",
											task,
											location
										})

										const doneTask = {
											type: "deleteInRemote",
											task,
											location
										}

										doneTasks.push(doneTask)

										updateSyncTasksToDo()

										fsLocal
											.addToApplyDoneTasks(location.uuid, doneTask)
											.then(() => {
												maxSyncTasksSemaphore.release()

												return resolve(done)
											})
											.catch(err => {
												log.error(err)

												maxSyncTasksSemaphore.release()

												return resolve(done)
											})
									})
									.catch(err => {
										log.error(err)

										return setTimeout(() => {
											doTask(err)
										}, constants.retrySyncTaskTimeout)
									})
							}

							return doTask()
						})
					})
			)
		])

		for (let i = 0; i < deleteInRemoteTasks.length; i++) {
			maxSyncTasksSemaphore.release()
		}
	}

	if (deleteInLocalTasks.length > 0) {
		await chunkedPromiseAll([
			...deleteInLocalTasks.map(
				(task: any) =>
					new Promise(resolve => {
						if (typeof task !== "object" || typeof task.path !== "string") {
							updateSyncTasksToDo()

							return resolve(true)
						}

						maxSyncTasksSemaphore.acquire().then(() => {
							emitSyncTask("deleteInLocal", {
								status: "start",
								task,
								location
							})

							let currentTries = 0

							const doTask = (lastErr?: any) => {
								if (currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined") {
									maxSyncTasksSemaphore.release()

									log.error("deleteInLocal task failed: " + JSON.stringify(task))
									log.error(lastErr)

									ipc.addSyncIssue({
										uuid: uuidv4(),
										type: "conflict",
										where: "local",
										path: pathModule.normalize(location.local + "/" + task.path),
										err: lastErr,
										info: "Could not delete " + pathModule.normalize(location.local + "/" + task.path) + " locally",
										timestamp: Date.now()
									}).catch(console.error)

									emitSyncTask("deleteInLocal", {
										status: "err",
										task,
										location,
										err: lastErr
									})

									updateSyncTasksToDo()

									return resolve(true)
								}

								currentTries += 1

								fsLocal
									.rm(pathModule.normalize(location.local + "/" + task.path), location)
									.then(done => {
										emitSyncTask("deleteInLocal", {
											status: "done",
											task,
											location
										})

										const doneTask = {
											type: "deleteInLocal",
											task,
											location
										}

										doneTasks.push(doneTask)

										updateSyncTasksToDo()

										fsLocal
											.addToApplyDoneTasks(location.uuid, doneTask)
											.then(() => {
												maxSyncTasksSemaphore.release()

												return resolve(done)
											})
											.catch(err => {
												log.error(err)

												maxSyncTasksSemaphore.release()

												return resolve(done)
											})
									})
									.catch(async err => {
										if (
											!(await fsRemote.doesExistLocally(
												pathModule.normalize(pathModule.join(location.local, task.path))
											))
										) {
											emitSyncTask("deleteInLocal", {
												status: "err",
												task,
												location,
												err
											})

											maxSyncTasksSemaphore.release()

											updateSyncTasksToDo()

											return resolve(true)
										}

										if (
											err.toString() == "eperm" ||
											err.toString() == "deletedLocally" ||
											(typeof err.code == "string" && err.code == "EPERM") ||
											(typeof err.code == "string" && err.code == "EBUSY")
										) {
											emitSyncTask("deleteInLocal", {
												status: "err",
												task,
												location,
												err: err
											})

											maxSyncTasksSemaphore.release()

											updateSyncTasksToDo()

											resync = true

											return resolve(true)
										}

										log.error(err)

										return setTimeout(() => {
											doTask(err)
										}, constants.retrySyncTaskTimeout)
									})
							}

							return doTask()
						})
					})
			)
		])

		for (let i = 0; i < deleteInLocalTasks.length; i++) {
			maxSyncTasksSemaphore.release()
		}
	}

	if (uploadToRemoteTasks.length > 0) {
		await chunkedPromiseAll([
			...uploadToRemoteTasks.map(
				(task: any) =>
					new Promise(resolve => {
						if (typeof task !== "object" || typeof task.item !== "object" || typeof task.item.uuid !== "string") {
							updateSyncTasksToDo()

							return resolve(true)
						}

						maxSyncTasksSemaphore.acquire().then(() => {
							emitSyncTask("uploadToRemote", {
								status: "start",
								task,
								location
							})

							let currentTries = 0

							const doTask = (lastErr?: any) => {
								if (currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined") {
									maxSyncTasksSemaphore.release()

									log.error("uploadToRemote task failed: " + JSON.stringify(task))
									log.error(lastErr)

									ipc.addSyncIssue({
										uuid: uuidv4(),
										type: "conflict",
										where: "remote",
										path: pathModule.normalize(location.local + "/" + task.path),
										err: lastErr,
										info: "Could not upload " + pathModule.normalize(location.local + "/" + task.path),
										timestamp: Date.now()
									}).catch(console.error)

									emitSyncTask("uploadToRemote", {
										status: "err",
										task,
										location,
										err: lastErr
									})

									updateSyncTasksToDo()

									return resolve(true)
								}

								currentTries += 1

								maxConcurrentUploadsSemaphore.acquire().then(() => {
									emitSyncTask("uploadToRemote", {
										status: "started",
										task,
										location
									})

									const promise =
										task.type == "folder"
											? fsRemote.mkdir(task.path, remoteTreeNow, location, task, task.item.uuid)
											: fsRemote.upload(task.path, remoteTreeNow, location, task, task.item.uuid)

									promise
										.then(result => {
											emitSyncTask("uploadToRemote", {
												status: "done",
												task,
												location
											})

											const doneTask = {
												type: "uploadToRemote",
												task: {
													...task,
													info: {
														...result
													}
												},
												location
											}

											doneTasks.push(doneTask)

											updateSyncTasksToDo()

											fsLocal
												.addToApplyDoneTasks(location.uuid, doneTask)
												.then(() => {
													maxConcurrentUploadsSemaphore.release()
													maxSyncTasksSemaphore.release()

													return resolve(result)
												})
												.catch(err => {
													log.error(err)

													maxConcurrentUploadsSemaphore.release()
													maxSyncTasksSemaphore.release()

													return resolve(result)
												})
										})
										.catch(async err => {
											if (
												!(await fsRemote.doesExistLocally(
													pathModule.normalize(pathModule.join(location.local, task.path))
												))
											) {
												emitSyncTask("uploadToRemote", {
													status: "err",
													task,
													location,
													err
												})

												maxConcurrentUploadsSemaphore.release()
												maxSyncTasksSemaphore.release()

												updateSyncTasksToDo()

												return resolve(true)
											}

											if (
												err.toString().toLowerCase().indexOf("invalid upload key") !== -1 ||
												err.toString().toLowerCase().indexOf("chunks are not matching") !== -1 ||
												err.toString() == "deletedLocally" ||
												err.toString() == "parentMissing" ||
												err.toString() == "eperm" ||
												(typeof err.code == "string" && err.code == "EPERM") ||
												(typeof err.code == "string" && err.code == "EBUSY")
											) {
												emitSyncTask("uploadToRemote", {
													status: "err",
													task,
													location,
													err
												})

												maxConcurrentUploadsSemaphore.release()
												maxSyncTasksSemaphore.release()

												updateSyncTasksToDo()

												resync = true

												return resolve(true)
											}

											log.error(err)

											maxConcurrentUploadsSemaphore.release()
											maxSyncTasksSemaphore.release()

											return setTimeout(() => {
												doTask(err)
											}, constants.retrySyncTaskTimeout)
										})
								})
							}

							return doTask()
						})
					})
			)
		])

		for (let i = 0; i < uploadToRemoteTasks.length; i++) {
			maxSyncTasksSemaphore.release()
			maxConcurrentUploadsSemaphore.release()
		}
	}

	if (downloadFromRemoteTasks.length > 0) {
		await chunkedPromiseAll([
			...downloadFromRemoteTasks.map(
				(task: any) =>
					new Promise(resolve => {
						if (typeof task !== "object" || typeof task.path !== "string") {
							updateSyncTasksToDo()

							return resolve(true)
						}

						maxSyncTasksSemaphore.acquire().then(() => {
							emitSyncTask("downloadFromRemote", {
								status: "start",
								task,
								location
							})

							let currentTries = 0

							const doTask = (lastErr?: any) => {
								if (currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined") {
									maxSyncTasksSemaphore.release()

									log.error("downloadFromRemote task failed: " + JSON.stringify(task))
									log.error(lastErr)

									ipc.addSyncIssue({
										uuid: uuidv4(),
										type: "conflict",
										where: "local",
										path: pathModule.normalize(location.local + "/" + task.path),
										err: lastErr,
										info: "Could not download " + pathModule.normalize(location.local + "/" + task.path),
										timestamp: Date.now()
									}).catch(console.error)

									emitSyncTask("downloadFromRemote", {
										status: "err",
										task,
										location,
										err: lastErr
									})

									updateSyncTasksToDo()

									return resolve(true)
								}

								currentTries += 1

								maxConcurrentDownloadsSemaphore.acquire().then(() => {
									emitSyncTask("downloadFromRemote", {
										status: "started",
										task,
										location
									})

									const isPresent = new Promise<boolean>((resolve, reject) => {
										if (task.type == "folder") {
											folderPresent(task.item.uuid)
												.then(present => {
													if (!present.present || present.trash) {
														return resolve(false)
													}

													return resolve(true)
												})
												.catch(reject)
										} else {
											filePresent(task.item.uuid)
												.then(present => {
													if (!present.present || present.versioned || present.trash) {
														return resolve(false)
													}

													return resolve(true)
												})
												.catch(reject)
										}
									})

									isPresent
										.then(present => {
											if (!present) {
												maxConcurrentDownloadsSemaphore.release()
												maxSyncTasksSemaphore.release()

												updateSyncTasksToDo()

												return resolve(true)
											}

											const promise =
												task.type == "folder"
													? fsLocal.mkdir(task.path, location)
													: fsLocal.download(task.path, location, task)

											promise
												.then(result => {
													emitSyncTask("downloadFromRemote", {
														status: "done",
														task,
														location
													})

													const doneTask = {
														type: "downloadFromRemote",
														task: {
															...task,
															info: {
																...result
															}
														},
														location
													}

													doneTasks.push(doneTask)

													updateSyncTasksToDo()

													fsLocal
														.addToApplyDoneTasks(location.uuid, doneTask)
														.then(() => {
															maxConcurrentDownloadsSemaphore.release()
															maxSyncTasksSemaphore.release()

															return resolve(result)
														})
														.catch(err => {
															log.error(err)

															maxConcurrentDownloadsSemaphore.release()
															maxSyncTasksSemaphore.release()

															return resolve(result)
														})
												})
												.catch(err => {
													maxConcurrentDownloadsSemaphore.release()

													log.error(err)

													return setTimeout(() => {
														doTask(err)
													}, constants.retrySyncTaskTimeout)
												})
										})
										.catch(err => {
											maxConcurrentDownloadsSemaphore.release()

											log.error(err)

											return setTimeout(() => {
												doTask(err)
											}, constants.retrySyncTaskTimeout)
										})
								})
							}

							return doTask()
						})
					})
			)
		])

		for (let i = 0; i < downloadFromRemoteTasks.length; i++) {
			maxSyncTasksSemaphore.release()
			maxConcurrentDownloadsSemaphore.release()
		}
	}

	maxSyncTasksSemaphore.purge()
	maxConcurrentDownloadsSemaphore.purge()
	maxConcurrentUploadsSemaphore.purge()

	sendToAllPorts({
		type: "syncTasksToDo",
		data: 0
	})

	return { doneTasks, resync }
}
