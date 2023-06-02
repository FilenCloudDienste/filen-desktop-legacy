import memoryCache from "../memoryCache"
import {
	arrayBufferToHex,
	base64ToArrayBuffer,
	arrayBufferToBase64,
	generateRandomString,
	convertArrayBufferToBinaryString,
	convertWordArrayToArrayBuffer
} from "../helpers"
import striptags from "striptags"
import { RemoteFileMetadata } from "../../../types"

const CryptoJS = window.require("crypto-js") //old & deprecated, not in use anymore, just here for backwards compatibility
const md2 = window.require("js-md2")
const log = window.require("electron-log")
const crypto = window.require("crypto")

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const bufferToHash = async (
	buffer: Uint8Array | ArrayBuffer,
	algorithm: "SHA-1" | "SHA-256" | "SHA-512" | "SHA-384"
): Promise<string> => {
	const digest = await globalThis.crypto.subtle.digest(algorithm, buffer)
	const hashArray = Array.from(new Uint8Array(digest))
	const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("")

	return hashHex
}

const sha1 = (input: string): string => {
	//old & deprecated, not in use anymore, just here for backwards compatibility
	return crypto.createHash("sha1").update(Buffer.from(input, "utf8")).digest("hex")
}

const sha256 = (input: string): string => {
	return crypto.createHash("sha256").update(Buffer.from(input, "utf8")).digest("hex")
}

const sha384 = (input: string): string => {
	return crypto.createHash("sha384").update(Buffer.from(input, "utf8")).digest("hex")
}

const sha512 = (input: string): string => {
	return crypto.createHash("sha512").update(Buffer.from(input, "utf8")).digest("hex")
}

const md5 = (input: string): string => {
	//old & deprecated, not in use anymore, just here for backwards compatibility
	return crypto.createHash("md5").update(Buffer.from(input, "utf8")).digest("hex")
}

const md4 = (input: string): string => {
	//old & deprecated, not in use anymore, just here for backwards compatibility
	return crypto.createHash("md4").update(Buffer.from(input, "utf8")).digest("hex")
}

export const deriveKeyFromPassword = async ({
	password,
	salt,
	iterations,
	hash,
	bitLength,
	returnHex
}: {
	password: string
	salt: string
	iterations: number
	hash: string
	bitLength: number
	returnHex: boolean
}): Promise<string | ArrayBuffer> => {
	const cacheKey =
		"deriveKeyFromPassword:" + password + ":" + salt + ":" + iterations + ":" + hash + ":" + bitLength + ":" + returnHex.toString()

	if (memoryCache.has(cacheKey)) {
		return memoryCache.get(cacheKey)
	}

	const bits = await window.crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt: textEncoder.encode(salt),
			iterations: iterations,
			hash: {
				name: hash
			}
		},
		await window.crypto.subtle.importKey(
			"raw",
			textEncoder.encode(password),
			{
				name: "PBKDF2"
			},
			false,
			["deriveBits"]
		),
		bitLength
	)

	const key = returnHex ? arrayBufferToHex(bits) : bits

	memoryCache.set(cacheKey, key)

	return key
}

export const generatePasswordAndMasterKeysBasedOnAuthVersion = async ({
	rawPassword,
	authVersion,
	salt
}: {
	rawPassword: string
	authVersion: number
	salt: string
}): Promise<{ derivedMasterKeys: string; derivedPassword: string }> => {
	let derivedPassword = ""
	let derivedMasterKeys: any = undefined

	if (authVersion == 1) {
		//old & deprecated, not in use anymore, just here for backwards compatibility
		derivedPassword = hashPassword(rawPassword)
		derivedMasterKeys = hashFn(rawPassword)
	} else if (authVersion == 2) {
		const derivedKey = (await deriveKeyFromPassword({
			password: rawPassword,
			salt,
			iterations: 200000,
			hash: "SHA-512",
			bitLength: 512,
			returnHex: true
		})) as string

		derivedMasterKeys = derivedKey.substring(0, derivedKey.length / 2)
		derivedPassword = derivedKey.substring(derivedKey.length / 2, derivedKey.length)
		derivedPassword = sha512(derivedPassword)
	} else {
		throw new Error("Invalid auth version")
	}

	return {
		derivedMasterKeys,
		derivedPassword
	}
}

export const hashPassword = (password: string): string => {
	//old & deprecated, not in use anymore, just here for backwards compatibility
	return sha512(sha384(sha256(sha1(password)))) + sha512(md5(md4(md2(password))))
}

export const hashFn = (input: string): string => {
	return sha1(sha512(input))
}

export const decryptMetadata = async (data: string, key: any): Promise<string> => {
	const cacheKey = "decryptMetadata:" + data.toString() + ":" + key

	if (memoryCache.has(cacheKey)) {
		return memoryCache.get(cacheKey)
	}

	const sliced = data.slice(0, 8)

	if (sliced == "U2FsdGVk") {
		//old & deprecated, not in use anymore, just here for backwards compatibility
		try {
			const decrypted = CryptoJS.AES.decrypt(data, key).toString(CryptoJS.enc.Utf8)

			memoryCache.set(cacheKey, decrypted)

			return decrypted
		} catch (e) {
			return ""
		}
	} else {
		const version = data.slice(0, 3)

		if (version == "002") {
			try {
				key = await deriveKeyFromPassword({
					password: key,
					salt: key,
					iterations: 1,
					hash: "SHA-512",
					bitLength: 256,
					returnHex: false
				}) //transform variable length input key to 256 bit (32 bytes) as fast as possible since it's already derived and safe

				const iv = textEncoder.encode(data.slice(3, 15))
				const encrypted = base64ToArrayBuffer(data.slice(15))

				const decrypted = await window.crypto.subtle.decrypt(
					{
						name: "AES-GCM",
						iv
					},
					await window.crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]),
					encrypted
				)

				const result = textDecoder.decode(new Uint8Array(decrypted))

				memoryCache.set(cacheKey, result)

				return result
			} catch (e) {
				return ""
			}
		} else {
			return ""
		}
	}
}

export const decryptFolderName = async (metadata: string, masterKeys: string[]): Promise<string> => {
	if (metadata.toLowerCase() == "default") {
		return "Default"
	}

	if (!Array.isArray(masterKeys) || masterKeys.length == 0) {
		log.error(new Error("Master keys not array"))

		return ""
	}

	const cacheKey = "decryptFolderName:" + metadata

	if (memoryCache.has(cacheKey)) {
		return memoryCache.get(cacheKey)
	}

	let folderName = ""

	for (let i = 0; i < masterKeys.length; i++) {
		try {
			const obj = JSON.parse(await decryptMetadata(metadata, masterKeys[i]))

			if (obj && typeof obj == "object") {
				if (typeof obj.name == "string") {
					obj.name = striptags(obj.name)

					if (obj.name.length > 0) {
						folderName = obj.name

						break
					}
				}
			}
		} catch (e) {
			continue
		}
	}

	if (typeof folderName == "string" && folderName.length > 0) {
		memoryCache.set(cacheKey, folderName)
	}

	return folderName
}

export const encryptMetadata = async (data: string, key: any): Promise<string> => {
	//transform variable length input key to 256 bit (32 bytes) as fast as possible since it's already derived and safe
	key = await deriveKeyFromPassword({
		password: key,
		salt: key,
		iterations: 1,
		hash: "SHA-512",
		bitLength: 256,
		returnHex: false
	})

	const iv = generateRandomString(12)
	const string = textEncoder.encode(data)

	const encrypted = await window.crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: textEncoder.encode(iv)
		},
		await window.crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]),
		string
	)

	return "002" + iv + arrayBufferToBase64(new Uint8Array(encrypted))
}

export const encryptData = async (data: any, key: string): Promise<Buffer> => {
	if (typeof data === "undefined" || typeof data.byteLength === "undefined" || data.byteLength === 0) {
		throw new Error("encryptData: Invalid data")
	}

	const iv = generateRandomString(12)
	const encrypted = await window.crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: textEncoder.encode(iv)
		},
		await window.crypto.subtle.importKey("raw", textEncoder.encode(key), "AES-GCM", false, ["encrypt"]),
		data
	)

	return Buffer.concat([Buffer.from(iv, "utf8"), new Uint8Array(encrypted)])
}

export const decryptData = async (data: any, key: string, version: number): Promise<Uint8Array> => {
	if (version == 1) {
		//old & deprecated, not in use anymore, just here for backwards compatibility
		const sliced = convertArrayBufferToBinaryString(new Uint8Array(data.slice(0, 16)))

		if (sliced.indexOf("Salted") !== -1) {
			return convertWordArrayToArrayBuffer(CryptoJS.AES.decrypt(arrayBufferToBase64(data), key))
		} else if (sliced.indexOf("U2FsdGVk") !== -1) {
			return convertWordArrayToArrayBuffer(CryptoJS.AES.decrypt(convertArrayBufferToBinaryString(new Uint8Array(data)), key))
		} else {
			const iv = textEncoder.encode(key).slice(0, 16)

			const decrypted = await window.crypto.subtle.decrypt(
				{
					name: "AES-CBC",
					iv
				},
				await window.crypto.subtle.importKey("raw", textEncoder.encode(key), "AES-CBC", false, ["decrypt"]),
				data
			)

			return new Uint8Array(decrypted)
		}
	} else {
		const iv = data.slice(0, 12)
		const encData = data.slice(12)

		const decrypted = await window.crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv
			},
			await window.crypto.subtle.importKey("raw", textEncoder.encode(key), "AES-GCM", false, ["decrypt"]),
			encData
		)

		return new Uint8Array(decrypted)
	}
}

export const decryptFileMetadata = async (metadata: string, masterKeys: string[]): Promise<RemoteFileMetadata> => {
	const cacheKey = "decryptFileMetadata:" + metadata

	if (memoryCache.has(cacheKey)) {
		return memoryCache.get(cacheKey)
	}

	let fileName = ""
	let fileSize = 0
	let fileMime = ""
	let fileKey = ""
	let fileLastModified = 0

	for (let i = 0; i < masterKeys.length; i++) {
		try {
			const obj = JSON.parse(await decryptMetadata(metadata, masterKeys[i]))

			if (obj && typeof obj == "object") {
				if (typeof obj.name == "string") {
					obj.name = striptags(obj.name)

					if (obj.name.length > 0) {
						fileName = obj.name
						fileSize = parseInt(obj.size)
						fileMime = striptags(obj.mime)
						fileKey = obj.key
						fileLastModified = parseInt(obj.lastModified)

						break
					}
				}
			}
		} catch (e) {
			continue
		}
	}

	const obj = {
		name: fileName,
		size: fileSize,
		mime: fileMime,
		key: fileKey,
		lastModified: fileLastModified
	}

	if (typeof obj.name == "string" && obj.name.length > 0) {
		memoryCache.set(cacheKey, obj)
	}

	return obj
}

export const decryptFolderLinkKey = async (metadata: string, masterKeys: string[]): Promise<string> => {
	const cacheKey = "decryptFolderLinkKey:" + metadata

	if (memoryCache.has(cacheKey)) {
		return memoryCache.get(cacheKey)
	}

	let link = ""

	for (let i = 0; i < masterKeys.length; i++) {
		try {
			const obj = await decryptMetadata(metadata, masterKeys[i])

			if (obj && typeof obj == "string") {
				if (obj.length >= 16) {
					link = obj

					break
				}
			}
		} catch (e) {
			continue
		}
	}

	if (typeof link == "string" && link.length > 0) {
		memoryCache.set(cacheKey, link)
	}

	return link
}

export const decryptFolderNameLink = async (metadata: string, linkKey: string): Promise<string> => {
	if (metadata.toLowerCase() == "default") {
		return "Default"
	}

	const cacheKey = "decryptFolderNameLink:" + metadata

	if (memoryCache.has(cacheKey)) {
		return memoryCache.get(cacheKey)
	}

	let folderName = ""

	try {
		const obj = JSON.parse(await decryptMetadata(metadata, linkKey))

		if (obj && typeof obj == "object") {
			if (typeof obj.name == "string") {
				obj.name = striptags(obj.name)

				if (obj.name.length > 0) {
					folderName = obj.name
				}
			}
		}
	} catch (e) {
		log.error(e)
	}

	if (typeof folderName == "string" && folderName.length > 0) {
		memoryCache.set(cacheKey, folderName)
	}

	return folderName
}

export const decryptFileMetadataLink = async (metadata: string, linkKey: string): Promise<RemoteFileMetadata> => {
	const cacheKey = "decryptFileMetadataLink:" + metadata

	if (memoryCache.has(cacheKey)) {
		return memoryCache.get(cacheKey)
	}

	let fileName = ""
	let fileSize = 0
	let fileMime = ""
	let fileKey = ""
	let fileLastModified = 0

	try {
		const obj = JSON.parse(await decryptMetadata(metadata, linkKey))

		if (obj && typeof obj == "object") {
			if (typeof obj.name == "string") {
				obj.name = striptags(obj.name)

				if (obj.name.length > 0) {
					fileName = obj.name
					fileSize = parseInt(obj.size)
					fileMime = striptags(obj.mime)
					fileKey = obj.key
					fileLastModified = parseInt(obj.lastModified)
				}
			}
		}
	} catch (e) {
		log.error(e)
	}

	const obj = {
		name: fileName,
		size: fileSize,
		mime: fileMime,
		key: fileKey,
		lastModified: fileLastModified
	}

	if (typeof obj.name == "string" && obj.name.length >= 1) {
		memoryCache.set(cacheKey, obj)
	}

	return obj
}

export const decryptFolderNamePrivateKey = async (metadata: string, privateKey: any): Promise<string> => {
	if (metadata.toLowerCase() == "default") {
		return "Default"
	}

	const cacheKey = "decryptFolderNamePrivateKey:" + metadata

	if (memoryCache.has(cacheKey)) {
		return memoryCache.get(cacheKey)
	}

	let folderName = ""

	try {
		const decrypted = await window.crypto.subtle.decrypt(
			{
				name: "RSA-OAEP"
			},
			privateKey,
			base64ToArrayBuffer(metadata)
		)

		folderName = striptags(JSON.parse(textDecoder.decode(decrypted)).name)
	} catch (e) {
		log.error(e)
	}

	if (typeof folderName == "string" && folderName.length > 0) {
		memoryCache.set(cacheKey, folderName)
	}

	return folderName
}

export const decryptFileMetadataPrivateKey = async (metadata: string, privateKey: any): Promise<RemoteFileMetadata> => {
	const cacheKey = "decryptFileMetadataPrivateKey:" + metadata

	if (memoryCache.has(cacheKey)) {
		return memoryCache.get(cacheKey)
	}

	let fileName = ""
	let fileSize = 0
	let fileMime = ""
	let fileKey = ""
	let fileLastModified = 0

	try {
		let decrypted: any = await window.crypto.subtle.decrypt(
			{
				name: "RSA-OAEP"
			},
			privateKey,
			base64ToArrayBuffer(metadata)
		)

		decrypted = JSON.parse(textDecoder.decode(decrypted))

		if (decrypted && typeof decrypted == "object") {
			fileName = striptags(decrypted.name)
			fileSize = parseInt(decrypted.size)
			fileMime = striptags(decrypted.mime)
			fileKey = decrypted.key
			fileLastModified = parseInt(decrypted.lastModified)
		}
	} catch (e) {
		log.error(e)
	}

	const obj = {
		name: fileName,
		size: fileSize,
		mime: fileMime,
		key: fileKey,
		lastModified: fileLastModified
	}

	if (typeof obj.name == "string" && obj.name.length >= 1) {
		memoryCache.set(cacheKey, obj)
	}

	return obj
}

export const encryptMetadataPublicKey = async ({ data, publicKey }: { data: string; publicKey: string }): Promise<string> => {
	const pubKey = await window.crypto.subtle.importKey(
		"spki",
		base64ToArrayBuffer(publicKey),
		{
			name: "RSA-OAEP",
			hash: "SHA-512"
		},
		true,
		["encrypt"]
	)
	const encrypted = await window.crypto.subtle.encrypt(
		{
			name: "RSA-OAEP"
		},
		pubKey,
		textEncoder.encode(data)
	)

	return arrayBufferToBase64(encrypted)
}

export const generateKeypair = async (): Promise<{
	publicKey: string
	privateKey: string
}> => {
	const keyPair = await window.crypto.subtle.generateKey(
		{
			name: "RSA-OAEP",
			modulusLength: 4096,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-512"
		},
		true,
		["encrypt", "decrypt"]
	)
	const pubKey = await window.crypto.subtle.exportKey("spki", keyPair.publicKey)
	const b64PubKey = arrayBufferToBase64(pubKey)
	const privKey = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey)
	const b64PrivKey = arrayBufferToBase64(privKey)

	if (b64PubKey.length <= 16 && b64PrivKey.length <= 16) {
		throw new Error("Key lengths invalid")
	}

	return {
		publicKey: b64PubKey,
		privateKey: b64PrivKey
	}
}
