import { Menu, app, ipcMain, dialog, BrowserWindow } from "electron"
import log from "electron-log"
import memoryCache from "../memoryCache"
import { createCloud, createUpload, createSettings } from "../windows"
import { emitGlobal } from "../ipc"

export const upload = (type = "folders") => {
    let selectWindow = BrowserWindow.getFocusedWindow()

    if(!selectWindow){
        selectWindow = memoryCache.get("WORKER_WINDOW")

        if(selectWindow){
            selectWindow = memoryCache.get("MAIN_WINDOW")
        }
    }

    if(!selectWindow){
        return
    }

    dialog.showOpenDialog(selectWindow, {
        properties: type == "folders" ? ["openDirectory", "multiSelections"] : ["openFile", "multiSelections"]
    }).then((result) => {
        if(result.canceled){
            return
        }

        createCloud("selectFolder").then((window) => {
            const windowId = window.id

            const listener = (_: any, data: any) => {
                if(parseInt(data.windowId) !== windowId){
                    return
                }

                window.close()

                ipcMain.removeListener("remoteFolderSelected", listener)

                if(data.canceled){
                    return
                }

                createUpload({
                    type,
                    local: {
                        ...result
                    },
                    remote: {
                        ...data
                    }
                }).catch(log.error)
            }

            ipcMain.on("remoteFolderSelected", listener)
        }).catch(log.error)
    }).catch(log.error)
}

export const buildMenu = () => {
    return [
        {
            label: "Show",
            click: () => {
                if(memoryCache.has("MAIN_WINDOW")){
                    memoryCache.get("MAIN_WINDOW").show()
                }
            }
        },
        {
            label: "Separator",
            type: "separator"
        },
        {
            label: "Force sync",
            click: () => {
                emitGlobal("global-message", {
                    type: "forceSync"
                })
            }
        },
        {
            label: "Upload folders",
            click: () => {
                upload("folders")
            }
        },
        {
            label: "Upload files",
            click: () => {
                upload("files")
            }
        },
        {
            label: "Settings",
            click: () => {
                createSettings().catch(log.error)
            }
        },
        {
            label: "Separator",
            type: "separator"
        },
        {
            label: "Quit Filen",
            click: () => {
                app.exit(0)
            }
        }
    ]
}

export const createMenu = () => {
    const menu = Menu.buildFromTemplate(buildMenu() as any)
    
    memoryCache.set("TRAY_MENU", menu)

    return menu
}