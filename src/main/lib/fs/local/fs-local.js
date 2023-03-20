const fs = require("fs-extra")
const pathModule = require("path")
const readdirp = require("readdirp")
const log = require("electron-log")
const is = require("electron-is")
const { app } = require("electron")
const constantsJSON = require("../../../../constants.json")

const FS_RETRIES = 8
const FS_RETRY_TIMEOUT = 100
const FS_RETRY_CODES = ["EAGAIN", "EBUSY", "ECANCELED", "EBADF", "EINTR", "EIO", "EMFILE", "ENFILE", "ENOMEM", "EPIPE", "ETXTBSY", "ESPIPE", "EAI_SYSTEM", "EAI_CANCELED"]
const FS_NORETRY_CODES = ["ENOENT", "ENODEV", "EACCES", "EPERM", "EINVAL", "ENAMETOOLONG", "ENOBUFS", "ENOSPC", "EROFS"]
let LOCAL_TRASH_DIRS_CLEAN_INTERVAL
const cache = new Map()

const normalizePath = (path) => {
    return pathModule.normalize(path)
}

const getTempDir = () => {
    const tmpDirRes = app.getPath("temp")
    const tmpDir = normalizePath(tmpDirRes)

    return tmpDir
}

const gracefulLStat = (path) => {
    return new Promise((resolve, reject) => {
        path = normalizePath(path)

        const cacheKey = "gracefulLStat:" + path
        let currentTries = 0
        let lastErr = undefined

        const req = () => {
            if(currentTries > FS_RETRIES){
                return reject(lastErr)
            }

            currentTries += 1

            fs.lstat(path).then((stats) => {
                stats = {
                    ...stats,
                    isLink: stats.isSymbolicLink(),
                    isDir: stats.isDirectory(),
                    file: stats.isFile()
                }

                cache.set(cacheKey, stats)

                return resolve(stats)
            }).catch((err) => {
                if(err.code == "EPERM" && cache.has(cacheKey)){
                    return resolve(cache.get(cacheKey))
                }

                lastErr = err

                if(FS_RETRY_CODES.includes(err.code)){
                    return setTimeout(req, FS_RETRY_TIMEOUT)
                }

                return reject(err)
            })
        }

        return req()
    })
}

const exists = (fullPath) => {
    return new Promise((resolve) => {
        const path = normalizePath(fullPath)

        fs.access(path, fs.constants.F_OK, (err) => {
            if(err){
                return resolve(false)
            }

            return resolve(true)
        })
    })
}

const doesExistLocally = async (path) => {
    try{
        await exists(normalizePath(path))

        return true
    }
    catch{
        return false
    }
}

const canReadWriteAtPath = (fullPath) => {
    return new Promise((resolve) => {
        fullPath = normalizePath(fullPath)

        const req = (path) => {
            fs.access(path, fs.constants.W_OK | fs.constants.R_OK, (err) => {
                if(err){
                    if(err.code){
                        if(err.code == "EPERM"){
                            log.error(err)

                            return resolve(false)
                        }
                        else if(err.code == "ENOENT"){
                            const newPath = pathModule.dirname(path)

                            if(newPath.length > 0){
                                return setImmediate(() => req(newPath))
                            }

                            return resolve(false)
                        }
                    }

                    log.error(err)
    
                    return resolve(false)
                }
    
                return resolve(true)
            })
        }

        return req(fullPath)
    })
}

const canReadAtPath = (fullPath) => {
    return new Promise((resolve) => {
        fullPath = normalizePath(fullPath)

        const req = (path) => {
            fs.access(path, fs.constants.R_OK, (err) => {
                if(err){
                    if(err.code){
                        if(err.code == "EPERM"){
                            log.error(err)

                            return resolve(false)
                        }
                        else if(err.code == "ENOENT"){
                            const newPath = pathModule.dirname(path)

                            if(newPath.length > 0){
                                return setImmediate(() => req(newPath))
                            }

                            return resolve(false)
                        }
                    }

                    log.error(err)
    
                    return resolve(false)
                }
    
                return resolve(true)
            })
        }

        return req(fullPath)
    })
}

const smokeTest = async (path) => {
    path = normalizePath(path)

    const tmpDir = getTempDir()

    if(!(await canReadWriteAtPath(path))){
        throw new Error("Cannot read/write at path " + path)
    }

    if(!(await canReadWriteAtPath(tmpDir))){
        throw new Error("Cannot read/write at path " + tmpDir)
    }

    await Promise.all([
        gracefulLStat(path),
        gracefulLStat(tmpDir)
    ])
}

const readChunk = (path, offset, length) => {
    return new Promise((resolve, reject) => {
        path = normalizePath(path)

        let currentTries = 0
        let lastErr = undefined

        const req = () => {
            if(currentTries > FS_RETRIES){
                return reject(lastErr)
            }

            currentTries += 1

            fs.open(path, "r", (err, fd) => {
                if(err){
                    lastErr = err
            
                    if(FS_RETRY_CODES.includes(err.code)){
                        return setTimeout(req, FS_RETRY_TIMEOUT)
                    }
                    
                    return reject(err)
                }
    
                const buffer = Buffer.alloc(length)
    
                fs.read(fd, buffer, 0, length, offset, (err, read) => {
                    if(err){
                        lastErr = err
            
                        if(FS_RETRY_CODES.includes(err.code)){
                            return setTimeout(req, FS_RETRY_TIMEOUT)
                        }
                        
                        return reject(err)
                    }
    
                    let data = undefined
    
                    if(read < length){
                        data = buffer.slice(0, read)
                    }
                    else{
                        data = buffer
                    }
    
                    fs.close(fd, (err) => {
                        if(err){
                            lastErr = err
            
                            if(FS_RETRY_CODES.includes(err.code)){
                                return setTimeout(req, FS_RETRY_TIMEOUT)
                            }
                            
                            return reject(err)
                        }
    
                        return resolve(data)
                    })
                })
            })
        }

        return req()
    })
}

const rm = async (path, location) => {
    path = normalizePath(path)

    const trashDirPath = normalizePath(pathModule.join(location.local, ".filen.trash.local"))
    const basename = pathModule.basename(path)

    if(!(await doesExistLocally(path))){
        cache.delete("gracefulLStat:" + path)

        return
    }

    if((await isFileBusy(path))){
        throw new Error("EBUSY: " + path)
    }

    await fs.ensureDir(trashDirPath)
    
    try{
        await move(path, normalizePath(pathModule.join(trashDirPath, basename)))
    }
    catch(e){
        if(e.code && e.code == "ENOENT"){
            cache.delete("gracefulLStat:" + path)

            return
        }

        throw e
    }

    cache.delete("gracefulLStat:" + path)
}

const rmPermanent = (path) => {
    return new Promise(async (resolve, reject) => {
        path = normalizePath(path)

        if(!(await doesExistLocally(path))){
            cache.delete("gracefulLStat:" + normalizePath(path))

            return resolve()
        }

        if((await isFileBusy(path))){
            return reject(new Error("EBUSY: " + path))
        }

        try{
            var stats = await gracefulLStat(path)
        }
        catch(e){
            if(e.code && e.code == "ENOENT"){
                cache.delete("gracefulLStat:" + normalizePath(path))

                return resolve()
            }

            return reject(e)
        }

        let currentTries = 0
        let lastErr = undefined

        const req = async () => {
            if(currentTries > FS_RETRIES){
                return reject(lastErr)
            }

            currentTries += 1
        
            if(stats.isLink){
                try{
                    await fs.unlink(path)

                    cache.delete("gracefulLStat:" + normalizePath(path))
                }
                catch(e){
                    lastErr = e

                    if(e.code == "ENOENT"){
                        cache.delete("gracefulLStat:" + normalizePath(path))

                        return resolve()
                    }

                    if(FS_RETRY_CODES.includes(e.code)){
                        return setTimeout(req, FS_RETRY_TIMEOUT)
                    }
                    
                    return reject(e)
                }
            }
            else{
                try{
                    await fs.remove(path)

                    cache.delete("gracefulLStat:" + normalizePath(path))
                }
                catch(e){
                    lastErr = e

                    if(e.code == "ENOENT"){
                        cache.delete("gracefulLStat:" + normalizePath(path))

                        return resolve()
                    }

                    if(FS_RETRY_CODES.includes(e.code)){
                        return setTimeout(req, FS_RETRY_TIMEOUT)
                    }
                    
                    return reject(e)
                }
            }
    
            return resolve()
        }

        return req()
    })
}

const mkdir = (path, location) => {
    return new Promise((resolve, reject) => {
        const absolutePath = normalizePath(pathModule.join(location.local, path))
        let currentTries = 0
        let lastErr = undefined

        const req = () => {
            if(currentTries > FS_RETRIES){
                return reject(lastErr)
            }

            currentTries += 1

            fs.ensureDir(absolutePath).then(() => {
                gracefulLStat(absolutePath).then(resolve).catch((err) => {
                    lastErr = err
    
                    if(FS_RETRY_CODES.includes(err.code)){
                        return setTimeout(req, FS_RETRY_TIMEOUT)
                    }

                    return reject(err)
                })
            }).catch((err) => {
                lastErr = err

                if(FS_RETRY_CODES.includes(err.code)){
                    return setTimeout(req, FS_RETRY_TIMEOUT)
                }
                
                return reject(err)
            })
        }

        return req()
    })
}

const move = (before, after, overwrite = true) => {
    return new Promise(async (resolve, reject) => {
        try{
            before = normalizePath(before)
            after = normalizePath(after)
        }
        catch(e){
            return reject(e)
        }

        if(!(await doesExistLocally(before))){
            return resolve(true)
        }

        if((await isFileBusy(before))){
            return reject(new Error("EBUSY: " + before))
        }

        let currentTries = 0
        let lastErr = undefined

        const req = () => {
            if(currentTries > FS_RETRIES){
                return reject(lastErr)
            }

            currentTries += 1

            fs.move(before, after, {
                overwrite
            }).then(resolve).catch((err) => {
                lastErr = err

                if(FS_RETRY_CODES.includes(err.code)){
                    return setTimeout(req, FS_RETRY_TIMEOUT)
                }
                
                return reject(err)
            })
        }

        return req()
    })
}

const rename = (before, after) => {
    return new Promise(async (resolve, reject) => {
        try{
            before = normalizePath(before)
            after = normalizePath(after)
        }
        catch(e){
            return reject(e)
        }

        if(!(await doesExistLocally(before))){
            return resolve(true)
        }

        if((await isFileBusy(before))){
            return reject(new Error("EBUSY: " + before))
        }

        let currentTries = 0
        let lastErr = undefined

        const req = () => {
            if(currentTries > FS_RETRIES){
                return reject(lastErr)
            }

            currentTries += 1

            fs.rename(before, after).then(resolve).catch((err) => {
                lastErr = err

                if(FS_RETRY_CODES.includes(err.code)){
                    return setTimeout(req, FS_RETRY_TIMEOUT)
                }

                return reject(err)
            })
        }

        return req()
    })
}

const createLocalTrashDirs = async () => {
    const userId = await require("../../db").get("userId")

    if(!userId || !Number.isInteger(userId)){
        return
    }

    const syncLocations = await require("../../db").get("syncLocations:" + userId)

    if(!syncLocations || !Array.isArray(syncLocations)){
        return
    }

    await Promise.all([
        ...syncLocations.map(location => fs.ensureDir(normalizePath(pathModule.join(location.local, ".filen.trash.local"))))
    ])
}

const clearLocalTrashDirs = (clearNow = false) => {
    return new Promise((resolve, reject) => {
        require("../../db").get("userId").then((userId) => {
            if(!userId || !Number.isInteger(userId)){
                return
            }
    
            Promise.all([
                require("../../db").get("syncLocations:" + userId),
                createLocalTrashDirs()
            ]).then(([syncLocations, _]) => {
                if(!syncLocations || !Array.isArray(syncLocations)){
                    return
                }
        
                Promise.allSettled([
                    ...syncLocations.map(location => new Promise((resolve, reject) => {
                        const path = normalizePath(pathModule.join(location.local, ".filen.trash.local"))
        
                        const dirStream = readdirp(path, {
                            alwaysStat: false,
                            lstat: false,
                            type: "all",
                            depth: 2147483648
                        })
        
                        let statting = 0
                        const pathsToTrash = []
                        const now = new Date().getTime()
                        let dirSize = 0
                        
                        dirStream.on("data", async (item) => {
                            statting += 1
            
                            if(clearNow){
                                pathsToTrash.push(item.fullPath)
                            }
                            else{
                                try{
                                    item.stats = await gracefulLStat(item.fullPath)
            
                                    if(!item.stats.isLink){
                                        if((item.stats.ctimeMs + constants.deleteFromLocalTrashAfter) <= now){
                                            pathsToTrash.push(item.fullPath)
                                        }
            
                                        dirSize += item.stats.size
                                    }
                                }
                                catch(e){
                                    log.error(e)
                                }
                            }
            
                            statting -= 1
                        })
                        
                        dirStream.on("warn", (warn) => {
                            log.error("[Local trash] Readdirp warning:", warn)
                        })
                        
                        dirStream.on("error", (err) => {
                            dirStream.destroy()
            
                            statting = 0
                            
                            return reject(err)
                        })
                        
                        dirStream.on("end", async () => {
                            await new Promise((resolve) => {
                                if(statting <= 0){
                                    return resolve()
                                }
            
                                const wait = setInterval(() => {
                                    if(statting <= 0){
                                        clearInterval(wait)
            
                                        return resolve()
                                    }
                                }, 10)
                            })
            
                            statting = 0
            
                            dirStream.destroy()
    
                            await Promise.allSettled([
                                require("../../db").set("localTrashDirSize:" + location.uuid, clearNow ? 0 : dirSize),
                                ...pathsToTrash.map(pathToTrash => rmPermanent(pathToTrash))
                            ])
    
                            return resolve()
                        })
                    }))
                ]).then(() => resolve())
            }).catch(reject)
        }).catch(reject)
    })
}

const initLocalTrashDirs = (interval) => {
    clearLocalTrashDirs().catch(log.error)

    clearInterval(LOCAL_TRASH_DIRS_CLEAN_INTERVAL)

    LOCAL_TRASH_DIRS_CLEAN_INTERVAL = setInterval(() => {
        clearLocalTrashDirs().catch(log.error)
    }, interval)
}

const checkLastModified = (path) => {
    return new Promise((resolve, reject) => {
        path = normalizePath(path)

        gracefulLStat(path).then(async (stat) => {
            if(stat.mtimeMs > 0){
                return resolve({
                    changed: false
                })
            }

            if((await isFileBusy(path))){
                return reject(new Error("EBUSY: " + path))
            }

            const lastModified = new Date(new Date().getTime() - 60000)
            const mtimeMs = lastModified.getTime()
            
            let currentTries = 0
            let lastErr = undefined

            const req = () => {
                if(currentTries > FS_RETRIES){
                    return reject(lastErr)
                }

                currentTries += 1

                fs.utimes(path, lastModified, lastModified).then(() => {
                    return resolve({
                        changed: true,
                        mtimeMs 
                    })
                }).catch((err) => {
                    lastErr = err

                    if(FS_RETRY_CODES.includes(err.code)){
                        return setTimeout(req, FS_RETRY_TIMEOUT)
                    }
                    
                    return reject(err)
                })
            }

            return req()
        }).catch(reject)
    })
}

const isFileBusy = (path) => {
    return new Promise((resolve, reject) => {
        path = normalizePath(path)

        let currentTries = -1
        const maxTries = 30
        const timeout = 1000
        let lastErr = undefined

        const req = () => {
            currentTries += 1

            if(currentTries >= maxTries){
                if(lastErr && lastErr.code && lastErr.code == "EBUSY"){
                    return resolve(true)
                }

                return resolve(false)
            }

            fs.open(path, "r+", (err, fd) => {
                if(err){
                    lastErr = err

                    if(err.code == "EBUSY"){
                        setTimeout(req, timeout)

                        return
                    }

                    return resolve(false)
                }
                
                fs.close(fd, () => resolve(false))
            })
        }

        req()
    })
}

const windowsPathToUnixStyle = (path) => {
	return path.split("\\").join("/")
}

const pathIncludesDot = (path) => {
	return (path.indexOf("/.") !== -1 || path.startsWith("."))
}

const isFolderPathExcluded = (path) => {
	const real = path

	path = path.toLowerCase()

	for(let i = 0; i < constantsJSON.defaultIgnored.folders.length; i++){
		if(
			path.indexOf(constantsJSON.defaultIgnored.folders[i].toLowerCase()) !== -1
			|| real.indexOf(constantsJSON.defaultIgnored.folders[i]) !== -1
		){
			return true
		}
	}

  	return false
}

const fileAndFolderNameValidation = (name) => {
	const regex = /[<>:"\/\\|?*\x00-\x1F]|^(?:aux|con|clock\$|nul|prn|com[1-9]|lpt[1-9])$/i

	if(regex.test(name)){
		return false
	}

	return true
}

const pathValidation = (path) => {
	if(path.indexOf("/") == -1){
		return fileAndFolderNameValidation(path)
	}
	
	const ex = path.split("/")

	for(let i = 0; i < ex.length; i++){
		if(!fileAndFolderNameValidation(ex[i].trim())){
			return false
		}
	}

	return true
}

const isFileOrFolderNameIgnoredByDefault = (name) => {
	if(typeof name !== "string"){
		return true
	}

	name = name.toLowerCase().trim()

	if(name.length <= 0){
		return true
	}

	if(name.length >= 256){
		return true
	}

	if(name.substring(0, 1) == " "){
		return true
	}

	if(name.slice(-1) == " "){
		return true
	}

	if(name.indexOf("\n") !== -1){
		return true
	}

	if(name.indexOf("\r") !== -1){
		return true
	}

	if(constantsJSON.defaultIgnored.names.includes(name)){
		return true
	}

	if(name.substring(0, 7) == ".~lock."){
		return true
	}

	if(name.substring(0, 2) == "~$"){
		return true
	}

	if(name.substring(name.length - 4) == ".tmp"){
		return true
	}

	if(name.substring(name.length - 5) == ".temp"){
		return true
	}

	let ext = name.split(".")

	if(ext.length >= 2){
		ext = ext[ext.length - 1]

		if(typeof ext == "string"){
			ext = ext.trim()

			if(ext.length > 0){
				if(constantsJSON.defaultIgnored.extensions.includes(ext)){
					return true
				}
			}
		}
	}

	return false
}

const pathIsFileOrFolderNameIgnoredByDefault = (path) => {
	if(path.indexOf("/") == -1){
		return isFileOrFolderNameIgnoredByDefault(path)
	}
	
	const ex = path.split("/")

	for(let i = 0; i < ex.length; i++){
		if(isFileOrFolderNameIgnoredByDefault(ex[i].trim())){
			return true
		}
	}

	return false
}

const isSystemPathExcluded = (path) => {
	const real = path

	path = path.toLowerCase()

	for(let i = 0; i < constantsJSON.defaultIgnored.system.length; i++){
		if(
			path.indexOf(constantsJSON.defaultIgnored.system[i].toLowerCase()) !== -1
			|| real.indexOf(constantsJSON.defaultIgnored.system[i]) !== -1
		){
			return true
		}
	}

  	return false
}

const isPathOverMaxLength = (path) => {
	if(is.linux()){
		return path.length > 4095
	}
	else if(is.macOS()){
		return path.length > 1023
	}
	else if(is.windows()){
		return path.length > 399
	}

	return path.length > 399
}

const isNameOverMaxLength = (name) => {
	if(is.linux()){
		return name.length > 255
	}
	else if(is.macOS()){
		return name.length > 255
	}
	else if(is.windows()){
		return name.length > 255
	}

	return name.length > 255
}

const directoryTree = (path, skipCache = false, location) => {
    return new Promise((resolve, reject) => {
        const cacheKey = "directoryTreeLocal:" + location.uuid

        Promise.all([
            require("../../db").get("localDataChanged:" + location.uuid),
            require("../../db").get(cacheKey),
            require("../../db").get("excludeDot")
        ]).then(async ([localDataChanged, cachedLocalTree, excludeDot]) => {
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

            const files = {}
            const folders = {}
            const ino = {}
            const windows = is.windows()
            let statting = 0

            const dirStream = readdirp(path, {
                alwaysStat: false,
                lstat: false,
                type: "all",
                depth: 2147483648,
                directoryFilter: ["!.filen.trash.local", "!System Volume Information"],
                fileFilter: ["!.filen.trash.local", "!System Volume Information"]
            })
            
            dirStream.on("data", async (item) => {
                statting += 1

                try{
                    if(windows){
                        item.path = windowsPathToUnixStyle(item.path)
                    }

                    let include = true
    
                    if(excludeDot && (item.basename.startsWith(".") || pathIncludesDot(item.path))){
                        include = false
                    }
    
                    if(
                        include
                        && !isFolderPathExcluded(item.path)
                        && pathValidation(item.path)
                        && !pathIsFileOrFolderNameIgnoredByDefault(item.path)
                        && !isSystemPathExcluded("//" + item.fullPath)
                        && !isNameOverMaxLength(item.basename)
                        && !isPathOverMaxLength(location.local + "/" + item.path)
                    ){
                        item.stats = await gracefulLStat(item.fullPath)

                        if(!item.stats.isLink){
                            if(item.stats.isDir){
                                const inoNum = parseInt(item.stats.ino.toString()) //.toString() because of BigInt
                                const entry = {
                                    name: item.basename,
                                    size: 0,
                                    lastModified: parseInt(item.stats.mtimeMs.toString()), //.toString() because of BigInt
                                    ino: inoNum
                                }

                                folders[item.path] = entry
                                ino[inoNum] = {
                                    type: "folder",
                                    path: item.path
                                }
                            }
                            else{
                                if(item.stats.size > 0){
                                    const inoNum = parseInt(item.stats.ino.toString()) //.toString() because of BigInt
                                    const entry = {
                                        name: item.basename,
                                        size: parseInt(item.stats.size.toString()), //.toString() because of BigInt
                                        lastModified: parseInt(item.stats.mtimeMs.toString()), //.toString() because of BigInt
                                        ino: inoNum
                                    }

                                    files[item.path] = entry
                                    ino[inoNum] = {
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

                    require("../../ipc").addSyncIssue({
                        uuid: uuidv4(),
                        type: "warning",
                        where: "local",
                        path: item.fullPath,
                        err: e,
                        info: "Could not read " + item.fullPath,
                        timestamp: new Date().getTime()
                    })
                }

                statting -= 1
            })
            
            dirStream.on("warn", (warn) => {
                log.error("Readdirp warning:", warn)
            })
            
            dirStream.on("error", (err) => {
                dirStream.destroy()

                statting = 0
                
                return reject(err)
            })
            
            dirStream.on("end", async () => {
                await new Promise((resolve) => {
                    if(statting <= 0){
                        return resolve()
                    }

                    const wait = setInterval(() => {
                        if(statting <= 0){
                            clearInterval(wait)

                            return resolve()
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
                        require("../../db").set(cacheKey, obj),
                        require("../../db").set("localDataChanged:" + location.uuid, false)
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

const utimes = async (path, atime, mtime) => {
    path = normalizePath(path)

    return await fs.utimes(path, atime, mtime)
}

const unlink = async (path) => {
    path = normalizePath(path)

    return await fs.unlink(path)
}

const remove = async (path) => {
    path = normalizePath(path)

    return await fs.remove(path)
}

const mkdirNormal = async (path, options = { recursive: true }) => {
    path = normalizePath(path)

    return await fs.mkdir(path, options)
}

const access = (path, mode) => {
    return new Promise((resolve, reject) => {
        path = normalizePath(path)

        fs.access(path, mode, (err) => {
            if(err){
                return reject(err)
            }

            return resolve()
        })
    })
}

const appendFile = async (path, data, options = undefined) => {
    path = normalizePath(path)

    return await fs.appendFile(path, data, options)
}

module.exports = {
    normalizePath,
    getTempDir,
    gracefulLStat,
    exists,
    doesExistLocally,
    canReadWriteAtPath,
    smokeTest,
    readChunk,
    rm,
    rmPermanent,
    mkdir,
    move,
    rename,
    createLocalTrashDirs,
    clearLocalTrashDirs,
    initLocalTrashDirs,
    checkLastModified,
    canReadAtPath,
    isFileBusy,
    directoryTree,
    utimes,
    unlink,
    remove,
    mkdirNormal,
    access,
    appendFile
}