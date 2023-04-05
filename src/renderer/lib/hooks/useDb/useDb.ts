import { useEffect, useState, useCallback } from "react"
import eventListener from "../../eventListener"
import db from "../../db"
import memoryCache from "../../memoryCache"

const log = window.require("electron-log")

const useDb = (dbKey: string, defaultValue: any): any => {
	const [data, setData] = useState<any>(defaultValue)

	const fetchDataFromDb = useCallback(async (key: string) => {
		try {
			const value = await db.get(key)

			if (typeof value == "undefined") {
				setData(defaultValue)

				return
			}

			if (value == null) {
				setData(defaultValue)

				return
			}

			setData(value)
		} catch (e) {
			log.error(e)

			setData(defaultValue)
		}
	}, [])

	useEffect(() => {
		const setListener = eventListener.on("dbSet", ({ key }: { key: string }) => {
			if (key !== dbKey) {
				return
			}

			if (memoryCache.has(db.dbCacheKey + key)) {
				memoryCache.delete(db.dbCacheKey + key)
			}

			fetchDataFromDb(key)
		})

		const clearListener = eventListener.on("dbClear", () => setData(defaultValue))

		const removeListener = eventListener.on("dbRemove", ({ key }: { key: string }) => {
			if (key !== dbKey) {
				return
			}

			if (memoryCache.has(db.dbCacheKey + key)) {
				memoryCache.delete(db.dbCacheKey + key)
			}

			setData(defaultValue)
		})

		fetchDataFromDb(dbKey)

		return () => {
			setListener.remove()
			clearListener.remove()
			removeListener.remove()
		}
	}, [])

	return data
}

export default useDb
