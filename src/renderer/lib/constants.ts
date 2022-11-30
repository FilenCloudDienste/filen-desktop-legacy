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
    folders: string[],
    system: string[]
} = {
    names: [
        ".ds_store",
        "desktop.ini",
        "thumbs.db",
        "ntuser.dat",
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
        "lnk"
    ],
    folders: [
        ".filen.trash.local",
        "$RECYCLE.BIN",
        ".Trash",
        ".local/share/Trash",
        "/share/Trash",
        "local/share/Trash",
        "/AppData/Local",
        "/AppData/Roaming",
    ],
    system: [
        "//C:\\$WINDOWS.~BT",
        "//C:\\$Windows.~WS",
        "//C:\\$WinREAgent",
        "//C:\\Windows",
        "//C:\\OneDriveTemp",
        "//C:\\PerfLogs",
        "//C:\\ProgramData",
        "//C:\\Program Files\\Uninstall Information",
        "//C:\\Program Files\\WindowsApps",
        "//C:\\Program Files\\Windows Defender",
        "//C:\\Program Files\\Windows Mail",
        "//C:\\Program Files\\Windows Media Player",
        "//C:\\Program Files\\Windows Multimedia Platform",
        "//C:\\Program Files\\Windows NT",
        "//C:\\Program Files\\Windows Photo Viewer",
        "//C:\\Program Files\\Windows Portable Devices",
        "//C:\\Program Files\\Windows Security",
        "//C:\\Program Files\\WindowsPowerShell",
        "//C:\\Program Files (x86)\\Uninstall Information",
        "//C:\\Program Files (x86)\\WindowsApps",
        "//C:\\Program Files (x86)\\Windows Defender",
        "//C:\\Program Files (x86)\\Windows Mail",
        "//C:\\Program Files (x86)\\Windows Media Player",
        "//C:\\Program Files (x86)\\Windows Multimedia Platform",
        "//C:\\Program Files (x86)\\Windows NT",
        "//C:\\Program Files (x86)\\Windows Photo Viewer",
        "//C:\\Program Files (x86)\\Windows Portable Devices",
        "//C:\\Program Files (x86)\\Windows Security",
        "//C:\\Program Files (x86)\\WindowsPowerShell",
        "//C:\\Program Files (x86)\\Internet Explorer",
        "//C:\\Program Files (x86)\\Microsoft",
        "//C:\\Program Files (x86)\\WindowsPowerShell",
        "//C:\\Program Files (x86)\\Reference Assemblies"
    ]
}

export const chunkSize: number = (1024 * 1024)
export const maxConcurrentUploads: number = 10
export const maxConcurrentDownloads: number = 16
export const maxDownloadThreads: number = 64
export const maxUploadThreads: number = 10
export const maxConcurrentTransfers: number = 64
export const maxRetryAPIRequest: number = 32
export const retryAPIRequestTimeout: number = 1000
export const maxRetrySyncTask: number = 16
export const retrySyncTaskTimeout: number = 1000
export const maxRetryUpload: number = 16
export const retryUploadTimeout: number = 1000
export const maxRetryDownload: number = 32
export const retryDownloadTimeout: number = 1000
export const sizeOverheadMultiplier: number = 1
export const speedMultiplier: number = 1
export const maxConcurrentSyncTasks: number = 512
export const maxConcurrentAPIRequest: number = 64