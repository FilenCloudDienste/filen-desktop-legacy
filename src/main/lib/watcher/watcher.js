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
const didCloseDueToResume = {}

const emitToWorker = (data) => {
    require("../ipc").emitGlobal("global-message", {
        type: "watcher-event",
        data
    })
}

const resumeWatchers = () => {
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

const watch = (path, locationUUID) => {
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