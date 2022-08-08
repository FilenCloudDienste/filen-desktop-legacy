const pathModule = require("path")
const log = require("electron-log")
const shared = require("../shared")
const nodeWatch = require("node-watch")

const SUBS = {}

const emitToWorker = (data) => {
    try{
        if(typeof shared.get("WORKER_WINDOW") !== "undefined"){
            shared.get("WORKER_WINDOW").webContents.send("watcher-event", data)
        }
    }
    catch(e){
        log.error(e)
    }

    return true
}

module.exports = (path, locationUUID) => {
    return new Promise((resolve) => {
        if(typeof SUBS[path] !== "undefined"){
            return resolve(SUBS[path])
        }

        try{
            SUBS[path] = nodeWatch(pathModule.normalize(path), {
                recursive: true,
                delay: 1000,
                persistent: true
            })
    
            SUBS[path].on("change", (event, name) => emitToWorker({ event, name, watchPath: path, locationUUID }))
    
            SUBS[path].on("error", (err) => log.error(err))
    
            SUBS[path].on("ready", () => resolve(SUBS[path]))
        }
        catch(e){
            return reject(e)
        }
    })
}