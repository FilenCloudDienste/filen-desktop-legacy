import db from "../../db"
import { sendToAllPorts } from "../ipc"
import { isSubdir } from "../../helpers"
import { Location, SyncModes } from "../../../../types"

const log = window.require("electron-log")
const gitignoreParser = window.require("@gerhobbelt/gitignore-parser")

export const isSyncLocationPaused = async (uuid: string): Promise<boolean> => {
    try{
        const userId = await db.get("userId")
        const syncLocations = await db.get("syncLocations:" + userId)

        for(let i = 0; i < syncLocations.length; i++){
            if(syncLocations[i].uuid == uuid){
                return syncLocations[i].paused
            }
        }
    }
    catch(e){
        log.error(e)
    }

    return false
}

export const isSuspended = async (): Promise<boolean> => {
    try{
        const suspend = await db.get("suspend")

        if(typeof suspend == "boolean"){
            return suspend
        }

        return false
    }
    catch(e){
        log.error(e)
    }

    return false
}

export const compileGitIgnore = (ignore: string) => {
    return gitignoreParser.compile(ignore)
}

// Parse lists into .gitignore like compatible format
export const getIgnored = (location: Location): Promise<{ selectiveSyncRemoteIgnore: any, filenIgnore: any, selectiveSyncRemoteIgnoreRaw: string, filenIgnoreRaw: string }> => {
    return new Promise((resolve, reject) => {
        Promise.all([
            db.get("selectiveSync:remote:" + location.uuid),
            db.get("filenIgnore:" + location.uuid)
        ]).then(([selectiveSyncRemote, fIgnore]) => {
            if(typeof fIgnore !== "string"){
                fIgnore = ""
            }

            try{
                return resolve({
                    selectiveSyncRemoteIgnore: selectiveSyncRemote,
                    filenIgnore: compileGitIgnore(fIgnore),
                    selectiveSyncRemoteIgnoreRaw: selectiveSyncRemote,
                    filenIgnoreRaw: fIgnore
                })
            }
            catch(e){
                return reject(e)
            }
        }).catch(reject)
    })
}

export const getSyncMode = async (location: Location): Promise<SyncModes> => {
    const userId = await db.get("userId")
    let syncLocations = await db.get("syncLocations:" + userId)

    if(!Array.isArray(syncLocations)){
        return "twoWay"
    }

    for(let i = 0; i < syncLocations.length; i++){
        if(syncLocations[i].uuid == location.uuid){
            return syncLocations[i].type
        }
    }

    return "twoWay"
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

export const onlyGetBaseParentMove = (tasks: any): any => {
    const sorted = tasks.sort((a: any, b: any) => {
        return a.path.split("/").length - b.path.split("/").length
    })

    const newTasks: any[] = []
    const moving: any[] = []
    
    const exists = (path: string) => {
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

export const onlyGetBaseParentDelete = (tasks: any): any => {
    const sorted = tasks.sort((a: any, b: any) => {
        return a.path.split("/").length - b.path.split("/").length
    })

    const newTasks: any[] = []
    const deleting: any[] = []
    
    const exists = (path: string) => {
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

export const sortMoveRenameTasks = (tasks: any): any => {
    const added: any = {}
    const newTasks: any[] = []

    tasks = tasks.filter((task: any) => typeof task.from == "string" && typeof task.to == "string" && typeof task.from == "string" && task.from !== task.to)

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

export const emitSyncTask = (type: string, data: any): void => {
    sendToAllPorts({
        type: "syncTask",
        data: {
            type,
            data
        }
    })
}

export const emitSyncStatus = (type: string, data: any): void => {
    sendToAllPorts({
        type: "syncStatus",
        data: {
            type,
            data
        }
    })
}

export const emitSyncStatusLocation = (type: string, data: any): void => {
    sendToAllPorts({
        type: "syncStatusLocation",
        data: {
            type,
            data
        }
    })
}

export const removeRemoteLocation = async (location: any): Promise<void> => {
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
}

export const isPathIncluded = (tasks: string[], path: string) => {
    for(let i = 0; i < tasks.length; i++){
        if(path.indexOf(tasks[i]) !== -1){
            return true
        }
    }

    return false
}

export const isIgnoredBySelectiveSync = (selectiveSyncRemoteIgnore: { [key: string]: boolean }, path: string): boolean => {
    if(typeof selectiveSyncRemoteIgnore == "undefined" || !selectiveSyncRemoteIgnore || selectiveSyncRemoteIgnore == null){
        return false
    }

    if(Object.keys(selectiveSyncRemoteIgnore).length <= 0){
        return false
    }

    for(const prop in selectiveSyncRemoteIgnore){
        if(prop == path || isSubdir(prop, path) || isSubdir(path, prop)){
            return true
        }
    }

    return false
}