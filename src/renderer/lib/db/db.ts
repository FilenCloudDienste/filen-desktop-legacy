import ipc from "../ipc"
import memoryCache from "../memoryCache"
import eventListener from "../eventListener"
import { sendToAllPorts } from "../worker/ipc"

const USE_MEMORY_CACHE: boolean = true
const MEMORY_CACHE_KEY: string = "db:"

if (USE_MEMORY_CACHE) {
	eventListener.on("dbSet", ({ key }: { key: string }) => memoryCache.delete(MEMORY_CACHE_KEY + key))

	eventListener.on("dbClear", () => {
		memoryCache.cache.forEach((_, key) => {
			if (key.indexOf(MEMORY_CACHE_KEY) !== -1) {
				memoryCache.delete(key)
			}
		})
	})

	eventListener.on("dbRemove", ({ key }: { key: string }) => memoryCache.delete(MEMORY_CACHE_KEY + key))
}

export const get = async (key: string): Promise<any> => {
	if (USE_MEMORY_CACHE) {
		if (memoryCache.has(MEMORY_CACHE_KEY + key)) {
			return memoryCache.get(MEMORY_CACHE_KEY + key)
		}
	}

	const value = await ipc.db("get", key)

	if (USE_MEMORY_CACHE && value !== null) {
		memoryCache.set(MEMORY_CACHE_KEY + key, value)
	}

	return value
}

export const set = async (key: string, value: any): Promise<void> => {
	await ipc.db("set", key, value)

	if (USE_MEMORY_CACHE) {
		memoryCache.set(MEMORY_CACHE_KEY + key, value)
	}

	sendToAllPorts({
		type: "dbSet",
		data: {
			key
		}
	})
}

export const remove = async (key: string): Promise<void> => {
	await ipc.db("remove", key)

	if (USE_MEMORY_CACHE) {
		memoryCache.delete(MEMORY_CACHE_KEY + key)
	}

	sendToAllPorts({
		type: "dbRemove",
		data: {
			key
		}
	})
}

export const clear = async (): Promise<void> => {
	await ipc.db("clear")

	if (USE_MEMORY_CACHE) {
		memoryCache.cache.forEach((_, key) => {
			if (key.startsWith(MEMORY_CACHE_KEY)) {
				memoryCache.delete(key)
			}
		})
	}

	sendToAllPorts({
		type: "dbclear"
	})
}

export const keys = async (): Promise<string[]> => {
	return await ipc.db("keys")
}

const db = {
	get,
	set,
	remove,
	clear,
	keys,
	dbCacheKey: MEMORY_CACHE_KEY
}

export default db
