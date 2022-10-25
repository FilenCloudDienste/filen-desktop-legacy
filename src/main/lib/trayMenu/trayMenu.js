const { Menu, app, ipcMain, dialog, BrowserWindow } = require("electron")
const shared = require("../shared")
const log = require("electron-log")
const { v4: uuidv4 } = require("uuid")

const upload = (type = "folders") => {
    let selectWindow = BrowserWindow.getFocusedWindow()

    if(selectWindow == null){
        selectWindow = shared.get("WORKER_WINDOW")

        if(typeof selectWindow == "undefined"){
            selectWindow = shared.get("MAIN_WINDOW")
        }
    }

    dialog.showOpenDialog(selectWindow, {
        properties: type == "folders" ? ["openDirectory", "multiSelections"] : ["openFile", "multiSelections"]
    }).then((result) => {
        if(result.canceled){
            return false
        }

        const windowId = uuidv4()

        require("../windows").createCloud(windowId, "selectFolder").then((window) => {
            ipcMain.once("remoteFolderSelected", (_, data) => {
                if(data.windowId !== windowId){
                    return false
                }

                window.close()

                if(data.canceled){
                    return false
                }

                require("../windows").createUpload({
                    type,
                    local: {
                        ...result
                    },
                    remote: {
                        ...data
                    }
                }, uuidv4()).catch(log.error)
            })
        }).catch(log.error)
    }).catch(log.error)
}

const download = () => {
    require("../windows").createCloud(uuidv4(), "download").catch(log.error)
}

const buildMenu = (type = "default") => {
    switch(type){
        default:
            return [
                {
                    label: "Show",
                    click: () => {
                        if(typeof shared.get("MAIN_WINDOW") !== "undefined"){
                            shared.get("MAIN_WINDOW").show()
                        }
                    }
                },
                {
                    label: "Separator",
                    type: "separator"
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
                /*{
                    label: "Download",
                    click: () => {
                        download()
                    }
                },*/
                {
                    label: "Settings",
                    click: () => {
                        require("../windows").createSettings().catch(log.error)
                    }
                },
                {
                    label: "Separator",
                    type: "separator"
                },
                {
                    label: "Quit Filen",
                    click: () => {
                        dialog.showMessageBox(undefined, {
                            message: "Are you sure you want to quit?",
                            type: "warning",
                            buttons: [
                                "Quit",
                                "Cancel"
                            ],
                            defaultId: 0,
                            title: "Filen",
                            cancelId: 0
                        }).then(({ response }) => {
                            if(response == 1){
                                return false
                            }

                            app.exit()
                        }).catch(log.error)
                    }
                }
            ]
        break
    }
}

const createMenu = (type = "default") => {
    try{
        const menu = Menu.buildFromTemplate(buildMenu(type))
    
        shared.set("TRAY_MENU", menu)
    
        return menu
    }
    catch(e){
        log.error(e)

        return undefined
    }
}

module.exports = {
    createMenu,
    buildMenu,
    upload,
    download
}