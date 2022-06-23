import React, { useEffect, useState } from "react"
import useDb from "../useDb"

const useSyncLocations = () => {
    let asyncUserId = 0
    const [data, setData] = useState([])
    const syncLocations = useDb("syncLocations:" + asyncUserId, [])
    const userId = useDb("userId", 0)

	useEffect(() => {
		if(typeof userId == "number" && userId !== 0){
            asyncUserId = userId
        }
	}, [userId])

    useEffect(() => {
        if(Array.isArray(syncLocations)){
            setData(syncLocations)
        }
    }, [syncLocations])

	return data
}

export default useSyncLocations