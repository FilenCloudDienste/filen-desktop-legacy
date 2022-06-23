const { Level } = require("level")
const pathModule = require("path")
const { app } = require("electron")
const memoryCache = require("../memoryCache")
const log = require("electron-log")

const DB_VERSION = 1
const DB_PATH = pathModule.join(app.getPath("userData"), "db_v" + DB_VERSION)
let DB_READY = false
const USE_MEMORY_CACHE = false
const MEMORY_CACHE_KEY = "db:"

const db = new Level(DB_PATH, {
    valueEncoding: "json"
})

db.open().then(() => {
    DB_READY = true

    log.info("DB opened at " + DB_PATH)
}).catch((err) => {
    log.error(err)
})

const isDbReady = () => {
    return new Promise((resolve, reject) => {
        if(DB_READY){
            return resolve(true)
        }

        const wait = setInterval(() => {
            if(DB_READY){
                clearInterval(wait)

                return resolve(true)
            }
        }, 100)
    })
}

module.exports = {
    get: (key) => {
        return new Promise((resolve, reject) => {
            if(USE_MEMORY_CACHE){
                if(memoryCache.has(MEMORY_CACHE_KEY + key)){
                    try{
                        return resolve(JSON.parse(memoryCache.get(MEMORY_CACHE_KEY + key)))
                    }
                    catch(e){
                        return reject(e)
                    }
                }
            }
            
            isDbReady().then(() => {
                db.get(key).then((value) => {
                    try{
                        const val = JSON.parse(value)

                        if(USE_MEMORY_CACHE){
                            memoryCache.set(MEMORY_CACHE_KEY + key, val)
                        }

                        return resolve(val)
                    }
                    catch(e){
                        return reject(e)
                    }
                }).catch((err) => {
                    if(err.code == "LEVEL_NOT_FOUND" || err.toString().indexOf("NotFound:")){
                        return resolve(null)
                    }

                    return reject(err)
                })
            })
        })
    },
    set: (key, value) => {
        return new Promise((resolve, reject) => {
            isDbReady().then(() => {
                try{
                    var val = JSON.stringify(value, (_, val) => typeof val == "bigint" ? val.toString() : val)
                }
                catch(e){
                    return reject(e)
                }

                db.put(key, val).then(() => {
                    if(USE_MEMORY_CACHE){
                        memoryCache.set(MEMORY_CACHE_KEY + key, val)
                    }

                    return resolve(true)
                }).catch(reject)
            })
        })
    },
    remove: (key) => {
        return new Promise((resolve, reject) => {
            isDbReady().then(() => {
                db.del(key).then(() => {
                    if(USE_MEMORY_CACHE){
                        if(memoryCache.has(MEMORY_CACHE_KEY + key)){
                            memoryCache.delete(MEMORY_CACHE_KEY + key)
                        }
                    }

                    return resolve(true)
                }).catch(reject)
            })
        })
    },
    clear: () => {
        return new Promise((resolve, reject) => {
            isDbReady().then(() => {
                db.clear().then(() => {
                    memoryCache.cache.forEach((_, key) => {
                        if(key.startsWith(MEMORY_CACHE_KEY)){
                            memoryCache.delete(key)
                        }
                    })

                    return resolve(true)
                }).catch(reject)
            })
        })
    },
    keys: () => {
        return new Promise((resolve, reject) => {
            isDbReady().then(() => {
                try{
                    if(USE_MEMORY_CACHE){
                        return resolve([...memoryCache.cache.forEach((_, key) => key)])
                    }

                    return resolve(db.keys())
                }
                catch(e){
                    return reject(e)
                }
            })
        })
    }
}