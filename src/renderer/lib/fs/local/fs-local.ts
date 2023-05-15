import ipc from "../../ipc"
import memoryCache from "../../memoryCache"
import { convertTimestampToMs, Semaphore } from "../../helpers"
import { downloadChunk } from "../../api"
import { decryptData } from "../../crypto"
import { v4 as uuidv4 } from "uuid"
import db from "../../db"
import constants from "../../../../constants.json"
import { isSyncLocationPaused } from "../../worker/sync/sync.utils"
import { Stats } from "fs-extra"
import { LocalDirectoryTreeResult, Location } from "../../../../types"
import { invokeProxy } from "../../ipc/ipc"

const pathModule = window.require("path")
const log = window.require("electron-log")

const downloadThreadsSemaphore = new Semaphore(constants.maxDownloadThreads)

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

export const directoryTree = async (path: string, skipCache: boolean = false, location: Location): Promise<LocalDirectoryTreeResult> => {
	return await invokeProxy("fsDirectoryTree", {
		path,
		skipCache,
		location
	})
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
				Promise.all([db.get("paused"), isSyncLocationPaused(location.uuid)])
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

				Promise.all([rmPermanent(absolutePath), rmPermanent(fileTmpPath)])
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
	return await invokeProxy("fsCreateLocalTrashDirs")
}

export const clearLocalTrashDirs = async (clearNow: boolean = false): Promise<void> => {
	return await invokeProxy("fsClearLocalTrashDirs", clearNow)
}

export const initLocalTrashDirs = () => {
	invokeProxy("fsInitLocalTrashDirs").catch(console.error)
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
