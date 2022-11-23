const pathModule = require("path")
const { app } = require("electron")
const fs = require("fs-extra")
const writeFileAtomic = require("write-file-atomic")
const crypto = require("crypto")
const log = require("electron-log")

const DB_VERSION = 1
const DB_PATH = pathModule.join(app.getPath("userData"), "db_v" + DB_VERSION)
const USE_MEMORY_CACHE = false
const MEMORY_CACHE_KEY = "db:"
const MAX_RETRIES = 32
const RETRY_TIMEOUT = 250

const hashKey = (key) => {
    return crypto.createHash("sha256").update(key).digest("hex")
}

// Clear leftover temp files etc
const dirCheck = async () => {
    try{
        const dir = await fs.readdir(DB_PATH)

        for(let i = 0; i < dir.length; i++){
            if(dir[i].length !== 69 || dir[i].split(".").length !== 2 || dir[i].indexOf(".json") == -1){
                await fs.unlink(pathModule.join(DB_PATH, dir[i]))
            }
        }
    }
    catch(e){
        log.error(e)
    }
}

dirCheck()

module.exports = {
    get: (key) => {
        return new Promise((resolve, reject) => {
            if(USE_MEMORY_CACHE){
                if(require("../memoryCache").has(MEMORY_CACHE_KEY + key)){
                    return resolve(require("../memoryCache").get(MEMORY_CACHE_KEY + key))
                }
            }

            if(typeof key !== "string"){
                return reject(new Error("Invalid key type, expected string, got " + typeof key))
            }

            const keyHash = hashKey(key)

            fs.readFile(pathModule.join(DB_PATH, keyHash + ".json")).then((data) => {
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
                        require("../memoryCache").set(MEMORY_CACHE_KEY + key, val.value)
                    }

                    return resolve(val.value)
                }
                catch(e){
                    return reject(e)
                }
            }).catch(() => {
                return resolve(null)
            })
        })
    },
    set: (key, value) => {
        return new Promise((resolve, reject) => {
            if(typeof key !== "string"){
                return reject(new Error("Invalid key type, expected string, got " + typeof key))
            }

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
            let lastErr = ""

            const write = () => {
                if(tries > MAX_RETRIES){
                    return reject(new Error(lastErr))
                }

                tries += 1

                fs.ensureFile(pathModule.join(DB_PATH, keyHash + ".json")).then(() => {
                    writeFileAtomic(pathModule.join(DB_PATH, keyHash + ".json"), val).then(() => {
                        if(USE_MEMORY_CACHE){
                            require("../memoryCache").set(MEMORY_CACHE_KEY + key, value)
                        }
    
                        return resolve(true)
                    }).catch((err) => {
                        lastErr = err

                        return setTimeout(write, RETRY_TIMEOUT)
                    })
                }).catch((err) => {
                    lastErr = err

                    return setTimeout(write, RETRY_TIMEOUT)
                })
            }

            return write()
        })
    },
    remove: (key) => {
        return new Promise((resolve, reject) => {
            if(typeof key !== "string"){
                return reject(new Error("Invalid key type, expected string, got " + typeof key))
            }

            const keyHash = hashKey(key)

            let tries = 0
            let lastErr = ""

            const write = () => {
                if(tries > MAX_RETRIES){
                    return reject(new Error(lastErr))
                }

                tries += 1

                fs.access(pathModule.join(DB_PATH, keyHash + ".json"), fs.F_OK, (err) => {
                    if(err){
                        if(USE_MEMORY_CACHE){
                            if(require("../memoryCache").has(MEMORY_CACHE_KEY + key)){
                                require("../memoryCache").delete(MEMORY_CACHE_KEY + key)
                            }
                        }
        
                        return resolve(true)
                    }
    
                    fs.unlink(pathModule.join(DB_PATH, keyHash + ".json")).then(() => {
                        if(USE_MEMORY_CACHE){
                            if(require("../memoryCache").has(MEMORY_CACHE_KEY + key)){
                                require("../memoryCache").delete(MEMORY_CACHE_KEY + key)
                            }
                        }
        
                        return resolve(true)
                    }).catch((err) => {
                        lastErr = err
    
                        return setTimeout(write, RETRY_TIMEOUT)
                    })
                })
            }

            return write()
        })
    },
    clear: () => {
        return new Promise((resolve, reject) => {
            fs.readdir(DB_PATH).then(async (dir) => {
                try{
                    for(let i = 0; i < dir.length; i++){
                        await fs.unlink(pathModule.join(DB_PATH, dir[i]))
                    }
                }
                catch(e){
                    return reject(e)
                }

                if(USE_MEMORY_CACHE){
                    require("../memoryCache").cache.forEach((_, key) => {
                        if(key.startsWith(MEMORY_CACHE_KEY)){
                            require("../memoryCache").delete(key)
                        }
                    })
                }

                return resolve(true)
            }).catch(reject)
        })
    },
    keys: () => {
        return new Promise((resolve, reject) => {
            fs.readdir(DB_PATH).then(async (files) => {
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
        })
    }
}