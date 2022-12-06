export interface RemoteFileMetadata {
    name: string,
    size: number,
    key: string,
    lastModified: number,
    mime: string
}

export interface RemoteItem {
    uuid: string,
    name: string,
    parent: string,
    type: "folder" | "file",
    path: string,
    region: string,
    bucket: string,
    chunks: number,
    version: number,
    metadata: RemoteFileMetadata
}

export interface RemoteUUIDs {
    type: "folder" | "file",
    path: string
}

export interface RemoteDirectoryTreeResult {
    changed: boolean,
    data: {
        files: {
            [key: string]: RemoteItem
        },
        folders: {
            [key: string]: RemoteItem
        },
        uuids: {
            [key: string]: RemoteUUIDs
        }
    }
}