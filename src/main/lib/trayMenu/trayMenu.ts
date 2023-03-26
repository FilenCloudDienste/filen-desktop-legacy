import { Menu, app, ipcMain, dialog, BrowserWindow } from "electron"
import log from "electron-log"
import memoryCache from "../memoryCache"
import { createCloud, createUpload, createSettings } from "../windows"
import { emitGlobal } from "../ipc"
import { i18n } from "../../../renderer/lib/i18n"
import db from "../db"

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

export const buildMenu = async () => {
    let lang = "en"

    try{
        lang = await db.get("lang")
    }
    catch(e){
        log.error(e)
    }

    return [
        {
            label: i18n(lang, "trayMenuShow"),
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
            label: i18n(lang, "trayMenuForceSync"),
            click: () => {
                emitGlobal("global-message", {
                    type: "forceSync"
                })
            }
        },
        {
            label: i18n(lang, "trayMenuUploadFolders"),
            click: () => {
                upload("folders")
            }
        },
        {
            label: i18n(lang, "trayMenuUploadFiles"),
            click: () => {
                upload("files")
            }
        },
        {
            label: i18n(lang, "trayMenuSettings"),
            click: () => {
                createSettings().catch(log.error)
            }
        },
        {
            label: "Separator",
            type: "separator"
        },
        {
            label: i18n(lang, "trayMenuQuit"),
            click: () => {
                app.exit(0)
            }
        }
    ]
}

export const createMenu = async () => {
    const builtMenu = await buildMenu() as any
    const menu = Menu.buildFromTemplate(builtMenu)
    
    memoryCache.set("TRAY_MENU", menu)

    return menu
}