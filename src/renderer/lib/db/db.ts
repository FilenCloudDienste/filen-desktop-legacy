import ipc from "../ipc"
import memoryCache from "../memoryCache"
import eventListener from "../eventListener"
import { sendToAllPorts } from "../worker/ipc"

const USE_MEMORY_CACHE: boolean = true
const MEMORY_CACHE_KEY: string = "db:"

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

        ipc.db("get", key).then((value) => {
            if(USE_MEMORY_CACHE && value !== null){
                memoryCache.set(MEMORY_CACHE_KEY + key, value)
            }

            return resolve(value)
        })
    })
}

const set = (key: string, value: any): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        if(typeof key !== "string"){
            return reject(new Error("Invalid key type, expected string, got " + typeof key))
        }

        ipc.db("set", key, value).then(() => {
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
        }).catch(reject)
    })
}

const remove = (key: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        if(typeof key !== "string"){
            return reject(new Error("Invalid key type, expected string, got " + typeof key))
        }

        ipc.db("remove", key).then(() => {
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
        }).catch(reject)
    })
}

const clear = (): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        ipc.db("clear").then(() => {
            if(USE_MEMORY_CACHE){
                memoryCache.cache.forEach((_, key) => {
                    if(key.startsWith(MEMORY_CACHE_KEY)){
                        memoryCache.delete(key)
                    }
                })
            }

            sendToAllPorts({
                type: "dbclear"
            })

            return resolve(true)
        }).catch(reject)
    })
}

const keys = (): Promise<any> => {
    return ipc.db("keys")
}

const db = {
    get,
    set,
    remove,
    clear,
    keys,
    dbCacheKey: MEMORY_CACHE_KEY
}

export default db