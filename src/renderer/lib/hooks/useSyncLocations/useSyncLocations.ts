import { useEffect, useState } from "react"
import useDb from "../useDb"

// @todo: add typings for sync locations

const useSyncLocations = (): any => {
    let asyncUserId = 0
    const [data, setData] = useState<any>([])
    const syncLocations: any = useDb("syncLocations:" + asyncUserId, [])
    const userId = useDb<number>("userId", 0)

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