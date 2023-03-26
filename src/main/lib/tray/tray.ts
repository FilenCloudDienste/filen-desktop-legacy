import { Tray, nativeImage, BrowserWindow } from "electron"
import path from "path"
import log from "electron-log"
// @ts-ignore
import trayWindowPositioner from "electron-traywindow-positioner"
import { exec } from "child_process"
import memoryCache from "../memoryCache"
import { buildMenu, createMenu } from "../trayMenu/trayMenu"

const TRAY_ICON_NORMAL = nativeImage.createFromPath(path.join(__dirname, "../../../../src/assets/icons/tray/normal@2x.png")).resize({ width: 16, height: 16 })
const TRAY_ICON_SYNC = nativeImage.createFromPath(path.join(__dirname, "../../../../src/assets/icons/tray/sync@2x.png")).resize({ width: 16, height: 16 })
const TRAY_ICON_PAUSED = nativeImage.createFromPath(path.join(__dirname, "../../../../src/assets/icons/tray/pause@2x.png")).resize({ width: 16, height: 16 })
const TRAY_ICON_ISSUE = nativeImage.createFromPath(path.join(__dirname, "../../../../src/assets/icons/tray/issue@2x.png")).resize({ width: 16, height: 16 })

// XFCE etc.
export const linuxCheckStatusNotifierPlugin = (): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        exec("/sbin/ldconfig -p | grep statusnotifier-plugin", (err, _, stderr) => {
            if(err || stderr){
                return resolve(false)
            }

            return resolve(true)
        })
    })
}

// Default
export const linuxCheckLibAppIndicator = (): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        exec("/sbin/ldconfig -p | grep appindicator", (err, _, stderr) => {
            if(err || stderr){
                return linuxCheckStatusNotifierPlugin().then(resolve).catch(reject)
            }

            return resolve(true)
        })
    })
}

export const positionWindow = () => {
    if(!memoryCache.has("trayAvailable")){
        return
    }

    try{
        positionWindowAtTray(memoryCache.get("MAIN_WINDOW"), memoryCache.get("TRAY"))
    }
    catch(e){
        log.error(e)
    }
}

export const toggleMainWindow = () => {
    try{
        if(memoryCache.has("MAIN_WINDOW")){
            memoryCache.get("MAIN_WINDOW").show()
        }
    }
    catch(e){
        log.error(e)
    }
}

export const onClick = () => {
    positionWindow()
    toggleMainWindow()
}

export const onRightClick = () => {
    positionWindow()
}

export const createTray = async () => {
    if(!memoryCache.has("trayAvailable")){
        return undefined
    }

    try{
        if(memoryCache.has("TRAY")){
            return memoryCache.get("TRAY")
        }
    
        const tray = new Tray(TRAY_ICON_NORMAL)
    
        tray.setIgnoreDoubleClickEvents(true)
        tray.setToolTip("Filen")
    
        tray.on("click", onClick)
        tray.on("right-click", onRightClick)

        tray.setContextMenu(await createMenu())
    
        memoryCache.set("TRAY", tray)

        positionWindow()
    
        return tray
    }
    catch(e){
        log.error(e)

        return undefined
    }
}

export const positionWindowAtTray = (window: BrowserWindow, tray: Tray) => {
    if(typeof window == "undefined" || typeof tray == "undefined" || !memoryCache.has("trayAvailable")){
        return
    }

    try{
        trayWindowPositioner.position(window, tray.getBounds())
    }
    catch{}
}

export const updateTrayIcon = (type: string) => {
    if(!memoryCache.has("trayAvailable")){
        return
    }

    try{
        const tray = memoryCache.get("TRAY")

        if(tray){
            if(typeof tray.setImage == "function"){
                switch(type){
                    case "sync":
                        tray.setImage(TRAY_ICON_SYNC)
                    break
                    case "paused":
                        tray.setImage(TRAY_ICON_PAUSED)
                    break
                    case "error":
                        tray.setImage(TRAY_ICON_ISSUE)
                    break
                    default:
                        tray.setImage(TRAY_ICON_NORMAL)
                    break
                }
            }
        }
    }
    catch(e){
        log.error(e)
    }
}

export const updateTrayMenu = async () => {
    if(!memoryCache.has("trayAvailable")){
        return
    }

    try{
        const tray = memoryCache.get("TRAY")

        if(tray){
            if(typeof tray.setContextMenu == "function"){
                tray.setContextMenu(await buildMenu())
            }
        }
    }
    catch(e){
        log.error(e)
    }
}

export const updateTrayTooltip = (text = "Filen") => {
    if(!memoryCache.has("trayAvailable")){
        return
    }

    try{
        const tray = memoryCache.get("TRAY")

        if(tray){
            if(typeof tray.setToolTip == "function" && typeof text == "string"){
                tray.setToolTip(text)
            }
        }
    }
    catch(e){
        log.error(e)
    }
}