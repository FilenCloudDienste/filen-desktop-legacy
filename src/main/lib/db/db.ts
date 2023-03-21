import pathModule from "path"
import { app } from "electron"
import fs from "fs-extra"
import writeFileAtomic from "write-file-atomic"
import { getRandomArbitrary, hashKey } from "../helpers"
import memoryCache from "../memoryCache"
import { emitGlobal } from "../ipc"

const DB_VERSION = 1
const DB_PATH = pathModule.join(app.getPath("userData"), "db_v" + DB_VERSION)
const USE_MEMORY_CACHE = false
const MEMORY_CACHE_KEY = "db:"
const MAX_RETRIES = 30
const RETRY_TIMEOUT = 500

export const get = async (key: string) => {
    if(USE_MEMORY_CACHE){
        if(memoryCache.has(MEMORY_CACHE_KEY + key)){
            return memoryCache.get(MEMORY_CACHE_KEY + key)
        }
    }

    const keyHash = hashKey(key)
    
    try{
        var data = await fs.readFile(pathModule.join(DB_PATH, keyHash + ".json"), "utf-8")
    }
    catch(e){
        return null
    }

    const val = JSON.parse(data)

    if(typeof val !== "object"){
        return null
    }

    if(typeof val.key !== "string" || typeof val.value == "undefined"){
        return null
    }

    if(val.key !== key){
        return null
    }

    if(USE_MEMORY_CACHE){
        memoryCache.set(MEMORY_CACHE_KEY + key, val.value)
    }

    return val.value
}

export const set = (key: string, value: any) => {
    return new Promise((resolve, reject) => {
        try{
            var val = JSON.stringify({
                key,
                value
            }, (_, val) => typeof val == "bigint" ? val.toString() : val)
        }
        catch(e){
            reject(e)

            return
        }

        const keyHash = hashKey(key)

        let tries = 0
        let lastErr = ""

        const write = () => {
            if(tries > MAX_RETRIES){
                reject(new Error(lastErr))

                return
            }

            tries += 1

            const dbFilePath = pathModule.join(DB_PATH, keyHash + ".json")

            fs.ensureFile(dbFilePath).then(() => {
                writeFileAtomic(dbFilePath, val).then(() => {
                    if(USE_MEMORY_CACHE){
                        memoryCache.set(MEMORY_CACHE_KEY + key, value)
                    }

                    emitGlobal("global-message", {
                        type: "dbSet",
                        data: {
                            key
                        }
                    })

                    resolve(true)
                }).catch((err) => {
                    lastErr = err

                    setTimeout(write, RETRY_TIMEOUT + getRandomArbitrary(10, 100))
                })
            }).catch((err) => {
                lastErr = err

                setTimeout(write, RETRY_TIMEOUT + getRandomArbitrary(10, 100))
            })
        }

        write()
    })
}

export const remove = (key: string) => {
    return new Promise((resolve, reject) => {
        const keyHash = hashKey(key)

        let tries = 0
        let lastErr = ""

        const write = () => {
            if(tries > MAX_RETRIES){
                reject(new Error(lastErr))

                return
            }

            tries += 1

            fs.access(pathModule.join(DB_PATH, keyHash + ".json"), fs.constants.F_OK, (err) => {
                if(err){
                    if(USE_MEMORY_CACHE){
                        memoryCache.delete(MEMORY_CACHE_KEY + key)
                    }

                    emitGlobal("global-message", {
                        type: "dbRemove",
                        data: {
                            key
                        }
                    })
    
                    resolve(true)

                    return
                }

                fs.unlink(pathModule.join(DB_PATH, keyHash + ".json")).then(() => {
                    if(USE_MEMORY_CACHE){
                        memoryCache.delete(MEMORY_CACHE_KEY + key)
                    }

                    emitGlobal("global-message", {
                        type: "dbRemove",
                        data: {
                            key
                        }
                    })
    
                    resolve(true)
                }).catch((err) => {
                    if(err.code == "ENOENT"){
                        if(USE_MEMORY_CACHE){
                            memoryCache.delete(MEMORY_CACHE_KEY + key)
                        }

                        emitGlobal("global-message", {
                            type: "dbRemove",
                            data: {
                                key
                            }
                        })
        
                        resolve(true)

                        return
                    }

                    lastErr = err

                    setTimeout(write, RETRY_TIMEOUT + getRandomArbitrary(10, 100))
                })
            })
        }

        write()
    })
}

export const clear = async () => {
    const dir = await fs.readdir(DB_PATH)

    for(const entry of dir){
        await fs.unlink(pathModule.join(DB_PATH, entry))
    }

    if(USE_MEMORY_CACHE){
        memoryCache.cache.forEach((_, key) => {
            if(key.startsWith(MEMORY_CACHE_KEY)){
                memoryCache.delete(key)
            }
        })
    }

    emitGlobal("global-message", {
        type: "dbClear"
    })
}

export const keys = async () => {
    const dir = await fs.readdir(DB_PATH)
    const keys: string[] = []

    for(const file of dir){
        const obj = JSON.parse(await fs.readFile(pathModule.join(DB_PATH, file), "utf-8"))

        if(typeof obj == "object"){
            if(typeof obj.key == "string"){
                keys.push(obj.key)
            }
        }
    }

    return keys
}

export const db = {
    get,
    set,
    remove,
    clear,
    keys
}

export default db