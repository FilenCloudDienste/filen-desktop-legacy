const pathModule = require("path")
const nodeWatch = require("node-watch")
const log = require("electron-log")
const shared = require("../shared")

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
    return new Promise((resolve, reject) => {
        if(typeof SUBS[path] !== "undefined"){
            return resolve(SUBS[path])
        }

        try{
            SUBS[path] = nodeWatch(pathModule.normalize(path), {
                recursive: true,
                persistent: true
            }, (event, name) => {
                return emitToWorker({ event, name, watchPath: path, locationUUID })
            })

            return resolve(SUBS[path])
        }
        catch(e){
            return reject(e)
        }
    })
}