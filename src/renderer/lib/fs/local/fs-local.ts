import ipc from "../../ipc"
import memoryCache from "../../memoryCache"
import {
	convertTimestampToMs,
	windowsPathToUnixStyle,
	pathIncludesDot,
	isFolderPathExcluded,
	pathValidation,
	pathIsFileOrFolderNameIgnoredByDefault,
	isSystemPathExcluded,
	isNameOverMaxLength,
	isPathOverMaxLength,
	Semaphore,
	chunkedPromiseAll
} from "../../helpers"
import { downloadChunk } from "../../api"
import { decryptData } from "../../crypto"
import { v4 as uuidv4 } from "uuid"
import db from "../../db"
import constants from "../../../../constants.json"
import { isSyncLocationPaused, isIgnoredBySelectiveSync } from "../../worker/sync/sync.utils"
import { Stats } from "fs-extra"
import { LocalDirectoryTreeResult, Location } from "../../../../types"
import { invokeProxy } from "../../ipc/ipc"

const pathModule = window.require("path")
const log = window.require("electron-log")
const gitignoreParser = window.require("@gerhobbelt/gitignore-parser")
const fs = window.require("fs-extra")
const readdirp = window.require("readdirp")
const readline = window.require("readline")

const downloadThreadsSemaphore = new Semaphore(constants.maxDownloadThreads)
let LOCAL_TRASH_DIRS_CLEAN_INTERVAL: NodeJS.Timer
let APPLY_DONE_TASKS_PATH: Record<string, string> = {}
const APPLY_DONE_TASKS_VERSION: number = 1
const applyDoneTasksSemaphore = new Semaphore(1)

export const normalizePath = (path: string): string => {
	return pathModule.normalize(path)
}

export const realPath = async (path: string): Promise<string> => {
	return await invokeProxy("fsRealPath", path)
}

export const checkLastModified = async (path: string): Promise<{ changed: boolean; mtimeMs?: number }> => {
	return await invokeProxy("fsCheckLastModified", path)
}

export const getTempDir = async (): Promise<string> => {
	if (memoryCache.has("tmpDir")) {
		return memoryCache.get("tmpDir")
	}

	const tmpDirRes = await ipc.getAppPath("temp")
	const tmpDir = normalizePath(tmpDirRes)

	memoryCache.set("tmpDir", tmpDir)

	return tmpDir
}

export const smokeTest = async (path: string): Promise<void> => {
	return await invokeProxy("fsSmokeTest", path)
}

export interface StatsIPC extends Stats {
	isLink: boolean
	isDir: boolean
	file: boolean
}

export const gracefulLStat = async (path: string): Promise<StatsIPC> => {
	return await invokeProxy("fsGracefulLStat", path)
}

export const exists = async (path: string): Promise<boolean> => {
	return await invokeProxy("fsExists", path)
}

export const canReadWriteAtPath = async (path: string): Promise<boolean> => {
	return await invokeProxy("fsCanReadWriteAtPath", path)
}

export const canReadAtPath = async (path: string): Promise<boolean> => {
	return await invokeProxy("fsCanReadAtPath", path)
}

export const directoryTree = async (path: string, skipCache = false, location: Location): Promise<LocalDirectoryTreeResult> => {
	const cacheKey = "directoryTreeLocal:" + location.uuid

	let [localDataChanged, cachedLocalTree, excludeDot, filenIgnore, selectiveSyncRemote] = await chunkedPromiseAll([
		db.get("localDataChanged:" + location.uuid),
		db.get(cacheKey),
		db.get("excludeDot"),
		db.get("filenIgnore:" + location.uuid),
		db.get("selectiveSync:remote:" + location.uuid)
	])

	if (!localDataChanged && cachedLocalTree !== null && !skipCache) {
		return {
			changed: false,
			data: cachedLocalTree
		}
	}

	if (excludeDot === null) {
		excludeDot = true
	}

	if (typeof filenIgnore !== "string") {
		filenIgnore = ""
	}

	const filenIgnoreCompiled = gitignoreParser.compile(filenIgnore)

	path = normalizePath(path)

	const obj: {
		files: Record<
			string,
			{
				name: string
				size: number
				lastModified: number
				ino: number
			}
		>
		folders: Record<
			string,
			{
				name: string
				lastModified: number
				ino: number
			}
		>
		ino: Record<number, { type: "folder" | "file"; path: string }>
	} = {
		files: {},
		folders: {},
		ino: {}
	}

	const processEntry = async (item: any) => {
		try {
			if (process.platform === "win32") {
				item.path = windowsPathToUnixStyle(item.path)
			}

			if (
				!(excludeDot && (item.basename.startsWith(".") || pathIncludesDot(item.path))) &&
				!isFolderPathExcluded(item.path) &&
				pathValidation(item.path) &&
				!pathIsFileOrFolderNameIgnoredByDefault(item.path) &&
				!isSystemPathExcluded("//" + item.fullPath) &&
				!isNameOverMaxLength(item.basename) &&
				!isPathOverMaxLength(location.local + "/" + item.path)
			) {
				const stats = await gracefulLStat(item.fullPath)

				if (!stats.isLink) {
					if (stats.isDir) {
						const inoNum = parseInt(stats.ino.toString()) //.toString() because of BigInt

						obj.folders[item.path] = {
							name: item.basename,
							lastModified: parseInt(stats.mtimeMs.toString()), //.toString() because of BigInt
							ino: inoNum
						}

						obj.ino[inoNum] = {
							type: "folder",
							path: item.path
						}
					} else {
						if (stats.size > 0) {
							const inoNum = parseInt(stats.ino.toString()) //.toString() because of BigInt

							obj.files[item.path] = {
								name: item.basename,
								size: parseInt(stats.size.toString()), //.toString() because of BigInt
								lastModified: parseInt(stats.mtimeMs.toString()), //.toString() because of BigInt
								ino: inoNum
							}

							obj.ino[inoNum] = {
								type: "file",
								path: item.path
							}
						}
					}
				}
			}
		} catch (e: any) {
			const stats = await gracefulLStat(item.fullPath)
			if (
				!filenIgnoreCompiled.denies(stats.isDir ? item.path + '/' : item.path) &&
				!filenIgnoreCompiled.denies(stats.isDir ? item.fullPath + '/' : item.fullPath) &&
				!isIgnoredBySelectiveSync(selectiveSyncRemote, item.path) &&
				!isIgnoredBySelectiveSync(selectiveSyncRemote, item.fullPath)
			) {
				log.error(e)

				ipc.addSyncIssue({
					uuid: uuidv4(),
					type: "warning",
					where: "local",
					path: item.fullPath,
					err: e,
					info: "Could not read " + item.fullPath,
					timestamp: Date.now()
				}).catch(log.error)
			}
		}
	}

	const concurrencyLimit = 8192
	const processingPromises: Promise<void>[] = []
	let activePromises = 0

	for await (const item of readdirp(path, {
		alwaysStat: false,
		lstat: false,
		type: "all",
		depth: 2147483648,
		directoryFilter: ["!.filen.trash.local", "!System Volume Information"],
		fileFilter: ["!.filen.trash.local", "!System Volume Information"]
	})) {
		processingPromises.push(processEntry(item))
		activePromises++

		if (activePromises >= concurrencyLimit) {
			await chunkedPromiseAll(processingPromises)

			processingPromises.length = 0
			activePromises = 0
		}
	}

	await chunkedPromiseAll(processingPromises)
	await chunkedPromiseAll([db.set(cacheKey, obj), db.set("localDataChanged:" + location.uuid, false)])

	return {
		changed: true,
		data: obj
	}
}

export const readChunk = async (path: string, offset: number, length: number): Promise<Buffer> => {
	return await invokeProxy("fsReadChunk", {
		path,
		offset,
		length
	})
}

export const rm = async (path: string, location: Location): Promise<void> => {
	return await invokeProxy("fsRm", {
		path,
		location
	})
}

export const rmPermanent = async (path: string): Promise<void> => {
	return await invokeProxy("fsRmPermanent", path)
}

export const mkdir = async (path: string, location: any): Promise<any> => {
	return await invokeProxy("fsMkdir", {
		path,
		location
	})
}

export const utimes = async (path: string, atime: Date, mtime: Date): Promise<void> => {
	return await invokeProxy("fsUtimes", {
		path,
		atime,
		mtime
	})
}

export const unlink = async (path: string): Promise<void> => {
	return await invokeProxy("fsUnlink", path)
}

export const remove = async (path: string): Promise<void> => {
	return await invokeProxy("fsRemove", path)
}

export const download = (path: string, location: any, task: any): Promise<any> => {
	return new Promise(async (resolve, reject) => {
		await new Promise(resolve => {
			const getPausedStatus = () => {
				chunkedPromiseAll([db.get("paused"), isSyncLocationPaused(location.uuid)])
					.then(([paused, locationPaused]) => {
						if (paused || locationPaused) {
							return setTimeout(getPausedStatus, 1000)
						}

						return resolve(true)
					})
					.catch(err => {
						log.error(err)

						return setTimeout(getPausedStatus, 1000)
					})
			}

			return getPausedStatus()
		})

		try {
			var absolutePath = normalizePath(pathModule.join(location.local, path))
			var file = task.item
		} catch (e) {
			return reject(e)
		}

		getTempDir()
			.then(tmpDir => {
				try {
					var fileTmpPath = normalizePath(pathModule.join(tmpDir, uuidv4()))
				} catch (e) {
					return reject(e)
				}

				chunkedPromiseAll([rmPermanent(absolutePath), rmPermanent(fileTmpPath)])
					.then(async () => {
						const fileChunks = file.chunks
						let currentWriteIndex = 0

						const downloadTask = (index: number): Promise<{ index: number; data: Buffer }> => {
							return new Promise((resolve, reject) => {
								downloadChunk({
									region: file.region,
									bucket: file.bucket,
									uuid: file.uuid,
									index,
									from: "sync",
									location
								})
									.then(data => {
										decryptData(data, file.metadata.key, file.version)
											.then(decrypted => {
												return resolve({
													index,
													data: Buffer.from(decrypted)
												})
											})
											.catch(reject)
									})
									.catch(reject)
							})
						}

						const writeChunk = (index: number, data: Buffer) => {
							if (index !== currentWriteIndex) {
								return setTimeout(() => {
									writeChunk(index, data)
								}, 10)
							}

							appendFile(fileTmpPath, data)
								.then(() => {
									currentWriteIndex += 1
								})
								.catch(err => {
									downloadThreadsSemaphore.purge()

									reject(err)
								})
						}

						try {
							await new Promise<void>((resolve, reject) => {
								let done = 0

								for (let i = 0; i < fileChunks; i++) {
									downloadThreadsSemaphore.acquire().then(() => {
										downloadTask(i)
											.then(({ index, data }) => {
												writeChunk(index, data)

												done += 1

												downloadThreadsSemaphore.release()

												if (done >= fileChunks) {
													return resolve()
												}
											})
											.catch(err => {
												downloadThreadsSemaphore.release()

												return reject(err)
											})
									})
								}
							})

							await new Promise<void>(resolve => {
								if (currentWriteIndex >= fileChunks) {
									return resolve()
								}

								const wait = setInterval(() => {
									if (currentWriteIndex >= fileChunks) {
										clearInterval(wait)

										return resolve()
									}
								}, 10)
							})
						} catch (e) {
							unlink(fileTmpPath).catch(console.error)

							return reject(e)
						}

						const now = Date.now()
						const lastModified = convertTimestampToMs(
							typeof file.metadata.lastModified == "number" ? file.metadata.lastModified : now
						)
						const utimesLastModified =
							typeof lastModified == "number" && lastModified > 0 && now > lastModified ? lastModified : now - 60000

						move(fileTmpPath, absolutePath)
							.then(() => {
								utimes(absolutePath, new Date(utimesLastModified), new Date(utimesLastModified))
									.then(() => {
										checkLastModified(absolutePath)
											.then(() => {
												gracefulLStat(absolutePath)
													.then((stat: any) => {
														if (stat.size <= 0) {
															rmPermanent(absolutePath)

															return reject(new Error(absolutePath + " size = " + stat.size))
														}

														return resolve(stat)
													})
													.catch(reject)
											})
											.catch(reject)
									})
									.catch(reject)
							})
							.catch(reject)
					})
					.catch(reject)
			})
			.catch(reject)
	})
}

export const move = async (before: string, after: string, overwrite: boolean = true): Promise<void> => {
	return await invokeProxy("fsMove", {
		before,
		after,
		overwrite
	})
}

export const rename = async (before: string, after: string): Promise<void> => {
	return await invokeProxy("fsRename", {
		before,
		after
	})
}

export const createLocalTrashDirs = async (): Promise<void> => {
	const userId = await db.get("userId")

	if (!userId || !Number.isInteger(userId)) {
		return
	}

	const syncLocations = await db.get("syncLocations:" + userId)

	if (!syncLocations || !Array.isArray(syncLocations)) {
		return
	}

	await chunkedPromiseAll([
		...syncLocations.map(location => ensureDir(normalizePath(pathModule.join(location.local, ".filen.trash.local"))))
	])
}

export const clearLocalTrashDirs = (clearNow = false): Promise<void> => {
	return new Promise((resolve, reject) => {
		db.get("userId")
			.then(userId => {
				if (!userId || !Number.isInteger(userId)) {
					return
				}

				chunkedPromiseAll([db.get("syncLocations:" + userId), createLocalTrashDirs()])
					.then(([syncLocations, _]) => {
						if (!syncLocations || !Array.isArray(syncLocations)) {
							return
						}

						chunkedPromiseAll([
							...syncLocations.map(
								location =>
									new Promise<void>((resolve, reject) => {
										const path = normalizePath(pathModule.join(location.local, ".filen.trash.local"))

										const dirStream = readdirp(path, {
											alwaysStat: false,
											lstat: false,
											type: "all",
											depth: 1
										})

										let statting = 0
										const pathsToTrash: string[] = []
										const now = Date.now()
										let dirSize = 0

										dirStream.on("data", async (item: any) => {
											statting += 1

											if (clearNow) {
												pathsToTrash.push(item.fullPath)
											} else {
												try {
													item.stats = await gracefulLStat(item.fullPath)

													if (!item.stats.isLink) {
														if (item.stats.ctimeMs + constants.deleteFromLocalTrashAfter <= now) {
															pathsToTrash.push(item.fullPath)
														}

														dirSize += item.stats.size
													}
												} catch (e) {
													log.error(e)
												}
											}

											statting -= 1
										})

										dirStream.on("warn", (warn: any) => {
											log.error("[Local trash] Readdirp warning:", warn)
										})

										dirStream.on("error", (err: any) => {
											dirStream.destroy()

											statting = 0

											return reject(err)
										})

										dirStream.on("end", async () => {
											await new Promise<void>(resolve => {
												if (statting <= 0) {
													return resolve()
												}

												const wait = setInterval(() => {
													if (statting <= 0) {
														clearInterval(wait)

														return resolve()
													}
												}, 10)
											})

											statting = 0

											dirStream.destroy()

											await chunkedPromiseAll([
												db.set("localTrashDirSize:" + location.uuid, clearNow ? 0 : dirSize),
												...pathsToTrash.map(pathToTrash => rmPermanent(pathToTrash))
											]).catch(log.error)

											resolve()
										})
									})
							)
						]).then(() => resolve())
					})
					.catch(reject)
			})
			.catch(reject)
	})
}

export const initLocalTrashDirs = (): void => {
	clearLocalTrashDirs().catch(log.error)

	clearInterval(LOCAL_TRASH_DIRS_CLEAN_INTERVAL)

	LOCAL_TRASH_DIRS_CLEAN_INTERVAL = setInterval(() => {
		clearLocalTrashDirs().catch(log.error)
	}, constants.clearLocalTrashDirsInterval)
}

export const mkdirNormal = async (path: string, options = { recursive: true }): Promise<void> => {
	return await invokeProxy("fsMkdirNormal", {
		path,
		options
	})
}

export const access = async (path: string, mode: any): Promise<void> => {
	return await invokeProxy("fsAccess", {
		path,
		mode
	})
}

export const appendFile = async (path: string, data: Buffer | string, options: any = undefined): Promise<void> => {
	return await invokeProxy("fsAppendFile", {
		path,
		data,
		options
	})
}

export const ensureDir = async (path: string) => {
	return await invokeProxy("fsEnsureDir", path)
}

export const getApplyDoneTaskPath = async (locationUUID: string): Promise<string> => {
	if (typeof APPLY_DONE_TASKS_PATH[locationUUID] === "string" && APPLY_DONE_TASKS_PATH[locationUUID].length > 0) {
		return APPLY_DONE_TASKS_PATH[locationUUID]
	}

	const userDataPath = await ipc.getAppPath("userData")

	await fs.ensureDir(pathModule.join(userDataPath, "data", "v" + APPLY_DONE_TASKS_VERSION))

	const path = pathModule.join(userDataPath, "data", "v" + APPLY_DONE_TASKS_VERSION, "applyDoneTasks_" + locationUUID)

	APPLY_DONE_TASKS_PATH[locationUUID] = path

	return path
}

export const loadApplyDoneTasks = (locationUUID: string): Promise<any[]> => {
	return new Promise(async (resolve, reject) => {
		await applyDoneTasksSemaphore.acquire()

		try {
			var path = await getApplyDoneTaskPath(locationUUID)
		} catch (e: any) {
			applyDoneTasksSemaphore.release()

			if (e.code == "ENOENT") {
				return resolve([])
			}

			return reject(e)
		}

		try {
			await fs.access(path, fs.constants.F_OK)
		} catch (e) {
			applyDoneTasksSemaphore.release()

			return resolve([])
		}

		try {
			const reader = readline.createInterface({
				input: fs.createReadStream(path, {
					flags: "r"
				}),
				crlfDelay: Infinity
			})

			const tasks: any[] = []

			reader.on("line", (line: string) => {
				if (typeof line !== "string") {
					return
				}

				if (line.length < 4) {
					return
				}

				try {
					const parsed = JSON.parse(line)

					tasks.push(parsed)
				} catch (e) {
					log.error(e)
				}
			})

			reader.on("error", (err: Error) => {
				applyDoneTasksSemaphore.release()

				return reject(err)
			})

			reader.on("close", () => {
				applyDoneTasksSemaphore.release()

				return resolve(tasks)
			})
		} catch (e) {
			applyDoneTasksSemaphore.release()

			return reject(e)
		}
	})
}

export const addToApplyDoneTasks = async (locationUUID: string, task: any): Promise<void> => {
	await applyDoneTasksSemaphore.acquire()

	try {
		const path = await getApplyDoneTaskPath(locationUUID)

		await fs.appendFile(path, JSON.stringify(task) + "\n")
	} catch (e) {
		log.error(e)
	}

	applyDoneTasksSemaphore.release()
}

export const clearApplyDoneTasks = async (locationUUID: string): Promise<void> => {
	await applyDoneTasksSemaphore.acquire()

	try {
		var path = await getApplyDoneTaskPath(locationUUID)

		await fs.access(path, fs.constants.F_OK)
	} catch (e) {
		applyDoneTasksSemaphore.release()

		return
	}

	await fs.unlink(path).catch(log.error)

	applyDoneTasksSemaphore.release()
}
