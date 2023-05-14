export interface RemoteFileMetadata {
	name: string
	size: number
	key: string
	lastModified: number
	mime: string
}

export type ItemType = "folder" | "file"

export interface RemoteItem {
	uuid: string
	name: string
	parent: string
	type: ItemType
	path: string
	region: string
	bucket: string
	chunks: number
	version: number
	metadata: RemoteFileMetadata
}

export interface RemoteUUIDs {
	type: ItemType
	path: string
}

export interface RemoteDirectoryTreeResult {
	changed: boolean
	data: {
		files: {
			[key: string]: RemoteItem
		}
		folders: {
			[key: string]: RemoteItem
		}
		uuids: {
			[key: string]: RemoteUUIDs
		}
	}
}

export interface ReaddirFallbackEntry {
	entry: {
		name: string
		size: number
		lastModified: number
		ino: number
	}
	ino: {
		type: ItemType
		path: string
	}
}

export interface SemaphoreInterface {
	acquire: Function
	release: Function
	count: Function
	setMax: Function
	purge: Function
}

export type DeltaType = "NEW" | "NEWER" | "OLDER" | "UNCHANGED" | "DELETED" | "RENAMED" | "MOVED"

export type Delta = {
	[key: string]: {
		type: DeltaType
		from?: string
		to?: string
	}
}

export type LocalTreeFiles = {
	[key: string]: {
		name: string
		lastModified: number
		ino: number
		size: number
	}
}

export type LocalTreeFolders = {
	[key: string]: {
		name: string
		lastModified: number
		ino: number
	}
}

export type LocalTreeIno = {
	[key: number]: {
		type: string
		path: string
	}
}

export interface LocalDirectoryTreeResult {
	changed: boolean
	data: {
		files: LocalTreeFiles
		folders: LocalTreeFolders
		ino: LocalTreeIno
	}
}

export type SyncModes = "twoWay" | "localToCloud" | "localBackup" | "cloudToLocal" | "cloudBackup"

export interface Location {
	uuid: string
	local: string
	remote: string | undefined
	remoteUUID: string | undefined
	remoteName: string | undefined
	type: SyncModes
	paused: boolean
	busy: boolean
	localChanged: boolean
}

export interface SyncIssue {
	uuid: string
	type: "critical" | "conflict" | "info" | "warning"
	where: "remote" | "local"
	path?: string
	err?: any
	info: string
	timestamp: number
}

export interface ItemProps {
	task: any
	style: any
	userId: number
	platform: string
	darkMode: boolean
	paused: boolean
	lang: string
	isOnline: boolean
}

export interface WatcherEvent {
	event: string
	name: string
	watchPath: string
	locationUUID: string
}

export type Window = { id: number; type: string }
