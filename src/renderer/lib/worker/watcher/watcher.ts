import eventListener from "../../eventListener"
import type { WatcherEvent } from "../../../../types"

const pathModule = window.require("path")
const log = window.require("electron-log")
const nodeWatch = window.require("node-watch")
const is = window.require("electron-is")

const LINUX_EVENT_EMIT_TIMER = 60000
const SUBS: { [key: string]: any } = {}
const linuxWatchUpdateTimeout: { [key: string]: NodeJS.Timer } = {}
const lastEvent: { [key: string]: number } = {}

const emitToWorker = (data: WatcherEvent) => {
    eventListener.emit("watcher-event", data)
}

export const watch = (path: string, locationUUID: string): Promise<any> => {
    return new Promise((resolve, reject) => {
        if(typeof SUBS[path] !== "undefined"){
            return resolve(SUBS[path])
        }

        try{
            SUBS[path] = nodeWatch(pathModule.normalize(path), {
                recursive: true,
                delay: 1000,
                persistent: true
            })
    
            SUBS[path].on("change", (event: string, name: string) => {
                if(name.indexOf(".temp-smoketest.") !== -1){
                    return
                }

                lastEvent[path] = new Date().getTime()

                emitToWorker({ event, name, watchPath: path, locationUUID })
            })
    
            SUBS[path].on("error", log.error)
    
            SUBS[path].on("ready", () => {
                if(is.linux()){
                    clearInterval(linuxWatchUpdateTimeout[path])

                    linuxWatchUpdateTimeout[path] = setInterval(() => {
                        const now = new Date().getTime()

                        if(typeof lastEvent[path] !== "number"){
                            lastEvent[path] = now
                        }
                        
                        if((now - LINUX_EVENT_EMIT_TIMER) > lastEvent[path]){
                            lastEvent[path] = now

                            emitToWorker({
                                event: "dummy",
                                name: "dummy",
                                watchPath: path,
                                locationUUID
                            })
                        }
                    }, 5000)
                }

                return resolve(SUBS[path])
            })
        }
        catch(e){
            log.error(e)

            return reject(e)
        }
    })
}