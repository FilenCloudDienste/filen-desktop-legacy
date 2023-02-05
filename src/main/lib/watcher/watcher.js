const pathModule = require("path")
const log = require("electron-log")
const nodeWatch = require("node-watch")
const is = require("electron-is")
const { powerMonitor } = require("electron")

const LINUX_EVENT_EMIT_TIMER = 60000
const SUBS = {}
const SUBS_INFO = {}
const linuxWatchUpdateTimeout = {}
const lastEvent = {}

const emitToWorker = (data) => {
    require("../ipc").emitGlobal("global-message", {
        type: "watcher-event",
        data
    })
}

const resumeWatchers = () => {
    console.log("RESUMING WATCHERS")

    for(const path in SUBS_INFO){
        const locationUUID = SUBS_INFO[path]

        try{
            if(typeof SUBS[path].isClosed == "function"){
                if(!SUBS[path].isClosed()){
                    SUBS[path].close()

                    delete SUBS[path]
                }
            }
        }
        catch(e){
            log.error(e)
        }

        watch(path, locationUUID, true).catch(log.error)
    }
}

powerMonitor.on("resume", () => resumeWatchers())
powerMonitor.on("unlock-screen", () => resumeWatchers())
powerMonitor.on("user-did-become-active", () => resumeWatchers())

const watch = (path, locationUUID, isReInit = false) => {
    return new Promise((resolve, reject) => {
        if(typeof SUBS[path] !== "undefined" && !isReInit){
            return resolve(SUBS[path])
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
    
            SUBS[path].on("error", log.error)
    
            SUBS[path].on("ready", () => {
                SUBS_INFO[path] = locationUUID

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

module.exports = {
    watch
}