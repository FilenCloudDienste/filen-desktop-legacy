import ipc from "../../ipc"
import memoryCache from "../../memoryCache"
import { convertTimestampToMs, Semaphore, isFolderPathExcluded, isSystemPathExcluded, pathIsFileOrFolderNameIgnoredByDefault, pathValidation } from "../../helpers"
import { downloadChunk } from "../../api"
import { decryptData } from "../../crypto"
import { v4 as uuidv4 } from "uuid"
import db from "../../db"
import * as constants from "../../constants"
import { isSyncLocationPaused } from "../../worker/sync/sync.utils"

const fs = window.require("fs-extra")
const pathModule = window.require("path")
const readdirp = window.require("readdirp")
const log = window.require("electron-log")
const is = window.require("electron-is")

const downloadThreadsSemaphore = new Semaphore(constants.maxDownloadThreads)
const localFSSemaphore = new Semaphore(128)

export const normalizePath = (path: string): string => {
    return pathModule.normalize(path)
}

export const checkLastModified = (path: string): Promise<{ changed: boolean, mtimeMs?: number }> => {
    return new Promise((resolve, reject) => {
        localFSSemaphore.acquire().then(() => {
            path = normalizePath(path)

            gracefulLStat(path).then((stat: any) => {
                if(stat.mtimeMs > 0){
                    localFSSemaphore.release()

                    return resolve({
                        changed: false
                    })
                }

                const lastModified = new Date(new Date().getTime() - 60000)
                const mtimeMs = lastModified.getTime()
                
                fs.utimes(path, lastModified, lastModified).then(() => {
                    localFSSemaphore.release()

                    return resolve({
                        changed: true,
                        mtimeMs 
                    })
                }).catch((err: any) => {
                    localFSSemaphore.release()

                    return reject(err)
                })
            }).catch((err: any) => {
                localFSSemaphore.release()

                return reject(err)
            })
        })
    })
}

export const getTempDir = (): Promise<string> => {
    return new Promise((resolve, reject) => {
        if(memoryCache.has("tmpDir")){
            return resolve(memoryCache.get("tmpDir"))
        }

        ipc.getAppPath("temp").then((tmpDir) => {
            tmpDir = normalizePath(tmpDir)

            memoryCache.set("tmpDir", tmpDir)

            return resolve(tmpDir)
        }).catch(reject)
    })
}

export const smokeTest = (path: string): Promise<boolean> => {
    return new Promise(async (resolve, reject) => {
        path = normalizePath(path)

        try{
            await localFSSemaphore.acquire()

            const tmpDir = await getTempDir()

            await Promise.all([
                canReadWriteAtPath(path),
                canReadWriteAtPath(tmpDir)
            ])

            await Promise.all([
                gracefulLStat(path),
                gracefulLStat(tmpDir)
            ])
        }
        catch(e){
            localFSSemaphore.release()

            return reject(e)
        }

        localFSSemaphore.release()

        return resolve(true)
    })
}

export const gracefulLStat = (path: string): Promise<any> => {
    return new Promise((resolve, reject) => {
        path = pathModule.normalize(path)

        const max = 16
        const timeout = 1000
        let current = 0

        const stat = (): void => {
            if(current > max){
                return reject("Max tries reached for gracefulLStat: " + path)
            }

            current += 1

            fs.lstat(path).then(resolve).catch((err: any) => {
                log.error(err)

                return setTimeout(stat, timeout)
            })
        }

        return stat()
    })
}

export const canReadAtPath = (fullPath: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        localFSSemaphore.acquire().then(() => {
            fs.access(pathModule.normalize(fullPath), fs.constants.R_OK, (err: any) => {
                localFSSemaphore.release()

                if(err){

                    return reject(err)
                }
    
                return resolve(true)
            })
        })
    })
}

export const canWriteAtPath = (fullPath: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        localFSSemaphore.acquire().then(() => {
            fs.access(pathModule.normalize(fullPath), fs.constants.W_OK, (err: any) => {
                localFSSemaphore.release()

                if(err){

                    return reject(err)
                }
    
                return resolve(true)
            })
        })
    })
}

export const canReadWriteAtPath = (fullPath: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        localFSSemaphore.acquire().then(() => {
            fs.access(pathModule.normalize(fullPath), fs.constants.R_OK | fs.constants.W_OK, (err: any) => {
                localFSSemaphore.release()

                if(err){

                    return reject(err)
                }
    
                return resolve(true)
            })
        })
    })
}

export const directoryTree = (path: string, skipCache: boolean = false, location?: any): Promise<any> => {
    return new Promise((resolve, reject) => {
        const cacheKey = "directoryTreeLocal:" + location.uuid

        Promise.all([
            db.get("localDataChanged:" + location.uuid),
            db.get(cacheKey),
            db.get("excludeDot")
        ]).then(([localDataChanged, cachedLocalTree, excludeDot]) => {
            if(excludeDot == null){
                excludeDot = true
            }
            
            if(!localDataChanged && cachedLocalTree !== null && !skipCache){
                return resolve({
                    changed: false,
                    data: cachedLocalTree
                })
            }

            path = normalizePath(path)

            const files: any = {}
            const folders: any = {}
            const ino: any = {}
            const windows: boolean = is.windows()
            let statting: number = 0

            const dirStream = readdirp(path, {
                alwaysStat: false,
                lstat: false,
                type: "all",
                depth: 2147483648,
                directoryFilter: ["!.filen.trash.local", "!System Volume Information"],
                fileFilter: ["!.filen.trash.local", "!System Volume Information"]
            })
            
            dirStream.on("data", async (item: any) => {
                statting += 1

                try{
                    if(windows){
                        item.path = item.path.split("\\").join("/") // Convert windows \ style path seperators to / for internal database, we only use UNIX style path seperators internally
                    }
    
                    let include = true
    
                    if(excludeDot && (item.basename.startsWith(".") || item.path.indexOf("/.") !== -1 || item.path.startsWith("."))){
                        include = false
                    }

                    if(!(await canReadWriteAtPath(item.fullPath))){
                        include = false
                    }
    
                    if(
                        include
                        && !isFolderPathExcluded(item.path)
                        && pathValidation(item.path)
                        && !pathIsFileOrFolderNameIgnoredByDefault(item.path)
                        && !isSystemPathExcluded("//" + item.fullPath)
                    ){
                        item.stats = await gracefulLStat(item.fullPath)

                        if(!item.stats.isSymbolicLink()){
                            if(item.stats.isDirectory()){
                                folders[item.path] = {
                                    name: item.basename,
                                    lastModified: convertTimestampToMs(parseInt(item.stats.mtimeMs.toString())) //.toString() because of BigInt
                                }
        
                                ino[item.stats.ino] = {
                                    type: "folder",
                                    path: item.path
                                }
                            }
                            else{
                                if(item.stats.size > 0){
                                    files[item.path] = {
                                        name: item.basename,
                                        size: parseInt(item.stats.size.toString()), //.toString() because of BigInt
                                        lastModified: convertTimestampToMs(parseInt(item.stats.mtimeMs.toString())) //.toString() because of BigInt
                                    }
        
                                    ino[item.stats.ino] = {
                                        type: "file",
                                        path: item.path
                                    }
                                }
                            }
                        }
                    }
                }
                catch(e){
                    log.error(e)
                }

                statting -= 1
            })
            
            dirStream.on("warn", (warn: any) => {
                log.warn("Readdirp warning:", warn)
            })
            
            dirStream.on("error", (err: any) => {
                dirStream.destroy()

                statting = 0
                
                return reject(err)
            })
            
            dirStream.on("end", async () => {
                await new Promise((resolve) => {
                    const wait = setInterval(() => {
                        if(statting <= 0){
                            clearInterval(wait)

                            return resolve(true)
                        }
                    }, 10)
                })

                statting = 0

                dirStream.destroy()
                
                const obj = {
                    files,
                    folders,
                    ino
                }

                try{
                    await Promise.all([
                        db.set(cacheKey, obj),
                        db.set("localDataChanged:" + location.uuid, false)
                    ])
                }
                catch(e){
                    return reject(e)
                }

                return resolve({
                    changed: true,
                    data: obj
                })
            })
        }).catch(reject)
    })
}

export const readChunk = (path: string, offset: number, length: number): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
        path = pathModule.normalize(path)

        fs.open(path, "r", (err: any, fd: any) => {
            if(err){
                return reject(err)
            }

            const buffer = Buffer.alloc(length)

            fs.read(fd, buffer, 0, length, offset, (err: any, read: any) => {
                if(err){
                    return reject(err)
                }

                let data: any = undefined

                if(read < length){
                    data = buffer.slice(0, read)
                }
                else{
                    data = buffer
                }

                fs.close(fd, (err: any) => {
                    if(err){
                        return reject(err)
                    }

                    return resolve(data)
                })
            })
        })
    })
}

export const rm = (path: string): Promise<boolean> => {
    return new Promise(async (resolve, reject) => {
        path = normalizePath(path)

        await localFSSemaphore.acquire()

        try{
            var stats = await fs.lstat(path)
        }
        catch(e){
            localFSSemaphore.release()

            return resolve(true)
        }
    
        if(stats.isSymbolicLink()){
            try{
                await fs.unlink(path)
            }
            catch(e){
                localFSSemaphore.release()

                return reject(e)
            }
        }
        else{
            try{
                await fs.remove(path)
            }
            catch(e){
                localFSSemaphore.release()

                return reject(e)
            }
        }

        localFSSemaphore.release()

        return resolve(true)
    })
}

export const mkdir = (path: string, location: any, task: any): Promise<any> => {
    return new Promise((resolve, reject) => {
        localFSSemaphore.acquire().then(() => {
            const absolutePath = normalizePath(location.local + "/" + path)

            fs.ensureDir(absolutePath).then(() => {
                gracefulLStat(absolutePath).then((stat: any)  => {
                    localFSSemaphore.release()

                    return resolve(stat)
                }).catch((err: any) => {
                    localFSSemaphore.release()

                    return reject(err)
                })
            }).catch((err: any) => {
                localFSSemaphore.release()

                return reject(err)
            })
        })
    })
}

export const download = (path: string, location: any, task: any): Promise<any> => {
    return new Promise(async (resolve, reject) => {
        await new Promise((resolve) => {
            const getPausedStatus = () => {
                Promise.all([
                    db.get("paused"),
                    isSyncLocationPaused(location.uuid)
                ]).then(([paused, locationPaused]) => {
                    if(paused || locationPaused){
                        return setTimeout(getPausedStatus, 1000)
                    }

                    return resolve(true)
                }).catch((err) => {
                    log.error(err)

                    return setTimeout(getPausedStatus, 1000)
                })
            }

            return getPausedStatus()
        })

        try{
            var absolutePath = normalizePath(location.local + "/" + path)
            var file = task.item
        }
        catch(e){
            return reject(e)
        }

        getTempDir().then((tmpDir) => {
            try{
                var fileTmpPath = normalizePath(tmpDir + "/" + uuidv4())
            }
            catch(e){
                return reject(e)
            }

            Promise.all([
                rm(absolutePath),
                rm(fileTmpPath)
            ]).then(async () => {
                try{
                    var stream = fs.createWriteStream(fileTmpPath)
                }
                catch(e){
                    return reject(e)
                }

                const fileChunks = file.chunks
                let currentWriteIndex = 0

                const downloadTask = (index: number): Promise<{ index: number, data: Buffer }> => {
                    return new Promise((resolve, reject) => {
                        downloadChunk({ 
                            region: file.region,
                            bucket: file.bucket,
                            uuid: file.uuid,
                            index,
                            from: "sync",
                            location
                        }).then((data) => {
                            decryptData(data, file.metadata.key, file.version).then((decrypted) => {
                                return resolve({
                                    index,
                                    data: Buffer.from(decrypted)
                                })
                            }).catch(reject)
                        }).catch(reject)
                    })
                }

                const writeChunk = (index: number, data: Buffer) => {
                    if(index !== currentWriteIndex){
                        return setTimeout(() => {
                            writeChunk(index, data)
                        }, 10)
                    }

                    stream.write(data, (err: any) => {
                        if(err){
                            return reject(err)
                        }

                        currentWriteIndex += 1

                        return true
                    })
                }

                try{
                    await new Promise((resolve, reject) => {
                        let done = 0

                        for(let i = 0; i < fileChunks; i++){
                            downloadThreadsSemaphore.acquire().then(() => {
                                downloadTask(i).then(({ index, data }) => {
                                    writeChunk(index, data)

                                    done += 1

                                    downloadThreadsSemaphore.release()

                                    if(done >= fileChunks){
                                        return resolve(true)
                                    }
                                }).catch((err) => {
                                    downloadThreadsSemaphore.release()

                                    return reject(err)
                                })
                            })
                        }
                    })

                    await new Promise((resolve) => {
                        if(currentWriteIndex >= fileChunks){
                            return resolve(true)
                        }

                        const wait = setInterval(() => {
                            if(currentWriteIndex >= fileChunks){
                                clearInterval(wait)

                                return resolve(true)
                            }
                        }, 10)
                    })

                    await new Promise((resolve, reject) => {
                        stream.close((err: any) => {
                            if(err){
                                return reject(err)
                            }

                            return resolve(true)
                        })
                    })
                }
                catch(e){
                    fs.unlink(fileTmpPath)

                    return reject(e)
                }

                const now = new Date().getTime()
                const lastModified = convertTimestampToMs(file.metadata.lastModified)
                const utimesLastModified = typeof lastModified == "number" && lastModified > 0 && now > lastModified ? lastModified : (now - 60000)

                move(fileTmpPath, absolutePath).then(() => {
                    fs.utimes(absolutePath, new Date(utimesLastModified), new Date(utimesLastModified)).then(() => {
                        checkLastModified(absolutePath).then(() => {
                            gracefulLStat(absolutePath).then((stat: any) => {
                                if(stat.size <= 0){
                                    rm(absolutePath)
            
                                    return reject(new Error(absolutePath + " size = " + stat.size))
                                }
                                
                                return resolve(stat)
                            }).catch(reject)
                        }).catch(reject)
                    }).catch(reject)
                }).catch(reject)
            }).catch(reject)
        }).catch(reject)
    })
}

export const move = (before: string, after: string, overwrite: boolean = true): Promise<any> => {
    return new Promise((resolve, reject) => {
        localFSSemaphore.acquire().then(() => {
            try{
                before = normalizePath(before)
                after = normalizePath(after)
            }
            catch(e){
                localFSSemaphore.release()

                return reject(e)
            }
    
            fs.move(before, after, {
                overwrite
            }).then((res: any) => {
                localFSSemaphore.release()

                return resolve(res)
            }).catch((err: any) => {
                localFSSemaphore.release()

                return reject(err)
            })
        })
    })
}

export const rename = (before: string, after: string): Promise<any> => {
    return new Promise((resolve, reject) => {
        localFSSemaphore.acquire().then(() => {
            try{
                before = normalizePath(before)
                after = normalizePath(after)
            }
            catch(e){
                localFSSemaphore.release()

                return reject(e)
            }
    
            fs.rename(before, after).then((res: any) => {
                localFSSemaphore.release()

                return resolve(res)
            }).catch((err: any) => {
                localFSSemaphore.release()

                return reject(err)
            })
        })
    })
}