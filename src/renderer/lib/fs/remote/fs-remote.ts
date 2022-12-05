import { folderPresent, dirTree, createFolder, folderExists, uploadChunk, markUploadAsDone, checkIfItemParentIsShared, trashItem, moveFile, moveFolder, renameFile, renameFolder } from "../../api"
import db from "../../db"
import { decryptFolderName, decryptFileMetadata, hashFn, encryptMetadata, encryptData } from "../../crypto"
import { convertTimestampToMs, pathIsFileOrFolderNameIgnoredByDefault, generateRandomString, Semaphore, isFolderPathExcluded, pathValidation, isPathOverMaxLength, isNameOverMaxLength, pathIncludesDot } from "../../helpers"
import { normalizePath, smokeTest as smokeTestLocal, readChunk, checkLastModified } from "../local"
import { chunkSize, maxUploadThreads } from "../../constants"
import { v4 as uuidv4 } from "uuid"
import { sendToAllPorts } from "../../worker/ipc"
import { remoteStorageLeft } from "../../user/info"
import { isSyncLocationPaused } from "../../worker/sync/sync.utils"
import { canReadWriteAtPath } from "../local"
import memoryCache from "../../memoryCache"

const pathModule = window.require("path")
const log = window.require("electron-log")
const mimeTypes = window.require("mime-types")

const findOrCreateParentDirectorySemaphore = new Semaphore(1)
const createDirectorySemaphore = new Semaphore(1)
const uploadThreadsSemaphore = new Semaphore(maxUploadThreads)
const folderPathUUID = new Map()

const UPLOAD_VERSION: number = 2
const previousDatasets: { [key: string]: string } = {}

export const smokeTest = async (uuid: string = ""): Promise<boolean> => {
    const response = await folderPresent({ apiKey: await db.get("apiKey"), uuid })

    if(!response.present || response.trash){
        throw new Error("Remote folder " + uuid + " is not present: " + JSON.stringify(response))
    }

    return true
}

export const directoryTree = (uuid: string = "", skipCache: boolean = false, location: any): Promise<any> => {
    return new Promise((resolve, reject) => {
        Promise.all([
            db.get("deviceId"),
            db.get("apiKey"),
            db.get("masterKeys"),
            db.get("excludeDot")
        ]).then(([deviceId, apiKey, masterKeys, excludeDot]) => {
            if(excludeDot == null){
                excludeDot = true
            }
            
            if(!Array.isArray(masterKeys)){
                return reject(new Error("Master keys not array"))
            }

            if(masterKeys.length == 0){
                return reject(new Error("Invalid master keys, length = 0"))
            }

            dirTree({ apiKey, uuid, deviceId, skipCache, includeRaw: true }).then(async (res) => {
                const cacheKey: string = "directoryTree:" + uuid + ":" + deviceId
                const response = res.data
                const raw = res.raw

                if(response.folders.length == 0 && response.files.length == 0){ // Data did not change
                    try{
                        var dbCache = await db.get(cacheKey)

                        if(dbCache){
                            return resolve({
                                changed: false,
                                data: dbCache
                            })
                        }
                    }
                    catch(e){
                        log.error(e)
                    }

                    return directoryTree(uuid, true, location).then(resolve).catch(reject)
                }

                const rawEx = raw.split('"randomBytes"')

                if(rawEx.length == 2){
                    if(previousDatasets[location.uuid] && previousDatasets[location.uuid] === rawEx[0]){
                        try{
                            var dbCache = await db.get(cacheKey)
    
                            if(dbCache){
                                return resolve({
                                    changed: false,
                                    data: dbCache
                                })
                            }
                        }
                        catch(e){
                            log.error(e)
                        }
                    }
                }

                folderPathUUID.clear()

                if(typeof location !== "undefined"){
                    sendToAllPorts({
                        type: "syncStatus",
                        data: {
                            type: "dataChanged",
                            data: {
                                locationUUID: location.uuid
                            }
                        }
                    })
                }

                const [baseFolderUUID, baseFolderMetadata, baseFolderParent] = response.folders[0]
                const baseFolderName = await decryptFolderName(baseFolderMetadata, masterKeys)

                if(baseFolderParent !== "base"){
                    return reject(new Error("Invalid base folder parent"))
                }

                if(baseFolderName.length <= 0){
                    return reject(new Error("Could not decrypt base folder name"))
                }

                const addedFolders: { [key: string]: boolean } = {}
                const addedFiles: { [key: string]: boolean } = {}
                const builtTreeFiles: any = {}
                const builtTreeFolders: any = {}
                const builtTreeUUIDs: any = {}
                const uuidsToPaths: any = {}

                const promises = [
                    ...response.folders.map(
                        (folder: string[]) => {
                            const [uuid, metadata, parent] = folder

                            return new Promise((resolve) => {
                                decryptFolderName(metadata, masterKeys).then((name) => {
                                    new Promise<string>((resolve) => {
                                        const parentExists = (): any => {
                                            if(parent == "base"){
                                                return resolve("")
                                            }
                                            else{
                                                if(uuidsToPaths[parent]){
                                                    return resolve(uuidsToPaths[parent])
                                                }
                                                
                                                return setImmediate(parentExists)
                                            }
                                        }
            
                                        return parentExists()
                                    }).then((parentPath) => {
                                        const foundParentPath = parentPath.length == 0 ? "" : parentPath + "/"
                                        const thisPath = foundParentPath + name

                                        if(parent !== "base" && thisPath.indexOf("/") == -1){
                                            return resolve(true)
                                        }

                                        const entryPath = thisPath.split("/").slice(1).join("/")
        
                                        uuidsToPaths[uuid] = thisPath
        
                                        let include = true
        
                                        if(
                                            typeof name !== "string"
                                            || name.length <= 0
                                            || isNameOverMaxLength(name)
                                            || (excludeDot && pathIncludesDot(entryPath))
                                            || !pathValidation(entryPath)
                                            || pathIsFileOrFolderNameIgnoredByDefault(entryPath)
                                            || isFolderPathExcluded(entryPath)
                                            || isPathOverMaxLength(location.local + "/" + entryPath)
                                        ){
                                            include = false
                                        }
        
                                        if(include && parent !== "base" && !addedFolders[parent + ":" + name]){
                                            addedFolders[parent + ":" + name] = true

                                            builtTreeFolders[entryPath] = {
                                                uuid,
                                                name,
                                                parent,
                                                type: "folder",
                                                path: entryPath
                                            }
        
                                            builtTreeUUIDs[uuid] = {
                                                type: "folder",
                                                path: entryPath
                                            }
                                        }
        
                                        return resolve(true)
                                    }).catch(resolve)
                                }).catch(resolve)
                            })
                        }
                    ),
                    ...response.files.map(
                        (file: string[]) => {
                            const [uuid, bucket, region, chunks, parent, metadata, version, timestamp] = file

                            return new Promise((resolve) => {
                                decryptFileMetadata(metadata, masterKeys).then((decrypted) => {
                                    if(typeof decrypted.lastModified == "number"){
                                        if(decrypted.lastModified <= 0){
                                            decrypted.lastModified = timestamp
                                        }
                                    }
                                    else{
                                        decrypted.lastModified = timestamp
                                    }
            
                                    decrypted.lastModified = convertTimestampToMs(decrypted.lastModified)
            
                                    new Promise<string>((resolve) => {
                                        const parentExists = (): any => {
                                            if(parent == "base"){
                                                return resolve("")
                                            }
                                            else{
                                                if(uuidsToPaths[parent]){
                                                    return resolve(uuidsToPaths[parent])
                                                }
                                                
                                                return setImmediate(parentExists)
                                            }
                                        }
            
                                        return parentExists()
                                    }).then((parentPath) => {
                                        const foundParentPath = parentPath.length == 0 ? "" : parentPath + "/"
                                        const thisPath = parent == "base" ? decrypted.name : foundParentPath + decrypted.name

                                        if(parent !== "base" && thisPath.indexOf("/") == -1){
                                            return resolve(true)
                                        }

                                        const entryPath = thisPath.split("/").slice(1).join("/")
                
                                        let include = true
                
                                        if(
                                            typeof decrypted.name !== "string"
                                            || decrypted.name.length <= 0
                                            || isNameOverMaxLength(decrypted.name)
                                            || (excludeDot && pathIncludesDot(entryPath))
                                            || !pathValidation(entryPath)
                                            || pathIsFileOrFolderNameIgnoredByDefault(entryPath)
                                            || isFolderPathExcluded(entryPath)
                                            || isPathOverMaxLength(location.local + "/" + entryPath)
                                        ){
                                            include = false
                                        }
                
                                        if(include && parent !== "base" && !addedFiles[parent + ":" + decrypted.name]){
                                            addedFiles[parent + ":" + decrypted.name] = true
                
                                            builtTreeFiles[entryPath] = {
                                                uuid,
                                                region,
                                                bucket,
                                                chunks,
                                                parent,
                                                metadata: decrypted,
                                                version,
                                                type: "file",
                                                path: entryPath
                                            }
                
                                            builtTreeUUIDs[uuid] = {
                                                type: "file",
                                                path: entryPath
                                            }

                                            memoryCache.set("fileKey:" + uuid, decrypted.key)
                                        }
                
                                        return resolve(true)
                                    }).catch(resolve)
                                }).catch(resolve)
                            })
                        }
                    )
                ]

                try{
                    await Promise.all(promises)
                }
                catch(e){
                    log.error(e)

                    return reject(e)
                }

                const obj = {
                    files: builtTreeFiles,
                    folders: builtTreeFolders,
                    uuids: builtTreeUUIDs
                }

                if(rawEx.length == 2){
                    previousDatasets[location.uuid] = rawEx[0]
                }
                
                try{
                    await db.set(cacheKey, obj)
                }
                catch(e){
                    return reject(e)
                }

                return resolve({
                    changed: true,
                    data: obj
                })
            }).catch(reject)
        }).catch(reject)
    })
}

export const createDirectory = (uuid: string, name: string, parent: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        createDirectorySemaphore.acquire().then(() => {
            folderExists({ name, parent }).then(({ exists, existsUUID }) => {
                if(exists){
                    createDirectorySemaphore.release()

                    return resolve(existsUUID)
                }
    
                createFolder({ uuid, name, parent }).then(() => {
                    createDirectorySemaphore.release()

                    return resolve(uuid)
                }).catch((err) => {
                    createDirectorySemaphore.release()

                    return reject(err)
                })
            }).catch((err) => {
                createDirectorySemaphore.release()

                return reject(err)
            })
        }).catch(reject)
    })
}

export const doesExistLocally = (path: string): Promise<boolean> => {
    return new Promise((resolve) => {
        canReadWriteAtPath(pathModule.normalize(path)).then(() => {
            return resolve(true)
        }).catch(() => {
            return resolve(false)
        })
    })
}

export const findOrCreateParentDirectory = (path: string, baseFolderUUID: string, remoteTreeNow: any, absolutePathLocal?: string): Promise<string> => {
	return new Promise(async (resolve, reject) => {
        const neededPathEx = path.split("/")
        const neededParentPath = neededPathEx.slice(0, -1).join("/")

        if(folderPathUUID.has(neededParentPath)){
            return resolve(folderPathUUID.get(neededParentPath))
        }

        await findOrCreateParentDirectorySemaphore.acquire()

        if(absolutePathLocal){
            if(!(await doesExistLocally(absolutePathLocal))){
                findOrCreateParentDirectorySemaphore.release()

                return reject("deletedLocally")
            }
        }

        if(path.indexOf("/") == -1){
            findOrCreateParentDirectorySemaphore.release()

            return resolve(baseFolderUUID)
        }

        const existingFolders = remoteTreeNow.folders
        const currentPathArray = []

        let found = false
        let foundParentUUID = baseFolderUUID

        while(!found){
            for(let i = 0; i < neededPathEx.length; i++){
                currentPathArray.push(neededPathEx[i])
            
                const currentPath: any = currentPathArray.join("/")
                const currentParentPath: string = currentPathArray.slice(0, -1).join("/")
                
                if(typeof existingFolders[currentPath] == "undefined" && currentPath !== path){
                    try{
                        const createParentUUID = currentParentPath.length > 0 && typeof existingFolders[currentParentPath] == "object" && typeof existingFolders[currentParentPath].uuid == "string" ? existingFolders[currentParentPath].uuid : baseFolderUUID
                        const createName = currentPath.split("/").pop().trim()
                        let createUUID = uuidv4()
    
                        createUUID = await createDirectory(createUUID, createName, createParentUUID)
    
                        existingFolders[currentPath] = {
                            uuid: createUUID,
                            parent: createParentUUID,
                            path: currentPath,
                            name: createName,
                            type: "folder"
                        }

                        folderPathUUID.set(currentPath, createUUID)
                    }
                    catch(e){
                        findOrCreateParentDirectorySemaphore.release()

                        return reject(e)
                    }
                }
            }

            if(typeof existingFolders[neededParentPath] == "object" && typeof existingFolders[neededParentPath].uuid == "string"){
                found = true
                foundParentUUID = existingFolders[neededParentPath].uuid

                folderPathUUID.set(neededParentPath, existingFolders[neededParentPath].uuid)
            }
        }

        findOrCreateParentDirectorySemaphore.release()

        if(absolutePathLocal){
            if(!(await doesExistLocally(absolutePathLocal))){
                return reject("deletedLocally")
            }
        }

        return resolve(foundParentUUID)
    })
}

export const mkdir = async (path: string, remoteTreeNow: any, location: any, task: any, uuid: string): Promise<{ parent: string, uuid: string }> => {
    const name = pathModule.basename(path)

    if(typeof uuid !== "string"){
        uuid = uuidv4()
    }

    if(typeof name !== "string"){
        throw new Error("Could not create remote folder: Name invalid: " + name)
    }
    
    if(name.length <= 0){
        throw new Error("Could not create remote folder: Name invalid: " + name)
    }

    if(!(await doesExistLocally(normalizePath(location.local + "/" + path)))){
        throw "deletedLocally"
    }

    const parent = await findOrCreateParentDirectory(path, location.remoteUUID, remoteTreeNow, normalizePath(location.local + "/" + path))
    const createdUUID = await createDirectory(uuid, name, parent)

    return {
        parent,
        uuid: createdUUID
    }
}

export const upload = (path: string, remoteTreeNow: any, location: any, task: any, uuid: string): Promise<any> => {
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
            var name = pathModule.basename(absolutePath)
            var nameHashed = hashFn(name.toLowerCase())
        }
        catch(e){
            return reject(e)
        }

        if(typeof name !== "string"){
            return reject(new Error("Could not upload file: Name invalid: " + name))
        }
        
        if(name.length <= 0){
            return reject(new Error("Could not upload file: Name invalid: " + name))
        }

        if(typeof uuid !== "string"){
            uuid = uuidv4()
        }

        if(!(await doesExistLocally(absolutePath))){
            return reject("deletedLocally")
        }

        Promise.all([
            db.get("apiKey"),
            db.get("masterKeys"),
            remoteStorageLeft()
        ]).then(([apiKey, masterKeys, remoteStorageFree]) => {
            smokeTestLocal(absolutePath).then(() => {
                checkLastModified(absolutePath).then((checkLastModifiedRes) => {
                    const size = parseInt(task.item.size.toString())

                    if(size > remoteStorageFree){
                        return reject("Not enough remote storage left to upload " + absolutePath)
                    }

                    findOrCreateParentDirectory(path, location.remoteUUID, remoteTreeNow, absolutePath).then(async (parent) => {
                        const lastModified = checkLastModifiedRes.changed ? Math.floor(checkLastModifiedRes.mtimeMs as number) : Math.floor(task.item.lastModified)
                        const mime = mimeTypes.lookup(name) || ""
                        const expire = "never"
                        let dummyOffset = 0
                        let fileChunks = 0
    
                        while(dummyOffset < size){
                            fileChunks += 1
                            dummyOffset += chunkSize
                        }
    
                        try{
                            var key = generateRandomString(32)
                            var rm = generateRandomString(32)
                            var uploadKey = generateRandomString(32)
                            var nameEnc = await encryptMetadata(name, key)
                            var nameH = nameHashed
                            var mimeEnc = await encryptMetadata(mime, key)
                            var sizeEnc = await encryptMetadata(size.toString(), key)
                            var metaData = await encryptMetadata(JSON.stringify({
                                name,
                                size,
                                mime,
                                key,
                                lastModified
                            }, (_, value) => typeof value == "bigint" ? parseInt(value.toString()) : value), masterKeys[masterKeys.length - 1])
                        }
                        catch(e){
                            log.error("Metadata generation failed for " + absolutePath)
                            log.error(e)
    
                            return reject(e)
                        }
    
                        const uploadTask = (index: number) => {
                            return new Promise(async (resolve, reject) => {
                                if(!(await doesExistLocally(absolutePath))){
                                    return reject("deletedLocally")
                                }

                                readChunk(absolutePath, (index * chunkSize), chunkSize).then((data) => {
                                    try{
                                        // @ts-ignore
                                        var queryParams = new URLSearchParams({
                                            apiKey: apiKey,
                                            uuid: uuid,
                                            name: nameEnc,
                                            nameHashed: nameH,
                                            size: sizeEnc,
                                            chunks: fileChunks,
                                            mime: mimeEnc,
                                            index: index,
                                            rm: rm,
                                            expire: expire,
                                            uploadKey: uploadKey,
                                            metaData: metaData,
                                            parent: parent,
                                            version: UPLOAD_VERSION
                                        }).toString()
                                    }
                                    catch(e){
                                        return reject(e)
                                    }
    
                                    encryptData(data, key).then((encrypted) => {
                                        uploadChunk({
                                            queryParams,
                                            data: encrypted,
                                            timeout: 86400000,
                                            from: "sync",
                                            location
                                        }).then((response) => {
                                            if(!response.status){
                                                return reject(new Error(response.message))
                                            }
    
                                            return resolve(response.data)
                                        }).catch(reject)
                                    }).catch(reject)
                                })
                            })
                        }
    
                        let region: string = ""
                        let bucket: string = ""

                        try{
                            await uploadTask(0)

                            await new Promise((resolve, reject) => {
                                let done = 1

                                for(let i = 1; i < (fileChunks + 1); i++){
                                    uploadThreadsSemaphore.acquire().then(() => {
                                        uploadTask(i).then((data: any) => {
                                            region = data.region
                                            bucket = data.bucket

                                            done += 1

                                            uploadThreadsSemaphore.release()

                                            if(done >= (fileChunks + 1)){
                                                return resolve(true)
                                            }
                                        }).catch((err) => {
                                            uploadThreadsSemaphore.release()

                                            return reject(err)
                                        })
                                    })
                                }
                            })

                            await markUploadAsDone({ uuid, uploadKey })
                        }
                        catch(e: any){
                            if(e.toString().toLowerCase().indexOf("already exists") !== -1){
                                return resolve(true)
                            }

                            return reject(e)
                        }
    
                        try{
                            await checkIfItemParentIsShared({
                                type: "file",
                                parent,
                                metaData: {
                                    uuid,
                                    name,
                                    size,
                                    mime,
                                    key,
                                    lastModified
                                }
                            })
                        }
                        catch(e){
                            log.error(e)
                        }

                        memoryCache.saveMetadataToDisk("decryptFileMetadata:" + metaData, {
                            name,
                            size,
                            mime,
                            key,
                            lastModified
                        })

                        memoryCache.set("fileKey:" + uuid, key)
    
                        return resolve({
                            uuid,
                            bucket,
                            region,
                            chunks: fileChunks,
                            parent,
                            version: UPLOAD_VERSION,
                            metadata: {
                                key,
                                name,
                                size,
                                mime,
                                lastModified
                            }
                        })
                    }).catch(async (err) => {
                        if(!(await doesExistLocally(absolutePath))){
                            return reject("deletedLocally")
                        }

                        return reject(err)
                    })
                }).catch(async (err) => {
                    if(!(await doesExistLocally(absolutePath))){
                        return reject("deletedLocally")
                    }

                    return reject(err)
                })
            }).catch(async (err) => {
                if(!(await doesExistLocally(absolutePath))){
                    return reject("deletedLocally")
                }

                return reject(err)
            })
        }).catch(reject)
    })
}

export const rm = (type: string, uuid: string): Promise<any> => {
    return trashItem({ type, uuid })
}

export const move = async (type: string, task: any, location: any, remoteTreeNow: any): Promise<boolean> => {
    const parent = await findOrCreateParentDirectory(task.to, location.remoteUUID, remoteTreeNow)

    if(type == "file"){
        await moveFile({
            file: {
                uuid: task.item.uuid,
                name: task.item.metadata.name,
                size: task.item.metadata.size,
                mime: task.item.metadata.mime,
                key: task.item.metadata.key,
                lastModified: task.item.metadata.lastModified
            },
            parent
        })
    }
    else{
        await moveFolder({
            folder: {
                uuid: task.item.uuid,
                name: task.item.name
            },
            parent
        })
    }

    return true
}

export const rename = async (type: string, task: any): Promise<boolean> => {
    const newName = pathModule.basename(task.to)

    if(newName.length == 0){
        throw new Error("Invalid name")
    }

    if(type == "file"){
        await renameFile({
            file: {
                uuid: task.item.uuid,
                name: newName,
                size: task.item.metadata.size,
                mime: task.item.metadata.mime,
                key: task.item.metadata.key,
                lastModified: task.item.metadata.lastModified
            },
            name: newName
        })
    }
    else{
        await renameFolder({
            folder: {
                uuid: task.item.uuid,
                name: newName
            },
            name: newName
        })
    }

    return true
}