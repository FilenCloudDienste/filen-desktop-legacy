process.noAsar = true

const { app, ipcRenderer, remote } = require("electron")
const shell = require("electron").shell
const electron = require("electron")
const path = require("path")
const $ = require("jquery")
const is = require("electron-is")

let userSyncDir = undefined
let userHomePath = undefined
let userDownloadPath = undefined
let appPath = undefined



const init = () => {
	

	ipcRenderer.send("settings-renderer-ready")
}

$(document).ready(() => {
	init()
})