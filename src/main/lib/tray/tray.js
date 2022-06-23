const { Tray, nativeImage } = require("electron")
const path = require("path")
const log = require("electron-log")
const trayWindowPositioner = require("electron-traywindow-positioner")
const shared = require("../shared")
const trayMenu = require("../trayMenu")
const is = require("electron-is")

const TRAY_ICON_NORMAL = nativeImage.createFromPath(path.join(__dirname, "../../../../src/assets/icons/tray/normal" + (is.macOS() ? "Template" : "") + "@2x.png"))
const TRAY_ICON_SYNC = nativeImage.createFromPath(path.join(__dirname, "../../../../src/assets/icons/tray/sync" + (is.macOS() ? "Template" : "") + "@2x.png"))
const TRAY_ICON_PAUSED = nativeImage.createFromPath(path.join(__dirname, "../../../../src/assets/icons/tray/paused" + (is.macOS() ? "Template" : "") + "@2x.png"))
const TRAY_ICON_ISSUE = nativeImage.createFromPath(path.join(__dirname, "../../../../src/assets/icons/tray/issue" + (is.macOS() ? "Template" : "") + "@2x.png"))

const toggleMainWindow = () => {
    try{
        if(typeof shared.get("MAIN_WINDOW") !== "undefined"){
            positionWindowAtTray(shared.get("MAIN_WINDOW"), shared.get("TRAY"))

            shared.get("MAIN_WINDOW").show()

            shared.get("MAIN_WINDOW").once("show", () => setTimeout(() => shared.get("MAIN_WINDOW").focus(), 250))
        }
    }
    catch(e){
        log.error(e)
    }

    return true
}

const onClick = () => {
    try{
        shared.get("TRAY").setContextMenu(null)
    }
    catch(e){
        log.error(e)
    }

    return toggleMainWindow()
}

const onRightClick = () => {
    try{
        const menu = trayMenu.createMenu()

        shared.get("TRAY").setContextMenu(menu)
    }
    catch(e){
        log.error(e)
    }

    return true
}

const createTray = () => {
    try{
        if(typeof shared.get("TRAY") !== "undefined"){
            return shared.get("TRAY")
        }
    
        const tray = new Tray(TRAY_ICON_NORMAL)
    
        tray.setIgnoreDoubleClickEvents(true)
        tray.setToolTip("Filen")
    
        tray.on("click", onClick)
        tray.on("right-click", onRightClick)
    
        shared.set("TRAY", tray)
    
        return tray
    }
    catch(e){
        log.error(e)

        return undefined
    }
}

const positionWindowAtTray = (window, tray) => {
    try{
        if(typeof window == "undefined"){
            if(typeof shared.get("MAIN_WINDOW") == "undefined"){
                return false
            }
    
            window = shared.get("MAIN_WINDOW")
        }
        
        if(!is.linux()){
            trayWindowPositioner.position(window, tray.getBounds())
        }
    }
    catch(e){
        log.error("Could not position window at tray")
        log.error(e)
    }

    return true
}

const updateTrayIcon = (type) => {
    try{
        const tray = shared.get("TRAY")

        if(typeof tray !== "undefined"){
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

const updateTrayMenu = (type = "default") => {
    try{
        const tray = shared.get("TRAY")

        if(typeof tray !== "undefined"){
            if(typeof tray.setContextMenu == "function" && typeof text == "string"){
                tray.setContextMenu(trayMenu.buildMenu(type))
            }
        }
    }
    catch(e){
        log.error(e)
    }
}

const updateTrayTooltip = (text = "Filen") => {
    try{
        const tray = shared.get("TRAY")

        if(typeof tray !== "undefined"){
            if(typeof tray.setToolTip == "function" && typeof text == "string"){
                tray.setToolTip(text)
            }
        }
    }
    catch(e){
        log.error(e)
    }
}

module.exports = {
    createTray,
    positionWindowAtTray,
    TRAY_ICON_NORMAL,
    TRAY_ICON_SYNC,
    TRAY_ICON_PAUSED,
    TRAY_ICON_ISSUE,
    updateTrayIcon,
    updateTrayMenu,
    updateTrayTooltip
}