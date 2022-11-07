import { folderPresent, dirTree, createFolder, folderExists, uploadChunk, markUploadAsDone, checkIfItemParentIsShared, trashItem, moveFile, moveFolder, renameFile, renameFolder } from "../../api"
import db from "../../db"
import { decryptFolderName, decryptFileMetadata, hashFn, encryptMetadata, encryptData } from "../../crypto"
import memoryCache from "../../memoryCache"
import { convertTimestampToMs, pathIsFileOrFolderNameIgnoredByDefault, generateRandomString, Semaphore, isFolderPathExcluded, pathValidation } from "../../helpers"
import { normalizePath, smokeTest as smokeTestLocal, readChunk, checkLastModified } from "../local"
import { chunkSize, maxUploadThreads } from "../../constants"
import { v4 as uuidv4 } from "uuid"
import { sendToAllPorts } from "../../worker/ipc"

const pathModule = window.require("path")
const log = window.require("electron-log")
const mimeTypes = window.require("mime-types")
const fs = window.require("fs-extra")

const findOrCreateParentDirectorySemaphore = new Semaphore(1)
const createDirectorySemaphore = new Semaphore(1)
const uploadThreadsSemaphore = new Semaphore(maxUploadThreads)
const folderPathUUID = new Map()

const UPLOAD_VERSION: number = 2

export const smokeTest = (uuid: string = ""): Promise<boolean> => {
    return new Promise(async (resolve, reject) => {
        try{
            var response = await folderPresent({ apiKey: await db.get("apiKey"), uuid })
        }
        catch(e){
            return reject(e)
        }

        if(!response.present || response.trash){
            return reject(new Error("Remote folder " + uuid + " is not present: " + JSON.stringify(response)))
        }

        return resolve(true)
    })
}

export const directoryTree = (uuid: string = "", skipCache: boolean = false, location?: any): Promise<any> => {
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

            dirTree({ apiKey, uuid, deviceId, skipCache }).then(async (response) => {
                const cacheKey: string = "directoryTree:" + uuid + ":" + deviceId

                if(response.folders.length == 0 && response.files.length == 0){ // Data did not change
                    if(memoryCache.has(cacheKey)){
                        return resolve({
                            changed: false,
                            data: memoryCache.get(cacheKey)
                        })
                    }

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

                    return directoryTree(uuid, true).then(resolve).catch(reject)
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

                const treeItems = []
                const [baseFolderUUID, baseFolderMetadata, baseFolderParent] = response.folders[0]
                const baseFolderName = await decryptFolderName(baseFolderMetadata, masterKeys)

                if(baseFolderParent !== "base"){
                    return reject(new Error("Invalid base folder parent"))
                }

                if(baseFolderName.length <= 0){
                    return reject(new Error("Could not decrypt base folder name"))
                }

                treeItems.push({
                    uuid: baseFolderUUID,
                    name: baseFolderName,
                    parent: "base",
                    type: "folder"
                })

                const addedFolders: any = {}
                const addedFiles: any = {}

                for(let i = 0; i < response.folders.length; i++){
                    const [uuid, metadata, parent] = response.folders[i]

                    if(uuid == baseFolderUUID){
                        continue
                    }

                    const name = await decryptFolderName(metadata, masterKeys)

                    if(name.length > 0 && name.length < 250){
                        if(!addedFolders[parent + ":" + name]){
                            addedFolders[parent + ":" + name] = true

                            if(excludeDot){
                                if(!name.startsWith(".")){
                                    treeItems.push({
                                        uuid,
                                        name,
                                        parent,
                                        type: "folder"
                                    })
                                }
                            }
                            else{
                                treeItems.push({
                                    uuid,
                                    name,
                                    parent,
                                    type: "folder"
                                })
                            }
                        }
                    }
                }

                for(let i = 0; i < response.files.length; i++){
                    const [uuid, bucket, region, chunks, parent, metadata, version, timestamp] = response.files[i]
                    const decrypted = await decryptFileMetadata(metadata, masterKeys)

                    if(typeof decrypted.lastModified == "number"){
                        if(decrypted.lastModified <= 0){
                            decrypted.lastModified = timestamp
                        }
                    }
                    else{
                        decrypted.lastModified = timestamp
                    }

                    decrypted.lastModified = convertTimestampToMs(decrypted.lastModified)

                    if(decrypted.name.length > 0 && decrypted.name.length < 250){
                        if(!addedFiles[parent + ":" + decrypted.name]){
                            addedFiles[parent + ":" + decrypted.name] = true

                            if(excludeDot){
                                if(!decrypted.name.startsWith(".")){
                                    treeItems.push({
                                        uuid,
                                        region,
                                        bucket,
                                        chunks,
                                        parent,
                                        metadata: decrypted,
                                        version,
                                        type: "file"
                                    })
                                }
                            }
                            else{
                                treeItems.push({
                                    uuid,
                                    region,
                                    bucket,
                                    chunks,
                                    parent,
                                    metadata: decrypted,
                                    version,
                                    type: "file"
                                })
                            }
                        }
                    }
                }

                const nest = (items: any, uuid: string = "base", currentPath: string = "", link: string = "parent"): any => {
                    return items.filter((item: any) => item[link] == uuid).map((item: any) => ({ 
                        ...item,
                        path: item.type == "folder" ? (currentPath + "/" + item.name) : (currentPath + "/" + item.metadata.name),
                        children: nest(items, item.uuid, item.type == "folder" ? (currentPath + "/" + item.name) : (currentPath + "/" + item.metadata.name), link)
                    }))
                }

                const tree = nest(treeItems)
                let reading: number = 0
                const folders: any = {}
                const files: any = {}
                const uuids: any = {}

                const iterateTree = (parent: any, callback: Function) => {
                    if(parent.type == "folder"){
                        folders[parent.path] = parent
                        uuids[parent.uuid] = {
                            type: "folder",
                            path: parent.path
                        }
                    }
                    else{
                        files[parent.path] = parent
                        uuids[parent.uuid] = {
                            type: "file",
                            path: parent.path
                        }
                    }

                    if(parent.children.length > 0){
                        for(let i = 0; i < parent.children.length; i++){
                            reading += 1
            
                            iterateTree(parent.children[i], callback)
                        }
                    }
            
                    reading -= 1
            
                    if(reading == 0){
                        return callback()
                    }
                }
            
                reading += 1

                iterateTree(tree[0], async () => {
                    const newFiles: any = {}
                    const newFolders: any = {}
                    const newUUIDS: any = {}

                    for(const prop in files){
                        const newProp = prop.split("/").slice(2).join("/")

                        delete files[prop].children

                        if(newProp.length > 0){
                            let include = true

                            if(excludeDot && (newProp.indexOf("/.") !== -1 || newProp.startsWith("."))){
                                include = false
                            }

                            if(!pathValidation(newProp) || pathIsFileOrFolderNameIgnoredByDefault(newProp)){
                                include = false
                            }

                            if(include && !isFolderPathExcluded(newProp)){
                                newFiles[newProp] = {
                                    ...files[prop],
                                    path: newProp
                                }
                            }
                        }
                    }

                    for(const prop in folders){
                        const newProp = prop.split("/").slice(2).join("/")

                        delete folders[prop].children

                        if(newProp.length > 0){
                            let include = true

                            if(excludeDot && (newProp.indexOf("/.") !== -1 || newProp.startsWith("."))){
                                include = false
                            }

                            if(!pathValidation(newProp) || pathIsFileOrFolderNameIgnoredByDefault(newProp)){
                                include = false
                            }

                            if(include && !isFolderPathExcluded(newProp)){
                                newFolders[newProp] = {
                                    ...folders[prop],
                                    path: newProp
                                }
    
                                folderPathUUID.set(newProp, folders[prop].uuid)
                            }
                        }
                    }

                    for(const prop in uuids){
                        const newValue = uuids[prop].path.split("/").slice(2).join("/")

                        if(newValue.length > 0){
                            let include = true

                            if(excludeDot && (newValue.indexOf("/.") !== -1 || newValue.startsWith("."))){
                                include = false
                            }

                            if(!pathValidation(newValue) || pathIsFileOrFolderNameIgnoredByDefault(newValue)){
                                include = false
                            }

                            if(include && !isFolderPathExcluded(newValue)){
                                newUUIDS[prop] = {
                                    ...uuids[prop],
                                    path: newValue
                                }
                            }
                        }
                    }

                    const obj = {
                        files: newFiles,
                        folders: newFolders,
                        uuids: newUUIDS
                    }
                    
                    try{
                        memoryCache.set(cacheKey, obj)

                        await db.set(cacheKey, obj)
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
        fs.access(pathModule.normalize(path)).then(() => {
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

export const mkdir = (path: string, remoteTreeNow: any, location: any, task: any, uuid: string): Promise<{ parent: string, uuid: string }> => {
    return new Promise(async (resolve, reject) => {
        const name = pathModule.basename(path)

        if(typeof uuid !== "string"){
            uuid = uuidv4()
        }

        if(typeof name !== "string"){
            return reject(new Error("Could not create remote folder: Name invalid: " + name))
        }
        
        if(name.length <= 0){
            return reject(new Error("Could not create remote folder: Name invalid: " + name))
        }

        if(!(await doesExistLocally(normalizePath(location.local + "/" + path)))){
            return reject("deletedLocally")
        }

        try{
            var parent = await findOrCreateParentDirectory(path, location.remoteUUID, remoteTreeNow, normalizePath(location.local + "/" + path))
        }
        catch(e){
            return reject(e)
        }

        createDirectory(uuid, name, parent).then((createdUUID) => {
            return resolve({
                parent,
                uuid: createdUUID
            })
        }).catch(reject)
    })
}

export const upload = (path: string, remoteTreeNow: any, location: any, task: any, uuid: string): Promise<any> => {
    return new Promise(async (resolve, reject) => {
        await new Promise((resolve) => {
            const getPausedStatus = () => {
                db.get("paused").then((paused) => {
                    if(paused){
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
            db.get("masterKeys")
        ]).then(([apiKey, masterKeys]) => {
            smokeTestLocal(absolutePath).then(() => {
                checkLastModified(absolutePath).then((checkLastModifiedRes) => {
                    findOrCreateParentDirectory(path, location.remoteUUID, remoteTreeNow, absolutePath).then(async (parent) => {
                        const size = parseInt(task.item.size.toString())
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
                                            from: "sync"
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

export const move = (type: string, task: any, location: any, remoteTreeNow: any): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        findOrCreateParentDirectory(task.to, location.remoteUUID, remoteTreeNow).then((parent) => {
            const promise = type == "file" ? moveFile({
                file: {
                    uuid: task.item.uuid,
                    name: task.item.metadata.name,
                    size: task.item.metadata.size,
                    mime: task.item.metadata.mime,
                    key: task.item.metadata.key,
                    lastModified: task.item.metadata.lastModified
                },
                parent
            }) : moveFolder({
                folder: {
                    uuid: task.item.uuid,
                    name: task.item.name
                },
                parent
            })

            promise.then(resolve).catch(reject)
        }).catch(reject)
    })
}

export const rename = (type: string, task: any): Promise<boolean> => {
    const newName = pathModule.basename(task.to)

    return new Promise((resolve, reject) => {
        if(newName.length == 0){
            return reject(new Error("Invalid name"))
        }

        const promise = type == "file" ? renameFile({
            file: {
                uuid: task.item.uuid,
                name: newName,
                size: task.item.metadata.size,
                mime: task.item.metadata.mime,
                key: task.item.metadata.key,
                lastModified: task.item.metadata.lastModified
            },
            name: newName
        }) : renameFolder({
            folder: {
                uuid: task.item.uuid,
                name: newName
            },
            name: newName
        })
        
        promise.then(resolve).catch(reject)
    })
}