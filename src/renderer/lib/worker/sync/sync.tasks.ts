import { filePresent, folderPresent } from "../../api"
import { getIgnored, getSyncMode, sortMoveRenameTasks, emitSyncTask, isIgnoredBySelectiveSync } from "./sync.utils"
import { sendToAllPorts } from "../ipc"
import constants from "../../../../constants.json"
import { Location } from "../../../../types"
import { Semaphore, chunkedPromiseAll, replaceFirstNChars } from "../../helpers"
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
	uploadToRemote: any[]
	downloadFromRemote: any[]
	renameInLocal: any[]
	renameInRemote: any[]
	moveInLocal: any[]
	moveInRemote: any[]
	deleteInLocal: any[]
	deleteInRemote: any[]
	location: Location
}): Promise<any> => {
	const ignored = []
	const [{ selectiveSyncRemoteIgnore, filenIgnore }, syncMode] = await Promise.all([getIgnored(location), getSyncMode(location)])
	const filenIgnoreDenies = (task: any) => filenIgnore.denies(task.type == "folder" ? task.path + '/' : task.path)

	for (let i = 0; i < renameInLocal.length; i++) {
		if (filenIgnoreDenies(renameInLocal[i]) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, renameInLocal[i].path)) {
			ignored.push(renameInLocal[i].path)
			renameInLocal.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < renameInRemote.length; i++) {
		if (filenIgnoreDenies(renameInRemote[i]) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, renameInRemote[i].path)) {
			ignored.push(renameInRemote[i].path)
			renameInRemote.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < moveInLocal.length; i++) {
		if (filenIgnoreDenies(moveInLocal[i]) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, moveInLocal[i].path)) {
			ignored.push(moveInLocal[i].path)
			moveInLocal.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < moveInRemote.length; i++) {
		if (filenIgnoreDenies(moveInRemote[i]) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, moveInRemote[i].path)) {
			ignored.push(moveInRemote[i].path)
			moveInRemote.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < deleteInLocal.length; i++) {
		if (filenIgnoreDenies(deleteInLocal[i]) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, deleteInLocal[i].path)) {
			ignored.push(deleteInLocal[i].path)
			deleteInLocal.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < deleteInRemote.length; i++) {
		if (filenIgnoreDenies(deleteInRemote[i]) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, deleteInRemote[i].path)) {
			ignored.push(deleteInRemote[i].path)
			deleteInRemote.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < uploadToRemote.length; i++) {
		if (filenIgnoreDenies(uploadToRemote[i]) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, uploadToRemote[i].path)) {
			ignored.push(uploadToRemote[i].path)
			uploadToRemote.splice(i, 1)

			i -= 1
		}
	}

	for (let i = 0; i < downloadFromRemote.length; i++) {
		if (
			filenIgnoreDenies(downloadFromRemote[i]) ||
			isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, downloadFromRemote[i].path)
		) {
			ignored.push(downloadFromRemote[i].path)
			downloadFromRemote.splice(i, 1)

			i -= 1
		}
	}

	const renameInRemoteTasksSorted: any[] = sortMoveRenameTasks(renameInRemote)
	const moveInRemoteTasksSorted: any[] = sortMoveRenameTasks(moveInRemote)
	const renameInLocalTasksSorted: any[] = sortMoveRenameTasks(renameInLocal)
	const moveInLocalTasksSorted: any[] = sortMoveRenameTasks(moveInLocal)

	const renameInRemoteTasks = renameInRemoteTasksSorted
		.filter(
			task =>
				typeof task !== "undefined" &&
				task !== null &&
				typeof task.path === "string" &&
				typeof task.from === "string" &&
				typeof task.to === "string"
		)
		.sort((a, b) => a.path.length - b.path.length)

	const renameInLocalTasks = renameInLocalTasksSorted
		.filter(
			task =>
				typeof task !== "undefined" &&
				task !== null &&
				typeof task.path === "string" &&
				typeof task.from === "string" &&
				typeof task.to === "string"
		)
		.sort((a, b) => a.path.length - b.path.length)

	const moveInRemoteTasks = moveInRemoteTasksSorted
		.filter(
			task =>
				typeof task !== "undefined" &&
				task !== null &&
				typeof task.path === "string" &&
				typeof task.from === "string" &&
				typeof task.to === "string"
		)
		.sort((a, b) => a.path.length - b.path.length)

	const moveInLocalTasks = moveInLocalTasksSorted
		.filter(
			task =>
				typeof task !== "undefined" &&
				task !== null &&
				typeof task.path === "string" &&
				typeof task.from === "string" &&
				typeof task.to === "string"
		)
		.sort((a, b) => a.path.length - b.path.length)

	const deleteInRemoteTasks = deleteInRemote
		.filter(task => typeof task !== "undefined" && task !== null && typeof task.path === "string")
		.sort((a, b) => a.path.length - b.path.length)

	const deleteInLocalTasks = deleteInLocal
		.filter(task => typeof task !== "undefined" && task !== null && typeof task.path === "string")
		.sort((a, b) => a.path.length - b.path.length)

	const uploadToRemoteTasks = uploadToRemote
		.filter(task => typeof task !== "undefined" && task !== null && typeof task.path === "string")
		.sort((a, b) => a.path.length - b.path.length)

	const downloadFromRemoteTasks = downloadFromRemote
		.filter(task => typeof task !== "undefined" && task !== null && typeof task.path === "string")
		.sort((a, b) => a.path.length - b.path.length)

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
	remoteTreeNow,
	location
}: {
	uploadToRemote: any[]
	downloadFromRemote: any[]
	renameInLocal: any[]
	renameInRemote: any[]
	moveInLocal: any[]
	moveInRemote: any[]
	deleteInLocal: any[]
	deleteInRemote: any[]
	remoteTreeNow: any
	location: Location
}): Promise<{
	doneTasks: any[]
	resync: boolean
}> => {
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

	log.info("renameInRemote", renameInRemoteTasks.length)
	log.info("renameInLocal", renameInLocalTasks.length)
	log.info("moveInRemote", moveInRemoteTasks.length)
	log.info("moveInLocal", moveInLocalTasks.length)
	log.info("deleteInRemote", deleteInRemoteTasks.length)
	log.info("deleteInLocal", deleteInLocalTasks.length)
	log.info("uploadToRemote", uploadToRemoteTasks.length)
	log.info("downloadFromRemote", downloadFromRemoteTasks.length)

	let resync = false
	const doneTasks: any[] = []
	let syncTasksToDo =
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

	for (const task of renameInRemoteTasks) {
		await new Promise<void>(resolve => {
			if (typeof task !== "object" || typeof task.item !== "object" || typeof task.item.uuid !== "string") {
				updateSyncTasksToDo()
				resolve()

				return
			}

			emitSyncTask("renameInRemote", {
				status: "start",
				task,
				location
			})

			let currentTries = 0

			const doTask = (lastErr?: any) => {
				if (currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined") {
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
					resolve()

					return
				}

				currentTries += 1

				const isPresent = new Promise<boolean>((resolve, reject) => {
					if (task.type == "folder") {
						folderPresent(task.item.uuid)
							.then(present => {
								if (!present.present || present.trash) {
									resolve(false)

									return
								}

								resolve(true)
							})
							.catch(reject)
					} else {
						filePresent(task.item.uuid)
							.then(present => {
								if (!present.present || present.versioned || present.trash) {
									resolve(false)

									return
								}

								resolve(true)
							})
							.catch(reject)
					}
				})

				isPresent
					.then(present => {
						if (!present) {
							emitSyncTask("renameInRemote", {
								status: "err",
								task,
								location
							})

							updateSyncTasksToDo()
							resolve()

							return
						}

						fsRemote
							.rename(task.type, task)
							.then(() => {
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
									.then(() => resolve())
									.catch(err => {
										log.error(err)

										resolve()
									})
							})
							.catch(err => {
								log.error(err)

								setTimeout(() => {
									doTask(err)
								}, constants.retrySyncTaskTimeout)
							})
					})
					.catch(err => {
						log.error(err)

						setTimeout(() => {
							doTask(err)
						}, constants.retrySyncTaskTimeout)
					})
			}

			doTask()
		})
	}

	for (const task of renameInLocalTasks) {
		await new Promise<void>(resolve => {
			if (typeof task !== "object" || typeof task.from !== "string" || typeof task.to !== "string") {
				updateSyncTasksToDo()
				resolve()

				return
			}

			emitSyncTask("renameInLocal", {
				status: "start",
				task,
				location
			})

			let currentTries = 0

			const doTask = (lastErr?: any) => {
				if (currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined") {
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
					resolve()

					return
				}

				currentTries += 1

				fsRemote
					.doesExistLocally(pathModule.normalize(location.local + "/" + task.from))
					.then(exists => {
						if (!exists) {
							emitSyncTask("renameInLocal", {
								status: "err",
								task,
								location
							})

							updateSyncTasksToDo()
							resolve()

							return
						}

						fsLocal
							.rename(
								pathModule.normalize(location.local + "/" + task.from),
								pathModule.normalize(location.local + "/" + task.to)
							)
							.then(() => {
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
									.then(() => resolve())
									.catch(err => {
										log.error(err)

										resolve()
									})
							})
							.catch(async err => {
								if (!(await fsRemote.doesExistLocally(pathModule.normalize(location.local + "/" + task.from)))) {
									emitSyncTask("renameInLocal", {
										status: "err",
										task,
										location,
										err
									})

									updateSyncTasksToDo()
									resolve()

									return
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

									resync = true

									updateSyncTasksToDo()
									resolve()

									return
								}

								if (typeof err.code == "string" && err.code == "ENOENT") {
									resync = true

									updateSyncTasksToDo()
									resolve()

									return
								}

								log.error(err)

								setTimeout(() => {
									doTask(err)
								}, constants.retrySyncTaskTimeout)
							})
					})
					.catch(err => {
						log.error(err)

						setTimeout(() => {
							doTask(err)
						}, constants.retrySyncTaskTimeout)
					})
			}

			doTask()
		})
	}

	for (const task of moveInRemoteTasks) {
		await new Promise<void>(resolve => {
			if (typeof task !== "object" || typeof task.item !== "object" || typeof task.item.uuid !== "string") {
				updateSyncTasksToDo()
				resolve()

				return
			}

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
					resolve()

					return
				}

				currentTries += 1

				const isPresent = new Promise<boolean>((resolve, reject) => {
					if (task.type == "folder") {
						folderPresent(task.item.uuid)
							.then(present => {
								if (!present.present || present.trash) {
									resolve(false)

									return
								}

								resolve(true)
							})
							.catch(reject)
					} else {
						filePresent(task.item.uuid)
							.then(present => {
								if (!present.present || present.versioned || present.trash) {
									resolve(false)

									return
								}

								resolve(true)
							})
							.catch(reject)
					}
				})

				isPresent
					.then(present => {
						if (!present) {
							emitSyncTask("moveInRemote", {
								status: "err",
								task,
								location
							})

							updateSyncTasksToDo()
							resolve()

							return
						}

						fsRemote
							.move(task.type, task, location, remoteTreeNow)
							.then(() => {
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
									.then(() => resolve())
									.catch(err => {
										log.error(err)

										resolve()
									})
							})
							.catch(err => {
								log.error(err)

								setTimeout(() => {
									doTask(err)
								}, constants.retrySyncTaskTimeout)
							})
					})
					.catch(err => {
						log.error(err)

						setTimeout(() => {
							doTask(err)
						}, constants.retrySyncTaskTimeout)
					})
			}

			doTask()
		})
	}

	for (const task of moveInLocalTasks) {
		await new Promise<void>(resolve => {
			if (typeof task !== "object" || typeof task.from !== "string" || typeof task.to !== "string") {
				updateSyncTasksToDo()
				resolve()

				return
			}

			emitSyncTask("moveInLocal", {
				status: "start",
				task,
				location
			})

			let currentTries = 0

			const doTask = (lastErr?: any) => {
				if (currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined") {
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
					resolve()

					return
				}

				currentTries += 1

				fsRemote
					.doesExistLocally(pathModule.normalize(location.local + "/" + task.from))
					.then(exists => {
						if (!exists) {
							emitSyncTask("moveInLocal", {
								status: "err",
								task,
								location
							})

							updateSyncTasksToDo()
							resolve()

							return
						}

						fsLocal
							.move(
								pathModule.normalize(location.local + "/" + task.from),
								pathModule.normalize(location.local + "/" + task.to)
							)
							.then(() => {
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
									.then(() => resolve())
									.catch(err => {
										log.error(err)

										resolve()
									})
							})
							.catch(async err => {
								if (!(await fsRemote.doesExistLocally(pathModule.normalize(location.local + "/" + task.from)))) {
									emitSyncTask("moveInLocal", {
										status: "err",
										task,
										location,
										err
									})

									updateSyncTasksToDo()
									resolve()

									return
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

									resync = true

									updateSyncTasksToDo()
									resolve()

									return
								}

								if (typeof err.code == "string" && err.code == "ENOENT") {
									resync = true

									updateSyncTasksToDo()
									resolve()

									return
								}

								log.error(err)

								setTimeout(() => {
									doTask(err)
								}, constants.retrySyncTaskTimeout)
							})
					})
					.catch(err => {
						log.error(err)

						setTimeout(() => {
							doTask(err)
						}, constants.retrySyncTaskTimeout)
					})
			}

			doTask()
		})
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

								fsRemote
									.doesExistLocally(pathModule.normalize(pathModule.join(location.local, task.path)))
									.then(exists => {
										if (!exists) {
											emitSyncTask("deleteInLocal", {
												status: "err",
												task,
												location
											})

											maxSyncTasksSemaphore.release()

											updateSyncTasksToDo()

											return resolve(true)
										}

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
											? fsRemote.mkdir(task.path, remoteTreeNow, location, task.item.uuid)
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

												emitSyncTask("downloadFromRemote", {
													status: "err",
													task,
													location
												})

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
