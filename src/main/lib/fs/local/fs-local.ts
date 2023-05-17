import fs from "fs-extra"
import pathModule from "path"
import readdirp from "readdirp"
import log from "electron-log"
import is from "electron-is"
import { app } from "electron"
import constants from "../../../../constants.json"
import { Location } from "../../../../types"
import db from "../../db"
import {
	windowsPathToUnixStyle,
	pathIncludesDot,
	isFolderPathExcluded,
	pathValidation,
	pathIsFileOrFolderNameIgnoredByDefault,
	isSystemPathExcluded,
	isNameOverMaxLength,
	isPathOverMaxLength,
	Semaphore
} from "../../helpers"
import { addSyncIssue } from "../../ipc"
import { v4 as uuidv4 } from "uuid"
import readline from "readline"

const FS_RETRIES = 8
const FS_RETRY_TIMEOUT = 100
const FS_RETRY_CODES = [
	"EAGAIN",
	"EBUSY",
	"ECANCELED",
	"EBADF",
	"EINTR",
	"EIO",
	"EMFILE",
	"ENFILE",
	"ENOMEM",
	"EPIPE",
	"ETXTBSY",
	"ESPIPE",
	"EAI_SYSTEM",
	"EAI_CANCELED",
	"EUNKNOWN"
]
const FS_NORETRY_CODES = ["ENOENT", "ENODEV", "EACCES", "EPERM", "EINVAL", "ENAMETOOLONG", "ENOBUFS", "ENOSPC", "EROFS"]
let LOCAL_TRASH_DIRS_CLEAN_INTERVAL: NodeJS.Timer
const cache = new Map()
let APPLY_DONE_TASKS_PATH: Record<string, string> = {}
const APPLY_DONE_TASKS_VERSION: number = 1
const applyDoneTasksSemaphore = new Semaphore(1)

export const normalizePath = (path: string): string => {
	return pathModule.normalize(path)
}

export const realPath = async (path: string): Promise<string> => {
	try {
		return fs.realpath(path)
	} catch {
		return normalizePath(path)
	}
}

export const getTempDir = (): string => {
	const tmpDirRes = app.getPath("temp")
	const tmpDir = normalizePath(tmpDirRes)

	return tmpDir
}

export interface Stats extends fs.Stats {
	isLink: boolean
	isDir: boolean
	file: boolean
}

export const gracefulLStat = (path: string): Promise<Stats> => {
	return new Promise((resolve, reject) => {
		path = normalizePath(path)

		const cacheKey = "gracefulLStat:" + path
		let currentTries = 0
		let lastErr: Error

		const req = () => {
			if (currentTries > FS_RETRIES) {
				return reject(lastErr)
			}

			currentTries += 1

			fs.lstat(path)
				.then(stats => {
					stats = {
						...stats,
						isLink: stats.isSymbolicLink(),
						isDir: stats.isDirectory(),
						file: stats.isFile()
					} as Stats

					cache.set(cacheKey, stats)

					return resolve(stats as Stats)
				})
				.catch(err => {
					if (err.code == "EPERM" && cache.has(cacheKey)) {
						return resolve(cache.get(cacheKey))
					}

					lastErr = err

					if (FS_RETRY_CODES.includes(err.code)) {
						return setTimeout(req, FS_RETRY_TIMEOUT)
					}

					return reject(err)
				})
		}

		return req()
	})
}

export const exists = (fullPath: string): Promise<boolean> => {
	return new Promise(resolve => {
		const path = normalizePath(fullPath)

		fs.access(path, fs.constants.F_OK, err => {
			if (err) {
				resolve(false)

				return
			}

			resolve(true)
		})
	})
}

export const doesExistLocally = async (path: string): Promise<boolean> => {
	try {
		await exists(normalizePath(path))

		return true
	} catch {
		return false
	}
}

export const canReadWriteAtPath = (fullPath: string): Promise<boolean> => {
	return new Promise(resolve => {
		fullPath = normalizePath(fullPath)

		const req = (path: string) => {
			fs.access(path, fs.constants.W_OK | fs.constants.R_OK, err => {
				if (err) {
					if (err.code) {
						if (err.code == "EPERM") {
							log.error(err)

							return resolve(false)
						} else if (err.code == "ENOENT") {
							const newPath = pathModule.dirname(path)

							if (newPath.length > 0) {
								return setImmediate(() => req(newPath))
							}

							return resolve(false)
						}
					}

					log.error(err)

					return resolve(false)
				}

				return resolve(true)
			})
		}

		return req(fullPath)
	})
}

export const canReadAtPath = (fullPath: string): Promise<boolean> => {
	return new Promise(resolve => {
		fullPath = normalizePath(fullPath)

		const req = (path: string) => {
			fs.access(path, fs.constants.R_OK, err => {
				if (err) {
					if (err.code) {
						if (err.code == "EPERM") {
							log.error(err)

							return resolve(false)
						} else if (err.code == "ENOENT") {
							const newPath = pathModule.dirname(path)

							if (newPath.length > 0) {
								return setImmediate(() => req(newPath))
							}

							return resolve(false)
						}
					}

					log.error(err)

					return resolve(false)
				}

				return resolve(true)
			})
		}

		return req(fullPath)
	})
}

export const smokeTest = async (path: string): Promise<void> => {
	path = normalizePath(path)

	const tmpDir = getTempDir()

	if (!(await canReadWriteAtPath(path))) {
		throw new Error("Cannot read/write at path " + path)
	}

	if (!(await canReadWriteAtPath(tmpDir))) {
		throw new Error("Cannot read/write at path " + tmpDir)
	}

	await Promise.all([gracefulLStat(path), gracefulLStat(tmpDir)])
}

export const readChunk = (path: string, offset: number, length: number): Promise<Buffer> => {
	return new Promise((resolve, reject) => {
		path = normalizePath(path)

		let currentTries = 0
		let lastErr: Error

		const req = () => {
			if (currentTries > FS_RETRIES) {
				return reject(lastErr)
			}

			currentTries += 1

			fs.open(path, "r", (err, fd) => {
				if (err) {
					lastErr = err

					if (err.code && FS_RETRY_CODES.includes(err.code)) {
						return setTimeout(req, FS_RETRY_TIMEOUT)
					}

					return reject(err)
				}

				const buffer = Buffer.alloc(length)

				fs.read(fd, buffer, 0, length, offset, (err, read) => {
					if (err) {
						lastErr = err

						if (err.code && FS_RETRY_CODES.includes(err.code)) {
							return setTimeout(req, FS_RETRY_TIMEOUT)
						}

						return reject(err)
					}

					let data: Buffer

					if (read < length) {
						data = buffer.slice(0, read)
					} else {
						data = buffer
					}

					fs.close(fd, err => {
						if (err) {
							lastErr = err

							if (err.code && FS_RETRY_CODES.includes(err.code)) {
								return setTimeout(req, FS_RETRY_TIMEOUT)
							}

							return reject(err)
						}

						return resolve(data)
					})
				})
			})
		}

		return req()
	})
}

export const rm = async (path: string, location: Location): Promise<void> => {
	path = normalizePath(path)

	const trashDirPath = normalizePath(pathModule.join(location.local, ".filen.trash.local"))
	const basename = pathModule.basename(path)

	if (!(await doesExistLocally(path))) {
		cache.delete("gracefulLStat:" + path)

		return
	}

	await fs.ensureDir(trashDirPath)

	try {
		await move(path, normalizePath(pathModule.join(trashDirPath, basename)))
	} catch (e: any) {
		if (e.code && e.code == "ENOENT") {
			cache.delete("gracefulLStat:" + path)

			return
		}

		throw e
	}

	cache.delete("gracefulLStat:" + path)
}

export const rmPermanent = (path: string): Promise<void> => {
	return new Promise(async (resolve, reject) => {
		path = normalizePath(path)

		if (!(await doesExistLocally(path))) {
			cache.delete("gracefulLStat:" + normalizePath(path))

			return resolve()
		}

		try {
			var stats = await gracefulLStat(path)
		} catch (e: any) {
			if (e.code && e.code == "ENOENT") {
				cache.delete("gracefulLStat:" + normalizePath(path))

				return resolve()
			}

			return reject(e)
		}

		let currentTries = 0
		let lastErr: Error

		const req = async () => {
			if (currentTries > FS_RETRIES) {
				return reject(lastErr)
			}

			currentTries += 1

			if (stats.isLink) {
				try {
					await fs.unlink(path)

					cache.delete("gracefulLStat:" + normalizePath(path))
				} catch (e: any) {
					lastErr = e

					if (e.code && e.code == "ENOENT") {
						cache.delete("gracefulLStat:" + normalizePath(path))

						return resolve()
					}

					if (e.code && FS_RETRY_CODES.includes(e.code)) {
						return setTimeout(req, FS_RETRY_TIMEOUT)
					}

					return reject(e)
				}
			} else {
				try {
					await fs.remove(path)

					cache.delete("gracefulLStat:" + normalizePath(path))
				} catch (e: any) {
					lastErr = e

					if (e.code && e.code == "ENOENT") {
						cache.delete("gracefulLStat:" + normalizePath(path))

						return resolve()
					}

					if (e.code && FS_RETRY_CODES.includes(e.code)) {
						return setTimeout(req, FS_RETRY_TIMEOUT)
					}

					return reject(e)
				}
			}

			return resolve()
		}

		return req()
	})
}

export const mkdir = (path: string, location: Location): Promise<void> => {
	return new Promise((resolve, reject) => {
		const absolutePath = normalizePath(pathModule.join(location.local, path))
		let currentTries = 0
		let lastErr: Error

		const req = () => {
			if (currentTries > FS_RETRIES) {
				return reject(lastErr)
			}

			currentTries += 1

			fs.ensureDir(absolutePath)
				.then(() => {
					gracefulLStat(absolutePath)
						.then(() => resolve())
						.catch(err => {
							lastErr = err

							if (err.code && FS_RETRY_CODES.includes(err.code)) {
								return setTimeout(req, FS_RETRY_TIMEOUT)
							}

							return reject(err)
						})
				})
				.catch(err => {
					lastErr = err

					if (err.code && FS_RETRY_CODES.includes(err.code)) {
						return setTimeout(req, FS_RETRY_TIMEOUT)
					}

					return reject(err)
				})
		}

		return req()
	})
}

export const move = (before: string, after: string, overwrite = true): Promise<void> => {
	return new Promise(async (resolve, reject) => {
		try {
			before = normalizePath(before)
			after = normalizePath(after)
		} catch (e) {
			return reject(e)
		}

		if (!(await doesExistLocally(before))) {
			return resolve()
		}

		let currentTries = 0
		let lastErr: Error

		const req = () => {
			if (currentTries > FS_RETRIES) {
				return reject(lastErr)
			}

			currentTries += 1

			fs.move(before, after, {
				overwrite
			})
				.then(() => resolve())
				.catch(err => {
					lastErr = err

					if (err.code && FS_RETRY_CODES.includes(err.code)) {
						return setTimeout(req, FS_RETRY_TIMEOUT)
					}

					return reject(err)
				})
		}

		return req()
	})
}

export const rename = (before: string, after: string): Promise<void> => {
	return new Promise(async (resolve, reject) => {
		try {
			before = normalizePath(before)
			after = normalizePath(after)
		} catch (e) {
			return reject(e)
		}

		if (!(await doesExistLocally(before))) {
			return resolve()
		}

		let currentTries = 0
		let lastErr: Error

		const req = () => {
			if (currentTries > FS_RETRIES) {
				return reject(lastErr)
			}

			currentTries += 1

			fs.rename(before, after)
				.then(() => resolve())
				.catch(err => {
					lastErr = err

					if (err.code && FS_RETRY_CODES.includes(err.code)) {
						return setTimeout(req, FS_RETRY_TIMEOUT)
					}

					return reject(err)
				})
		}

		return req()
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

	await Promise.all([
		...syncLocations.map(location => fs.ensureDir(normalizePath(pathModule.join(location.local, ".filen.trash.local"))))
	])
}

export const clearLocalTrashDirs = (clearNow = false): Promise<void> => {
	return new Promise((resolve, reject) => {
		db.get("userId")
			.then(userId => {
				if (!userId || !Number.isInteger(userId)) {
					return
				}

				Promise.all([db.get("syncLocations:" + userId), createLocalTrashDirs()])
					.then(([syncLocations, _]) => {
						if (!syncLocations || !Array.isArray(syncLocations)) {
							return
						}

						Promise.allSettled([
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

										dirStream.on("data", async item => {
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

										dirStream.on("warn", warn => {
											log.error("[Local trash] Readdirp warning:", warn)
										})

										dirStream.on("error", err => {
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

											await Promise.allSettled([
												db.set("localTrashDirSize:" + location.uuid, clearNow ? 0 : dirSize),
												...pathsToTrash.map(pathToTrash => rmPermanent(pathToTrash))
											])

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

export const checkLastModified = (path: string): Promise<{ changed: boolean; mtimeMs: number }> => {
	return new Promise((resolve, reject) => {
		path = normalizePath(path)

		gracefulLStat(path)
			.then(async stat => {
				if (stat.mtimeMs > 0) {
					return resolve({
						changed: false,
						mtimeMs: 0
					})
				}

				const lastModified = new Date(Date.now() - 60000)
				const mtimeMs = lastModified.getTime()

				let currentTries = 0
				let lastErr: Error

				const req = () => {
					if (currentTries > FS_RETRIES) {
						return reject(lastErr)
					}

					currentTries += 1

					fs.utimes(path, lastModified, lastModified)
						.then(() => {
							return resolve({
								changed: true,
								mtimeMs
							})
						})
						.catch(err => {
							lastErr = err

							if (err.code && FS_RETRY_CODES.includes(err.code)) {
								return setTimeout(req, FS_RETRY_TIMEOUT)
							}

							return reject(err)
						})
				}

				return req()
			})
			.catch(reject)
	})
}

export const directoryTree = (path: string, skipCache = false, location: Location): Promise<{ changed: boolean; data: any }> => {
	return new Promise((resolve, reject) => {
		const cacheKey = "directoryTreeLocal:" + location.uuid

		Promise.all([db.get("localDataChanged:" + location.uuid), db.get(cacheKey), db.get("excludeDot")])
			.then(async ([localDataChanged, cachedLocalTree, excludeDot]) => {
				if (excludeDot == null) {
					excludeDot = true
				}

				if (!localDataChanged && cachedLocalTree !== null && !skipCache) {
					return resolve({
						changed: false,
						data: cachedLocalTree
					})
				}

				path = normalizePath(path)

				const files: Record<
					string,
					{
						name: string
						size: number
						lastModified: number
						ino: number
					}
				> = {}
				const folders: Record<
					string,
					{
						name: string
						size: number
						lastModified: number
						ino: number
					}
				> = {}
				const ino: Record<number, { type: "folder" | "file"; path: string }> = {}
				const windows = is.windows()
				let statting = 0

				const dirStream = readdirp(path, {
					alwaysStat: false,
					lstat: false,
					type: "all",
					depth: 2147483648,
					directoryFilter: ["!.filen.trash.local", "!System Volume Information"],
					fileFilter: ["!.filen.trash.local", "!System Volume Information"]
				})

				dirStream.on("data", async item => {
					statting += 1

					try {
						if (windows) {
							item.path = windowsPathToUnixStyle(item.path)
						}

						let include = true

						if (excludeDot && (item.basename.startsWith(".") || pathIncludesDot(item.path))) {
							include = false
						}

						if (
							include &&
							!isFolderPathExcluded(item.path) &&
							pathValidation(item.path) &&
							!pathIsFileOrFolderNameIgnoredByDefault(item.path) &&
							!isSystemPathExcluded("//" + item.fullPath) &&
							!isNameOverMaxLength(item.basename) &&
							!isPathOverMaxLength(location.local + "/" + item.path)
						) {
							item.stats = await gracefulLStat(item.fullPath)

							if (!item.stats.isLink) {
								if (item.stats.isDir) {
									const inoNum = parseInt(item.stats.ino.toString()) //.toString() because of BigInt
									const entry = {
										name: item.basename,
										size: 0,
										lastModified: parseInt(item.stats.mtimeMs.toString()), //.toString() because of BigInt
										ino: inoNum
									}

									folders[item.path] = entry
									ino[inoNum] = {
										type: "folder",
										path: item.path
									}
								} else {
									if (item.stats.size > 0) {
										const inoNum = parseInt(item.stats.ino.toString()) //.toString() because of BigInt
										const entry = {
											name: item.basename,
											size: parseInt(item.stats.size.toString()), //.toString() because of BigInt
											lastModified: parseInt(item.stats.mtimeMs.toString()), //.toString() because of BigInt
											ino: inoNum
										}

										files[item.path] = entry
										ino[inoNum] = {
											type: "file",
											path: item.path
										}
									}
								}
							}
						}
					} catch (e: any) {
						log.error(e)

						addSyncIssue({
							uuid: uuidv4(),
							type: "warning",
							where: "local",
							path: item.fullPath,
							err: e,
							info: "Could not read " + item.fullPath,
							timestamp: Date.now()
						})
					}

					statting -= 1
				})

				dirStream.on("warn", warn => {
					log.error("Readdirp warning:", warn)
				})

				dirStream.on("error", err => {
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

					const obj = {
						files,
						folders,
						ino
					}

					try {
						await Promise.all([db.set(cacheKey, obj), db.set("localDataChanged:" + location.uuid, false)])
					} catch (e) {
						return reject(e)
					}

					return resolve({
						changed: true,
						data: obj
					})
				})
			})
			.catch(reject)
	})
}

export const utimes = async (path: string, atime: Date, mtime: Date): Promise<void> => {
	path = normalizePath(path)

	return await fs.utimes(path, atime, mtime)
}

export const unlink = async (path: string): Promise<void> => {
	path = normalizePath(path)

	return await fs.unlink(path)
}

export const remove = async (path: string): Promise<void> => {
	path = normalizePath(path)

	return await fs.remove(path)
}

export const mkdirNormal = async (path: string, options = { recursive: true }): Promise<void> => {
	path = normalizePath(path)

	return await fs.mkdir(path, options)
}

export const access = (path: string, mode: number): Promise<void> => {
	return new Promise((resolve, reject) => {
		path = normalizePath(path)

		fs.access(path, mode, err => {
			if (err) {
				return reject(err)
			}

			return resolve()
		})
	})
}

export const appendFile = async (path: string, data: Buffer | string, options = undefined): Promise<void> => {
	path = normalizePath(path)

	return await fs.appendFile(path, data, options)
}

export const ensureDir = async (path: string): Promise<void> => {
	path = normalizePath(path)

	return await fs.ensureDir(path)
}

export const getApplyDoneTaskPath = async (locationUUID: string): Promise<string> => {
	if (typeof APPLY_DONE_TASKS_PATH[locationUUID] == "string" && APPLY_DONE_TASKS_PATH[locationUUID].length > 0) {
		return APPLY_DONE_TASKS_PATH[locationUUID]
	}

	const userDataPath: string = app.getPath("userData")

	await fs.ensureDir(pathModule.join(userDataPath, "data", "v" + APPLY_DONE_TASKS_VERSION))

	const path: string = pathModule.join(userDataPath, "data", "v" + APPLY_DONE_TASKS_VERSION, "applyDoneTasks_" + locationUUID)

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

			reader.on("error", (err: any) => {
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

		await appendFile(path, JSON.stringify(task) + "\n")
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
