import React, { memo, useState, useEffect, useCallback, useRef } from "react"
import useDarkMode from "../../lib/hooks/useDarkMode"
import useLang from "../../lib/hooks/useLang"
import usePlatform from "../../lib/hooks/usePlatform"
import Container from "../../components/Container"
import eventListener from "../../lib/eventListener"
import db from "../../lib/db"
import Titlebar from "../../components/Titlebar"
import IsOnlineBottomToast from "../../components/IsOnlineBottomToast"
import MainFooter from "../../components/MainFooter"
import MainList from "../../components/MainList"
import MainHeader from "../../components/MainHeader"
import { throttle, debounce } from "lodash"
import constants from "../../../constants.json"
import MaxStorageModal from "../../components/MaxStorageModal"
import useIsOnline from "../../lib/hooks/useIsOnline"
import { calcSpeed, calcTimeLeft } from "../../lib/helpers"
import ipc from "../../lib/ipc"

const log = window.require("electron-log")
const { ipcRenderer } = window.require("electron")

export interface TransferProgress {
	uuid: string
	bytes: number
}

const MainWindow = memo(({ userId, email, windowId }: { userId: number; email: string; windowId: string }) => {
	const darkMode: boolean = useDarkMode()
	const lang: string = useLang()
	const platform: string = usePlatform()
	const isOnline: boolean = useIsOnline()

	const [currentUploads, setCurrentUploads] = useState<any>({})
	const [currentDownloads, setCurrentDownloads] = useState<any>({})
	const [doneTasks, setDoneTasks] = useState<any>([])
	const [runningTasks, setRunningTasks] = useState<any>([])
	const [activity, setActivity] = useState<any>([])
	const [totalRemaining, setTotalRemaining] = useState<number>(0)
	const [checkingChanges, setCheckingChanges] = useState<boolean>(false)
	const [syncTasksToDo, setSyncTasksToDo] = useState<number>(0)
	const [isTrayAvailable, setIsTrayAvailable] = useState<boolean>(true)

	const bytesSent = useRef<number>(0)
	const allBytes = useRef<number>(0)
	const progressStarted = useRef<number>(-1)

	const setDoneTasksThrottled = useCallback(
		debounce(({ doneTasks }) => {
			if (doneTasks.length > 0) {
				db.set("doneTasks:" + userId, doneTasks.slice(0, 1024)).catch(log.error)
			}
		}, 2500),
		[]
	)

	const throttleActivityUpdate = useCallback(
		throttle(({ doneTasks, runningTasks, currentUploads, currentDownloads }) => {
			setActivity([
				...Object.keys(currentUploads).map((key: string) => ({
					type: "uploadToRemote",
					realtime: true,
					task: currentUploads[key],
					location: currentUploads[key].location,
					timestamp: currentUploads[key].timestamp
				})),
				...Object.keys(currentDownloads).map((key: string) => ({
					type: "downloadFromRemote",
					realtime: true,
					task: currentDownloads[key],
					location: currentDownloads[key].location,
					timestamp: currentDownloads[key].timestamp
				})),
				...runningTasks.map((task: any) => ({
					...task,
					running: true,
					timestamp: task.timestamp
				})),
				...doneTasks.map((task: any) => ({
					...task,
					done: true,
					timestamp: task.timestamp
				}))
			])
		}, 100),
		[]
	)

	const throttleTotalRemainingUpdate = useCallback(
		throttle(() => {
			if (progressStarted.current > 0 && allBytes.current > 0 && bytesSent.current > 0) {
				setTotalRemaining(calcTimeLeft(bytesSent.current, allBytes.current, progressStarted.current))
			}
		}, 1000),
		[]
	)

	useEffect(() => {
		ipc.trayAvailable().then(setIsTrayAvailable).catch(console.error)
	}, [])

	useEffect(() => {
		setDoneTasksThrottled({ doneTasks })
	}, [doneTasks])

	useEffect(() => {
		throttleActivityUpdate({ doneTasks, runningTasks, currentUploads, currentDownloads })
		throttleTotalRemainingUpdate()
	}, [doneTasks, runningTasks, currentUploads, currentDownloads])

	useEffect(() => {
		db.get("doneTasks:" + userId)
			.then(result => {
				if (Array.isArray(result)) {
					setDoneTasks(result)
				}
			})
			.catch(log.error)

		const syncTaskListener = eventListener.on("syncTask", (data: any) => {
			const type: string = data.type
			const task: any = data.data

			const now: number = Date.now()

			if (type == "uploadToRemote") {
				if (task.err) {
					setCurrentUploads((prev: any) =>
						Object.keys(prev)
							.filter(key => key !== task.task.item.uuid)
							.reduce((current, key) => Object.assign(current, { [key]: prev[key] }), {})
					)
					setRunningTasks((prev: any) => [...prev.filter((item: any) => item.task.uuid !== task.task.uuid)])
				} else {
					if (task.status == "start" && task.task.type == "file") {
						if (progressStarted.current == -1) {
							progressStarted.current = now
						} else {
							if (now < progressStarted.current) {
								progressStarted.current = now
							}
						}

						allBytes.current += Math.floor((task.task.item.size || 0) * constants.sizeOverheadMultiplier)

						setCurrentUploads((prev: any) => ({
							...prev,
							[task.task.item.uuid]: {
								...task.task,
								location: task.location,
								started: now,
								bytes: 0,
								percent: 0,
								lastTime: now,
								lastBps: 0,
								timeLeft: 0,
								timestamp: now
							}
						}))
					} else if (task.status == "started") {
						if (task.task.type == "file") {
							setCurrentUploads((prev: any) =>
								Object.keys(prev).filter(key => key == task.task.item.uuid).length > 0
									? {
											...prev,
											[task.task.item.uuid]: {
												...prev[task.task.item.uuid],
												started: now,
												lastTime: now,
												timestamp: now
											}
									  }
									: prev
							)
						} else {
							setRunningTasks((prev: any) => [
								...[
									{
										type,
										task: {
											...task.task
										},
										location: task.location,
										timestamp: now
									}
								],
								...prev
							])
						}
					} else if (task.status == "done") {
						setCurrentUploads((prev: any) =>
							Object.keys(prev)
								.filter(key => key !== task.task.item.uuid)
								.reduce((current, key) => Object.assign(current, { [key]: prev[key] }), {})
						)
						setRunningTasks((prev: any) => [...prev.filter((item: any) => item.task.uuid !== task.task.uuid)])
						setDoneTasks((prev: any) => [
							...[
								{
									type,
									task: {
										...task.task
									},
									location: task.location,
									timestamp: now
								}
							],
							...prev
						])
					}
				}
			} else if (type == "downloadFromRemote") {
				if (task.err) {
					setCurrentDownloads((prev: any) =>
						Object.keys(prev)
							.filter(key => key !== task.task.item.uuid)
							.reduce((current, key) => Object.assign(current, { [key]: prev[key] }), {})
					)
					setRunningTasks((prev: any) => [...prev.filter((item: any) => item.task.uuid !== task.task.uuid)])
				} else {
					if (task.status == "start" && task.task.type == "file") {
						if (progressStarted.current == -1) {
							progressStarted.current = now
						} else {
							if (now < progressStarted.current) {
								progressStarted.current = now
							}
						}

						allBytes.current += task.task.item.metadata.size || 0

						setCurrentDownloads((prev: any) => ({
							...prev,
							[task.task.item.uuid]: {
								...task.task,
								location: task.location,
								started: now,
								bytes: 0,
								percent: 0,
								lastTime: now,
								lastBps: 0,
								timeLeft: 0,
								timestamp: now
							}
						}))
					} else if (task.status == "started") {
						if (task.task.type == "file") {
							setCurrentDownloads((prev: any) =>
								Object.keys(prev).filter(key => key == task.task.item.uuid).length > 0
									? {
											...prev,
											[task.task.item.uuid]: {
												...prev[task.task.item.uuid],
												started: now,
												lastTime: now,
												timestamp: now
											}
									  }
									: prev
							)
						} else {
							setRunningTasks((prev: any) => [
								...[
									{
										type,
										task: {
											...task.task
										},
										location: task.location,
										timestamp: now
									}
								],
								...prev
							])
						}
					} else if (task.status == "done") {
						setCurrentDownloads((prev: any) =>
							Object.keys(prev)
								.filter(key => key !== task.task.item.uuid)
								.reduce((current, key) => Object.assign(current, { [key]: prev[key] }), {})
						)
						setRunningTasks((prev: any) => [...prev.filter((item: any) => item.task.uuid !== task.task.uuid)])
						setDoneTasks((prev: any) => [
							...[
								{
									type,
									task: {
										...task.task
									},
									location: task.location,
									timestamp: now
								}
							],
							...prev
						])
					}
				}
			} else {
				if (task.err) {
					setRunningTasks((prev: any) => [...prev.filter((item: any) => item.task.uuid !== task.task.uuid)])
				} else {
					if (task.status == "start") {
						setRunningTasks((prev: any) => [
							...[
								{
									type,
									task: {
										...task.task
									},
									location: task.location,
									timestamp: now
								}
							],
							...prev
						])
					} else if (task.status == "done") {
						setRunningTasks((prev: any) => [...prev.filter((item: any) => item.task.uuid !== task.task.uuid)])
						setDoneTasks((prev: any) => [
							...[
								{
									type,
									task: {
										...task.task
									},
									location: task.location,
									timestamp: now
								}
							],
							...prev
						])
					}
				}
			}
		})

		const uploadProgressListener = eventListener.on("uploadProgress", (data: TransferProgress) => {
			const now: number = Date.now()

			setCurrentUploads((prev: any) =>
				Object.keys(prev).filter(key => key == data.uuid).length > 0
					? {
							...prev,
							[data.uuid]: {
								...prev[data.uuid],
								percent:
									((prev[data.uuid].bytes + data.bytes) /
										Math.floor((prev[data.uuid].item.size || 0) * constants.sizeOverheadMultiplier)) *
									100,
								lastBps: calcSpeed(now, prev[data.uuid].started, prev[data.uuid].bytes + data.bytes),
								lastTime: now,
								bytes: prev[data.uuid].bytes + data.bytes,
								timeLeft: calcTimeLeft(
									prev[data.uuid].bytes + data.bytes,
									Math.floor((prev[data.uuid].item.size || 0) * constants.sizeOverheadMultiplier),
									prev[data.uuid].started
								)
							}
					  }
					: prev
			)

			bytesSent.current += data.bytes
		})

		const downloadProgressListener = eventListener.on("downloadProgress", (data: TransferProgress) => {
			const now: number = Date.now()

			setCurrentDownloads((prev: any) =>
				Object.keys(prev).filter(key => key == data.uuid).length > 0
					? {
							...prev,
							[data.uuid]: {
								...prev[data.uuid],
								percent: ((prev[data.uuid].bytes + data.bytes) / (prev[data.uuid].item.metadata.size || 0)) * 100,
								lastBps: calcSpeed(now, prev[data.uuid].started, prev[data.uuid].bytes + data.bytes),
								lastTime: now,
								bytes: prev[data.uuid].bytes + data.bytes,
								timeLeft: calcTimeLeft(
									prev[data.uuid].bytes + data.bytes,
									prev[data.uuid].item.metadata.size || 0,
									prev[data.uuid].started
								)
							}
					  }
					: prev
			)

			bytesSent.current += data.bytes
		})

		const syncStatusListener = eventListener.on("syncStatus", (data: any) => {
			const type: string = data.type

			if (type == "init") {
				bytesSent.current = 0
				progressStarted.current = -1
				allBytes.current = 0

				setCurrentUploads({})
				setCurrentDownloads({})
				setRunningTasks([])

				setTotalRemaining(0)
			} else if (type == "sync" || type == "cleanup") {
				setCheckingChanges(false)
			} else if (type == "dataChanged") {
				setCheckingChanges(true)
			}
		})

		const syncTasksToDoListener = eventListener.on("syncTasksToDo", setSyncTasksToDo)
		const doneTasksClearedListener = eventListener.on("doneTasksCleared", () => setDoneTasks([]))

		ipcRenderer.send("window-ready", windowId)

		return () => {
			syncTaskListener.remove()
			uploadProgressListener.remove()
			downloadProgressListener.remove()
			syncStatusListener.remove()
			doneTasksClearedListener.remove()
			syncTasksToDoListener.remove()
		}
	}, [])

	return (
		<Container
			darkMode={darkMode}
			lang={lang}
			platform={platform}
		>
			{!isTrayAvailable && (
				<Titlebar
					darkMode={darkMode}
					lang={lang}
					platform={platform}
					title=""
				/>
			)}
			<MainHeader
				userId={userId}
				email={email}
				platform={platform}
				darkMode={darkMode}
				lang={lang}
				doneTasks={doneTasks}
				currentUploads={currentUploads}
				currentDownloads={currentDownloads}
			/>
			<MainList
				userId={userId}
				email={email}
				platform={platform}
				darkMode={darkMode}
				lang={lang}
				activity={activity}
				isOnline={isOnline}
			/>
			<MainFooter
				platform={platform}
				darkMode={darkMode}
				lang={lang}
				totalRemaining={totalRemaining}
				syncTasksToDo={syncTasksToDo}
				isOnline={isOnline}
				checkingChanges={checkingChanges}
			/>
			<IsOnlineBottomToast lang={lang} />
			<MaxStorageModal
				platform={platform}
				darkMode={darkMode}
				lang={lang}
			/>
		</Container>
	)
})

export default MainWindow
