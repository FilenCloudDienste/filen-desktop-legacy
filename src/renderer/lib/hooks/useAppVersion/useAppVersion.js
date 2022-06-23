import React, { useEffect, useState } from "react"
import ipc from "../../ipc"

const log = window.require("electron-log")

const useAppVersion = () => {
    const [data, setData] = useState("1")

	useEffect(() => {
		ipc.getVersion().then((version) => {
            setData(version)
        }).catch(log.error)
	}, [])

	return data
}

export default useAppVersion