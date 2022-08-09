export const apiServers: string[] = [
    "api.filen.io"
]

export const uploadServers: string[] = [
    "up.filen.io"
]

export const downloadServers: string[] = [
    "down.filen.io"
]

export const defaultIgnored: {
    names: string[],
    extensions: string[],
    folders: string[]
} = {
    names: [
        ".ds_store",
        "desktop.ini",
        "thumbs.db",
        "AUX",
        "PRN",
        "NUL",
        "CON",
        "LPT1",
        "LPT2",
        "LPT3",
        "LPT4",
        "LPT5",
        "LPT6",
        "LPT7",
        "LPT8",
        "LPT9",
        "COM1",
        "COM2",
        "COM3",
        "COM4",
        "COM5",
        "COM6",
        "COM7",
        "COM8",
        "COM9"
    ],
    extensions: [
        "tmp",
        "temp",
        "backupdb",
        "cache",
        "lnk",
        "_",
        "scriv",
        "BridgeCache",
        "download",
        "fcpcache"
    ],
    folders: [
        ".filen.trash.local",
        "$RECYCLE.BIN\\",
        "$RECYCLE.BIN/",
        ".Trash",
        ".local/share/Trash"
    ]
}

export const chunkSize: number = (1024 * 1024)
export const maxConcurrentUploads: number = 4
export const maxConcurrentDownloads: number = 4
export const maxDownloadThreads: number = 64
export const maxUploadThreads: number = 8
export const maxConcurrentTransfers: number = 10
export const maxRetryAPIRequest: number = 512
export const retryAPIRequestTimeout: number = 1000
export const maxRetrySyncTask: number = 16
export const retrySyncTaskTimeout: number = 1000
export const maxRetryUpload: number = 512
export const retryUploadTimeout: number = 1000
export const maxRetryDownload: number = 512
export const retryDownloadTimeout: number = 1000
export const sizeOverheadMultiplier: number = 1
export const speedMultiplier: number = 1
export const maxConcurrentSyncTasks: number = 256
export const maxConcurrentAPIRequest: number = 32