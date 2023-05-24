import { memoize } from "lodash"
import crypto from "crypto"
import constants from "../../../constants.json"
import is from "electron-is"
import pathModule from "path"
import { SemaphoreInterface } from "../../../types"

export const hashKey = memoize((key: string) => {
	const hash = crypto.createHash("sha256").update(key).digest("hex")

	return hash
})

export const getRandomArbitrary = (min: number, max: number) => {
	return Math.floor(Math.random() * (max - min) + min)
}

export const windowsPathToUnixStyle = (path: string) => {
	return path.split("\\").join("/")
}

export const pathIncludesDot = (path: string) => {
	return path.indexOf("/.") !== -1 || path.startsWith(".")
}

export const isFolderPathExcluded = (path: string) => {
	const real = path

	path = path.toLowerCase()

	for (let i = 0; i < constants.defaultIgnored.folders.length; i++) {
		if (
			path.indexOf(constants.defaultIgnored.folders[i].toLowerCase()) !== -1 ||
			real.indexOf(constants.defaultIgnored.folders[i]) !== -1
		) {
			return true
		}
	}

	return false
}

export const fileAndFolderNameValidation = (name: string) => {
	const regex = /[<>:"\/\\|?*\x00-\x1F]|^(?:aux|con|clock\$|nul|prn|com[1-9]|lpt[1-9])$/i

	if (regex.test(name)) {
		return false
	}

	return true
}

export const pathValidation = (path: string) => {
	if (path.indexOf("/") == -1) {
		return fileAndFolderNameValidation(path)
	}

	const ex = path.split("/")

	for (let i = 0; i < ex.length; i++) {
		if (!fileAndFolderNameValidation(ex[i].trim())) {
			return false
		}
	}

	return true
}

export const isFileOrFolderNameIgnoredByDefault = (name: string) => {
	name = name.toLowerCase().trim()

	if (name.length <= 0) {
		return true
	}

	if (name.length >= 256) {
		return true
	}

	if (name.substring(0, 1) == " ") {
		return true
	}

	if (name.slice(-1) == " ") {
		return true
	}

	if (name.indexOf("\n") !== -1) {
		return true
	}

	if (name.indexOf("\r") !== -1) {
		return true
	}

	if (constants.defaultIgnored.names.includes(name)) {
		return true
	}

	if (name.substring(0, 7) == ".~lock.") {
		return true
	}

	if (name.substring(0, 2) == "~$") {
		return true
	}

	if (name.substring(name.length - 4) == ".tmp") {
		return true
	}

	if (name.substring(name.length - 5) == ".temp") {
		return true
	}

	if (name.indexOf(".") !== -1) {
		const ext = pathModule.extname(name).split(".").join("")

		if (constants.defaultIgnored.extensions.includes(ext)) {
			return true
		}
	}

	return false
}

export const pathIsFileOrFolderNameIgnoredByDefault = (path: string) => {
	if (path.indexOf("/") == -1) {
		return isFileOrFolderNameIgnoredByDefault(path)
	}

	const ex = path.split("/")

	for (let i = 0; i < ex.length; i++) {
		if (isFileOrFolderNameIgnoredByDefault(ex[i].trim())) {
			return true
		}
	}

	return false
}

export const isSystemPathExcluded = (path: string) => {
	const real = path

	path = path.toLowerCase()

	for (let i = 0; i < constants.defaultIgnored.system.length; i++) {
		if (
			path.indexOf(constants.defaultIgnored.system[i].toLowerCase()) !== -1 ||
			real.indexOf(constants.defaultIgnored.system[i]) !== -1
		) {
			return true
		}
	}

	return false
}

export const isPathOverMaxLength = (path: string) => {
	if (is.linux()) {
		return path.length > 4095
	} else if (is.macOS()) {
		return path.length > 1023
	} else if (is.windows()) {
		return path.length > 399
	}

	return path.length > 399
}

export const isNameOverMaxLength = (name: string) => {
	if (is.linux()) {
		return name.length > 255
	} else if (is.macOS()) {
		return name.length > 255
	} else if (is.windows()) {
		return name.length > 255
	}

	return name.length > 255
}

export const Semaphore = function (this: SemaphoreInterface, max: number) {
	var counter = 0
	var waiting: any = []
	var maxCount = max || 1

	var take = function () {
		if (waiting.length > 0 && counter < maxCount) {
			counter++
			let promise = waiting.shift()
			promise.resolve()
		}
	}

	this.acquire = function () {
		if (counter < maxCount) {
			counter++
			return new Promise(resolve => {
				resolve(true)
			})
		} else {
			return new Promise((resolve, err) => {
				waiting.push({ resolve: resolve, err: err })
			})
		}
	}

	this.release = function () {
		counter--
		take()
	}

	this.count = function () {
		return counter
	}

	this.setMax = function (newMax: number) {
		maxCount = newMax
	}

	this.purge = function () {
		let unresolved = waiting.length

		for (let i = 0; i < unresolved; i++) {
			waiting[i].err("Task has been purged.")
		}

		counter = 0
		waiting = []

		return unresolved
	}
} as any as { new (max: number): SemaphoreInterface }

export const isSubdir = (parent: string, path: string) => {
	const relative = pathModule.relative(parent, path)
	const isSubdir = relative && !relative.startsWith("..") && !pathModule.isAbsolute(relative)

	return isSubdir
}

export const isIgnoredBySelectiveSync = (selectiveSyncRemoteIgnore: { [key: string]: boolean }, path: string): boolean => {
	if (typeof selectiveSyncRemoteIgnore == "undefined" || !selectiveSyncRemoteIgnore || selectiveSyncRemoteIgnore == null) {
		return false
	}

	if (Object.keys(selectiveSyncRemoteIgnore).length <= 0) {
		return false
	}

	for (const prop in selectiveSyncRemoteIgnore) {
		if (prop == path || isSubdir(prop, path) || isSubdir(path, prop)) {
			return true
		}
	}

	return false
}

export const chunkedPromiseAll = async <T>(promises: Promise<T>[], chunkSize = 100000): Promise<T[]> => {
	const results: T[] = []

	for (let i = 0; i < promises.length; i += chunkSize) {
		const chunk = promises.slice(i, i + chunkSize)
		const chunkResults = await Promise.all(chunk)

		results.push(...chunkResults)
	}

	return results
}
