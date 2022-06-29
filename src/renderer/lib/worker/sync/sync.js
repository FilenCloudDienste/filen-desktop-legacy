import * as fsLocal from "../../fs/local"
import * as fsRemote from "../../fs/remote"
import db from "../../db"
import { acquireLock, releaseLock, holdLock } from "../../api"
import ipc from "../../ipc"
import { sendToAllPorts } from "../ipc"
import { v4 as uuidv4 } from "uuid"
import { maxRetrySyncTask, retrySyncTaskTimeout, maxConcurrentDownloads as maxConcurrentDownloadsPreset, maxConcurrentUploads as maxConcurrentUploadsPreset } from "../../constants"
import { Semaphore } from "../../helpers"

const pathModule = window.require("path")
const log = window.require("electron-log")
const gitignoreParser = window.require("@gerhobbelt/gitignore-parser")
const fs = window.require("fs-extra")

let SYNC_RUNNING = false
const SYNC_TIMEOUT = 5000
let SYNC_LOCK_INTERVAL = undefined
let TRYING_TO_HOLD_SYNC_LOCK = false
let IS_FIRST_REQUEST = {}
const WATCHERS = {}
let SYNC_LOCK_ACQUIRED = false
const maxConcurrentUploadsSemaphore = new Semaphore(maxConcurrentUploadsPreset)
const maxConcurrentDownloadsSemaphore = new Semaphore(maxConcurrentDownloadsPreset)
const maxSyncTasksSemaphore = new Semaphore(1024)
const syncLockSemaphore = new Semaphore(1)

const acquireSyncLock = (id) => {
    return new Promise((resolve) => {
        syncLockSemaphore.acquire().then(() => {
            log.info("Acquiring sync lock")

            const acquire = async () => {
                acquireLock({ apiKey: await db.get("apiKey"), id }).then(() => {
                    log.info("Sync lock acquired")
        
                    holdSyncLock(id)

                    syncLockSemaphore.release()

                    SYNC_LOCK_ACQUIRED = true
        
                    return resolve(true)
                }).catch((err) => {
                    if(err.toString().toLowerCase().indexOf("sync locked") == -1){
                        log.error("Could not acquire sync lock from API")
                        log.error(err)
                    }

                    syncLockSemaphore.release()

                    SYNC_LOCK_ACQUIRED = false
        
                    return setTimeout(acquire, 1000)
                })
            }

            return acquire()
        })
    })
}

const releaseSyncLock = (id) => {
    return new Promise((resolve, reject) => {
        if(!SYNC_LOCK_ACQUIRED){
            return resolve(true)
        }

        syncLockSemaphore.acquire().then(async () => {
            log.info("Releasing sync lock")

            releaseLock({ apiKey: await db.get("apiKey"), id }).then(() => {
                log.info("Sync lock released")

                clearInterval(SYNC_LOCK_INTERVAL)

                SYNC_LOCK_ACQUIRED = false

                syncLockSemaphore.release()

                return resolve(true)
            }).catch((err) => {
                log.error("Could not release sync lock from API")
                log.error(err)

                syncLockSemaphore.release()

                return reject(err)
            })
        })
    })
}

const holdSyncLock = (id) => {
    clearInterval(SYNC_LOCK_INTERVAL)

    SYNC_LOCK_INTERVAL = setInterval(() => {
        syncLockSemaphore.acquire().then(async () => {
            if(!TRYING_TO_HOLD_SYNC_LOCK && SYNC_LOCK_ACQUIRED){
                TRYING_TO_HOLD_SYNC_LOCK = true
    
                log.info("Holding sync lock")
    
                try{
                    await holdLock({ apiKey: await db.get("apiKey"), id })
                }
                catch(e){
                    log.error("Could not hold sync lock from API")
                    log.error(e)
    
                    TRYING_TO_HOLD_SYNC_LOCK = false

                    syncLockSemaphore.release()
    
                    return false
                }
    
                TRYING_TO_HOLD_SYNC_LOCK = false
    
                log.info("Sync lock held")

                syncLockSemaphore.release()
            }
            else{
                syncLockSemaphore.release()
            }
        })
    }, SYNC_TIMEOUT / 2)
}

const getDeltas = (type, before, now) => {
    return new Promise((resolve, reject) => {
        const deltasFiles = {}
        const deltasFolders = {}
        
        if(type == "local"){
            const beforeFiles = before.files
            const beforeFolders = before.folders
            const beforeIno = before.ino
            const nowFiles = now.files
            const nowFolders = now.folders
            const nowIno = now.ino

            for(const path in nowFiles){
                const beforeEntry = beforeFiles[path]
                const nowEntry = nowFiles[path]

                if(!beforeEntry){
                    deltasFiles[path] = {
                        type: "NEW"
                    }
                }
                else if(beforeEntry.lastModified == nowEntry.lastModified){
                    deltasFiles[path] = {
                        type: "UNCHANGED"
                    }
                }
                else if(beforeEntry.lastModified < nowEntry.lastModified){
                    deltasFiles[path] = {
                        type: "NEWER"
                    }
                }
                else{
                    deltasFiles[path] = {
                        type: "OLDER"
                    }
                }
            }

            for(const path of Object.keys(beforeFiles)){
                if(!(path in nowFiles)){
                    deltasFiles[path] = {
                        type: "DELETED"
                    }
                }
            }

            for(const path in nowFolders){
                const beforeEntry = beforeFolders[path]

                if(!beforeEntry){
                    deltasFolders[path] = {
                        type: "NEW"
                    }
                }
                else{
                    deltasFolders[path] = {
                        type: "UNCHANGED"
                    }
                }
            }

            for(const path of Object.keys(beforeFolders)){
                if(!(path in nowFolders)){
                    deltasFolders[path] = {
                        type: "DELETED"
                    }
                }
            }

            for(const ino in nowIno){
                const nowPath = nowIno[ino]?.path
                const beforePath = beforeIno[ino]?.path

                if(typeof nowPath == "string" && typeof beforePath == "string"){
                    if(nowPath !== beforePath && nowIno[ino].type == beforeIno[ino].type){
                        const nowPathDir = pathModule.dirname(nowPath)
                        const beforePathDir = pathModule.dirname(beforePath)
                        const nowBasename = pathModule.basename(nowPath)
                        const beforeBasename = pathModule.basename(beforePath)
                        const action = nowPathDir !== beforePathDir ? "MOVED" : "RENAMED"

                        if(action == "RENAMED" && nowBasename == beforeBasename){
                            deltasFiles[beforePath] = {
                                type: "UNCHANGED"
                            }

                            deltasFiles[nowPath] = {
                                type: "UNCHANGED"
                            }

                            continue
                        }
                        
                        if(typeof beforeFiles[beforePath] !== "undefined"){
                            const nowEntry = beforeFiles[nowPath]

                            if(!nowEntry){ // Did the file exist before? If so we just update it rather than move/rename it and delete the old one
                                deltasFiles[beforePath] = {
                                    type: action,
                                    from: beforePath,
                                    to: nowPath
                                }
    
                                deltasFiles[nowPath] = {
                                    type: action,
                                    from: beforePath,
                                    to: nowPath
                                }
                            }
                        }

                        if(typeof beforeFolders[beforePath] !== "undefined"){
                            const nowEntry = beforeFolders[nowPath]

                            if(!nowEntry){ // Did the folder exist before? If so we just update it rather than move/rename it and delete the old one
                                deltasFolders[beforePath] = {
                                    type: action,
                                    from: beforePath,
                                    to: nowPath
                                }
    
                                deltasFolders[nowPath] = {
                                    type: action,
                                    from: beforePath,
                                    to: nowPath
                                }
                            }
                        }
                    }
                }
            }
        }
        else{
            const beforeFiles = before.files
            const beforeFolders = before.folders
            const beforeUUIDs = before.uuids
            const nowFiles = now.files
            const nowFolders = now.folders
            const nowUUIDs = now.uuids

            for(const path in nowFiles){
                const beforeEntry = beforeFiles[path]
                const nowEntry = nowFiles[path]

                if(!beforeEntry){
                    deltasFiles[path] = {
                        type: "NEW"
                    }
                }
                else if(beforeEntry.metadata.lastModified == nowEntry.metadata.lastModified){
                    deltasFiles[path] = {
                        type: "UNCHANGED"
                    }
                }
                else if(beforeEntry.metadata.lastModified < nowEntry.metadata.lastModified){
                    deltasFiles[path] = {
                        type: "NEWER"
                    }
                }
                else{
                    deltasFiles[path] = {
                        type: "OLDER"
                    }
                }
            }

            for(const path of Object.keys(beforeFiles)){
                if(!(path in nowFiles)){
                    deltasFiles[path] = {
                        type: "DELETED"
                    }
                }
            }

            for(const path in nowFolders){
                const beforeEntry = beforeFolders[path]

                if(!beforeEntry){
                    deltasFolders[path] = {
                        type: "NEW"
                    }
                }
                else{
                    deltasFolders[path] = {
                        type: "UNCHANGED"
                    }
                }
            }

            for(const path of Object.keys(beforeFolders)){
                if(!(path in nowFolders)){
                    deltasFolders[path] = {
                        type: "DELETED"
                    }
                }
            }

            for(const uuid in nowUUIDs){
                const nowPath = nowUUIDs[uuid]?.path
                const beforePath = beforeUUIDs[uuid]?.path

                if(typeof nowPath == "string" && typeof beforePath == "string"){
                    if(nowPath !== beforePath && nowUUIDs[uuid].type == beforeUUIDs[uuid].type){
                        const nowPathDir = pathModule.dirname(nowPath)
                        const beforePathDir = pathModule.dirname(beforePath)
                        const nowBasename = pathModule.basename(nowPath)
                        const beforeBasename = pathModule.basename(beforePath)
                        const action = nowPathDir !== beforePathDir ? "MOVED" : "RENAMED"

                        if(action == "RENAMED" && nowBasename == beforeBasename){
                            deltasFiles[beforePath] = {
                                type: "UNCHANGED"
                            }

                            deltasFiles[nowPath] = {
                                type: "UNCHANGED"
                            }

                            continue
                        }
                        
                        if(typeof beforeFiles[beforePath] !== "undefined"){
                            const nowEntry = beforeFiles[nowPath]

                            if(!nowEntry){ // Did the file exist before? If so we just update it rather than move/rename it and delete the old one
                                deltasFiles[beforePath] = {
                                    type: action,
                                    from: beforePath,
                                    to: nowPath
                                }
    
                                deltasFiles[nowPath] = {
                                    type: action,
                                    from: beforePath,
                                    to: nowPath
                                }
                            }
                        }

                        if(typeof beforeFolders[beforePath] !== "undefined"){
                            const nowEntry = beforeFolders[nowPath]

                            if(!nowEntry){ // Did the folder exist before? If so we just update it rather than move/rename it and delete the old one
                                deltasFolders[beforePath] = {
                                    type: action,
                                    from: beforePath,
                                    to: nowPath
                                }
    
                                deltasFolders[nowPath] = {
                                    type: action,
                                    from: beforePath,
                                    to: nowPath
                                }
                            }
                        }
                    }
                }
            }
        }

        return resolve({
            files: deltasFiles,
            folders: deltasFolders
        })
    })
}

/*
It would be a waste of time and resources if we work on all supplied tasks (e.g delete/move)
This is why we only get the base parent if tasks look like this for example:
const tasks = { //obviously an array and not an object, just simplified for readability
    path: "folder",
    path: "folder/subfolder",
    path: "folder/subfolder/file.txt",
    path: "someOtherFile.txt"
}
Iterating through all those tasks and deleting every file/directory would be a waste, this is why we get the base parent for each individual task and return it
onlyGetBaseParent<Move/Delete>(tasks) will return 
{
    path: "folder",
    path: "someOtherFile.txt"
}
*/
const onlyGetBaseParentMove = (tasks) => {
    const sorted = tasks.sort((a, b) => {
        return a.path.length - b.path.length
    })

    const newTasks = []
    const moving = []
    
    const exists = (path) => {
    	for(let i = 0; i < moving.length; i++){
            if(path.startsWith(moving[i] + "/")){
                return true
            }
        }
      
        return false
    }

    for(let i = 0; i < sorted.length; i++){
        const task = sorted[i]
        
        if(typeof task.path == "string"){
            const path = task.path
        
            if(!exists(path)){
                moving.push(path)
                newTasks.push(task)
            }
        }
    }

    return newTasks
}

const onlyGetBaseParentDelete = (tasks) => {
    const sorted = tasks.sort((a, b) => {
        return a.path.length - b.path.length
    })

    const newTasks = []
    const deleting = []
    
    const exists = (path) => {
    	for(let i = 0; i < deleting.length; i++){
            if(path.startsWith(deleting[i] + "/")){
                return true
            }
        }
      
        return false
    }

    for(let i = 0; i < sorted.length; i++){
        const task = sorted[i]
        
        if(typeof task.path == "string"){
            const path = task.path
        
            if(!exists(path)){
                deleting.push(path)
                newTasks.push(task)
            }
        }
    }

    return newTasks
}

/*
Move tasks usually come twice, like so:
{
    path: "old/path",
    from: "old/path",
    to: "new/path"
}
{
    path: "new/path",
    from: "old/path",
    to: "new/path"
}
Since we only need one of them we sort them and return only one task for each task
*/
const sortMoveRenameTasks = (tasks) => {
    const added = {}
    const newTasks = []

    tasks = tasks.filter(task => typeof task.from == "string" && typeof task.to == "string" && task.from !== task.to)

    for(let i = 0; i < tasks.length; i++){
        const task = tasks[i]

        if(typeof task.from == "string" && typeof task.to == "string" && typeof task.item == "object"){
            const key = task.from + ":" + task.to

            if(!added[key]){
                added[key] = true

                newTasks.push(task)
            }
        }
    }

    return newTasks
}

const addTaskToRedoList = (task) => {
    return new Promise((resolve, reject) => {
        db.get("userId").then((userId) => {
            db.get("syncTasksRedo:" + userId).then((syncTasksRedo) => {
                if(!Array.isArray(syncTasksRedo)){
                    syncTasksRedo = []
                }
    
                syncTasksRedo.push(task)
    
                db.set("syncTasksRedo:" + userId, syncTasksRedo).then(() => {
                    log.info(JSON.stringify(task) + " added to sync redo list")

                    return resolve(true)
                }).catch(reject)
            }).catch(reject)
        }).catch(reject)
    })
}

// Parse lists into .gitignore like compatible format
const getIgnored = (location) => {
    return new Promise((resolve, reject) => {
        Promise.all([
            db.get("selectiveSync:remote:" + location.uuid),
            db.get("filenIgnore:" + location.uuid)
        ]).then(([selectiveSyncRemote, fIgnore]) => {
            if(typeof fIgnore !== "string"){
                fIgnore = ""
            }

            let selectiveSyncList = ""

            for(const path in selectiveSyncRemote){
                selectiveSyncList += "\n" + path
            }

            return resolve({
                selectiveSyncRemoteIgnore: gitignoreParser.compile(selectiveSyncList),
                filenIgnore: gitignoreParser.compile(fIgnore),
                selectiveSyncRemoteIgnoreRaw: selectiveSyncRemote,
                filenIgnoreRaw: fIgnore
            })
        }).catch(reject)
    })
}

const getSyncMode = (location) => {
    return new Promise((resolve, reject) => {
        db.get("userId").then((userId) => {
            db.get("syncLocations:" + userId).then((syncLocations) => {
                for(let i = 0; i < syncLocations.length; i++){
                    if(syncLocations[i].uuid == location.uuid){
                        return resolve(syncLocations[i].type)
                    }
                }

                return resolve("twoWay")
            }).catch(reject)
        }).catch(reject)
    })
}

// Sorting the tasks so we don't have duplicates or for example delete something that has been renamed or move something that has been renamed etc.
// We also filter for ignored files/folders here + the sync mode
const sortTasks = ({ uploadToRemote, downloadFromRemote, renameInLocal, renameInRemote, moveInLocal, moveInRemote, deleteInLocal, deleteInRemote, location }) => {
    return new Promise(async (resolve, reject) => {
        const isPathIncluded = (tasks, path) => {
            for(let i = 0; i < tasks.length; i++){
                if(path.indexOf(tasks[i]) !== -1){
                    return true
                }
            }
        
            return false
        }

        const ignored = []

        try{
            var [{ selectiveSyncRemoteIgnore, filenIgnore }, syncMode] = await Promise.all([
                getIgnored(location),
                getSyncMode(location)
            ])
        }
        catch(e){
            return reject(e)
        }

        // Filter by ignored

        for(let i = 0; i < renameInLocal.length; i++){
            if(filenIgnore.denies(renameInLocal[i].path) || selectiveSyncRemoteIgnore.denies(renameInLocal[i].path)){
                ignored.push(renameInLocal[i].path)
                renameInLocal.splice(i, 1)
                i -= 1
            }
        }

        for(let i = 0; i < renameInRemote.length; i++){
            if(filenIgnore.denies(renameInRemote[i].path) || selectiveSyncRemoteIgnore.denies(renameInRemote[i].path)){
                ignored.push(renameInRemote[i].path)
                renameInRemote.splice(i, 1)
                i -= 1
            }
        }

        for(let i = 0; i < moveInLocal.length; i++){
            if(filenIgnore.denies(moveInLocal[i].path) || selectiveSyncRemoteIgnore.denies(moveInLocal[i].path)){
                ignored.push(moveInLocal[i].path)
                moveInLocal.splice(i, 1)
                i -= 1
            }
        }

        for(let i = 0; i < moveInRemote.length; i++){
            if(filenIgnore.denies(moveInRemote[i].path) || selectiveSyncRemoteIgnore.denies(moveInRemote[i].path)){
                ignored.push(moveInRemote[i].path)
                moveInRemote.splice(i, 1)
                i -= 1
            }
        }

        for(let i = 0; i < deleteInLocal.length; i++){
            if(filenIgnore.denies(deleteInLocal[i].path) || selectiveSyncRemoteIgnore.denies(deleteInLocal[i].path)){
                ignored.push(deleteInLocal[i].path)
                deleteInLocal.splice(i, 1)
                i -= 1
            }
        }

        for(let i = 0; i < deleteInRemote.length; i++){
            if(filenIgnore.denies(deleteInRemote[i].path) || selectiveSyncRemoteIgnore.denies(deleteInRemote[i].path)){
                ignored.push(deleteInRemote[i].path)
                deleteInRemote.splice(i, 1)
                i -= 1
            }
        }

        for(let i = 0; i < uploadToRemote.length; i++){
            if(filenIgnore.denies(uploadToRemote[i].path) || selectiveSyncRemoteIgnore.denies(uploadToRemote[i].path)){
                ignored.push(uploadToRemote[i].path)
                uploadToRemote.splice(i, 1)
                i -= 1
            }
        }

        for(let i = 0; i < downloadFromRemote.length; i++){
            if(filenIgnore.denies(downloadFromRemote[i].path) || selectiveSyncRemoteIgnore.denies(downloadFromRemote[i].path)){
                ignored.push(downloadFromRemote[i].path)
                downloadFromRemote.splice(i, 1)
                i -= 1
            }
        }
    
        let uploadToRemoteTasks = []
        let downloadFromRemoteTasks = []
        let renameInLocalTasks = []
        let renameInRemoteTasks = []
        let moveInLocalTasks = []
        let moveInRemoteTasks = []
        let deleteInLocalTasks = []
        let deleteInRemoteTasks = []
    
        const renameInRemoteTasksSorted = sortMoveRenameTasks(renameInRemote)
        const renamedInRemote = []
        const moveInRemoteTasksSorted = sortMoveRenameTasks(moveInRemote)
        const movedInRemote = []

        const renameInLocalTasksSorted = sortMoveRenameTasks(renameInLocal)
        const renamedInLocal = []
        const moveInLocalTasksSorted = sortMoveRenameTasks(moveInLocal)
        const movedInLocal = []

        for(let i = 0; i < renameInRemoteTasksSorted.length; i++){
            if(
                !isPathIncluded(renamedInRemote, renameInRemoteTasksSorted[i].path) &&
                !isPathIncluded(movedInRemote, renameInRemoteTasksSorted[i].path)
            ){
                renameInRemoteTasks.push(renameInRemoteTasksSorted[i])
                renamedInRemote.push(renameInRemoteTasksSorted[i].from)
                renamedInRemote.push(renameInRemoteTasksSorted[i].to)
            }
        }

        for(let i = 0; i < renameInLocalTasksSorted.length; i++){
            if(
                !isPathIncluded(renamedInLocal, renameInLocalTasksSorted[i].path) &&
                !isPathIncluded(movedInLocal, renameInLocalTasksSorted[i].path)
            ){
                renameInLocalTasks.push(renameInLocalTasksSorted[i])
                renamedInLocal.push(renameInLocalTasksSorted[i].from)
                renamedInLocal.push(renameInLocalTasksSorted[i].to)
            }
        }

        for(let i = 0; i < moveInRemoteTasksSorted.length; i++){
            if(
                !isPathIncluded(renamedInRemote, moveInRemoteTasksSorted[i].path) &&
                !isPathIncluded(movedInRemote, moveInRemoteTasksSorted[i].path)
            ){
                moveInRemoteTasks.push(moveInRemoteTasksSorted[i])
                movedInRemote.push(moveInRemoteTasksSorted[i].from)
                movedInRemote.push(moveInRemoteTasksSorted[i].to)
            }
        }

        for(let i = 0; i < moveInLocalTasksSorted.length; i++){
            if(
                !isPathIncluded(renamedInLocal, moveInLocalTasksSorted[i].path) &&
                !isPathIncluded(movedInLocal, moveInLocalTasksSorted[i].path)
            ){
                moveInLocalTasks.push(moveInLocalTasksSorted[i])
                movedInLocal.push(moveInLocalTasksSorted[i].from)
                movedInLocal.push(moveInLocalTasksSorted[i].to)
            }
        }

        for(let i = 0; i < deleteInRemote.length; i++){
            if(
                !isPathIncluded(renamedInLocal, deleteInRemote[i].path) &&
                !isPathIncluded(movedInLocal, deleteInRemote[i].path)
            ){
                deleteInRemoteTasks.push(deleteInRemote[i])
            }
        }

        for(let i = 0; i < deleteInLocal.length; i++){
            if(
                !isPathIncluded(renamedInRemote, deleteInLocal[i].path) &&
                !isPathIncluded(movedInRemote, deleteInLocal[i].path)
            ){
                deleteInLocalTasks.push(deleteInLocal[i])
            }
        }
    
        for(let i = 0; i < uploadToRemote.length; i++){
            if(
                !isPathIncluded(renamedInLocal, uploadToRemote[i].path) &&
                !isPathIncluded(movedInLocal, uploadToRemote[i].path)
            ){
                uploadToRemoteTasks.push(uploadToRemote[i])
            }
        }
    
        for(let i = 0; i < downloadFromRemote.length; i++){
            if(
                !isPathIncluded(renamedInRemote, downloadFromRemote[i].path) &&
                !isPathIncluded(movedInRemote, downloadFromRemote[i].path)
            ){
                downloadFromRemoteTasks.push(downloadFromRemote[i])
            }
        }

        //renameInRemoteTasks = sortMoveRenameTasks(renameInRemoteTasks)
        //renameInLocalTasks = sortMoveRenameTasks(renameInLocalTasks)
        moveInRemoteTasks = onlyGetBaseParentMove(moveInRemoteTasks)
        moveInLocalTasks = onlyGetBaseParentMove(moveInLocalTasks)
        deleteInRemoteTasks = onlyGetBaseParentDelete(deleteInRemoteTasks)
        deleteInLocalTasks = onlyGetBaseParentDelete(deleteInLocalTasks)

        /*return console.log({
            renameInRemoteTasks: syncMode == "twoWay" || syncMode == "localToCloud" || syncMode == "localBackup" ? renameInRemoteTasks : [],
            renameInLocalTasks: syncMode == "twoWay" || syncMode == "cloudToLocal" || syncMode == "cloudBackup" ? renameInLocalTasks : [],
            moveInRemoteTasks: syncMode == "twoWay" || syncMode == "localToCloud" || syncMode == "localBackup" ? moveInRemoteTasks : [],
            moveInLocalTasks: syncMode == "twoWay" || syncMode == "cloudToLocal" || syncMode == "cloudBackup" ? moveInLocalTasks : [],
            deleteInRemoteTasks: syncMode == "twoWay" || syncMode == "localToCloud" ? deleteInRemoteTasks : [],
            deleteInLocalTasks: syncMode == "twoWay" || syncMode == "cloudToLocal" ? deleteInLocalTasks : [],
            uploadToRemoteTasks: syncMode == "twoWay" || syncMode == "localToCloud" || syncMode == "localBackup" ? uploadToRemoteTasks : [],
            downloadFromRemoteTasks: syncMode == "twoWay" || syncMode == "cloudToLocal" || syncMode == "cloudBackup" ? downloadFromRemoteTasks : []
        })*/
    
        return resolve({
            renameInRemoteTasks: syncMode == "twoWay" || syncMode == "localToCloud" || syncMode == "localBackup" ? renameInRemoteTasks : [],
            renameInLocalTasks: syncMode == "twoWay" || syncMode == "cloudToLocal" || syncMode == "cloudBackup" ? renameInLocalTasks : [],
            moveInRemoteTasks: syncMode == "twoWay" || syncMode == "localToCloud" || syncMode == "localBackup" ? moveInRemoteTasks : [],
            moveInLocalTasks: syncMode == "twoWay" || syncMode == "cloudToLocal" || syncMode == "cloudBackup" ? moveInLocalTasks : [],
            deleteInRemoteTasks: syncMode == "twoWay" || syncMode == "localToCloud" ? deleteInRemoteTasks : [],
            deleteInLocalTasks: syncMode == "twoWay" || syncMode == "cloudToLocal" ? deleteInLocalTasks : [],
            uploadToRemoteTasks: syncMode == "twoWay" || syncMode == "localToCloud" || syncMode == "localBackup" ? uploadToRemoteTasks : [],
            downloadFromRemoteTasks: syncMode == "twoWay" || syncMode == "cloudToLocal" || syncMode == "cloudBackup" ? downloadFromRemoteTasks : []
        })
    })
}

const consumeTasks = ({ uploadToRemote, downloadFromRemote, renameInLocal, renameInRemote, moveInLocal, moveInRemote, deleteInLocal, deleteInRemote, lastLocalTree, lastRemoteTree, localTreeNow, remoteTreeNow, location }) => {
    return new Promise(async (resolve, reject) => {
        try{
            var {
                uploadToRemoteTasks,
                downloadFromRemoteTasks,
                renameInLocalTasks,
                renameInRemoteTasks,
                moveInLocalTasks,
                moveInRemoteTasks,
                deleteInLocalTasks,
                deleteInRemoteTasks
            } = await sortTasks({
                uploadToRemote,
                downloadFromRemote,
                renameInLocal,
                renameInRemote,
                moveInLocal,
                moveInRemote,
                deleteInLocal,
                deleteInRemote,
                location
            })
        }
        catch(e){
            return reject(e)
        }

        /*return console.log({
            renameInLocalTasks,
            renameInRemoteTasks,
            moveInLocalTasks,
            moveInRemoteTasks,
            deleteInLocalTasks,
            deleteInRemoteTasks
        })*/

        /*log.info("renameInRemote", renameInRemoteTasks)
        log.info("renameInLocal", renameInLocalTasks)
        log.info("moveInRemote", moveInRemoteTasks)
        log.info("moveInLocal", moveInLocalTasks)
        log.info("deleteInRemote", deleteInRemoteTasks)
        log.info("deleteInLocal", deleteInLocalTasks)
        log.info("uploadToRemote", uploadToRemoteTasks)
        log.info("downloadFromRemote", downloadFromRemoteTasks)*/

        const doneTasks = []

        if(renameInRemoteTasks.length > 0){
            await Promise.allSettled([
                ...renameInRemoteTasks.map(task => new Promise((resolve, reject) => {
                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("renameInRemote", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr) => {
                            if(currentTries >= maxRetrySyncTask && typeof lastErr !== "undefined"){
                                log.error("renameInRemote task failed: " + JSON.stringify(task))
                                log.error(lastErr)
    
                                addToSyncIssues("syncTask", "Could not rename " + pathModule.normalize(location.local + "/" + task.path) + " remotely: " + lastErr.toString())
    
                                emitSyncTask("renameInRemote", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })
            
                                addTaskToRedoList({
                                    type: "renameInRemote",
                                    task,
                                    location
                                }).then(() => {
                                    return reject(lastErr)
                                }).catch((e) => {
                                    log.error(e)
    
                                    return reject(lastErr)
                                })

                                maxSyncTasksSemaphore.release()
    
                                return false
                            }
    
                            currentTries += 1
    
                            fsRemote.rename(task.type, task).then((done) => {
                                emitSyncTask("renameInRemote", {
                                    status: "done",
                                    task,
                                    location
                                })
        
                                doneTasks.push({
                                    type: "renameInRemote",
                                    task,
                                    location
                                })

                                maxSyncTasksSemaphore.release()
        
                                return resolve(done)
                            }).catch((err) => {
                                log.error(err)
    
                                return setTimeout(() => {
                                    doTask(err)
                                }, retrySyncTaskTimeout)
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])
        }

        if(renameInLocalTasks.length > 0){
            await Promise.allSettled([
                ...renameInLocalTasks.map(task => new Promise((resolve, reject) => {
                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("renameInLocal", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr) => {
                            if(currentTries >= maxRetrySyncTask && typeof lastErr !== "undefined"){
                                log.error("renameInLocal task failed: " + JSON.stringify(task))
                                log.error(lastErr)
    
                                addToSyncIssues("syncTask", "Could not rename " + pathModule.normalize(location.local + "/" + task.path) + " locally: " + lastErr.toString())
    
                                emitSyncTask("renameInLocal", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })
            
                                addTaskToRedoList({
                                    type: "renameInLocal",
                                    task,
                                    location
                                }).then(() => {
                                    return reject(lastErr)
                                }).catch((e) => {
                                    log.error(e)
    
                                    return reject(lastErr)
                                })

                                maxSyncTasksSemaphore.release()
    
                                return false
                            }
    
                            currentTries += 1
    
                            fsLocal.rename(pathModule.normalize(location.local + "/" + task.from), pathModule.normalize(location.local + "/" + task.to)).then((done) => {
                                emitSyncTask("renameInLocal", {
                                    status: "done",
                                    task,
                                    location
                                })
        
                                doneTasks.push({
                                    type: "renameInLocal",
                                    task,
                                    location
                                })

                                maxSyncTasksSemaphore.release()
        
                                return resolve(done)
                            }).catch((err) => {
                                log.error(err)
    
                                return setTimeout(() => {
                                    doTask(err)
                                }, retrySyncTaskTimeout)
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])
        }

        if(moveInRemoteTasks.length > 0){
            await Promise.allSettled([
                ...moveInRemoteTasks.map(task => new Promise((resolve, reject) => {
                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("moveInRemote", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr) => {
                            if(currentTries >= maxRetrySyncTask && typeof lastErr !== "undefined"){
                                log.error("moveInRemote task failed: " + JSON.stringify(task))
                                log.error(lastErr)
    
                                addToSyncIssues("syncTask", "Could not move " + pathModule.normalize(location.remote + "/" + task.path) + " remotely: " + lastErr.toString())
    
                                emitSyncTask("moveInRemote", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })
            
                                addTaskToRedoList({
                                    type: "moveInRemote",
                                    task,
                                    location
                                }).then(() => {
                                    return reject(lastErr)
                                }).catch((e) => {
                                    log.error(e)
    
                                    return reject(lastErr)
                                })

                                maxSyncTasksSemaphore.release()
    
                                return false
                            }
    
                            currentTries += 1
    
                            fsRemote.move(task.type, task, location, remoteTreeNow).then((done) => {
                                emitSyncTask("moveInRemote", {
                                    status: "done",
                                    task,
                                    location
                                })
        
                                doneTasks.push({
                                    type: "moveInRemote",
                                    task,
                                    location
                                })

                                maxSyncTasksSemaphore.release()
        
                                return resolve(done)
                            }).catch((err) => {
                                log.error(err)
    
                                return setTimeout(() => {
                                    doTask(err)
                                }, retrySyncTaskTimeout)
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])
        }

        if(moveInLocalTasks.length > 0){
            await Promise.allSettled([
                ...moveInLocalTasks.map(task => new Promise((resolve, reject) => {
                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("moveInLocal", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr) => {
                            if(currentTries >= maxRetrySyncTask && typeof lastErr !== "undefined"){
                                log.error("moveInLocal task failed: " + JSON.stringify(task))
                                log.error(lastErr)
    
                                addToSyncIssues("syncTask", "Could not move " + pathModule.normalize(location.local + "/" + task.path) + " locally: " + lastErr.toString())
    
                                emitSyncTask("moveInLocal", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })
            
                                addTaskToRedoList({
                                    type: "moveInLocal",
                                    task,
                                    location
                                }).then(() => {
                                    return reject(lastErr)
                                }).catch((e) => {
                                    log.error(e)
    
                                    return reject(lastErr)
                                })

                                maxSyncTasksSemaphore.release()
    
                                return false
                            }
    
                            currentTries += 1
    
                            fsLocal.move(pathModule.normalize(location.local + "/" + task.from), pathModule.normalize(location.local + "/" + task.to)).then((done) => {
                                emitSyncTask("moveInLocal", {
                                    status: "done",
                                    task,
                                    location
                                })
        
                                doneTasks.push({
                                    type: "moveInLocal",
                                    task,
                                    location
                                })

                                maxSyncTasksSemaphore.release()
        
                                return resolve(done)
                            }).catch((err) => {
                                log.error(err)
    
                                return setTimeout(() => {
                                    doTask(err)
                                }, retrySyncTaskTimeout)
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])
        }

        if(deleteInRemoteTasks.length > 0){
            await Promise.allSettled([
                ...deleteInRemoteTasks.map(task => new Promise((resolve, reject) => {
                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("deleteInRemote", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr) => {
                            if(currentTries >= maxRetrySyncTask && typeof lastErr !== "undefined"){
                                log.error("deleteInRemote task failed: " + JSON.stringify(task))
                                log.error(lastErr)
    
                                addToSyncIssues("syncTask", "Could not delete " + pathModule.normalize(location.remote + "/" + task.path) + " remotely: " + lastErr.toString())
    
                                emitSyncTask("deleteInRemote", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })
            
                                addTaskToRedoList({
                                    type: "deleteInRemote",
                                    task,
                                    location
                                }).then(() => {
                                    return reject(lastErr)
                                }).catch((e) => {
                                    log.error(e)
    
                                    return reject(lastErr)
                                })

                                maxSyncTasksSemaphore.release()
    
                                return false
                            }
    
                            currentTries += 1
    
                            fsRemote.rm(task.type, task.item.uuid).then((done) => {
                                emitSyncTask("deleteInRemote", {
                                    status: "done",
                                    task,
                                    location
                                })
        
                                doneTasks.push({
                                    type: "deleteInRemote",
                                    task,
                                    location
                                })

                                maxSyncTasksSemaphore.release()
        
                                return resolve(done)
                            }).catch((err) => {
                                log.error(err)
    
                                return setTimeout(() => {
                                    doTask(err)
                                }, retrySyncTaskTimeout)
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])
        }

        if(deleteInLocalTasks.length > 0){
            await Promise.allSettled([
                ...deleteInLocalTasks.map(task => new Promise((resolve, reject) => {
                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("deleteInLocal", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr) => {
                            if(currentTries >= maxRetrySyncTask && typeof lastErr !== "undefined"){
                                log.error("deleteInLocal task failed: " + JSON.stringify(task))
                                log.error(lastErr)
    
                                addToSyncIssues("syncTask", "Could not delete " + pathModule.normalize(location.local + "/" + task.path) + " locally: " + lastErr.toString())
            
                                emitSyncTask("deleteInLocal", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })
    
                                addTaskToRedoList({
                                    type: "deleteInLocal",
                                    task,
                                    location
                                }).then(() => {
                                    return reject(lastErr)
                                }).catch((e) => {
                                    log.error(e)
    
                                    return reject(lastErr)
                                })

                                maxSyncTasksSemaphore.release()
    
                                return false
                            }
    
                            currentTries += 1 
    
                            fsLocal.rm(pathModule.normalize(location.local + "/" + task.path)).then((done) => {
                                emitSyncTask("deleteInLocal", {
                                    status: "done",
                                    task,
                                    location
                                })
        
                                doneTasks.push({
                                    type: "deleteInLocal",
                                    task,
                                    location
                                })

                                maxSyncTasksSemaphore.release()
        
                                return resolve(done)
                            }).catch((err) => {
                                log.error(err)
    
                                return setTimeout(() => {
                                    doTask(err)
                                }, retrySyncTaskTimeout)
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])
        }

        if(uploadToRemoteTasks.length > 0){
            await Promise.allSettled([
                ...uploadToRemoteTasks.map(task => new Promise((resolve, reject) => {
                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("uploadToRemote", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr) => {
                            if(currentTries >= maxRetrySyncTask && typeof lastErr !== "undefined"){
                                log.error("uploadToRemote task failed: " + JSON.stringify(task))
                                log.error(lastErr)
    
                                addToSyncIssues("syncTask", "Could not upload " + pathModule.normalize(location.local + "/" + task.path) + ": " + lastErr.toString())
    
                                emitSyncTask("uploadToRemote", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })
            
                                addTaskToRedoList({
                                    type: "uploadToRemote",
                                    task,
                                    location
                                }).then(() => {
                                    return reject(lastErr)
                                }).catch((e) => {
                                    log.error(e)
    
                                    return reject(lastErr)
                                })

                                maxSyncTasksSemaphore.release()
    
                                return false
                            }
    
                            currentTries += 1
    
                            maxConcurrentUploadsSemaphore.acquire().then(() => {
                                emitSyncTask("uploadToRemote", {
                                    status: "started",
                                    task,
                                    location
                                })
    
                                const promise = task.type == "folder" ? fsRemote.mkdir(task.path, remoteTreeNow, location, task, task.item.uuid) : fsRemote.upload(task.path, remoteTreeNow, location, task, task.item.uuid)
    
                                promise.then((result) => {
                                    maxConcurrentUploadsSemaphore.release()
    
                                    emitSyncTask("uploadToRemote", {
                                        status: "done",
                                        task,
                                        location
                                    })
    
                                    doneTasks.push({
                                        type: "uploadToRemote",
                                        task: {
                                            ...task,
                                            info: {
                                                ...result
                                            }
                                        },
                                        location
                                    })

                                    maxSyncTasksSemaphore.release()
    
                                    return resolve(result)
                                }).catch((err) => {
                                    maxConcurrentUploadsSemaphore.release()
    
                                    log.error(err)
    
                                    return setTimeout(() => {
                                        doTask(err)
                                    }, retrySyncTaskTimeout)
                                })
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])
        }

        if(downloadFromRemoteTasks.length > 0){
            await Promise.allSettled([
                ...downloadFromRemoteTasks.map(task => new Promise((resolve, reject) => {
                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("downloadFromRemote", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr) => {
                            if(currentTries >= maxRetrySyncTask && typeof lastErr !== "undefined"){
                                log.error("downloadFromRemote task failed: " + JSON.stringify(task))
                                log.error(lastErr)
    
                                addToSyncIssues("syncTask", "Could not download " + pathModule.normalize(location.local + "/" + task.path) + ": " + lastErr.toString())
    
                                emitSyncTask("downloadFromRemote", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })
            
                                addTaskToRedoList({
                                    type: "downloadFromRemote",
                                    task,
                                    location
                                }).then(() => {
                                    return reject(lastErr)
                                }).catch((e) => {
                                    log.error(e)
    
                                    return reject(lastErr)
                                })

                                maxSyncTasksSemaphore.release()
    
                                return false
                            }
    
                            currentTries += 1
    
                            maxConcurrentDownloadsSemaphore.acquire().then(() => {
                                emitSyncTask("downloadFromRemote", {
                                    status: "started",
                                    task,
                                    location
                                })
    
                                const promise = task.type == "folder" ? fsLocal.mkdir(task.path, location, task) : fsLocal.download(task.path, location, task)
    
                                promise.then((result) => {
                                    maxConcurrentDownloadsSemaphore.release()
    
                                    emitSyncTask("downloadFromRemote", {
                                        status: "done",
                                        task,
                                        location
                                    })
    
                                    doneTasks.push({
                                        type: "downloadFromRemote",
                                        task: {
                                            ...task,
                                            info: {
                                                ...result
                                            }
                                        },
                                        location
                                    })

                                    maxSyncTasksSemaphore.release()
    
                                    return resolve(result)
                                }).catch((err) => {
                                    maxConcurrentDownloadsSemaphore.release()
    
                                    log.error(err)
    
                                    return setTimeout(() => {
                                        doTask(err)
                                    }, retrySyncTaskTimeout)
                                })
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])
        }

        return resolve({
            doneTasks
        })
    })
}

const consumeDeltas = ({ localDeltas, remoteDeltas, lastLocalTree, lastRemoteTree, localTreeNow, remoteTreeNow }) => {
    return new Promise((resolve, reject) => {
        const localFileDeltas = localDeltas.files
        const localFolderDeltas = localDeltas.folders
        const remoteFileDeltas = remoteDeltas.files
        const remoteFolderDeltas = remoteDeltas.folders

        const uploadToRemote = []
        const downloadFromRemote = []
        const renameInLocal = []
        const renameInRemote = []
        const moveInLocal = []
        const moveInRemote = []
        const deleteInLocal = []
        const deleteInRemote = []

        const addedToList = {}

        for(const path in localFolderDeltas){
            const localDelta = localFolderDeltas[path]?.type
            const remoteDelta = remoteFolderDeltas[path]?.type
            const existsInRemote = typeof remoteFolderDeltas[path] !== "undefined"

            if(localDelta == "RENAMED" && !addedToList[path]){
                addedToList[path] = true
                renameInRemote.push({
                    uuid: uuidv4(),
                    path,
                    type: "folder",
                    item: typeof remoteTreeNow.folders[localFolderDeltas[path]?.from] !== "undefined" ? remoteTreeNow.folders[localFolderDeltas[path]?.from] : lastRemoteTree.folders[localFolderDeltas[path]?.from],
                    from: localFolderDeltas[path]?.from,
                    to: localFolderDeltas[path]?.to
                })
            }

            if(localDelta == "MOVED" && !addedToList[path]){
                addedToList[path] = true
                moveInRemote.push({
                    uuid: uuidv4(),
                    path,
                    type: "folder",
                    item: typeof remoteTreeNow.folders[localFolderDeltas[path]?.from] !== "undefined" ? remoteTreeNow.folders[localFolderDeltas[path]?.from] : lastRemoteTree.folders[localFolderDeltas[path]?.from],
                    from: localFolderDeltas[path]?.from,
                    to: localFolderDeltas[path]?.to
                })
            }

            if(localDelta == "DELETED" && !addedToList[path]){
                addedToList[path] = true
                deleteInRemote.push({
                    uuid: uuidv4(),
                    path,
                    type: "folder",
                    item: lastRemoteTree.folders[path]
                })
            }

            if(!existsInRemote && !addedToList[path]){
                addedToList[path] = true
                uploadToRemote.push({
                    uuid: uuidv4(),
                    path,
                    type: "folder",
                    item: {
                        ...localTreeNow.folders[path],
                        uuid: uuidv4()
                    }
                })
            }
        }

        for(const path in remoteFolderDeltas){
            const localDelta = localFolderDeltas[path]?.type
            const remoteDelta = remoteFolderDeltas[path]?.type
            const existsInLocal = typeof localFolderDeltas[path] !== "undefined"

            if(remoteDelta == "RENAMED" && localDelta !== "RENAMED" && !addedToList[path]){
                addedToList[path] = true
                renameInLocal.push({
                    uuid: uuidv4(),
                    path,
                    type: "folder",
                    item: remoteTreeNow.folders[path],
                    from: remoteFolderDeltas[path]?.from,
                    to: remoteFolderDeltas[path]?.to
                })
            }

            if(remoteDelta == "MOVED" && localDelta !== "MOVED" && !addedToList[path]){
                addedToList[path] = true
                moveInLocal.push({
                    uuid: uuidv4(),
                    path,
                    type: "folder",
                    item: { path },
                    from: remoteFolderDeltas[path]?.from,
                    to: remoteFolderDeltas[path]?.to
                })
            }

            if(remoteDelta == "DELETED" && localDelta !== "DELETED" && !addedToList[path]){
                addedToList[path] = true
                deleteInLocal.push({
                    uuid: uuidv4(),
                    path,
                    type: "folder",
                    item: remoteTreeNow.folders[path]
                })
            }

            if(!existsInLocal && !addedToList[path]){
                addedToList[path] = true
                downloadFromRemote.push({
                    uuid: uuidv4(),
                    path,
                    type: "folder",
                    item: remoteTreeNow.folders[path]
                })
            }
        }

        for(const path in localFileDeltas){
            const localDelta = localFileDeltas[path]?.type
            const remoteDelta = remoteFileDeltas[path]?.type
            const existsInRemote = typeof remoteFileDeltas[path] !== "undefined"
            const localLastModified = localTreeNow[path]?.lastModified
            const remoteLastModified = remoteTreeNow[path]?.metadata.lastModified
            const sameLastModified = localLastModified === remoteTreeNow[path]?.metadata.lastModified

            if(localDelta == "RENAMED" && !addedToList[path]){
                addedToList[path] = true
                renameInRemote.push({
                    uuid: uuidv4(),
                    path,
                    type: "file",
                    item: typeof remoteTreeNow.files[localFileDeltas[path]?.from] !== "undefined" ? remoteTreeNow.files[localFileDeltas[path]?.from] : lastRemoteTree.files[localFileDeltas[path]?.from],
                    from: localFileDeltas[path]?.from,
                    to: localFileDeltas[path]?.to
                })
            }

            if(localDelta == "MOVED" && !addedToList[path]){
                addedToList[path] = true
                moveInRemote.push({
                    uuid: uuidv4(),
                    path,
                    type: "file",
                    item: typeof remoteTreeNow.files[localFileDeltas[path]?.from] !== "undefined" ? remoteTreeNow.files[localFileDeltas[path]?.from] : lastRemoteTree.files[localFileDeltas[path]?.from],
                    from: localFileDeltas[path]?.from,
                    to: localFileDeltas[path]?.to
                })
            }

            if(localDelta == "DELETED" && !addedToList[path]){
                addedToList[path] = true
                deleteInRemote.push({
                    uuid: uuidv4(),
                    path,
                    type: "file",
                    item: lastRemoteTree.files[path]
                })
            }

            if(localDelta == "NEW" && remoteDelta == "NEW" && !sameLastModified && !addedToList[path]){
                addedToList[path] = true

                if(localLastModified > remoteLastModified){
                    uploadToRemote.push({
                        uuid: uuidv4(),
                        path,
                        type: "file",
                        item: {
                            ...localTreeNow.files[path],
                            uuid: uuidv4()
                        }
                    })
                }
                else{
                    downloadFromRemote.push({
                        uuid: uuidv4(),
                        path,
                        type: "file",
                        item: remoteTreeNow.files[path]
                    })
                }
            }

            if(localDelta == "NEWER" && remoteDelta == "NEWER" && !sameLastModified && !addedToList[path]){
                addedToList[path] = true

                if(localLastModified > remoteLastModified){
                    uploadToRemote.push({
                        uuid: uuidv4(),
                        path,
                        type: "file",
                        item: {
                            ...localTreeNow.files[path],
                            uuid: uuidv4()
                        }
                    })
                }
                else{
                    downloadFromRemote.push({
                        uuid: uuidv4(),
                        path,
                        type: "file",
                        item: remoteTreeNow.files[path]
                    })
                }
            }

            if(localDelta == "NEWER" && !addedToList[path]){
                addedToList[path] = true
                uploadToRemote.push({
                    uuid: uuidv4(),
                    path,
                    type: "file",
                    item: {
                        ...localTreeNow.files[path],
                        uuid: uuidv4()
                    }
                })
            }

            if(!existsInRemote && !addedToList[path]){
                addedToList[path] = true
                uploadToRemote.push({
                    uuid: uuidv4(),
                    path,
                    type: "file",
                    item: {
                        ...localTreeNow.files[path],
                        uuid: uuidv4()
                    }
                })
            }
        }

        for(const path in remoteFileDeltas){
            const localDelta = localFileDeltas[path]?.type
            const remoteDelta = remoteFileDeltas[path]?.type
            const existsInLocal = typeof localFileDeltas[path] !== "undefined"

            if(remoteDelta == "RENAMED" && localDelta !== "RENAMED" && !addedToList[path]){
                addedToList[path] = true
                renameInLocal.push({
                    uuid: uuidv4(),
                    path,
                    type: "file",
                    item: remoteTreeNow.files[path],
                    from: remoteFileDeltas[path]?.from,
                    to: remoteFileDeltas[path]?.to
                })
            }

            if(remoteDelta == "MOVED" && localDelta !== "MOVED" && !addedToList[path]){
                addedToList[path] = true
                moveInLocal.push({
                    uuid: uuidv4(),
                    path,
                    type: "file",
                    item: { path },
                    from: remoteFileDeltas[path]?.from,
                    to: remoteFileDeltas[path]?.to
                })
            }

            if(remoteDelta == "DELETED" && localDelta !== "DELETED" && !addedToList[path]){
                addedToList[path] = true
                deleteInLocal.push({
                    uuid: uuidv4(),
                    path,
                    type: "file",
                    item: remoteTreeNow.files[path]
                })
            }

            if(remoteDelta == "NEWER" && localDelta !== "NEWER" && !addedToList[path]){
                addedToList[path] = true
                downloadFromRemote.push({
                    uuid: uuidv4(),
                    path,
                    type: "file",
                    item: remoteTreeNow.files[path]
                })
            }

            if(!existsInLocal && !addedToList[path]){
                addedToList[path] = true
                downloadFromRemote.push({
                    uuid: uuidv4(),
                    path,
                    type: "file",
                    item: remoteTreeNow.files[path]
                })
            }
        }

        return resolve({
            uploadToRemote,
            downloadFromRemote,
            renameInLocal,
            renameInRemote,
            moveInLocal,
            moveInRemote,
            deleteInLocal,
            deleteInRemote
        })
    })
}

const applyDoneTasksToSavedState = ({ doneTasks, localTreeNow, remoteTreeNow }) => {
    return new Promise((resolve, reject) => {
        for(let i = 0; i < doneTasks.length; i++){
            const { type, task } = doneTasks[i]

            if(type == "renameInRemote"){
                if(task.type == "folder"){
                    const oldParentPath = task.from + "/"
                    const newParentPath = task.to + "/"

                    for(const path in remoteTreeNow.folders){
                        if(task.from == path){
                            remoteTreeNow.folders[task.to] = remoteTreeNow.folders[path]

                            delete remoteTreeNow.folders[path]
                        }
                        else if(path.startsWith(oldParentPath)){
                            const newPath = newParentPath + path.slice(oldParentPath.length)

                            remoteTreeNow.folders[newPath] = remoteTreeNow.folders[path]

                            delete remoteTreeNow.folders[path]
                        }
                    }

                    for(const path in remoteTreeNow.files){
                        if(path.startsWith(oldParentPath)){
                            const newPath = newParentPath + path.slice(oldParentPath.length)

                            remoteTreeNow.files[newPath] = remoteTreeNow.files[path]

                            delete remoteTreeNow.files[path]
                        }
                    }

                    for(const prop in remoteTreeNow.uuids){
                        const path = remoteTreeNow.uuids[prop].path
    
                        if(task.from == path){
                            remoteTreeNow.uuids[prop].path = task.to
                        }
                        else if(path.startsWith(oldParentPath)){
                            const newPath = newParentPath + path.slice(oldParentPath.length)

                            remoteTreeNow.uuids[prop].path = newPath
                        }
                    }
                }
                else{
                    for(const path in remoteTreeNow.files){
                        if(task.from == path){
                            remoteTreeNow.files[task.to] = remoteTreeNow.files[path]

                            delete remoteTreeNow.files[path]
                        }
                    }

                    for(const prop in remoteTreeNow.uuids){
                        const path = remoteTreeNow.uuids[prop].path
    
                        if(task.from == path){
                            remoteTreeNow.uuids[prop].path = task.to
                        }
                    }
                }
            }
            else if(type == "renameInLocal"){
                if(task.type == "folder"){
                    const oldParentPath = task.from + "/"
                    const newParentPath = task.to + "/"

                    for(const path in localTreeNow.folders){
                        if(task.from == path){
                            localTreeNow.folders[task.to] = localTreeNow.folders[path]

                            delete localTreeNow.folders[path]
                        }
                        else if(path.startsWith(oldParentPath)){
                            const newPath = newParentPath + path.slice(oldParentPath.length)

                            localTreeNow.folders[newPath] = localTreeNow.folders[path]

                            delete localTreeNow.folders[path]
                        }
                    }

                    for(const path in localTreeNow.files){
                        if(path.startsWith(oldParentPath)){
                            const newPath = newParentPath + path.slice(oldParentPath.length)

                            localTreeNow.files[newPath] = localTreeNow.files[path]

                            delete localTreeNow.files[path]
                        }
                    }

                    for(const prop in localTreeNow.ino){
                        const path = localTreeNow.ino[prop].path
    
                        if(task.from == path){
                            localTreeNow.ino[prop].path = task.to
                        }
                        else if(path.startsWith(oldParentPath)){
                            const newPath = newParentPath + path.slice(oldParentPath.length)

                            localTreeNow.ino[prop].path = newPath
                        }
                    }
                }
                else{
                    for(const path in localTreeNow.files){
                        if(task.from == path){
                            localTreeNow.files[task.to] = localTreeNow.files[path]

                            delete localTreeNow.files[path]
                        }
                    }

                    for(const prop in localTreeNow.ino){
                        const path = localTreeNow.ino[prop].path
    
                        if(task.from == path){
                            localTreeNow.ino[prop].path = task.to
                        }
                    }
                }
            }
            else if(type == "moveInRemote"){
                if(task.type == "folder"){
                    const oldParentPath = task.from + "/"
                    const newParentPath = task.to + "/"

                    for(const path in remoteTreeNow.folders){
                        if(task.from == path){
                            remoteTreeNow.folders[task.to] = remoteTreeNow.folders[path]

                            delete remoteTreeNow.folders[path]
                        }
                        else if(path.startsWith(oldParentPath)){
                            const newPath = newParentPath + path.slice(oldParentPath.length)

                            remoteTreeNow.folders[newPath] = remoteTreeNow.folders[path]

                            delete remoteTreeNow.folders[path]
                        }
                    }

                    for(const path in remoteTreeNow.files){
                        if(path.startsWith(oldParentPath)){
                            const newPath = newParentPath + path.slice(oldParentPath.length)

                            remoteTreeNow.files[newPath] = remoteTreeNow.files[path]

                            delete remoteTreeNow.files[path]
                        }
                    }

                    for(const prop in remoteTreeNow.uuids){
                        const path = remoteTreeNow.uuids[prop].path
    
                        if(task.from == path){
                            remoteTreeNow.uuids[prop].path = task.to
                        }
                        else if(path.startsWith(oldParentPath)){
                            const newPath = newParentPath + path.slice(oldParentPath.length)

                            remoteTreeNow.uuids[prop].path = newPath
                        }
                    }
                }
                else{
                    for(const path in remoteTreeNow.files){
                        if(task.from == path){
                            remoteTreeNow.files[task.to] = remoteTreeNow.files[path]

                            delete remoteTreeNow.files[path]
                        }
                    }

                    for(const prop in remoteTreeNow.uuids){
                        const path = remoteTreeNow.uuids[prop].path
    
                        if(task.from == path){
                            remoteTreeNow.uuids[prop].path = task.to
                        }
                    }
                }
            }
            else if(type == "moveInLocal"){
                if(task.type == "folder"){
                    const oldParentPath = task.from + "/"
                    const newParentPath = task.to + "/"

                    for(const path in localTreeNow.folders){
                        if(task.from == path){
                            localTreeNow.folders[task.to] = localTreeNow.folders[path]

                            delete localTreeNow.folders[path]
                        }
                        else if(path.startsWith(oldParentPath)){
                            const newPath = newParentPath + path.slice(oldParentPath.length)

                            localTreeNow.folders[newPath] = localTreeNow.folders[path]

                            delete localTreeNow.folders[path]
                        }
                    }

                    for(const path in localTreeNow.files){
                        if(path.startsWith(oldParentPath)){
                            const newPath = newParentPath + path.slice(oldParentPath.length)

                            localTreeNow.files[newPath] = localTreeNow.files[path]

                            delete localTreeNow.files[path]
                        }
                    }

                    for(const prop in localTreeNow.ino){
                        const path = localTreeNow.ino[prop].path
    
                        if(task.from == path){
                            localTreeNow.ino[prop].path = task.to
                        }
                        else if(path.startsWith(oldParentPath)){
                            const newPath = newParentPath + path.slice(oldParentPath.length)

                            localTreeNow.ino[prop].path = newPath
                        }
                    }
                }
                else{
                    for(const path in localTreeNow.files){
                        if(task.from == path){
                            localTreeNow.files[task.to] = localTreeNow.files[path]

                            delete localTreeNow.files[path]
                        }
                    }

                    for(const prop in localTreeNow.ino){
                        const path = localTreeNow.ino[prop].path
    
                        if(task.from == path){
                            localTreeNow.ino[prop].path = task.to
                        }
                    }
                }
            }
            else if(type == "deleteInRemote" || type == "deleteInLocal"){
                if(task.type == "folder"){
                    const parentPath = task.path + "/"

                    if(type == "deleteInRemote"){
                        for(const path in remoteTreeNow.folders){
                            if(task.path == path){
                                delete remoteTreeNow.folders[path]
                            }
                            else if(path.startsWith(parentPath)){
                                delete remoteTreeNow.folders[path]
                            }
                        }
    
                        for(const path in remoteTreeNow.files){
                            if(path.startsWith(parentPath)){
                                delete remoteTreeNow.files[path]
                            }
                        }
    
                        for(const prop in remoteTreeNow.uuids){
                            const path = remoteTreeNow.uuids[prop].path
        
                            if(task.path == path){
                                delete remoteTreeNow.uuids[prop]
                            }
                            else if(path.startsWith(parentPath)){
                                delete remoteTreeNow.uuids[prop]
                            }
                        }
                    }
                    else{
                        for(const path in localTreeNow.folders){
                            if(task.path == path){
                                delete localTreeNow.folders[path]
                            }
                            else if(path.startsWith(parentPath)){
                                delete localTreeNow.folders[path]
                            }
                        }
    
                        for(const path in localTreeNow.files){
                            if(path.startsWith(parentPath)){
                                delete localTreeNow.files[path]
                            }
                        }
    
                        for(const prop in localTreeNow.ino){
                            const path = localTreeNow.ino[prop].path
        
                            if(task.path == path){
                                delete localTreeNow.ino[prop]
                            }
                            else if(path.startsWith(parentPath)){
                                delete localTreeNow.ino[prop]
                            }
                        }
                    }
                }
                else{
                    if(type == "deleteInRemote"){
                        for(const path in remoteTreeNow.files){
                            if(task.path == path){
                                delete remoteTreeNow.files[path]
                            }
                        }
                        
                        for(const prop in remoteTreeNow.uuids){
                            const path = remoteTreeNow.uuids[prop].path
                        
                            if(task.path == path){
                                delete remoteTreeNow.uuids[prop]
                            }
                        }
                    }
                    else{
                        for(const path in localTreeNow.files){
                            if(task.path == path){
                                delete localTreeNow.files[path]
                            }
                        }
                        
                        for(const prop in localTreeNow.ino){
                            const path = localTreeNow.ino[prop].path
                        
                            if(task.path == path){
                                delete localTreeNow.ino[prop]
                            }
                        }
                    }
                }
            }
            else if(type == "uploadToRemote"){
                if(task.type == "folder"){
                    remoteTreeNow.folders[task.path] = {
                        name: task.item.name,
                        parent: task.info.parent,
                        path: task.path,
                        type: "folder",
                        uuid: task.item.uuid
                    }

                    remoteTreeNow.uuids[task.item.uuid] = {
                        type: "folder",
                        path: task.path
                    }
                }
                else{
                    remoteTreeNow.files[task.path] = {
                        bucket: task.info.bucket,
                        chunks: task.info.chunks,
                        metadata: task.info.metadata,
                        parent: task.info.parent,
                        path: task.path,
                        region: task.info.region,
                        type: "file",
                        uuid: task.item.uuid,
                        version: task.info.version
                    }

                    remoteTreeNow.uuids[task.item.uuid] = {
                        type: "file",
                        path: task.path
                    }
                }
            }
            else if(type == "downloadFromRemote"){
                if(task.type == "folder"){
                    localTreeNow.folders[task.path] = {
                        name: task.item.name,
                        lastModified: Math.floor(task.info.mtimeMs)
                    }

                    localTreeNow.ino[task.info.ino] = {
                        type: "folder",
                        path: task.path
                    }
                }
                else{
                    localTreeNow.files[task.path] = {
                        name: task.item.metadata.name,
                        lastModified: Math.floor(task.info.mtimeMs),
                        size: task.info.size
                    }

                    localTreeNow.ino[task.info.ino] = {
                        type: "file",
                        path: task.path
                    }
                }
            }
        }

        return resolve({
            localTreeNowApplied: localTreeNow,
            remoteTreeNowApplied: remoteTreeNow
        })
    })
}

const addToSyncIssues = (type, message) => {
    return new Promise((resolve, reject) => {
        db.get("syncIssues").then((syncIssues) => {
            if(!Array.isArray(syncIssues)){
                syncIssues = []
            }

            syncIssues.push({
                type,
                message,
                timestamp: new Date().getTime()
            })

            db.set("syncIssues", syncIssues).then(resolve).catch(reject)
        })
    })
}

const updateLocationBusyStatus = (uuid, busy) => {
    return new Promise((resolve, reject) => {
        db.get("userId").then((userId) => {
            db.get("syncLocations:" + userId).then((syncLocations) => {
                if(!Array.isArray(syncLocations)){
                    syncLocations = []
                }

                syncLocations = syncLocations.map(location => location.uuid == uuid ? { ...location, busy } : location)

                db.set("syncLocations:" + userId, syncLocations).then(resolve).catch(reject)
            }).catch(reject)
        }).catch(reject)
    })
}

const emitSyncTask = (type, data) => {
    sendToAllPorts({
        type: "syncTask",
        data: {
            type,
            data
        }
    })

    return true
}

const emitSyncStatus = (type, data) => {
    sendToAllPorts({
        type: "syncStatus",
        data: {
            type,
            data
        }
    })

    return true
}

const emitSyncStatusLocation = (type, data) => {
    sendToAllPorts({
        type: "syncStatusLocation",
        data: {
            type,
            data
        }
    })

    return true
}

const removeRemoteLocation = (location) => {
    return new Promise(async (resolve) => {
        try{
            const userId = await db.get("userId")
            let currentSyncLocations = await db.get("syncLocations:" + userId)

            if(!Array.isArray(currentSyncLocations)){
                currentSyncLocations = []
            }

            for(let i = 0; i < currentSyncLocations.length; i++){
                if(currentSyncLocations[i].uuid == location.uuid){
                    currentSyncLocations[i].remoteUUID = undefined
                    currentSyncLocations[i].remote = undefined
                    currentSyncLocations[i].remoteName = undefined
                    currentSyncLocations[i].paused = true
                }
            }

            await Promise.all([
                db.set("syncLocations:" + userId, currentSyncLocations),
                db.remove("lastLocalTree:" + location.uuid),
                db.remove("lastRemoteTree:" + location.uuid)
            ])
        }
        catch(e){
            log.error(e)
        }

        return resolve(true)
    })
}

const syncLocation = async (location) => {
    if(location.paused){
        log.info("Sync location " + location.uuid + " -> " + location.local + " <-> " + location.remote + " [" + location.type + "] is paused")

        await updateLocationBusyStatus(location.uuid, false)

        return true
    }

    await updateLocationBusyStatus(location.uuid, true)

    log.info("Starting sync task for location " + location.uuid + " -> " + location.local + " <-> " + location.remote + " [" + location.type + "] (" + JSON.stringify(location) + ")")
    log.info("Smoke testing location " + location.uuid)

    emitSyncStatusLocation("smokeTest", {
        status: "start",
        location
    })

    try{
        await Promise.all([
            fsLocal.smokeTest(pathModule.normalize(location.local)),
            fs.access(pathModule.normalize(location.local), fs.constants.R_OK | fs.constants.W_OK),
            fsRemote.smokeTest(location.remoteUUID)
        ])
    }
    catch(e){
        if(e.toString().toLowerCase().indexOf("remote folder") !== -1 && e.toString().toLowerCase().indexOf("is not present") !== -1){
            await removeRemoteLocation(location)
        }
        else{
            log.error("Smoke test for location " + location.uuid + " failed")
            log.error(e)

            addToSyncIssues("smokeTest", "Smoke test for location " + location.uuid + " failed: " + e.toString())

            emitSyncStatusLocation("smokeTest", {
                status: "err",
                location,
                err: e
            })
        }

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    emitSyncStatusLocation("smokeTest", {
        status: "done",
        location
    })

    if(typeof WATCHERS[location.local] == "undefined"){
        log.info("Starting local directory watcher for location " + location.uuid)

        emitSyncStatusLocation("initWatcher", {
            status: "start",
            location
        })

        try{
            await ipc.watchDirectory(pathModule.normalize(location.local), location.uuid)
        }
        catch(e){
            log.error("Could not start local directory watcher for location " + location.uuid)
            log.error(e)

            addToSyncIssues("watchDirectory", "Could not start local directory watcher (" + pathModule.normalize(location.local) + "): " + e.toString())

            emitSyncStatusLocation("initWatcher", {
                status: "err",
                location,
                err: e
            })
        }

        WATCHERS[location.local] = true

        emitSyncStatusLocation("initWatcher", {
            status: "done",
            location
        })
    }

    log.info("Getting directory trees for location " + location.uuid)

    emitSyncStatusLocation("getTrees", {
        status: "start",
        location
    })

    try{
        var [{
                data: localTreeNow,
                changed: localDataChanged
            }, 
            {
                data: remoteTreeNow,
                changed: remoteDataChanged
            }] = await Promise.all([
            fsLocal.directoryTree(pathModule.normalize(location.local), typeof IS_FIRST_REQUEST[location.uuid] == "undefined", location),
            fsRemote.directoryTree(location.remoteUUID, typeof IS_FIRST_REQUEST[location.uuid] == "undefined", location)
        ])
    }
    catch(e){
        if(e.toString().toLowerCase().indexOf("folder not found") !== -1){
            await removeRemoteLocation(location)
        }
        else{
            log.error("Could not get directory trees for location " + location.uuid)
            log.error(e)

            addToSyncIssues("getTrees", "Could not get directory trees: " + e.toString())

            emitSyncStatusLocation("getTrees", {
                status: "err",
                location,
                err: e
            })
        }

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    IS_FIRST_REQUEST[location.uuid] = false

    if(!localDataChanged && !remoteDataChanged && typeof IS_FIRST_REQUEST[location.uuid] !== "undefined"){
        log.info("Data did not change since last sync, skipping cycle")

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    //log.info("localTreeNow", localTreeNow)
    //log.info("remoteTreeNow", remoteTreeNow)

    try{
        var [lastLocalTree, lastRemoteTree] = await Promise.all([
            db.get("lastLocalTree:" + location.uuid),
            db.get("lastRemoteTree:" + location.uuid)
        ])
    }
    catch(e){
        log.error("Could not get last local/remote tree for location " + location.uuid)
        log.error(e)

        addToSyncIssues("getTrees", "Could not get last local/remote tree for location " + location.uuid + ": " + e.toString())

        emitSyncStatusLocation("getTrees", {
            status: "err",
            location,
            err: e
        })

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    emitSyncStatusLocation("getTrees", {
        status: "done",
        location
    })

    if(!lastLocalTree || !lastRemoteTree){
        log.info("lastLocalTree/lastRemoteTree for location " + location.uuid + " empty, skipping")

        try{
            await Promise.all([
                db.set("lastLocalTree:" + location.uuid, localTreeNow),
                db.set("lastRemoteTree:" + location.uuid, remoteTreeNow)
            ])
        }
        catch(e){
            log.error("Could not save lastLocalTree/lastRemoteTree to DB for location " + location.uuid)
            log.error(e)
        }

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    log.info("Getting deltas for location " + location.uuid)

    emitSyncStatusLocation("getDeltas", {
        status: "start",
        location
    })

    try{
        var localDeltas = await getDeltas("local", lastLocalTree, localTreeNow)
        var remoteDeltas = await getDeltas("remote", lastRemoteTree, remoteTreeNow)
    }
    catch(e){
        log.error("Could not get deltas for location " + location.uuid)
        log.error(e)

        addToSyncIssues("getDeltas", "Could not get deltas: " + e.toString())

        emitSyncStatusLocation("getDeltas", {
            status: "err",
            location,
            err: e
        })

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    emitSyncStatusLocation("getDeltas", {
        status: "done",
        location
    })

    log.info("Consuming deltas for location " + location.uuid)

    emitSyncStatusLocation("consumeDeltas", {
        status: "start",
        location
    })

    try{
        var { uploadToRemote, downloadFromRemote, renameInLocal, renameInRemote, moveInLocal, moveInRemote, deleteInLocal, deleteInRemote } = await consumeDeltas({ localDeltas, remoteDeltas, lastLocalTree, lastRemoteTree, localTreeNow, remoteTreeNow })
    }
    catch(e){
        log.error("Could not consume deltas for location " + location.uuid)
        log.error(e)

        addToSyncIssues("consumeDeltas", "Could not consume deltas for location " + location.uuid + ": " + e.toString())

        emitSyncStatusLocation("consumeDeltas", {
            status: "err",
            location,
            err: e
        })

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    emitSyncStatusLocation("consumeDeltas", {
        status: "done",
        location
    })

    log.info("Consuming tasks for location " + location.uuid)

    emitSyncStatusLocation("consumeTasks", {
        status: "start",
        location
    })

    try{
        var { doneTasks } = await consumeTasks({ uploadToRemote, downloadFromRemote, renameInLocal, renameInRemote, moveInLocal, moveInRemote, deleteInLocal, deleteInRemote, lastLocalTree, lastRemoteTree, localTreeNow, remoteTreeNow, location })
    }
    catch(e){
        log.error("Could not consume tasks for location " + location.uuid)
        log.error(e)

        addToSyncIssues("consumeTasks", "Could not consume tasks for location " + location.uuid + ": " + e.toString())

        emitSyncStatusLocation("consumeTasks", {
            status: "err",
            location,
            err: e
        })

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    emitSyncStatusLocation("consumeTasks", {
        status: "done",
        location
    })

    try{
        const syncIssues = await db.get("syncIssues")

        if(Array.isArray(syncIssues) && syncIssues.length > 0){
            log.info("Got open sync issues after consume, won't apply anything to saved state")

            updateLocationBusyStatus(location.uuid, false)

            return false
        }
    }
    catch(e){
        log.error("Could not get sync issues after consume for location " + location.uuid)
        log.error(e)

        addToSyncIssues("getSyncIssuesAfterConsume", "Could not get sync issues after consume for location " + location.uuid + ": " + e.toString())

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    log.info("Applying " + doneTasks.length + " done tasks to saved state for location " + location.uuid)

    emitSyncStatusLocation("applyDoneTasksToSavedState", {
        status: "start",
        location
    })

    try{
        var { localTreeNowApplied, remoteTreeNowApplied } = await applyDoneTasksToSavedState({ doneTasks, localTreeNow, remoteTreeNow })
    }
    catch(e){
        log.error("Could not apply " + doneTasks.length + " done tasks to saved state for location " + location.uuid)
        log.error(e)

        addToSyncIssues("applyDoneTasksToSavedState", "Could not apply " + doneTasks.length + " done tasks to saved state for location " + location.uuid + ": " + e.toString())

        emitSyncStatusLocation("applyDoneTasksToSavedState", {
            status: "err",
            location,
            err: e
        })

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    emitSyncStatusLocation("applyDoneTasksToSavedState", {
        status: "done",
        location
    })

    emitSyncStatusLocation("cleanup", {
        status: "start",
        location
    })

    try{
        await Promise.all([
            db.set("lastLocalTree:" + location.uuid, localTreeNowApplied),
            db.set("lastRemoteTree:" + location.uuid, remoteTreeNowApplied),
            db.set("localDataChanged:" + location.uuid, false),
            db.set("remoteDataChanged:" + location.uuid, false)
        ])
    }
    catch(e){
        log.error("Could not save lastLocalTree to DB for location " + location.uuid)
        log.error(e)

        addToSyncIssues("db", "Could not save lastLocalTree to DB for location " + location.uuid + ": " + e.toString())

        emitSyncStatusLocation("cleanup", {
            status: "err",
            location,
            err: e
        })

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    await updateLocationBusyStatus(location.uuid, false)

    emitSyncStatusLocation("cleanup", {
        status: "done",
        location
    })

    return true
}

const restartSyncLoop = async () => {
    emitSyncStatus("releaseSyncLock", {
        status: "start"
    })

    try{
        await releaseSyncLock("sync")
    }
    catch(e){
        log.error("Could not release sync lock from API")
        log.error(e)

        emitSyncStatus("releaseSyncLock", {
            status: "err",
            err: e
        })
    }

    emitSyncStatus("releaseSyncLock", {
        status: "done"
    })

    SYNC_RUNNING = false

    return setTimeout(sync, SYNC_TIMEOUT)
}

const sync = async () => {
    try{
        if(!(await db.get("isLoggedIn"))){
            return setTimeout(sync, SYNC_TIMEOUT)
        }
    }
    catch(e){
        log.error(e)

        addToSyncIssues("getIsLoggedIn", "Could not get logged in status: " + e.toString())

        return setTimeout(sync, SYNC_TIMEOUT)
    }

    emitSyncStatus("init", {
        status: "start"
    })

    try{
        var [userId, masterKeys, syncIssues, paused] = await Promise.all([
            db.get("userId"),
            db.get("masterKeys"),
            db.get("syncIssues"),
            db.get("paused")
        ])

        var syncLocations = await db.get("syncLocations:" + userId)
    }
    catch(e){
        log.error("Could not fetch syncLocations from DB")
        log.error(e)

        addToSyncIssues("getIsLoggedIn", "Could not fetch syncLocations from DB: " + e.toString())

        emitSyncStatus("init", {
            status: "err",
            err: e
        })

        return setTimeout(sync, SYNC_TIMEOUT)
    }

    if(Array.isArray(syncIssues) && syncIssues.length > 0){
        log.info("Will not continue, got open sync issues, need user intervention")

        emitSyncStatus("init", {
            status: "err",
            err: "Will not continue, got open sync issues, need user intervention"
        })

        return setTimeout(sync, SYNC_TIMEOUT)
    }

    if(Number.isNaN(userId)){
        log.info("User id not found, instead found: " + typeof userId)

        emitSyncStatus("init", {
            status: "err",
            err: "User id not found, instead found: " + typeof userId
        })

        addToSyncIssues("getUserId", "User id not found, instead found: " + typeof userId)

        return setTimeout(sync, SYNC_TIMEOUT)
    }

    if(!Array.isArray(masterKeys)){
        log.info("Master keys not found, instead found: " + typeof masterKeys)

        emitSyncStatus("init", {
            status: "err",
            err: "Master keys not found, instead found: " + typeof masterKeys
        })

        addToSyncIssues("getUserId", "User id not found, instead found: " + typeof userId)

        return setTimeout(sync, SYNC_TIMEOUT)
    }

    if(!Array.isArray(syncLocations)){
        log.info("Sync locations not array, instead found: " + typeof syncLocations)

        emitSyncStatus("init", {
            status: "err",
            err: "Sync locations not array, instead found: " + typeof syncLocations
        })

        return setTimeout(sync, SYNC_TIMEOUT)
    }

    if(syncLocations.length == 0){
        emitSyncStatus("init", {
            status: "done",
            syncLocations: []
        })

        log.info("Sync locations empty")

        return setTimeout(sync, SYNC_TIMEOUT)
    }

    emitSyncStatus("init", {
        status: "done",
        syncLocations
    })

    if(paused){
        return setTimeout(sync, SYNC_TIMEOUT)
    }

    if(SYNC_RUNNING){
        return log.info("Sync requested but already running, returning")
    }

    emitSyncStatus("acquireSyncLock", {
        status: "start"
    })

    try{
        await acquireSyncLock("sync")
    }
    catch(e){
        emitSyncStatus("acquireSyncLock", {
            status: "err",
            err: e
        })

        return setTimeout(sync, SYNC_TIMEOUT)
    }

    SYNC_RUNNING = true

    emitSyncStatus("acquireSyncLock", {
        status: "done"
    })

    /*log.info("Checking if we need to redo any previous failed sync tasks")

    emitSyncStatus("syncTasksRedo", {
        status: "start"
    })

    try{
        var syncTasksRedo = await db.get("syncTasksRedo:" + userId)
    }
    catch(e){
        log.error("Could not get syncTasksRedo for userId " + userId)
        log.error(e)

        emitSyncStatus("syncTasksRedo", {
            status: "err",
            err: e
        })

        addToSyncIssues("getSyncTasksRedo", "Could not get syncTasksRedo: " + typeof userId)

        return false
    }

    if(Array.isArray(syncTasksRedo) && syncTasksRedo.length > 0){
        log.info("We need to redo " + syncTasksRedo.length + " sync tasks")

        emitSyncStatus("syncTasksRedo", {
            status: "done",
            syncTasksRedo
        })
    }

    emitSyncStatus("syncTasksRedo", {
        status: "done",
        syncTasksRedo: []
    })*/

    log.info("Starting sync task")
    log.info(syncLocations.length + " syncLocations to sync")

    emitSyncStatus("sync", {
        status: "start",
        syncLocations
    })

    for(let i = 0; i < syncLocations.length; i++){
        if(typeof syncLocations[i].remote == "undefined" || typeof syncLocations[i].remoteUUID == "undefined" || typeof syncLocations[i].remoteName == "undefined"){
            continue
        }

        try{
            await syncLocation(syncLocations[i])
        }
        catch(e){
            log.error("Sync task for location " + syncLocations[i].uuid + " failed, reason:")
            log.error(e)

            addToSyncIssues("sync", "Could not sync " + syncLocations[i].local + " <-> " + syncLocations[i].remote + ": " + e.toString())
            
            emitSyncStatus("sync", {
                status: "err",
                syncLocations,
                err: e
            })
        }
    }

    emitSyncStatus("sync", {
        status: "done",
        syncLocations
    })

    log.info("Cleaning up")

    emitSyncStatus("cleanup", {
        status: "start"
    })

    try{
        await new Promise((resolve, reject) => {
            db.get("userId").then((userId) => {
                db.remove("syncTasksRedo:" + userId).then(resolve).catch(reject)
            }).catch(reject)
        })
    }
    catch(e){
        log.error("Clean up failed")
        log.error(e)

        emitSyncStatus("cleanup", {
            status: "err",
            err: e
        })
    }

    emitSyncStatus("cleanup", {
        status: "done"
    })

    return restartSyncLoop()
}

export default sync