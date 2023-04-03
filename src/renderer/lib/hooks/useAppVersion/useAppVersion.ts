import { useEffect, useState } from "react"
import ipc from "../../ipc"

const log = window.require("electron-log")

const useAppVersion = (): string => {
	const [data, setData] = useState<string>("1")

	useEffect(() => {
		ipc.getVersion()
			.then((version: string) => setData(version))
			.catch(log.error)
	}, [])

	return data
}

export default useAppVersion
