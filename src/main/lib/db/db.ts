import pathModule from "path"
import { app } from "electron"
import fs from "fs-extra"
import writeFileAtomic from "write-file-atomic"
import { getRandomArbitrary, hashKey, Semaphore } from "../helpers"
import { emitGlobal } from "../ipc"
import { SemaphoreInterface } from "../../../types"

const DB_VERSION = 1
const DB_PATH = pathModule.join(app.getPath("userData"), "db_v" + DB_VERSION)
const MAX_RETRIES = 30
const RETRY_TIMEOUT = 500

export const writeMutexes: Record<string, SemaphoreInterface> = {}

export const get = async (key: string): Promise<any> => {
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
		if (!writeMutexes[key]) {
			writeMutexes[key] = new Semaphore(1)
		}

		await writeMutexes[key].acquire()

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

			writeMutexes[key].release()

			return
		}

		const keyHash = hashKey(key)
		let tries = 0
		let lastErr = ""

		const write = () => {
			if (tries > MAX_RETRIES) {
				reject(new Error(lastErr))

				writeMutexes[key].release()

				return
			}

			tries += 1

			const dbFilePath = pathModule.join(DB_PATH, keyHash + ".json")

			fs.ensureFile(dbFilePath)
				.then(() => {
					writeFileAtomic(dbFilePath, val)
						.then(() => {
							emitGlobal("global-message", {
								type: "dbSet",
								data: {
									key
								}
							})

							writeMutexes[key].release()

							resolve()
						})
						.catch(err => {
							lastErr = err

							setTimeout(write, RETRY_TIMEOUT + getRandomArbitrary(10, 100))
						})
				})
				.catch(err => {
					lastErr = err

					setTimeout(write, RETRY_TIMEOUT + getRandomArbitrary(10, 100))
				})
		}

		write()
	})
}

export const remove = (key: string): Promise<void> => {
	return new Promise<void>(async (resolve, reject) => {
		if (!writeMutexes[key]) {
			writeMutexes[key] = new Semaphore(1)
		}

		await writeMutexes[key].acquire()

		const keyHash = hashKey(key)
		let tries = 0
		let lastErr = ""

		const write = () => {
			if (tries > MAX_RETRIES) {
				reject(new Error(lastErr))

				writeMutexes[key].release()

				return
			}

			tries += 1

			fs.access(pathModule.join(DB_PATH, keyHash + ".json"), fs.constants.F_OK, err => {
				if (err) {
					emitGlobal("global-message", {
						type: "dbRemove",
						data: {
							key
						}
					})

					writeMutexes[key].release()

					resolve()

					return
				}

				fs.unlink(pathModule.join(DB_PATH, keyHash + ".json"))
					.then(() => {
						emitGlobal("global-message", {
							type: "dbRemove",
							data: {
								key
							}
						})

						writeMutexes[key].release()

						resolve()
					})
					.catch(err => {
						if (err.code === "ENOENT") {
							emitGlobal("global-message", {
								type: "dbRemove",
								data: {
									key
								}
							})

							writeMutexes[key].release()

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
	const dir = await fs.readdir(DB_PATH)

	for (const entry of dir) {
		await fs.unlink(pathModule.join(DB_PATH, entry))
	}

	emitGlobal("global-message", {
		type: "dbClear"
	})
}

export const keys = async (): Promise<string[]> => {
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
