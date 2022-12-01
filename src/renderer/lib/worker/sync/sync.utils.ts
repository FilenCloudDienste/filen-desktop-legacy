import db from "../../db"
import { sendToAllPorts } from "../ipc"
import { memoize } from "lodash"
import { isSubdir } from "../../helpers"

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

export const isSuspended = (): Promise<boolean> => {
    return new Promise((resolve) => {
        db.get("suspend").then((suspend) => {
            if(typeof suspend == "boolean"){
                return resolve(suspend)
            }

            return resolve(false)
        }).catch((err) => {
            log.error(err)

            return resolve(false)
        })
    })
}

export const compileGitIgnore = memoize((ignore: string) => {
    return gitignoreParser.compile(ignore)
})

// Parse lists into .gitignore like compatible format
export const getIgnored = (location: any): Promise<any> => {
    return new Promise((resolve, reject) => {
        Promise.all([
            db.get("selectiveSync:remote:" + location.uuid),
            db.get("filenIgnore:" + location.uuid)
        ]).then(([selectiveSyncRemote, fIgnore]) => {
            if(typeof fIgnore !== "string"){
                fIgnore = ""
            }

            return resolve({
                selectiveSyncRemoteIgnore: selectiveSyncRemote,
                filenIgnore: compileGitIgnore(fIgnore),
                selectiveSyncRemoteIgnoreRaw: selectiveSyncRemote,
                filenIgnoreRaw: fIgnore
            })
        }).catch(reject)
    })
}

export const getSyncMode = (location: any) => {
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

export const onlyGetBaseParentMove = memoize((tasks: any): any => {
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
}, (tasks: any) => JSON.stringify(tasks))

export const onlyGetBaseParentDelete = memoize((tasks: any): any => {
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
}, (tasks: any) => JSON.stringify(tasks))

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

export const sortMoveRenameTasks = memoize((tasks: any): any => {
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
}, (tasks: any) => JSON.stringify(tasks))

export const addToSyncIssues = (type: string, message: any): Promise<boolean> => {
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

            db.set("syncIssues", syncIssues).then(() => resolve(true)).catch(reject)
        })
    })
}

export const updateLocationBusyStatus = (uuid: string, busy: boolean): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        db.get("userId").then((userId) => {
            db.get("syncLocations:" + userId).then((syncLocations) => {
                if(!Array.isArray(syncLocations)){
                    syncLocations = []
                }

                syncLocations = syncLocations.map((location: any) => location.uuid == uuid ? { ...location, busy } : location)

                db.set("syncLocations:" + userId, syncLocations).then(() => resolve(true)).catch(reject)
            }).catch(reject)
        }).catch(reject)
    })
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

export const removeRemoteLocation = (location: any): Promise<boolean> => {
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

export const isPathIncluded = memoize((tasks: string[], path: string) => {
    for(let i = 0; i < tasks.length; i++){
        if(path.indexOf(tasks[i]) !== -1){
            return true
        }
    }

    return false
}, (tasks: string[], path: string) => tasks.map(task => task) + ":" + path)

export const isIgnoredBySelectiveSync = memoize((selectiveSyncRemoteIgnore: { [key: string]: boolean }, path: string): boolean => {
    if(Object.keys(selectiveSyncRemoteIgnore).length <= 0){
        return false
    }

    path = path.trim()

    for(let prop in selectiveSyncRemoteIgnore){
        prop = prop.trim()

        if(prop == path || isSubdir(prop, path) || isSubdir(path, prop)){
            return true
        }
    }

    return false
}, (selectiveSyncRemoteIgnore: { [key: string]: boolean }, path: string) => Object.keys(selectiveSyncRemoteIgnore) + ":" + path)