import ipc from "../ipc"
import * as fsLocal from "../fs/local"

const readline = window.require("readline")
const pathModule = window.require("path")
const fs = window.require("fs-extra")
const log = window.require("electron-log")

const cacheMap = new Map()
const METADATA_DISK_CACHE_VERSION = 1
let METADATA_DISK_PATH = ""
let METADATA_DISK_WRITE_STREAM: any = undefined

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

export const openMetadataDiskWriteStream = async () => {
    if(window.location.href.indexOf("#worker") == -1){
        return undefined
    }

    if(typeof METADATA_DISK_WRITE_STREAM !== "undefined"){
        return METADATA_DISK_WRITE_STREAM
    }

    try{
        const metadataPath = await getMetadataDiskPath()

        METADATA_DISK_WRITE_STREAM = fs.createWriteStream(metadataPath, {
            flags: "a"
        })

        METADATA_DISK_WRITE_STREAM.on("error", (err: Error) => {
            log.error(err)
        })

        METADATA_DISK_WRITE_STREAM.on("close", () => {
            METADATA_DISK_WRITE_STREAM = undefined

            log.info("METADATA_DISK_WRITE_STREAM closed")
        })
    }
    catch(e){
        throw e
    }

    return METADATA_DISK_WRITE_STREAM
}

export const getMetadataDiskPath = async () => {
    if(METADATA_DISK_PATH.length > 0){
        return METADATA_DISK_PATH
    }

    const userDataPath: string = await ipc.getAppPath("userData")
    const metadataPath: string = pathModule.join(userDataPath, "metadata_v" + METADATA_DISK_CACHE_VERSION + ".dat")

    METADATA_DISK_PATH = metadataPath

    return metadataPath
}

export const loadMetadataFromDisk = async () => {
    return new Promise(async (resolve, reject) => {
        if(window.location.href.indexOf("#worker") == -1){
            return resolve(true)
        }
    
        try{
            const metadataPath = await getMetadataDiskPath()
            const stat = await fsLocal.gracefulLStat(metadataPath)

            if(stat.size <= 0){
                return resolve(true)
            }
    
            const reader = readline.createInterface({
                input: fs.createReadStream(metadataPath, {
                    flags: "r"
                }),
                crlfDelay: Infinity
            })
    
            reader.on("line", (line: string) => {
                try{
                    const parsed = JSON.parse(line)
    
                    set(parsed.key, parsed.metadata)
                }
                catch(e){
                    log.error(e)
                }
            })
    
            reader.on("error", reject)
            reader.on("close", resolve)
        }
        catch(e){
            return reject(e)
        }
    })
}

export const saveMetadataToDisk = async (key: string, metadata: any) => {
    if(window.location.href.indexOf("#worker") == -1){
        return true
    }

    try{
        const stream = await openMetadataDiskWriteStream()

        if(typeof stream == "undefined"){
            return true
        }

        stream.write(JSON.stringify({
            key,
            metadata
        }) + "\n")
    }
    catch(e){
        log.error(e)
    }

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