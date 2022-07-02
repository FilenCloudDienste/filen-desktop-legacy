// @ts-nocheck

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
import useDb from "../../lib/hooks/useDb"
import { throttle } from "lodash"
import { sizeOverheadMultiplier, speedMultiplier } from "../../lib/constants"
import UpdateModal from "../../components/UpdateModal"
import MaxStorageModal from "../../components/MaxStorageModal"
import useIsOnline from "../../lib/hooks/useIsOnline"

const log = window.require("electron-log")
const { ipcRenderer } = window.require("electron")

const MainWindow = memo(({ userId, email, windowId }: { userId: number, email: string, windowId: string }) => {
    const darkMode: boolean = useDarkMode()
    const lang: string = useLang()
    const platform: string = usePlatform()
    const isOnline: boolean = useIsOnline()

    const [currentUploads, setCurrentUploads] = useState<any>({})
    const [currentDownloads, setCurrentDownloads] = useState<any>({})
    const [doneTasks, setDoneTasks] = useState<any>([])
    const [runningTasks, setRunningTasks] = useState<any>([])
    const [activity, setActivity] = useState<any>([])
    const syncLocations: [] = useDb("syncLocations:" + userId, [])
    const paused = useDb("paused", false)
    const [totalRemaining, setTotalRemaining] = useState<number>(0)
    const [acquiringLock, setAcquiringLock] = useState<boolean>(false)
    const [checkingChanges, setCheckingChanges] = useState<boolean>(false)
    
    const acquiringLockTimeout = useRef<any>(undefined)
    const bytesSent = useRef<number>(0)
    const allBytes = useRef<number>(0)
    const progressStarted = useRef<number>(-1)

    const calcSpeed = (now: number, started: number, bytes: number): number => {
        now = new Date().getTime() - 1000

        const secondsDiff: number = ((now - started) / 1000)
        const bps: number = Math.floor((bytes / secondsDiff) * speedMultiplier)

        return bps > 0 ? bps : 0
    }

    const calcTimeLeft = (loadedBytes: number, totalBytes: number, started: number): number => {
        const elapsed: number = (new Date().getTime() - started)
        const speed: number = (loadedBytes / (elapsed / 1000))
        const remaining: number = ((totalBytes - loadedBytes) / speed)

        return remaining > 0 ? remaining : 0
    }

    const setDoneTasksThrottled = useCallback(throttle(({ doneTasks }) => {
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

        const syncTaskListener = eventListener.on("syncTask", (data) => {
            const type: string = data.type
            const task: any = data.data

            const now: number = new Date().getTime()
            
            if(type == "uploadToRemote"){
                if(task.err){
                    setCurrentUploads(prev => Object.keys(prev).filter(key => key !== task.task.item.uuid).reduce((current, key) => Object.assign(current, { [key]: prev[key] }), {}))
                    setRunningTasks(prev => [...prev.filter(item => item.task.uuid !== task.task.uuid)])
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

                        setCurrentUploads(prev => ({
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
                            setCurrentUploads(prev => Object.keys(prev).filter(key => key == task.task.item.uuid).length > 0 ? ({
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
                            setRunningTasks(prev => [...[{
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
                        setCurrentUploads(prev => Object.keys(prev).filter(key => key !== task.task.item.uuid).reduce((current, key) => Object.assign(current, { [key]: prev[key] }), {}))
                        setRunningTasks(prev => [...prev.filter(item => item.task.uuid !== task.task.uuid)])
                        setDoneTasks(prev => [...[{
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
                    setCurrentDownloads(prev => Object.keys(prev).filter(key => key !== task.task.item.uuid).reduce((current, key) => Object.assign(current, { [key]: prev[key] }), {}))
                    setRunningTasks(prev => [...prev.filter(item => item.task.uuid !== task.task.uuid)])
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

                        setCurrentDownloads(prev => ({
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
                            setCurrentDownloads(prev => Object.keys(prev).filter(key => key == task.task.item.uuid).length > 0 ? ({
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
                            setRunningTasks(prev => [...[{
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
                        setCurrentDownloads(prev => Object.keys(prev).filter(key => key !== task.task.item.uuid).reduce((current, key) => Object.assign(current, { [key]: prev[key] }), {}))
                        setRunningTasks(prev => [...prev.filter(item => item.task.uuid !== task.task.uuid)])
                        setDoneTasks(prev => [...[{
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
                    setRunningTasks(prev => [...prev.filter(item => item.task.uuid !== task.task.uuid)])
                }
                else{
                    if(task.status == "start"){
                        setRunningTasks(prev => [...[{
                            type,
                            task: {
                                ...task.task,
                            },
                            location: task.location,
                            timestamp: now
                        }], ...prev])
                    }
                    else if(task.status == "done"){
                        setRunningTasks(prev => [...prev.filter(item => item.task.uuid !== task.task.uuid)])
                        setDoneTasks(prev => [...[{
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
        })

        const uploadProgressListener = eventListener.on("uploadProgress", (data) => {
            const now: number = new Date().getTime()

            setCurrentUploads(prev => Object.keys(prev).filter(key => key == data.uuid).length > 0 ? ({
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
        })

        const downloadProgressListener = eventListener.on("downloadProgress", (data) => {
            const now: number = new Date().getTime()

            setCurrentDownloads(prev => Object.keys(prev).filter(key => key == data.uuid).length > 0 ? ({
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
        })

        const syncStatusListener = eventListener.on("syncStatus", (data) => {
            const type: string = data.type

            if(type == "init"){
                bytesSent.current = 0
                progressStarted.current = -1
                allBytes.current = 0

                setCurrentUploads({})
                setCurrentDownloads({})
                setRunningTasks([])
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
            else if(type == "sync"){
                setAcquiringLock(false)
                clearTimeout(acquiringLockTimeout.current)
                setCheckingChanges(false)
            }
            else if(type == "dataChanged"){
                setCheckingChanges(true)
            }
        })

        ipcRenderer.send("window-ready", windowId)

        return () => {
            syncTaskListener.remove()
            uploadProgressListener.remove()
            downloadProgressListener.remove()
            syncStatusListener.remove()
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
                syncLocations={syncLocations}
                paused={paused}
                isOnline={isOnline}
            />
            <MainFooter
                userId={userId}
                email={email}
                platform={platform}
                darkMode={darkMode}
                lang={lang}
                currentUploads={currentUploads}
                currentDownloads={currentDownloads}
                runningTasks={runningTasks}
                totalRemaining={totalRemaining}
                runningSyncTasks={(runningTasks.length + Object.keys(currentUploads).length + Object.keys(currentDownloads).length)}
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
                userId={userId}
                email={email}
                platform={platform}
                darkMode={darkMode}
                lang={lang}
            />
            <MaxStorageModal
                userId={userId}
                email={email}
                platform={platform}
                darkMode={darkMode}
                lang={lang}
            />
        </Container>
    )
})

export default MainWindow