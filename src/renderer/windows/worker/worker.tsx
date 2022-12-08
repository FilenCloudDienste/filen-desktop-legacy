import { memo, useEffect, useRef, useState } from "react"
import { listen } from "../../lib/worker/ipc"
import sync from "../../lib/worker/sync"
import { updateKeys } from "../../lib/user"
import db from "../../lib/db"
import useIsOnline from "../../lib/hooks/useIsOnline"
import ipc from "../../lib/ipc"
import useDb from "../../lib/hooks/useDb"
import eventListener from "../../lib/eventListener"
import useAppVersion from "../../lib/hooks/useAppVersion"
import type { Location } from "../../../types"

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
        timeout: 30000,
        headers: {
            "User-Agent": "filen-desktop"
        },
        agent: new https.Agent({
            timeout: 30000
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

        response.on("timeout", async () => {
            await db.set("isOnline", false).catch(log.error)

            return setTimeout(checkInternet, 3000)
        })

        response.on("data", (chunk: Buffer) => res.push(chunk))

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

    req.on("timeout", async () => {
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

            updateKeys().then(() => {
                Promise.all([
                    db.set("paused", false),
                    db.set("syncIssues", []),
                    db.set("maxStorageReached", false),
                    db.set("suspend", false),
                    db.set("uploadPaused", false),
                    db.set("downloadPaused", false),
                    db.set("isOnline", true)
                ]).then(() => sync()).catch((err) => {
                    log.error(err)
                })
            }).catch((err) => {
                log.error(err)
            })
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
                            ipc.updateTrayTooltip("Filen v" + appVersion + "\nSyncing " + runningSyncTasks + " items")
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