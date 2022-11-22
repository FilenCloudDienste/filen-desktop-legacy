const { Tray, nativeImage } = require("electron")
const path = require("path")
const log = require("electron-log")
const trayWindowPositioner = require("electron-traywindow-positioner")
const is = require("electron-is")

const TRAY_ICON_NORMAL = nativeImage.createFromPath(path.join(__dirname, "../../../../src/assets/icons/tray/normal@2x.png")).resize({ width: 16, height: 16 })
const TRAY_ICON_SYNC = nativeImage.createFromPath(path.join(__dirname, "../../../../src/assets/icons/tray/sync@2x.png")).resize({ width: 16, height: 16 })
const TRAY_ICON_PAUSED = nativeImage.createFromPath(path.join(__dirname, "../../../../src/assets/icons/tray/pause@2x.png")).resize({ width: 16, height: 16 })
const TRAY_ICON_ISSUE = nativeImage.createFromPath(path.join(__dirname, "../../../../src/assets/icons/tray/issue@2x.png")).resize({ width: 16, height: 16 })

const positionWindow = () => {
    if(is.linux()){
        return true
    }

    try{
        positionWindowAtTray(require("../shared").get("MAIN_WINDOW"), require("../shared").get("TRAY"))
    }
    catch(e){
        log.error(e)
    }

    return true
}

const toggleMainWindow = () => {
    try{
        if(typeof require("../shared").get("MAIN_WINDOW") !== "undefined"){
            require("../shared").get("MAIN_WINDOW").show()
        }
    }
    catch(e){
        log.error(e)
    }

    return true
}

const onClick = () => {
    positionWindow()

    return toggleMainWindow()
}

const onRightClick = () => {
    positionWindow()

    return true
}

const createTray = () => {
    if(is.linux()){
        return undefined
    }

    try{
        if(typeof require("../shared").get("TRAY") !== "undefined"){
            return require("../shared").get("TRAY")
        }
    
        const tray = new Tray(TRAY_ICON_NORMAL)
    
        tray.setIgnoreDoubleClickEvents(true)
        tray.setToolTip("Filen")
    
        tray.on("click", onClick)
        tray.on("right-click", onRightClick)

        tray.setContextMenu(require("../trayMenu").createMenu())
    
        require("../shared").set("TRAY", tray)

        positionWindow()
    
        return tray
    }
    catch(e){
        log.error(e)

        return undefined
    }
}

const positionWindowAtTray = (window, tray) => {
    if(typeof window == "undefined" || typeof tray == "undefined" || is.linux()){
        return false
    }

    try{
        trayWindowPositioner.position(window, tray.getBounds())
    }
    catch(e){
        log.error("Could not position window at tray")
        log.error(e)
    }

    return true
}

const updateTrayIcon = (type) => {
    if(is.linux()){
        return false
    }

    try{
        const tray = require("../shared").get("TRAY")

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
    if(is.linux()){
        return false
    }

    try{
        const tray = require("../shared").get("TRAY")

        if(typeof tray !== "undefined"){
            if(typeof tray.setContextMenu == "function" && typeof text == "string"){
                tray.setContextMenu(require("../trayMenu").buildMenu(type))
            }
        }
    }
    catch(e){
        log.error(e)
    }
}

const updateTrayTooltip = (text = "Filen") => {
    if(is.linux()){
        return false
    }

    try{
        const tray = require("../shared").get("TRAY")

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
    updateTrayTooltip,
    positionWindow
}