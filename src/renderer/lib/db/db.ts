import ipc from "../ipc"
import memoryCache from "../memoryCache"

const USE_MEMORY_CACHE: boolean = false
const MEMORY_CACHE_KEY: string = "db:"

const db = {
    get: (key: string): Promise<any> => {
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
    set: (key: string, value: any): Promise<boolean> => {
        return new Promise((resolve, reject) => {
            ipc.db("set", key, value).then(() => {
                if(USE_MEMORY_CACHE){
                    memoryCache.set(MEMORY_CACHE_KEY + key, value)
                }

                return resolve(true)
            }).catch(reject)
        })
    },
    remove: (key: string): Promise<boolean> => {
        return new Promise((resolve, reject) => {
            ipc.db("remove", key).then(() => {
                if(USE_MEMORY_CACHE){
                    memoryCache.delete(MEMORY_CACHE_KEY + key)
                }

                return resolve(true)
            }).catch(reject)
        })
    },
    clear: (): Promise<boolean> => {
        return new Promise((resolve, reject) => {
            ipc.db("clear").then(() => {
                if(USE_MEMORY_CACHE){
                    memoryCache.cache.clear()
                }

                return resolve(true)
            }).catch(reject)
        })
    },
    keys: (): Promise<any> => {
        return new Promise((resolve, reject) => {
            ipc.db("keys").then(resolve).catch(reject)
        })
    }
}

export default db