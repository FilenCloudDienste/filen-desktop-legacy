import { useEffect, useState, useCallback } from "react"
import eventListener from "../../eventListener"
import db from "../../db"
import memoryCache from "../../memoryCache"

const log = window.require("electron-log")

const useDb = (dbKey: string, defaultValue: any): any => {
    const [data, setData] = useState<any>(defaultValue)

	const fetchDataFromDb = useCallback((key: string) => {
		db.get(key).then((value: any) => {
			if(typeof value == "undefined"){
				return setData(defaultValue)
			}

			if(value == null){
				return setData(defaultValue)
			}

			return setData(value)
		}).catch((err) => {
			log.error(err)

			return setData(defaultValue)
		})
	}, [])

	useEffect(() => {
		const setListener = eventListener.on("dbSet", ({ key }: { key: string }) => {
			if(key !== dbKey){
				return false
			}

			if(memoryCache.has(db.dbCacheKey + key)){
				memoryCache.delete(db.dbCacheKey + key)
			}

			fetchDataFromDb(key)
		})

		const clearListener = eventListener.on("dbClear", () => {
			return setData(defaultValue)
		})

		const removeListener = eventListener.on("dbRemove", ({ key }: { key: string }) => {
			if(key !== dbKey){
				return false
			}

			if(memoryCache.has(db.dbCacheKey + key)){
				memoryCache.delete(db.dbCacheKey + key)
			}
			
			return setData(defaultValue)
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