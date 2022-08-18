import React, { memo, useEffect, useRef, useState } from "react"
import { listen } from "../../lib/worker/ipc"
import sync from "../../lib/worker/sync"
import { updateKeys } from "../../lib/user"
import db from "../../lib/db"
import useIsOnline from "../../lib/hooks/useIsOnline"
import { getAPIServer } from "../../lib/api"
import ipc from "../../lib/ipc"
import useDb from "../../lib/hooks/useDb"
import eventListener from "../../lib/eventListener"
import useAppVersion from "../../lib/hooks/useAppVersion"
import { maxConcurrentSyncTasks } from "../../lib/constants"

const log = window.require("electron-log")
const https = window.require("https")

const checkInternet = (): any => {
    if(!window.navigator.onLine){
        db.set("isOnline", false).catch(log.error)

        return setTimeout(checkInternet, 3000)
    }

    const req = https.request({
        method: "GET",
        hostname: "api.filen.io",
        path: "/",
        timeout: 10000,
        headers: {
            "User-Agent": "filen-desktop"
        },
        agent: new https.Agent({
            timeout: 10000
        })
    }, (response: any) => {
        if(response.statusCode !== 200){
            db.set("isOnline", false).catch(log.error)

            return setTimeout(checkInternet, 3000)
        }

        let res: any = ""

        response.on("error", () => {
            db.set("isOnline", false).catch(log.error)

            res = ""

            return setTimeout(checkInternet, 3000)
        })

        response.on("data", (chunk: any) => {
            res += chunk
        })

        response.on("end", () => {
            if(res.indexOf("Invalid endpoint") == -1){
                db.set("isOnline", false).catch(log.error)
    
                return setTimeout(checkInternet, 3000)
            }

            res = ""
    
            db.set("isOnline", true).catch(log.error)
    
            return setTimeout(checkInternet, 3000)
        })
    })

    req.on("error", () => {
        db.set("isOnline", false).catch(log.error)

        return setTimeout(checkInternet, 3000)
    })

    req.end()
}

const WorkerWindow = memo(() => {
    const initDone = useRef<boolean>(false)
    const isOnline: boolean = useIsOnline()
    const syncIssues: any = useDb("syncIssues", [])
    const paused: boolean = useDb("paused", false)
    const [runningSyncTasks, setRunningSyncTasks] = useState<number>(0)
    const appVersion: string = useAppVersion()
    const isLoggedIn: boolean = useDb("isLoggedIn", true)

    const init = async (): Promise<any> => {
        if(initDone.current){
            return false
        }

        await new Promise((resolve) => {
            const wait = setInterval(async (): Promise<any> => {
                if(!isOnline){
                    return false
                }

                try{
                    var isLoggedIn = await db.get("isLoggedIn")
                }
                catch(e){
                    return log.error(e)
                }

                if(isLoggedIn && isOnline){
                    clearInterval(wait)

                    return resolve(true)
                }
            }, 1000)
        })

        if(!initDone.current){
            initDone.current = true

            setTimeout(() => {
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
                    }).catch((err) => {
                        log.error(err)
                    })
                }).catch((err) => {
                    log.error(err)
                })
            }, 1000)
        }
    }

    useEffect(() => {
        if(!isLoggedIn){
            ipc.updateTrayIcon("paused")
            ipc.updateTrayTooltip("Filen v" + appVersion + "\nPlease login")
        }
        else{
            if(!isOnline){
                ipc.updateTrayIcon("paused")
                ipc.updateTrayTooltip("Filen v" + appVersion + "\nYou are offline")
            }
            else{
                if(paused){
                    ipc.updateTrayIcon("paused")
                    ipc.updateTrayTooltip("Filen v" + appVersion + "\nPaused")
                }
                else{
                    if(syncIssues.length > 0){
                        ipc.updateTrayIcon("error")
                        ipc.updateTrayTooltip("Filen v" + appVersion + "\n" + syncIssues.length + " sync issues")
                    }
                    else{
                        if(runningSyncTasks > 0){
                            ipc.updateTrayIcon("sync")
                            ipc.updateTrayTooltip("Filen v" + appVersion + "\nSyncing " + runningSyncTasks + (runningSyncTasks >= maxConcurrentSyncTasks ? "+" : "") + " items")
                        }
                        else{
                            db.get("userId").then((userId: number) => {
                                db.get("syncLocations:" + userId).then((syncLocations: any) => {
                                    if(Array.isArray(syncLocations) && syncLocations.length > 0 && syncLocations.filter(item => typeof item.remoteUUID == "string").length > 0){
                                        ipc.updateTrayIcon("normal")
                                        ipc.updateTrayTooltip("Filen v" + appVersion + "\nEverything synced")
                                    }
                                    else{
                                        ipc.updateTrayIcon("paused")
                                        ipc.updateTrayTooltip("Filen v" + appVersion + "\nNo sync locations setup yet")
                                    }
                                }).catch((err) => {
                                    log.error(err)

                                    ipc.updateTrayIcon("normal")
                                    ipc.updateTrayTooltip("Filen v" + appVersion + "\nEverything synced")
                                })
                            }).catch((err) => {
                                log.error(err)

                                ipc.updateTrayIcon("normal")
                                ipc.updateTrayTooltip("Filen v" + appVersion + "\nEverything synced")            
                            })
                        }
                    }
                }
            }
        }
    }, [syncIssues, paused, runningSyncTasks, appVersion, isOnline, isLoggedIn])

    useEffect(() => {
        (async () => {
            if(!paused){
                try{
                    const userId = await db.get("userId")
                    let currentSyncLocations = await db.get("syncLocations:" + userId)
    
                    if(!Array.isArray(currentSyncLocations)){
                        currentSyncLocations = []
                    }
    
                    for(let i = 0; i < currentSyncLocations.length; i++){
                        await db.set("localDataChanged:" + currentSyncLocations[i].uuid, true)
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

        const syncTaskListener = eventListener.on("syncTask", (data: any) => {
            const task = data.data

            if(task.err){
                setRunningSyncTasks(prev => prev - 1)
            }
            else{
                if(task.status == "start"){
                    setRunningSyncTasks(prev => prev + 1)
                }
                else if(task.status == "done"){
                    setRunningSyncTasks(prev => prev - 1)
                }
            }
        })

        const syncStatusListener = eventListener.on("syncStatus", (data: any) => {
            if(data.type == "init"){
                setRunningSyncTasks(0)
            }
            else if(data.type == "cleanup"){
                setRunningSyncTasks(0)
            }
        })

        listen()
        init()
        checkInternet()

        return () => {
            window.removeEventListener("offline", offlineListener)
            syncTaskListener.remove()
            syncStatusListener.remove()
		}
    }, [])

    return <></>
})

export default WorkerWindow