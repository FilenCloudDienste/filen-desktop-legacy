import pathModule from "path"
import log from "electron-log"
import nodeWatch from "node-watch"
import is from "electron-is"
import { powerMonitor } from "electron"
import { emitGlobal } from "../ipc"

const LINUX_EVENT_EMIT_TIMER = 60000
const SUBS: Record<string, ReturnType<typeof nodeWatch>> = {}
const SUBS_INFO: Record<string, string> = {}
const linuxWatchUpdateTimeout: Record<string, NodeJS.Timer> = {}
const lastEvent: Record<string, number> = {}
const didCloseDueToResume: Record<string, boolean> = {}

export const emitToWorker = (data: any) => {
    emitGlobal("global-message", {
        type: "watcher-event",
        data
    })
}

export const resumeWatchers = () => {
    if(is.linux()){
        return
    }

    for(const path in SUBS_INFO){
        const locationUUID = SUBS_INFO[path]

        try{
            if(typeof SUBS[path].isClosed == "function"){
                if(!SUBS[path].isClosed()){
                    didCloseDueToResume[path] = true

                    SUBS[path].close()
                }
                
                delete SUBS[path]
            }
        }
        catch(e){
            log.error(e)
        }

        watch(path, locationUUID).catch(log.error)
    }
}

powerMonitor.on("resume", () => resumeWatchers())
powerMonitor.on("unlock-screen", () => resumeWatchers())
powerMonitor.on("user-did-become-active", () => resumeWatchers())

export const watch = (path: string, locationUUID: string) => {
    return new Promise((resolve, reject) => {
        if(is.linux()){
            clearInterval(linuxWatchUpdateTimeout[path])

            linuxWatchUpdateTimeout[path] = setInterval(() => {
                emitToWorker({
                    event: "dummy",
                    name: "dummy",
                    watchPath: path,
                    locationUUID
                })
            }, LINUX_EVENT_EMIT_TIMER)

            return
        }

        if(typeof SUBS[path] !== "undefined"){
            resolve(SUBS[path])

            return
        }

        try{
            SUBS[path] = nodeWatch(pathModule.normalize(path), {
                recursive: true,
                delay: 1000,
                persistent: true
            })
    
            SUBS[path].on("change", (event, name) => {
                lastEvent[path] = new Date().getTime()

                emitToWorker({ event, name, watchPath: path, locationUUID })
            })
    
            SUBS[path].on("error", (err) => {
                log.error(err)

                delete didCloseDueToResume[path]
                delete SUBS[path]
                delete SUBS_INFO[path]
            })

            SUBS[path].on("close", () => {
                setTimeout(() => {
                    if(typeof didCloseDueToResume[path] == "undefined"){
                        delete SUBS[path]
                        delete SUBS_INFO[path]

                        emitToWorker({
                            event: "dummy",
                            name: "dummy",
                            watchPath: path,
                            locationUUID
                        })
    
                        watch(path, locationUUID).catch(log.error)
                    }

                    delete didCloseDueToResume[path]
                }, 5000)
            })
    
            SUBS[path].on("ready", () => {
                SUBS_INFO[path] = locationUUID

                resolve(SUBS[path])
            })
        }
        catch(e){
            log.error(e)

            reject(e)

            return
        }
    })
}