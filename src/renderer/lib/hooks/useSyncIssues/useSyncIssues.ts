import { useEffect, useState, useCallback } from "react"
import ipc from "../../ipc"
import { SyncIssue } from "../../../../types"

const useSyncIssues = (): SyncIssue[] => {
	const [data, setData] = useState<SyncIssue[]>([])

	const fetchIssues = useCallback(() => {
		ipc.getSyncIssues().then(setData).catch(console.error)
	}, [])

	useEffect(() => {
		fetchIssues()

		const interval = setInterval(fetchIssues, 1000)

		return () => {
			clearInterval(interval)
		}
	}, [])

	return data
}

export default useSyncIssues
