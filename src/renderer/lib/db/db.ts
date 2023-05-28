import { sendToAllPorts } from "../worker/ipc"
import { getRandomArbitrary, hashKey } from "../helpers"
import ipc from "../ipc"

const writeFileAtomic = window.require("write-file-atomic")
const fs = window.require("fs-extra")
const pathModule = window.require("path")
const log = window.require("electron-log")

const DB_VERSION = 1
let DB_PATH = ""
const MAX_RETRIES = 30
const RETRY_TIMEOUT = 500

ipc.getAppPath("userData")
	.then(path => {
		DB_PATH = pathModule.join(path, "db_v" + DB_VERSION)
	})
	.catch(log.error)

export const dbReady = async (): Promise<void> => {
	await new Promise<void>(resolve => {
		if (DB_PATH.length > 0) {
			resolve()

			return
		}

		const wait = setInterval(() => {
			if (DB_PATH.length > 0) {
				clearInterval(wait)

				resolve()
			}
		}, 1)
	})
}

export const get = async (key: string): Promise<any> => {
	await dbReady()

	const keyHash = hashKey(key)

	try {
		const val = JSON.parse(await fs.readFile(pathModule.join(DB_PATH, keyHash + ".json"), "utf-8"))

		if (typeof val !== "object") {
			return null
		}

		if (typeof val.key !== "string" || typeof val.value === "undefined") {
			return null
		}

		if (val.key !== key) {
			return null
		}

		return val.value
	} catch (e) {
		return null
	}
}

export const set = (key: string, value: any): Promise<void> => {
	return new Promise<void>(async (resolve, reject) => {
		await dbReady()

		await ipc.acquireSemaphore(key, 1)

		try {
			var val = JSON.stringify(
				{
					key,
					value
				},
				(_, val) => (typeof val === "bigint" ? val.toString() : val)
			)
		} catch (e) {
			reject(e)

			ipc.releaseSemaphore(key).catch(log.error)

			return
		}

		const keyHash = hashKey(key)
		let tries = 0
		let lastErr = ""

		const write = () => {
			if (tries > MAX_RETRIES) {
				reject(new Error(lastErr))

				ipc.releaseSemaphore(key).catch(log.error)

				return
			}

			tries += 1

			const dbFilePath = pathModule.join(DB_PATH, keyHash + ".json")

			fs.ensureFile(dbFilePath)
				.then(() => {
					writeFileAtomic(dbFilePath, val)
						.then(() => {
							sendToAllPorts({
								type: "dbSet",
								data: {
									key
								}
							})

							ipc.releaseSemaphore(key).catch(log.error)

							resolve()
						})
						.catch((err: any) => {
							lastErr = err

							setTimeout(write, RETRY_TIMEOUT + getRandomArbitrary(10, 100))
						})
				})
				.catch((err: any) => {
					lastErr = err

					setTimeout(write, RETRY_TIMEOUT + getRandomArbitrary(10, 100))
				})
		}

		write()
	})
}

export const remove = (key: string): Promise<void> => {
	return new Promise<void>(async (resolve, reject) => {
		await dbReady()

		await ipc.acquireSemaphore(key, 1)

		const keyHash = hashKey(key)
		let tries = 0
		let lastErr = ""

		const write = () => {
			if (tries > MAX_RETRIES) {
				reject(new Error(lastErr))

				ipc.releaseSemaphore(key).catch(log.error)

				return
			}

			tries += 1

			fs.access(pathModule.join(DB_PATH, keyHash + ".json"), fs.constants.F_OK, (err: any) => {
				if (err) {
					sendToAllPorts({
						type: "dbRemove",
						data: {
							key
						}
					})

					ipc.releaseSemaphore(key).catch(log.error)

					resolve()

					return
				}

				fs.unlink(pathModule.join(DB_PATH, keyHash + ".json"))
					.then(() => {
						sendToAllPorts({
							type: "dbRemove",
							data: {
								key
							}
						})

						ipc.releaseSemaphore(key).catch(log.error)

						resolve()
					})
					.catch((err: any) => {
						if (err.code === "ENOENT") {
							sendToAllPorts({
								type: "dbRemove",
								data: {
									key
								}
							})

							ipc.releaseSemaphore(key).catch(log.error)

							resolve()

							return
						}

						lastErr = err

						setTimeout(write, RETRY_TIMEOUT + getRandomArbitrary(10, 100))
					})
			})
		}

		write()
	})
}

export const clear = async (): Promise<void> => {
	await dbReady()

	const dir = await fs.readdir(DB_PATH)

	for (const file of dir) {
		await fs.unlink(pathModule.join(DB_PATH, file))
	}

	sendToAllPorts({
		type: "dbClear"
	})
}

export const keys = async (): Promise<string[]> => {
	await dbReady()

	const dir = await fs.readdir(DB_PATH)
	const keys: string[] = []

	for (const file of dir) {
		const obj = JSON.parse(await fs.readFile(pathModule.join(DB_PATH, file), "utf-8"))

		if (typeof obj === "object" && typeof obj.key === "string") {
			keys.push(obj.key)
		}
	}

	return keys
}

export const db = {
	get,
	set,
	remove,
	clear,
	keys
}

export default db
