import { Delta, Location } from "../../../../types"
import { getSyncMode } from "./sync.utils"
import { v4 as uuidv4 } from "uuid"

const pathModule = window.require("path")

export const getDeltas = async (type: "local" | "remote", before: any, now: any): Promise<{ folders: Delta; files: Delta }> => {
	const deltasFiles: Delta = {}
	const deltasFolders: Delta = {}

	if (type == "local") {
		const beforeFiles = before.files
		const beforeFolders = before.folders
		const beforeIno = before.ino
		const nowFiles = now.files
		const nowFolders = now.folders
		const nowIno = now.ino

		for (const path in nowFiles) {
			const beforeEntry = beforeFiles[path]
			const nowEntry = nowFiles[path]

			if (!beforeFiles[path]) {
				deltasFiles[path] = {
					type: "NEW"
				}
			} else if ((beforeEntry?.lastModified || 0) == (nowEntry?.lastModified || 0)) {
				deltasFiles[path] = {
					type: "UNCHANGED"
				}
			} else if ((beforeEntry?.lastModified || 1) < (nowEntry?.lastModified || 0)) {
				deltasFiles[path] = {
					type: "NEWER"
				}
			} else {
				deltasFiles[path] = {
					type: "OLDER"
				}
			}
		}

		for (const path of Object.keys(beforeFiles)) {
			if (!(path in nowFiles)) {
				deltasFiles[path] = {
					type: "DELETED"
				}
			}
		}

		for (const path in nowFolders) {
			const beforeEntry = beforeFolders[path]

			if (!beforeEntry) {
				deltasFolders[path] = {
					type: "NEW"
				}
			} else {
				deltasFolders[path] = {
					type: "UNCHANGED"
				}
			}
		}

		for (const path of Object.keys(beforeFolders)) {
			if (!(path in nowFolders)) {
				deltasFolders[path] = {
					type: "DELETED"
				}
			}
		}

		for (const ino in nowIno) {
			const nowPath = nowIno[ino]?.path || ""
			const beforePath = beforeIno[ino]?.path || ""

			if (typeof nowPath == "string" && typeof beforePath == "string") {
				if (nowPath.length > 0 && beforePath.length > 0) {
					if (nowPath !== beforePath && nowIno[ino].type == beforeIno[ino].type) {
						const nowPathDir = pathModule.dirname(nowPath)
						const beforePathDir = pathModule.dirname(beforePath)
						const nowBasename = pathModule.basename(nowPath)
						const beforeBasename = pathModule.basename(beforePath)
						const sameName = nowBasename === beforeBasename
						const sameParentIno = beforeFolders[beforePathDir]?.ino === nowFolders[nowPathDir]?.ino
						const action =
							!sameParentIno && !sameName ? "RENAMED_MOVED" : !sameParentIno ? "MOVED" : !sameName ? "RENAMED" : "UNCHANGED"

						if (typeof beforeFiles[beforePath] !== "undefined") {
							const nowEntry = beforeFiles[nowPath]

							if (!nowEntry) {
								if (action === "UNCHANGED") {
									deltasFiles[beforePath] = {
										type: "UNCHANGED"
									}

									deltasFiles[nowPath] = {
										type: "UNCHANGED"
									}

									continue
								}

								// Did the file exist before? If so we just update it rather than move/rename it and delete the old one
								deltasFiles[beforePath] = {
									type: action,
									from: beforePath,
									to: nowPath
								}

								deltasFiles[nowPath] = {
									type: action,
									from: beforePath,
									to: nowPath
								}
							}
						}

						if (typeof beforeFolders[beforePath] !== "undefined") {
							const nowEntry = beforeFolders[nowPath]

							if (!nowEntry) {
								if (action === "UNCHANGED") {
									deltasFolders[beforePath] = {
										type: "UNCHANGED"
									}

									deltasFolders[nowPath] = {
										type: "UNCHANGED"
									}

									continue
								}

								// Did the folder exist before? If so we just update it rather than move/rename it and delete the old one
								deltasFolders[beforePath] = {
									type: action,
									from: beforePath,
									to: nowPath
								}

								deltasFolders[nowPath] = {
									type: action,
									from: beforePath,
									to: nowPath
								}
							}
						}
					}
				}
			}
		}
	} else {
		const beforeFiles = before.files
		const beforeFolders = before.folders
		const beforeUUIDs = before.uuids
		const nowFiles = now.files
		const nowFolders = now.folders
		const nowUUIDs = now.uuids

		for (const path in nowFiles) {
			const beforeEntry = beforeFiles[path]
			const nowEntry = nowFiles[path]

			if (!beforeFiles[path]) {
				deltasFiles[path] = {
					type: "NEW"
				}
			} else if ((beforeEntry?.metadata?.lastModified || 0) == (nowEntry?.metadata?.lastModified || 0)) {
				deltasFiles[path] = {
					type: "UNCHANGED"
				}
			} else if ((beforeEntry?.metadata?.lastModified || 1) < (nowEntry?.metadata?.lastModified || 0)) {
				deltasFiles[path] = {
					type: "NEWER"
				}
			} else {
				deltasFiles[path] = {
					type: "OLDER"
				}
			}
		}

		for (const path of Object.keys(beforeFiles)) {
			if (!(path in nowFiles)) {
				deltasFiles[path] = {
					type: "DELETED"
				}
			}
		}

		for (const path in nowFolders) {
			const beforeEntry = beforeFolders[path]

			if (!beforeEntry) {
				deltasFolders[path] = {
					type: "NEW"
				}
			} else {
				deltasFolders[path] = {
					type: "UNCHANGED"
				}
			}
		}

		for (const path of Object.keys(beforeFolders)) {
			if (!(path in nowFolders)) {
				deltasFolders[path] = {
					type: "DELETED"
				}
			}
		}

		for (const uuid in nowUUIDs) {
			const nowPath = nowUUIDs[uuid]?.path || ""
			const beforePath = beforeUUIDs[uuid]?.path || ""

			if (typeof nowPath == "string" && typeof beforePath == "string") {
				if (nowPath.length > 0 && beforePath.length > 0) {
					if (nowPath !== beforePath && nowUUIDs[uuid].type == beforeUUIDs[uuid].type) {
						const nowPathDir = pathModule.dirname(nowPath)
						const beforePathDir = pathModule.dirname(beforePath)
						const nowBasename = pathModule.basename(nowPath)
						const beforeBasename = pathModule.basename(beforePath)
						const sameName = nowBasename === beforeBasename
						const sameParentUUID = beforeFolders[beforePathDir]?.uuid === nowFolders[nowPathDir]?.uuid
						const action =
							!sameParentUUID && !sameName ? "RENAMED_MOVED" : !sameParentUUID ? "MOVED" : !sameName ? "RENAMED" : "UNCHANGED"

						if (typeof beforeFiles[beforePath] !== "undefined") {
							const nowEntry = beforeFiles[nowPath]

							if (!nowEntry) {
								if (action === "UNCHANGED") {
									deltasFiles[beforePath] = {
										type: "UNCHANGED"
									}

									deltasFiles[nowPath] = {
										type: "UNCHANGED"
									}

									continue
								}

								// Did the file exist before? If so we just update it rather than move/rename it and delete the old one
								deltasFiles[beforePath] = {
									type: action,
									from: beforePath,
									to: nowPath
								}

								deltasFiles[nowPath] = {
									type: action,
									from: beforePath,
									to: nowPath
								}
							}
						}

						if (typeof beforeFolders[beforePath] !== "undefined") {
							const nowEntry = beforeFolders[nowPath]

							if (!nowEntry) {
								if (action === "UNCHANGED") {
									deltasFolders[beforePath] = {
										type: "UNCHANGED"
									}

									deltasFolders[nowPath] = {
										type: "UNCHANGED"
									}

									continue
								}

								// Did the folder exist before? If so we just update it rather than move/rename it and delete the old one
								deltasFolders[beforePath] = {
									type: action,
									from: beforePath,
									to: nowPath
								}

								deltasFolders[nowPath] = {
									type: action,
									from: beforePath,
									to: nowPath
								}
							}
						}
					}
				}
			}
		}
	}

	const deltasFoldersRenamedOrMoved: Record<string, { from: string; to: string }> = {}

	for (const path in deltasFolders) {
		if (
			deltasFolders[path].type === "RENAMED" ||
			deltasFolders[path].type === "RENAMED_MOVED" ||
			deltasFolders[path].type === "MOVED"
		) {
			if (typeof deltasFolders[path].from === "string" && typeof deltasFolders[path].to === "string") {
				deltasFoldersRenamedOrMoved[path] = {
					from: deltasFolders[path].from!,
					to: deltasFolders[path].to!
				}
			}
		}
	}

	for (const path in deltasFolders) {
		if (deltasFolders[path].type !== "UNCHANGED") {
			continue
		}

		for (const renamedPath in deltasFoldersRenamedOrMoved) {
			if (path.startsWith(deltasFoldersRenamedOrMoved[renamedPath].to)) {
				console.log(path, "parent moved")

				delete deltasFolders[path]
			}
		}
	}

	for (const path in deltasFiles) {
		if (deltasFiles[path].type !== "UNCHANGED") {
			continue
		}

		for (const renamedPath in deltasFoldersRenamedOrMoved) {
			if (path.startsWith(deltasFoldersRenamedOrMoved[renamedPath].to)) {
				console.log(path, "parent moved")

				delete deltasFiles[path]
			}
		}
	}

	console.log({
		files: deltasFiles,
		folders: deltasFolders
	})

	return {
		files: deltasFiles,
		folders: deltasFolders
	}
}

export const consumeDeltas = async ({
	localDeltas,
	remoteDeltas,
	lastLocalTree,
	lastRemoteTree,
	localTreeNow,
	remoteTreeNow,
	location
}: {
	localDeltas: any
	remoteDeltas: any
	lastLocalTree: any
	lastRemoteTree: any
	localTreeNow: any
	remoteTreeNow: any
	location: Location
}): Promise<any> => {
	const syncMode = await getSyncMode(location)
	const uploadToRemote: any[] = []
	const downloadFromRemote: any[] = []
	const renameInLocal: any[] = []
	const renameInRemote: any[] = []
	const moveInLocal: any[] = []
	const moveInRemote: any[] = []
	const deleteInLocal: any[] = []
	const deleteInRemote: any[] = []
	const addedToList: Record<string, boolean> = {}

	for (const path in localDeltas.folders) {
		const localDelta = localDeltas.folders[path]?.type
		const existsInRemote = typeof remoteDeltas.folders[path] !== "undefined"
		const addedToListPath =
			typeof localDeltas.folders[path] !== "undefined" && typeof localDeltas.folders[path].from === "string"
				? localDeltas.folders[path].from
				: path

		if (localDelta == "RENAMED_MOVED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			renameInRemote.push({
				uuid: uuidv4(),
				path,
				type: "folder",
				item:
					typeof remoteTreeNow.folders[localDeltas.folders[path]?.from] !== "undefined"
						? remoteTreeNow.folders[localDeltas.folders[path]?.from]
						: lastRemoteTree.folders[localDeltas.folders[path]?.from],
				from: localDeltas.folders[path]?.from,
				to: localDeltas.folders[path]?.to
			})

			moveInRemote.push({
				uuid: uuidv4(),
				path,
				type: "folder",
				item:
					typeof remoteTreeNow.folders[localDeltas.folders[path]?.from] !== "undefined"
						? remoteTreeNow.folders[localDeltas.folders[path]?.from]
						: lastRemoteTree.folders[localDeltas.folders[path]?.from],
				from: localDeltas.folders[path]?.from,
				to: localDeltas.folders[path]?.to
			})

			continue
		}

		if (localDelta == "RENAMED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			renameInRemote.push({
				uuid: uuidv4(),
				path,
				type: "folder",
				item:
					typeof remoteTreeNow.folders[localDeltas.folders[path]?.from] !== "undefined"
						? remoteTreeNow.folders[localDeltas.folders[path]?.from]
						: lastRemoteTree.folders[localDeltas.folders[path]?.from],
				from: localDeltas.folders[path]?.from,
				to: localDeltas.folders[path]?.to
			})

			continue
		}

		if (localDelta == "MOVED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			moveInRemote.push({
				uuid: uuidv4(),
				path,
				type: "folder",
				item:
					typeof remoteTreeNow.folders[localDeltas.folders[path]?.from] !== "undefined"
						? remoteTreeNow.folders[localDeltas.folders[path]?.from]
						: lastRemoteTree.folders[localDeltas.folders[path]?.from],
				from: localDeltas.folders[path]?.from,
				to: localDeltas.folders[path]?.to
			})

			continue
		}

		if (localDelta == "DELETED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			deleteInRemote.push({
				uuid: uuidv4(),
				path,
				type: "folder",
				item: lastRemoteTree.folders[path]
			})

			continue
		}

		if (!existsInRemote && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			uploadToRemote.push({
				uuid: uuidv4(),
				path,
				type: "folder",
				item: {
					...localTreeNow.folders[path],
					uuid: uuidv4()
				}
			})

			continue
		}
	}

	for (const path in remoteDeltas.folders) {
		const localDelta = localDeltas.folders[path]?.type
		const remoteDelta = remoteDeltas.folders[path]?.type
		const existsInLocal = typeof localDeltas.folders[path] !== "undefined"
		const addedToListPath =
			typeof remoteDeltas.folders[path] !== "undefined" && typeof remoteDeltas.folders[path].from === "string"
				? remoteDeltas.folders[path].from
				: path

		if (remoteDelta == "RENAMED_MOVED" && localDelta !== "RENAMED_MOVED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			renameInLocal.push({
				uuid: uuidv4(),
				path,
				type: "folder",
				item: remoteTreeNow.folders[path],
				from: remoteDeltas.folders[path]?.from,
				to: remoteDeltas.folders[path]?.to
			})

			moveInLocal.push({
				uuid: uuidv4(),
				path,
				type: "folder",
				item: { path },
				from: remoteDeltas.folders[path]?.from,
				to: remoteDeltas.folders[path]?.to
			})

			continue
		}

		if (remoteDelta == "RENAMED" && localDelta !== "RENAMED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			renameInLocal.push({
				uuid: uuidv4(),
				path,
				type: "folder",
				item: remoteTreeNow.folders[path],
				from: remoteDeltas.folders[path]?.from,
				to: remoteDeltas.folders[path]?.to
			})

			continue
		}

		if (remoteDelta == "MOVED" && localDelta !== "MOVED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			moveInLocal.push({
				uuid: uuidv4(),
				path,
				type: "folder",
				item: { path },
				from: remoteDeltas.folders[path]?.from,
				to: remoteDeltas.folders[path]?.to
			})

			continue
		}

		if (remoteDelta == "DELETED" && localDelta !== "DELETED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			deleteInLocal.push({
				uuid: uuidv4(),
				path,
				type: "folder",
				item: remoteTreeNow.folders[path]
			})

			continue
		}

		if (!existsInLocal && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			downloadFromRemote.push({
				uuid: uuidv4(),
				path,
				type: "folder",
				item: remoteTreeNow.folders[path]
			})

			continue
		}
	}

	for (const path in localDeltas.files) {
		const localDelta = localDeltas.files[path]?.type
		const remoteDelta = remoteDeltas.files[path]?.type
		const existsInRemote = typeof remoteDeltas.files[path] !== "undefined"
		const localLastModified = localTreeNow[path]?.lastModified
		const remoteLastModified = remoteTreeNow[path]?.metadata?.lastModified
		const sameLastModified = localLastModified === remoteLastModified
		const addedToListPath =
			typeof localDeltas.files[path] !== "undefined" && typeof localDeltas.files[path].from === "string"
				? localDeltas.files[path].from
				: path

		if (localDelta == "RENAMED_MOVED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			renameInRemote.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item:
					typeof remoteTreeNow.files[localDeltas.files[path]?.from] !== "undefined"
						? remoteTreeNow.files[localDeltas.files[path]?.from]
						: lastRemoteTree.files[localDeltas.files[path]?.from],
				from: localDeltas.files[path]?.from,
				to: localDeltas.files[path]?.to
			})

			moveInRemote.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item:
					typeof remoteTreeNow.files[localDeltas.files[path]?.from] !== "undefined"
						? remoteTreeNow.files[localDeltas.files[path]?.from]
						: lastRemoteTree.files[localDeltas.files[path]?.from],
				from: localDeltas.files[path]?.from,
				to: localDeltas.files[path]?.to
			})

			continue
		}

		if (localDelta == "RENAMED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			renameInRemote.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item:
					typeof remoteTreeNow.files[localDeltas.files[path]?.from] !== "undefined"
						? remoteTreeNow.files[localDeltas.files[path]?.from]
						: lastRemoteTree.files[localDeltas.files[path]?.from],
				from: localDeltas.files[path]?.from,
				to: localDeltas.files[path]?.to
			})

			continue
		}

		if (localDelta == "MOVED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			moveInRemote.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item:
					typeof remoteTreeNow.files[localDeltas.files[path]?.from] !== "undefined"
						? remoteTreeNow.files[localDeltas.files[path]?.from]
						: lastRemoteTree.files[localDeltas.files[path]?.from],
				from: localDeltas.files[path]?.from,
				to: localDeltas.files[path]?.to
			})

			continue
		}

		if (localDelta == "DELETED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			deleteInRemote.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item: lastRemoteTree.files[path]
			})

			continue
		}

		if (localDelta == "NEW" && remoteDelta == "NEW" && !sameLastModified && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			if (localLastModified > remoteLastModified) {
				uploadToRemote.push({
					uuid: uuidv4(),
					path,
					type: "file",
					item: {
						...localTreeNow.files[path],
						uuid: uuidv4()
					}
				})

				continue
			} else {
				downloadFromRemote.push({
					uuid: uuidv4(),
					path,
					type: "file",
					item: remoteTreeNow.files[path]
				})

				continue
			}
		}

		if (localDelta == "NEWER" && remoteDelta == "NEWER" && !sameLastModified && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			if (localLastModified > remoteLastModified) {
				uploadToRemote.push({
					uuid: uuidv4(),
					path,
					type: "file",
					item: {
						...localTreeNow.files[path],
						uuid: uuidv4()
					}
				})

				continue
			} else {
				downloadFromRemote.push({
					uuid: uuidv4(),
					path,
					type: "file",
					item: remoteTreeNow.files[path]
				})

				continue
			}
		}

		if (localDelta == "NEWER" && !addedToList[addedToListPath] && !sameLastModified) {
			addedToList[addedToListPath] = true

			uploadToRemote.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item: {
					...localTreeNow.files[path],
					uuid: uuidv4()
				}
			})

			continue
		}

		if (!existsInRemote && !addedToList[addedToListPath] && !sameLastModified) {
			addedToList[addedToListPath] = true

			uploadToRemote.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item: {
					...localTreeNow.files[path],
					uuid: uuidv4()
				}
			})

			continue
		}

		if (syncMode == "localBackup" || syncMode == "localToCloud") {
			if (
				(localDelta == "NEW" || localDelta == "NEWER") &&
				(remoteDelta == "UNCHANGED" || remoteDelta == "OLD" || remoteDelta == "OLDER") &&
				!addedToList[addedToListPath] &&
				!sameLastModified
			) {
				addedToList[addedToListPath] = true

				uploadToRemote.push({
					uuid: uuidv4(),
					path,
					type: "file",
					item: {
						...localTreeNow.files[path],
						uuid: uuidv4()
					}
				})

				continue
			}
		}
	}

	for (const path in remoteDeltas.files) {
		const localDelta = localDeltas.files[path]?.type
		const remoteDelta = remoteDeltas.files[path]?.type
		const existsInLocal = typeof localDeltas.files[path] !== "undefined"
		const localLastModified = localTreeNow[path]?.lastModified
		const remoteLastModified = remoteTreeNow[path]?.metadata?.lastModified
		const sameLastModified = localLastModified === remoteLastModified
		const addedToListPath =
			typeof remoteDeltas.files[path] !== "undefined" && typeof remoteDeltas.files[path].from === "string"
				? remoteDeltas.files[path].from
				: path

		if (remoteDelta == "RENAMED_MOVED" && localDelta !== "RENAMED_MOVED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			renameInLocal.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item: remoteTreeNow.files[path],
				from: remoteDeltas.files[path]?.from,
				to: remoteDeltas.files[path]?.to
			})

			moveInLocal.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item: { path },
				from: remoteDeltas.files[path]?.from,
				to: remoteDeltas.files[path]?.to
			})

			continue
		}

		if (remoteDelta == "RENAMED" && localDelta !== "RENAMED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			renameInLocal.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item: remoteTreeNow.files[path],
				from: remoteDeltas.files[path]?.from,
				to: remoteDeltas.files[path]?.to
			})

			continue
		}

		if (remoteDelta == "MOVED" && localDelta !== "MOVED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			moveInLocal.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item: { path },
				from: remoteDeltas.files[path]?.from,
				to: remoteDeltas.files[path]?.to
			})

			continue
		}

		if (remoteDelta == "DELETED" && localDelta !== "DELETED" && !addedToList[addedToListPath]) {
			addedToList[addedToListPath] = true

			deleteInLocal.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item: remoteTreeNow.files[path]
			})

			continue
		}

		if (remoteDelta == "NEWER" && localDelta !== "NEWER" && !addedToList[addedToListPath] && !sameLastModified) {
			addedToList[addedToListPath] = true

			downloadFromRemote.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item: remoteTreeNow.files[path]
			})

			continue
		}

		if (!existsInLocal && !addedToList[addedToListPath] && !sameLastModified) {
			addedToList[addedToListPath] = true

			downloadFromRemote.push({
				uuid: uuidv4(),
				path,
				type: "file",
				item: remoteTreeNow.files[path]
			})

			continue
		}
	}

	console.log({
		uploadToRemote,
		downloadFromRemote,
		renameInLocal,
		renameInRemote,
		moveInLocal,
		moveInRemote,
		deleteInLocal,
		deleteInRemote
	})

	//await new Promise(resolve => setTimeout(resolve, 100101010101))

	return {
		uploadToRemote,
		downloadFromRemote,
		renameInLocal,
		renameInRemote,
		moveInLocal,
		moveInRemote,
		deleteInLocal,
		deleteInRemote
	}
}
