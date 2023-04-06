import constants from "../../../constants.json"
import { getRandomArbitrary, Semaphore, nodeBufferToArrayBuffer, generateRandomString } from "../helpers"
import {
	hashFn,
	encryptMetadata,
	encryptMetadataPublicKey,
	decryptFolderLinkKey,
	decryptFileMetadata,
	decryptFolderName,
	bufferToHash
} from "../crypto"
import db from "../db"
import { sendToAllPorts } from "../worker/ipc"
import { logout } from "../../windows/settings/account"
import striptags from "striptags"
import { isSyncLocationPaused } from "../worker/sync/sync.utils"
import { v4 as uuidv4 } from "uuid"

const https = window.require("https")
const log = window.require("electron-log")
const { ThrottleGroup } = window.require("speed-limiter")
const { Readable } = window.require("stream")
const progress = window.require("progress-stream")

export const createFolderSemaphore = new Semaphore(1)
export const throttleGroupUpload = new ThrottleGroup({
	rate: 1024 * 1024 * 1024
})
export const throttleGroupDownload = new ThrottleGroup({
	rate: 1024 * 1024 * 1024
})

const httpsAPIAgent = new https.Agent({
	keepAlive: true,
	maxSockets: constants.maxConcurrentAPIRequest,
	timeout: 3600000
})

const httpsUploadAgent = new https.Agent({
	keepAlive: true,
	maxSockets: constants.maxConcurrentUploads,
	timeout: 3600000
})

const httpsDownloadAgent = new https.Agent({
	keepAlive: true,
	maxSockets: constants.maxConcurrentDownloads,
	timeout: 3600000
})

export const getAPIServer = () => {
	return constants.apiServers[getRandomArbitrary(0, constants.apiServers.length - 1)]
}

export const getUploadServer = () => {
	return constants.uploadServers[getRandomArbitrary(0, constants.uploadServers.length - 1)]
}

export const getDownloadServer = () => {
	return constants.downloadServers[getRandomArbitrary(0, constants.downloadServers.length - 1)]
}

export const apiRequest = ({ method = "POST", endpoint = "/v1/", data = {}, timeout = 500000, includeRaw = false }): Promise<any> => {
	return new Promise((resolve, reject) => {
		let currentTries = 0

		const doRequest = (): any => {
			if (!window.navigator.onLine) {
				return setTimeout(doRequest, constants.retryAPIRequestTimeout)
			}

			if (currentTries >= constants.maxRetryAPIRequest) {
				return reject(
					new Error(
						"Maximum retries (" +
							constants.maxRetryAPIRequest +
							") reached for API request: " +
							JSON.stringify({
								method,
								endpoint,
								data,
								timeout
							})
					)
				)
			}

			currentTries += 1

			const req = https.request(
				{
					method: method.toUpperCase(),
					hostname: "api.filen.io",
					path: endpoint,
					port: 443,
					timeout: 86400000,
					agent: httpsAPIAgent,
					headers: {
						"Content-Type": "application/json",
						"User-Agent": "filen-desktop"
					}
				},
				(response: any) => {
					if (response.statusCode !== 200) {
						log.error(
							new Error(
								"API response " +
									response.statusCode +
									", method: " +
									method.toUpperCase() +
									", endpoint: " +
									endpoint +
									", data: " +
									JSON.stringify(data)
							)
						)

						return setTimeout(doRequest, constants.retryAPIRequestTimeout)
					}

					const res: Buffer[] = []

					response.on("data", (chunk: Buffer) => {
						res.push(chunk)
					})

					response.on("end", () => {
						try {
							const str = Buffer.concat(res).toString()
							const obj = JSON.parse(str)

							if (typeof obj.message == "string") {
								if (obj.message.toLowerCase().indexOf("invalid api key") !== -1) {
									logout().catch(log.error)

									return reject(new Error(obj.message))
								}

								if (obj.message.toLowerCase().indexOf("api key not found") !== -1) {
									logout().catch(log.error)

									return reject(new Error(obj.message))
								}
							}

							if (includeRaw) {
								return resolve({
									data: obj,
									raw: str
								})
							}

							return resolve(obj)
						} catch (e) {
							log.error(e)

							return reject(e)
						}
					})
				}
			)

			req.on("error", (err: any) => {
				log.error(err)

				return setTimeout(doRequest, constants.retryAPIRequestTimeout)
			})

			req.on("timeout", () => {
				log.error("API request timed out")

				req.destroy()

				return setTimeout(doRequest, constants.retryAPIRequestTimeout)
			})

			req.write(JSON.stringify(data))

			req.end()
		}

		return doRequest()
	})
}

export const authInfo = async ({ email }: { email: string }): Promise<any> => {
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/auth/info",
		data: {
			email
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return response.data
}

export const login = async ({
	email,
	password,
	twoFactorCode,
	authVersion
}: {
	email: string
	password: string
	twoFactorCode: string | number
	authVersion: number
}): Promise<any> => {
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/login",
		data: {
			email,
			password,
			twoFactorKey: twoFactorCode,
			authVersion
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return response.data
}

export const userInfo = async (passedApiKey?: string): Promise<any> => {
	const apiKey = passedApiKey ? passedApiKey : await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/user/info",
		data: {
			apiKey
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return response.data
}

export const baseFolders = async (): Promise<any> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/user/baseFolders",
		data: {
			apiKey,
			includeDefault: "true"
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return response.data
}

export const folderContent = async (uuid: string): Promise<any> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/dir/content",
		data: {
			apiKey,
			app: "true",
			folders: JSON.stringify(["default"]),
			page: 1,
			uuid
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return response.data
}

export const folderPresent = async (uuid: string): Promise<any> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/dir/present",
		data: {
			apiKey,
			uuid
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return response.data
}

export const filePresent = async (uuid: string): Promise<any> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/file/present",
		data: {
			apiKey,
			uuid
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return response.data
}

export const dirTree = async ({
	uuid,
	deviceId,
	skipCache = false,
	includeRaw = false
}: {
	uuid: string
	deviceId: string
	skipCache?: boolean
	includeRaw?: boolean
}): Promise<{ data: any; raw: string }> => {
	const apiKey: string = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/dir/tree",
		data: {
			apiKey,
			uuid,
			deviceId,
			skipCache: skipCache ? 1 : 0
		},
		includeRaw
	})

	if (includeRaw) {
		if (!response.data.status) {
			throw new Error(response.data.message)
		}

		return { data: response.data.data, raw: response.raw }
	}

	if (!response.status) {
		throw new Error(response.message)
	}

	return response.data
}

export const createFolder = async ({ uuid, name, parent }: { uuid: string; name: string; parent: string }): Promise<string> => {
	await createFolderSemaphore.acquire()

	try {
		const nameHashed = hashFn(name.toLowerCase())
		const [apiKey, masterKeys] = await Promise.all([db.get("apiKey"), db.get("masterKeys")])
		const encrypted = await encryptMetadata(JSON.stringify({ name }), masterKeys[masterKeys.length - 1])
		const response = await apiRequest({
			method: "POST",
			endpoint: "/v1/dir/sub/create",
			data: {
				apiKey,
				uuid,
				name: encrypted,
				nameHashed,
				parent
			}
		})

		if (!response.status) {
			if (typeof response.data !== "undefined" && typeof response.data.existsUUID !== "undefined") {
				createFolderSemaphore.release()

				return response.data.existsUUID
			}

			throw new Error(response.message)
		}

		await checkIfItemParentIsShared({
			type: "folder",
			parent,
			metaData: {
				uuid,
				name
			}
		})

		createFolderSemaphore.release()

		return uuid
	} catch (e) {
		createFolderSemaphore.release()

		throw e
	}
}

export const fileExists = async ({ name, parent }: { name: string; parent: string }): Promise<{ exists: boolean; existsUUID: string }> => {
	const nameHashed = hashFn(name.toLowerCase())
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/file/exists",
		data: {
			apiKey,
			parent,
			nameHashed
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return {
		exists: response.data.exists ? true : false,
		existsUUID: response.data.uuid
	}
}

export const folderExists = async ({
	name,
	parent
}: {
	name: string
	parent: string
}): Promise<{ exists: boolean; existsUUID: string }> => {
	const nameHashed = hashFn(name.toLowerCase())
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/dir/exists",
		data: {
			apiKey,
			parent,
			nameHashed
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return {
		exists: response.data.exists ? true : false,
		existsUUID: response.data.uuid
	}
}

export const archiveFile = async ({ existsUUID, updateUUID }: { existsUUID: string; updateUUID: string }): Promise<any> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/file/archive",
		data: {
			apiKey,
			uuid: existsUUID,
			updateUUID
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return response.data
}

export const isSharingFolder = async ({ uuid }: { uuid: string }): Promise<any> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/share/dir/status",
		data: {
			apiKey,
			uuid
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return {
		sharing: response.data.sharing ? true : false,
		users: response.data.users
	}
}

export const isPublicLinkingFolder = async ({ uuid }: { uuid: string }): Promise<any> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/link/dir/status",
		data: {
			apiKey,
			uuid
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return {
		linking: response.data.link ? true : false,
		links: response.data.links
	}
}

export const addItemToPublicLink = async ({ data }: { data: any }): Promise<void> => {
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/dir/link/add",
		data
	})

	if (!response.status) {
		throw new Error(response.message)
	}
}

export const shareItem = async ({ data }: { data: any }): Promise<void> => {
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/share",
		data
	})

	if (!response.status) {
		throw new Error(response.message)
	}
}

export const isSharingItem = async ({ uuid }: { uuid: string }): Promise<any> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/user/shared/item/status",
		data: {
			apiKey,
			uuid
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return {
		sharing: response.data.sharing ? true : false,
		users: response.data.users
	}
}

export const isItemInPublicLink = async ({ uuid }: { uuid: string }): Promise<any> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/link/dir/item/status",
		data: {
			apiKey,
			uuid
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return {
		linking: response.data.link ? true : false,
		links: response.data.links
	}
}

export const renameItemInPublicLink = async ({ data }: { data: any }): Promise<void> => {
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/link/dir/item/rename",
		data
	})

	if (!response.status) {
		throw new Error(response.message)
	}
}

export const renameSharedItem = async ({ data }: { data: any }): Promise<void> => {
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/user/shared/item/rename",
		data
	})

	if (!response.status) {
		throw new Error(response.message)
	}
}

export const getFolderContents = async ({ uuid }: { uuid: string }): Promise<any> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/download/dir",
		data: {
			apiKey,
			uuid
		}
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return response.data
}

export const checkIfItemParentIsShared = ({ type, parent, metaData }: { type: string; parent: string; metaData: any }): Promise<any> => {
	return new Promise((resolve, reject) => {
		db.get("apiKey")
			.then(apiKey => {
				db.get("masterKeys")
					.then(masterKeys => {
						let shareCheckDone = false
						let linkCheckDone = false
						let resolved = false
						let doneInterval: any = undefined

						const done = () => {
							if (shareCheckDone && linkCheckDone) {
								clearInterval(doneInterval)

								if (!resolved) {
									resolved = true

									resolve(true)
								}

								return true
							}

							return false
						}

						doneInterval = setInterval(done, 100)

						isSharingFolder({ uuid: parent })
							.then((data: any) => {
								if (!data.sharing) {
									shareCheckDone = true

									return done()
								}

								const totalUsers = data.users.length

								if (type == "file") {
									let doneUsers = 0

									const doneSharing = () => {
										doneUsers += 1

										if (doneUsers >= totalUsers) {
											shareCheckDone = true

											done()
										}

										return true
									}

									for (let i = 0; i < totalUsers; i++) {
										const user = data.users[i]
										const itemMetadata = JSON.stringify({
											name: metaData.name,
											size: metaData.size,
											mime: metaData.mime,
											key: metaData.key,
											lastModified: metaData.lastModified
										})

										encryptMetadataPublicKey({
											data: itemMetadata,
											publicKey: user.publicKey
										})
											.then(encrypted => {
												shareItem({
													data: {
														apiKey,
														uuid: metaData.uuid,
														parent,
														email: user.email,
														type,
														metadata: encrypted
													}
												})
													.then(() => {
														return doneSharing()
													})
													.catch(err => {
														console.log(err)

														return doneSharing()
													})
											})
											.catch(err => {
												console.log(err)

												return doneSharing()
											})
									}
								} else {
									getFolderContents({ uuid: metaData.uuid })
										.then(async (contents: any) => {
											const itemsToShare = []

											itemsToShare.push({
												uuid: metaData.uuid,
												parent,
												metadata: metaData.name,
												type: "folder"
											})

											const files = contents.files
											const folders = contents.folders

											for (let i = 0; i < files.length; i++) {
												const decrypted = await decryptFileMetadata(files[i].metadata, masterKeys)

												if (typeof decrypted == "object") {
													if (typeof decrypted.name == "string") {
														decrypted.name = striptags(decrypted.name)

														if (decrypted.name.length > 0) {
															itemsToShare.push({
																uuid: files[i].uuid,
																parent: files[i].parent,
																metadata: {
																	name: decrypted.name,
																	size: decrypted.size,
																	mime: striptags(decrypted.mime),
																	key: decrypted.key,
																	lastModified: decrypted.lastModified
																},
																type: "file"
															})
														}
													}
												}
											}

											for (let i = 0; i < folders.length; i++) {
												try {
													var decrypted: any = striptags(await decryptFolderName(folders[i].name, masterKeys))
												} catch (e) {
													//console.log(e)
												}

												if (typeof decrypted == "string") {
													if (decrypted.length > 0) {
														if (folders[i].uuid !== metaData.uuid && folders[i].parent !== "base") {
															itemsToShare.push({
																uuid: folders[i].uuid,
																parent: i == 0 ? "none" : folders[i].parent,
																metadata: decrypted,
																type: "folder"
															})
														}
													}
												}
											}

											let itemsShared = 0

											const doneSharingItem = () => {
												itemsShared += 1

												if (itemsShared >= itemsToShare.length * totalUsers) {
													shareCheckDone = true

													done()
												}

												return true
											}

											for (let i = 0; i < itemsToShare.length; i++) {
												const itemToShare = itemsToShare[i]

												for (let x = 0; x < totalUsers; x++) {
													const user = data.users[x]
													let itemMetadata = ""

													if (itemToShare.type == "file") {
														itemMetadata = JSON.stringify({
															name: itemToShare.metadata.name,
															size: itemToShare.metadata.size,
															mime: itemToShare.metadata.mime,
															key: itemToShare.metadata.key,
															lastModified: itemToShare.metadata.lastModified
														})
													} else {
														itemMetadata = JSON.stringify({
															name: itemToShare.metadata
														})
													}

													encryptMetadataPublicKey({
														data: itemMetadata,
														publicKey: user.publicKey
													})
														.then(encrypted => {
															shareItem({
																data: {
																	apiKey,
																	uuid: itemToShare.uuid,
																	parent: itemToShare.parent,
																	email: user.email,
																	type: itemToShare.type,
																	metadata: encrypted
																}
															})
																.then(() => {
																	return doneSharingItem()
																})
																.catch(err => {
																	console.log(err)

																	return doneSharingItem()
																})
														})
														.catch(err => {
															console.log(err)

															return doneSharingItem()
														})
												}
											}
										})
										.catch(err => {
											console.log(err)

											shareCheckDone = true

											return done()
										})
								}
							})
							.catch(err => {
								console.log(err)

								shareCheckDone = true

								return done()
							})

						isPublicLinkingFolder({ uuid: parent })
							.then(async (data: any) => {
								if (!data.linking) {
									linkCheckDone = true

									return done()
								}

								const totalLinks = data.links.length

								if (type == "file") {
									let linksDone = 0

									const doneLinking = () => {
										linksDone += 1

										if (linksDone >= totalLinks) {
											linkCheckDone = true

											done()
										}

										return true
									}

									for (let i = 0; i < totalLinks; i++) {
										const link = data.links[i]

										try {
											var key: any = await decryptFolderLinkKey(link.linkKey, masterKeys)
										} catch (e) {
											//console.log(e)
										}

										if (typeof key == "string") {
											if (key.length > 0) {
												try {
													var encrypted: any = await encryptMetadata(
														JSON.stringify({
															name: metaData.name,
															size: metaData.size,
															mime: metaData.mime,
															key: metaData.key,
															lastModified: metaData.lastModified
														}),
														key
													)
												} catch (e) {
													//console.log(e)
												}

												if (typeof encrypted == "string") {
													if (encrypted.length > 0) {
														addItemToPublicLink({
															data: {
																apiKey,
																uuid: metaData.uuid,
																parent,
																linkUUID: link.linkUUID,
																type,
																metadata: encrypted,
																key: link.linkKey,
																expiration: "never",
																password: "empty",
																passwordHashed: "8f83dfba6522ce8c34c5afefa64878e3a4ac554d",
																downloadBtn: "enable"
															}
														})
															.then(() => {
																return doneLinking()
															})
															.catch(err => {
																console.log(err)

																return doneLinking()
															})
													} else {
														doneLinking()
													}
												} else {
													doneLinking()
												}
											} else {
												doneLinking()
											}
										} else {
											doneLinking()
										}
									}
								} else {
									getFolderContents({ uuid: metaData.uuid })
										.then(async (contents: any) => {
											const itemsToLink = []

											itemsToLink.push({
												uuid: metaData.uuid,
												parent,
												metadata: metaData.name,
												type: "folder"
											})

											const files = contents.files
											const folders = contents.folders

											for (let i = 0; i < files.length; i++) {
												const decrypted = await decryptFileMetadata(files[i].metadata, masterKeys)

												if (typeof decrypted == "object") {
													if (typeof decrypted.name == "string") {
														decrypted.name = striptags(decrypted.name)

														if (decrypted.name.length > 0) {
															itemsToLink.push({
																uuid: files[i].uuid,
																parent: files[i].parent,
																metadata: {
																	name: decrypted.name,
																	size: decrypted.size,
																	mime: striptags(decrypted.mime),
																	key: decrypted.key,
																	lastModified: decrypted.lastModified
																},
																type: "file"
															})
														}
													}
												}
											}

											for (let i = 0; i < folders.length; i++) {
												try {
													var decrypted: any = striptags(await decryptFolderName(folders[i].name, masterKeys))
												} catch (e) {
													//console.log(e)
												}

												if (typeof decrypted == "string") {
													if (decrypted.length > 0) {
														if (folders[i].uuid !== metaData.uuid && folders[i].parent !== "base") {
															itemsToLink.push({
																uuid: folders[i].uuid,
																parent: i == 0 ? "none" : folders[i].parent,
																metadata: decrypted,
																type: "folder"
															})
														}
													}
												}
											}

											let itemsLinked = 0

											const itemLinked = () => {
												itemsLinked += 1

												if (itemsLinked >= itemsToLink.length * totalLinks) {
													linkCheckDone = true

													done()
												}

												return true
											}

											for (let i = 0; i < itemsToLink.length; i++) {
												const itemToLink = itemsToLink[i]

												for (let x = 0; x < totalLinks; x++) {
													const link = data.links[x]
													const key = await decryptFolderLinkKey(link.linkKey, masterKeys)

													if (typeof key == "string") {
														if (key.length > 0) {
															let itemMetadata = ""

															if (itemToLink.type == "file") {
																itemMetadata = JSON.stringify({
																	name: itemToLink.metadata.name,
																	size: itemToLink.metadata.size,
																	mime: itemToLink.metadata.mime,
																	key: itemToLink.metadata.key,
																	lastModified: itemToLink.metadata.lastModified
																})
															} else {
																itemMetadata = JSON.stringify({
																	name: itemToLink.metadata
																})
															}

															try {
																var encrypted: any = await encryptMetadata(itemMetadata, key)
															} catch (e) {
																//console.log(e)
															}

															if (typeof encrypted == "string") {
																if (encrypted.length > 0) {
																	addItemToPublicLink({
																		data: {
																			apiKey,
																			uuid: itemToLink.uuid,
																			parent: itemToLink.parent,
																			linkUUID: link.linkUUID,
																			type: itemToLink.type,
																			metadata: encrypted,
																			key: link.linkKey,
																			expiration: "never",
																			password: "empty",
																			passwordHashed: "8f83dfba6522ce8c34c5afefa64878e3a4ac554d", //hashFn("empty")
																			downloadBtn: "enable"
																		}
																	})
																		.then(() => {
																			return itemLinked()
																		})
																		.catch(err => {
																			console.log(err)

																			return itemLinked()
																		})
																} else {
																	itemLinked()
																}
															} else {
																itemLinked()
															}
														} else {
															itemLinked()
														}
													} else {
														itemLinked()
													}
												}
											}
										})
										.catch(err => {
											console.log(err)

											linkCheckDone = true

											return done()
										})
								}
							})
							.catch(err => {
								console.log(err)

								linkCheckDone = true

								return done()
							})
					})
					.catch(reject)
			})
			.catch(reject)
	})
}

export const checkIfItemIsSharedForRename = ({ type, uuid, metaData }: { type: string; uuid: string; metaData: any }): Promise<any> => {
	return new Promise((resolve, reject) => {
		db.get("apiKey")
			.then(apiKey => {
				db.get("masterKeys")
					.then(masterKeys => {
						let shareCheckDone = false
						let linkCheckDone = false
						let resolved = false
						let doneInterval: any = undefined

						const done = () => {
							if (shareCheckDone && linkCheckDone) {
								clearInterval(doneInterval)

								if (!resolved) {
									resolved = true

									resolve(true)
								}

								return true
							}

							return false
						}

						doneInterval = setInterval(done, 100)

						isSharingItem({ uuid })
							.then((data: any) => {
								if (!data.sharing) {
									shareCheckDone = true

									return done()
								}

								const totalUsers = data.users.length
								let doneUsers = 0

								const doneSharing = () => {
									doneUsers += 1

									if (doneUsers >= totalUsers) {
										shareCheckDone = true

										done()
									}

									return true
								}

								for (let i = 0; i < totalUsers; i++) {
									const user = data.users[i]
									let itemMetadata = ""

									if (type == "file") {
										itemMetadata = JSON.stringify({
											name: metaData.name,
											size: metaData.size,
											mime: metaData.mime,
											key: metaData.key,
											lastModified: metaData.lastModified
										})
									} else {
										itemMetadata = JSON.stringify({
											name: metaData.name
										})
									}

									encryptMetadataPublicKey({
										data: itemMetadata,
										publicKey: user.publicKey
									})
										.then(encrypted => {
											renameSharedItem({
												data: {
													apiKey,
													uuid,
													receiverId: user.id,
													metadata: encrypted
												}
											})
												.then(() => {
													return doneSharing()
												})
												.catch(err => {
													console.log(err)

													return doneSharing()
												})
										})
										.catch(err => {
											console.log(err)

											return doneSharing()
										})
								}
							})
							.catch(err => {
								console.log(err)

								shareCheckDone = true

								return done()
							})

						isItemInPublicLink({ uuid })
							.then((data: any) => {
								if (!data.linking) {
									linkCheckDone = true

									return done()
								}

								const totalLinks = data.links.length
								let linksDone = 0

								const doneLinking = () => {
									linksDone += 1

									if (linksDone >= totalLinks) {
										linkCheckDone = true

										done()
									}

									return true
								}

								for (let i = 0; i < totalLinks; i++) {
									const link = data.links[i]

									decryptFolderLinkKey(link.linkKey, masterKeys)
										.then(key => {
											let itemMetadata = ""

											if (type == "file") {
												itemMetadata = JSON.stringify({
													name: metaData.name,
													size: metaData.size,
													mime: metaData.mime,
													key: metaData.key,
													lastModified: metaData.lastModified
												})
											} else {
												itemMetadata = JSON.stringify({
													name: metaData.name
												})
											}

											encryptMetadata(itemMetadata, key)
												.then(encrypted => {
													renameItemInPublicLink({
														data: {
															apiKey,
															uuid,
															linkUUID: link.linkUUID,
															metadata: encrypted
														}
													})
														.then(() => {
															return doneLinking()
														})
														.catch(err => {
															console.log(err)

															return doneLinking()
														})
												})
												.catch(err => {
													console.log(err)

													return doneLinking()
												})
										})
										.catch(err => {
											console.log(err)

											return doneLinking()
										})
								}
							})
							.catch(err => {
								console.log(err)

								linkCheckDone = true

								return done()
							})
					})
					.catch(reject)
			})
			.catch(reject)
	})
}

export const uploadChunk = ({
	queryParams,
	data,
	timeout = 86400000,
	from = "sync",
	location = undefined
}: {
	queryParams: any
	data: any
	timeout: number
	from: string
	location?: any
}): Promise<any> => {
	return new Promise((resolve, reject) => {
		Promise.all([
			db.get("networkingSettings"),
			db.get("maxStorageReached"),
			bufferToHash(data.byteLength > 0 ? data : new Uint8Array([1]), "SHA-512")
		])
			.then(async ([networkingSettings, maxStorageReached, chunkHash]) => {
				if (maxStorageReached) {
					return reject(new Error("Max storage reached"))
				}

				await new Promise(resolve => {
					const getPausedStatus = () => {
						if (from == "sync") {
							if (typeof location !== "undefined" && typeof location.uuid == "string") {
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
							} else {
								db.get("paused")
									.then(paused => {
										if (paused) {
											return setTimeout(getPausedStatus, 1000)
										}

										return resolve(true)
									})
									.catch(err => {
										log.error(err)

										return setTimeout(getPausedStatus, 1000)
									})
							}
						} else {
							db.get(
								from.indexOf("download") !== -1
									? "downloadPaused"
									: from.indexOf("upload") !== -1
									? "uploadPaused"
									: "paused"
							)
								.then(paused => {
									if (paused) {
										return setTimeout(getPausedStatus, 1000)
									}

									return resolve(true)
								})
								.catch(err => {
									log.error(err)

									return setTimeout(getPausedStatus, 1000)
								})
						}
					}

					return getPausedStatus()
				})

				if (data.byteLength > 0) {
					queryParams = queryParams + "&hash=" + encodeURIComponent(chunkHash)
				}

				const urlParams = new URLSearchParams(queryParams)
				const uuid = urlParams.get("uuid") || ""

				let bps = 122070 * 1024

				if (networkingSettings !== null && typeof networkingSettings == "object" && from == "sync") {
					if (typeof networkingSettings.uploadKbps !== "undefined" && networkingSettings.uploadKbps > 0) {
						bps = Math.floor(networkingSettings.uploadKbps * 1024)
					}
				}

				throttleGroupUpload.setRate(bps)

				let currentTries = 0

				const doRequest = async (): Promise<any> => {
					if (!window.navigator.onLine) {
						return setTimeout(doRequest, constants.retryUploadTimeout)
					}

					if (currentTries >= constants.maxRetryUpload) {
						return reject(new Error("Max retries reached for upload " + uuid))
					}

					currentTries += 1

					let lastBytes = 0
					const throttle = throttleGroupUpload.throttle()

					const calcProgress = (written: number) => {
						let bytes = written

						if (lastBytes == 0) {
							lastBytes = written
						} else {
							bytes = Math.floor(written - lastBytes)
							lastBytes = written
						}

						sendToAllPorts({
							type: from == "sync" ? "uploadProgress" : "uploadProgressSeperate",
							data: {
								uuid,
								bytes,
								from
							}
						})
					}

					const req = https.request(
						{
							method: "POST",
							hostname: "up.filen.io",
							path: "/v2/upload?" + queryParams,
							port: 443,
							timeout: 86400000,
							agent: httpsUploadAgent,
							headers: {
								"User-Agent": "filen-desktop"
							}
						},
						(response: any) => {
							if (response.statusCode !== 200) {
								log.error(new Error("Upload failed, status code: " + response.statusCode))

								throttle.destroy()

								return setTimeout(doRequest, constants.retryUploadTimeout)
							}

							const res: Buffer[] = []

							response.on("data", (chunk: Buffer) => {
								res.push(chunk)
							})

							response.on("end", () => {
								try {
									const obj = JSON.parse(Buffer.concat(res).toString())

									if (!obj.status) {
										if (obj.message.toLowerCase().indexOf("storage") !== -1) {
											db.set("paused", true)
											db.set("maxStorageReached", true)
										}

										throttle.destroy()

										return reject(obj.message)
									}

									return resolve(obj)
								} catch (e) {
									return reject(e)
								}
							})
						}
					)

					req.on("error", (err: any) => {
						log.error(err)

						throttle.destroy()

						return reject(err)
					})

					req.on("timeout", () => {
						log.error("Upload request timed out")

						throttle.destroy()
						req.destroy()

						return reject(new Error("Upload request timed out"))
					})

					const str = progress({
						length: data.byteLength,
						time: 100
					})

					str.on("progress", (info: any) => calcProgress(info.transferred))

					Readable.from([data])
						.pipe(str.on("end", () => str.destroy()))
						.pipe(throttle.on("end", () => throttle.destroy()))
						.pipe(req)
				}

				return doRequest()
			})
			.catch(reject)
	})
}

export const markUploadAsDone = ({ uuid, uploadKey }: { uuid: string; uploadKey: string }): Promise<any> => {
	return new Promise((resolve, reject) => {
		const max = 32
		let current = 0
		const timeout = 1000

		const req = () => {
			if (current > max) {
				return reject(new Error("Could not mark upload " + uuid + " as done, max tries reached"))
			}

			current += 1

			apiRequest({
				method: "POST",
				endpoint: "/v1/upload/done",
				data: {
					uuid,
					uploadKey
				}
			})
				.then(response => {
					if (!response.status) {
						if (
							response.message.toString().toLowerCase().indexOf("chunks are not matching") !== -1 ||
							response.message.toString().toLowerCase().indexOf("done yet") !== -1 ||
							response.message.toString().toLowerCase().indexOf("finished yet") !== -1 ||
							response.message.toString().toLowerCase().indexOf("chunks not found") !== -1
						) {
							return setTimeout(req, timeout)
						}

						return reject(response.message)
					}

					return resolve(response.data)
				})
				.catch(reject)
		}

		req()
	})
}

export const downloadChunk = ({
	region,
	bucket,
	uuid,
	index,
	from = "sync",
	location = undefined
}: {
	region: string
	bucket: string
	uuid: string
	index: number
	from: string
	location?: any
}): Promise<any> => {
	return new Promise((resolve, reject) => {
		db.get("networkingSettings")
			.then(async networkingSettings => {
				await new Promise(resolve => {
					const getPausedStatus = () => {
						if (from == "sync") {
							if (typeof location !== "undefined" && typeof location.uuid == "string") {
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
							} else {
								db.get("paused")
									.then(paused => {
										if (paused) {
											return setTimeout(getPausedStatus, 1000)
										}

										return resolve(true)
									})
									.catch(err => {
										log.error(err)

										return setTimeout(getPausedStatus, 1000)
									})
							}
						} else {
							db.get(
								from.indexOf("download") !== -1
									? "downloadPaused"
									: from.indexOf("upload") !== -1
									? "uploadPaused"
									: "paused"
							)
								.then(paused => {
									if (paused) {
										return setTimeout(getPausedStatus, 1000)
									}

									return resolve(true)
								})
								.catch(err => {
									log.error(err)

									return setTimeout(getPausedStatus, 1000)
								})
						}
					}

					return getPausedStatus()
				})

				let bps = 122070 * 1024

				if (networkingSettings !== null && typeof networkingSettings == "object" && from == "sync") {
					if (typeof networkingSettings.downloadKbps !== "undefined" && networkingSettings.downloadKbps > 0) {
						bps = Math.floor(networkingSettings.downloadKbps * 1024)
					}
				}

				throttleGroupDownload.setRate(bps)

				let currentTries = 0

				const doRequest = async (): Promise<any> => {
					if (!window.navigator.onLine) {
						return setTimeout(doRequest, constants.retryDownloadTimeout)
					}

					if (currentTries >= constants.maxRetryDownload) {
						return reject(new Error("Max retries reached for /" + region + "/" + bucket + "/" + uuid + "/" + index))
					}

					const throttle = throttleGroupDownload.throttle()

					currentTries += 1

					const request = https.request({
						host: "down.filen.io",
						port: 443,
						path: "/" + region + "/" + bucket + "/" + uuid + "/" + index,
						method: "GET",
						agent: httpsDownloadAgent,
						timeout: 86400000,
						headers: {
							"User-Agent": "filen-desktop"
						}
					})

					request.on("response", (response: any) => {
						if (response.statusCode !== 200) {
							log.error("Invalid http statuscode: " + response.statusCode)

							throttle.destroy()

							return setTimeout(doRequest, constants.retryDownloadTimeout)
						}

						const res: Buffer[] = []

						response.on("error", (err: Error) => {
							log.error(err)

							throttle.destroy()

							return setTimeout(doRequest, constants.retryDownloadTimeout)
						})

						response
							.pipe(throttle)
							.on("data", (chunk: Buffer) => {
								res.push(chunk)

								sendToAllPorts({
									type: from == "sync" ? "downloadProgress" : "downloadProgressSeperate",
									data: {
										uuid,
										bytes: chunk.length,
										from
									}
								})
							})
							.on("end", () => {
								try {
									resolve(nodeBufferToArrayBuffer(Buffer.concat(res)))
								} catch (e) {
									reject(e)
								}

								throttle.destroy()

								return true
							})
					})

					request.on("error", (err: Error) => {
						log.error(err)

						throttle.destroy()

						return setTimeout(doRequest, constants.retryDownloadTimeout)
					})

					request.on("timeout", () => {
						log.error("Download request timed out")

						throttle.destroy()
						request.destroy()

						return setTimeout(doRequest, constants.retryDownloadTimeout)
					})

					request.end()
				}

				return doRequest()
			})
			.catch(reject)
	})
}

export const trashItem = async ({ type, uuid }: { type: string; uuid: string }): Promise<void> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: type == "folder" ? "/v1/dir/trash" : "/v1/file/trash",
		data: {
			apiKey,
			uuid
		}
	})

	if (!response.status) {
		if (
			response.message.toString().toLowerCase().indexOf("already") !== -1 ||
			response.message.toString().toLowerCase().indexOf("does not exist") !== -1 ||
			response.message.toString().toLowerCase().indexOf("you cannot move this file to the trash") !== -1 ||
			response.message.toString().toLowerCase().indexOf("you cannot move this folder to the trash") !== -1 ||
			response.message.toString().toLowerCase().indexOf("folder not found") !== -1 ||
			response.message.toString().toLowerCase().indexOf("file not found") !== -1 ||
			response.message.toString().toLowerCase().indexOf("belong") !== -1 ||
			(response.message.toString().toLowerCase().indexOf("not found") !== -1 &&
				response.message.toString().toLowerCase().indexOf("api") == -1)
		) {
			return
		}

		throw new Error(response.message)
	}
}

export const moveFile = async ({ file, parent }: { file: any; parent: string }): Promise<void> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/file/move",
		data: {
			apiKey,
			fileUUID: file.uuid,
			folderUUID: parent
		}
	})

	if (!response.status) {
		if (
			response.message.toString().toLowerCase().indexOf("already") !== -1 ||
			response.message.toString().toLowerCase().indexOf("does not exist") !== -1 ||
			response.message.toString().toLowerCase().indexOf("file not found") !== -1 ||
			response.message.toString().toLowerCase().indexOf("belong") !== -1 ||
			response.message.toString().toLowerCase().indexOf("trash") !== -1 ||
			(response.message.toString().toLowerCase().indexOf("not found") !== -1 &&
				response.message.toString().toLowerCase().indexOf("api") == -1)
		) {
			return
		}

		throw new Error(response.message)
	}

	await checkIfItemParentIsShared({
		type: "file",
		parent,
		metaData: {
			uuid: file.uuid,
			name: file.name,
			size: file.size,
			mime: file.mime,
			key: file.key,
			lastModified: file.lastModified
		}
	})
}

export const moveFolder = async ({ folder, parent }: { folder: any; parent: string }): Promise<void> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/dir/move",
		data: {
			apiKey,
			uuid: folder.uuid,
			folderUUID: parent
		}
	})

	if (!response.status) {
		if (
			response.message.toString().toLowerCase().indexOf("already") !== -1 ||
			response.message.toString().toLowerCase().indexOf("does not exist") !== -1 ||
			response.message.toString().toLowerCase().indexOf("not found") !== -1 ||
			response.message.toString().toLowerCase().indexOf("folder not found") !== -1 ||
			response.message.toString().toLowerCase().indexOf("trash") !== -1 ||
			response.message.toString().toLowerCase().indexOf("belong") !== -1
		) {
			return
		}

		throw new Error(response.message)
	}

	await checkIfItemParentIsShared({
		type: "folder",
		parent,
		metaData: {
			name: folder.name,
			uuid: folder.uuid
		}
	})
}

export const renameFile = async ({ file, name }: { file: any; name: string }): Promise<void> => {
	const nameHashed = hashFn(name.toLowerCase())
	const [apiKey, masterKeys] = await Promise.all([db.get("apiKey"), db.get("masterKeys")])
	const [encrypted, encryptedName] = await Promise.all([
		encryptMetadata(
			JSON.stringify({
				name,
				size: file.size,
				mime: file.mime,
				key: file.key,
				lastModified: file.lastModified
			}),
			masterKeys[masterKeys.length - 1]
		),
		encryptMetadata(name, file.key)
	])

	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/file/rename",
		data: {
			apiKey,
			uuid: file.uuid,
			name: encryptedName,
			nameHashed,
			metaData: encrypted
		}
	})

	if (!response.status) {
		if (
			response.message.toString().toLowerCase().indexOf("already") !== -1 ||
			response.message.toString().toLowerCase().indexOf("does not exist") !== -1 ||
			response.message.toString().toLowerCase().indexOf("file not found") !== -1 ||
			response.message.toString().toLowerCase().indexOf("belong") !== -1 ||
			(response.message.toString().toLowerCase().indexOf("not found") !== -1 &&
				response.message.toString().toLowerCase().indexOf("api") == -1)
		) {
			return
		}

		throw new Error(response.message)
	}

	await checkIfItemIsSharedForRename({
		type: "file",
		uuid: file.uuid,
		metaData: {
			name,
			size: file.size,
			mime: file.mime,
			key: file.key,
			lastModified: file.lastModified
		}
	})
}

export const renameFolder = async ({ folder, name }: { folder: any; name: string }): Promise<void> => {
	const nameHashed = hashFn(name.toLowerCase())
	const [apiKey, masterKeys] = await Promise.all([db.get("apiKey"), db.get("masterKeys")])
	const encrypted = await encryptMetadata(JSON.stringify({ name }), masterKeys[masterKeys.length - 1])
	const response = await apiRequest({
		method: "POST",
		endpoint: "/v1/dir/rename",
		data: {
			apiKey,
			uuid: folder.uuid,
			name: encrypted,
			nameHashed
		}
	})

	if (!response.status) {
		if (
			response.message.toString().toLowerCase().indexOf("already") !== -1 ||
			response.message.toString().toLowerCase().indexOf("does not exist") !== -1 ||
			response.message.toString().toLowerCase().indexOf("folder not found") !== -1 ||
			response.message.toString().toLowerCase().indexOf("belong") !== -1 ||
			(response.message.toString().toLowerCase().indexOf("not found") !== -1 &&
				response.message.toString().toLowerCase().indexOf("api") == -1)
		) {
			return
		}

		throw new Error(response.message)
	}

	await checkIfItemIsSharedForRename({
		type: "folder",
		uuid: folder.uuid,
		metaData: {
			name
		}
	})
}

export const itemPublicLinkInfo = async (uuid: string, type: "folder" | "file"): Promise<any> => {
	const apiKey = await db.get("apiKey")
	const response = await apiRequest({
		method: "POST",
		endpoint: type == "file" ? "/v1/link/status" : "/v1/dir/link/status",
		data:
			type == "file"
				? {
						apiKey,
						fileUUID: uuid
				  }
				: {
						apiKey,
						uuid: uuid
				  }
	})

	if (!response.status) {
		throw new Error(response.message)
	}

	return response.data
}

export const enableItemPublicLink = async (
	uuid: string,
	type: "folder" | "file",
	progressCallback?: (current: number, total: number) => any
): Promise<void> => {
	const apiKey = await db.get("apiKey")

	if (type == "folder") {
		throw new Error("Not implemented")
	} else {
		const linkUUID = uuidv4()
		const response = await apiRequest({
			method: "POST",
			endpoint: "/v1/link/edit",
			data: {
				apiKey,
				uuid: linkUUID,
				fileUUID: uuid,
				expiration: "never",
				password: "empty",
				passwordHashed: hashFn("empty"),
				salt: generateRandomString(32),
				downloadBtn: "enable",
				type: "enable"
			}
		})

		if (typeof progressCallback == "function") {
			progressCallback(1, 1)
		}

		if (!response.status) {
			throw new Error(response.message)
		}
	}
}

export const disableItemPublicLink = async (uuid: string, type: "folder" | "file", linkUUID: string): Promise<void> => {
	const apiKey = await db.get("apiKey")

	if (type == "file") {
		if (linkUUID.length < 32) {
			throw new Error("Invalid linkUUID")
		}

		const response = await apiRequest({
			method: "POST",
			endpoint: "/v1/link/edit",
			data: {
				apiKey,
				uuid: linkUUID,
				fileUUID: uuid,
				expiration: "never",
				password: "empty",
				passwordHashed: hashFn("empty"),
				salt: generateRandomString(32),
				downloadBtn: "enable",
				type: "disable"
			}
		})

		if (!response.status) {
			throw new Error(response.message)
		}
	} else {
		const response = await apiRequest({
			method: "POST",
			endpoint: "/v1/dir/link/remove",
			data: {
				apiKey,
				uuid
			}
		})

		if (!response.status) {
			throw new Error(response.message)
		}
	}
}
