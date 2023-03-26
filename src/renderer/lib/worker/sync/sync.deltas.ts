import { Delta, Location } from "../../../../types"
import { getSyncMode } from "./sync.utils"
import { v4 as uuidv4 } from "uuid"

const pathModule = window.require("path")

export const getDeltas = async (type: "local" | "remote", before: any, now: any): Promise<{ folders: Delta, files: Delta }> => {
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

    return {
        files: deltasFiles,
        folders: deltasFolders
    }
}

export const consumeDeltas = async ({ localDeltas, remoteDeltas, lastLocalTree, lastRemoteTree, localTreeNow, remoteTreeNow, location }: { localDeltas: any, remoteDeltas: any, lastLocalTree: any, lastRemoteTree: any, localTreeNow: any, remoteTreeNow: any, location: Location }): Promise<any> => {
    const syncMode = await getSyncMode(location)

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

    const addedToList: Record<string, boolean> = {}

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

    return {
        uploadToRemote,
        downloadFromRemote,
        renameInLocal,
        renameInRemote,
        moveInLocal,
        moveInRemote,
        deleteInLocal,
        deleteInRemote
    }
}