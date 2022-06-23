import ipc from "../ipc"
import memoryCache from "../memoryCache"

const USE_MEMORY_CACHE = false
const MEMORY_CACHE_KEY = "db:"

const db = {
    get: (key) => {
        return new Promise((resolve, reject) => {
            if(USE_MEMORY_CACHE){
                if(memoryCache.has(MEMORY_CACHE_KEY + key)){
                    return resolve(memoryCache.get(MEMORY_CACHE_KEY + key))
                }
            }

            ipc.db("get", key).then((response) => {
                if(USE_MEMORY_CACHE){
                    memoryCache.set(MEMORY_CACHE_KEY + key, response)
                }

                return resolve(response)
            }).catch(reject)
        })
    },
    set: (key, value) => {
        return new Promise((resolve, reject) => {
            ipc.db("set", key, value).then(() => {
                if(USE_MEMORY_CACHE){
                    memoryCache.set(MEMORY_CACHE_KEY + key, value)
                }

                return resolve(true)
            }).catch(reject)
        })
    },
    remove: (key) => {
        return new Promise((resolve, reject) => {
            ipc.db("remove", key).then(() => {
                if(USE_MEMORY_CACHE){
                    memoryCache.delete(MEMORY_CACHE_KEY + key)
                }

                return resolve(true)
            }).catch(reject)
        })
    },
    clear: () => {
        return new Promise((resolve, reject) => {
            ipc.db("clear").then(() => {
                if(USE_MEMORY_CACHE){
                    memoryCache.cache.clear()
                }

                return resolve(true)
            }).catch(reject)
        })
    },
    keys: () => {
        return new Promise((resolve, reject) => {
            ipc.db("keys").then(resolve).catch(reject)
        })
    }
}

export default db