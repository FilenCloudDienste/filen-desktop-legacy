import { useEffect, useState } from "react"
import eventListener from "../../eventListener"
import db from "../../db"

const log = window.require("electron-log")

const useDb = (dbKey: string, defaultValue: any): any => {
    const [data, setData] = useState<any>(defaultValue)

	useEffect(() => {
		const setListener = eventListener.on("dbSet", ({ key }: { key: string }) => {
			if(key !== dbKey){
				return false
			}

			db.get(dbKey).then((value: any) => {
				if(!value){
					return setData(defaultValue)
				}
	
				if(value == null){
					return setData(defaultValue)
				}
	
				return setData(value)
			}).catch(log.error)
		})

		const clearListener = eventListener.on("dbClear", () => {
			return setData(defaultValue)
		})

		const removeListener = eventListener.on("dbRemove", ({ key }: { key: string }) => {
			if(key !== dbKey){
				return false
			}
			
			return setData(defaultValue)
		})

		db.get(dbKey).then((value: any) => {
			if(!value){
				return setData(defaultValue)
			}

			if(value == null){
				return setData(defaultValue)
			}

			return setData(value)
		}).catch(log.error)

		return () => {
			setListener.remove()
			clearListener.remove()
			removeListener.remove()
		}
	}, [])

	return data
}

export default useDb