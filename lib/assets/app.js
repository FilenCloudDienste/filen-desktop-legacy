process.noAsar = true

//really bad practice, but we dont want our app to spit out errors and look like its made by a 10 year old
process.on("uncaughtException", (err) => {
  	console.log("Caught exception:", err)
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

let db = undefined

try{
	if(process.platform == "linux" || process.platform == "darwin"){
		db = level((electron.app || electron.remote.app).getPath("userData") + "/level")
	}
	else{
		db = level((electron.app || electron.remote.app).getPath("userData") + "/db/level")
	}
}
catch(e){
	console.log(e)

	try{
		ipcRenderer.send("exit-app")
	}
	catch(err){
		console.log(err)
	}
}

const apiSemaphore = new Semaphore(30)
const downloadSemaphore = new Semaphore(15)
const uploadSemaphore = new Semaphore(5)
const logSyncTasksSemaphore = new Semaphore(1)

let thisDeviceId = undefined
let isIndexing = false
let updateUserKeysPKTries = 0
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
let decryptCryptoJSFolderNameTries = 0
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
let maxDownloadTasks = 10
let currentDownloadThreads = 0
let maxDownloadThreads = 30
let currentUploadTasks = 0
let maxUploadTasks = 10
let currentUploadThreads = 0
let maxUploadThreads = 10
let downloadWriteChunk = {}
let downloadIndex = {}
let downloadWriteStreams = {}
let maxAPICallThreads = 30
let currentAPICallThreads = 0

let savedUserUsage = {}
let syncingPaused = false
let syncTimeout = 5000
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

let appId = undefined
let lastReceivedSyncData = undefined
let firstDataRequest = true
let skipNextRequestData = true

const getAPIServer = () => {
	let servers = [
		"https://api.filen.io",
		"https://api.filen-1.xyz",
		"https://api.filen-2.xyz",
		"https://api.filen-3.xyz",
		"https://api.filen-4.xyz",
		"https://api.filen-5.xyz"
	]

	return servers[getRandomArbitrary(0, (servers.length - 1))]
}

const getDownloadServer = () => {
	let servers = [
		"https://down.filen-1.xyz",
		"https://down.filen-2.xyz",
		"https://down.filen-3.xyz",
		"https://down.filen-4.xyz",
		"https://down.filen-5.xyz"
	]

	return servers[getRandomArbitrary(0, (servers.length - 1))]
}

const getUploadServer = () => {
	let servers = [
		"https://up.filen-1.xyz",
		"https://up.filen-2.xyz",
		"https://up.filen-3.xyz",
		"https://up.filen-4.xyz",
		"https://up.filen-5.xyz"
	]

	return servers[getRandomArbitrary(0, (servers.length - 1))]
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
		timeout: 60000,
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

const hashFn = (val) => {
  	return CryptoJS.SHA1(CryptoJS.SHA512(val).toString()).toString()
}

const hashFnFast = (val) => {
	return val
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

const routeTo = (route) => {
	if(route == "login" || route == "setup" || route == "big-loading" || route == "download-file" || route == "download-folder"){
		$(".header").hide()
	}
	else{
		$(".header").show()
	}

	if(route == "login"){
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

const openSyncFolder = () => {
	if(typeof userSyncDir == "undefined"){
		return
	}

	try{
		shell.openPath(winOrUnixFilePath(userSyncDir)).catch((err) => {
			console.log(err)
		})
	}
	catch(e){
		console.log(e)
	}
}

const initSocket = () => {
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
		if(idleTimeSeconds >= 30){
			return false
		}

		let userMasterKeys = await getUserMasterKeys()

		userMasterKeys = userMasterKeys.reverse()

		let args = undefined

		userMasterKeys.forEach((key) => {
			try{
				let obj = JSON.parse(CryptoJS.AES.decrypt(data.args, key).toString(CryptoJS.enc.Utf8))

				if(obj && typeof obj == "object"){
					args = obj
				}
			}
			catch(e){
				return
			}
		})

		if(typeof args == "undefined"){
			return false
		}

		if(args.type == "download-file"){
			let fileData = args.file

			console.log(fileData)

			routeTo("download-file")

			ipcRenderer.send("open-window")
		}
		else if(args.type == "download-folder"){
			let folderUUID = args.uuid

			if(isCurrentlyDownloadigRemote){
				return
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

			$("#download-folder-change-path-btn").prop("disabled", false)
			$("#download-folder-btn-container").show()
			$("#download-folder-progress-container").hide()
			$("#download-folder-progress-text-container").hide()
			$("#download-folder-foldername-text").html(currentDownloadFolderName)

			routeTo("download-folder")

			ipcRenderer.send("open-window")
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
		url = "/v1/download/dir/link",
		data = {
			uuid: currentDownloadFolderLinkUUID,
			parent: folderUUID,
			password: hashFn(currentDownloadFolderLinkPassword)
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
		else if(currentDownloadFolderIsLink){
			basePath = decryptFolderNameLink(res.data.folders[0].name, currentDownloadFolderLinkKey)
		}
		else{
			basePath = decryptCryptoJSFolderName(res.data.folders[0].name, userMasterKeys)
		}

		if(basePath == "CON_NO_DECRYPT_POSSIBLE_NO_NAME_FOUND_FOR_FOLDER"){
			return callback(new Error("Base path folder name cant decrypt")) 
		}

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
			let thisPath = []

			const build = (parentUUID) => {
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
			else if(currentDownloadFolderIsLink){
				selfName = decryptFolderNameLink(self.name, currentDownloadFolderLinkKey)
			}
			else{
				selfName = decryptCryptoJSFolderName(self.name, userMasterKeys)
			}

			if(selfName !== "CON_NO_DECRYPT_POSSIBLE_NO_NAME_FOUND_FOR_FOLDER"){
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
				let newPath = getPathRecursively(self.uuid)
				
				if(typeof newPath !== "undefined"){
					pathsForFiles[self.uuid] = newPath
					folderPaths[newPath] = folders[self.uuid]
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
					metadata = decryptFileMetadataLink(self.metadata, currentDownloadFolderLinkKey)
				}
				else{
					metadata = decryptFileMetadata(self.metadata, userMasterKeys)
				}

				if(metadata.key !== ""){
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
								parent: self.parent
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

	$("#download-folder-btn-container").hide()
	$("#download-folder-change-path-btn").prop("disabled", true)
	$("#download-folder-progress").attr("aria-valuenow", "0")
	$("#download-folder-progress").css("width", "0%")

	lastDownloadFolderPath = downloadPath
	currentDownloadFolderLoaded[currentDownloadFolderUUID] = 0
	currentDownloadFolderStopped[currentDownloadFolderUUID] = false

	getDownloadFolderContents(currentDownloadFolderUUID, async (err, folders, files) => {
		if(err){
			$("#download-folder-btn-container").show()
			$("#download-folder-change-path-btn").prop("disabled", false)

			return console.log(err)
		}

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
			console.log("all folders created, download files now..")

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

				$("#download-folder-progress-bytes-text").html(formatBytes(currentDownloadFolderLoaded[currentDownloadFolderUUID]) + "/" + formatBytes(totalFolderSize))
				$("#download-folder-progress-percent-text").html(percentDone + "%")

				if(percentDone >= 100 || downloadedFiles >= totalFiles){
					clearInterval(downloadFolderDoneInterval)

					$("#download-folder-progress-percent-text").html("Done")

					isCurrentlyDownloadigRemote = false
					//currentDownloadFolderStopped[currentDownloadFolderUUID] = true
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
}

const changeDownloadFolderPath = () => {
	return ipcRenderer.send("change-download-folder-path")
}

const changeHomePath = () => {
	if(currentSyncTasks.length > 0){
		return false
	}

	syncingPaused = true

	return ipcRenderer.send("open-path-selection")
}

const restartForUpdate = () => {
	return ipcRenderer.send("restart-for-update")
}

const downloadUpdateLink = () => {
	let href = ""

	if(process.platform == "linux"){
		href = "https://cdn.filen.io/sync/updates/Filen%20Sync-setup.AppImage"
	}
	else if(process.platform == "darwin"){
		href = "https://cdn.filen.io/sync/updates/Filen%20Sync-setup.dmg"
	}
	else{
		href = "https://cdn.filen.io/sync/updates/Filen%20Sync-setup.exe"
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

const initIPC = () => {
	ipcRenderer.on("change-download-folder-path-res", (e, data) => {
		$("#download-folder-path-text").val(winOrUnixFilePath(data.path))
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

	ipcRenderer.on("update-available", (e, data) => {
		$("#settings-update-container").show()
	})

	ipcRenderer.on("app-version", (e, data) => {
		$("#settings-client-version-text").html(data.version)
	})

	ipcRenderer.on("open-download-file-screen", (e, data) => {
		routeTo("download-file")

	 	return ipcRenderer.send("download-file-screen-opened")
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
	})

	ipcRenderer.on("user-dirs", (e, data) => {
		userSyncDir = data.userSyncDir
		userHomePath = data.userHomePath
		appPath = data.appPath
		userDownloadPath = data.userDownloadPath

		$("#settings-home-path-text").val(winOrUnixFilePath(userSyncDir))
	})

	ipcRenderer.on("app-platform", (e, data) => {
		appPlatform = data.appPlatform
	})

	ipcRenderer.on("pause-syncing", (e, data) => {
		return syncingPaused = true
	})

	ipcRenderer.on("unpause-syncing", (e, data) => {
		return syncingPaused = false
	})

	ipcRenderer.on("show-big-loading", (e, data) => {
		$("#big-loading-text").html(data.message)

		return routeTo("big-loading")
	})

	ipcRenderer.on("idle-time", (e, data) => {
		idleTimeSeconds = data.seconds
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

				return ipcRenderer.send("rewrite-saved-sync-data-done")
			}
		}, 50)
	})
}

const initFns = () => {
	$(".open-in-browser").click((e) => {
        e.preventDefault()

        try{
        	shell.openExternal(e.target.href).catch((err) => {
				if(err){
					console.log(err)
				}
			})
        }
        catch(e){
        	console.log(e)
        }
   	})

   	$(".header-col").each(function(){
   		$(this).click(() => {
   			routeTo($(this).attr("data-go"))
   		})
   	})

   	$("#login-btn").click(() => {
   		let email = $("#login-email-input").val()
   		let password = $("#login-password-input").val()
   		let twoFactorKey = $("#login-2fa-input").val()

   		if(twoFactorKey.length == 0){
   			twoFactorKey = "XXXXXX"
   		}

   		apiRequest("/v1/login", {
   			email,
   			password,
   			twoFactorKey
   		}, async (err, res) => {
	   		$("#login-password-input").val("")
	   		$("#login-2fa-input").val("")

   			if(err){
   				$("#login-status").html(`
   					<br>
   					<font color="darkred">
   						Request error, please try again later.
   					</font>
   				`).show()

   				return console.log(err)
   			}

   			if(!res.status){
   				$("#login-status").html(`
   					<br>
   					<font color="darkred">
   						` + res.message + `
   					</font>
   				`).show()

				return console.log(res.message)
			}

			$("#login-email-input").val("")

			let masterKeys = hashFn(password)

			if(masterKeys.length < 16){
				$("#login-status").html(`
   					<br>
   					<font color="darkred">
   						Could not decrypt master keys.
   					</font>
   				`).show()

				return console.log("Could not decrypt master keys.")
			}

			try{
				await db.put("isLoggedIn", "true")
				await db.put("userEmail", email)
				await db.put("userAPIKey", res.data.apiKey)
				await db.put("userMasterKeys", masterKeys)
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

			updateUserKeys()

			$("#login-status").html(`
				<br>
				<font color="darkgreen">
					Login successful, please wait..
				</font>
			`).show()

			console.log(res.message)

			$("#big-loading-text").html("Loading..")

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

				syncingPaused = false

				initSocket()
				
				setTimeout(() => {
					startSyncing()
				}, 5000)

				return routeTo("account")
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

const sortObjectArrayByPropLengthASC = (a) => {
	let keyArray = Object.keys(a)
	let object = {}

	keyArray.sort()

	keyArray.forEach(function(item){
		object[item] = a[item]
	})

	return object
}

const winOrUnixFilePath = (path) => {
	if(appPlatform == "windows"){
		return path.split("/").join("\\")
	}
	else{
		return path.split("\\").join("/")
	}
}

const getUserUsage = () => {
	const getUsage = async () => {
		apiRequest("/v1/user/usage", {
			apiKey: await getUserAPIKey()
		}, (err, res) => {
			if(err){
				return console.log(err)
			}

			if(!res.status){
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

	setInterval(getUsage, 60000)
}

const checkIfSyncFolderExistsRemote = async (callback) => {
	apiRequest("/v1/user/dirs", {
		apiKey: await getUserAPIKey()
	}, (err, res) => {
		if(err){
			return callback(err)
		}

		if(!res.status){
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

const fillContent = async (callback) => {
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

		const fillSyncTasks = async () => {
			let syncTasksData = undefined

			try{
				let userEmail = await db.get("userEmail")

				syncTasksData = JSON.parse(await db.get(userEmail + "_finishedSyncTasks"))
			}
			catch(e){
				syncTasksData = undefined
			}

			if(typeof syncTasksData !== "undefined"){
				syncTasksData = syncTasksData.reverse()

				lastSyncTasksData = syncTasksData

				if(syncTasksData.length > 0){
					$("#sync-task-tbody").html("")

					for(let i = 0; i < syncTasksData.length; i++){
						if(i < 100){
							let taskName = ""

							if(syncTasksData[i].where == "remote" && syncTasksData[i].task == "upload"){
								taskName = "Upload"
							}
							else if(syncTasksData[i].where == "remote" && syncTasksData[i].task == "rmdir"){
								taskName = "Trash"
							}
							else if(syncTasksData[i].where == "remote" && syncTasksData[i].task == "rmfile"){
								taskName = "Trash"
							}
							else if(syncTasksData[i].where == "remote" && syncTasksData[i].task == "mkdir"){
								taskName = "Create"
							}
							else if(syncTasksData[i].where == "remote" && syncTasksData[i].task == "update"){
								taskName = "Update"
							}
							else if(syncTasksData[i].where == "local" && syncTasksData[i].task == "download"){
								taskName = "Download"
							}
							else if(syncTasksData[i].where == "local" && syncTasksData[i].task == "rmdir"){
								taskName = "Delete"
							}
							else if(syncTasksData[i].where == "local" && syncTasksData[i].task == "rmfile"){
								taskName = "Delete"
							}
							else if(syncTasksData[i].where == "local" && syncTasksData[i].task == "mkdir"){
								taskName = "Create"
							}
							else if(syncTasksData[i].where == "local" && syncTasksData[i].task == "update"){
								taskName = "Update"
							}

							let fileNameEx = JSON.parse(syncTasksData[i].taskInfo).path.split("/")
							let fileName = fileNameEx[fileNameEx.length - 1]

							if(fileName.length <= 0){
								fileName = fileNameEx[fileNameEx.length - 2]
							}

							$("#sync-task-tbody").append(`
								<li class="list-group-item d-flex justify-content-between align-items-center">
									<span class="badge badge-primary badge-pill">` + taskName + `</span>
    								` + fileName + `
 								</li>
							`)
						}
					}
				}
			}
		}

		clearInterval(fillSyncDataInterval)

		fillSyncTasks()

		fillSyncDataInterval = setInterval(fillSyncTasks, 3000)

		if(typeof callback == "function"){
			return callback(null)
		}
		else{
			return true
		}
	})
}

const doSetup = async (callback) => {
	checkIfSyncFolderExistsRemote(async (err, exists, uuid) => {
		if(err){
			return callback(err)
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
				return console.log(e)
			}
		}

		thisDeviceId = deviceId

		console.log("Device Id: " + thisDeviceId)

		if(exists){
			try{
				await db.put("isSetupDone", "true")
				await db.put("syncFolderUUID", uuid)
			}
			catch(e){
				return callback(e)
			}

			console.log("Sync folder already exists.")

			fillContent((err) => {
				if(err){
					return callback(err)
				}

				return callback(null)
			})
		}
		else{
			try{
				var userMasterKeys = await getUserMasterKeys()
			}
			catch(e){
				return callback(e)
			}

			let syncFolderUUID = uuidv4()

			apiRequest("/v1/dir/create", {
				apiKey: await getUserAPIKey(),
				uuid: syncFolderUUID,
				name: CryptoJS.AES.encrypt(JSON.stringify({
					name: "Filen Sync"
				}), userMasterKeys[userMasterKeys.length - 1]).toString(),
				nameHashed: hashFn("filen sync"),
				type: "sync"
			}, async (err, res) => {
				if(err){
					return callback(err)
				}

				if(!res.status){
					return callback(res.message)
				}

				try{
					await db.put("isSetupDone", "true")
					await db.put("syncFolderUUID", syncFolderUUID)
				}
				catch(e){
					return callback(e)
				}

				console.log("Sync folder created.")

				fillContent((err) => {
					if(err){
						return callback(err)
					}

					return callback(null)
				})
			})
		}
	})
}

const updateUserKeys = async () => {
	try{
		var userMasterKeys = await getUserMasterKeys()
	}
	catch(e){
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

				usrMasterKeys.forEach((key) => {
					if(!prvKeyFound){
						try{
							prvKey = CryptoJS.AES.decrypt(res.data.privateKey, key).toString(CryptoJS.enc.Utf8)

							if(prvKey.length > 16){
								prvKeyFound = true
							}
						}
						catch(e){
							return
						}
					}
				})

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

					if(updateUserKeysPKTries < 3){
						uu += 1

						updateUserKeys()
					}
				}
			}
		})
	}

	apiRequest("/v1/user/masterKeys", {
		apiKey: await getUserAPIKey(),
		masterKeys: CryptoJS.AES.encrypt(userMasterKeys.join("|"), userMasterKeys[userMasterKeys.length - 1]).toString()
	}, async (err, res) => {
		if(err){
			return console.log(err)
		}

		if(!res.status){
			return console.log(res.message)
		}

		if(res.data.keys.length == 0){
			return console.log("Received master keys length is null.")
		}

		try{
			let newKeys = ""

			userMasterKeys.forEach((key) => {
				try{
					if(newKeys.length < 16){
						newKeys = CryptoJS.AES.decrypt(res.data.keys, key).toString(CryptoJS.enc.Utf8)
					}
				}
				catch(e){
					return
				}
			})

			if(newKeys.length > 16){
				try{
					await db.put("userMasterKeys", newKeys)
				}
				catch(e){
					return console.log(e)
				}

				console.log("Master keys updated.")
			}

			updatePubAndPrivKeys()
		}
		catch(e){
			return console.log(e)
		}
	})
}

function decryptFolderNameLink(metadata, linkKey, uuid){
    let folderName = "CON_NO_DECRYPT_POSSIBLE_NO_NAME_FOUND_FOR_FOLDER"

    try{
        let obj = JSON.parse(CryptoJS.AES.decrypt(metadata, linkKey).toString(CryptoJS.enc.Utf8))

        if(obj && typeof obj == "object"){
            folderName = obj.name
        }
    }
    catch(e){
        console.log(e)
    }

    return folderName
}

function decryptFileMetadataLink(metadata, linkKey, uuid){
    let fileName = ""
    let fileSize = 0
    let fileMime = ""
    let fileKey = ""

    try{
        let obj = JSON.parse(CryptoJS.AES.decrypt(metadata, linkKey).toString(CryptoJS.enc.Utf8))

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

const decryptCryptoJSFolderName = (str, userMasterKeys) => {
	let folderName = "CON_NO_DECRYPT_POSSIBLE_NO_NAME_FOUND_FOR_FOLDER"

	userMasterKeys = userMasterKeys.reverse()

	userMasterKeys.forEach((key) => {
		try{
			let obj = JSON.parse(CryptoJS.AES.decrypt(str, key).toString(CryptoJS.enc.Utf8))

			if(obj && typeof obj == "object"){
				folderName = obj.name
			}
		}
		catch(e){
			return
		}
	})

	return folderName
}

const decryptFileMetadata = (metadata, userMasterKeys) => {
	let fileName = ""
	let fileSize = 0
	let fileMime = ""
	let fileKey = ""

	userMasterKeys = userMasterKeys.reverse()

	userMasterKeys.forEach((key) => {
		try{
			let obj = JSON.parse(CryptoJS.AES.decrypt(metadata, key).toString(CryptoJS.enc.Utf8))

			if(obj && typeof obj == "object"){
				fileName = obj.name
				fileSize = parseInt(obj.size)
				fileMime = obj.mime
				fileKey = obj.key
			}
		}
		catch(e){
			return
		}
	})

	return {
		name: fileName,
		size: fileSize,
		mime: fileMime,
		key: fileKey
	}
}

const removeFromSyncTasks = (taskId) => {
	syncTaskTries[taskId] = 0

	currentSyncTasks = currentSyncTasks.filter((item) => {
		return item !== taskId
	})
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

/*const checkIfItemParentIsBeingShared = (upFolder, parentUUID, type, metaData) => {
	const checkIfIsSharing = async (parent, callback) => {
		apiRequest("/v1/share/dir/status", {
			apiKey: await getUserAPIKey(),
			uuid: parent
		}, (err, res) => {
			if(err){
				console.log("Request error")

				return callback(false)
			}

			if(!res.status){
				console.log(res.message)

				return callback(false)
			}

			return callback(res.data.sharing, res.data.users)
		})
	}

	checkIfIsSharing(upFolder, (status, users) => {
		if(!status){
			return false
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
	    				key: metaData.key
	    			})
				}
				else{
					mData = metaData.name
				}

				window.crypto.subtle.encrypt({
    				name: "RSA-OAEP"
    			}, usrPubKey, new TextEncoder().encode(mData)).then(async (encrypted) => {
    				apiRequest("/v1/share", {
    					apiKey: await getUserAPIKey(),
    					uuid: metaData.uuid,
						parent: parentUUID,
						email: user.email,
						type: type,
						metadata: base64ArrayBuffer(encrypted)
    				}, (err, res) => {
    					if(err){
    						return console.log("Request error.")
    					}

    					if(!res.status){
							return console.log(res.message)
						}
    				})
    			}).catch((err) => {
	    			return console.log(err)
	    		})
    		}).catch((err) => {
    			return console.log(err)
    		})
		})
	})
}*/

function decryptFolderLinkKey(str, userMasterKeys){
	let link = ""

    if(userMasterKeys.length > 1){
      	userMasterKeys = userMasterKeys.reverse()
    }

    userMasterKeys.forEach((key) => {
        try{
            let obj = CryptoJS.AES.decrypt(str, key).toString(CryptoJS.enc.Utf8)

            if(obj && typeof obj == "string"){
                if(obj.length >= 16){
                	link = obj
                }
            }
        }
        catch(e){
            return
        }
    })

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
	    				key: metaData.key
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

	checkIfIsInFolderLink(parentUUID, 0, 32, (status, links) => {
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

		links.forEach((link) => {
			let key = decryptFolderLinkKey(link.linkKey, userMasterKeys)

			let mData = ""

			if(type == "file"){
				mData = JSON.stringify({
					name: metaData.name,
					size: parseInt(metaData.size),
					mime: metaData.mime,
					key: metaData.key
				})
			}
			else{
				mData = JSON.stringify({
					name: metaData.name
				})
			}

			mData = CryptoJS.AES.encrypt(mData, key).toString()

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
		})
	})
}

const downloadFileChunk = async (file, key, iv, index, tries, maxTries, isSync, callback) => {
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
				let sliced = convertUint8ArrayToBinaryString(new Uint8Array(res.slice(0, 16)))

				if(sliced.indexOf("Salted") !== -1){
					return callback(null, index, convertWordArrayToUint8Array(CryptoJS.AES.decrypt(base64ArrayBuffer(res), file.key)))
				}
				else if(sliced.indexOf("U2FsdGVk") !== -1){
					return callback(null, index, convertWordArrayToUint8Array(CryptoJS.AES.decrypt(convertUint8ArrayToBinaryString(new Uint8Array(res)), file.key)))
				}
				else{
					window.crypto.subtle.decrypt({
						name: "AES-CBC",
						iv: iv
					}, key, res).then((decrypted) => {
						return callback(null, index, new Uint8Array(decrypted))
					}).catch((err) => {
						return setTimeout(() => {
							downloadFileChunk(file, key, iv, index, (tries + 1), maxTries, isSync, callback)
						}, 1000)
					})
				}
			}
			else{
				return setTimeout(() => {
					downloadFileChunk(file, key, iv, index, (tries + 1), maxTries, isSync, callback)
				}, 1000)
			}
		},
		error: (err) => {
			release()

			return setTimeout(() => {
				downloadFileChunk(file, key, iv, index, (tries + 1), maxTries, isSync, callback)
			}, 1000)
		}
	})
}

const writeFileChunk = (file, index, data) => {
	if(index == downloadWriteChunk[file.uuid]){
		if(typeof downloadWriteStreams[file.uuid] == "undefined"){
			return false
		}

		if(downloadWriteStreams[file.uuid].closed){
			return false
		}

		if(data.length == 0 || typeof data == "undefined" || data == null){
			if(typeof chunksWritten[file.uuid] == "undefined"){
				chunksWritten[file.uuid] = 0
			}

			chunksWritten[file.uuid] += 1

			return downloadWriteChunk[file.uuid] += 1
		}

		try{
			downloadWriteStreams[file.uuid].write(data, (err) => {
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
			return console.log(e)
		}
	}
	else{
		return setTimeout(() => {
			writeFileChunk(file, index, data)
		}, 100)
	}
}

const downloadFileChunksAndWrite = (path, file, key, iv, isSync, callback) => {
	let maxDownloadThreadsInterval = setInterval(() => {
		if(currentDownloadThreads < maxDownloadThreads){
			currentDownloadThreads += 1
			downloadIndex[file.uuid] += 1

			let thisIndex = downloadIndex[file.uuid]

			downloadFileChunk(file, key, iv, thisIndex, 0, 128, isSync, (err, index, data) => {
				if(err){
					clearInterval(maxDownloadThreadsInterval)

					currentDownloadThreads -= 1

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
	}, getRandomArbitrary(50, 100))
}

const downloadFileToLocal = async (path, file, isSync, callback) => {
	if(file.size <= 0){
		return callback(new Error("file size is zero"))
	}

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
		return callback(e)
	}

	if(!fileDirPathExists){
		return callback(new Error("file parent dir does not exist locally -> " + fileDirPath))
	}

	checkIfFileExistsLocallyOtherwiseDelete(winOrUnixFilePath(path), (err) => {
		if(err){
			return callback(err)
		}

		let preKey = new TextEncoder().encode(file.key)
		let iv = preKey.slice(0, 16)

		window.crypto.subtle.importKey("raw", preKey, "AES-CBC", false, ["encrypt", "decrypt"]).then((genKey) => {
			downloadWriteChunk[file.uuid] = 0
			downloadIndex[file.uuid] = -1

			downloadWriteStreams[file.uuid] = fs.createWriteStream(winOrUnixFilePath(path), {
				flags: "w"
			})

			downloadFileChunksAndWrite(winOrUnixFilePath(path), file, genKey, iv, isSync, (err) => {
				if(err){
					downloadWriteStreams[file.uuid].end()

					return callback(err)
				}

				let waitForChunksToWriteInterval = setInterval(() => {
					if(typeof chunksWritten[file.uuid] !== "undefined"){
						if(chunksWritten[file.uuid] >= file.chunks){
							clearInterval(waitForChunksToWriteInterval)

							if(isSync){
								return setTimeout(() => {
									downloadWriteStreams[file.uuid].end()

									callback(null)
								}, syncTimeout)
							}
							else{
								return setTimeout(() => {
									downloadWriteStreams[file.uuid].end()

									callback(null)
								}, 1000)
							}
						}
					}
				}, 100)
			})
		}).catch((err) => {
			return callback(err)
		})
	})
}

const uploadChunk = async (uuid, queryParams, blob, tries, maxTries, callback) => {
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

const uploadFileToRemote = async (path, uuid, parent, name, userMasterKeys, callback) => {
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

	let nameEnc = CryptoJS.AES.encrypt(name, key).toString()
	let nameH = hashFn(name.toLowerCase())
	let mimeEnc = CryptoJS.AES.encrypt(mime, key).toString()

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

		let sizeEnc = CryptoJS.AES.encrypt(size.toString(), key).toString()
		
		let metaData = CryptoJS.AES.encrypt(JSON.stringify({
			name,
			size,
			mime,
			key
		}), userMasterKeys[userMasterKeys.length - 1]).toString()

		let dummyOffset = 0
		let fileChunks = 0

		while(dummyOffset < size){
			fileChunks++
			dummyOffset += chunkSizeToUse
		}

		let offset = (0 - chunkSizeToUse)
		let currentIndex = -1

		let preKey = new TextEncoder().encode(key)
		let iv = preKey.slice(0, 16)

		window.crypto.subtle.importKey("raw", preKey, "AES-CBC", false, ["encrypt", "decrypt"]).then((genKey) => {
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

								window.crypto.subtle.encrypt({
									name: "AES-CBC",
									iv: iv
								}, genKey, arrayBuffer).then(async (encrypted) => {
									let blob = convertUint8ArrayToBinaryString(new Uint8Array(encrypted))

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
										parent: parent
									})

									uploadChunk(uuid, queryParams, blob, 0, 512, (err, res) => {
										if(err){
											return callback(err)
										}

										currentUploadThreads -= 1

										blob = null
										firstDone = true

										if(thisIndex >= fileChunks){
											clearInterval(uploadInterval)

											if(!markedAsDone){
												markedAsDone = true

												markUploadAsDone(uuid, uploadKey, 0, 32, (err) => {
													if(err){
														return callback(err)
													}

													checkIfItemParentIsBeingShared(parent, "file", {
														uuid: uuid,
														name: name,
														size: parseInt(size),
														mime: mime,
														key: key
													}, () => {
														callback(null)
													})
												})
											}
										}
									})
								}).catch((err) => {
									currentUploadThreads -= 1

									return callback(err)
								})
							}).catch((err) => {
								currentUploadThreads -= 1

								return callback(err)
							})
						}
					}
				}
			}, getRandomArbitrary(100, 200))
		}).catch((err) => {
			return callback(err)
		})
	})
}

const addFinishedSyncTaskToStorage = async (where, task, taskInfo) => {
	try{
		var release = await logSyncTasksSemaphore.acquire()
	}
	catch(e){
		return console.log(e)
	}

	let currentStorageData = undefined
	let userEmail = undefined

	try{
		userEmail = await db.get("userEmail")

		currentStorageData = JSON.parse(await db.get(userEmail + "_finishedSyncTasks"))
	}
	catch(e){
		currentStorageData = undefined
	}

	if(typeof currentStorageData == "undefined"){
		currentStorageData = []

		currentStorageData.push({
			where,
			task,
			taskInfo
		})

		lastSyncedItem = {
			where,
			task,
			taskInfo
		}

		try{
			await db.put(userEmail + "_finishedSyncTasks", JSON.stringify(currentStorageData))
		}
		catch(e){
			console.log(e)
		}

		release()

		return true
	}
	else{
		if(currentStorageData.length >= 250){
			currentStorageData.shift()
		}

		currentStorageData.push({
			where,
			task,
			taskInfo
		})

		lastSyncedItem = {
			where,
			task,
			taskInfo
		}

		try{
			await db.put(userEmail + "_finishedSyncTasks", JSON.stringify(currentStorageData))
		}
		catch(e){
			console.log(e)
		}

		release()

		return true
	}
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

	if(!localDataChanged){
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
		  			folders[filePath + "/"] = {
						name: filePathEx[filePathEx.length - 1]
					}
		  		}
		  		else if(typeof filePathEx[filePathEx.length - 1] !== "undefined"){
		  			if(file.stats.size > 0){
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
	catch(e){
		return callback(e)
	}

	lastLocalSyncFolders = folders
	lastLocalSyncFiles = files

	$("#account-sync-stats-files-text").html(Object.keys(files).length)
	$("#account-sync-stats-folders-text").html(Object.keys(folders).length - 1)

	return callback(null, folders, files)
}

const getRemoteSyncDirContents = async (folderUUID, callback) => {
	try{
		var userMasterKeys = await getUserMasterKeys()
	}
	catch(e){
		return callback(e)
	}

	//console.log("Get remote contents, firstDataRequest = " + firstDataRequest + ", skipNextRequestData = " + skipNextRequestData)

	apiRequest("/v1/get/dir", {
		apiKey: await getUserAPIKey(),
		uuid: folderUUID,
		firstRequest: (firstDataRequest || skipNextRequestData ? "true" : "false")
	}, async (err, res) => {
		if(err){
			return callback(err)
		}

		if(!res.status){
			return callback(res.message)
		}

		firstDataRequest = false

		if(skipNextRequestData){
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

		if(typeof lastRemoteSyncDataHash !== "undefined"){
			if(hashFnFast(JSON.stringify(res.data)) == lastRemoteSyncDataHash){
				//console.log("Last remote sync data identical to current one, serving from cache.")

				return callback(null, lastRemoteSyncFolders, lastRemoteSyncFiles) 
			}

			if(currentSyncTasks.length >= 10){
				return callback(null, lastRemoteSyncFolders, lastRemoteSyncFiles) 
			}
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
			let thisPath = []

			const build = (parentUUID) => {
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

			if(typeof remoteDecryptedCache["folder_" + self.uuid + "_" + self.name] !== "undefined"){
				selfName = remoteDecryptedCache["folder_" + self.uuid + "_" + self.name]
			}
			else{
				selfName = decryptCryptoJSFolderName(self.name, userMasterKeys)

				remoteDecryptedCache["folder_" + self.uuid + "_" + self.name] = selfName
			}

			if(selfName !== "Cannot decrypt (rename folder to fix)"){
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
				let newPath = getPathRecursively(self.uuid)
				
				if(typeof newPath !== "undefined"){
					pathsForFiles[self.uuid] = newPath
					folderPaths[newPath] = folders[self.uuid]
				}
			}
		}

		for(let i = 0; i < res.data.files.length; i++){
			let self = res.data.files[i]

			if(pathsForFiles[self.parent] !== "undefined"){
				let metadata = undefined

				if(typeof remoteDecryptedCache["file_" + self.uuid + "_" + self.metadata] !== "undefined"){
					metadata = JSON.parse(remoteDecryptedCache["file_" + self.uuid + "_" + self.metadata])
				}
				else{
					metadata = decryptFileMetadata(self.metadata, userMasterKeys)

					remoteDecryptedCache["file_" + self.uuid + "_" + self.metadata] = JSON.stringify(metadata)
				}

				let newPath = pathsForFiles[self.parent] + metadata.name

				if(metadata.key !== ""){
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
								parent: self.parent
							}
						}
					}
				}
			}
		}

		remoteSyncFolders = folderPaths
		remoteSyncFiles = files
		lastRemoteSyncDataHash = hashFnFast(JSON.stringify(res.data))

		return callback(null, folderPaths, files)
	})
}

const removeFoldersAndFilesFromExistingDir = (path, callback) => {
	path = userHomePath + "/" + path

	for(let prop in localFolderExisted){
		let p = userHomePath + "/" + prop

		if(p.indexOf(path) !== -1){
			delete localFolderExisted[prop]
		}	
	}

	for(let prop in localFileExisted){
		if(prop.indexOf(path) !== -1){
			delete localFileExisted[prop]
			delete localFileModifications[prop]
			delete remoteFileSizes[prop]
			delete remoteFileUUIDs[prop]
		}	
	}

	return callback()
}

const syncTask = async (where, task, taskInfo, userMasterKeys) => {
	let taskId = taskInfo.path

	if(syncingPaused){
		return setTimeout(() => {
			syncTask(where, task, taskInfo, userMasterKeys)
		}, syncTimeout)
	}

	if(isIndexing){
		return setTimeout(() => {
			syncTask(where, task, taskInfo, userMasterKeys)
		}, getRandomArbitrary(100, 1000))
	}

	if(currentSyncTasks.includes(taskId)){
		return false
	}

	currentSyncTasks.push(taskId)

	console.log(where, task, JSON.stringify(taskInfo))

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

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						if(!res.status){
							console.log(res.message)

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						if(res.data.exists){
							console.log(taskInfo.path + " already exists remotely.")

							localFolderExisted[taskInfo.path] = true

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						let newFolderUUID = uuidv4()

						apiRequest("/v1/dir/sub/create", {
							apiKey: await getUserAPIKey(),
							uuid: newFolderUUID,
							name: CryptoJS.AES.encrypt(JSON.stringify({
								name: taskInfo.name
							}), userMasterKeys[userMasterKeys.length - 1]).toString(),
							nameHashed: hashFn(taskInfo.name.toLowerCase()),
							parent: taskInfo.parent
						}, (err, res) => {
							if(err){
								console.log(err)

								return setTimeout(() => {
									removeFromSyncTasks(taskId)
								}, syncTimeout)
							}

							if(!res.status){
								console.log(res.message)

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

							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}

						addFinishedSyncTaskToStorage(where, task, JSON.stringify(taskInfo))

						console.log(res.message)

						delete localFolderExisted[taskInfo.path]

						removeFoldersAndFilesFromExistingDir(taskInfo.path, () => {
							removeFromDeletingRemoteFolders(taskId)

							setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						})
					})
				break
				case "upload":
				case "update":
					setTimeout(async () => {
						apiRequest("/v1/file/exists", {
							apiKey: await getUserAPIKey(),
							parent: taskInfo.parent,
							nameHashed: hashFn(taskInfo.name.toLowerCase())
						}, async (err, res) => {
							if(err){
								console.log(err)

								return setTimeout(() => {
									removeFromSyncTasks(taskId)
								}, syncTimeout)
							}

							if(!res.status){
								console.log(res.message)

								return setTimeout(() => {
									removeFromSyncTasks(taskId)
								}, syncTimeout)
							}

							let newFileUUID = uuidv4()

							const doUpload = async () => {
								uploadFileToRemote(taskInfo.realPath, newFileUUID, taskInfo.parent, taskInfo.name, userMasterKeys, async (err) => {
									if(err){
										console.log(err)

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
											localFileExisted[taskInfo.filePath] = true
										}
									}
									catch(e){
										console.log(e)
									}

									return setTimeout(async () => {
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
											localFileExisted[taskInfo.filePath] = true
										}
									}
									catch(e){
										console.log(e)
									}

									return setTimeout(async () => {
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

											return setTimeout(() => {
												removeFromSyncTasks(taskId)
											}, syncTimeout)
										}

										if(!res.status){
											console.log(res.message)

											return setTimeout(() => {
												removeFromSyncTasks(taskId)
											}, syncTimeout)
										}

										doUpload()
									})
								}
								else{
									return setTimeout(() => {
										removeFromSyncTasks(taskId)
									}, syncTimeout)
								}
							}
						})
					}, getRandomArbitrary(1000, 2500))
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

					let createDir = false

					fs.stat(winOrUnixFilePath(dirPath), (err, stats) => {
						if(!err){
							createDir = false
						}
						else if(err.code == "ENOENT"){
							createDir = true
						}

						if(createDir){
							fs.mkdir(winOrUnixFilePath(dirPath), {
								recursive: true,
								overwrite: true
							}, (err) => {
								addFinishedSyncTaskToStorage(where, task, JSON.stringify(taskInfo))

								localFolderExisted[taskInfo.path] = true

								return setTimeout(() => {
									removeFromSyncTasks(taskId)
								}, syncTimeout)
							})
						}
						else{
							return setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						}
					})
				break
				case "rmdir":
					let rmdirPath = userHomePath + "/" + taskInfo.path

					rimraf(winOrUnixFilePath(rmdirPath), () => {
						addFinishedSyncTaskToStorage(where, task, JSON.stringify(taskInfo))

						delete localFolderExisted[taskInfo.path]

						removeFoldersAndFilesFromExistingDir(taskInfo.path, () => {
							removeFromDeletingLocalFolders(taskId)
							
							setTimeout(() => {
								removeFromSyncTasks(taskId)
							}, syncTimeout)
						})
					})
				break
				case "rmfile":
					let rmFilePath = userHomePath + "/" + taskInfo.path

					rimraf(winOrUnixFilePath(rmFilePath), () => {
						addFinishedSyncTaskToStorage(where, task, JSON.stringify(taskInfo))

						delete localFileModifications[taskInfo.filePath]
						delete remoteFileSizes[taskInfo.filePath]
						delete remoteFileUUIDs[taskInfo.filePath]
						delete localFileExisted[taskInfo.filePath]

						return setTimeout(() => {
							removeFromSyncTasks(taskId)
						}, syncTimeout)
					})
				break
				case "download":
				case "update":
					if(taskInfo.file.size <= 0){
						return removeFromSyncTasks(taskId)
					}

					if(taskInfo.file.size >= diskSpaceFree){
						console.log("NO SPACE AVAILABLE")

						return removeFromSyncTasks(taskId)
					}

					let filePath = userHomePath + "/" + taskInfo.path

					downloadFileToLocal(winOrUnixFilePath(filePath), taskInfo.file, true, async (err) => {
						if(err){
							console.log(err)

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

						localFileExisted[taskInfo.filePath] = true
						remoteFileUUIDs[taskInfo.filePath] = taskInfo.file.uuid

						console.log(taskInfo.path + " " + task + " done")

						addFinishedSyncTaskToStorage(where, task, JSON.stringify(taskInfo))

						return setTimeout(async () => {
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
		if(currentSyncTasks.length <= 0){
			isSyncing = false
		}

		return false
	}

	if(syncingPaused){
		if(currentSyncTasks.length <= 0){
			isSyncing = false
		}

		return false
	}

	try{
		var userMasterKeys = await getUserMasterKeys()
	}
	catch(e){
		console.log(e)

		if(currentSyncTasks.length <= 0){
			isSyncing = false
		}

		return false
	}

	isSyncing = true

	let folderUUID = await getSyncFolderUUID()

	fs.access(winOrUnixFilePath(userSyncDir), async (err) => {
		if(err && err.code == "ENOENT"){
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

			return ipcRenderer.send("exit-app")
		}
		else{
			getRemoteSyncDirContents(folderUUID, (err, remoteFolders, remoteFiles) => {
				if(err){
					if(currentSyncTasks.length <= 0){
						isSyncing = false
					}

					return console.log(err)
				}

				getLocalSyncDirContents(async (err, localFolders, localFiles) => {
					if(err){
						if(currentSyncTasks.length <= 0){
							isSyncing = false
						}

						return console.log(err)
					}

					if(syncingPaused){
						if(currentSyncTasks.length <= 0){
							isSyncing = false
						}

						return false
					}

					//Did the remote and local dataset even change? If not we can save cpu usage by skipping the sync cycle
					let currentDatasetHash = hashFnFast(JSON.stringify(remoteFolders) + JSON.stringify(remoteFiles) + JSON.stringify(localFolders) + JSON.stringify(localFiles))

					if(typeof lastDatasetHash !== "undefined"){
						if(currentDatasetHash == lastDatasetHash){
							//console.log("Dataset didnt change, skipping syncing cycle.")

							let currLastSavedDataHash = hashFnFast(currentDatasetHash)

							if(typeof lastSavedDataHash !== "undefined"){
								if(currLastSavedDataHash == lastSavedDataHash){
									//console.log("Last write dataset didnt change, not writing.")

									return setTimeout(() => {
										if(currentSyncTasks.length <= 0){
											isSyncing = false
										}
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
								if(currentSyncTasks.length <= 0){
									isSyncing = false
								}
							}, 1000)
						}
					}

					lastDatasetHash = currentDatasetHash

					isIndexing = true

					if(typeof lastLocalSyncFiles !== "undefined" && typeof lastRemoteSyncFiles !== "undefined" && typeof lastRemoteSyncFolders !== "undefined"){
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
						}

						//Create directory remotely because the server does not have it
						for(let prop in localFolders){
							if(typeof remoteFolders[prop] == "undefined" && prop !== "Filen Sync/"){
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
										syncTask("remote", "mkdir", {
											path: prop,
											name: localFolders[prop].name,
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

								if(typeof lastRemoteSyncFiles[prop] !== "undefined" && typeof localFileExisted[filePath] !== "undefined"){
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
						}

						//Upload file to remote because the server does not have it
						for(let prop in localFiles){
							if(typeof remoteFiles[prop] == "undefined"){
								let filePath = userHomePath + "/" + prop

								if(typeof lastRemoteSyncFiles[prop] !== "undefined" && typeof localFileExisted[filePath] !== "undefined"){
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
										syncTask("remote", "upload", {
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

					isIndexing = false

					let waitForQueueToFinishInterval = setInterval(async () => {
						if(currentSyncTasks.length <= 0){
							clearInterval(waitForQueueToFinishInterval)

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

								await db.put(userEmail + "_remoteDecryptedCache", JSON.stringify(remoteDecryptedCache))
							}
							catch(e){
								console.log(e)
							}

							console.log("Sync cycle done.")

							skipNextRequestData = true

							return isSyncing = false
						}
					}, 50)
				})
			})
		}
	})
}

const initChokidar = async () => {
	chokidarWatcher = undefined

	chokidarWatcher = chokidar.watch(userSyncDir, {
		persistent: true,
		ignoreInitial: false,
		followSymlinks: false,
		usePolling: false,
		depth: 99999999999,
		awaitWriteFinish: true
	}).on("all", (e, path) => {
		localDataChanged = true

		setTimeout(() => {
			localDataChanged = true
		}, (syncTimeout / 2))
	})

	localDataChanged = true

	setTimeout(() => {
		localDataChanged = true
	}, (syncTimeout / 2))
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
			//console.log(e)
		}

		initChokidar()

		appId = generateRandomString(32)

		console.log("Syncing started.")

		localDataChanged = true

		setTimeout(() => {
			localDataChanged = true
		}, (syncTimeout * 2))

		doSync()

		setInterval(doSync, syncTimeout)
	})
}

const reload = (type) => {
	window.location.reload()

	return routeTo(type)
}

const doLogout = async () => {
	syncingPaused = true

	try{
		await db.put("isLoggedIn", "false")
	}
	catch(e){
		syncingPaused = false

		return console.log(e)
	}

	return routeTo("login")
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

const init = async () => {
	initIPC()
	initFns()
	getDiskSpace()

	let loggedIn = await isLoggedIn()

	console.log("isLoggedIn", loggedIn)

	if(!loggedIn){
		return routeTo("login")
	}

	initSocket()
	updateUserKeys()
	getUserUsage()

	setInterval(() => {
		updateUserKeys()
	}, 180000)

	$("#big-loading-text").html("Loading..")

	routeTo("big-loading")

	doSetup((err) => {
		if(err){
			return console.log(err)
		}

		syncingPaused = false

		setTimeout(() => {
			startSyncing()
		}, 5000)

		return routeTo("account")
	})

	setInterval(() => {
		ipcRenderer.send("is-syncing-paused", {
			paused: syncingPaused
		})

		ipcRenderer.send("is-syncing", {
			isSyncing: isSyncing
		})
	}, 100)

	setInterval(async () => {
		$("#syncs-running-tasks-text").html(currentSyncTasks.length)

		if(typeof lastSyncTasksData !== "undefined"){
			let lastSyncedItemName = ""
			let tooltipText = ""

			let fileNameEx = JSON.parse(lastSyncTasksData[0].taskInfo).path.split("/")
			let fileName = fileNameEx[fileNameEx.length - 1]

			if(fileName.length <= 0){
				fileName = fileNameEx[fileNameEx.length - 2]
			}

			lastSyncedItemName = fileName

			if(currentSyncTasks.length > 0){
				tooltipText = "Currently syncing " + currentSyncTasks.length + " item" + (currentSyncTasks.length == 1 ? "" : "s") + "\nLast synced item: " + lastSyncedItemName
			}
			else{
				tooltipText = "Nothing to sync\nLast synced item: " + lastSyncedItemName
			}

			ipcRenderer.send("set-tray-tooltip", {
				tooltip: tooltipText,
				tasks: currentSyncTasks.length
			})
		}
	}, 1000)
}

window.onload = () => {
	ipcRenderer.send("renderer-ready")

	return init()
}
