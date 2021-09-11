process.noAsar = true

process.on("uncaughtException", (err) => {
	console.error(err)

	try{
		if(err.toString().toLowerCase().indexOf("openerror") !== -1 || err.toString().toLowerCase().indexOf("corruption") !== -1 && err.toString().toLowerCase().indexOf("level") !== -1){
			let electron = require("electron")
			let rimraf = require("rimraf")
			let dbPath = (electron.app || electron.remote.app).getPath("userData") + "/db/level"

			if(process.platform == "linux" || process.platform == "darwin"){
				dbPath = (electron.app || electron.remote.app).getPath("userData") + "/level"
			}

			return rimraf(dbPath, () => {
				try{
					ipcRenderer.send("exit-app")
				}
				catch(e){
					console.log(e)
				}
			})
		}
	}
	catch(err){
		return console.log(err)
	}
})

const { app, ipcRenderer, remote } = require("electron")
const shell = require("electron").shell
const electron = require("electron")
const CryptoJS = require("crypto-js")
const level = require("level")
const fs = require("fs-extra")
const path = require("path")
const $ = require("jquery")
const socketIO = require("socket.io-client")
const crypto = window.crypto
const mimeTypes = require("mime-types")
const readChunk = require("read-chunk")
const klaw = require("klaw")
const chokidar = require("chokidar-fs-extra")
const { Semaphore } = require("await-semaphore")
const rimraf = require("rimraf")
const checkDiskSpace = require("check-disk-space")
const md2 = require("js-md2")
const md4 = require("js-md4")
const md5 = require("js-md5")
const sha256 = require("js-sha256")
const sha1 = require("js-sha1")
const sha512 = require("js-sha512")
const sha384 = require("js-sha512").sha384
const is = require("electron-is")

let db = undefined
let dbPath = undefined

if(is.linux() || is.macOS()){
	dbPath = (electron.app || electron.remote.app).getPath("userData") + "/level"
}
else{
	dbPath = (electron.app || electron.remote.app).getPath("userData") + "/db/level"
}

try{
	db = level(dbPath)
}
catch(e){
	console.log(e)

	rimraf(dbPath, () => {
		try{
			ipcRenderer.send("exit-app")
		}
		catch(e){
			console.log(e)
		}
	})
}

const apiSemaphore = new Semaphore(50)
const downloadSemaphore = new Semaphore(50)
const uploadSemaphore = new Semaphore(50)
const logSyncTasksSemaphore = new Semaphore(1)
const doSyncSempahore = new Semaphore(1)
const syncTaskLimiterSemaphore = new Semaphore(50)

let currentAppVersion = "1"
let thisDeviceId = undefined
let isIndexing = false
let lastSyncTasksData = undefined
let lastSyncedItem = undefined
let diskSpaceFree = 5114639114240
let idleTimeSeconds = 0
let chokidarWatcher = undefined
let socket = undefined
let socketReady = false
let socketHeartbeatInterval = undefined
let userSyncDir = undefined
let userHomePath = undefined
let userDownloadPath = undefined
let appPath = undefined
let syncStarted = false
let remoteSyncFolders = undefined
let remoteSyncFiles = undefined
let currentSyncTasks = []
let appPlatform = undefined
let isSyncing = false
let syncTaskTries = {}
let lastSyncFolders = undefined
let lastSyncFiles = undefined
let lastRemoteSyncDataHash = undefined
let lastRemoteSyncFolders = undefined
let lastRemoteSyncFiles = undefined
let lastLocalSyncDataHash = undefined
let lastLocalSyncFolders = undefined
let lastLocalSyncFiles = undefined
let localFileModifications = {}
let remoteFileUUIDs = {}
let remoteFileSizes = {}
let bannedUploadUUIDs = {}
let chunksWritten = {}
let lastDatasetHash = undefined
let currentDeletingRemoteFolders = []
let currentDeletingLocalFolders = []
let localDataChanged = true
let localFileExisted = {}
let localFolderExisted = {}
let currentDownloadTasks = 0
let maxDownloadTasks = 1
let currentDownloadThreads = 0
let maxDownloadThreads = 32
let currentUploadTasks = 0
let maxUploadTasks = 10
let currentUploadThreads = 0
let maxUploadThreads = 16
let downloadWriteChunk = {}
let downloadIndex = {}
let downloadWriteStreams = {}
let maxAPICallThreads = 30
let currentAPICallThreads = 0
let savedUserUsage = {}
let syncingPaused = false
let syncTimeout = 3000
let fillSyncDataInterval = undefined
let remoteDecryptedCache = {}
let isCurrentlyDownloadigRemote = false
let currentDownloadFileUUID = undefined
let currentDownloadFolderUUID = undefined
let currentDownloadFolderIsShared = false
let currentDownloadFolderLinkKey = undefined
let currentDownloadFolderLinkUUID = undefined
let currentDownloadFolderName = ""
let currentDownloadFolderLinkPassword = undefined
let currentDownloadFolderIsLink = false
let lastDownloadFolderPath = undefined
let currentDownloadFolderLoaded = {}
let currentDownloadFolderStopped = {}
let downloadFolderDoneInterval = undefined
let localDataChangedFiles = {}
let lastSavedDataHash = undefined
let lastReceivedSyncData = undefined
let firstDataRequest = true
let skipNextRequestData = true
let dontHideOnBlur = false
let lastHeaderStatus = ""
let lastTooltipText = ""
let syncTasksToWrite = []
let deletedLastCycle = {}
let isDoingRealtimeWork = false
let syncMode = "twoWay"
let reloadAll = true
let handleRealtimeWorkTimeout = undefined
let currentSyncTasksExtra = []
let currentWriteThreads = 0
let maxWriteThreads = 1024

let currentFileVersion = 1
let metadataVersion = 1

let defaultBlockedFiles = [
	".ds_store",
	"desktop.ini",
	"thumbs.db"
]

let defaultBlockedFileExt = [
	".tmp",
	".temp"
]

const isFileNameBlocked = (name) => {
	if(typeof name !== "string"){
		return false
	}

	if(name.length <= 0){
		return false
	}

	name = name.toLowerCase().trim()

	if(defaultBlockedFiles.includes(name)){
		return true
	}

	if(name.substring(0, 7) == ".~lock."){
		return true
	}

	if(name.substring(0, 2) == "~$"){
		return true
	}

	if(name.substring(name.length - 4) == ".tmp"){
		return true
	}

	if(name.substring(name.length - 5) == ".temp"){
		return true
	}

	return false
}

const apiRequest = async (endpoint, data, callback) => {
	try{
		var release = await apiSemaphore.acquire()
	}
	catch(e){
		return callback(e)
	}

	if(typeof thisDeviceId == "string"){
		data.syncDeviceId = thisDeviceId
	}

	$.ajax({
		url: getAPIServer() + endpoint,
		type: "POST",
		contentType: "application/json",
		data: JSON.stringify(data),
		processData: false,
		cache: false,
		timeout: 300000,
		success: (res) => {
			release()

			if(!res){
				return callback("Request error.")
			}

			return callback(null, res)
		},
		error: (err) => {
			release()

			return callback(err)
		}
	})
}

const hashFn = (val) => { //old deprecated
  	return CryptoJS.SHA1(CryptoJS.SHA512(val).toString()).toString()
}

const hashFnFast = (val) => { 
	return val
}

const hashPassword = (password) => { //old deprecated
	return sha512(sha384(sha256(sha1(password)))) + sha512(md5(md4(md2(password))))
}

const showPage = (page) => {
	$(".content").each(function(){
		if($(this).attr("data-type") == page){
			$(this).show()
		}
		else{
			$(this).hide()
		}
	})
}

const routeTo = async (route) => {
	let loggedIn = false

	try{
		loggedIn = await isLoggedIn()
	}
	catch(e){
		console.log(e)
	}

	if(route !== "login" && !loggedIn){
		route = "login"
	}

	if(route == "login" || route == "big-loading" || route == "download-folder"){
		$(".header").hide()
		$(".footer").hide()
	}
	else{
		$(".header").show()
		$(".footer").show()
	}

	if(route == "login"){
		if(!is.linux()){
			ipcRenderer.send("open-window-login")
		}

		$("#login-status").hide()
	}

	return showPage(route)
}

const socketAuth = async () => {
	let apiKey = await getUserAPIKey()

	socket.emit("auth", {
		apiKey
	})

	clearInterval(socketHeartbeatInterval)

	socketHeartbeatInterval = setInterval(() => {
		socket.emit("heartbeat")
	}, 5000)
}

const openSyncFolder = async () => {
	if(typeof userSyncDir == "undefined"){
		return false
	}

	try{
		await shell.openPath(winOrUnixFilePath(userSyncDir))
	}
	catch(e){
		console.log(e)

		return false
	}

	//dontHideOnBlur = true

	return true
}

const initSocket = () => {
	if(typeof socket !== "undefined"){
		return false
	}

	if(socketReady){
		return false
	}

	socket = socketIO("https://socket.filen.io", {
		path: "",
		reconnect: true,
		transports: [
			"websocket"
		]
	})

	socket.on("connect", () => {
		console.log("Connected to socket")

		if(isLoggedIn()){
			socketAuth()
		}

		return socketReady = true
	})

	socket.on("disconnect", () => {
		console.log("Disconnected from socket")

		return socketReady = false
	})

	socket.on("fm-to-sync-client-message", async (data) => {
		if(idleTimeSeconds >= 60){
			return false
		}

		let userMasterKeys = await getUserMasterKeys()

		userMasterKeys = userMasterKeys.reverse()

		let args = undefined

		for(let i = 0; i < userMasterKeys.length; i++){
			try{
				let obj = JSON.parse(await decryptMetadata(data.args, userMasterKeys[i]))

				if(obj && typeof obj == "object"){
					args = obj

					break
				}
			}
			catch(e){
				continue
			}
		}

		if(typeof args == "undefined"){
			return false
		}

		if(args.type == "download-folder"){
			let folderUUID = args.uuid

			if(isCurrentlyDownloadigRemote){
				return false
			}

			isCurrentlyDownloadigRemote = true

			currentDownloadFolderUUID = folderUUID
			currentDownloadFolderIsShared = args.shared
			currentDownloadFolderIsLink = args.linked
			currentDownloadFolderLinkUUID = args.linkUUID
			currentDownloadFolderLinkKey = args.linkKey
			currentDownloadFolderLinkPassword = args.linkPassword
			currentDownloadFolderName = args.name

			if(typeof lastDownloadFolderPath == "undefined"){
				$("#download-folder-path-text").val(userDownloadPath)
			}
			else{
				$("#download-folder-path-text").val(lastDownloadFolderPath)
			}

			clearInterval(downloadFolderDoneInterval)

			$("#download-folder-change-path-btn").prop("disabled", false)
			$("#download-folder-btn-container").show()
			$("#download-folder-progress-container").hide()
			$("#download-folder-progress-text-container").hide()
			$("#download-folder-progress-bytes-text").html("")
			$("#download-folder-progress-percent-text").html("")
			$("#download-folder-progress").css("width", "0%")
			$("#download-folder-progress").attr("aria-valuenow", "0")
			$("#download-folder-foldername-text").html(currentDownloadFolderName)

			routeTo("download-folder")

			ipcRenderer.send("open-window")
		}

		return true
	})

	socket.on("new-event", (data) => {
		if(data.type == "passwordChanged"){
			return doLogout()
		}
	})
}

const getDownloadFolderContents = async (folderUUID, callback) => {
	try{
		var userMasterKeys = await getUserMasterKeys()
	}
	catch(e){
		return callback(e)
	}

	let userPrivateKey = undefined
	let usrPrivKey = undefined

	if(currentDownloadFolderIsShared){
		try{
			userPrivateKey = await db.get("userPrivateKey")

			usrPrivKey = await window.crypto.subtle.importKey("pkcs8", _base64ToArrayBuffer(userPrivateKey), {
	        	name: "RSA-OAEP",
	        	hash: "SHA-512"
	      	}, true, ["decrypt"])
		}
		catch(e){
			return callback(e)
		}
	}

	let url = "/v1/download/dir"
	let data = {
		apiKey: await getUserAPIKey(),
		uuid: folderUUID
	}

	if(currentDownloadFolderIsShared){
		url = "/v1/download/dir/shared"
		data = {
			apiKey: await getUserAPIKey(),
			uuid: folderUUID
		}
	}

	if(currentDownloadFolderIsLink){
		url = "/v1/download/dir/link"
		data = {
			uuid: currentDownloadFolderLinkUUID,
			parent: folderUUID,
			password: (currentDownloadFolderLinkPassword.length < 32 ? hashFn(currentDownloadFolderLinkPassword) : currentDownloadFolderLinkPassword) //if under 32 chars, old deprecated, if over -> pbkdf2
		}
	}

	apiRequest(url, data, async (err, res) => {
		if(err){
			return callback(err)
		}

		if(!res.status){
			return callback(res.message)
		}

		let paths = []
		let folders = {}
		let pathsForFiles = {}
		let filePaths = []
		let files = {}
		let folderPaths = {}
		let folderNamesExisting = {}
		let fileNamesExisting = {}

		let basePath = ""

		if(currentDownloadFolderIsShared){
			if(res.data.folders[0].name == "default"){
				basePath = "Default"
			}
			else{
				try{
					let decrypted = await window.crypto.subtle.decrypt({
						name: "RSA-OAEP"
					}, usrPrivKey, _base64ToArrayBuffer(res.data.folders[0].name))
	
					basePath = JSON.parse(new TextDecoder().decode(decrypted)).name
				}
				catch(e){
					return callback(e)
				}
			}
		}
		else if(currentDownloadFolderIsLink){
			basePath = await decryptFolderNameLink(res.data.folders[0].name, currentDownloadFolderLinkKey)
		}
		else{
			basePath = await decryptFolderMetadata(res.data.folders[0].name, userMasterKeys, res.data.folders[0].uuid)
		}

		if(basePath.length == 0){
			return callback(new Error("Base path folder name cant decrypt")) 
		}

		basePath = cleanString(basePath)

		paths.push(basePath + "/")

		pathsForFiles[res.data.folders[0].uuid] = basePath + "/"

		folderPaths[basePath + "/"] = {
			uuid: res.data.folders[0].uuid,
			name: basePath,
			parent: "base"
		}

		folders[res.data.folders[0].uuid] = {
			uuid: res.data.folders[0].uuid,
			name: basePath,
			parent: "base"
		}

		const getPathRecursively = (uuid) => {
			if(typeof folders[uuid] == "undefined"){
				return undefined
			}

			let thisPath = []

			const build = (parentUUID) => {
				if(typeof folders[parentUUID] == "undefined"){
					return undefined
				}

				if(folders[parentUUID].parent == "base"){
					return basePath + "/" + thisPath.reverse().join("/")  + "/"
				}

				thisPath.push(folders[parentUUID].name)

				return build(folders[parentUUID].parent)
			}

			if(folders[uuid].parent == "base"){
				return ""
			}

			thisPath.push(folders[uuid].name)

			return build(folders[uuid].parent)
		}
		
		for(let i = 0; i < res.data.folders.length; i++){
			let self = res.data.folders[i]
			let selfName = ""

			if(currentDownloadFolderIsShared){
				if(self.name == "default"){
					selfName = "Default"
				}
				else{
					try{
						let decrypted = await window.crypto.subtle.decrypt({
							name: "RSA-OAEP"
						}, usrPrivKey, _base64ToArrayBuffer(self.name))
	
						selfName = JSON.parse(new TextDecoder().decode(decrypted)).name
					}
					catch(e){
						return callback(e)
					}
				}
			}
			else if(currentDownloadFolderIsLink){
				selfName = await decryptFolderNameLink(self.name, currentDownloadFolderLinkKey)
			}
			else{
				selfName = await decryptFolderMetadata(self.name, userMasterKeys, self.uuid)
			}

			selfName = cleanString(selfName)

			if(selfName.length > 0){
				if(self.parent !== "base"){
					let parent = folders[res.data.folders[i].parent]

					if(typeof parent !== "undefined"){
						if(typeof folderNamesExisting[self.parent + "_" + selfName.toLowerCase()] == "undefined"){
							folderNamesExisting[self.parent + "_" + selfName.toLowerCase()] = true

							folders[self.uuid] = {
								uuid: self.uuid,
								name: selfName,
								parent: self.parent
							}
						}
					}
				}
			}
		}

		for(let i = 0; i < res.data.folders.length; i++){
			let self = res.data.folders[i]

			if(self.parent !== "base"){
				if(typeof folders[self.uuid] !== "undefined"){
					let newPath = getPathRecursively(self.uuid)
				
					if(typeof newPath !== "undefined"){
						pathsForFiles[self.uuid] = newPath
						folderPaths[newPath] = folders[self.uuid]
					}
				}
			}
		}

		for(let i = 0; i < res.data.files.length; i++){
			let self = res.data.files[i]

			if(pathsForFiles[self.parent] !== "undefined"){
				let metadata = undefined

				if(currentDownloadFolderIsShared){
					try{
						let decrypted = await window.crypto.subtle.decrypt({
				      		name: "RSA-OAEP"
				    	}, usrPrivKey, _base64ToArrayBuffer(self.metadata))

				    	decrypted = JSON.parse(new TextDecoder().decode(decrypted))

				    	if(decrypted && typeof decrypted == "object"){
							metadata = {
								name: decrypted.name,
								size: parseInt(decrypted.size),
								mime: decrypted.mime,
								key: decrypted.key
							}
				    	}
					}
					catch(e){
						console.log(e)
					}
				}
				else if(currentDownloadFolderIsLink){
					metadata = await decryptFileMetadataLink(self.metadata, currentDownloadFolderLinkKey)
				}
				else{
					metadata = await decryptFileMetadata(self.metadata, userMasterKeys, self.uuid)
				}

				metadata.name = cleanString(metadata.name)
				metadata.key = cleanString(metadata.key)
				metadata.mime = cleanString(metadata.mime)
				metadata.size = parseInt(cleanString(metadata.size))

				if(metadata.name.length > 0){
					let newPath = pathsForFiles[self.parent] + metadata.name

					if(typeof newPath !== "undefined" && metadata.size > 0){
						if(typeof fileNamesExisting[self.parent + "_" + metadata.name.toLowerCase()] == "undefined"){
							fileNamesExisting[self.parent + "_" + metadata.name.toLowerCase()] = true

							files[newPath] = {
								uuid: self.uuid,
								region: self.region,
								bucket: self.bucket,
								chunks: self.chunks,
								name: metadata.name,
								size: metadata.size,
								mime: metadata.mime,
								key: metadata.key,
								parent: self.parent,
								version: self.version
							}
						}
					}
				}
			}
		}

		return callback(null, folderPaths, files)
	})
}

const startDownloadFolder = () => {
	let downloadPath = $("#download-folder-path-text").val()

	if(downloadPath.length <= 1){
		return false
	}

	if(!isCurrentlyDownloadigRemote){
		return false
	}

	if(typeof currentDownloadFolderUUID == "undefined"){
		return false
	}

	if(downloadPath.slice(-1) == "/"){
		downloadPath.substring(0, downloadPath.length - 1)
	}

	$("#download-folder-btn").html('<i class="fas fa-spinner fa-spin"></i>')
	$("#download-folder-btn").prop("disabled", true)
	$("#download-folder-change-path-btn").prop("disabled", true)
	$("#download-folder-progress").attr("aria-valuenow", "0")
	$("#download-folder-progress").css("width", "0%")

	try{
		fs.accessSync(winOrUnixFilePath(downloadPath), fs.constants.R_OK | fs.constants.W_OK)
	}
	catch(e){
		showBigErrorMessage("No permissions to read/write download directory. Please change permissions or download path.")

		throw new Error(e)
	}

	rimraf(winOrUnixFilePath(downloadPath + "/" + currentDownloadFolderName), () => {
		lastDownloadFolderPath = downloadPath
		currentDownloadFolderLoaded[currentDownloadFolderUUID] = 0
		currentDownloadFolderStopped[currentDownloadFolderUUID] = false

		getDownloadFolderContents(currentDownloadFolderUUID, async (err, folders, files) => {
			if(err){
				$("#download-folder-btn-container").show()
				$("#download-folder-change-path-btn").prop("disabled", false)
				$("#download-folder-btn").html("Download")
				$("#download-folder-btn").prop("disabled", false)
				$("#download-folder-change-path-btn").prop("disabled", false)

				return console.log(err)
			}

			$("#download-folder-btn-container").hide()
			$("#download-folder-btn").html("Download")
			$("#download-folder-btn").prop("disabled", false)

			let foldersCreated = 0

			for(let prop in folders){
				let path = downloadPath + "/" + prop

				try{
					let res = await fs.mkdir(winOrUnixFilePath(path), {
						recursive: true,
						overwrite: true
					})

					foldersCreated += 1
				}
				catch(e){
					console.log(e)
				}
			}

			if(foldersCreated == Object.keys(folders).length){
				console.log("all folders created, downloading files now..")

				let totalFolderSize = 0
				let totalFiles = Object.keys(files).length
				let downloadedFiles = 0

				for(let prop in files){
					totalFolderSize += files[prop].size
				}

				if(totalFolderSize >= diskSpaceFree){
					return console.log("NO SPACE AVAILABLE")
				}

				downloadFolderDoneInterval = setInterval(() => {
					let percentDone = ((currentDownloadFolderLoaded[currentDownloadFolderUUID] / totalFolderSize) * 100).toFixed(2)

					$("#download-folder-progress-text-container").show()
					$("#download-folder-change-path-btn").prop("disabled", true)
					$("#download-folder-progress-container").show()
					$("#download-folder-progress").attr("aria-valuenow", percentDone)
					$("#download-folder-progress").css("width", percentDone + "%")

					let doneBytes = currentDownloadFolderLoaded[currentDownloadFolderUUID]

					if(doneBytes >= totalFolderSize){
						doneBytes = totalFolderSize
					}

					$("#download-folder-progress-bytes-text").html(formatBytes(doneBytes) + "/" + formatBytes(totalFolderSize))
					$("#download-folder-progress-percent-text").html(percentDone + "%")

					if(percentDone >= 100 || downloadedFiles >= totalFiles){
						if(downloadedFiles >= totalFiles){
							clearInterval(downloadFolderDoneInterval)

							$("#download-folder-progress-percent-text").html("Done")

							isCurrentlyDownloadigRemote = false
							//currentDownloadFolderStopped[currentDownloadFolderUUID] = true
						}
						else{
							$("#download-folder-progress-percent-text").html("<i class='fa fa-spinner fa-spin'></i>&nbsp;&nbsp;Writing to disk..")
						}
					}
				}, 100)

				for(let prop in files){
					let path = downloadPath + "/" + prop

					downloadFileToLocal(winOrUnixFilePath(path), files[prop], false, (err) => {
						if(err){
							console.log(err)
						}
						else{
							//isCurrentlyDownloadigRemote = false
							//currentDownloadFolderStopped[currentDownloadFolderUUID] = true

							downloadedFiles += 1
						}
					})
				}
			}
			else{
				$("#download-folder-btn-container").show()
				$("#download-folder-change-path-btn").prop("disabled", false)
			}
		})
	})
}

const changeDownloadFolderPath = () => {
	dontHideOnBlur = true

	return ipcRenderer.send("change-download-folder-path")
}

const initIPC = () => {
	ipcRenderer.on("show-syncs", (e, data) => {
		return routeTo("syncs")
	})

	ipcRenderer.on("update-available", (e, data) => {
		return $("#settings-update-container").show()
	})

	ipcRenderer.on("app-version", (e, data) => {
		currentAppVersion = data.version

		return $("#settings-client-version-text").html(data.version)
	})

	ipcRenderer.on("user-dirs", (e, data) => {
		userSyncDir = data.userSyncDir
		userHomePath = data.userHomePath
		appPath = data.appPath
		userDownloadPath = data.userDownloadPath

		$("#settings-home-path-text").val(winOrUnixFilePath(userSyncDir))

		return true
	})

	ipcRenderer.on("autostart-enabled-res", (e, data) => {
		if(data.autostartEnabled){
			$("#enable-autostart-toggle").prop("checked", true)
		}
		else{
			$("#enable-autostart-toggle").prop("checked", false)
		}

		return true
	})

	ipcRenderer.on("change-download-folder-path-res", (e, data) => {
		return $("#download-folder-path-text").val(winOrUnixFilePath(data.path))
	})

	ipcRenderer.on("clear-db", async (e, data) => {
		try{
			let userEmail = await db.get("userEmail")

			await db.put(userEmail + "_localFileModifications", JSON.stringify({}))
			await db.put(userEmail + "_remoteFileUUIDs", JSON.stringify({}))
			await db.put(userEmail + "_remoteFileSizes", JSON.stringify({}))

			await db.put(userEmail + "_lastRemoteSyncFolders", JSON.stringify({}))
			await db.put(userEmail + "_lastRemoteSyncFiles", JSON.stringify({}))
			await db.put(userEmail + "_lastLocalSyncFolders", JSON.stringify({}))
			await db.put(userEmail + "_lastLocalSyncFiles", JSON.stringify({}))

			await db.put(userEmail + "_localFileExisted", JSON.stringify({}))
			await db.put(userEmail + "_localFolderExisted", JSON.stringify({}))

			await db.put(userEmail + "_remoteDecryptedCache", JSON.stringify({}))
		}
		catch(e){
			console.log(e)
		}

		localFileModifications = {}
		remoteFileUUIDs = {}
		remoteFileSizes = {}

		lastRemoteSyncFolders = {}
		lastRemoteSyncFiles = {}
		lastLocalSyncFolders = {}
		lastLocalSyncFiles = {}

		localFileExisted = {}
		localFolderExisted = {}

		remoteDecryptedCache = {}
	})
	
	ipcRenderer.on("open-download-folder-screen", (e, data) => {
		routeTo("download-folder")

	 	return ipcRenderer.send("download-folder-screen-opened")
	})

	ipcRenderer.on("open-sync-folder", (e, data) => {
		userSyncDir = data.userSyncDir
		userHomePath = data.userHomePath
		appPath = data.appPath
		userDownloadPath = data.userDownloadPath

		try{
			shell.openPath(winOrUnixFilePath(userSyncDir)).catch((err) => {
				console.log(err)
			})
		}
		catch(e){
			console.log(e)
		}

		return true
	})

	ipcRenderer.on("user-dirs", (e, data) => {
		userSyncDir = data.userSyncDir
		userHomePath = data.userHomePath
		appPath = data.appPath
		userDownloadPath = data.userDownloadPath

		return true
	})

	ipcRenderer.on("app-platform", (e, data) => {
		return appPlatform = data.appPlatform
	})

	ipcRenderer.on("pause-syncing", (e, data) => {
		return syncingPaused = true
	})

	ipcRenderer.on("unpause-syncing", (e, data) => {
		return syncingPaused = false
	})

	ipcRenderer.on("show-big-loading", (e, data) => {
		return routeTo("big-loading")
	})

	ipcRenderer.on("idle-time", (e, data) => {
		return idleTimeSeconds = data.seconds
	})

	ipcRenderer.on("rewrite-saved-sync-data", async (e, data) => {
		let waitForSyncingDoneInterval = setInterval(async () => {
			if(!isSyncing){
				syncingPaused = true

				clearInterval(waitForSyncingDoneInterval)

				let localFileModificationsNew = {}
				let remoteFileUUIDsNew = {}
				let remoteFileSizesNew = {}
				let localFileModificationsCurrent = undefined
				let remoteFileUUIDsCurrent = undefined
				let remoteFileSizesCurrent = undefined

				let lastRemoteSyncFoldersNew = {}
				let lastRemoteSyncFilesNew = {}
				let lastLocalSyncFoldersNew = {}
				let lastLocalSyncFilesNew = {}
				let lastRemoteSyncFoldersCurrent = undefined
				let lastRemoteSyncFilesCurrent = undefined
				let lastLocalSyncFoldersCurrent = undefined
				let lastLocalSyncFilesCurrent = undefined

				let localFileExistedNew = {}
				let localFolderExistedNew = {}
				let localFileExistedCurrent = undefined
				let localFolderExistedCurrent = undefined

				localFileModificationsCurrent = localFileModifications
				remoteFileUUIDsCurrent = remoteFileUUIDs
				remoteFileSizesCurrent = remoteFileSizes

				lastRemoteSyncFoldersCurrent = lastRemoteSyncFolders
				lastRemoteSyncFilesCurrent = lastRemoteSyncFiles
				lastLocalSyncFoldersCurrent = lastLocalSyncFolders
				lastLocalSyncFilesCurrent = lastLocalSyncFiles

				localFileExistedCurrent = localFileExisted
				localFolderExistedCurrent = localFolderExisted

				for(let prop in localFileModificationsCurrent){
					localFileModificationsNew[prop.split(data.lastUserHomePath).join(data.newUserHomePath)] = ((+new Date()) + 60000) //localFileModificationsCurrent[prop]
				}

				for(let prop in remoteFileUUIDsCurrent){
					remoteFileUUIDsNew[prop.split(data.lastUserHomePath).join(data.newUserHomePath)] = remoteFileUUIDsCurrent[prop]
				}

				for(let prop in remoteFileSizesCurrent){
					remoteFileSizesNew[prop.split(data.lastUserHomePath).join(data.newUserHomePath)] = remoteFileSizesCurrent[prop]
				}

				for(let prop in lastRemoteSyncFoldersCurrent){
					lastRemoteSyncFoldersNew[prop.split(data.lastUserHomePath).join(data.newUserHomePath)] = lastRemoteSyncFoldersCurrent[prop]
				}

				for(let prop in lastRemoteSyncFilesCurrent){
					lastRemoteSyncFilesNew[prop.split(data.lastUserHomePath).join(data.newUserHomePath)] = lastRemoteSyncFilesCurrent[prop]
				}

				for(let prop in lastLocalSyncFoldersCurrent){
					lastLocalSyncFoldersNew[prop.split(data.lastUserHomePath).join(data.newUserHomePath)] = lastLocalSyncFoldersCurrent[prop]
				}

				for(let prop in lastLocalSyncFilesCurrent){
					lastLocalSyncFilesNew[prop.split(data.lastUserHomePath).join(data.newUserHomePath)] = lastLocalSyncFilesCurrent[prop]
				}

				for(let prop in localFileExistedCurrent){
					localFileExistedNew[prop.split(data.lastUserHomePath).join(data.newUserHomePath)] = localFileExistedCurrent[prop]
				}

				for(let prop in localFolderExistedCurrent){
					localFolderExistedNew[prop.split(data.lastUserHomePath).join(data.newUserHomePath)] = localFolderExistedCurrent[prop]
				}

				try{
					let userEmail = await db.get("userEmail")

					await db.put(userEmail + "_localFileModifications", JSON.stringify(localFileModificationsNew))
					await db.put(userEmail + "_remoteFileUUIDs", JSON.stringify(remoteFileUUIDsNew))
					await db.put(userEmail + "_remoteFileSizes", JSON.stringify(remoteFileSizesNew))

					await db.put(userEmail + "_lastRemoteSyncFolders", JSON.stringify(lastRemoteSyncFoldersNew))
					await db.put(userEmail + "_lastRemoteSyncFiles", JSON.stringify(lastRemoteSyncFilesNew))
					await db.put(userEmail + "_lastLocalSyncFolders", JSON.stringify(lastLocalSyncFoldersNew))
					await db.put(userEmail + "_lastLocalSyncFiles", JSON.stringify(lastLocalSyncFilesNew))

					await db.put(userEmail + "_localFileExisted", JSON.stringify(localFileExistedNew))
					await db.put(userEmail + "_localFolderExisted", JSON.stringify(localFolderExistedNew))
				}
				catch(e){
					return console.log(e)
				}

				return setTimeout(() => {
					ipcRenderer.send("rewrite-saved-sync-data-done")
				}, 1000)
			}
		}, 50)
	})
}

const openLinkInBrowser = (url) => {
	try{
    	shell.openExternal(url).catch((err) => {
			if(err){
				console.log(err)
			}
		})
    }
    catch(e){
    	console.log(e)

    	return false
    }

    return true
}

const initFns = () => {
	$(".open-in-browser").click((e) => {
        e.preventDefault()

        return openLinkInBrowser(e.target.href)
   	})

   	$(".header-col").each(function(){
   		if(typeof $(this).attr("data-go") !== "undefined"){
   			$(this).click(() => {
	   			routeTo($(this).attr("data-go"))
	   		})
   		}
   	})

   	$("#sync-mode-select").on("change", async () => {
   		let mode = $("#sync-mode-select").val()

   		try{
   			await db.put("syncMode", mode)

   			syncMode = mode

   			localDataChanged = true
   			skipNextRequestData = true
   			reloadAll = true
   		}
   		catch(e){
   			return console.log(e)
   		}

   		return true
   	})

   	$("#login-btn").click(() => {
   		let email = $("#login-email-input").val()
   		let password = $("#login-password-input").val()
   		let twoFactorKey = $("#login-2fa-input").val()

   		if(twoFactorKey.length == 0){
   			twoFactorKey = "XXXXXX"
   		}

   		apiRequest("/v1/auth/info", {
   			email
   		}, async (err, res) => {
	   		$("#login-2fa-input").val("")

   			if(err){
   				$("#login-password-input").val("")

   				$("#login-status").html(`
   					<br>
   					<font color="darkred">
   						Request error, please try again later.
   					</font>
   				`).show()

   				return console.log(err)
   			}

   			if(!res.status){
   				if(res.message == "Please enter your Two Factor Authentication code."){
   					$("#login-2fa-container").show()
   				}
   				else if(res.message == "Invalid Two Factor Authentication code."){
   					$("#login-2fa-container").show()
   				}
   				else{
   					$("#login-password-input").val("")
   				}

   				$("#login-status").html(`
   					<br>
   					<font color="darkred">
   						` + res.message + `
   					</font>
   				`).show()

				return console.log(res.message)
			}

			let authVersion = res.data.authVersion
			let salt = res.data.salt

			let passwordToSend = undefined
			let mKey = undefined

			if(authVersion == 1){
				passwordToSend = hashPassword(password)
				mKey = hashFn(password)
			}
			else if(authVersion == 2){
				try{
					let derivedKey = await deriveKeyFromPassword(password, salt, 200000, "SHA-512", 512) //PBKDF2, 200.000 iterations, sha-512, 512 bit key, first half (from left) = master key, second half = auth key

					mKey = derivedKey.substring(0, (derivedKey.length / 2))
			  		passwordToSend = derivedKey.substring((derivedKey.length / 2), derivedKey.length)
			  		passwordToSend = CryptoJS.SHA512(passwordToSend).toString()
				}
				catch(e){
					$("#login-password-input").val("")

	   				$("#login-status").html(`
	   					<br>
	   					<font color="darkred">
	   						Password derivation error.
	   					</font>
	   				`).show()

	   				return console.log(e)
				}
			}

			apiRequest("/v1/login", {
	   			email,
	   			password: passwordToSend,
	   			twoFactorKey,
	   			authVersion
	   		}, async (err, res) => {
		   		$("#login-2fa-input").val("")

	   			if(err){
	   				$("#login-password-input").val("")

	   				$("#login-status").html(`
	   					<br>
	   					<font color="darkred">
	   						Request error, please try again later.
	   					</font>
	   				`).show()

	   				return console.log(err)
	   			}

	   			if(!res.status){
	   				if(res.message == "Please enter your Two Factor Authentication code."){
	   					$("#login-2fa-container").show()
	   				}
	   				else if(res.message == "Invalid Two Factor Authentication code."){
	   					$("#login-2fa-container").show()
	   				}
	   				else{
	   					$("#login-password-input").val("")
	   				}

	   				$("#login-status").html(`
	   					<br>
	   					<font color="darkred">
	   						` + res.message + `
	   					</font>
	   				`).show()

					return console.log(res.message)
				}

				$("#login-email-input").val("")
				$("#login-password-input").val("")

				if(mKey.length < 16){
					$("#login-status").html(`
	   					<br>
	   					<font color="darkred">
	   						Invalid master key.
	   					</font>
	   				`).show()

					return console.log("Invalid master key.")
				}

				try{
					await db.put("isLoggedIn", "true")
					await db.put("userEmail", email)
					await db.put("userAPIKey", res.data.apiKey)
					await db.put("userMasterKeys", mKey)
					await db.put("userAuthVersion", authVersion)
				}
				catch(e){
					$("#login-status").html(`
	   					<br>
	   					<font color="darkred">
	   						Local DB error, please try again.
	   					</font>
	   				`).show()

					return console.log(e)
				}

				$("#login-status").html(`
					<br>
					<font color="darkgreen">
						Login successful, please wait..
					</font>
				`).show()

				console.log(res.message)

				routeTo("big-loading")

				doSetup((err) => {
					if(err){
						$("#login-status").html(`
		   					<br>
		   					<font color="darkred">
		   						Setup error, please try again.
		   					</font>
		   				`).show()

						return console.log(err)
					}

					return routeTo("syncs")
				})
	   		})
   		})
   	})
}

const getUserAPIKey = async () => {
	try{
		var res = await db.get("userAPIKey")
	}
	catch(e){
		console.log(e)

		return ""
	}

	return res
}

const getSyncFolderUUID = async () => {
	try{
		var res = await db.get("syncFolderUUID")
	}
	catch(e){
		console.log(e)

		return ""
	}

	return res
}

const getUserMasterKeys = async () => {
	try{
		var res = await db.get("userMasterKeys")
	}
	catch(e){
		console.log(e)

		return []
	}

	return res.split("|")
}

const isSetupDone = async () => {
	try{
		var res = await db.get("isSetupDone")
	}
	catch(e){
		return false
	}

	if(res !== "true"){
		return false
	}
	
	return true
}

const isLoggedIn = async () => {
	try{
		var res = await db.get("isLoggedIn")
	}
	catch(e){
		return false
	}

	if(res !== "true"){
		return false
	}
	
	return true
}

const getUserUsage = async () => {
	let loggedIn = false

	try{
		loggedIn = await isLoggedIn()
	}
	catch(e){
		return console.log(e)
	}

	if(!loggedIn){
		return false
	}

	const getUsage = async () => {
		apiRequest("/v1/user/usage", {
			apiKey: await getUserAPIKey()
		}, (err, res) => {
			if(err){
				return console.log(err)
			}

			if(!res.status){
				if(res.message.toLowerCase().indexOf("api key not found") !== -1){
					return doLogout()
				}

				return console.log(res.message)
			}

			savedUserUsage.max = res.data.max
			savedUserUsage.storage = res.data.storage
			savedUserUsage.uploads = res.data.uploads

			let storageUsedPercent = ((res.data.storage / res.data.max) * 100).toFixed(2)

			$("#account-storage-used-progress").attr("width", storageUsedPercent + "%")
			$("#account-storage-used-progress").css("width", storageUsedPercent + "%")
			$("#account-storage-used-text").html(formatBytes(res.data.storage) + " of " + formatBytes(res.data.max) + " used (" + storageUsedPercent + "%)")
		})
	}

	setInterval(getUsage, 15000)
}

const checkIfSyncFolderExistsRemote = async (callback) => {
	let loggedIn = false

	try{
		loggedIn = await isLoggedIn()
	}
	catch(e){
		return console.log(e)
	}

	if(!loggedIn){
		return false
	}

	apiRequest("/v1/user/dirs", {
		apiKey: await getUserAPIKey()
	}, (err, res) => {
		if(err){
			return callback(err)
		}

		if(!res.status){
			if(res.message.toLowerCase().indexOf("api key not found") !== -1){
				callback(res.message)

				return doLogout()
			}

			if(res.message.toLowerCase() == "no folders found."){
				return callback(null, false)
			}
			else{
				return callback(res.message)
			}
		}

		for(let i = 0; i < res.data.length; i++){
			if(res.data[i].sync){
				return callback(null, true, res.data[i].uuid)
			}
		}

		return callback(null, false)
	})
}

const toggleAutostart = () => {
	return ipcRenderer.send("toggle-autostart")
}

const changeHomePath = () => {
	if((currentSyncTasks.length + currentSyncTasksExtra.length) > 0){
		return false
	}

	dontHideOnBlur = true
	syncingPaused = true

	return ipcRenderer.send("open-path-selection")
}

const downloadUpdateLink = () => {
	let href = ""

	if(process.platform == "linux"){
		href = "https://cdn.filen.io/sync/updates/filen-setup.AppImage"
	}
	else if(process.platform == "darwin"){
		href = "https://cdn.filen.io/sync/updates/filen-setup.dmg"
	}
	else{
		href = "https://cdn.filen.io/sync/updates/filen-setup.exe"
	}

	try{
    	shell.openExternal(href).catch((err) => {
			if(err){
				console.log(err)
			}
		})
    }
    catch(e){
    	console.log(e)
    }

    return true
}

const restartForUpdate = () => {
	return ipcRenderer.send("restart-for-update")
}

const renderSyncTask = (task, prepend = true) => {
	let taskName = ""
	let isFile = true

	if(task.where == "remote" && task.task == "upload"){
		taskName = '<i class="fas fa-cloud"></i>&nbsp;&nbsp;&nbsp;<i class="fas fa-arrow-up"></i>'
	}
	else if(task.where == "remote" && task.task == "rmdir"){
		taskName = '<i class="fas fa-cloud"></i>&nbsp;&nbsp;&nbsp;<i class="fas fa-trash"></i>'
		isFile = false
	}
	else if(task.where == "remote" && task.task == "rmfile"){
		taskName = '<i class="fas fa-cloud"></i>&nbsp;&nbsp;&nbsp;<i class="fas fa-trash"></i>'
	}
	else if(task.where == "remote" && task.task == "mkdir"){
		taskName = '<i class="fas fa-cloud"></i>&nbsp;&nbsp;&nbsp;<i class="fas fa-arrow-up"></i>'
		isFile = false
	}
	else if(task.where == "remote" && task.task == "update"){
		taskName = '<i class="fas fa-cloud"></i>&nbsp;&nbsp;&nbsp;<i class="fas fa-arrow-up"></i>'
	}
	else if(task.where == "local" && task.task == "download"){
		taskName = '<i class="fas fa-desktop"></i>&nbsp;&nbsp;&nbsp;<i class="fas fa-arrow-down"></i>'
	}
	else if(task.where == "local" && task.task == "rmdir"){
		taskName = '<i class="fas fa-desktop"></i>&nbsp;&nbsp;&nbsp;<i class="fas fa-trash"></i>'
		isFile = false
	}
	else if(task.where == "local" && task.task == "rmfile"){
		taskName = '<i class="fas fa-desktop"></i>&nbsp;&nbsp;&nbsp;<i class="fas fa-trash"></i>'
	}
	else if(task.where == "local" && task.task == "mkdir"){
		taskName = '<i class="fas fa-desktop"></i>&nbsp;&nbsp;&nbsp;<i class="fas fa-arrow-down"></i>'
		isFile = false
	}
	else if(task.where == "local" && task.task == "update"){
		taskName = '<i class="fas fa-desktop"></i>&nbsp;&nbsp;&nbsp;<i class="fas fa-arrow-down"></i>'
	}

	let fileNameEx = JSON.parse(task.taskInfo).path.split("/")
	let fileName = fileNameEx[fileNameEx.length - 1]

	if(fileName.length <= 0){
		fileName = fileNameEx[fileNameEx.length - 2]
	}

	let taskHTML = `
		<div>
			<div class="overflow-ellipsis" style="width: 8%; float: left;">
	    		` + (isFile ? `<i class="fas fa-file"></i>` : `<i class="fas fa-folder" style="color: #F6C358;"></i>`) + `
	        </div>
	        <div class="overflow-ellipsis" style="width: 72%; float: left; padding-right: 25px;">
	            ` + fileName + `
	        </div>
	        <div class="overflow-ellipsis" style="width: 20%; float: left; padding-left: 4px;">
	            ` + taskName + `
	        </div>
		</div>
	`

	if(prepend){
		$("#sync-task-tbody").prepend(taskHTML)
	}
	else{
		$("#sync-task-tbody").append(taskHTML)
	}

	if($("#sync-task-tbody").children().length >= 250){
		$("#sync-task-tbody").children().last().remove()
	}

	$("#no-syncs").hide()
	$("#sync-task-loader-container").hide()

	return true
}

const fillSyncTasks = async () => {
	let syncTasksData = undefined

	try{
		let userEmail = await db.get("userEmail")

		syncTasksData = JSON.parse(await db.get(userEmail + "_finishedSyncTasks"))
	}
	catch(e){
		syncTasksData = undefined
	}

	$("#no-syncs").hide()

	if(typeof syncTasksData !== "undefined"){
		syncTasksData = syncTasksData.reverse()

		lastSyncTasksData = syncTasksData

		if(syncTasksData.length > 0){
			$("#sync-task-tbody").html("")
			$("#no-syncs").hide()

			for(let i = 0; i < syncTasksData.length; i++){
				renderSyncTask(syncTasksData[i], false)
			}
		}
		else{
			$("#no-syncs").show()
		}
	}
	else{
		$("#no-syncs").show()
	}

	$("#sync-task-loader-container").hide()
}

const fillContent = async (callback) => {
	let userEmail = undefined

	try{
		userEmail = await db.get("userEmail")
	}
	catch(e){
		return console.log(e)
	}

	apiRequest("/v1/user/sync/get/data", {
		apiKey: await getUserAPIKey()
	}, (err, res) => {
		if(err){
			if(typeof callback == "function"){
				return callback(err)
			}
			else{
				return console.log(err)
			}
		}

		if(!res.status){
			if(res.message.toLowerCase().indexOf("api key not found") !== -1){
				if(typeof callback == "function"){
					callback(res.message)
				}

				return doLogout()
			}

			if(typeof callback == "function"){
				return callback(res.message)
			}
			else{
				return console.log(res.message)
			}
		}

		$("#account-email-text").html(res.data.email)

		let storageUsedPercent = ((res.data.storageUsed / res.data.maxStorage) * 100).toFixed(2)

		$("#account-storage-used-progress").attr("width", storageUsedPercent + "%")
		$("#account-storage-used-progress").css("width", storageUsedPercent + "%")
		$("#account-storage-used-text").html(formatBytes(res.data.storageUsed) + " of " + formatBytes(res.data.maxStorage) + " used (" + storageUsedPercent + "%)")

		if(res.data.isPremium == 1){
			$("#account-pro-button-container").hide()
		}
		else{
			$("#account-pro-button-container").show()
		}

		fillSyncTasks()

		if(typeof callback == "function"){
			return callback(null)
		}
		else{
			return true
		}
	})
}

const doSetup = async (callback) => {
	const setupDone = () => {
		initSocket()

		updateUserKeys((err) => {
			if(err){
				if(typeof callback == "function"){
					return callback(err)
				}

				return console.log(err)
			}

			getUserUsage()

			syncingPaused = false
			localDataChanged = true
   			skipNextRequestData = true
   			reloadAll = true

			fillContent((err) => {
				if(err){
					if(typeof callback == "function"){
						return callback(err)
					}

					return console.log(err)
				}

				startSyncing()

				if(typeof callback == "function"){
					return callback(null)
				}

				return false
			})
		})
	}

	checkIfSyncFolderExistsRemote(async (err, exists, uuid) => {
		if(err){
			if(typeof callback == "function"){
				return callback(err)
			}

			return console.log(err)
		}

		let deviceId = undefined

		try{
			let getDeviceId = await db.get("deviceId")

			if(typeof getDeviceId == "string"){
				deviceId = getDeviceId
			}
		}
		catch(e){
			deviceId = undefined
		}

		if(typeof deviceId !== "string"){
			deviceId = uuidv4()

			try{
				await db.put("deviceId", deviceId)
			}
			catch(e){
				if(typeof callback == "function"){
					return callback(e)
				}

				return console.log(e)
			}
		}

		thisDeviceId = deviceId

		console.log("Device Id: " + thisDeviceId)

		try{
			let getSyncMode = await db.get("syncMode")

			if(typeof getSyncMode == "string"){
				syncMode = getSyncMode
			}
		}
		catch(e){ }

		$("#sync-mode-select").val(syncMode)

		console.log("syncMode: " + syncMode)

		if(exists){
			try{
				await db.put("isSetupDone", "true")
				await db.put("syncFolderUUID", uuid)
			}
			catch(e){
				if(typeof callback == "function"){
					return callback(e)
				}

				return console.log(e)
			}

			console.log("Sync folder already exists.")

			return setupDone()
		}
		else{
			try{
				var userMasterKeys = await getUserMasterKeys()
			}
			catch(e){
				if(typeof callback == "function"){
					return callback(e)
				}

				return console.log(e)
			}

			let syncFolderUUID = uuidv4()

			apiRequest("/v1/dir/create", {
				apiKey: await getUserAPIKey(),
				uuid: syncFolderUUID,
				name: await encryptMetadata(JSON.stringify({
					name: "Filen Sync"
				}), userMasterKeys[userMasterKeys.length - 1]),
				nameHashed: hashFn("filen sync"),
				type: "sync"
			}, async (err, res) => {
				if(err){
					if(typeof callback == "function"){
						return callback(err)
					}

					return console.log(err)
				}

				if(!res.status){
					if(res.message.toLowerCase().indexOf("api key not found") !== -1){
						if(typeof callback == "function"){
							callback(res.message)
						}

						return doLogout()
					}
					
					if(typeof callback == "function"){
						return callback(res.message)
					}

					return console.log(res.message)
				}

				try{
					await db.put("isSetupDone", "true")
					await db.put("syncFolderUUID", syncFolderUUID)
				}
				catch(e){
					if(typeof callback == "function"){
						return callback(e)
					}

					return console.log(e)
				}

				console.log("Sync folder created.")

				return setupDone()
			})
		}
	})
}

const updateUserKeys = async (callback) => {
	let loggedIn = false

	try{
		loggedIn = await isLoggedIn()
	}
	catch(e){
		if(typeof callback == "function"){
			callback(e)
		}

		return console.log(e)
	}

	if(!loggedIn){
		if(typeof callback == "function"){
			callback(false)
		}

		return false
	}

	try{
		var userMasterKeys = await getUserMasterKeys()
	}
	catch(e){
		if(typeof callback == "function"){
			callback(e)
		}

		return console.log(e)
	}

	const updatePubAndPrivKeys = async () => {
		apiRequest("/v1/user/keyPair/info", {
			apiKey: await getUserAPIKey()
		}, async (err, res) => {
			if(err){
				return console.log(err)
			}

			if(!res.status){
				if(res.message.toLowerCase().indexOf("api key not found") !== -1){
					return doLogout()
				}

				return console.log(res.message)
			}

			try{
				var usrMasterKeys = await getUserMasterKeys()
			}
			catch(e){
				return console.log(e)
			}

			if(res.data.publicKey.length > 16 && res.data.privateKey.length > 16){
				let prvKeyFound = false
				let prvKey = ""

				for(let i = 0; i < usrMasterKeys.length; i++){
					if(!prvKeyFound){
						try{
							prvKey = await decryptMetadata(res.data.privateKey, usrMasterKeys[i])
						
							if(prvKey.length > 16){
								prvKeyFound = true
							}
						}
						catch(e){
							console.log(e)
						}
					}
				}

				if(prvKey.length > 16){
					try{
						await db.put("userPublicKey", res.data.publicKey)
						await db.put("userPrivateKey", prvKey)
					}
					catch(e){
						return console.log(e)
					}

					console.log("Public and private key updated.")
				}
				else{
					console.log("Could not decrypt private key.")
				}
			}
		})
	}

	apiRequest("/v1/user/masterKeys", {
		apiKey: await getUserAPIKey(),
		masterKeys: await encryptMetadata(userMasterKeys.join("|"), userMasterKeys[userMasterKeys.length - 1])
	}, async (err, res) => {
		if(err){
			if(typeof callback == "function"){
				callback(err)
			}

			return console.log(err)
		}

		if(!res.status){
			if(res.message.toLowerCase().indexOf("api key not found") !== -1){
				return doLogout()
			}

			if(typeof callback == "function"){
				callback(res.message)
			}

			return console.log(res.message)
		}

		if(res.data.keys.length == 0){
			if(typeof callback == "function"){
				callback("Received master keys length is null.")
			}

			return console.log("Received master keys length is null.")
		}

		try{
			let newKeys = ""

			for (let i = 0; i < userMasterKeys.length; i++){
				try{
					if(newKeys.length < 16){
						newKeys = await decryptMetadata(res.data.keys, userMasterKeys[i])
					}
				}
				catch(e){
					console.log(e)
				}
			}

			if(newKeys.length > 16){
				try{
					await db.put("userMasterKeys", newKeys)
				}
				catch(err){
					if(typeof callback == "function"){
						callback(err)
					}

					return console.log(err)
				}

				console.log("Master keys updated.")

				if(typeof callback == "function"){
					callback(null)
				}
			}

			updatePubAndPrivKeys()
		}
		catch(e){
			if(typeof callback == "function"){
				callback(e)
			}

			return console.log(e)
		}
	})
}

async function decryptFolderNameLink(metadata, linkKey, uuid){
	if(metadata == "default"){
		return "Default"
	}

    let folderName = ""

    try{
        let obj = JSON.parse(await decryptMetadata(metadata, linkKey, 1))

        if(obj && typeof obj == "object"){
            folderName = obj.name
        }
    }
    catch(e){
        console.log(e)
    }

    return folderName
}

async function decryptFileMetadataLink(metadata, linkKey, uuid){
    let fileName = ""
    let fileSize = 0
    let fileMime = ""
    let fileKey = ""

    try{
        let obj = JSON.parse(await decryptMetadata(metadata, linkKey, 1))

        if(obj && typeof obj == "object"){
            fileName = obj.name
            fileSize = parseInt(obj.size)
            fileMime = obj.mime
            fileKey = obj.key
        }
    }
    catch(e){
        console.log(e)
    }

    let obj = {
        name: fileName,
        size: fileSize,
        mime: fileMime,
        key: fileKey
    }

    return obj
}

const decryptFolderMetadata = async (str, userMasterKeys, uuid) => {
	if(str == "default"){
		return "Default"
	}

	let cacheKey = "folder_" + str + "_" + uuid

	if(typeof remoteDecryptedCache[cacheKey] == "string"){
		if(remoteDecryptedCache[cacheKey].length > 0){
			return remoteDecryptedCache[cacheKey]
		}
	}

	let folderName = ""

	userMasterKeys = userMasterKeys.reverse()

	for(let i = 0; i < userMasterKeys.length; i++){
		try{
			let obj = JSON.parse(await decryptMetadata(str, userMasterKeys[i]))

			if(obj && typeof obj == "object"){
				folderName = obj.name

				break
			}
		}
		catch(e){
			continue
		}
	}

	if(folderName.length > 0){
		remoteDecryptedCache[cacheKey] = folderName
	}

	return folderName
}

const decryptFileMetadata = async (metadata, userMasterKeys, uuid) => {
	let cacheKey = "file_" + metadata + "_" + uuid

	if(typeof remoteDecryptedCache[cacheKey] == "string"){
		try{
			let obj = JSON.parse(remoteDecryptedCache[cacheKey])

			if(typeof obj == "object"){
				if(typeof obj.name == "string"){
					if(obj.name.length > 0){
						return obj
					}
				}
			}
		}
		catch(e){ }
	}

	let fileName = ""
	let fileSize = 0
	let fileMime = ""
	let fileKey = ""

	if(userMasterKeys.length > 0){
		userMasterKeys = userMasterKeys.reverse()
	}

	for(let i = 0; i < userMasterKeys.length; i++){
		try{
			let obj = JSON.parse(await decryptMetadata(metadata, userMasterKeys[i]))

			if(obj && typeof obj == "object"){
				fileName = obj.name
				fileSize = parseInt(obj.size)
				fileMime = obj.mime
				fileKey = obj.key

				break
			}
		}
		catch(e){
			continue
		}
	}

	let obj = {
		name: fileName,
		size: fileSize,
		mime: fileMime,
		key: fileKey
	}

	if(obj.name.length > 0){
		remoteDecryptedCache[cacheKey] = JSON.stringify(obj)
	}

	return obj
}

const removeFromSyncTasks = (taskId) => {
	syncTaskTries[taskId] = 0

	currentSyncTasks = currentSyncTasks.filter((item) => {
		return item !== taskId
	})
}

const removeFromSyncTasksExtra = (taskId) => {
	currentSyncTasksExtra = currentSyncTasksExtra.filter((item) => {
		return item !== taskId
	})
}

const clearCurrentSyncTasksExtra = () => {
	currentSyncTasksExtra = []
}

const removeFromDeletingRemoteFolders = (taskId) => {
	currentDeletingRemoteFolders = currentDeletingRemoteFolders.filter((item) => {
		return item !== taskId
	})
}

const removeFromDeletingLocalFolders = (taskId) => {
	currentDeletingLocalFolders = currentDeletingLocalFolders.filter((item) => {
		return item !== taskId
	})
}

const checkIfFileExistsLocallyOtherwiseDelete = async (path, callback) => {
	try{
		let stat = await fs.stat(path)

		if(stat){
			rimraf(path, () => {
				return callback(null)
			})
		}
		else{
			return callback(null)
		}
	}
	catch(e){
		return callback(null)
	}
}

async function decryptFolderLinkKey(str, userMasterKeys){
	let link = ""

	if(userMasterKeys.length > 0){
		userMasterKeys = userMasterKeys.reverse()
	}

    for(let i = 0; i < userMasterKeys.length; i++){
    	try{
            let obj = await decryptMetadata(str, userMasterKeys[i])

            if(obj && typeof obj == "string"){
                if(obj.length >= 16){
                	link = obj

                	break
                }
            }
        }
        catch(e){
           	continue
        }
    }

    return link
}

const checkIfItemParentIsBeingShared = async (parentUUID, type, metaData, optionalCallback) => {
	try{
		var usrAPIKey = await getUserAPIKey()
		var userMasterKeys = await getUserMasterKeys()
	}
	catch(e){
		console.log(e)

		return callback()
	}

	let shareCheckDone = false
	let linkCheckDone = false

	let isItDoneInterval = undefined
	let callbackFired = false

	const isItDone = () => {
		if(shareCheckDone && linkCheckDone){
			clearInterval(isItDoneInterval)

			if(typeof optionalCallback == "function" && !callbackFired){
				callbackFired = true
				
			 	optionalCallback()
			}

			return true
		}
	}

	isItDoneInterval = setInterval(isItDone, 100)

	const checkIfIsSharing = (parent, tries, maxTries, callback) => {
		if(tries >= maxTries){
			return callback(false)
		}

		$.ajax({
			url: getAPIServer() + "/v1/share/dir/status",
			type: "POST",
			contentType: "application/json",
			data: JSON.stringify({
				apiKey: usrAPIKey,
				uuid: parent
			}),
			processData: false,
			cache: false,
			timeout: 300000,
			success: (res) => {
				if(!res){
					console.log("Request error")

					return setTimeout(() => {
						checkIfIsSharing(parent, (tries + 1), maxTries, callback)
					}, 1000)
				}

				if(!res.status){
					console.log(res.message)

					return callback(false)
				}

				return callback(res.data.sharing, res.data.users)
			},
			error: (err) => {
				console.log(err)

				return setTimeout(() => {
					checkIfIsSharing(parent, (tries + 1), maxTries, callback)
				}, 1000)
			}
		})
	}

	const checkIfIsInFolderLink = (parent, tries, maxTries, callback) => {
		if(tries >= maxTries){
			return callback(false)
		}

		$.ajax({
			url: getAPIServer() + "/v1/link/dir/status",
			type: "POST",
			contentType: "application/json",
			data: JSON.stringify({
				apiKey: usrAPIKey,
				uuid: parent
			}),
			processData: false,
			cache: false,
			timeout: 300000,
			success: (res) => {
				if(!res){
					console.log("Request error")

					return setTimeout(() => {
						checkIfIsInFolderLink(parent, (tries + 1), maxTries, callback)
					}, 1000)
				}

				if(!res.status){
					console.log(res.message)

					return callback(false)
				}

				return callback(res.data.link, res.data.links)
			},
			error: (err) => {
				console.log(err)

				return setTimeout(() => {
					checkIfIsInFolderLink(parent, (tries + 1), maxTries, callback)
				}, 1000)
			}
		})
	}

	const addItem = (data, tries, maxTries, callback) => {
		if(tries >= maxTries){
			return callback(new Error("Max requests reached"))
		}

		$.ajax({
			url: getAPIServer() + "/v1/dir/link/add",
			type: "POST",
			contentType: "application/json",
			data: data,
			processData: false,
			cache: false,
			timeout: 300000,
			success: (res) => {
				if(!res){
					console.log("Request error")

					return setTimeout(() => {
						addItem(data, (tries + 1), maxTries, callback)
					}, 1000)
				}

				return callback(null)
			},
			error: (err) => {
				console.log(err)

				return setTimeout(() => {
					addItem(data, (tries + 1), maxTries, callback)
				}, 1000)
			}
		})
	}

	const shareItem = (data, tries, maxTries, callback) => {
		if(tries >= maxTries){
			return callback(new Error("Max requests reached"))
		}

		$.ajax({
			url: getAPIServer() + "/v1/share",
			type: "POST",
			contentType: "application/json",
			data: data,
			processData: false,
			cache: false,
			timeout: 300000,
			success: (res) => {
				if(!res){
					console.log("Request error")

					return setTimeout(() => {
						shareItem(data, (tries + 1), maxTries, callback)
					}, 1000)
				}

				return callback(null)
			},
			error: (err) => {
				console.log(err)

				return setTimeout(() => {
					shareItem(data, (tries + 1), maxTries, callback)
				}, 1000)
			}
		})
	}

	checkIfIsSharing(parentUUID, 0, 32, (status, users) => {
		if(!status){
			shareCheckDone = true

			return isItDone()
		}

		let totalUsers = users.length
		let doneUsers = 0

		const doneSharingToUsers = () => {
			doneUsers += 1

			if(doneUsers >= totalUsers){
				shareCheckDone = true

				return isItDone()
			}
		}

		users.forEach((user) => {
			window.crypto.subtle.importKey("spki", _base64ToArrayBuffer(user.publicKey), {
      			name: "RSA-OAEP",
        		hash: "SHA-512"
    		}, true, ["encrypt"]).then((usrPubKey) => {
    			let mData = ""

    			if(type == "file"){
    				mData = JSON.stringify({
	    				name: metaData.name,
	    				size: parseInt(metaData.size),
	    				mime: metaData.mime,
	    				key: metaData.key,
	    				lastModified: metaData.lastModified || Math.floor((+new Date()) / 1000)
	    			})
				}
				else{
					mData = JSON.stringify({
						name: metaData.name
					})
				}

				window.crypto.subtle.encrypt({
    				name: "RSA-OAEP"
    			}, usrPubKey, new TextEncoder().encode(mData)).then((encrypted) => {
    				shareItem(JSON.stringify({
						apiKey: usrAPIKey,
						uuid: metaData.uuid,
						parent: parentUUID,
						email: user.email,
						type: type,
						metadata: base64ArrayBuffer(encrypted)
					}), 0, 32, (err) => {
    					if(err){
    						console.log(err)
    					}

    					doneSharingToUsers()
					})
    			}).catch((err) => {
	    			doneSharingToUsers()
	    		})
    		}).catch((err) => {
    			doneSharingToUsers()
    		})
		})
	})

	checkIfIsInFolderLink(parentUUID, 0, 32, async (status, links) => {
		if(!status){
			linkCheckDone = true

			return isItDone()
		}

		let totalLinks = links.length
		let linksDone = 0

		const doneAddingToLink = () => {
			linksDone += 1

			if(linksDone >= totalLinks){
				linkCheckDone = true

				return isItDone()
			}
		}

		for(let i = 0; i < links.length; i++){
			let link = links[i]

			let key = await decryptFolderLinkKey(link.linkKey, userMasterKeys)

			let mData = ""

			if(type == "file"){
				mData = JSON.stringify({
					name: metaData.name,
					size: parseInt(metaData.size),
					mime: metaData.mime,
					key: metaData.key,
					lastModified: metaData.lastModified || Math.floor((+new Date()) / 1000)
				})
			}
			else{
				mData = JSON.stringify({
					name: metaData.name
				})
			}

			mData = await encryptMetadata(mData, key, 1)

			addItem(JSON.stringify({
				apiKey: usrAPIKey,
				uuid: metaData.uuid,
				parent: parentUUID,
				linkUUID: link.linkUUID,
				type: type,
				metadata: mData,
				key: link.linkKey,
				expiration: "never",
				password: "empty",
				passwordHashed: hashFn("empty"),
				downloadBtn: "enable"
			}), 0, 32, (err) => {
				if(err){
					console.log(err)
				}

				doneAddingToLink()
			})
		}
	})
}

const downloadFileChunk = async (file, index, tries, maxTries, isSync, callback) => {
	if(syncingPaused && isSync){
		return setTimeout(() => {
			downloadFileChunk(file, index, tries, maxTries, isSync, callback)
		}, getRandomArbitrary(25, 100))
	}

	if(tries >= maxTries){
		return callback(new Error("Max download retries reached for " + file.uuid + ", returning."))
	}

	if(index >= file.chunks){
		return callback(null, index, undefined)
	}

	if(!isSync && currentDownloadFolderStopped[currentDownloadFolderUUID]){
		return callback(new Error("Download stopped manually."))
	}

	try{
		var release = await downloadSemaphore.acquire()
	}
	catch(e){
		return callback(e)
	}

	let overrideXHR = new XMLHttpRequest()
	overrideXHR.responseType = "arraybuffer"

	$.ajax({
		type: "GET",
		url: getDownloadServer() + "/" + file.region + "/" + file.bucket + "/" + file.uuid + "/" + index,
		timeout: (3600 * 1000),
		xhr: () => {
			return overrideXHR
		},
		success: (res) => {
			release()

			if(res.byteLength){
				decryptDataWorker(file.uuid, index, file.key, res, file.version, (decrypted) => {
					return callback(null, index, new Uint8Array(decrypted))
				})
			}
			else{
				return setTimeout(() => {
					downloadFileChunk(file, index, (tries + 1), maxTries, isSync, callback)
				}, 1000)
			}
		},
		error: (err) => {
			release()

			return setTimeout(() => {
				downloadFileChunk(file, index, (tries + 1), maxTries, isSync, callback)
			}, 1000)
		}
	})
}

const writeFileChunk = (file, index, data) => {
	if(index == downloadWriteChunk[file.uuid]){
		if(typeof downloadWriteStreams[file.uuid] == "undefined"){
			currentWriteThreads -= 1

			return false
		}

		if(downloadWriteStreams[file.uuid].closed){
			currentWriteThreads -= 1

			return false
		}

		if(data.length == 0 || typeof data == "undefined" || data == null){
			if(typeof chunksWritten[file.uuid] == "undefined"){
				chunksWritten[file.uuid] = 0
			}

			currentWriteThreads -= 1
			chunksWritten[file.uuid] += 1

			return downloadWriteChunk[file.uuid] += 1
		}

		try{
			downloadWriteStreams[file.uuid].write(data, (err) => {
				currentWriteThreads -= 1

				if(err){
					return console.log(err)
				}

				if(typeof chunksWritten[file.uuid] == "undefined"){
					chunksWritten[file.uuid] = 0
				}

				chunksWritten[file.uuid] += 1

				return downloadWriteChunk[file.uuid] += 1
			})
		}
		catch(e){
			currentWriteThreads -= 1

			return console.log(e)
		}
	}
	else{
		return setTimeout(() => {
			writeFileChunk(file, index, data)
		}, 5)
	}
}

const downloadFileChunksAndWrite = (path, file, isSync, callback) => {
	let maxDownloadThreadsInterval = setInterval(() => {
		if(currentDownloadThreads < maxDownloadThreads && currentWriteThreads < maxWriteThreads){
			currentDownloadThreads += 1
			currentWriteThreads += 1
			downloadIndex[file.uuid] += 1

			let thisIndex = downloadIndex[file.uuid]

			downloadFileChunk(file, thisIndex, 0, 128, isSync, (err, index, data) => {
				if(err){
					clearInterval(maxDownloadThreadsInterval)

					currentDownloadThreads -= 1
					currentWriteThreads -= 1

					return callback(err)
				}

				if(typeof data !== "undefined"){
					writeFileChunk(file, index, data)

					if(!isSync && isCurrentlyDownloadigRemote && typeof currentDownloadFolderUUID !== "undefined"){
						currentDownloadFolderLoaded[currentDownloadFolderUUID] += data.length
					}
				}

				if(index >= file.chunks){
					clearInterval(maxDownloadThreadsInterval)

					currentDownloadThreads -= 1

					return callback(null)
				}

				currentDownloadThreads -= 1
			})
		}
	}, 10)
}

const downloadFileToLocal = async (path, file, isSync, callback) => {
	if(file.size <= 0){
		return callback(new Error("file size is zero"))
	}

	await new Promise((resolve) => {
		let interval = setInterval(() => {
			if(currentDownloadTasks < maxDownloadTasks){
				clearInterval(interval)

				return resolve()
			}
		}, 5)
	})

	currentDownloadTasks += 1

	let dummyPath = path.split("\\").join("/")
	let pathEx = dummyPath.split("/")

	pathEx.pop()

	let fileDirPath = pathEx.join("/") + "/"
	let fileDirPathExists = false

	try{
		let dirStat = await fs.stat(winOrUnixFilePath(fileDirPath))

		if(dirStat){
			if(dirStat.isDirectory()){
				fileDirPathExists = true	
			}
		}
	}
	catch(e){
		currentDownloadTasks -= 1
		
		return callback(e)
	}

	if(!fileDirPathExists){
		currentDownloadTasks -= 1
		
		return callback(new Error("file parent dir does not exist locally -> " + fileDirPath))
	}

	checkIfFileExistsLocallyOtherwiseDelete(winOrUnixFilePath(path), async (err) => {
		if(err){
			currentDownloadTasks -= 1

			return callback(err)
		}

		downloadWriteChunk[file.uuid] = 0
		downloadIndex[file.uuid] = -1

		downloadWriteStreams[file.uuid] = fs.createWriteStream(winOrUnixFilePath(path), {
			flags: "w"
		})

		downloadFileChunksAndWrite(winOrUnixFilePath(path), file, isSync, (err) => {
			if(err){
				downloadWriteStreams[file.uuid].end()

				currentDownloadTasks -= 1

				return callback(err)
			}

			let waitForChunksToWriteInterval = setInterval(() => {
				if(typeof chunksWritten[file.uuid] !== "undefined"){
					if(chunksWritten[file.uuid] >= file.chunks){
						clearInterval(waitForChunksToWriteInterval)

						currentDownloadTasks -= 1

						if(isSync){
							downloadWriteStreams[file.uuid].end()

							return callback(null)
						}
						else{
							downloadWriteStreams[file.uuid].end()

							return callback(null)
						}
					}
				}
			}, 5)
		})
	})
}

const uploadChunk = async (uuid, queryParams, blob, tries, maxTries, callback) => {
	if(syncingPaused){
		return setTimeout(() => {
			uploadChunk(uuid, queryParams, blob, tries, maxTries, callback)
		}, getRandomArbitrary(25, 100))
	}

	if(tries >= maxTries){
		return callback(new Error("upload chunk max tries reached, returning."))
	}

	if(typeof bannedUploadUUIDs[uuid] !== "undefined"){
		if(bannedUploadUUIDs[uuid] < Math.floor((+new Date()) / 1000)){
			return callback(new Error("upload uuid banned, returning."))
		}
	}

	try{
		var release = await uploadSemaphore.acquire()
	}
	catch(e){
		return callback(e)
	}

	$.ajax({
		url: getUploadServer() + "/v1/upload?" + queryParams,
		type: "POST",
		data: blob,
		processData: false,
		cache: false,
		contentType: false,
		timeout: (3600 * 1000),
		success: (res) => {
			if(blob.length >= 810000){
				setTimeout(() => {
					release()
				}, getRandomArbitrary(75, 125))
			}
			else{
				setTimeout(() => {
					release()
				}, getRandomArbitrary(750, 1250))
			}

			if(!res){
				return setTimeout(() => {
					uploadChunk(uuid, queryParams, blob, (tries + 1), maxTries, callback)
				}, 1000)
			}
			else{
				if(typeof res !== "object"){
					return setTimeout(() => {
						uploadChunk(uuid, queryParams, blob, (tries + 1), maxTries, callback)
					}, 1000)
				}
				else{
					if(!res.status){
						bannedUploadUUIDs[uuid] = (Math.floor((+new Date()) / 1000) + 60)

						return callback(res.message)
					}
					else{
						return callback(null, res)
					}
				}
			}
		},
		error: (err) => {
			if(blob.length >= 810000){
				setTimeout(() => {
					release()
				}, getRandomArbitrary(75, 125))
			}
			else{
				setTimeout(() => {
					release()
				}, getRandomArbitrary(750, 1250))
			}

			return setTimeout(() => {
				uploadChunk(uuid, queryParams, blob, (tries + 1), maxTries, callback)
			}, 1000)
		}
	})
}

const markUploadAsDone = (uuid, uploadKey, tries, maxTries, callback) => {
	if(tries >= maxTries){
		return callback(new Error("mark upload as done max tries reached, returning."))
	}

	apiRequest("/v1/upload/done", {
		uuid,
		uploadKey
	}, (err, res) => {
		if(err){
			return setTimeout(() => {
				markUploadAsDone(uuid, uploadKey, (tries + 1), maxTries, callback)
			}, 1000)
		}

		if(!res.status){
			return callback(null)
		}

		return callback(null)
	})
}

const uploadFileToRemote = async (path, uuid, parent, name, userMasterKeys, lastModified, callback) => {
	try{
		var usrAPIKey = await getUserAPIKey()
	}
	catch(e){
		return callback(e)
	}

	let key = generateRandomString(32)
	let rm = generateRandomString(32)
	let uploadKey = generateRandomString(32)
	let expire = "never"
	let mime = mimeTypes.lookup(name) || ""
	let firstDone = false
	let doFirst = true
	let markedAsDone = false

	let chunkSizeToUse = ((1024 * 1024) * 1)

	let nameEnc = await encryptMetadata(name, key)
	let nameH = hashFn(name.toLowerCase())
	let mimeEnc = await encryptMetadata(mime, key)

	fs.stat(winOrUnixFilePath(path), async (err, stats) => {
		if(err){
			return callback(err)
		}

		let size = parseInt(stats.size)

		if(size <= 0){
			return callback(new Error("file size is zero"))
		}

		if((savedUserUsage.storage + (size + 1048576)) >= savedUserUsage.max){
			return callback(new Error("user storage exceeded"))
		}

		let sizeEnc = await encryptMetadata(size.toString(), key)
		
		let metaData = await encryptMetadata(JSON.stringify({
			name,
			size,
			mime,
			key,
			lastModified: lastModified || Math.floor((+new Date()) / 1000)
		}), userMasterKeys[userMasterKeys.length - 1])

		let dummyOffset = 0
		let fileChunks = 0

		while(dummyOffset < size){
			fileChunks++
			dummyOffset += chunkSizeToUse
		}

		let offset = (0 - chunkSizeToUse)
		let currentIndex = -1
		let chunksUploaded = -1

		let uploadInterval = setInterval(() => {
			if(offset < size){
				if(currentUploadThreads < maxUploadThreads){
					if(firstDone){
						doFirst = true
					}

					if(doFirst){
						if(!firstDone){
							doFirst = false
						}

						currentUploadThreads += 1
						offset += chunkSizeToUse
						currentIndex += 1

						let thisIndex = currentIndex

						readChunk(winOrUnixFilePath(path), offset, chunkSizeToUse).then((chunkData) => {
							let arrayBuffer = toArrayBuffer(chunkData)

							encryptDataWorker(uuid, thisIndex, key, arrayBuffer, currentFileVersion, (blob) => {
								arrayBuffer = null

								let queryParams = $.param({
									apiKey: usrAPIKey,
									uuid: uuid,
									name: nameEnc,
									nameHashed: nameH,
									size: sizeEnc,
									chunks: fileChunks,
									mime: mimeEnc,
									index: thisIndex,
									rm: rm,
									expire: expire,
									uploadKey: uploadKey,
									metaData: metaData,
									parent: parent,
									version: currentFileVersion
								})

								uploadChunk(uuid, queryParams, blob, 0, 10000000, (err, res) => {
									if(err){
										return callback(err)
									}

									currentUploadThreads -= 1
									chunksUploaded += 1

									console.log(chunksUploaded, fileChunks)

									blob = null
									firstDone = true

									if(chunksUploaded >= fileChunks){
										clearInterval(uploadInterval)

										if(!markedAsDone){
											markedAsDone = true

											markUploadAsDone(uuid, uploadKey, 0, 10000000, (err) => {
												if(err){
													return callback(err)
												}

												checkIfItemParentIsBeingShared(parent, "file", {
													uuid: uuid,
													name: name,
													size: parseInt(size),
													mime: mime,
													key: key,
													lastModified: lastModified || Math.floor((+new Date()) / 1000)
												}, () => {
													return callback(null)
												})
											})
										}
									}
								})
							})
						}).catch((err) => {
							currentUploadThreads -= 1

							return callback(err)
						})
					}
				}
			}
		}, 100)
	})
}

const writeSyncTasks = async () => {
	if(syncTasksToWrite.length == 0){
		return false
	}

	try{
		var release = await logSyncTasksSemaphore.acquire()
	}
	catch(e){
		return console.log(e)
	}

	let currentStorageData = []
	let userEmail = undefined

	try{
		userEmail = await db.get("userEmail")

		currentStorageData = JSON.parse(await db.get(userEmail + "_finishedSyncTasks"))
	}
	catch(e){
		currentStorageData = []
	}

	for(let i = 0; i < syncTasksToWrite.length; i++){
		currentStorageData.push(syncTasksToWrite[i])

		if(currentStorageData.length >= 250){
			currentStorageData.shift()
		}
	}

	try{
		await db.put(userEmail + "_finishedSyncTasks", JSON.stringify(currentStorageData))
	}
	catch(e){
		console.log(e)
	}

	return release()
}

const addFinishedSyncTaskToStorage = async (where, task, taskInfo) => {
	let taskData = {
		where,
		task,
		taskInfo,
		timestamp: Math.floor((+new Date()) / 1000)
	}

	lastSyncedItem = taskData

	renderSyncTask(taskData, true)

	return syncTasksToWrite.push(taskData)
}

var skipCheckLocalExistedFoldersAndFiles = 0

const checkLocalExistedFoldersAndFiles = (folders, files, callback) => {
	if(skipCheckLocalExistedFoldersAndFiles > unixTimestamp()){
		return callback()
	}

	for(let prop in localFolderExisted){
		if(typeof folders[prop] == "undefined"){
			console.log("Removing " + prop + " from localFolderExisted, not present anymore")

			delete localFolderExisted[prop]
		}
	}

	for(let prop in localFileExisted){
		if(typeof files[prop] == "undefined"){
			console.log("Removing " + prop + " from localFileExisted, not present anymore")

			delete localFileExisted[prop]
		}
	}

	for(let prop in remoteFileUUIDs){
		let oldProp = prop

		prop = prop.replace(userHomePath + "/", "")

		if(typeof files[prop] == "undefined"){
			console.log("Removing " + prop + " from remoteFileUUIDs, not present anymore")

			//delete remoteFileUUIDs[prop]
		}
	}

	for(let prop in remoteFileSizes){
		let oldProp = prop

		prop = prop.replace(userHomePath + "/", "")

		if(typeof files[prop] == "undefined"){
			console.log("Removing " + prop + " from remoteFileSizes, not present anymore")

			//delete remoteFileSizes[prop]
		}

	}

	for(let prop in localFileModifications){
		let oldProp = prop

		prop = prop.replace(userHomePath + "/", "")

		if(typeof files[prop] == "undefined"){
			console.log("Removing " + prop + " from localFileModifications, not present anymore")

			//delete localFileModifications[prop]
		}
	}

	return callback()
}

const getLocalSyncDirContents = async (callback) => {
	if(!syncStarted){
		return callback(new Error("Sync not started"))
	}

	if(syncingPaused){
		return callback(new Error("Sync paused"))
	}

	if(typeof userSyncDir == "undefined"){
		return callback(new Error("Sync dir is not defined"))
	}

	if(!localDataChanged && !reloadAll && typeof lastLocalSyncFolders !== "undefined" && typeof lastLocalSyncFiles !== "undefined"){
		//console.log("Local data did not change from last sync cycle, serving cache.")

		return callback(null, lastLocalSyncFolders, lastLocalSyncFiles)
	}

	localDataChanged = false

	let files = {}
	let folders = {}

	try{
		for await (let file of klaw(userSyncDir, {
			depthLimit: -1,
			preserveSymlinks: true
		})){
		  	if(file.stats){
		  		let filePath = file.path.substring(userHomePath.length + 1).split("\\").join("/")
		  		let filePathEx = filePath.split("/")

		  		if(file.stats.isDirectory() && typeof filePathEx[filePathEx.length - 1] !== "undefined"){
		  			if(!isFileNameBlocked(filePathEx[filePathEx.length - 1])){
		  				folders[filePath + "/"] = {
							name: filePathEx[filePathEx.length - 1]
						}
		  			}
		  		}
		  		else if(typeof filePathEx[filePathEx.length - 1] !== "undefined"){
		  			if(file.stats.size > 0){
		  				if(!isFileNameBlocked(filePathEx[filePathEx.length - 1])){
		  					files[filePath] = {
								name: filePathEx[filePathEx.length - 1],
								modTime: file.stats.mtimeMs,
								size: file.stats.size
							}
		  				}
		  			}
		  		}
		  	}
		}
	}
	catch(e){
		return callback(e)
	}

	lastLocalSyncFolders = folders
	lastLocalSyncFiles = files

	return callback(null, folders, files)
}

const getRemoteSyncDirContents = async (folderUUID, callback) => {
	try{
		var userMasterKeys = await getUserMasterKeys()
	}
	catch(e){
		return callback(e)
	}

	apiRequest("/v1/get/dir", {
		apiKey: await getUserAPIKey(),
		uuid: folderUUID,
		firstRequest: (firstDataRequest || skipNextRequestData || reloadAll ? "true" : "false")
	}, async (err, res) => {
		if(err){
			return callback(err)
		}

		if(!res.status){
			if(res.message.toLowerCase().indexOf("api key not found") !== -1){
				return doLogout()
			}

			return callback(res.message)
		}

		firstDataRequest = false

		if(skipNextRequestData){ //reset fresh data
			skipNextRequestData = false
		}

		if(res.message.toLowerCase().indexOf("skipping") !== -1){
			if(typeof lastReceivedSyncData !== "undefined"){
				res.data = lastReceivedSyncData
			}
		}
		else{
			lastReceivedSyncData = res.data
		}

		if(!reloadAll){
			let receivedDataHash = JSON.stringify(res.data)

			if(typeof lastRemoteSyncDataHash !== "undefined"){
				if(receivedDataHash == lastRemoteSyncDataHash && typeof lastRemoteSyncFolders !== "undefined" && typeof lastRemoteSyncFiles !== "undefined"){
					//console.log("Last remote sync data identical to current one, serving from cache.")

					return callback(null, lastRemoteSyncFolders, lastRemoteSyncFiles) 
				}
			}

			lastRemoteSyncDataHash = receivedDataHash
		}

		let paths = []
		let folders = {}
		let pathsForFiles = {}
		let filePaths = []
		let files = {}
		let folderPaths = {}
		let folderNamesExisting = {}
		let fileNamesExisting = {}

		let basePath = "Filen Sync"

		paths.push(basePath + "/")

		pathsForFiles[res.data.folders[0].uuid] = basePath + "/"

		folderPaths[basePath + "/"] = {
			uuid: res.data.folders[0].uuid,
			name: basePath,
			parent: "base"
		}

		folders[res.data.folders[0].uuid] = {
			uuid: res.data.folders[0].uuid,
			name: basePath,
			parent: "base"
		}

		const getPathRecursively = (uuid) => {
			if(typeof folders[uuid] == "undefined"){
				return undefined
			}

			let thisPath = []

			const build = (parentUUID) => {
				if(typeof folders[parentUUID] == "undefined"){
					return undefined
				}

				if(folders[parentUUID].parent == "base"){
					return basePath + "/" + thisPath.reverse().join("/")  + "/"
				}

				thisPath.push(folders[parentUUID].name)

				return build(folders[parentUUID].parent)
			}

			if(folders[uuid].parent == "base"){
				return ""
			}

			thisPath.push(folders[uuid].name)

			return build(folders[uuid].parent)
		}
		
		for(let i = 0; i < res.data.folders.length; i++){
			let self = res.data.folders[i]
			let selfName = await decryptFolderMetadata(self.name, userMasterKeys, self.uuid)

			selfName = cleanString(selfName)

			if(selfName.length > 0){
				if(self.parent !== "base"){
					let parent = folders[res.data.folders[i].parent]

					if(typeof parent !== "undefined"){
						if(!isFileNameBlocked(selfName)){
							if(typeof folderNamesExisting[self.parent + "_" + selfName.toLowerCase()] == "undefined"){
								folderNamesExisting[self.parent + "_" + selfName.toLowerCase()] = true

								folders[self.uuid] = {
									uuid: self.uuid,
									name: selfName,
									parent: self.parent
								}
							}
						}
					}
				}
			}
		}

		for(let i = 0; i < res.data.folders.length; i++){
			let self = res.data.folders[i]

			if(self.parent !== "base"){
				if(typeof folders[self.uuid] !== "undefined"){
					let newPath = getPathRecursively(self.uuid)
				
					if(typeof newPath !== "undefined"){
						pathsForFiles[self.uuid] = newPath
						folderPaths[newPath] = folders[self.uuid]
					}
				}
			}
		}

		for(let i = 0; i < res.data.files.length; i++){
			let self = res.data.files[i]

			if(pathsForFiles[self.parent] !== "undefined"){
				let metadata = await decryptFileMetadata(self.metadata, userMasterKeys, self.uuid)

				metadata.name = cleanString(metadata.name)
				metadata.key = cleanString(metadata.key)
				metadata.mime = cleanString(metadata.mime)
				metadata.size = parseInt(cleanString(metadata.size))

				let newPath = pathsForFiles[self.parent] + metadata.name

				if(metadata.name.length > 0){
					if(typeof newPath !== "undefined" && metadata.size > 0){
						if(!isFileNameBlocked(metadata.name)){
							if(typeof fileNamesExisting[self.parent + "_" + metadata.name.toLowerCase()] == "undefined"){
								fileNamesExisting[self.parent + "_" + metadata.name.toLowerCase()] = true

								files[newPath] = {
									uuid: self.uuid,
									region: self.region,
									bucket: self.bucket,
									chunks: self.chunks,
									name: metadata.name,
									size: metadata.size,
									mime: metadata.mime,
									key: metadata.key,
									parent: self.parent,
									version: self.version
								}
							}
						}
					}
				}
			}
		}

		remoteSyncFolders = folderPaths
		remoteSyncFiles = files

		return callback(null, folderPaths, files)
	})
}

const removeFoldersAndFilesFromExistingDir = (path, callback) => {
	let oldPath = path

	path = userHomePath + "/" + path

	for(let prop in localFolderExisted){
		let p = userHomePath + "/" + oldPath

		if(p.indexOf(path) !== -1){
			delete localFolderExisted[prop]
		}	
	}

	for(let prop in localFileExisted){
		if(prop.indexOf(oldPath) !== -1){
			let p = userHomePath + "/" + oldPath

			delete localFileExisted[prop]

			delete localFileModifications[p]
			delete remoteFileSizes[p]
			delete remoteFileUUIDs[p]
		}	
	}

	return callback()
}

const syncTask = async (where, task, taskInfo, userMasterKeys) => {
	if(syncMode == "localToCloud" && where == "local"){
		return false
	}

	if(syncMode == "cloudToLocal" && where == "remote"){
		return false
	}

	let taskId = taskInfo.path

	if(syncingPaused){
		return setTimeout(() => {
			syncTask(where, task, taskInfo, userMasterKeys)
		}, syncTimeout)
	}

	if(isIndexing){
		return setTimeout(() => {
			syncTask(where, task, taskInfo, userMasterKeys)
		}, syncTimeout)
	}

	if(currentSyncTasks.includes(taskId)){
		return false
	}

	currentSyncTasks.push(taskId)

	let syncTaskLimiterSemaphoreRelease = await syncTaskLimiterSemaphore.acquire()

	console.log(where, task, JSON.stringify(taskInfo))

	updateVisualStatus()

	switch(where){
		case "remote":
			switch(task){
				case "mkdir":
					apiRequest("/v1/dir/exists", {
						apiKey: await getUserAPIKey(),
						parent: taskInfo.parent,
						nameHashed: hashFn(taskInfo.name.toLowerCase())
					}, async (err, res) => {
						if(err){
							console.log(err)

							syncTaskLimiterSemaphoreRelease()

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						if(!res.status){
							console.log(res.message)

							syncTaskLimiterSemaphoreRelease()

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						if(res.data.exists){
							console.log(taskInfo.path + " already exists remotely.")

							localFolderExisted[taskInfo.path] = true

							syncTaskLimiterSemaphoreRelease()

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						let newFolderUUID = uuidv4()

						apiRequest("/v1/dir/sub/create", {
							apiKey: await getUserAPIKey(),
							uuid: newFolderUUID,
							name: await encryptMetadata(JSON.stringify({
								name: taskInfo.name
							}), userMasterKeys[userMasterKeys.length - 1]),
							nameHashed: hashFn(taskInfo.name.toLowerCase()),
							parent: taskInfo.parent
						}, (err, res) => {
							if(err){
								console.log(err)

								syncTaskLimiterSemaphoreRelease()

								return setTimeout(() => {
									removeFromSyncTasks(taskId)
								}, syncTimeout)
							}

							if(!res.status){
								console.log(res.message)

								syncTaskLimiterSemaphoreRelease()

								return setTimeout(() => {
									removeFromSyncTasks(taskId)
								}, syncTimeout)
							}

							console.log(res.message)

							checkIfItemParentIsBeingShared(taskInfo.parent, "folder", {
								uuid: newFolderUUID,
								name: taskInfo.name
							}, () => {
								localFolderExisted[taskInfo.path] = true

								addFinishedSyncTaskToStorage(where, task, JSON.stringify(taskInfo))

								syncTaskLimiterSemaphoreRelease()

								return setTimeout(() => {
									removeFromSyncTasks(taskId)
								}, syncTimeout)
							})
						})
					})
				break
				case "rmfile":
					apiRequest("/v1/file/trash", {
						apiKey: await getUserAPIKey(),
						uuid: taskInfo.file.uuid
					}, (err, res) => {
						if(err){
							console.log(err)

							syncTaskLimiterSemaphoreRelease()

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						if(!res.status){
							console.log(res.message)

							if(res.message.indexOf("already") !== -1){
								delete localFileModifications[taskInfo.filePath]
								delete remoteFileSizes[taskInfo.filePath]
								delete remoteFileUUIDs[taskInfo.filePath]
								delete localFileExisted[taskInfo.filePath]
							}

							syncTaskLimiterSemaphoreRelease()

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						addFinishedSyncTaskToStorage(where, task, JSON.stringify(taskInfo))

						console.log(res.message)

						delete localFileModifications[taskInfo.filePath]
						delete remoteFileSizes[taskInfo.filePath]
						delete remoteFileUUIDs[taskInfo.filePath]
						delete localFileExisted[taskInfo.filePath]

						syncTaskLimiterSemaphoreRelease()

						return setTimeout(() => {
							removeFromSyncTasks(taskId)
						}, syncTimeout)
					})
				break
				case "rmdir":
					apiRequest("/v1/dir/trash", {
						apiKey: await getUserAPIKey(),
						uuid: taskInfo.dir.uuid
					}, (err, res) => {
						if(err){
							console.log(err)

							removeFromDeletingRemoteFolders(taskId)

							syncTaskLimiterSemaphoreRelease()

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						if(!res.status){
							console.log(res.message)

							if(res.message.indexOf("already") !== -1){
								localFolderExisted[taskInfo.path] = true
							}

							removeFromDeletingRemoteFolders(taskId)

							syncTaskLimiterSemaphoreRelease()

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						addFinishedSyncTaskToStorage(where, task, JSON.stringify(taskInfo))

						console.log(res.message)

						delete localFolderExisted[taskInfo.path]

						return removeFoldersAndFilesFromExistingDir(taskInfo.path, () => {
							removeFromDeletingRemoteFolders(taskId)

							syncTaskLimiterSemaphoreRelease()

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						})
					})
				break
				case "upload":
				case "update":
					apiRequest("/v1/file/exists", {
						apiKey: await getUserAPIKey(),
						parent: taskInfo.parent,
						nameHashed: hashFn(taskInfo.name.toLowerCase())
					}, async (err, res) => {
						if(err){
							console.log(err)

							syncTaskLimiterSemaphoreRelease()

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						if(!res.status){
							console.log(res.message)

							syncTaskLimiterSemaphoreRelease()

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						let newFileUUID = uuidv4()

						const doUpload = async () => {
							fs.stat(winOrUnixFilePath(taskInfo.realPath)).then(async (fileInfo) => {
								uploadFileToRemote(taskInfo.realPath, newFileUUID, taskInfo.parent, taskInfo.name, userMasterKeys, Math.floor(fileInfo.mtimeMs / 1000), async (err) => {
									if(err){
										console.log(err)

										syncTaskLimiterSemaphoreRelease()

										return setTimeout(() => {
											removeFromSyncTasks(taskId)
										}, syncTimeout)
									}

									console.log(task + " " + taskInfo.path + " " + task + " done")

									addFinishedSyncTaskToStorage(where, task, JSON.stringify(taskInfo))

									try{
										let stat = await fs.stat(winOrUnixFilePath(taskInfo.realPath))

										if(stat){
											localFileModifications[taskInfo.filePath] = stat.mtimeMs
											remoteFileSizes[taskInfo.filePath] = stat.size
											remoteFileUUIDs[taskInfo.filePath] = newFileUUID
											localFileExisted[taskInfo.path] = true
										}
									}
									catch(e){
										console.log(e)
									}

									syncTaskLimiterSemaphoreRelease()

									return setTimeout(() => {
										removeFromSyncTasks(taskId)
									}, syncTimeout)
								})
							}).catch((err) => {
								console.log(err)

								syncTaskLimiterSemaphoreRelease()

								return setTimeout(() => {
									removeFromSyncTasks(taskId)
								}, syncTimeout)
							})
						}

						if(task == "upload"){
							if(!res.data.exists){
								doUpload()
							}
							else{
								try{
									let stat = await fs.stat(winOrUnixFilePath(taskInfo.realPath))

									if(stat){
										localFileModifications[taskInfo.filePath] = stat.mtimeMs
										remoteFileSizes[taskInfo.filePath] = stat.size
										remoteFileUUIDs[taskInfo.filePath] = res.data.uuid
										localFileExisted[taskInfo.path] = true
									}
								}
								catch(e){
									console.log(e)
								}

								syncTaskLimiterSemaphoreRelease()

								return setTimeout(() => {
									removeFromSyncTasks(taskId)
								}, syncTimeout)
							}
						}
						else{
							if(res.data.exists){
								apiRequest("/v1/file/archive", {
									apiKey: await getUserAPIKey(),
									uuid: res.data.uuid,
									updateUUID: newFileUUID
								}, (err, res) => {
									if(err){
										console.log(err)

										syncTaskLimiterSemaphoreRelease()

										return setTimeout(() => {
											removeFromSyncTasks(taskId)
										}, syncTimeout)
									}

									if(!res.status){
										console.log(res.message)

										syncTaskLimiterSemaphoreRelease()

										return setTimeout(() => {
											removeFromSyncTasks(taskId)
										}, syncTimeout)
									}

									doUpload()
								})
							}
							else{
								syncTaskLimiterSemaphoreRelease()

								return setTimeout(() => {
									removeFromSyncTasks(taskId)
								}, syncTimeout)
							}
						}
					})
				break
				default:
					return false
				break
			}
		break
		case "local":
			switch(task){
				case "mkdir":
					let dirPath = userHomePath + "/" + taskInfo.path

					fs.mkdir(winOrUnixFilePath(dirPath), {
						recursive: true,
						overwrite: true
					}, (err) => {
						addFinishedSyncTaskToStorage(where, task, JSON.stringify(taskInfo))

						localFolderExisted[taskInfo.path] = true

						skipCheckLocalExistedFoldersAndFiles = (unixTimestamp() + 60)

						syncTaskLimiterSemaphoreRelease()

						return setTimeout(() => {
							removeFromSyncTasks(taskId)
						}, syncTimeout)
					})
				break
				case "rmdir":
					let rmdirPath = userHomePath + "/" + taskInfo.path

					rimraf(winOrUnixFilePath(rmdirPath), () => {
						addFinishedSyncTaskToStorage(where, task, JSON.stringify(taskInfo))

						delete localFolderExisted[taskInfo.path]

						return removeFoldersAndFilesFromExistingDir(taskInfo.path, () => {
							removeFromDeletingLocalFolders(taskId)
							
							syncTaskLimiterSemaphoreRelease()

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						})
					})
				break
				case "rmfile":
					let rmFilePath = userHomePath + "/" + taskInfo.path

					return rimraf(winOrUnixFilePath(rmFilePath), () => {
						addFinishedSyncTaskToStorage(where, task, JSON.stringify(taskInfo))

						delete localFileModifications[taskInfo.filePath]
						delete remoteFileSizes[taskInfo.filePath]
						delete remoteFileUUIDs[taskInfo.filePath]
						delete localFileExisted[taskInfo.filePath]

						syncTaskLimiterSemaphoreRelease()

						return setTimeout(() => {
							removeFromSyncTasks(taskId)
						}, syncTimeout)
					})
				break
				case "download":
				case "update":
					if(taskInfo.file.size <= 0){
						syncTaskLimiterSemaphoreRelease()

						return setTimeout(() => {
							removeFromSyncTasks(taskId)
						}, syncTimeout)
					}

					if(taskInfo.file.size >= diskSpaceFree){
						console.log("NO SPACE AVAILABLE")

						syncTaskLimiterSemaphoreRelease()

						return setTimeout(() => {
							removeFromSyncTasks(taskId)
						}, syncTimeout)
					}

					let filePath = userHomePath + "/" + taskInfo.path

					downloadFileToLocal(winOrUnixFilePath(filePath), taskInfo.file, true, async (err) => {
						if(err){
							console.log(err)

							syncTaskLimiterSemaphoreRelease()

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						try{
							let stat = await fs.stat(winOrUnixFilePath(filePath))

							if(stat){
								localFileModifications[taskInfo.filePath] = stat.mtimeMs
								remoteFileSizes[taskInfo.filePath] = stat.size
							}
						}
						catch(e){
							console.log(e)
						}

						localFileExisted[taskInfo.path] = true
						remoteFileUUIDs[taskInfo.filePath] = taskInfo.file.uuid

						skipCheckLocalExistedFoldersAndFiles = (unixTimestamp() + 60)

						console.log(taskInfo.path + " " + task + " done")

						addFinishedSyncTaskToStorage(where, task, JSON.stringify(taskInfo))

						syncTaskLimiterSemaphoreRelease()

						return setTimeout(() => {
							removeFromSyncTasks(taskId)
						}, syncTimeout)
					})
				break
				default:
					return false
				break
			}
		break
		default:
			return false
		break
	}
}

const doSync = async () => {
	if(isSyncing || isIndexing){
		return false
	}

	if(syncingPaused || isDoingRealtimeWork){
		return false
	}

	isSyncing = true

	let releaseSyncSemaphore = await doSyncSempahore.acquire()

	try{
		var userMasterKeys = await getUserMasterKeys()
	}
	catch(e){
		console.log(e)

		isSyncing = false
		isIndexing = false

		releaseSyncSemaphore()

		return false
	}

	let folderUUID = await getSyncFolderUUID()

	try{
  		fs.accessSync(winOrUnixFilePath(userSyncDir), fs.constants.R_OK | fs.constants.W_OK)
	}
	catch(e){
		showBigErrorMessage("No permissions to read/write sync directory. Please change permissions or sync path.")

		isSyncing = false
		isIndexing = false

		releaseSyncSemaphore()
		clearCurrentSyncTasksExtra()

  		throw new Error(e)
	}

	fs.access(winOrUnixFilePath(userSyncDir), async (err) => {
		if(err){
			if(err.code == "ENOENT"){
				try{
					let userEmail = await db.get("userEmail")

					await db.put(userEmail + "_localFileModifications", JSON.stringify({}))
					await db.put(userEmail + "_remoteFileUUIDs", JSON.stringify({}))
					await db.put(userEmail + "_remoteFileSizes", JSON.stringify({}))

					await db.put(userEmail + "_lastRemoteSyncFolders", JSON.stringify({}))
					await db.put(userEmail + "_lastRemoteSyncFiles", JSON.stringify({}))
					await db.put(userEmail + "_lastLocalSyncFolders", JSON.stringify({}))
					await db.put(userEmail + "_lastLocalSyncFiles", JSON.stringify({}))

					await db.put(userEmail + "_localFileExisted", JSON.stringify({}))
					await db.put(userEmail + "_localFolderExisted", JSON.stringify({}))

					await db.put(userEmail + "_remoteDecryptedCache", JSON.stringify({}))
				}
				catch(e){
					console.log(e)
				}

				localFileModifications = {}
				remoteFileUUIDs = {}
				remoteFileSizes = {}

				lastRemoteSyncFolders = {}
				lastRemoteSyncFiles = {}
				lastLocalSyncFolders = {}
				lastLocalSyncFiles = {}

				localFileExisted = {}
				localFolderExisted = {}

				remoteDecryptedCache = {}

				releaseSyncSemaphore()
				clearCurrentSyncTasksExtra()

				return ipcRenderer.send("exit-app")
			}
			else{
				console.log(err)
			}
		}
		else{
			getRemoteSyncDirContents(folderUUID, (err, remoteFolders, remoteFiles) => {
				if(err){
					isSyncing = false
					isIndexing = false

					releaseSyncSemaphore()
					clearCurrentSyncTasksExtra()

					return console.log(err)
				}

				getLocalSyncDirContents(async (err, localFolders, localFiles) => {
					if(err){
						isSyncing = false
						isIndexing = false

						releaseSyncSemaphore()
						clearCurrentSyncTasksExtra()

						return console.log(err)
					}

					if(syncingPaused || isDoingRealtimeWork){
						isSyncing = false
						isIndexing = false

						releaseSyncSemaphore()
						clearCurrentSyncTasksExtra()

						return false
					}

					if(!reloadAll){
						//Did the remote and local dataset even change? If not we can save cpu usage by skipping the sync cycle
						let currentDatasetHash = JSON.stringify(localFolders) + JSON.stringify(localFiles) + JSON.stringify(remoteFolders) + JSON.stringify(remoteFiles) 

						if(typeof lastDatasetHash !== "undefined"){
							if(currentDatasetHash == lastDatasetHash){
								//console.log("Dataset didnt change, skipping syncing cycle.")

								let currLastSavedDataHash = currentDatasetHash

								if(typeof lastSavedDataHash !== "undefined"){
									if(currLastSavedDataHash == lastSavedDataHash){
										//console.log("Last write dataset didnt change, not writing.")

										return setTimeout(() => {
											isSyncing = false
											isIndexing = false

											releaseSyncSemaphore()
											clearCurrentSyncTasksExtra()
										}, 1000)
									}
								}

								lastSavedDataHash = currLastSavedDataHash

								lastRemoteSyncFolders = remoteFolders
								lastRemoteSyncFiles = remoteFiles
								lastLocalSyncFolders = localFolders
								lastLocalSyncFiles = localFiles

								try{
									let userEmail = await db.get("userEmail")

									await db.put(userEmail + "_localFileModifications", JSON.stringify(localFileModifications))
									await db.put(userEmail + "_remoteFileUUIDs", JSON.stringify(remoteFileUUIDs))
									await db.put(userEmail + "_remoteFileSizes", JSON.stringify(remoteFileSizes))

									await db.put(userEmail + "_lastRemoteSyncFolders", JSON.stringify(lastRemoteSyncFolders))
									await db.put(userEmail + "_lastRemoteSyncFiles", JSON.stringify(lastRemoteSyncFiles))
									await db.put(userEmail + "_lastLocalSyncFolders", JSON.stringify(lastLocalSyncFolders))
									await db.put(userEmail + "_lastLocalSyncFiles", JSON.stringify(lastLocalSyncFiles))

									await db.put(userEmail + "_localFileExisted", JSON.stringify(localFileExisted))
									await db.put(userEmail + "_localFolderExisted", JSON.stringify(localFolderExisted))
								}
								catch(e){
									console.log(e)
								}

								return setTimeout(() => {
									isSyncing = false
									isIndexing = false

									releaseSyncSemaphore()
									clearCurrentSyncTasksExtra()
								}, 1000)
							}
						}

						lastDatasetHash = currentDatasetHash
					}

					if(syncingPaused || isDoingRealtimeWork){
						isSyncing = false
						isIndexing = false

						releaseSyncSemaphore()
						clearCurrentSyncTasksExtra()

						return false
					}

					isIndexing = true

					currentDeletingLocalFolders = []
					currentDeletingRemoteFolders = []

					if(typeof lastLocalSyncFiles !== "undefined" && typeof lastRemoteSyncFiles !== "undefined" && typeof lastRemoteSyncFolders !== "undefined"){
						if(syncMode == "twoWay" || syncMode == "cloudToLocal"){
							//Did the remote file UUID (versioning) change?
							for(let prop in remoteFiles){
								if(typeof localFiles[prop] !== "undefined" && typeof lastLocalSyncFiles[prop] !== "undefined" && typeof lastRemoteSyncFiles[prop] !== "undefined"){
									let filePath = userHomePath + "/" + prop

									if(typeof remoteFileUUIDs[filePath] == "undefined"){
										remoteFileUUIDs[filePath] = remoteFiles[prop].uuid
									}
									else{
										if(remoteFileUUIDs[filePath] !== remoteFiles[prop].uuid){
											if(remoteFiles[prop].size > 0){
												syncTask("local", "update", {
													path: prop,
													file: remoteFiles[prop],
													filePath: filePath,
													size: remoteFiles[prop].size
												}, userMasterKeys)
											}
										}
									}
								}
							}
						}

						if(syncMode == "twoWay" || syncMode == "localToCloud"){
							//Did the local mod time change from previous sync?
							for(let prop in localFiles){
								if(typeof remoteFiles[prop] !== "undefined" && typeof lastLocalSyncFiles[prop] !== "undefined" && typeof lastRemoteSyncFiles[prop] !== "undefined"){
									let filePath = userHomePath + "/" + prop
									let taskIdPath = prop

									let fileStat = {}

									fileStat.mtimeMs = localFiles[prop].modTime

									if(fileStat){
										if(typeof localFileModifications[filePath] == "undefined"){
											if(fileStat.mtimeMs > 1399784066403){
												localFileModifications[filePath] = fileStat.mtimeMs
											}
											else{
												delete localFileModifications[filePath]
											}
										}
										else{
											if(fileStat.mtimeMs > localFileModifications[filePath] && fileStat.mtimeMs > 1399784066403 && localFileModifications[filePath] > 1399784066403){
												let fileParentPath = prop.split("/")

												fileParentPath = fileParentPath.splice(0, (fileParentPath.length - 1)).join("/")

												if(fileParentPath !== "Filen Sync/"){
													fileParentPath = fileParentPath + "/"
												}

												if(typeof remoteSyncFolders[fileParentPath] !== "undefined"){
													syncTask("remote", "update", {
														path: prop,
														realPath: userHomePath + "/" + prop,
														name: localFiles[prop].name,
														parent: remoteSyncFolders[fileParentPath].uuid,
														filePath: filePath
													}, userMasterKeys)
												}
											}
										}
									}
								}
							}
						}

						//Is the local file size somehow different (corrupt downloads etc)?
						/*for(let prop in remoteFiles){
							if(typeof localFiles[prop] !== "undefined" && typeof lastLocalSyncFiles[prop] !== "undefined" && typeof lastRemoteSyncFiles[prop] !== "undefined"){
								let filePath = userHomePath + "/" + prop

								if(typeof remoteFileSizes[filePath] == "undefined"){
									remoteFileSizes[filePath] = remoteFiles[prop].size
								}
								else{
									if(remoteFileSizes[filePath] !== remoteFiles[prop].size){
										if(remoteFiles[prop].size > 0){
											syncTask("local", "update", {
												path: prop,
												file: remoteFiles[prop],
												filePath: filePath,
												size: remoteFiles[prop].size
											}, userMasterKeys)
										}
									}
								}
							}
						}

						//Is the local file size somehow different (corrupt downloads etc)?
						for(let prop in remoteFiles){
							if(typeof localFiles[prop] !== "undefined" && typeof lastLocalSyncFiles[prop] !== "undefined" && typeof lastRemoteSyncFiles[prop] !== "undefined"){
								let filePath = userHomePath + "/" + prop
								let localData = localFiles[prop]

								if(typeof localData !== "undefined"){
									if(typeof localData.size !== "undefined"){
										if(localData.size !== remoteFiles[prop].size){
											if(remoteFiles[prop].size > 0){
												syncTask("local", "update", {
													path: prop,
													file: remoteFiles[prop],
													filePath: filePath,
													size: remoteFiles[prop].size
												}, userMasterKeys)
											}
										}
									}
								}
							}
						}*/

						//Create directory locally because we dont have it or delete remote dir because we deleted the local one
						for(let prop in remoteFolders){
							if(typeof localFolders[prop] == "undefined" && prop !== "Filen Sync/"){
								if(syncMode == "twoWay"){
									if(typeof lastRemoteSyncFolders[prop] !== "undefined" && typeof localFolderExisted[prop] !== "undefined"){
										let isDeletingParentFolder = false

										if(currentDeletingRemoteFolders.length > 0){
											for(let i = 0; i < currentDeletingRemoteFolders.length; i++){
												if(prop.indexOf(currentDeletingRemoteFolders[i]) !== -1){
													isDeletingParentFolder = true
												}
											}
										}
										
										if(!isDeletingParentFolder){
											currentDeletingRemoteFolders.push(prop)

											syncTask("remote", "rmdir", {
												path: prop,
												name: lastRemoteSyncFolders[prop].name,
												dir: lastRemoteSyncFolders[prop]
											}, userMasterKeys)
										}
									}
									else{
										syncTask("local", "mkdir", {
											path: prop,
											name: remoteFolders[prop].name
										}, userMasterKeys)
									}
								}
								else if(syncMode == "cloudToLocal"){
									syncTask("local", "mkdir", {
										path: prop,
										name: remoteFolders[prop].name
									}, userMasterKeys)
								}
								else if(syncMode == "localToCloud"){
									if(typeof lastRemoteSyncFolders[prop] !== "undefined" && typeof localFolderExisted[prop] !== "undefined"){
										let isDeletingParentFolder = false

										if(currentDeletingRemoteFolders.length > 0){
											for(let i = 0; i < currentDeletingRemoteFolders.length; i++){
												if(prop.indexOf(currentDeletingRemoteFolders[i]) !== -1){
													isDeletingParentFolder = true
												}
											}
										}
										
										if(!isDeletingParentFolder){
											currentDeletingRemoteFolders.push(prop)

											syncTask("remote", "rmdir", {
												path: prop,
												name: lastRemoteSyncFolders[prop].name,
												dir: lastRemoteSyncFolders[prop]
											}, userMasterKeys)
										}
									}
								}
							}
						}

						//Create directory remotely because the server does not have it
						for(let prop in localFolders){
							if(typeof remoteFolders[prop] == "undefined" && prop !== "Filen Sync/"){
								if(syncMode == "twoWay"){
									if(typeof lastRemoteSyncFolders[prop] !== "undefined" && typeof localFolderExisted[prop] !== "undefined"){
										let isDeletingParentFolder = false

										if(currentDeletingLocalFolders.length > 0){
											for(let i = 0; i < currentDeletingLocalFolders.length; i++){
												if(prop.indexOf(currentDeletingLocalFolders[i]) !== -1){
													isDeletingParentFolder = true
												}
											}
										}

										if(!isDeletingParentFolder){
											currentDeletingLocalFolders.push(prop)

											syncTask("local", "rmdir", {
												path: prop,
												name: lastRemoteSyncFolders[prop].name
											}, userMasterKeys)
										}

										currentDeletingLocalFolders.push(prop)						
									}
									else{
										let parentPath = prop.split("/")

										parentPath.pop()
										parentPath.pop()

										parentPath = parentPath.join("/") + "/"

										if(parentPath == "/"){
											parentPath = "Filen Sync/"
										}

										if(typeof remoteSyncFolders[parentPath] !== "undefined"){
											let folderName = prop

											if(prop.slice(-1) == "/"){
												folderName = prop.substring(0, (prop.length - 1))
											}

											folderName = folderName.split("/")
											folderName = folderName[folderName.length - 1]

											syncTask("remote", "mkdir", {
												path: prop,
												name: folderName,
												parent: remoteSyncFolders[parentPath].uuid
											}, userMasterKeys)
										}
									}
								}
								else if(syncMode == "cloudToLocal"){
									if(typeof lastRemoteSyncFolders[prop] !== "undefined" && typeof localFolderExisted[prop] !== "undefined"){
										let isDeletingParentFolder = false

										if(currentDeletingLocalFolders.length > 0){
											for(let i = 0; i < currentDeletingLocalFolders.length; i++){
												if(prop.indexOf(currentDeletingLocalFolders[i]) !== -1){
													isDeletingParentFolder = true
												}
											}
										}

										if(!isDeletingParentFolder){
											currentDeletingLocalFolders.push(prop)

											syncTask("local", "rmdir", {
												path: prop,
												name: lastRemoteSyncFolders[prop].name
											}, userMasterKeys)
										}

										currentDeletingLocalFolders.push(prop)						
									}
								}
								else if(syncMode == "localToCloud"){
									let parentPath = prop.split("/")

									parentPath.pop()
									parentPath.pop()

									parentPath = parentPath.join("/") + "/"

									if(parentPath == "/"){
										parentPath = "Filen Sync/"
									}

									if(typeof remoteSyncFolders[parentPath] !== "undefined"){
										let folderName = prop

										if(prop.slice(-1) == "/"){
											folderName = prop.substring(0, (prop.length - 1))
										}

										folderName = folderName.split("/")
										folderName = folderName[folderName.length - 1]

										syncTask("remote", "mkdir", {
											path: prop,
											name: folderName,
											parent: remoteSyncFolders[parentPath].uuid
										}, userMasterKeys)
									}
								}
							}
						}

						//Download file to local because we dont have it
						for(let prop in remoteFiles){
							if(typeof localFiles[prop] == "undefined"){
								let filePath = userHomePath + "/" + prop

								let isDeletingParentFolder = false
								let isDeletingParentFolderLocal = false

								if(currentDeletingRemoteFolders.length > 0){
									for(let i = 0; i < currentDeletingRemoteFolders.length; i++){
										if(prop.indexOf(currentDeletingRemoteFolders[i]) !== -1){
											isDeletingParentFolder = true
										}
									}
								}

								if(currentDeletingLocalFolders.length > 0){
									for(let i = 0; i < currentDeletingLocalFolders.length; i++){
										if(prop.indexOf(currentDeletingLocalFolders[i]) !== -1){
											isDeletingParentFolderLocal = true
										}
									}
								}

								if(syncMode == "twoWay"){
									if(typeof lastRemoteSyncFiles[prop] !== "undefined" && typeof localFileExisted[prop] !== "undefined"){
										if(!isDeletingParentFolder){
											syncTask("remote", "rmfile", {
												path: prop,
												name: lastRemoteSyncFiles[prop].name,
												file: lastRemoteSyncFiles[prop],
												filePath: filePath
											}, userMasterKeys)
										}
									}
									else{
										if(remoteFiles[prop].size > 0 && !isDeletingParentFolder && !isDeletingParentFolderLocal){
											syncTask("local", "download", {
												path: prop,
												file: remoteFiles[prop],
												filePath: filePath
											}, userMasterKeys)
										}
									}
								}
								else if(syncMode == "cloudToLocal"){
									if(remoteFiles[prop].size > 0 && !isDeletingParentFolder && !isDeletingParentFolderLocal){
										syncTask("local", "download", {
											path: prop,
											file: remoteFiles[prop],
											filePath: filePath
										}, userMasterKeys)
									}
								}
								else if(syncMode == "localToCloud"){
									if(typeof lastRemoteSyncFiles[prop] !== "undefined" && typeof localFileExisted[prop] !== "undefined"){
										if(!isDeletingParentFolder){
											syncTask("remote", "rmfile", {
												path: prop,
												name: lastRemoteSyncFiles[prop].name,
												file: lastRemoteSyncFiles[prop],
												filePath: filePath
											}, userMasterKeys)
										}
									}
								}
							}
						}

						//Upload file to remote because the server does not have it
						for(let prop in localFiles){
							if(typeof remoteFiles[prop] == "undefined"){
								let filePath = userHomePath + "/" + prop

								if(syncMode == "twoWay"){
									if(typeof lastRemoteSyncFiles[prop] !== "undefined" && typeof localFileExisted[prop] !== "undefined"){
										let isDeletingParentFolder = false

										if(currentDeletingLocalFolders.length > 0){
											for(let i = 0; i < currentDeletingLocalFolders.length; i++){
												if(prop.indexOf(currentDeletingLocalFolders[i]) !== -1){
													isDeletingParentFolder = true
												}
											}
										}

										if(!isDeletingParentFolder){
											syncTask("local", "rmfile", {
												path: prop,
												name: lastRemoteSyncFiles[prop].name,
												filePath: filePath
											}, userMasterKeys)
										}
									}
									else{
										let fileParentPath = prop.split("/")

										fileParentPath = fileParentPath.splice(0, (fileParentPath.length - 1)).join("/")

										if(fileParentPath !== "Filen Sync/"){
											fileParentPath = fileParentPath + "/"
										}

										if(typeof remoteSyncFolders[fileParentPath] !== "undefined"){
											let fileName = prop

											fileName = prop.split("/")
											fileName = fileName[fileName.length - 1]

											syncTask("remote", "upload", {
												path: prop,
												realPath: userHomePath + "/" + prop,
												name: fileName,
												parent: remoteSyncFolders[fileParentPath].uuid,
												filePath: filePath
											}, userMasterKeys)
										}
									}
								}
								else if(syncMode == "cloudToLocal"){
									if(typeof lastRemoteSyncFiles[prop] !== "undefined" && typeof localFileExisted[prop] !== "undefined"){
										let isDeletingParentFolder = false

										if(currentDeletingLocalFolders.length > 0){
											for(let i = 0; i < currentDeletingLocalFolders.length; i++){
												if(prop.indexOf(currentDeletingLocalFolders[i]) !== -1){
													isDeletingParentFolder = true
												}
											}
										}

										if(!isDeletingParentFolder){
											syncTask("local", "rmfile", {
												path: prop,
												name: lastRemoteSyncFiles[prop].name,
												filePath: filePath
											}, userMasterKeys)
										}
									}
								}
								else if(syncMode == "localToCloud"){
									let fileParentPath = prop.split("/")

									fileParentPath = fileParentPath.splice(0, (fileParentPath.length - 1)).join("/")

									if(fileParentPath !== "Filen Sync/"){
										fileParentPath = fileParentPath + "/"
									}

									if(typeof remoteSyncFolders[fileParentPath] !== "undefined"){
										let fileName = prop

										fileName = prop.split("/")
										fileName = fileName[fileName.length - 1]

										syncTask("remote", "upload", {
											path: prop,
											realPath: userHomePath + "/" + prop,
											name: fileName,
											parent: remoteSyncFolders[fileParentPath].uuid,
											filePath: filePath
										}, userMasterKeys)
									}
								}
							}
						}
					}

					isIndexing = false

					updateVisualStatus()

					let waitForQueueToFinishInterval = setInterval(async () => {
						if(currentSyncTasks.length <= 0){ //no extra
							clearInterval(waitForQueueToFinishInterval)

							updateVisualStatus()

							lastRemoteSyncFolders = remoteFolders
							lastRemoteSyncFiles = remoteFiles
							lastLocalSyncFolders = localFolders
							lastLocalSyncFiles = localFiles

							localDataChanged = true

							getLocalSyncDirContents(async (err, folders, files) => {
								if(err){
									console.log(err)							
								}
								else{
									localFolderExisted = folders
									localFileExisted = files
								}

								try{
									let userEmail = await db.get("userEmail")

									await db.put(userEmail + "_localFileModifications", JSON.stringify(localFileModifications))
									await db.put(userEmail + "_remoteFileUUIDs", JSON.stringify(remoteFileUUIDs))
									await db.put(userEmail + "_remoteFileSizes", JSON.stringify(remoteFileSizes))

									await db.put(userEmail + "_lastRemoteSyncFolders", JSON.stringify(lastRemoteSyncFolders))
									await db.put(userEmail + "_lastRemoteSyncFiles", JSON.stringify(lastRemoteSyncFiles))
									await db.put(userEmail + "_lastLocalSyncFolders", JSON.stringify(lastLocalSyncFolders))
									await db.put(userEmail + "_lastLocalSyncFiles", JSON.stringify(lastLocalSyncFiles))

									await db.put(userEmail + "_localFileExisted", JSON.stringify(localFileExisted))
									await db.put(userEmail + "_localFolderExisted", JSON.stringify(localFolderExisted))

									await db.put(userEmail + "_remoteDecryptedCache", JSON.stringify(remoteDecryptedCache))
								}
								catch(e){
									console.log(e)
								}

								return setTimeout(() => {
									console.log("Sync cycle done.")

									releaseSyncSemaphore()
									clearCurrentSyncTasksExtra()
										
									isIndexing = false
									isSyncing = false
									localDataChanged = true
									reloadAll = false

									writeSyncTasks()
								}, syncTimeout)
							})
						}
					}, 50)
				})
			})
		}
	})
}

const setLocalDataChangedTrue = () => {
	//if(isSyncing || isIndexing || currentSyncTasks.length > 0 || syncingPaused){
	//	return setTimeout(setLocalDataChangedTrue, 1000)
	//}

	return localDataChanged = true
}

const initChokidar = async () => {
	try{
  		fs.accessSync(winOrUnixFilePath(userSyncDir), fs.constants.R_OK | fs.constants.W_OK)
	}
	catch(e){
		showBigErrorMessage("No permissions to read/write sync directory. Please change permissions or sync path.")

  		throw new Error(e)
	}

	const handleEvent = async (event, ePath) => {
		if(syncMode == "cloudToLocal"){
			return false
		}

		if(isSyncing || isIndexing){
			return setTimeout(() => {
				handleEvent(event, ePath)
			}, 100)
		}

		let taskId = uuidv4()

		currentSyncTasksExtra.push(taskId)

		isDoingRealtimeWork = true

		await new Promise((resolve) => {
			return setTimeout(resolve, 100)
		})

		try{
			await fs.stat(path.join(winOrUnixFilePath(userSyncDir), ePath))
		}
		catch(e){
			if(e.code == "ENOENT"){
				let folderPath = "Filen Sync/" + ePath.split("\\").join("/") + "/"
				let filePath = folderPath.slice(0, (folderPath.length - 1))

				if(typeof lastRemoteSyncFolders[folderPath] !== "undefined" && typeof localFolderExisted[folderPath] !== "undefined"){
					try{
						let userMasterKeys = await getUserMasterKeys()

						syncTask("remote", "rmdir", {
							path: folderPath,
							name: lastRemoteSyncFolders[folderPath].name,
							dir: lastRemoteSyncFolders[folderPath]
						}, userMasterKeys)
					}
					catch(err){
						console.log(err)
					}
				}
				else if(typeof lastRemoteSyncFiles[filePath] !== "undefined" && typeof localFileExisted[filePath] !== "undefined" && typeof userHomePath == "string"){
					try{
						let userMasterKeys = await getUserMasterKeys()

						syncTask("remote", "rmfile", {
							path: filePath,
							name: lastRemoteSyncFiles[filePath].name,
							file: lastRemoteSyncFiles[filePath],
							filePath: userHomePath + "/" + filePath
						}, userMasterKeys)
					}
					catch(err){
						console.log(err)
					}
				}
			}
		}

		clearTimeout(handleRealtimeWorkTimeout)

		handleRealtimeWorkTimeout = setTimeout(async () => {
			isDoingRealtimeWork = false

			clearCurrentSyncTasksExtra()

			setLocalDataChangedTrue()
		}, 30000)

		return true
	}

	chokidarWatcher = undefined

	try{
		chokidarWatcher = fs.watch(winOrUnixFilePath(userSyncDir), {
			recursive: true,
			persistent: true
		}, (event, ePath) => {
			return handleEvent(event, ePath)
		})
	}
	catch(e){
		showBigErrorMessage("Could not initialize directory watcher.")

		throw new Error(e)
	}

	return setLocalDataChangedTrue()
}

const startSyncing = async () => {
	if(typeof userSyncDir == "undefined"){
		return setTimeout(startSyncing, 1000)
	}

	if(syncStarted){
		return console.log("Syncing already started.")
	}

	syncStarted = true

	checkIfSyncFolderExistsRemote(async (err, exists, uuid) => {
		if(err){
			console.log(err)

			return setTimeout(() => {
				syncStarted = false

				startSyncing()
			}, syncTimeout)
		}

		if(!exists){
			syncStarted = false

			return doSetup()
		}

		try{
			let userEmail = await db.get("userEmail")

			let localFileModificationsDb = await db.get(userEmail + "_localFileModifications")
			let remoteFileUUIDsDb = await db.get(userEmail + "_remoteFileUUIDs")
			let remoteFileSizesDb = await db.get(userEmail + "_remoteFileSizes")

			if(localFileModificationsDb.length > 0){
				localFileModifications = JSON.parse(localFileModificationsDb)
			}

			if(remoteFileUUIDsDb.length > 0){
				remoteFileUUIDs = JSON.parse(remoteFileUUIDsDb)
			}

			if(remoteFileSizesDb.length > 0){
				remoteFileSizes = JSON.parse(remoteFileSizesDb)
			}

			let lastRemoteSyncFoldersDb = await db.get(userEmail + "_lastRemoteSyncFolders")
			let lastRemoteSyncFilesDb = await db.get(userEmail + "_lastRemoteSyncFiles")
			let lastLocalSyncFoldersDb = await db.get(userEmail + "_lastLocalSyncFolders")
			let lastLocalSyncFilesDb = await db.get(userEmail + "_lastLocalSyncFiles")

			if(lastRemoteSyncFoldersDb.length > 0){
				lastRemoteSyncFolders = JSON.parse(lastRemoteSyncFoldersDb)
			}

			if(lastRemoteSyncFilesDb.length > 0){
				lastRemoteSyncFiles = JSON.parse(lastRemoteSyncFilesDb)
			}

			if(lastLocalSyncFoldersDb.length > 0){
				lastLocalSyncFolders = JSON.parse(lastLocalSyncFoldersDb)
			}

			if(lastLocalSyncFilesDb.length > 0){
				lastLocalSyncFiles = JSON.parse(lastLocalSyncFilesDb)
			}

			let localFileExistedDb = await db.get(userEmail + "_localFileExisted")
			let localFolderExistedDb = await db.get(userEmail + "_localFolderExisted")

			if(localFileExistedDb.length > 0){
				localFileExisted = JSON.parse(localFileExistedDb)
			}

			if(localFolderExistedDb.length > 0){
				localFolderExisted = JSON.parse(localFolderExistedDb)
			}

			let remoteDecryptedCacheDb = await db.get(userEmail + "_remoteDecryptedCache")

			if(remoteDecryptedCacheDb.length > 0){
				remoteDecryptedCache = JSON.parse(remoteDecryptedCacheDb)
			}
		}
		catch(e){
			console.log(e)
		}

		initChokidar()

		console.log("Syncing started.")

		doSync()

		setInterval(doSync, syncTimeout)

		return true
	})
}

const reload = (type) => {
	window.location.reload()

	return routeTo(type)
}

const doLogout = async () => {
	syncingPaused = true
	syncStarted = false

	try{
		await db.clear()
	}
	catch(e){
		showBigErrorMessage("Could not clear the local database, please restart the application and try again.")

		return console.log(e)
	}

	remote.app.relaunch()
	remote.app.exit()

	return true
}

const getDiskSpace = () => {
	const get = () => {
		if(typeof userSyncDir == "undefined"){
			return
		}

		if(userSyncDir.length == 0){
			return
		}

		checkDiskSpace(userSyncDir).then((diskSpace) => {
			diskSpaceFree = diskSpace.free
		}).catch((err) => {
			console.log(err)
		})
	}

	setInterval(() => {
		get()
	}, 15000)
}

const showSettings = () => {
	return ipcRenderer.send("show-settings")
}

const showBigErrorMessage = (msg) => {
	$("#error-screen-msg").html(msg)

	return routeTo("error-screen")
}

const setupErrorReporter = () => {
	window.addEventListener("error", async (e) => {
		try{
			let errObj = {
				message: e.message,
				file: e.filename,
				line: e.lineno,
				column: e.colno,
				stack: {
					message: e.error.message || "none",
					trace: e.error.stack || "none"
				},
				cancelable: e.cancelable,
				timestamp: e.timeStamp,
				type: e.type,
				isTrusted: e.isTrusted,
				url: window.location.href || "none"
			}

			$.ajax({
				type: "POST",
				url: getAPIServer() + "/v1/error/report",
				contentType: "application/json",
				data: JSON.stringify({
					apiKey: await getUserAPIKey(),
					error: JSON.stringify(errObj),
					platform: "desktop"
				}),
				processData: false,
				cache: false,
				timeout: 180000,
				success: (res) => {
					return console.log("Error reported to service")
				},
				error: (err) => {
					return false
				}
			})
		}
		catch(e){
			console.log(e)
		}
	})
}

const updateVisualStatus = async () => {
	let darkMode = await darkModeEnabled()
	let headerStatus = ""
	let tooltipText = ""
	let totalSyncTasks = (currentSyncTasks.length + currentSyncTasksExtra.length) 

	if(totalSyncTasks > 0){
		headerStatus = `
			<center>
				<i class="fas fa-spinner fa-spin"></i>&nbsp;&nbsp;Filen is synchronizing
			</center>
		`

		tooltipText = "Filen Sync v" + currentAppVersion + "\nSynchronizing.."

		$("#sync-mode-select").prop("disabled", true)
	}
	else{
		headerStatus = `
			<center>
				<img id="header-icon" src="` + (darkMode ? `../img/header/16x16_gray.png` : `../img/header/16x16_black.png`) + `">&nbsp;&nbsp;Filen is up to date
			</center>
		`

		tooltipText = "Filen Sync v" + currentAppVersion + "\nUp to date"

		$("#sync-mode-select").prop("disabled", false)
	}

	if(lastHeaderStatus !== headerStatus){
		$("#header-status").html(headerStatus)

		lastHeaderStatus = headerStatus
	}

	if(lastTooltipText !== tooltipText){
		lastTooltipText = tooltipText

		ipcRenderer.send("set-tray-tooltip", {
			tooltip: tooltipText,
			tasks: totalSyncTasks
		})
	}
}

const setupIntervals = () => {
	setInterval(() => {
		ipcRenderer.send("is-syncing-paused", {
			paused: syncingPaused
		})

		ipcRenderer.send("is-syncing", {
			isSyncing: isSyncing
		})
	}, 100)

	updateVisualStatus()

	setInterval(updateVisualStatus, 5000)
}

const darkModeEnabled = async () => {
	let enabled = false

	try{
		let isEnabled = await db.get("darkModeEnabled")

		if(isEnabled == "true"){
			enabled = true
		}
		else{
			enabled = false
		}
	}
	catch(e){
		/*try{
			if(window.matchMedia("(prefers-color-scheme: dark)").matches){
				await db.put("darkModeEnabled", "true")

				enabled = true
			}
			else{
				await db.put("darkModeEnabled", "false")

				enabled = false
			}
		}
		catch(err){
			enabled = false
		}*/

		await db.put("darkModeEnabled", "true")

		enabled = true
	}

	return enabled
}

const toggleDarkMode = async () => {
	let enabled = await darkModeEnabled()

	try{
		await db.put("darkModeEnabled", (!enabled).toString())
	}
	catch(e){
		console.log(e)

		return false
	}

	initDarkOrLightMode()

	return true
}

const initDarkOrLightMode = async () => {
	let darkModeOn = await darkModeEnabled()

	$("#dark-css").remove()

	if(darkModeOn){
		$("head").append(`
			<link rel="stylesheet" id="dark-css" href="../style/app.dark.css">
		`)

		$("#header-icon").attr("src", "../img/header/16x16_gray.png")
		$("#login-icon").attr("src", "../img/header/16x16_gray.png")
		$("#sync-task-loader").attr("src", "../img/splash_dark.png")
		$("#big-loader").attr("src", "../img/splash_dark.png")

		$("#enable-darkmode-toggle").prop("checked", true)
	}
	else{
		$("#header-icon").attr("src", "../img/header/16x16_black.png")
		$("#login-icon").attr("src", "../img/header/16x16_black.png")
		$("#sync-task-loader").attr("src", "../img/splash_white.png")
		$("#big-loader").attr("src", "../img/splash_white.png")

		$("#enable-darkmode-toggle").prop("checked", false)
	}

	return true
}

const init = async () => {
	initDarkOrLightMode()
	initIPC()
	initFns()
	getDiskSpace()
	setupErrorReporter()
	setupIntervals()

	let loggedIn = false

	try{
		loggedIn = await isLoggedIn()

		console.log("isLoggedIn", loggedIn)
	}
	catch(e){
		console.log(e)

		return routeTo("login")
	}

	if(!loggedIn){
		return routeTo("login")
	}

	routeTo("big-loading")

	doSetup((err) => {
		if(err){
			console.log(err)

			return showBigErrorMessage("Error while trying to setup the client.")
		}

		return routeTo("syncs")
	})
}

window.addEventListener("blur", () => {
	if(is.dev()){
		return false
	}

	if(dontHideOnBlur){
		return setTimeout(() => {
			dontHideOnBlur = false
		}, 1000)
	}

	return ipcRenderer.send("minimize")
})

window.onload = () => {
	ipcRenderer.send("renderer-ready")

	return init()
}