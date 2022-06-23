import React, { useEffect, useState } from "react"
import eventListener from "../../eventListener"
import db from "../../db"

const log = window.require("electron-log")

const useDb = (dbKey, defaultValue) => {
    const [data, setData] = useState(defaultValue)

	useEffect(() => {
		const setListener = eventListener.on("dbSet", ({ key, value }) => {
			if(key !== dbKey){
				return false
			}

			return setData(value)
		})

		const clearListener = eventListener.on("dbClear", () => {
			return setData(defaultValue)
		})

		const removeListener = eventListener.on("dbRemove", ({ key }) => {
			if(key !== dbKey){
				return false
			}
			
			return setData(defaultValue)
		})

		db.get(dbKey).then((value) => {
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