import ipc from "../ipc"
import { Semaphore } from "../helpers"

const readline = window.require("readline")
const pathModule = window.require("path")
const fs = window.require("fs-extra")
const log = window.require("electron-log")

const cacheMap = new Map()
const METADATA_DISK_CACHE_VERSION = 1
let METADATA_DISK_PATH = ""
const metadataSemaphore = new Semaphore(1)

export const has = (key: string) => {
    return cacheMap.has(key)
}

export const get = (key: string) => {
    if(cacheMap.has(key)){
        return cacheMap.get(key)
    }

    return null
}

export const set =  (key: string, value: any) => {
    cacheMap.set(key, value)

    return true
}

export const del = (key: string) => {
    if(cacheMap.has(key)){
        cacheMap.delete(key)
    }

    return true
}

export const getMetadataDiskPath = async () => {
    if(METADATA_DISK_PATH.length > 0){
        return METADATA_DISK_PATH
    }

    const userDataPath: string = await ipc.getAppPath("userData")

    await fs.ensureDir(pathModule.join(userDataPath, "data", "v" + METADATA_DISK_CACHE_VERSION))

    const metadataPath: string = pathModule.join(userDataPath, "data", "v" + METADATA_DISK_CACHE_VERSION, "metadata")

    METADATA_DISK_PATH = metadataPath

    return metadataPath
}

export const loadMetadataFromDisk = async () => {
    return new Promise(async (resolve, reject) => {
        if(window.location.href.indexOf("#worker") == -1){
            return resolve(true)
        }

        await metadataSemaphore.acquire()

        try{
            var metadataPath = await getMetadataDiskPath()
        }
        catch(e: any){
            metadataSemaphore.release()

            if(e.code == "ENOENT"){
                return resolve(true)
            }

            return reject(e)
        }

        try{
            await new Promise((resolve, reject) => {
                fs.access(metadataPath, fs.constants.F_OK, (err: Error) => {
                    if(err){
                        return reject(err)
                    }

                    return resolve(true)
                })
            })
        }
        catch(e){
            metadataSemaphore.release()

            return resolve(true)
        }
    
        try{
            const reader = readline.createInterface({
                input: fs.createReadStream(metadataPath, {
                    flags: "r"
                }),
                crlfDelay: Infinity
            })
    
            reader.on("line", (line: string) => {
                if(typeof line !== "string"){
                    return
                }

                if(line.length < 4){
                    return
                }

                try{
                    const parsed = JSON.parse(line)
    
                    set(parsed.key, parsed.metadata)
                }
                catch(e){
                    log.error(e)
                }
            })
    
            reader.on("error", (err: any) => {
                metadataSemaphore.release()

                return reject(err)
            })

            reader.on("close", () => {
                metadataSemaphore.release()

                return resolve(true)
            })
        }
        catch(e){
            metadataSemaphore.release()

            return reject(e)
        }
    })
}

export const saveMetadataToDisk = async (key: string, metadata: any) => {
    if(window.location.href.indexOf("#worker") == -1){
        return true
    }

    await metadataSemaphore.acquire()

    try{
        const path = await getMetadataDiskPath()

        await new Promise((resolve, reject) => {
            fs.appendFile(path, JSON.stringify({
                key,
                metadata
            }) + "\n", (err: any) => {
                if(err){
                    return reject(err)
                }

                return resolve(true)
            })
        })
    }
    catch(e){
        log.error(e)
    }

    metadataSemaphore.release()

    return true
}

export const cache = cacheMap

const memoryCache = {
    has,
    get,
    set,
    delete: del,
    getMetadataDiskPath,
    loadMetadataFromDisk,
    saveMetadataToDisk,
    cache
}

export default memoryCache