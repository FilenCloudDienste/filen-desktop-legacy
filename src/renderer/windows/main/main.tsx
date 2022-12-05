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
import { sizeOverheadMultiplier } from "../../lib/constants"
import UpdateModal from "../../components/UpdateModal"
import MaxStorageModal from "../../components/MaxStorageModal"
import useIsOnline from "../../lib/hooks/useIsOnline"
import useAsyncState from "../../lib/hooks/useAsyncState"
import { Semaphore, calcSpeed, calcTimeLeft } from "../../lib/helpers"

const log = window.require("electron-log")
const { ipcRenderer } = window.require("electron")

const stateMutex = new Semaphore(32)

export interface TransferProgress {
    uuid: string,
    bytes: number
}

const MainWindow = memo(({ userId, email, windowId }: { userId: number, email: string, windowId: string }) => {
    const darkMode: boolean = useDarkMode()
    const lang: string = useLang()
    const platform: string = usePlatform()
    const isOnline: boolean = useIsOnline()

    const [currentUploads, setCurrentUploads] = useAsyncState<any>({})
    const [currentDownloads, setCurrentDownloads] = useAsyncState<any>({})
    const [doneTasks, setDoneTasks] = useAsyncState<any>([])
    const [runningTasks, setRunningTasks] = useAsyncState<any>([])
    const [activity, setActivity] = useState<any>([])
    const [totalRemaining, setTotalRemaining] = useState<number>(0)
    const [acquiringLock, setAcquiringLock] = useState<boolean>(false)
    const [checkingChanges, setCheckingChanges] = useState<boolean>(false)
    const [syncTasksToDo, setSyncTasksToDo] = useState<number>(0)
    
    const acquiringLockTimeout = useRef<any>(undefined)
    const bytesSent = useRef<number>(0)
    const allBytes = useRef<number>(0)
    const progressStarted = useRef<number>(-1)

    const setDoneTasksThrottled = useCallback(debounce(({ doneTasks }) => {
        if(doneTasks.length > 0){
            db.set("doneTasks:" + userId, doneTasks.slice(0, 1024)).catch(log.error)
        }
    }, 5000), [])

    const throttleActivityUpdate = useCallback(throttle(({ doneTasks, runningTasks, currentUploads, currentDownloads }) => {
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
    }, 500), [])

    const throttleTotalRemainingUpdate = useCallback(throttle(() => {
        if(progressStarted.current > 0 && allBytes.current > 0 && bytesSent.current > 0){
            setTotalRemaining(calcTimeLeft(bytesSent.current, allBytes.current, progressStarted.current))
        }
    }, 1000), [])

    useEffect(() => {
        setDoneTasksThrottled({ doneTasks })
    }, [doneTasks])

    useEffect(() => {
        throttleActivityUpdate({ doneTasks, runningTasks, currentUploads, currentDownloads })
        throttleTotalRemainingUpdate()
    }, [doneTasks, runningTasks, currentUploads, currentDownloads])

    useEffect(() => {
        db.get("doneTasks:" + userId).then((result) => {
            if(Array.isArray(result)){
                setDoneTasks(result)
            }
        }).catch(log.error)

        const syncTaskListener = eventListener.on("syncTask", async (data: any) => {
            await stateMutex.acquire()

            const type: string = data.type
            const task: any = data.data

            const now: number = new Date().getTime()
            
            if(type == "uploadToRemote"){
                if(task.err){
                    await setCurrentUploads((prev: any) => Object.keys(prev).filter(key => key !== task.task.item.uuid).reduce((current, key) => Object.assign(current, { [key]: prev[key] }), {}))
                    await setRunningTasks((prev: any) => [...prev.filter((item: any) => item.task.uuid !== task.task.uuid)])
                }
                else{
                    if(task.status == "start" && task.task.type == "file"){
                        if(progressStarted.current == -1){
                            progressStarted.current = now
                        }
                        else{
                            if(now < progressStarted.current){
                                progressStarted.current = now
                            }
                        }

                        allBytes.current += Math.floor((task.task.item.size || 0) * sizeOverheadMultiplier)

                        await setCurrentUploads((prev: any) => ({
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
                    }
                    else if(task.status == "started"){
                        if(task.task.type == "file"){
                            await setCurrentUploads((prev: any) => Object.keys(prev).filter(key => key == task.task.item.uuid).length > 0 ? ({
                                ...prev,
                                [task.task.item.uuid]: {
                                    ...prev[task.task.item.uuid],
                                    started: now,
                                    lastTime: now,
                                    timestamp: now
                                }
                            }) : prev)
                        }
                        else{
                            await setRunningTasks((prev: any) => [...[{
                                type,
                                task: {
                                    ...task.task,
                                },
                                location: task.location,
                                timestamp: now
                            }], ...prev])
                        }
                    }
                    else if(task.status == "done"){
                        await setCurrentUploads((prev: any) => Object.keys(prev).filter(key => key !== task.task.item.uuid).reduce((current, key) => Object.assign(current, { [key]: prev[key] }), {}))
                        await setRunningTasks((prev: any) => [...prev.filter((item: any) => item.task.uuid !== task.task.uuid)])
                        await setDoneTasks((prev: any) => [...[{
                            type,
                            task: {
                                ...task.task,
                            },
                            location: task.location,
                            timestamp: now
                        }], ...prev])
                    }
                }
            }
            else if(type == "downloadFromRemote"){
                if(task.err){
                    await setCurrentDownloads((prev: any) => Object.keys(prev).filter(key => key !== task.task.item.uuid).reduce((current, key) => Object.assign(current, { [key]: prev[key] }), {}))
                    await setRunningTasks((prev: any) => [...prev.filter((item: any) => item.task.uuid !== task.task.uuid)])
                }
                else{
                    if(task.status == "start"  && task.task.type == "file"){
                        if(progressStarted.current == -1){
                            progressStarted.current = now
                        }
                        else{
                            if(now < progressStarted.current){
                                progressStarted.current = now
                            }
                        }

                        allBytes.current += (task.task.item.metadata.size || 0)

                        await setCurrentDownloads((prev: any) => ({
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
                    }
                    else if(task.status == "started"){
                        if(task.task.type == "file"){
                            await setCurrentDownloads((prev: any) => Object.keys(prev).filter(key => key == task.task.item.uuid).length > 0 ? ({
                                ...prev,
                                [task.task.item.uuid]: {
                                    ...prev[task.task.item.uuid],
                                    started: now,
                                    lastTime: now,
                                    timestamp: now
                                }
                            }) : prev)
                        }
                        else{
                            await setRunningTasks((prev: any) => [...[{
                                type,
                                task: {
                                    ...task.task,
                                },
                                location: task.location,
                                timestamp: now
                            }], ...prev])
                        }
                    }
                    else if(task.status == "done"){
                        await setCurrentDownloads((prev: any) => Object.keys(prev).filter(key => key !== task.task.item.uuid).reduce((current, key) => Object.assign(current, { [key]: prev[key] }), {}))
                        await setRunningTasks((prev: any) => [...prev.filter((item: any) => item.task.uuid !== task.task.uuid)])
                        await setDoneTasks((prev: any) => [...[{
                            type,
                            task: {
                                ...task.task,
                            },
                            location: task.location,
                            timestamp: now
                        }], ...prev])
                    }
                }
            }
            else{
                if(task.err){
                    await setRunningTasks((prev: any) => [...prev.filter((item: any) => item.task.uuid !== task.task.uuid)])
                }
                else{
                    if(task.status == "start"){
                        await setRunningTasks((prev: any) => [...[{
                            type,
                            task: {
                                ...task.task,
                            },
                            location: task.location,
                            timestamp: now
                        }], ...prev])
                    }
                    else if(task.status == "done"){
                        await setRunningTasks((prev: any) => [...prev.filter((item: any) => item.task.uuid !== task.task.uuid)])
                        await setDoneTasks((prev: any) => [...[{
                            type,
                            task: {
                                ...task.task,
                            },
                            location: task.location,
                            timestamp: now
                        }], ...prev])
                    }
                }
            }

            stateMutex.release()
        })

        const uploadProgressListener = eventListener.on("uploadProgress", async (data: TransferProgress) => {
            await stateMutex.acquire()

            const now: number = new Date().getTime()

            await setCurrentUploads((prev: any) => Object.keys(prev).filter(key => key == data.uuid).length > 0 ? ({
                ...prev,
                [data.uuid]: {
                    ...prev[data.uuid],
                    percent: ((prev[data.uuid].bytes + data.bytes) / Math.floor((prev[data.uuid].item.size || 0) * sizeOverheadMultiplier)) * 100,
                    lastBps: calcSpeed(now, prev[data.uuid].started, (prev[data.uuid].bytes + data.bytes)),
                    lastTime: now,
                    bytes: prev[data.uuid].bytes + data.bytes,
                    timeLeft: calcTimeLeft((prev[data.uuid].bytes + data.bytes), Math.floor((prev[data.uuid].item.size || 0) * sizeOverheadMultiplier), prev[data.uuid].started)
                }
            }) : prev)

            bytesSent.current += data.bytes

            stateMutex.release()
        })

        const downloadProgressListener = eventListener.on("downloadProgress", async (data: TransferProgress) => {
            await stateMutex.acquire()

            const now: number = new Date().getTime()

            await setCurrentDownloads((prev: any) => Object.keys(prev).filter(key => key == data.uuid).length > 0 ? ({
                ...prev,
                [data.uuid]: {
                    ...prev[data.uuid],
                    percent: ((prev[data.uuid].bytes + data.bytes) / (prev[data.uuid].item.metadata.size || 0)) * 100,
                    lastBps: calcSpeed(now, prev[data.uuid].started, (prev[data.uuid].bytes + data.bytes)),
                    lastTime: now,
                    bytes: prev[data.uuid].bytes + data.bytes,
                    timeLeft: calcTimeLeft((prev[data.uuid].bytes + data.bytes), (prev[data.uuid].item.metadata.size || 0), prev[data.uuid].started)
                }
            }) : prev)

            bytesSent.current += data.bytes

            stateMutex.release()
        })

        const syncStatusListener = eventListener.on("syncStatus", async (data: any) => {
            await stateMutex.acquire()

            const type: string = data.type

            if(type == "init"){
                bytesSent.current = 0
                progressStarted.current = -1
                allBytes.current = 0

                await setCurrentUploads({})
                await setCurrentDownloads({})
                await setRunningTasks([])

                setTotalRemaining(0)
            }
            else if(type == "acquireSyncLock"){
                if(data.data.status == "start"){
                    acquiringLockTimeout.current = setTimeout(() => setAcquiringLock(true), 3000)
                }
                else{
                    setAcquiringLock(false)
                    clearTimeout(acquiringLockTimeout.current)
                }
            }
            else if(type == "sync" || type == "cleanup" || type == "releaseSyncLock"){
                setAcquiringLock(false)
                clearTimeout(acquiringLockTimeout.current)
                setCheckingChanges(false)
            }
            else if(type == "dataChanged"){
                setCheckingChanges(true)
            }

            stateMutex.release()
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
            {
                platform == "linux" && (
                    <Titlebar
                        darkMode={darkMode}
                        lang={lang}
                        platform={platform}
                        title=""
                    />
                )
            }
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
                acquiringLock={acquiringLock}
                checkingChanges={checkingChanges}
            />
            <IsOnlineBottomToast
                userId={userId}
                email={email}
                platform={platform}
                darkMode={darkMode}
                lang={lang}
            />
            <UpdateModal
                platform={platform}
                darkMode={darkMode}
                lang={lang}
            />
            <MaxStorageModal
                platform={platform}
                darkMode={darkMode}
                lang={lang}
            />
        </Container>
    )
})

export default MainWindow