import constants from "../../../constants.json"
import { SemaphoreInterface } from "../../../types"
import { i18n } from "../i18n"

const pathModule = window.require("path")
const is = window.require("electron-is")

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

export const pathIncludesDot = (path: string) => {
	return path.indexOf("/.") !== -1 || path.startsWith(".")
}

export const isSubdir = (parent: string, path: string) => {
	const relative = pathModule.relative(parent, path)
	const isSubdir = relative && !relative.startsWith("..") && !pathModule.isAbsolute(relative)

	return isSubdir
}

export const normalizePlatform = (platform: string) => {
	if (platform == "darwin") {
		return "mac"
	}

	if (platform == "linux") {
		return "linux"
	}

	return "windows"
}

export const getRandomArbitrary = (min: number, max: number) => {
	return Math.floor(Math.random() * (max - min) + min)
}

export const sleep = (ms: number = 1000) => {
	return new Promise(resolve => setTimeout(resolve, ms))
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

export const compareVersions = (current: string, got: string) => {
	function compare(a: string, b: string) {
		if (a === b) {
			return 0
		}

		var a_components = a.split(".")
		var b_components = b.split(".")

		var len = Math.min(a_components.length, b_components.length)

		for (var i = 0; i < len; i++) {
			if (parseInt(a_components[i]) > parseInt(b_components[i])) {
				return 1
			}

			if (parseInt(a_components[i]) < parseInt(b_components[i])) {
				return -1
			}
		}

		if (a_components.length > b_components.length) {
			return 1
		}

		if (a_components.length < b_components.length) {
			return -1
		}

		return 0
	}

	let res = compare(current, got)

	if (res == -1) {
		return "update"
	} else {
		return "ok"
	}
}

export const formatBytes = (bytes: number, decimals: number = 2) => {
	if (bytes == 0) {
		return "0 Bytes"
	}

	let k = 1024
	let dm = decimals < 0 ? 0 : decimals
	let sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]

	let i = Math.floor(Math.log(bytes) / Math.log(k))

	return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i]
}

export const getChunkSize = (bps: number) => {
	const set = Math.floor(1024 * 16)
	const normal = Math.floor(bps / 10)

	if (set > normal && normal > 0 && normal < 1024 * 1024 * 1024 * 1024) {
		return normal
	}

	return set
}

export function fetchWithTimeout(ms: number, promise: Promise<any>) {
	return new Promise((resolve, reject) => {
		let timer = setTimeout(() => {
			return reject(new Error("Request timeout after " + ms + "ms"))
		}, ms)

		promise
			.then(value => {
				clearTimeout(timer)

				return resolve(value)
			})
			.catch(err => {
				clearTimeout(timer)

				return reject(err)
			})
	})
}

export const arrayBufferToHex = (buffer: any) => {
	return [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, "0")).join("")
}

export const getParentFromURL = (url: string) => {
	const ex = url.split("/")

	return ex[ex.length - 1].trim()
}

export const getParentFromParentFromURL = (url: string) => {
	const ex = url.split("/")

	return ex[ex.length - 2].trim()
}

export const base64ToArrayBuffer = (base64: string) => {
	const binary_string = window.atob(base64)
	const len = binary_string.length
	const bytes = new Uint8Array(len)

	for (let i = 0; i < len; i++) {
		bytes[i] = binary_string.charCodeAt(i)
	}

	return bytes.buffer
}

export function arrayBufferToBase64(arrayBuffer: ArrayBuffer) {
	var base64 = ""
	var encodings = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

	var bytes = new Uint8Array(arrayBuffer)
	var byteLength = bytes.byteLength
	var byteRemainder = byteLength % 3
	var mainLength = byteLength - byteRemainder

	var a, b, c, d
	var chunk

	// Main loop deals with bytes in chunks of 3
	for (var i = 0; i < mainLength; i = i + 3) {
		// Combine the three bytes into a single integer
		chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]

		// Use bitmasks to extract 6-bit segments from the triplet
		a = (chunk & 16515072) >> 18 // 16515072 = (2^6 - 1) << 18
		b = (chunk & 258048) >> 12 // 258048   = (2^6 - 1) << 12
		c = (chunk & 4032) >> 6 // 4032     = (2^6 - 1) << 6
		d = chunk & 63 // 63       = 2^6 - 1

		// Convert the raw binary segments to the appropriate ASCII encoding
		base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d]
	}

	// Deal with the remaining bytes and padding
	if (byteRemainder == 1) {
		chunk = bytes[mainLength]

		a = (chunk & 252) >> 2 // 252 = (2^6 - 1) << 2

		// Set the 4 least significant bits to zero
		b = (chunk & 3) << 4 // 3   = 2^2 - 1

		base64 += encodings[a] + encodings[b] + "=="
	} else if (byteRemainder == 2) {
		chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1]

		a = (chunk & 64512) >> 10 // 64512 = (2^6 - 1) << 10
		b = (chunk & 1008) >> 4 // 1008  = (2^6 - 1) << 4

		// Set the 2 least significant bits to zero
		c = (chunk & 15) << 2 // 15    = 2^4 - 1

		base64 += encodings[a] + encodings[b] + encodings[c] + "="
	}

	return base64
}

export const generateRandomString = (length: number = 32) => {
	return window
		.btoa(
			Array.from(window.crypto.getRandomValues(new Uint8Array(length * 2)))
				.map(b => String.fromCharCode(b))
				.join("")
		)
		.replace(/[+/]/g, "")
		.substring(0, length)
}

export const convertArrayBufferToBinaryString = (u8Array: any) => {
	let i,
		len = u8Array.length,
		b_str = ""

	for (i = 0; i < len; i++) {
		b_str += String.fromCharCode(u8Array[i])
	}

	return b_str
}

export function convertWordArrayToArrayBuffer(wordArray: any) {
	let arrayOfWords = wordArray.hasOwnProperty("words") ? wordArray.words : []
	let length = wordArray.hasOwnProperty("sigBytes") ? wordArray.sigBytes : arrayOfWords.length * 4
	let uInt8Array = new Uint8Array(length),
		index = 0,
		word,
		i

	for (i = 0; i < length; i++) {
		word = arrayOfWords[i]

		uInt8Array[index++] = word >> 24
		uInt8Array[index++] = (word >> 16) & 0xff
		uInt8Array[index++] = (word >> 8) & 0xff
		uInt8Array[index++] = word & 0xff
	}

	return uInt8Array
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

export const convertTimestampToMs = (timestamp: number): number => {
	const now = Date.now()

	if (Math.abs(now - timestamp) < Math.abs(now - timestamp * 1000)) {
		return timestamp
	}

	return Math.floor(timestamp * 1000)
}

export const simpleDate = (timestamp: number): string => {
	try {
		return new Date(convertTimestampToMs(timestamp)).toString().split(" ").slice(0, 5).join(" ")
	} catch (e) {
		return new Date().toString().split(" ").slice(0, 5).join(" ")
	}
}

export const isSystemPathExcluded = (path: string): boolean => {
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

export const isFolderPathExcluded = (path: string): boolean => {
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

export const isFileOrFolderNameIgnoredByDefault = (name: string): boolean => {
	if (typeof name !== "string") {
		return true
	}

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

	let ext: any = name.split(".")

	if (ext.length >= 2) {
		ext = ext[ext.length - 1]

		if (typeof ext == "string") {
			ext = ext.trim()

			if (ext.length > 0) {
				if (constants.defaultIgnored.extensions.includes(ext)) {
					return true
				}
			}
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

export const pathToLowerCaseExtFileName = (path: string) => {
	if (path.indexOf(".") == -1) {
		return path
	}

	const pathEx = path.split("/")

	if (pathEx.length <= 1) {
		return path
	}

	const fileNameEx = pathEx[pathEx.length - 1].split(".")

	if (fileNameEx.length <= 1) {
		return path
	}

	const lowerCaseFileEnding = fileNameEx[fileNameEx.length - 1].toLowerCase()

	fileNameEx.pop()
	pathEx.pop()

	const fileNameWithLowerCaseEnding = pathEx.join("/") + "/" + fileNameEx.join(".") + "." + lowerCaseFileEnding

	return fileNameWithLowerCaseEnding
}

export const fileNameToLowerCaseExt = (name: string) => {
	if (name.indexOf(".") == -1) {
		return name
	}

	const fileNameEx = name.split(".")
	const lowerCaseFileEnding = fileNameEx[fileNameEx.length - 1].toLowerCase()

	fileNameEx.pop()

	const fileNameWithLowerCaseEnding = fileNameEx.join(".") + "." + lowerCaseFileEnding

	return fileNameWithLowerCaseEnding
}

export const bpsToReadable = (bps: number) => {
	if (!(bps > 0 && bps < 1024 * 1024 * 1024 * 1024)) {
		bps = 1
	}

	let i = -1
	const byteUnits = [" KB/s", " MB/s", " GB/s", " TB/s", " PB/s", " EB/s", " ZB/s", " YB/s"]

	do {
		bps = bps / 1024
		i++
	} while (bps > 1024)

	return Math.max(bps, 0.1).toFixed(1) + byteUnits[i]
}

export function nodeBufferToArrayBuffer(buf: Buffer) {
	const ab = new ArrayBuffer(buf.length)
	const view = new Uint8Array(ab)
	for (let i = 0; i < buf.length; ++i) {
		view[i] = buf[i]
	}
	return ab
}

export function getTimeRemaining(endtime: number) {
	// @ts-ignore
	const total = Date.parse(new Date(endtime)) - Date.parse(new Date())
	const seconds = Math.floor((total / 1000) % 60)
	const minutes = Math.floor((total / 1000 / 60) % 60)
	const hours = Math.floor((total / (1000 * 60 * 60)) % 24)
	const days = Math.floor(total / (1000 * 60 * 60 * 24))

	return {
		total,
		days,
		hours,
		minutes,
		seconds
	}
}

export const isOnline = () => window.navigator.onLine

export function timeSince(timestamp: number, lang: string = "en") {
	timestamp = convertTimestampToMs(timestamp)

	const date = new Date(timestamp)
	var seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000)

	var interval = seconds / 31536000

	if (interval > 1) {
		return i18n(lang, "timeSinceYears", true, ["__TIME__"], [interval.toFixed(0)])
	}

	interval = seconds / 2592000

	if (interval > 1) {
		return i18n(lang, "timeSinceMonths", true, ["__TIME__"], [interval.toFixed(0)])
	}

	interval = seconds / 86400

	if (interval > 1) {
		return i18n(lang, "timeSinceDays", true, ["__TIME__"], [interval.toFixed(0)])
	}

	interval = seconds / 3600

	if (interval > 1) {
		return i18n(lang, "timeSinceHours", true, ["__TIME__"], [interval.toFixed(0)])
	}

	interval = seconds / 60

	if (interval > 1) {
		return i18n(lang, "timeSinceMinutes", true, ["__TIME__"], [interval.toFixed(0)])
	}

	return i18n(lang, "timeSinceSeconds", true, ["__TIME__"], [seconds.toFixed(0)])
}

export const copyToClipboard = async (text: string) => {
	try {
		navigator.clipboard.writeText(text)
	} catch (e) {
		throw e
	}
}

export const calcSpeed = (now: number, started: number, bytes: number): number => {
	now = new Date().getTime() - 1000

	const secondsDiff: number = (now - started) / 1000
	const bps: number = Math.floor((bytes / secondsDiff) * constants.speedMultiplier)

	return bps > 0 ? bps : 0
}

export const calcTimeLeft = (loadedBytes: number, totalBytes: number, started: number): number => {
	const elapsed: number = new Date().getTime() - started
	const speed: number = loadedBytes / (elapsed / 1000)
	const remaining: number = (totalBytes - loadedBytes) / speed

	return remaining > 0 ? remaining : 0
}

export const windowsPathToUnixStyle = (path: string) => {
	return path.split("\\").join("/")
}
