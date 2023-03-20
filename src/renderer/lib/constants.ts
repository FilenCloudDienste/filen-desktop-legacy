import constantsJSON from "../../constants.json"

export const apiServers: string[] = [
    "api.filen.io"
]

export const uploadServers: string[] = [
    "up.filen.io"
]

export const downloadServers: string[] = [
    "down.filen.io"
]

export const defaultIgnored = constantsJSON.defaultIgnored

export const chunkSize: number = (1024 * 1024)
export const maxConcurrentUploads: number = 8
export const maxConcurrentDownloads: number = 8
export const maxDownloadThreads: number = 64
export const maxUploadThreads: number = 10
export const maxConcurrentTransfers: number = (maxConcurrentUploads + maxConcurrentDownloads + 1)
export const maxRetryAPIRequest: number = 32
export const retryAPIRequestTimeout: number = 1000
export const maxRetrySyncTask: number = 8
export const retrySyncTaskTimeout: number = 1000
export const maxRetryUpload: number = 8
export const retryUploadTimeout: number = 1000
export const maxRetryDownload: number = 8
export const retryDownloadTimeout: number = 1000
export const sizeOverheadMultiplier: number = 1
export const speedMultiplier: number = 1
export const maxConcurrentSyncTasks: number = 128
export const maxConcurrentAPIRequest: number = 128
export const clearLocalTrashDirsInterval: number = (60000 * 15)
export const deleteFromLocalTrashAfter: number = ((86400 * 1000) * 30)