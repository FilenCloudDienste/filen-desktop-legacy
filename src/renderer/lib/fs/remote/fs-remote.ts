import {
	folderPresent,
	dirTree,
	createFolder,
	folderExists,
	uploadChunk,
	markUploadAsDone,
	checkIfItemParentIsShared,
	trashItem,
	moveFile,
	moveFolder,
	renameFile,
	renameFolder,
	filePresent
} from "../../api"
import db from "../../db"
import { decryptFolderName, decryptFileMetadata, hashFn, encryptMetadata, encryptData } from "../../crypto"
import {
	convertTimestampToMs,
	pathIsFileOrFolderNameIgnoredByDefault,
	generateRandomString,
	Semaphore,
	isFolderPathExcluded,
	pathValidation,
	isPathOverMaxLength,
	isNameOverMaxLength,
	pathIncludesDot,
	chunkedPromiseAll
} from "../../helpers"
import { normalizePath, canReadAtPath, readChunk, checkLastModified, gracefulLStat, exists } from "../local"
import constants from "../../../../constants.json"
import { v4 as uuidv4 } from "uuid"
import { sendToAllPorts } from "../../worker/ipc"
import { remoteStorageLeft } from "../../user/info"
import { isSyncLocationPaused } from "../../worker/sync/sync.utils"
import memoryCache from "../../memoryCache"
import { RemoteItem, RemoteUUIDs, RemoteDirectoryTreeResult, Location } from "../../../../types"
import { Stats } from "fs-extra"
import ipc from "../../ipc"

const pathModule = window.require("path")
const log = window.require("electron-log")
const mimeTypes = window.require("mime-types")

const findOrCreateParentDirectorySemaphore = new Semaphore(1)
const createDirectorySemaphore = new Semaphore(1)
const uploadThreadsSemaphore = new Semaphore(constants.maxUploadThreads)
const folderPathUUID = new Map<string, string>()
const trashSemaphore = new Semaphore(1)

const UPLOAD_VERSION: number = 2
const previousDatasets: Record<string, string> = {}

export const smokeTest = async (uuid: string): Promise<boolean> => {
	const response = await folderPresent(uuid)

	if (!response.present || response.trash) {
		return false
	}

	return true
}

export const directoryTree = (uuid: string, skipCache: boolean = false, location: Location): Promise<RemoteDirectoryTreeResult> => {
	return new Promise((resolve, reject) => {
		chunkedPromiseAll([db.get("deviceId"), db.get("masterKeys"), db.get("excludeDot")])
			.then(([deviceId, masterKeys, excludeDot]) => {
				if (excludeDot == null) {
					excludeDot = true
				}

				if (!Array.isArray(masterKeys)) {
					return reject(new Error("Master keys not array"))
				}

				if (masterKeys.length == 0) {
					return reject(new Error("Invalid master keys, length = 0"))
				}

				dirTree({ uuid, deviceId, skipCache, includeRaw: true })
					.then(async res => {
						const cacheKey = "directoryTree:" + uuid + ":" + deviceId
						const response = res.data
						const raw = res.raw

						if (response.folders.length === 0 && response.files.length === 0) {
							// Data did not change
							try {
								var dbCache = await db.get(cacheKey)

								if (dbCache) {
									return resolve({
										changed: false,
										data: dbCache
									})
								}
							} catch (e) {
								log.error(e)
							}

							return directoryTree(uuid, true, location).then(resolve).catch(reject)
						}

						const rawEx = raw.split('"randomBytes"')

						if (rawEx.length == 2) {
							if (previousDatasets[location.uuid] && previousDatasets[location.uuid] === rawEx[0]) {
								try {
									var dbCache = await db.get(cacheKey)

									if (dbCache) {
										return resolve({
											changed: false,
											data: dbCache
										})
									}
								} catch (e) {
									log.error(e)
								}
							}
						}

						folderPathUUID.clear()

						if (typeof location !== "undefined") {
							sendToAllPorts({
								type: "syncStatus",
								data: {
									type: "dataChanged",
									data: {
										locationUUID: location.uuid
									}
								}
							})
						}

						const [baseFolderUUID, baseFolderMetadata, baseFolderParent]: [string, string, string] = response.folders[0]
						const baseFolderName = await decryptFolderName(baseFolderMetadata, masterKeys)

						if (baseFolderParent !== "base") {
							return reject(new Error("Invalid base folder parent"))
						}

						if (baseFolderName.length <= 0) {
							return reject(new Error("Could not decrypt base folder name"))
						}

						const addedFolders: Record<string, boolean> = {}
						const addedFiles: Record<string, boolean> = {}
						const builtTreeFiles: Record<string, RemoteItem> = {}
						const builtTreeFolders: Record<string, RemoteItem> = {}
						const builtTreeUUIDs: Record<string, RemoteUUIDs> = {}
						const uuidsToPaths: Record<string, string> = {}

						const promises = [
							...response.folders.map((folder: string[]) => {
								const [uuid, metadata, parent] = folder

								return new Promise(resolve => {
									decryptFolderName(metadata, masterKeys)
										.then(name => {
											new Promise<string>(resolve => {
												const parentExists = (): any => {
													if (parent == "base") {
														return resolve("")
													} else {
														if (uuidsToPaths[parent]) {
															return resolve(uuidsToPaths[parent])
														}

														return setImmediate(parentExists)
													}
												}

												return parentExists()
											})
												.then(parentPath => {
													const foundParentPath = parentPath.length == 0 ? "" : parentPath + "/"
													const thisPath = foundParentPath + name

													if (parent !== "base" && thisPath.indexOf("/") == -1) {
														return resolve(true)
													}

													const entryPath = thisPath.split("/").slice(1).join("/")

													uuidsToPaths[uuid] = thisPath

													let include = true

													if (
														typeof name !== "string" ||
														name.length <= 0 ||
														isNameOverMaxLength(name) ||
														(excludeDot && pathIncludesDot(entryPath)) ||
														!pathValidation(entryPath) ||
														pathIsFileOrFolderNameIgnoredByDefault(entryPath) ||
														isFolderPathExcluded(entryPath) ||
														isPathOverMaxLength(location.local + "/" + entryPath)
													) {
														include = false
													}

													if (include && parent !== "base" && !addedFolders[parent + ":" + name]) {
														addedFolders[parent + ":" + name] = true

														builtTreeFolders[entryPath] = {
															uuid,
															name,
															parent,
															type: "folder",
															path: entryPath,
															region: "",
															bucket: "",
															chunks: 0,
															metadata: {
																name,
																size: 0,
																key: "",
																mime: "",
																lastModified: 0
															},
															version: 0
														}

														builtTreeUUIDs[uuid] = {
															type: "folder",
															path: entryPath
														}
													}

													return resolve(true)
												})
												.catch(resolve)
										})
										.catch(resolve)
								})
							}),
							...response.files.map((file: string[]) => {
								const [uuid, bucket, region, chunks, parent, metadata, version, timestamp] = file

								return new Promise(resolve => {
									decryptFileMetadata(metadata, masterKeys)
										.then(decrypted => {
											if (typeof decrypted.lastModified == "number") {
												if (decrypted.lastModified <= 0) {
													decrypted.lastModified = timestamp as any as number
												}
											} else {
												decrypted.lastModified = timestamp as any as number
											}

											decrypted.lastModified = convertTimestampToMs(decrypted.lastModified)

											new Promise<string>(resolve => {
												const parentExists = (): any => {
													if (parent == "base") {
														return resolve("")
													} else {
														if (uuidsToPaths[parent]) {
															return resolve(uuidsToPaths[parent])
														}

														return setImmediate(parentExists)
													}
												}

												return parentExists()
											})
												.then(parentPath => {
													const foundParentPath = parentPath.length == 0 ? "" : parentPath + "/"
													const thisPath = parent == "base" ? decrypted.name : foundParentPath + decrypted.name

													if (parent !== "base" && thisPath.indexOf("/") == -1) {
														return resolve(true)
													}

													const entryPath = thisPath.split("/").slice(1).join("/")

													let include = true

													if (
														typeof decrypted.name !== "string" ||
														decrypted.name.length <= 0 ||
														isNameOverMaxLength(decrypted.name) ||
														(excludeDot && pathIncludesDot(entryPath)) ||
														!pathValidation(entryPath) ||
														pathIsFileOrFolderNameIgnoredByDefault(entryPath) ||
														isFolderPathExcluded(entryPath) ||
														isPathOverMaxLength(location.local + "/" + entryPath)
													) {
														include = false
													}

													if (include && parent !== "base" && !addedFiles[parent + ":" + decrypted.name]) {
														addedFiles[parent + ":" + decrypted.name] = true

														builtTreeFiles[entryPath] = {
															uuid,
															region,
															bucket,
															chunks: chunks as any as number,
															parent,
															metadata: decrypted,
															version: version as any as number,
															type: "file",
															path: entryPath,
															name: decrypted.name
														}

														builtTreeUUIDs[uuid] = {
															type: "file",
															path: entryPath
														}

														ipc.setFileKey(uuid, decrypted.key).catch(log.error)
													}

													return resolve(true)
												})
												.catch(resolve)
										})
										.catch(resolve)
								})
							})
						]

						try {
							await chunkedPromiseAll(promises)
						} catch (e) {
							log.error(e)

							return reject(e)
						}

						const obj = {
							files: builtTreeFiles,
							folders: builtTreeFolders,
							uuids: builtTreeUUIDs
						}

						if (rawEx.length == 2) {
							previousDatasets[location.uuid] = rawEx[0]
						}

						try {
							await db.set(cacheKey, obj)
						} catch (e) {
							return reject(e)
						}

						return resolve({
							changed: true,
							data: obj
						})
					})
					.catch(reject)
			})
			.catch(reject)
	})
}

export const createDirectory = async (uuid: string, name: string, parent: string): Promise<string> => {
	await createDirectorySemaphore.acquire()

	try {
		const { exists, existsUUID } = await folderExists({ name, parent })

		if (exists) {
			createDirectorySemaphore.release()

			return existsUUID
		}

		const parentExists = await smokeTest(parent)

		if (!parentExists) {
			createDirectorySemaphore.release()

			throw "parentMissing"
		}

		await createFolder({ uuid, name, parent })

		createDirectorySemaphore.release()

		return uuid
	} catch (e) {
		createDirectorySemaphore.release()

		throw e
	}
}

export const doesExistLocally = async (path: string): Promise<boolean> => {
	try {
		await exists(pathModule.normalize(path))

		return true
	} catch {
		return false
	}
}

export const findOrCreateParentDirectory = (
	path: string,
	baseFolderUUID: string,
	remoteTreeNow: any,
	absolutePathLocal?: string
): Promise<string> => {
	return new Promise(async (resolve, reject) => {
		const neededPathEx = path.split("/")
		const neededParentPath = neededPathEx.slice(0, -1).join("/")

		if (folderPathUUID.has(neededParentPath)) {
			return resolve(folderPathUUID.get(neededParentPath) as string)
		}

		await findOrCreateParentDirectorySemaphore.acquire()

		if (absolutePathLocal) {
			if (!(await doesExistLocally(absolutePathLocal))) {
				findOrCreateParentDirectorySemaphore.release()

				return reject("deletedLocally")
			}
		}

		if (path.indexOf("/") == -1) {
			findOrCreateParentDirectorySemaphore.release()

			return resolve(baseFolderUUID)
		}

		const existingFolders = remoteTreeNow.folders
		const currentPathArray = []

		let found = false
		let foundParentUUID = baseFolderUUID

		while (!found) {
			for (let i = 0; i < neededPathEx.length; i++) {
				currentPathArray.push(neededPathEx[i])

				const currentPath: any = currentPathArray.join("/")
				const currentParentPath: string = currentPathArray.slice(0, -1).join("/")

				if (typeof existingFolders[currentPath] == "undefined" && currentPath !== path) {
					try {
						const createParentUUID =
							currentParentPath.length > 0 &&
							typeof existingFolders[currentParentPath] == "object" &&
							typeof existingFolders[currentParentPath].uuid == "string"
								? existingFolders[currentParentPath].uuid
								: baseFolderUUID
						const createName = currentPath.split("/").pop()
						let createUUID = uuidv4()

						createUUID = await createDirectory(createUUID, createName, createParentUUID)

						existingFolders[currentPath] = {
							uuid: createUUID,
							parent: createParentUUID,
							path: currentPath,
							name: createName,
							type: "folder"
						}

						folderPathUUID.set(currentPath, createUUID)
					} catch (e) {
						findOrCreateParentDirectorySemaphore.release()

						return reject(e)
					}
				}
			}

			if (typeof existingFolders[neededParentPath] == "object" && typeof existingFolders[neededParentPath].uuid == "string") {
				found = true
				foundParentUUID = existingFolders[neededParentPath].uuid

				folderPathUUID.set(neededParentPath, existingFolders[neededParentPath].uuid)
			}
		}

		findOrCreateParentDirectorySemaphore.release()

		if (absolutePathLocal) {
			if (!(await doesExistLocally(absolutePathLocal))) {
				return reject("deletedLocally")
			}
		}

		return resolve(foundParentUUID)
	})
}

export const mkdir = async (path: string, remoteTreeNow: any, location: any, uuid: string): Promise<{ parent: string; uuid: string }> => {
	const name = pathModule.basename(path)

	if (typeof uuid !== "string") {
		uuid = uuidv4()
	}

	if (typeof name !== "string" || name.length <= 0) {
		throw new Error("Could not create remote folder: Name invalid: " + name)
	}

	if (!(await doesExistLocally(normalizePath(location.local + "/" + path)))) {
		throw "deletedLocally"
	}

	const parent = await findOrCreateParentDirectory(path, location.remoteUUID, remoteTreeNow, normalizePath(location.local + "/" + path))
	const createdUUID = await createDirectory(uuid, name, parent)

	return {
		parent,
		uuid: createdUUID
	}
}

export const upload = (path: string, remoteTreeNow: any, location: Location, task: any, uuid: string): Promise<any> => {
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

		const absolutePath = normalizePath(pathModule.join(location.local, path))
		const name = pathModule.basename(absolutePath)
		const nameHashed = hashFn(name.toLowerCase())

		if (typeof name !== "string" || name.length <= 0) {
			return reject(new Error("Could not upload file: Name invalid: " + name))
		}

		if (typeof location.remoteUUID !== "string") {
			return reject("parentMissing")
		}

		if (typeof uuid !== "string") {
			uuid = uuidv4()
		}

		if (!(await doesExistLocally(absolutePath))) {
			return reject("deletedLocally")
		}

		chunkedPromiseAll([db.get("masterKeys"), remoteStorageLeft()])
			.then(([masterKeys, remoteStorageFree]) => {
				canReadAtPath(absolutePath)
					.then(canRead => {
						if (!canRead) {
							return reject(new Error("Cannot read file, permission denied: " + absolutePath))
						}

						checkLastModified(absolutePath)
							.then(checkLastModifiedRes => {
								const size = parseInt(task.item.size.toString())

								if (size > remoteStorageFree) {
									return reject("Not enough remote storage left to upload " + absolutePath)
								}

								findOrCreateParentDirectory(path, location.remoteUUID!, remoteTreeNow, absolutePath)
									.then(async parent => {
										const lastModified = checkLastModifiedRes.changed
											? Math.floor(checkLastModifiedRes.mtimeMs as number)
											: Math.floor(task.item.lastModified)
										const mime = mimeTypes.lookup(name) || ""
										let dummyOffset = 0
										let fileChunks = 0

										while (dummyOffset < size) {
											fileChunks += 1
											dummyOffset += constants.chunkSize
										}

										try {
											var key = generateRandomString(32)
											var rm = generateRandomString(32)
											var uploadKey = generateRandomString(32)
											var [nameEnc, mimeEnc, sizeEnc, metaData, origStats]: [string, string, string, string, Stats] =
												await Promise.all([
													encryptMetadata(name, key),
													encryptMetadata(mime, key),
													encryptMetadata(size.toString(), key),
													encryptMetadata(
														JSON.stringify(
															{
																name,
																size,
																mime,
																key,
																lastModified
															},
															(_, value) => (typeof value == "bigint" ? parseInt(value.toString()) : value)
														),
														masterKeys[masterKeys.length - 1]
													),
													gracefulLStat(absolutePath)
												])
										} catch (e) {
											log.error("Metadata generation failed for " + absolutePath)
											log.error(e)

											return reject(e)
										}

										const uploadTask = (index: number) => {
											return new Promise(async (resolve, reject) => {
												if (!(await doesExistLocally(absolutePath))) {
													return reject("deletedLocally")
												}

												try {
													const stats: Stats = await gracefulLStat(absolutePath)

													if (
														origStats.birthtimeMs !== stats.birthtimeMs ||
														origStats.size !== stats.size ||
														origStats.ino !== stats.ino ||
														origStats.mtimeMs !== stats.mtimeMs
													) {
														return reject("deletedLocally")
													}
												} catch (e: any) {
													if (e.code && e.code == "ENOENT") {
														return reject("deletedLocally")
													}
												}

												readChunk(absolutePath, index * constants.chunkSize, constants.chunkSize)
													.then(data => {
														const queryParams = new URLSearchParams({
															uuid,
															index,
															parent,
															uploadKey
														} as any).toString()

														if (data.byteLength === 0) {
															reject(new Error("Buffer byteLength 0"))

															return
														}

														encryptData(data, key)
															.then(encrypted => {
																uploadChunk({
																	queryParams,
																	data: encrypted,
																	from: "sync",
																	location
																})
																	.then(response => {
																		if (!response.status) {
																			reject(new Error(response.message))

																			return
																		}

																		resolve(response.data)
																	})
																	.catch(reject)
															})
															.catch(reject)
													})
													.catch(reject)
											})
										}

										let region: string = ""
										let bucket: string = ""

										try {
											await new Promise((resolve, reject) => {
												let done = 0

												for (let i = 0; i < fileChunks; i++) {
													uploadThreadsSemaphore.acquire().then(() => {
														uploadTask(i)
															.then((data: any) => {
																region = data.region
																bucket = data.bucket

																done += 1

																uploadThreadsSemaphore.release()

																if (done >= fileChunks) {
																	return resolve(true)
																}
															})
															.catch(err => {
																uploadThreadsSemaphore.release()

																return reject(err)
															})
													})
												}
											})

											const stats: Stats = await gracefulLStat(absolutePath)

											if (
												origStats.birthtimeMs !== stats.birthtimeMs ||
												origStats.size !== stats.size ||
												origStats.ino !== stats.ino ||
												origStats.mtimeMs !== stats.mtimeMs
											) {
												return reject("deletedLocally")
											}

											const [parentSmokeTest, syncLocationSmokeTest] = await Promise.all([
												smokeTest(parent),
												smokeTest(location.remoteUUID!)
											])

											if (!parentSmokeTest || !syncLocationSmokeTest) {
												return reject("parentMissing")
											}

											const doneRes = await markUploadAsDone({
												uuid,
												name: nameEnc,
												nameHashed,
												size: sizeEnc,
												chunks: fileChunks,
												mime: mimeEnc,
												rm,
												metadata: metaData,
												version: UPLOAD_VERSION,
												uploadKey
											})

											fileChunks = doneRes.chunks
										} catch (e: any) {
											if (!(await doesExistLocally(absolutePath))) {
												return reject("deletedLocally")
											}

											if (typeof e.code !== "undefined") {
												if (e.code == "EPERM") {
													return reject("eperm")
												}

												if (e.code == "ENOENT") {
													return reject("deletedLocally")
												}
											}

											if (e.toString().toLowerCase().indexOf("already exists") !== -1) {
												return resolve(true)
											}

											return reject(e)
										}

										try {
											await checkIfItemParentIsShared({
												type: "file",
												parent,
												metaData: {
													uuid,
													name,
													size,
													mime,
													key,
													lastModified
												}
											})
										} catch (e) {
											log.error(e)
										}

										memoryCache.set("decryptFileMetadata:" + metaData, {
											name,
											size,
											mime,
											key,
											lastModified
										})

										ipc.setFileKey(uuid, key).catch(log.error)

										return resolve({
											uuid,
											bucket,
											region,
											chunks: fileChunks,
											parent,
											version: UPLOAD_VERSION,
											metadata: {
												key,
												name,
												size,
												mime,
												lastModified
											}
										})
									})
									.catch(async err => {
										if (!(await doesExistLocally(absolutePath))) {
											return reject("deletedLocally")
										}

										return reject(err)
									})
							})
							.catch(async err => {
								if (!(await doesExistLocally(absolutePath))) {
									return reject("deletedLocally")
								}

								return reject(err)
							})
					})
					.catch(async err => {
						if (!(await doesExistLocally(absolutePath))) {
							return reject("deletedLocally")
						}

						return reject(err)
					})
			})
			.catch(reject)
	})
}

export const rm = async (type: string, uuid: string): Promise<void> => {
	await trashSemaphore.acquire()

	try {
		await trashItem({ type, uuid })

		trashSemaphore.release()
	} catch (e) {
		trashSemaphore.release()

		throw e
	}
}

export const move = async (type: string, task: any, location: any, remoteTreeNow: any): Promise<void> => {
	if (type === "file") {
		const present = await filePresent(task.item.uuid)

		if (!present.present || present.versioned || present.trash) {
			return
		}
	} else {
		const present = await folderPresent(task.item.uuid)

		if (!present.present || present.trash) {
			return
		}
	}

	const parent = await findOrCreateParentDirectory(task.to, location.remoteUUID, remoteTreeNow)
	const name = pathModule.basename(task.to)

	if (type == "file") {
		await moveFile({
			file: {
				uuid: task.item.uuid,
				name,
				size: task.item.metadata.size,
				mime: task.item.metadata.mime,
				key: task.item.metadata.key,
				lastModified: task.item.metadata.lastModified
			},
			parent
		})
	} else {
		await moveFolder({
			folder: {
				uuid: task.item.uuid,
				name
			},
			parent
		})
	}
}

export const rename = async (type: string, task: any): Promise<void> => {
	if (type === "file") {
		const present = await filePresent(task.item.uuid)

		if (!present.present || present.versioned || present.trash) {
			return
		}
	} else {
		const present = await folderPresent(task.item.uuid)

		if (!present.present || present.trash) {
			return
		}
	}

	const newName = pathModule.basename(task.to)

	if (newName.length == 0) {
		throw new Error("Invalid name")
	}

	if (type == "file") {
		await renameFile({
			file: {
				uuid: task.item.uuid,
				name: newName,
				size: task.item.metadata.size,
				mime: task.item.metadata.mime,
				key: task.item.metadata.key,
				lastModified: task.item.metadata.lastModified
			},
			name: newName
		})
	} else {
		await renameFolder({
			folder: {
				uuid: task.item.uuid,
				name: newName
			},
			name: newName
		})
	}
}
