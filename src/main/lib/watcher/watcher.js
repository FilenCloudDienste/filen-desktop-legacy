const pathModule = require("path")
const chokidar = require("chokidar")
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
    return new Promise((resolve) => {
        if(typeof SUBS[path] !== "undefined"){
            return resolve(SUBS[path])
        }

        SUBS[path] = chokidar.watch(pathModule.normalize(path), {
            usePolling: false,
            useFsEvents: true,
            followSymlinks: true,
            ignoreInitial: true,
            alwaysStat: false,
            depth: Number.MAX_SAFE_INTEGER,
            awaitWriteFinish: false,
            ignorePermissionErrors: true,
            persistent: true
        })

        SUBS[path].on("all", (event, name) => emitToWorker({ event, name, watchPath: path, locationUUID }))

        SUBS[path].on("error", (err) => log.error(err))

        return resolve(SUBS[path])
    })
}