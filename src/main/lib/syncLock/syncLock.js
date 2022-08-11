const log = require("electron-log")
const db = require("../db")
const api = require("../api")

let SYNC_LOCK_INTERVAL = undefined
let TRYING_TO_HOLD_SYNC_LOCK = false
let SYNC_LOCK_ACQUIRED = false

const acquireSyncLock = (id = "sync") => {
    return new Promise((resolve) => {
        if(SYNC_LOCK_ACQUIRED){
            return resolve(true)
        }

        log.info("Acquiring sync lock")

        const acquire = async () => {
            api.acquireLock({ apiKey: await db.get("apiKey"), id }).then(() => {
                log.info("Sync lock acquired")

                SYNC_LOCK_ACQUIRED = true
                TRYING_TO_HOLD_SYNC_LOCK = false

                holdSyncLock(id)
    
                return resolve(true)
            }).catch((err) => {
                if(err.toString().toLowerCase().indexOf("sync locked") == -1){
                    log.error("Could not acquire sync lock from API")
                    log.error(err)
                }

                SYNC_LOCK_ACQUIRED = false
    
                return setTimeout(acquire, 1000)
            })
        }

        return acquire()
    })
}

const releaseSyncLock = (id = "sync") => {
    return new Promise(async (resolve, reject) => {
        if(!SYNC_LOCK_ACQUIRED){
            return resolve(true)
        }

        log.info("Releasing sync lock")

        TRYING_TO_HOLD_SYNC_LOCK = false

        clearInterval(SYNC_LOCK_INTERVAL)

        api.releaseLock({ apiKey: await db.get("apiKey"), id }).then(() => {
            log.info("Sync lock released")

            SYNC_LOCK_ACQUIRED = false

            return resolve(true)
        }).catch((err) => {
            log.error("Could not release sync lock from API")
            log.error(err)

            return reject(err)
        })
    })
}

const holdSyncLock = (id = "sync") => {
    clearInterval(SYNC_LOCK_INTERVAL)

    TRYING_TO_HOLD_SYNC_LOCK = false

    SYNC_LOCK_INTERVAL = setInterval(async () => {
        if(!TRYING_TO_HOLD_SYNC_LOCK && SYNC_LOCK_ACQUIRED){
            TRYING_TO_HOLD_SYNC_LOCK = true

            log.info("Holding sync lock")

            try{
                await api.holdLock({ apiKey: await db.get("apiKey"), id })
            }
            catch(e){
                log.error("Could not hold sync lock from API")
                log.error(e)

                TRYING_TO_HOLD_SYNC_LOCK = false
                SYNC_LOCK_ACQUIRED = false

                clearInterval(SYNC_LOCK_INTERVAL)

                return false
            }

            TRYING_TO_HOLD_SYNC_LOCK = false

            log.info("Sync lock held")
        }
    }, 1000)
}

module.exports = {
    acquireSyncLock,
    holdSyncLock,
    releaseSyncLock
}