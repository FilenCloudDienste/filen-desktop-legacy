import fs from "fs-extra"
import pathModule from "path"
import log from "electron-log"
import { app, shell } from "electron"
import { Location } from "../../../../types"
import { chunkedPromiseAll } from "../../helpers"

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

export const normalizePath = (path: string): string => {
	return pathModule.normalize(path)
}

export const realPath = async (path: string): Promise<string> => {
	try {
		return await fs.realpath(path)
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

					return resolve(stats as Stats)
				})
				.catch(err => {
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

	await chunkedPromiseAll([gracefulLStat(path), gracefulLStat(tmpDir)])
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
		return
	}

	if (!(await doesExistLocally(trashDirPath))) {
		await shell.trashItem(path)

		return
	}

	try {
		await move(path, normalizePath(pathModule.join(trashDirPath, basename)), true)
	} catch (e: any) {
		if (e.code && e.code == "ENOENT") {
			return
		}

		throw e
	}
}

export const rmPermanent = (path: string): Promise<void> => {
	return new Promise(async (resolve, reject) => {
		path = normalizePath(path)

		if (!(await doesExistLocally(path))) {
			return resolve()
		}

		try {
			var stats = await gracefulLStat(path)
		} catch (e: any) {
			if (e.code && e.code == "ENOENT") {
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
				} catch (e: any) {
					lastErr = e

					if (e.code && e.code == "ENOENT") {
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
				} catch (e: any) {
					lastErr = e

					if (e.code && e.code == "ENOENT") {
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
