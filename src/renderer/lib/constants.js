export const apiServers = [
    "api.filen.io"
]

export const uploadServers = [
    "up.filen.io"
]

export const downloadServers = [
    "down.filen.io"
]

export const defaultIgnored = {
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
        "COM9",
        ".filen.trash.local"
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
    ]
}

export const chunkSize = (1024 * 1024)
export const maxConcurrentUploads = 4
export const maxConcurrentDownloads = 4
export const maxDownloadThreads = 64
export const maxUploadThreads = 8
export const maxConcurrentTransfers = 10
export const maxRetryAPIRequest = 512
export const retryAPIRequestTimeout = 1000
export const maxRetrySyncTask = 16
export const retrySyncTaskTimeout = 1000
export const maxRetryUpload = 512
export const retryUploadTimeout = 1000
export const maxRetryDownload = 512
export const retryDownloadTimeout = 1000
export const sizeOverheadMultiplier = 1.5
export const speedMultiplier = 1