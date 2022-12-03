import ipc from "../ipc"
import memoryCache from "../memoryCache"
import eventListener from "../eventListener"
import { sendToAllPorts } from "../worker/ipc"
import { memoize } from "lodash"

const fs = window.require("fs-extra")
const writeFileAtomic = window.require("write-file-atomic")
const pathModule = window.require("path")
const CryptoJS = window.require("crypto-js")
const log = window.require("electron-log")

const DB_VERSION = 1
let DB_PATH = ""
const USE_MEMORY_CACHE: boolean = true
const MEMORY_CACHE_KEY: string = "db:"
const MAX_RETRIES = 32
const RETRY_TIMEOUT = 250

const getDbPath = async (): Promise<string> => {
    if(typeof DB_PATH == "string" && DB_PATH.length > 0){
        return DB_PATH
    }

    const path: string = await ipc.getAppPath("userData")
    const dbPath: string = pathModule.join(path, "db_v" + DB_VERSION)

    DB_PATH = dbPath

    return dbPath
}

const hashKey = memoize((key: string) => {
    return CryptoJS.SHA256(key).toString()
})

if(USE_MEMORY_CACHE){
    eventListener.on("dbSet", ({ key }: { key: string }) => {
        if(memoryCache.has(MEMORY_CACHE_KEY + key)){
            memoryCache.delete(MEMORY_CACHE_KEY + key)
        }
    })
    
    eventListener.on("dbClear", () => {
        memoryCache.cache.forEach((_, key) => {
            if(key.indexOf(MEMORY_CACHE_KEY) !== -1){
                memoryCache.delete(key)
            }
        })
    })
    
    eventListener.on("dbRemove", ({ key }: { key: string }) => {
        if(memoryCache.has(MEMORY_CACHE_KEY + key)){
            memoryCache.delete(MEMORY_CACHE_KEY + key)
        }
    })
}

const get = (key: string): Promise<any> => {
    return new Promise((resolve, reject) => {
        if(typeof key !== "string"){
            return reject(new Error("Invalid key type, expected string, got " + typeof key))
        }

        if(USE_MEMORY_CACHE){
            if(memoryCache.has(MEMORY_CACHE_KEY + key)){
                return resolve(memoryCache.get(MEMORY_CACHE_KEY + key))
            }
        }

        getDbPath().then(() => {
            const keyHash = hashKey(key)

            fs.readFile(pathModule.join(DB_PATH, keyHash + ".json")).then((data: any) => {
                try{
                    const val = JSON.parse(data)

                    if(typeof val !== "object"){
                        return resolve(null)
                    }

                    if(typeof val.key !== "string" || typeof val.value == "undefined"){
                        return resolve(null)
                    }

                    if(val.key !== key){
                        return resolve(null)
                    }

                    if(USE_MEMORY_CACHE){
                        memoryCache.set(MEMORY_CACHE_KEY + key, val.value)
                    }

                    return resolve(val.value)
                }
                catch(e){
                    log.error(e)

                    return resolve(null)
                }
            }).catch(() => {
                return resolve(null)
            })
        }).catch(reject)
    })
}

const set = (key: string, value: any): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        if(typeof key !== "string"){
            return reject(new Error("Invalid key type, expected string, got " + typeof key))
        }

        getDbPath().then(() => {
            try{
                var val = JSON.stringify({
                    key,
                    value
                }, (_, val) => typeof val == "bigint" ? val.toString() : val)
            }
            catch(e){
                return reject(e)
            }

            const keyHash = hashKey(key)

            let tries = 0
            let lastErr: any = ""

            const write = () => {
                if(tries > MAX_RETRIES){
                    return reject(new Error(lastErr))
                }

                tries += 1

                fs.ensureFile(pathModule.join(DB_PATH, keyHash + ".json")).then(() => {
                    writeFileAtomic(pathModule.join(DB_PATH, keyHash + ".json"), val).then(() => {
                        if(USE_MEMORY_CACHE){
                            memoryCache.set(MEMORY_CACHE_KEY + key, value)
                        }

                        sendToAllPorts({
                            type: "dbSet",
                            data: {
                                key
                            }
                        })

                        return resolve(true)
                    }).catch((err: any) => {
                        lastErr = err

                        return setTimeout(write, RETRY_TIMEOUT)
                    })
                }).catch((err: any) => {
                    lastErr = err

                    return setTimeout(write, RETRY_TIMEOUT)
                })
            }

            return write()
        }).catch(reject)
    })
}

const remove = (key: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        if(typeof key !== "string"){
            return reject(new Error("Invalid key type, expected string, got " + typeof key))
        }

        getDbPath().then(() => {
            const keyHash = hashKey(key)

            let tries = 0
            let lastErr: any = ""

            const write = () => {
                if(tries > MAX_RETRIES){
                    return reject(new Error(lastErr))
                }

                tries += 1

                fs.access(pathModule.join(DB_PATH, keyHash + ".json"), fs.F_OK, (err: any) => {
                    if(err){
                        if(USE_MEMORY_CACHE){
                            if(memoryCache.has(MEMORY_CACHE_KEY + key)){
                                memoryCache.delete(MEMORY_CACHE_KEY + key)
                            }
                        }

                        sendToAllPorts({
                            type: "dbRemove",
                            data: {
                                key
                            }
                        })

                        return resolve(true)
                    }

                    fs.unlink(pathModule.join(DB_PATH, keyHash + ".json")).then(() => {
                        if(USE_MEMORY_CACHE){
                            if(memoryCache.has(MEMORY_CACHE_KEY + key)){
                                memoryCache.delete(MEMORY_CACHE_KEY + key)
                            }
                        }

                        sendToAllPorts({
                            type: "dbRemove",
                            data: {
                                key
                            }
                        })

                        return resolve(true)
                    }).catch((err: any) => {
                        lastErr = err

                        return setTimeout(write, RETRY_TIMEOUT)
                    })
                })
            }

            return write()
        }).catch(reject)
    })
}

const clear = (): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        getDbPath().then(() => {
            fs.readdir(DB_PATH).then(async (dir: string[]) => {
                try{
                    for(let i = 0; i < dir.length; i++){
                        await fs.unlink(pathModule.join(DB_PATH, dir[i]))
                    }
                }
                catch(e){
                    return reject(e)
                }

                if(USE_MEMORY_CACHE){
                    memoryCache.cache.forEach((_, key) => {
                        if(key.startsWith(MEMORY_CACHE_KEY)){
                            memoryCache.delete(key)
                        }
                    })
                }

                sendToAllPorts({
                    type: "dbclear",
                    data: {}
                })

                return resolve(true)
            }).catch(reject)
        }).catch(reject)
    })
}

const keys = (): Promise<any> => {
    return new Promise((resolve, reject) => {
        getDbPath().then(() => {
            fs.readdir(DB_PATH).then(async (files: string[]) => {
                const keys = []

                try{
                    for(let i = 0; i < files.length; i++){
                        const obj = JSON.parse(await fs.readFile(pathModule.join(DB_PATH, files[i])))

                        if(typeof obj == "object"){
                            if(typeof obj.key == "string"){
                                keys.push(obj.key)
                            }
                        }
                    }
                }
                catch(e){
                    return reject(e)
                }

                return resolve(keys)
            }).catch(reject)
        }).catch(reject)
    })
}

const db = {
    get,
    set,
    remove,
    clear,
    keys,
    dbCacheKey: MEMORY_CACHE_KEY,
    dbVersion: DB_VERSION
}

export default db