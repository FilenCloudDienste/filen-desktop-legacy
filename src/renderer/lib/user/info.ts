import { userInfo } from "../api"
import memoryCache from "../memoryCache"
import { Semaphore } from "../helpers"

export interface UserInfoV1 {
	id: number
	email: string
	isPremium: number
	maxStorage: number
	storageUsed: number
	avatarURL: string
}

const fetchUserInfoSemaphore = new Semaphore(1)

export const fetchUserInfo = async (): Promise<UserInfoV1> => {
	await fetchUserInfoSemaphore.acquire()

	try {
		if (memoryCache.has("fetchUserInfo") && memoryCache.has("fetchUserInfoTimeout")) {
			if (memoryCache.get("fetchUserInfoTimeout") > Date.now()) {
				fetchUserInfoSemaphore.release()

				return memoryCache.get("fetchUserInfo") as UserInfoV1
			}
		}

		const info: UserInfoV1 = await userInfo()

		memoryCache.set("fetchUserInfo", info)
		memoryCache.set("fetchUserInfoTimeout", Date.now() + 60000)

		fetchUserInfoSemaphore.release()

		return info
	} catch (e) {
		fetchUserInfoSemaphore.release()

		throw e
	}
}

export const fetchUserInfoCached = (): UserInfoV1 | undefined => {
	if (memoryCache.has("fetchUserInfo")) {
		return memoryCache.get("fetchUserInfo") as UserInfoV1
	}

	return undefined
}

export const remoteStorageLeft = async (): Promise<number> => {
	try {
		const info = await fetchUserInfo()

		return info.maxStorage - info.storageUsed
	} catch (e) {
		console.error(e)

		return 0
	}
}
