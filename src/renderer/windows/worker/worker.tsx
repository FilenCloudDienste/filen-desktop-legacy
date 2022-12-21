import { memo, useEffect, useRef, useState, useCallback } from "react"
import { listen } from "../../lib/worker/ipc"
import sync from "../../lib/worker/sync"
import { updateKeys } from "../../lib/user"
import db from "../../lib/db"
import useIsOnline from "../../lib/hooks/useIsOnline"
import ipc from "../../lib/ipc"
import useDb from "../../lib/hooks/useDb"
import eventListener from "../../lib/eventListener"
import useAppVersion from "../../lib/hooks/useAppVersion"
import type { Location, SyncIssue } from "../../../types"
import { listen as socketListen } from "../../lib/worker/socket"
import { debounce } from "lodash"
import { initLocalTrashDirs } from "../../lib/fs/local"

const log = window.require("electron-log")
const https = window.require("https")

const checkInternet = async (): Promise<any> => {
    if(!window.navigator.onLine){
        await db.set("isOnline", false).catch(log.error)

        return setTimeout(checkInternet, 3000)
    }

    const req = https.request({
        method: "GET",
        hostname: "api.filen.io",
        path: "/",
        timeout: 15000,
        headers: {
            "User-Agent": "filen-desktop"
        },
        agent: new https.Agent({
            timeout: 15000
        })
    }, async (response: any) => {
        if(response.statusCode !== 200){
            await db.set("isOnline", false).catch(log.error)

            return setTimeout(checkInternet, 3000)
        }

        const res: Buffer[] = []

        response.on("error", async () => {
            await db.set("isOnline", false).catch(log.error)

            return setTimeout(checkInternet, 3000)
        })

        response.on("data", (chunk: Buffer) => {
            return res.push(chunk)
        })

        response.on("end", async () => {
            try{
                const str = Buffer.concat(res).toString()
            
                if(str.indexOf("Invalid endpoint") == -1){
                    await db.set("isOnline", false).catch(log.error)
        
                    return setTimeout(checkInternet, 3000)
                }
        
                await db.set("isOnline", true).catch(log.error)

                return setTimeout(checkInternet, 3000)
            }
            catch(e){
                log.error(e)

                await db.set("isOnline", false).catch(log.error)
            }

            return setTimeout(checkInternet, 3000)
        })
    })

    req.on("error", async () => {
        await db.set("isOnline", false).catch(log.error)

        return setTimeout(checkInternet, 3000)
    })

    return req.end()
}

const WorkerWindow = memo(() => {
    const initDone = useRef<boolean>(false)
    const isOnline: boolean = useIsOnline()
    const syncIssues: any = useDb("syncIssues", [])
    const paused: boolean = useDb("paused", false)
    const [runningSyncTasks, setRunningSyncTasks] = useState<number>(0)
    const appVersion: string = useAppVersion()
    const isLoggedIn: boolean = useDb("isLoggedIn", false)

    const init = async (): Promise<any> => {
        if(initDone.current){
            return false
        }

        await new Promise((resolve) => {
            const wait = async (): Promise<any> => {
                if(!isOnline){
                    return setTimeout(wait, 100)
                }

                try{
                    const loggedIn: boolean | null = await db.get("isLoggedIn")

                    if(loggedIn && isOnline){
                        return resolve(true)
                    }
                }
                catch(e){
                    log.error(e)
                }

                return setTimeout(wait, 100)
            }

            return wait()
        })

        if(!initDone.current){
            initDone.current = true

            socketListen()

            updateKeys().then(() => {
                Promise.all([
                    db.set("paused", false),
                    db.set("syncIssues", []),
                    db.set("maxStorageReached", false),
                    db.set("suspend", false),
                    db.set("uploadPaused", false),
                    db.set("downloadPaused", false),
                    db.set("isOnline", true)
                ]).then(() => {
                    sync()
                    initLocalTrashDirs()
                }).catch((err) => {
                    log.error(err)
                })
            }).catch((err) => {
                log.error(err)
            })
        }
    }

    const updateTray = useCallback((icon: "paused" | "error" | "sync" | "normal", message: string) => {
        ipc.updateTrayIcon(icon)
        ipc.updateTrayTooltip("Filen v" + appVersion + "\n" + message)
    }, [appVersion])

    const processTray = useCallback(debounce((isLoggedIn: boolean, isOnline: boolean, paused: boolean, syncIssues: SyncIssue[], runningSyncTasks: number) => {
        if(!isLoggedIn){
            updateTray("paused", "Please login")
        }
        else{
            if(!isOnline){
                updateTray("error", "You are offline")
            }
            else{
                if(paused){
                    updateTray("paused", "Paused")
                }
                else{
                    if(syncIssues.length > 0){
                        updateTray("error", syncIssues.length + " sync issues")
                    }
                    else{
                        if(runningSyncTasks > 0){
                            updateTray("sync", "Syncing " + runningSyncTasks + " items")
                        }
                        else{
                            db.get("userId").then((userId: number) => {
                                db.get("syncLocations:" + userId).then((syncLocations: any) => {
                                    if(Array.isArray(syncLocations) && syncLocations.length > 0 && syncLocations.filter(item => typeof item.remoteUUID == "string").length > 0){
                                        updateTray("normal", "Everything synced")
                                    }
                                    else{
                                        updateTray("paused", "No sync locations setup yet")
                                    }
                                }).catch((err) => {
                                    log.error(err)

                                    updateTray("normal", "Everything synced")
                                })
                            }).catch((err) => {
                                log.error(err)

                                updateTray("normal", "Everything synced")         
                            })
                        }
                    }
                }
            }
        }
    }, 250), [appVersion])

    useEffect(() => {
        processTray(isLoggedIn, isOnline, paused, syncIssues, runningSyncTasks)
    }, [isLoggedIn, isOnline, paused, syncIssues, runningSyncTasks])

    useEffect(() => {
        (async () => {
            if(!paused){
                try{
                    const userId: number | null = await db.get("userId")
                    let currentSyncLocations: Location[] | null = await db.get("syncLocations:" + userId)
    
                    if(!Array.isArray(currentSyncLocations)){
                        currentSyncLocations = []
                    }
    
                    for(let i = 0; i < currentSyncLocations.length; i++){
                        await Promise.all([
                            db.set("localDataChanged:" + currentSyncLocations[i].uuid, true),
                            db.set("remoteDataChanged:" + currentSyncLocations[i].uuid, true)
                        ])
                    }
                }
                catch(e){
                    log.error(e)
                }
            }
        })()
    }, [paused])

    useEffect(() => {
        const offlineListener = (): void => {
            db.set("isOnline", false).catch(log.error)
        }

        window.addEventListener("offline", offlineListener)

        const syncTasksToDoListener = eventListener.on("syncTasksToDo", setRunningSyncTasks)

        listen()
        init()
        checkInternet()

        return () => {
            window.removeEventListener("offline", offlineListener)
            syncTasksToDoListener.remove()
		}
    }, [])

    return null
})

export default WorkerWindow