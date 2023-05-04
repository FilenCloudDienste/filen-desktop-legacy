import { apiRequest, throttleGroupUpload, throttleGroupDownload, uploadChunk, downloadChunk } from "../../api"
import {
	decryptFolderName,
	decryptMetadata,
	hashFn,
	hashPassword,
	deriveKeyFromPassword,
	generatePasswordAndMasterKeysBasedOnAuthVersion,
	decryptData,
	decryptFileMetadata,
	encryptData,
	encryptMetadata,
	decryptFileMetadataPrivateKey,
	decryptFileMetadataLink,
	decryptFolderLinkKey,
	decryptFolderNameLink,
	decryptFolderNamePrivateKey
} from "../../crypto"
import db from "../../db"
import * as fsLocal from "../../fs/local"
import * as fsRemote from "../../fs/remote"
import ipc from "../../ipc"
import eventListener from "../../eventListener"
import memoryCache from "../../memoryCache"

const { ipcRenderer } = window.require("electron")
const log = window.require("electron-log")

const handleMessage = (type: string, request: any) => {
	return new Promise((resolve, reject) => {
		if (type == "ping") {
			return resolve("pong")
		} else if (type == "apiRequest") {
			const { method, endpoint, data } = request

			apiRequest({ method, endpoint, data }).then(resolve).catch(reject)
		} else if (type == "decryptFolderName") {
			const { name } = request

			db.get("masterKeys")
				.then(masterKeys => {
					decryptFolderName(name, masterKeys).then(resolve).catch(reject)
				})
				.catch(reject)
		} else if (type == "decryptMetadata") {
			const { data, key } = request

			decryptMetadata(data, key).then(resolve).catch(reject)
		} else if (type == "hashPassword") {
			const { password } = request

			try {
				return resolve(hashPassword(password))
			} catch (e) {
				return reject(e)
			}
		} else if (type == "hashFn") {
			const { data } = request

			try {
				return resolve(hashFn(data))
			} catch (e) {
				return reject(e)
			}
		} else if (type == "deriveKeyFromPassword") {
			const { password, salt, iterations, hash, bitLength, returnHex } = request

			deriveKeyFromPassword({ password, salt, iterations, hash, bitLength, returnHex }).then(resolve).catch(reject)
		} else if (type == "generatePasswordAndMasterKeysBasedOnAuthVersion") {
			const { rawPassword, authVersion, salt } = request

			generatePasswordAndMasterKeysBasedOnAuthVersion({ rawPassword, authVersion, salt }).then(resolve).catch(reject)
		} else if (type == "decryptData") {
			const { data, key, version } = request

			decryptData(data, key, version).then(resolve).catch(reject)
		} else if (type == "decryptFileMetadata") {
			const { metadata, masterKeys } = request

			decryptFileMetadata(metadata, masterKeys).then(resolve).catch(reject)
		} else if (type == "encryptMetadata") {
			const { data, key } = request

			encryptMetadata(data, key).then(resolve).catch(reject)
		} else if (type == "encryptData") {
			const { data, key } = request

			encryptData(data, key).then(resolve).catch(reject)
		} else if (type == "decryptFileMetadataPrivateKey") {
			const { metadata, privateKey } = request

			decryptFileMetadataPrivateKey(metadata, privateKey).then(resolve).catch(reject)
		} else if (type == "decryptFileMetadataLink") {
			const { metadata, linkKey } = request

			decryptFileMetadataLink(metadata, linkKey).then(resolve).catch(reject)
		} else if (type == "decryptFolderLinkKey") {
			const { metadata, masterKeys } = request

			decryptFolderLinkKey(metadata, masterKeys).then(resolve).catch(reject)
		} else if (type == "decryptFolderNameLink") {
			const { metadata, linkKey } = request

			decryptFolderNameLink(metadata, linkKey).then(resolve).catch(reject)
		} else if (type == "decryptFolderNamePrivateKey") {
			const { metadata, privateKey } = request

			decryptFolderNamePrivateKey(metadata, privateKey).then(resolve).catch(reject)
		} else if (type == "selectiveSyncDirectoryTrees") {
			const { location } = request

			Promise.all([
				fsLocal.directoryTree(location.local, true, location),
				fsRemote.directoryTree(location.remoteUUID, true, location)
			])
				.then(([localTree, remoteTree]) => {
					return resolve({
						localTree,
						remoteTree
					})
				})
				.catch(reject)
		} else if (type == "remoteTree") {
			const { location } = request

			fsRemote.directoryTree(location.remoteUUID, true, location).then(resolve).catch(reject)
		} else if (type == "localTree") {
			const { location } = request

			fsLocal.directoryTree(location.local, true, location).then(resolve).catch(reject)
		} else if (type == "updateThrottles") {
			const { uploadKbps, downloadKbps } = request

			try {
				throttleGroupUpload.setRate(uploadKbps)
				throttleGroupDownload.setRate(downloadKbps)

				return resolve(true)
			} catch (e) {
				return reject(e)
			}
		} else if (type == "uploadChunk") {
			const { queryParams, data, from } = request

			uploadChunk({ queryParams, data, from }).then(resolve).catch(reject)
		} else if (type == "downloadChunk") {
			const { region, bucket, uuid, index, from } = request

			downloadChunk({ region, bucket, uuid, index, from }).then(resolve).catch(reject)
		} else if (type == "getFileKey") {
			const { uuid } = request

			if (memoryCache.has("fileKey:" + uuid)) {
				return resolve(memoryCache.get("fileKey:" + uuid))
			}

			return reject(new Error("File key for " + uuid + " not found"))
		} else {
			return reject("Invalid message type: " + type.toString())
		}

		return true
	})
}

export const listen = () => {
	ipcRenderer.on("for-worker", (_: any, request: any) => {
		const { messageId, messageSender, type, data } = request

		if (!messageId || !messageSender || !type) {
			return false
		}

		handleMessage(type, data)
			.then(response => {
				return ipcRenderer.send("proxy-from-worker", {
					messageId,
					messageSender,
					response
				})
			})
			.catch(err => {
				return ipcRenderer.send("proxy-from-worker", {
					messageId,
					messageSender,
					err
				})
			})
	})

	eventListener.on("socket-event", (res: any) => {
		const { type, data } = res
		const { args } = data

		if (type == "fm-to-sync-client-message") {
			db.get("masterKeys")
				.then(async masterKeys => {
					if (!Array.isArray(masterKeys)) {
						masterKeys = []
					}

					let gotArgs = undefined

					for (let i = 0; i < masterKeys.length; i++) {
						try {
							const obj = JSON.parse(await decryptMetadata(args, masterKeys[i]))

							if (obj && typeof obj == "object") {
								gotArgs = obj
							}
						} catch (e) {
							continue
						}
					}

					if (typeof gotArgs == "undefined") {
						return log.error(new Error("[fm-to-sync-client-message] gotArgs undefined"))
					}

					if (gotArgs.type == "download-folder") {
						ipc.openDownloadWindow(gotArgs).catch(log.error)
					}
				})
				.catch(log.error)
		}
	})
}

export const sendToAllPorts = (data: any) => {
	ipcRenderer.send("proxy-global-message", data)
}
