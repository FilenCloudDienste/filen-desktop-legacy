import React, { useEffect, useState } from "react"
import useDb from "../useDb"

const useIsOnline = () => {
    const [data, setData] = useState(true)
	const isOnline = useDb("isOnline", true)

	useEffect(() => {
		setData(typeof isOnline == "boolean" ? isOnline : true)
	}, [isOnline])

	return data
}

export default useIsOnline