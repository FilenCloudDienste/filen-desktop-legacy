import * as fsLocal from "../../fs/local"
import * as fsRemote from "../../fs/remote"
import db from "../../db"
import { v4 as uuidv4 } from "uuid"
import constants from "../../../../constants.json"
import { Semaphore } from "../../helpers"
import {
    isSyncLocationPaused,
    getIgnored,
    getSyncMode,
    onlyGetBaseParentMove,
    onlyGetBaseParentDelete,
    sortMoveRenameTasks,
    updateLocationBusyStatus,
    emitSyncTask,
    emitSyncStatus,
    emitSyncStatusLocation,
    removeRemoteLocation,
    isPathIncluded,
    isIgnoredBySelectiveSync,
    loadApplyDoneTasks,
    addToApplyDoneTasks,
    clearApplyDoneTasks
} from "./sync.utils"
import { sendToAllPorts } from "../ipc"
import { SemaphoreInterface, Delta, Location, SyncIssue } from "../../../../types"
import { checkInternet } from "../../../windows/worker/worker"
import ipc from "../../ipc"
import eventListener from "../../eventListener"
import { filePresent, folderPresent } from "../../api"

const pathModule = window.require("path")
const log = window.require("electron-log")

let SYNC_RUNNING: boolean = false
const SYNC_TIMEOUT: number = 5000
let NEXT_SYNC: number = new Date().getTime() - SYNC_TIMEOUT
const IS_FIRST_REQUEST: { [key: string]: boolean } = {}
const WATCHERS: { [key: string]: boolean } = {}
const maxConcurrentUploadsSemaphore: SemaphoreInterface = new Semaphore(constants.maxConcurrentUploads)
const maxConcurrentDownloadsSemaphore: SemaphoreInterface = new Semaphore(constants.maxConcurrentDownloads)
const maxSyncTasksSemaphore: SemaphoreInterface = new Semaphore(constants.maxConcurrentSyncTasks)
const syncMutex = new Semaphore(1)

const getDeltas = (type: "local" | "remote", before: any, now: any): Promise<{ folders: Delta, files: Delta }> => {
    return new Promise((resolve, _) => {
        const deltasFiles: Delta = {}
        const deltasFolders: Delta = {}
        
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

                if(!beforeFiles[path]){
                    deltasFiles[path] = {
                        type: "NEW"
                    }
                }
                else if((beforeEntry?.lastModified || 0) == (nowEntry?.lastModified || 0)){
                    deltasFiles[path] = {
                        type: "UNCHANGED"
                    }
                }
                else if((beforeEntry?.lastModified || 1) < (nowEntry?.lastModified || 0)){
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
                const nowPath = nowIno[ino]?.path || ""
                const beforePath = beforeIno[ino]?.path || ""

                if(typeof nowPath == "string" && typeof beforePath == "string"){
                    if(nowPath.length > 0 && beforePath.length > 0){
                        if(nowPath !== beforePath && nowIno[ino].type == beforeIno[ino].type){
                            const nowPathDir = pathModule.dirname(nowPath)
                            const beforePathDir = pathModule.dirname(beforePath)
                            const nowBasename = pathModule.basename(nowPath)
                            const beforeBasename = pathModule.basename(beforePath)
                            const action = (nowPathDir !== beforePathDir) ? "MOVED" : "RENAMED"
    
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

                if(!beforeFiles[path]){
                    deltasFiles[path] = {
                        type: "NEW"
                    }
                }
                else if((beforeEntry?.metadata?.lastModified || 0) == (nowEntry?.metadata?.lastModified || 0)){
                    deltasFiles[path] = {
                        type: "UNCHANGED"
                    }
                }
                else if((beforeEntry?.metadata?.lastModified || 1) < (nowEntry?.metadata?.lastModified || 0)){
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
                const nowPath = nowUUIDs[uuid]?.path || ""
                const beforePath = beforeUUIDs[uuid]?.path || ""

                if(typeof nowPath == "string" && typeof beforePath == "string"){
                    if(nowPath.length > 0 && beforePath.length > 0){
                        if(nowPath !== beforePath && nowUUIDs[uuid].type == beforeUUIDs[uuid].type){
                            const nowPathDir = pathModule.dirname(nowPath)
                            const beforePathDir = pathModule.dirname(beforePath)
                            const nowBasename = pathModule.basename(nowPath)
                            const beforeBasename = pathModule.basename(beforePath)
                            const action = (nowPathDir !== beforePathDir) ? "MOVED" : "RENAMED"
    
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
        }

        return resolve({
            files: deltasFiles,
            folders: deltasFolders
        })
    })
}

// Sorting the tasks so we don't have duplicates or for example delete something that has been renamed or move something that has been renamed etc.
// We also filter for ignored files/folders here + the sync mode

const sortTasks = ({ uploadToRemote, downloadFromRemote, renameInLocal, renameInRemote, moveInLocal, moveInRemote, deleteInLocal, deleteInRemote, location }: { uploadToRemote: any, downloadFromRemote: any, renameInLocal: any, renameInRemote: any, moveInLocal: any, moveInRemote: any, deleteInLocal: any, deleteInRemote: any, location: Location }): Promise<any> => {
    return new Promise(async (resolve, reject) => {
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
            if(filenIgnore.denies(renameInLocal[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, renameInLocal[i].path)){
                ignored.push(renameInLocal[i].path)
                renameInLocal.splice(i, 1)

                i -= 1
            }
        }

        for(let i = 0; i < renameInRemote.length; i++){
            if(filenIgnore.denies(renameInRemote[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, renameInRemote[i].path)){
                ignored.push(renameInRemote[i].path)
                renameInRemote.splice(i, 1)

                i -= 1
            }
        }

        for(let i = 0; i < moveInLocal.length; i++){
            if(filenIgnore.denies(moveInLocal[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, moveInLocal[i].path)){
                ignored.push(moveInLocal[i].path)
                moveInLocal.splice(i, 1)

                i -= 1
            }
        }

        for(let i = 0; i < moveInRemote.length; i++){
            if(filenIgnore.denies(moveInRemote[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, moveInRemote[i].path)){
                ignored.push(moveInRemote[i].path)
                moveInRemote.splice(i, 1)

                i -= 1
            }
        }

        for(let i = 0; i < deleteInLocal.length; i++){
            if(filenIgnore.denies(deleteInLocal[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, deleteInLocal[i].path)){
                ignored.push(deleteInLocal[i].path)
                deleteInLocal.splice(i, 1)

                i -= 1
            }
        }

        for(let i = 0; i < deleteInRemote.length; i++){
            if(filenIgnore.denies(deleteInRemote[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, deleteInRemote[i].path)){
                ignored.push(deleteInRemote[i].path)
                deleteInRemote.splice(i, 1)

                i -= 1
            }
        }

        for(let i = 0; i < uploadToRemote.length; i++){
            if(filenIgnore.denies(uploadToRemote[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, uploadToRemote[i].path)){
                ignored.push(uploadToRemote[i].path)
                uploadToRemote.splice(i, 1)

                i -= 1
            }
        }

        for(let i = 0; i < downloadFromRemote.length; i++){
            if(filenIgnore.denies(downloadFromRemote[i].path) || isIgnoredBySelectiveSync(selectiveSyncRemoteIgnore, downloadFromRemote[i].path)){
                ignored.push(downloadFromRemote[i].path)
                downloadFromRemote.splice(i, 1)
                
                i -= 1
            }
        }
    
        let uploadToRemoteTasks: any[] = []
        let downloadFromRemoteTasks: any[] = []
        let renameInLocalTasks: any[] = []
        let renameInRemoteTasks: any[] = []
        let moveInLocalTasks: any[] = []
        let moveInRemoteTasks: any[] = []
        let deleteInLocalTasks: any[] = []
        let deleteInRemoteTasks: any[] = []
    
        const renameInRemoteTasksSorted = sortMoveRenameTasks(renameInRemote)
        const renamedInRemote: any[] = []
        const moveInRemoteTasksSorted = sortMoveRenameTasks(moveInRemote)
        const movedInRemote: any[] = []

        const renameInLocalTasksSorted = sortMoveRenameTasks(renameInLocal)
        const renamedInLocal: any[] = []
        const moveInLocalTasksSorted = sortMoveRenameTasks(moveInLocal)
        const movedInLocal: any[] = []

        for(let i = 0; i < renameInRemoteTasksSorted.length; i++){
            if(
                typeof renameInRemoteTasksSorted[i] == "undefined"
                || renameInRemoteTasksSorted[i] == null
            ){
                continue
            }

            if(
                typeof renameInRemoteTasksSorted[i].from !== "string"
                || typeof renameInRemoteTasksSorted[i].to !== "string"
                || typeof renameInRemoteTasksSorted[i].path !== "string"
            ){
                continue
            }
            
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
                typeof renameInLocalTasksSorted[i] == "undefined"
                || renameInLocalTasksSorted[i] == null
            ){
                continue
            }

            if(
                typeof renameInLocalTasksSorted[i].from !== "string"
                || typeof renameInLocalTasksSorted[i].to !== "string"
                || typeof renameInLocalTasksSorted[i].path !== "string"
            ){
                continue
            }

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
                typeof moveInRemoteTasksSorted[i] == "undefined"
                || moveInRemoteTasksSorted[i] == null
            ){
                continue
            }

            if(
                typeof moveInRemoteTasksSorted[i].from !== "string"
                || typeof moveInRemoteTasksSorted[i].to !== "string"
                || typeof moveInRemoteTasksSorted[i].path !== "string"
            ){
                continue
            }

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
                typeof moveInLocalTasksSorted[i] == "undefined"
                || moveInLocalTasksSorted[i] == null
            ){
                continue
            }

            if(
                typeof moveInLocalTasksSorted[i].from !== "string"
                || typeof moveInLocalTasksSorted[i].to !== "string"
                || typeof moveInLocalTasksSorted[i].path !== "string"
            ){
                continue
            }

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
                typeof deleteInRemote[i] == "undefined"
                || deleteInRemote[i] == null
            ){
                continue
            }

            if(
                typeof deleteInRemote[i].path !== "string"
            ){
                continue
            }

            if(
                !isPathIncluded(renamedInLocal, deleteInRemote[i].path) &&
                !isPathIncluded(movedInLocal, deleteInRemote[i].path)
            ){
                deleteInRemoteTasks.push(deleteInRemote[i])
            }
        }

        for(let i = 0; i < deleteInLocal.length; i++){
            if(
                typeof deleteInLocal[i] == "undefined"
                || deleteInLocal[i] == null
            ){
                continue
            }

            if(
                typeof deleteInLocal[i].path !== "string"
            ){
                continue
            }

            if(
                !isPathIncluded(renamedInRemote, deleteInLocal[i].path) &&
                !isPathIncluded(movedInRemote, deleteInLocal[i].path)
            ){
                deleteInLocalTasks.push(deleteInLocal[i])
            }
        }
    
        for(let i = 0; i < uploadToRemote.length; i++){
            if(
                typeof uploadToRemote[i] == "undefined"
                || uploadToRemote[i] == null
            ){
                continue
            }

            if(
                typeof uploadToRemote[i].path !== "string"
            ){
                continue
            }

            if(
                !isPathIncluded(renamedInLocal, uploadToRemote[i].path) &&
                !isPathIncluded(movedInLocal, uploadToRemote[i].path)
            ){
                uploadToRemoteTasks.push(uploadToRemote[i])
            }
        }
    
        for(let i = 0; i < downloadFromRemote.length; i++){
            if(
                typeof downloadFromRemote[i] == "undefined"
                || downloadFromRemote[i] == null
            ){
                continue
            }

            if(
                typeof downloadFromRemote[i].path !== "string"
            ){
                continue
            }

            if(
                !isPathIncluded(renamedInRemote, downloadFromRemote[i].path) &&
                !isPathIncluded(movedInRemote, downloadFromRemote[i].path)
            ){
                downloadFromRemoteTasks.push(downloadFromRemote[i])
            }
        }

        moveInRemoteTasks = onlyGetBaseParentMove(moveInRemoteTasks)
        moveInLocalTasks = onlyGetBaseParentMove(moveInLocalTasks)
        deleteInRemoteTasks = onlyGetBaseParentDelete(deleteInRemoteTasks)
        deleteInLocalTasks = onlyGetBaseParentDelete(deleteInLocalTasks)
    
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

const consumeTasks = ({ uploadToRemote, downloadFromRemote, renameInLocal, renameInRemote, moveInLocal, moveInRemote, deleteInLocal, deleteInRemote, lastLocalTree, lastRemoteTree, localTreeNow, remoteTreeNow, location }: { uploadToRemote: any, downloadFromRemote: any, renameInLocal: any, renameInRemote: any, moveInLocal: any, moveInRemote: any, deleteInLocal: any, deleteInRemote: any, lastLocalTree: any, lastRemoteTree: any, localTreeNow: any, remoteTreeNow: any, location: Location }): Promise<any> => {
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

        log.info("renameInRemote", renameInRemoteTasks.length)
        log.info("renameInLocal", renameInLocalTasks.length)
        log.info("moveInRemote", moveInRemoteTasks.length)
        log.info("moveInLocal", moveInLocalTasks.length)
        log.info("deleteInRemote", deleteInRemoteTasks.length)
        log.info("deleteInLocal", deleteInLocalTasks.length)
        log.info("uploadToRemote", uploadToRemoteTasks.length)
        log.info("downloadFromRemote", downloadFromRemoteTasks.length)

        const doneTasks: any[] = []
        let syncTasksToDo: number = (renameInRemoteTasks.length + renameInLocalTasks.length + moveInRemoteTasks.length +  moveInLocalTasks.length + deleteInRemoteTasks.length + deleteInLocalTasks.length + uploadToRemoteTasks.length + downloadFromRemoteTasks.length)

        sendToAllPorts({
            type: "syncTasksToDo",
            data: syncTasksToDo
        })

        const updateSyncTasksToDo = () => {
            syncTasksToDo -= 1

            sendToAllPorts({
                type: "syncTasksToDo",
                data: syncTasksToDo
            })
        }

        if(renameInRemoteTasks.length > 0){
            await Promise.allSettled([
                ...renameInRemoteTasks.map((task: any) => new Promise((resolve, reject) => {
                    if(typeof task !== "object"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.item !== "object"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.item.uuid !== "string"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("renameInRemote", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr?: any) => {
                            if(currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined"){
                                maxSyncTasksSemaphore.release()

                                log.error("renameInRemote task failed: " + JSON.stringify(task))
                                log.error(lastErr)

                                ipc.addSyncIssue({
                                    uuid: uuidv4(),
                                    type: "conflict",
                                    where: "remote",
                                    path: pathModule.normalize(location.local + "/" + task.path),
                                    err: lastErr,
                                    info: "Could not rename " + pathModule.normalize(location.local + "/" + task.path) + " remotely",
                                    timestamp: new Date().getTime()
                                }).catch(console.error)
    
                                emitSyncTask("renameInRemote", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })

                                updateSyncTasksToDo()
    
                                return resolve(true)
                            }
    
                            currentTries += 1

                            fsRemote.rename(task.type, task).then((done) => {
                                emitSyncTask("renameInRemote", {
                                    status: "done",
                                    task,
                                    location
                                })

                                const doneTask = {
                                    type: "renameInRemote",
                                    task,
                                    location
                                }
        
                                doneTasks.push(doneTask)

                                updateSyncTasksToDo()

                                addToApplyDoneTasks(location.uuid, doneTask).then(() => {
                                    maxSyncTasksSemaphore.release()
        
                                    return resolve(done)
                                }).catch((err) => {
                                    log.error(err)

                                    maxSyncTasksSemaphore.release()
        
                                    return resolve(done)
                                })
                            }).catch((err) => {
                                log.error(err)
    
                                return setTimeout(() => {
                                    doTask(err)
                                }, constants.retrySyncTaskTimeout)
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])

            for(let i = 0; i < renameInRemoteTasks.length; i++){
                maxSyncTasksSemaphore.release()
            }
        }

        if(renameInLocalTasks.length > 0){
            await Promise.allSettled([
                ...renameInLocalTasks.map((task: any) => new Promise((resolve, reject) => {
                    if(typeof task !== "object"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.from !== "string"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.to !== "string"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("renameInLocal", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr?: any) => {
                            if(currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined"){
                                maxSyncTasksSemaphore.release()

                                log.error("renameInLocal task failed: " + JSON.stringify(task))
                                log.error(lastErr)

                                ipc.addSyncIssue({
                                    uuid: uuidv4(),
                                    type: "conflict",
                                    where: "local",
                                    path: pathModule.normalize(location.local + "/" + task.path),
                                    err: lastErr,
                                    info: "Could not rename " + pathModule.normalize(location.local + "/" + task.path) + " locally",
                                    timestamp: new Date().getTime()
                                }).catch(console.error)
    
                                emitSyncTask("renameInLocal", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })

                                updateSyncTasksToDo()
    
                                return resolve(true)
                            }
    
                            currentTries += 1
    
                            fsLocal.rename(pathModule.normalize(location.local + "/" + task.from), pathModule.normalize(location.local + "/" + task.to)).then((done) => {
                                emitSyncTask("renameInLocal", {
                                    status: "done",
                                    task,
                                    location
                                })
        
                                const doneTask = {
                                    type: "renameInLocal",
                                    task,
                                    location
                                }

                                doneTasks.push(doneTask)

                                updateSyncTasksToDo()

                                addToApplyDoneTasks(location.uuid, doneTask).then(() => {
                                    maxSyncTasksSemaphore.release()
        
                                    return resolve(done)
                                }).catch((err) => {
                                    log.error(err)

                                    maxSyncTasksSemaphore.release()
        
                                    return resolve(done)
                                })
                            }).catch(async (err) => {
                                if(!(await fsRemote.doesExistLocally(pathModule.normalize(pathModule.join(location.local, task.path))))){
                                    emitSyncTask("renameInLocal", {
                                        status: "err",
                                        task,
                                        location,
                                        err
                                    })

                                    maxSyncTasksSemaphore.release()

                                    updateSyncTasksToDo()

                                    return resolve(true)
                                }

                                if(
                                    err == "eperm"
                                    || (typeof err.code == "string" && err.code == "EPERM")
                                    || err == "deletedLocally"
                                ){
                                    emitSyncTask("renameInLocal", {
                                        status: "err",
                                        task,
                                        location,
                                        err: err
                                    })

                                    maxSyncTasksSemaphore.release()

                                    updateSyncTasksToDo()

                                    return resolve(true)
                                }

                                log.error(err)

                                if(typeof err.code !== "undefined"){
                                    if(err.code == "ENOENT"){
                                        updateSyncTasksToDo()

                                        return resolve(true)
                                    }
                                }

                                if(err.toString().indexOf("ENOENT:") !== -1){
                                    updateSyncTasksToDo()

                                    return resolve(true)
                                }
    
                                return setTimeout(() => {
                                    doTask(err)
                                }, constants.retrySyncTaskTimeout)
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])

            for(let i = 0; i < renameInLocal.length; i++){
                maxSyncTasksSemaphore.release()
            }
        }

        if(moveInRemoteTasks.length > 0){
            await Promise.allSettled([
                ...moveInRemoteTasks.map((task: any) => new Promise((resolve, reject) => {
                    if(typeof task !== "object"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.item !== "object"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.item.uuid !== "string"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("moveInRemote", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr?: any) => {
                            if(currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined"){
                                maxSyncTasksSemaphore.release()

                                log.error("moveInRemote task failed: " + JSON.stringify(task))
                                log.error(lastErr)

                                ipc.addSyncIssue({
                                    uuid: uuidv4(),
                                    type: "conflict",
                                    where: "remote",
                                    path: pathModule.normalize(location.local + "/" + task.path),
                                    err: lastErr,
                                    info: "Could not move " + pathModule.normalize(location.local + "/" + task.path) + " remotely",
                                    timestamp: new Date().getTime()
                                }).catch(console.error)
    
                                emitSyncTask("moveInRemote", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })
                                
                                updateSyncTasksToDo()
    
                                return resolve(true)
                            }
    
                            currentTries += 1
    
                            fsRemote.move(task.type, task, location, remoteTreeNow).then((done) => {
                                emitSyncTask("moveInRemote", {
                                    status: "done",
                                    task,
                                    location
                                })

                                const doneTask = {
                                    type: "moveInRemote",
                                    task,
                                    location
                                }
        
                                doneTasks.push(doneTask)
                                
                                updateSyncTasksToDo()

                                addToApplyDoneTasks(location.uuid, doneTask).then(() => {
                                    maxSyncTasksSemaphore.release()
        
                                    return resolve(done)
                                }).catch((err) => {
                                    log.error(err)

                                    maxSyncTasksSemaphore.release()
        
                                    return resolve(done)
                                })
                            }).catch((err) => {
                                log.error(err)
    
                                return setTimeout(() => {
                                    doTask(err)
                                }, constants.retrySyncTaskTimeout)
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])

            for(let i = 0; i < moveInRemoteTasks.length; i++){
                maxSyncTasksSemaphore.release()
            }
        }

        if(moveInLocalTasks.length > 0){
            await Promise.allSettled([
                ...moveInLocalTasks.map((task: any) => new Promise((resolve, reject) => {
                    if(typeof task !== "object"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.from !== "string"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.to !== "string"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("moveInLocal", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr?: any) => {
                            if(currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined"){
                                maxSyncTasksSemaphore.release()

                                log.error("moveInLocal task failed: " + JSON.stringify(task))
                                log.error(lastErr)

                                ipc.addSyncIssue({
                                    uuid: uuidv4(),
                                    type: "conflict",
                                    where: "local",
                                    path: pathModule.normalize(location.local + "/" + task.path),
                                    err: lastErr,
                                    info: "Could not move " + pathModule.normalize(location.local + "/" + task.path) + " locally",
                                    timestamp: new Date().getTime()
                                }).catch(console.error)
    
                                emitSyncTask("moveInLocal", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })

                                updateSyncTasksToDo()
    
                                return resolve(true)
                            }
    
                            currentTries += 1
    
                            fsLocal.move(pathModule.normalize(location.local + "/" + task.from), pathModule.normalize(location.local + "/" + task.to)).then((done) => {
                                emitSyncTask("moveInLocal", {
                                    status: "done",
                                    task,
                                    location
                                })

                                const doneTask = {
                                    type: "moveInLocal",
                                    task,
                                    location
                                }
        
                                doneTasks.push(doneTask)

                                updateSyncTasksToDo()

                                addToApplyDoneTasks(location.uuid, doneTask).then(() => {
                                    maxSyncTasksSemaphore.release()
        
                                    return resolve(done)
                                }).catch((err) => {
                                    log.error(err)

                                    maxSyncTasksSemaphore.release()
        
                                    return resolve(done)
                                })
                            }).catch(async (err) => {
                                if(!(await fsRemote.doesExistLocally(pathModule.normalize(pathModule.join(location.local, task.path))))){
                                    emitSyncTask("moveInLocal", {
                                        status: "err",
                                        task,
                                        location,
                                        err
                                    })

                                    maxSyncTasksSemaphore.release()

                                    updateSyncTasksToDo()

                                    return resolve(true)
                                }

                                if(
                                    err == "eperm"
                                    || (typeof err.code == "string" && err.code == "EPERM")
                                    || err == "deletedLocally"
                                ){
                                    emitSyncTask("moveInLocal", {
                                        status: "err",
                                        task,
                                        location,
                                        err: err
                                    })

                                    maxSyncTasksSemaphore.release()

                                    updateSyncTasksToDo()

                                    return resolve(true)
                                }

                                log.error(err)

                                if(typeof err.code !== "undefined"){
                                    if(err.code == "ENOENT"){
                                        updateSyncTasksToDo()

                                        return resolve(true)
                                    }
                                }

                                if(err.toString().indexOf("ENOENT:") !== -1){
                                    updateSyncTasksToDo()

                                    return resolve(true)
                                }
    
                                return setTimeout(() => {
                                    doTask(err)
                                }, constants.retrySyncTaskTimeout)
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])

            for(let i = 0; i < moveInLocalTasks.length; i++){
                maxSyncTasksSemaphore.release()
            }
        }

        if(deleteInRemoteTasks.length > 0){
            await Promise.allSettled([
                ...deleteInRemoteTasks.map((task: any) => new Promise((resolve, reject) => {
                    if(typeof task !== "object"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.item !== "object"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.item.uuid !== "string"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("deleteInRemote", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr?: any) => {
                            if(currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined"){
                                maxSyncTasksSemaphore.release()

                                log.error("deleteInRemote task failed: " + JSON.stringify(task))
                                log.error(lastErr)

                                ipc.addSyncIssue({
                                    uuid: uuidv4(),
                                    type: "conflict",
                                    where: "remote",
                                    path: pathModule.normalize(location.local + "/" + task.path),
                                    err: lastErr,
                                    info: "Could not delete " + pathModule.normalize(location.local + "/" + task.path) + " remotely",
                                    timestamp: new Date().getTime()
                                }).catch(console.error)
    
                                emitSyncTask("deleteInRemote", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })

                                updateSyncTasksToDo()
    
                                return resolve(true)
                            }
    
                            currentTries += 1
    
                            fsRemote.rm(task.type, task.item.uuid).then((done) => {
                                emitSyncTask("deleteInRemote", {
                                    status: "done",
                                    task,
                                    location
                                })

                                const doneTask = {
                                    type: "deleteInRemote",
                                    task,
                                    location
                                }
        
                                doneTasks.push(doneTask)

                                updateSyncTasksToDo()

                                addToApplyDoneTasks(location.uuid, doneTask).then(() => {
                                    maxSyncTasksSemaphore.release()
        
                                    return resolve(done)
                                }).catch((err) => {
                                    log.error(err)

                                    maxSyncTasksSemaphore.release()
        
                                    return resolve(done)
                                })
                            }).catch((err) => {
                                log.error(err)
    
                                return setTimeout(() => {
                                    doTask(err)
                                }, constants.retrySyncTaskTimeout)
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])

            for(let i = 0; i < deleteInRemoteTasks.length; i++){
                maxSyncTasksSemaphore.release()
            }
        }

        if(deleteInLocalTasks.length > 0){
            await Promise.allSettled([
                ...deleteInLocalTasks.map((task: any) => new Promise((resolve, reject) => {
                    if(typeof task !== "object"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.path !== "string"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("deleteInLocal", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr?: any) => {
                            if(currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined"){
                                maxSyncTasksSemaphore.release()

                                log.error("deleteInLocal task failed: " + JSON.stringify(task))
                                log.error(lastErr)
    
                                ipc.addSyncIssue({
                                    uuid: uuidv4(),
                                    type: "conflict",
                                    where: "local",
                                    path: pathModule.normalize(location.local + "/" + task.path),
                                    err: lastErr,
                                    info: "Could not delete " + pathModule.normalize(location.local + "/" + task.path) + " locally",
                                    timestamp: new Date().getTime()
                                }).catch(console.error)
            
                                emitSyncTask("deleteInLocal", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })

                                updateSyncTasksToDo()
    
                                return resolve(true)
                            }
    
                            currentTries += 1
    
                            fsLocal.rm(pathModule.normalize(location.local + "/" + task.path), location).then((done) => {
                                emitSyncTask("deleteInLocal", {
                                    status: "done",
                                    task,
                                    location
                                })

                                const doneTask = {
                                    type: "deleteInLocal",
                                    task,
                                    location
                                }
        
                                doneTasks.push(doneTask)

                                updateSyncTasksToDo()

                                addToApplyDoneTasks(location.uuid, doneTask).then(() => {
                                    maxSyncTasksSemaphore.release()
        
                                    return resolve(done)
                                }).catch((err) => {
                                    log.error(err)

                                    maxSyncTasksSemaphore.release()
        
                                    return resolve(done)
                                })
                            }).catch(async (err) => {
                                if(!(await fsRemote.doesExistLocally(pathModule.normalize(pathModule.join(location.local, task.path))))){
                                    emitSyncTask("deleteInLocal", {
                                        status: "err",
                                        task,
                                        location,
                                        err
                                    })

                                    maxSyncTasksSemaphore.release()

                                    updateSyncTasksToDo()

                                    return resolve(true)
                                }

                                if(
                                    err == "eperm"
                                    || err == "deletedLocally"
                                    || (typeof err.code == "string" && err.code == "EPERM")
                                ){
                                    emitSyncTask("deleteInLocal", {
                                        status: "err",
                                        task,
                                        location,
                                        err: err
                                    })

                                    maxSyncTasksSemaphore.release()

                                    updateSyncTasksToDo()

                                    return resolve(true)
                                }

                                log.error(err)
    
                                return setTimeout(() => {
                                    doTask(err)
                                }, constants.retrySyncTaskTimeout)
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])

            for(let i = 0; i < deleteInLocalTasks.length; i++){
                maxSyncTasksSemaphore.release()
            }
        }

        if(uploadToRemoteTasks.length > 0){
            await Promise.allSettled([
                ...uploadToRemoteTasks.map((task: any) => new Promise((resolve, reject) => {
                    if(typeof task !== "object"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.item !== "object"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.item.uuid !== "string"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("uploadToRemote", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr?: any) => {
                            if(currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined"){
                                maxSyncTasksSemaphore.release()

                                log.error("uploadToRemote task failed: " + JSON.stringify(task))
                                log.error(lastErr)

                                ipc.addSyncIssue({
                                    uuid: uuidv4(),
                                    type: "conflict",
                                    where: "remote",
                                    path: pathModule.normalize(location.local + "/" + task.path),
                                    err: lastErr,
                                    info: "Could not upload " + pathModule.normalize(location.local + "/" + task.path),
                                    timestamp: new Date().getTime()
                                }).catch(console.error)
    
                                emitSyncTask("uploadToRemote", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })

                                updateSyncTasksToDo()
    
                                return resolve(true)
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
                                    emitSyncTask("uploadToRemote", {
                                        status: "done",
                                        task,
                                        location
                                    })

                                    const doneTask = {
                                        type: "uploadToRemote",
                                        task: {
                                            ...task,
                                            info: {
                                                ...result
                                            }
                                        },
                                        location
                                    }
    
                                    doneTasks.push(doneTask)

                                    updateSyncTasksToDo()
    
                                    addToApplyDoneTasks(location.uuid, doneTask).then(() => {
                                        maxConcurrentUploadsSemaphore.release()
                                        maxSyncTasksSemaphore.release()
            
                                        return resolve(result)
                                    }).catch((err) => {
                                        log.error(err)
    
                                        maxConcurrentUploadsSemaphore.release()
                                        maxSyncTasksSemaphore.release()
            
                                        return resolve(result)
                                    })
                                }).catch(async (err) => {
                                    if(!(await fsRemote.doesExistLocally(pathModule.normalize(pathModule.join(location.local, task.path))))){
                                        emitSyncTask("uploadToRemote", {
                                            status: "err",
                                            task,
                                            location,
                                            err
                                        })

                                        maxConcurrentUploadsSemaphore.release()
                                        maxSyncTasksSemaphore.release()

                                        updateSyncTasksToDo()

                                        return resolve(true)
                                    }

                                    if(
                                        err.toString().toLowerCase().indexOf("invalid upload key") !== -1
                                        || err.toString().toLowerCase().indexOf("chunks are not matching") !== -1
                                        || err == "deletedLocally"
                                        || err == "eperm"
                                        || (typeof err.code == "string" && err.code == "EPERM")
                                    ){
                                        emitSyncTask("uploadToRemote", {
                                            status: "err",
                                            task,
                                            location,
                                            err
                                        })

                                        maxConcurrentUploadsSemaphore.release()
                                        maxSyncTasksSemaphore.release()

                                        updateSyncTasksToDo()

                                        return resolve(true)
                                    }
                                    
                                    log.error(err)

                                    maxConcurrentUploadsSemaphore.release()
                                    maxSyncTasksSemaphore.release()
    
                                    return setTimeout(() => {
                                        doTask(err)
                                    }, constants.retrySyncTaskTimeout)
                                })
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])

            for(let i = 0; i < uploadToRemoteTasks.length; i++){
                maxSyncTasksSemaphore.release()
                maxConcurrentUploadsSemaphore.release()
            }
        }

        if(downloadFromRemoteTasks.length > 0){
            await Promise.allSettled([
                ...downloadFromRemoteTasks.map((task: any) => new Promise((resolve, reject) => {
                    if(typeof task !== "object"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    if(typeof task.path !== "string"){
                        updateSyncTasksToDo()

                        return resolve(true)
                    }

                    maxSyncTasksSemaphore.acquire().then(() => {
                        emitSyncTask("downloadFromRemote", {
                            status: "start",
                            task,
                            location
                        })
    
                        let currentTries = 0
    
                        const doTask = (lastErr?: any) => {
                            if(currentTries >= constants.maxRetrySyncTask && typeof lastErr !== "undefined"){
                                maxSyncTasksSemaphore.release()
                                
                                log.error("downloadFromRemote task failed: " + JSON.stringify(task))
                                log.error(lastErr)

                                ipc.addSyncIssue({
                                    uuid: uuidv4(),
                                    type: "conflict",
                                    where: "local",
                                    path: pathModule.normalize(location.local + "/" + task.path),
                                    err: lastErr,
                                    info: "Could not download " + pathModule.normalize(location.local + "/" + task.path),
                                    timestamp: new Date().getTime()
                                }).catch(console.error)
    
                                emitSyncTask("downloadFromRemote", {
                                    status: "err",
                                    task,
                                    location,
                                    err: lastErr
                                })

                                updateSyncTasksToDo()
    
                                return resolve(true)
                            }
    
                            currentTries += 1
    
                            maxConcurrentDownloadsSemaphore.acquire().then(() => {
                                emitSyncTask("downloadFromRemote", {
                                    status: "started",
                                    task,
                                    location
                                })

                                const isPresent = new Promise<boolean>((resolve, reject) => {
                                    db.get("apiKey").then((apiKey) => {
                                        if(task.type == "folder"){
                                            folderPresent({
                                                apiKey,
                                                uuid: task.item.uuid
                                            }).then((present) => {
                                                if(!present.present || present.trash){
                                                    return resolve(false)
                                                }

                                                return resolve(true)
                                            }).catch(reject)
                                        }
                                        else{
                                            filePresent(task.item.uuid).then((present) => {
                                                if(!present.present || present.versioned || present.trash){
                                                    return resolve(false)
                                                }
    
                                                return resolve(true)
                                            }).catch(reject)
                                        }
                                    }).catch(reject)
                                })
    
                                isPresent.then((present) => {
                                    if(!present){
                                        maxConcurrentDownloadsSemaphore.release()
                                        maxSyncTasksSemaphore.release()

                                        updateSyncTasksToDo()
            
                                        return resolve(true)
                                        
                                    }
                                    
                                    const promise = task.type == "folder" ? fsLocal.mkdir(task.path, location) : fsLocal.download(task.path, location, task)
    
                                    promise.then((result) => {
                                        emitSyncTask("downloadFromRemote", {
                                            status: "done",
                                            task,
                                            location
                                        })

                                        const doneTask = {
                                            type: "downloadFromRemote",
                                            task: {
                                                ...task,
                                                info: {
                                                    ...result
                                                }
                                            },
                                            location
                                        }
        
                                        doneTasks.push(doneTask)

                                        updateSyncTasksToDo()
        
                                        addToApplyDoneTasks(location.uuid, doneTask).then(() => {
                                            maxConcurrentDownloadsSemaphore.release()
                                            maxSyncTasksSemaphore.release()
                
                                            return resolve(result)
                                        }).catch((err) => {
                                            log.error(err)
        
                                            maxConcurrentDownloadsSemaphore.release()
                                            maxSyncTasksSemaphore.release()
                
                                            return resolve(result)
                                        })
                                    }).catch((err) => {
                                        maxConcurrentDownloadsSemaphore.release()
        
                                        log.error(err)
        
                                        return setTimeout(() => {
                                            doTask(err)
                                        }, constants.retrySyncTaskTimeout)
                                    })
                                }).catch((err) => {
                                    maxConcurrentDownloadsSemaphore.release()
            
                                    log.error(err)
    
                                    return setTimeout(() => {
                                        doTask(err)
                                    }, constants.retrySyncTaskTimeout)
                                })
                            })
                        }
    
                        return doTask()
                    })
                }))
            ])

            for(let i = 0; i < downloadFromRemoteTasks.length; i++){
                maxSyncTasksSemaphore.release()
                maxConcurrentDownloadsSemaphore.release()
            }
        }

        maxSyncTasksSemaphore.purge()
        maxConcurrentDownloadsSemaphore.purge()
        maxConcurrentUploadsSemaphore.purge()

        sendToAllPorts({
            type: "syncTasksToDo",
            data: 0
        })

        return resolve({ doneTasks })
    })
}

const consumeDeltas = ({ localDeltas, remoteDeltas, lastLocalTree, lastRemoteTree, localTreeNow, remoteTreeNow, location }: { localDeltas: any, remoteDeltas: any, lastLocalTree: any, lastRemoteTree: any, localTreeNow: any, remoteTreeNow: any, location: Location }): Promise<any> => {
    return new Promise(async (resolve, reject) => {
        try{
            var syncMode = await getSyncMode(location)
        }
        catch(e){
            return reject(e)
        }

        const localFileDeltas = localDeltas.files
        const localFolderDeltas = localDeltas.folders
        const remoteFileDeltas = remoteDeltas.files
        const remoteFolderDeltas = remoteDeltas.folders

        const uploadToRemote: any[] = []
        const downloadFromRemote: any[] = []
        const renameInLocal: any[] = []
        const renameInRemote: any[] = []
        const moveInLocal: any[] = []
        const moveInRemote: any[] = []
        const deleteInLocal: any[] = []
        const deleteInRemote: any[] = []

        const addedToList: { [key: string]: boolean } = {}

        for(const path in localFolderDeltas){
            const localDelta = localFolderDeltas[path]?.type
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
            const sameLastModified = localLastModified === remoteTreeNow[path]?.metadata?.lastModified

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

            if(syncMode == "localBackup" || syncMode == "localToCloud"){
                if((localDelta == "NEW" || localDelta == "NEWER") && (remoteDelta == "UNCHANGED" || remoteDelta == "OLD" || remoteDelta == "OLDER") && !addedToList[path]){
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

const applyDoneTasksToSavedState = ({ doneTasks, localTreeNow, remoteTreeNow }: { doneTasks: any, localTreeNow: any, remoteTreeNow: any }): Promise<any> => {
    return new Promise((resolve, _) => {
        for(let i = 0; i < doneTasks.length; i++){
            const { type, task } = doneTasks[i]

            if(typeof task == "undefined" || task == null){
                continue
            }

            if(type == "renameInRemote"){
                if(typeof task.from !== "string" || typeof task.to !== "string"){
                    continue
                }

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
                if(typeof task.from !== "string" || typeof task.to !== "string"){
                    continue
                }

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
                if(typeof task.from !== "string" || typeof task.to !== "string"){
                    continue
                }

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
                if(typeof task.from !== "string" || typeof task.to !== "string"){
                    continue
                }
                
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

const syncLocation = async (location: Location): Promise<boolean> => {
    if(location.paused){
        log.info("Sync location " + location.uuid + " -> " + location.local + " <-> " + location.remote + " [" + location.type + "] is paused")

        await updateLocationBusyStatus(location.uuid, false)

        return true
    }

    if((await isSyncLocationPaused(location.uuid))){
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
        await fsLocal.smokeTest(pathModule.normalize(location.local))
    }
    catch(e: any){
        log.error("Smoke test for location " + location.uuid + " failed")
        log.error(e)

        ipc.addSyncIssue({
            uuid: uuidv4(),
            type: "critical",
            where: "local",
            path: pathModule.normalize(location.local),
            err: e,
            info: "Smoke test for location " + location.uuid + " failed",
            timestamp: new Date().getTime()
        }).catch(console.error)

        emitSyncStatusLocation("smokeTest", {
            status: "err",
            location,
            err: e
        })

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    try{
        await fsRemote.smokeTest(location.remoteUUID)
    }
    catch(e: any){
        log.error(e)

        if(e.toString().toLowerCase().indexOf("remote folder") !== -1 && e.toString().toLowerCase().indexOf("is not present") !== -1){
            await removeRemoteLocation(location)
        }

        updateLocationBusyStatus(location.uuid, false)

        ipc.addSyncIssue({
            uuid: uuidv4(),
            type: "critical",
            where: "remote",
            path: pathModule.normalize(location.local),
            err: e,
            info: "Could get remote tree for location " + location.uuid,
            timestamp: new Date().getTime()
        }).catch(console.error)

        return false
    }

    emitSyncStatusLocation("smokeTest", {
        status: "done",
        location
    })

    if(
        typeof WATCHERS[location.local] == "undefined"
        && (location.type == "localBackup" || location.type == "localToCloud" || location.type == "twoWay")
    ){
        log.info("Starting local directory watcher for location " + location.uuid)

        emitSyncStatusLocation("initWatcher", {
            status: "start",
            location
        })

        try{
            await ipc.initWatcher(pathModule.normalize(location.local), location.uuid)
        }
        catch(e: any){
            log.error("Could not start local directory watcher for location " + location.uuid)
            log.error(e)

            ipc.addSyncIssue({
                uuid: uuidv4(),
                type: "warning",
                where: "local",
                path: pathModule.normalize(location.local),
                err: e,
                info: "Could not start local directory watcher at path " + pathModule.normalize(location.local),
                timestamp: new Date().getTime()
            }).catch(console.error)

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

    if((await isSyncLocationPaused(location.uuid))){
        await updateLocationBusyStatus(location.uuid, false)

        return true
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

        if(typeof IS_FIRST_REQUEST[location.uuid] !== "undefined"){
            await Promise.all([
                db.set("localDataChanged:" + location.uuid, false),
                db.set("remoteDataChanged:" + location.uuid, false)
            ])
        }
    }
    catch(e: any){
        if(e.toString().toLowerCase().indexOf("folder not found") !== -1){
            await removeRemoteLocation(location)
        }
        else{
            log.error("Could not get directory trees for location " + location.uuid)
            log.error(e)

            if(window.navigator.onLine){
                ipc.addSyncIssue({
                    uuid: uuidv4(),
                    type: "critical",
                    where: "local",
                    path: pathModule.normalize(location.local),
                    err: e,
                    info: "Could not get directory trees for location " + location.uuid,
                    timestamp: new Date().getTime()
                }).catch(console.error)
            }

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

    try{
        var [lastLocalTree, lastRemoteTree, applyDoneTasksPast] = await Promise.all([
            db.get("lastLocalTree:" + location.uuid),
            db.get("lastRemoteTree:" + location.uuid),
            loadApplyDoneTasks(location.uuid)
        ])

        if(applyDoneTasksPast && Array.isArray(applyDoneTasksPast)){
            if(applyDoneTasksPast.length > 0){
                log.info("Applying " + applyDoneTasksPast.length + " done tasks (past) to saved state for location " + location.uuid)

                const { localTreeNowApplied, remoteTreeNowApplied } = await applyDoneTasksToSavedState({ doneTasks: applyDoneTasksPast, localTreeNow: lastLocalTree, remoteTreeNow: lastRemoteTree })

                lastLocalTree = localTreeNowApplied
                lastRemoteTree = remoteTreeNowApplied
            }
        }
    }
    catch(e: any){
        log.error("Could not get last local/remote tree for location " + location.uuid)
        log.error(e)

        if(window.navigator.onLine){
            ipc.addSyncIssue({
                uuid: uuidv4(),
                type: "critical",
                where: "local",
                path: pathModule.normalize(location.local),
                err: e,
                info: "Could not get last local/remote directory tree for location " + location.uuid,
                timestamp: new Date().getTime()
            }).catch(console.error)
        }

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

            delete IS_FIRST_REQUEST[location.uuid]
        }
        catch(e: any){
            log.error("Could not save lastLocalTree/lastRemoteTree to DB for location " + location.uuid)
            log.error(e)
        }

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    if((await isSyncLocationPaused(location.uuid))){
        await updateLocationBusyStatus(location.uuid, false)

        return true
    }

    log.info("Getting deltas for location " + location.uuid)

    emitSyncStatusLocation("getDeltas", {
        status: "start",
        location
    })

    try{
        var [localDeltas, remoteDeltas] = await Promise.all([
            getDeltas("local", lastLocalTree, localTreeNow),
            getDeltas("remote", lastRemoteTree, remoteTreeNow)
        ])
    }
    catch(e: any){
        log.error("Could not get deltas for location " + location.uuid)
        log.error(e)

        ipc.addSyncIssue({
            uuid: uuidv4(),
            type: "critical",
            where: "local",
            path: pathModule.normalize(location.local),
            err: e,
            info: "Could not get deltas for location " + location.uuid,
            timestamp: new Date().getTime()
        }).catch(console.error)

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

    if((await isSyncLocationPaused(location.uuid))){
        await updateLocationBusyStatus(location.uuid, false)

        return true
    }

    log.info("Consuming deltas for location " + location.uuid)

    emitSyncStatusLocation("consumeDeltas", {
        status: "start",
        location
    })

    try{
        var { uploadToRemote, downloadFromRemote, renameInLocal, renameInRemote, moveInLocal, moveInRemote, deleteInLocal, deleteInRemote } = await consumeDeltas({ localDeltas, remoteDeltas, lastLocalTree, lastRemoteTree, localTreeNow, remoteTreeNow, location })
    }
    catch(e: any){
        log.error("Could not consume deltas for location " + location.uuid)
        log.error(e)

        ipc.addSyncIssue({
            uuid: uuidv4(),
            type: "critical",
            where: "local",
            path: pathModule.normalize(location.local),
            err: e,
            info: "Could not get consume deltas for location " + location.uuid,
            timestamp: new Date().getTime()
        }).catch(console.error)

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

    if((await isSyncLocationPaused(location.uuid))){
        await updateLocationBusyStatus(location.uuid, false)

        return true
    }

    log.info("Consuming tasks for location " + location.uuid)

    emitSyncStatusLocation("consumeTasks", {
        status: "start",
        location
    })

    try{
        var { doneTasks } = await consumeTasks({ uploadToRemote, downloadFromRemote, renameInLocal, renameInRemote, moveInLocal, moveInRemote, deleteInLocal, deleteInRemote, lastLocalTree, lastRemoteTree, localTreeNow, remoteTreeNow, location })
    }
    catch(e: any){
        log.error("Could not consume tasks for location " + location.uuid)
        log.error(e)

        emitSyncStatusLocation("consumeTasks", {
            status: "err",
            location,
            err: e
        })

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    log.info("Tasks for location " + location.uuid + " consumed")

    emitSyncStatusLocation("consumeTasks", {
        status: "done",
        location
    })

    try{
        const syncIssues = await ipc.getSyncIssues()

        if(syncIssues.filter(issue => issue.type == "critical").length > 0){
            log.info("Got critical sync issues after consume, won't apply anything to saved state")

            updateLocationBusyStatus(location.uuid, false)

            return false
        }
    }
    catch(e: any){
        log.error("Could not get sync issues after consume for location " + location.uuid)
        log.error(e)

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
    catch(e: any){
        log.error("Could not apply " + doneTasks.length + " done tasks to saved state for location " + location.uuid)
        log.error(e)

        ipc.addSyncIssue({
            uuid: uuidv4(),
            type: "critical",
            where: "local",
            path: pathModule.normalize(location.local),
            err: e,
            info: "Could not apply " + doneTasks.length + " done tasks to saved state for location " + location.uuid,
            timestamp: new Date().getTime()
        }).catch(console.error)

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

    log.info("Cleaning up " + location.uuid)

    try{
        await Promise.all([
            db.set("lastLocalTree:" + location.uuid, doneTasks.length > 0 ? localTreeNowApplied : localTreeNow),
            db.set("lastRemoteTree:" + location.uuid, doneTasks.length > 0 ? remoteTreeNowApplied : remoteTreeNow),
            clearApplyDoneTasks(location.uuid)
        ])
    }
    catch(e: any){
        log.error("Could not save lastLocalTree to DB for location " + location.uuid)
        log.error(e)

        ipc.addSyncIssue({
            uuid: uuidv4(),
            type: "critical",
            where: "local",
            path: pathModule.normalize(location.local),
            err: e,
            info: "Could not save lastLocalTree to DB for location " + location.uuid,
            timestamp: new Date().getTime()
        }).catch(console.error)

        emitSyncStatusLocation("cleanup", {
            status: "err",
            location,
            err: e
        })

        updateLocationBusyStatus(location.uuid, false)

        return false
    }

    log.info("Cleanup done " + location.uuid)

    await updateLocationBusyStatus(location.uuid, false)

    emitSyncStatusLocation("cleanup", {
        status: "done",
        location
    })

    return true
}

const startSyncLoop = () => {
    return setTimeout(sync, SYNC_TIMEOUT)
}

const sync = async (): Promise<any> => {
    await syncMutex.acquire()

    eventListener.emit("syncLoopStart")

    if(SYNC_RUNNING || new Date().getTime() < NEXT_SYNC){
        syncMutex.release()

        eventListener.emit("syncLoopDone")

        return
    }

    try{
        if(!(await db.get("isLoggedIn"))){
            syncMutex.release()

            eventListener.emit("syncLoopDone")

            return startSyncLoop()
        }
    }
    catch(e: any){
        syncMutex.release()

        eventListener.emit("syncLoopDone")

        log.error(e)

        return startSyncLoop()
    }

    emitSyncStatus("init", {
        status: "start"
    })

    try{
        var [userId, masterKeys, syncIssues, paused]: [ number | null, string[] | null, SyncIssue[], boolean | null ] = await Promise.all([
            db.get("userId"),
            db.get("masterKeys"),
            ipc.getSyncIssues(),
            db.get("paused")
        ])

        var syncLocations: Location[] | null = await db.get("syncLocations:" + userId)
    }
    catch(e: any){
        syncMutex.release()

        eventListener.emit("syncLoopDone")

        log.error("Could not fetch syncLocations from DB")
        log.error(e)

        emitSyncStatus("init", {
            status: "err",
            err: e
        })

        return startSyncLoop()
    }

    if(syncIssues.filter(issue => issue.type == "critical").length > 0){
        syncMutex.release()

        eventListener.emit("syncLoopDone")

        log.info("Will not continue, got critical sync issue, need user intervention")

        emitSyncStatus("init", {
            status: "err",
            err: "Will not continue, got critical sync issue, need user intervention"
        })

        return startSyncLoop()
    }

    if(Number.isNaN(userId)){
        syncMutex.release()

        eventListener.emit("syncLoopDone")

        log.info("User id not found, instead found: " + typeof userId)

        emitSyncStatus("init", {
            status: "err",
            err: "User id not found, instead found: " + typeof userId
        })

        return startSyncLoop()
    }

    if(!Array.isArray(masterKeys)){
        syncMutex.release()

        eventListener.emit("syncLoopDone")

        log.info("Master keys not found, instead found: " + typeof masterKeys)

        emitSyncStatus("init", {
            status: "err",
            err: "Master keys not found, instead found: " + typeof masterKeys
        })

        return startSyncLoop()
    }

    if(!Array.isArray(syncLocations)){
        syncMutex.release()

        eventListener.emit("syncLoopDone")

        log.info("Sync locations not array, instead found: " + typeof syncLocations)

        emitSyncStatus("init", {
            status: "err",
            err: "Sync locations not array, instead found: " + typeof syncLocations
        })

        return startSyncLoop()
    }

    if(syncLocations.length == 0){
        syncMutex.release()

        eventListener.emit("syncLoopDone")

        emitSyncStatus("init", {
            status: "done",
            syncLocations: []
        })

        log.info("Sync locations empty")

        return startSyncLoop()
    }

    emitSyncStatus("init", {
        status: "done",
        syncLocations
    })

    if(paused){
        syncMutex.release()

        eventListener.emit("syncLoopDone")

        return startSyncLoop()
    }

    if(!(await checkInternet())){
        syncMutex.release()

        eventListener.emit("syncLoopDone")

        return startSyncLoop()
    }

    if(SYNC_RUNNING || new Date().getTime() < NEXT_SYNC){
        syncMutex.release()

        eventListener.emit("syncLoopDone")

        return
    }

    SYNC_RUNNING = true

    try{
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
            catch(e: any){
                log.error("Sync task for location " + syncLocations[i].uuid + " failed, reason:")
                log.error(e)
                
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

        emitSyncStatus("cleanup", {
            status: "done"
        })
    }
    catch(e){
        log.error(e)
    }

    SYNC_RUNNING = false
    NEXT_SYNC = new Date().getTime() + SYNC_TIMEOUT

    syncMutex.release()

    eventListener.emit("syncLoopDone")

    return startSyncLoop()
}

ipc.addSyncIssue({
    uuid: uuidv4(),
    type: "warning",
    where: "local",
    path: "/this/is/aPath",
    err: new Error("lol"),
    info:"yajajajaa infooo",
    timestamp: new Date().getTime()
}).catch(console.error)

setInterval(startSyncLoop, (SYNC_TIMEOUT * 1.5))

export default sync