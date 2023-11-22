const zh: {
	[key: string]: string
} = {
	// Email address
	loginEmailPlaceholder: "邮箱",
	// Password
	loginPasswordPlaceholder: "密码",
	// Two Factor Code
	loginTwoFactorCodePlaceholder: "两步验证",
	// Login
	loginBtn: "登录",
	// Login
	titlebarLogin: "登录",
	// Invalid fields
	loginInvalidFields: "无效字段",
	// Invalid email address
	loginInvalidEmail: "无效邮箱",
	// Invalid password or email address
	loginInvalidEmailOrPassword: "密码或邮箱无效",
	// Account not yet activated
	loginAccountNotYetActivated: "账户未激活",
	// Wrong email address or password
	loginWrongEmailOrPassword: "邮箱或密码错误",
	// Wrong Two Factor Authentication code
	invalidTwoFactorKey: "两步验证错误",
	// Filen
	titlebarMain: "Filen",
	// Settings
	titlebarSettings: "设置",
	// Select a cloud folder
	titlebarSelectFolderRemote: "选择一个云端文件夹",
	// Download
	titlebarDownload: "下载",
	// Cloud
	titlebarCloud: "云端",
	// Upload
	titlebarUpload: "云端",
	// Selective sync
	titlebarSelectiveSync: "部分同步",
	// Close
	close: "关闭",
	// Save
	save: "保存",
	// Syncing __COUNT__ item
	syncingItemsFooterSingular: "正在同步 __COUNT__ 个项目",
	// Syncing __COUNT__ items
	syncingItemsFooterPlural: "正在同步 __COUNT__ 个项目",
	// Everything synced
	syncingFooterEverythingSynced: "所有项目同步完成",
	// About __TIME__ remaining
	aboutRemaining: "大约剩余 __TIME__",
	// No activity yet
	noSyncActivityYet: "当前无任务",
	// Create one
	createOne: "新建",
	// No sync location setup yet
	noSyncLocationsSetupYet: "尚未有同步设置",
	// __USED__ used of __MAX__
	storageUsed: "__USED__ / __MAX__",
	// Quit Filen
	quitFilen: "退出 Filen",
	// Open website
	openWebsite: "进入网页",
	// Settings
	settings: "设置",
	// Actions
	actions: "变动",
	// You are offline
	youAreOffline: "您已离线",
	// Forgot password
	forgotPasswordBtn: "忘记密码",
	// Create account
	createAccountBtn: "创建账号",
	// Select
	select: "确认",
	// This folder is empty
	thisFolderIsEmpty: "此文件夹为空",
	// Create folder
	createFolder: "新建文件夹",
	// Create
	create: "新建",
	// Download done
	downloadDone: "已下载",
	// Open folder
	openFolder: "打开文件夹",
	// Download
	download: "下载",
	// Change
	change: "修改",
	// Open
	open: "打开",
	// No files or folders uploaded yet
	noFilesOrFoldersUploadedYet: "当前没有文件及文件夹上传完成",
	// Upload done
	uploadDone: "上传完毕",
	// Preparing..
	preparingUpload: "准备中",
	// Creating folder structure..
	preparingUploadFolders: "正在创建文件夹结构",
	// Launch at system startup
	launchAtSystemStartup: "开机自启动",
	// Dark mode
	darkMode: "黑暗模式",
	// Exclude dot files and folders (recommended)
	excludeDot: "排除点开头的文件及文件夹（推荐）",
	// Exclude files and folders starting with a dot, e.g. ".gitignore, .DS_Store"
	excludeDotTooltip: "排除点开头的文件及文件夹，例如 .gitignore .DS_Store",
	// Language
	language: "语言",
	// Save logs
	saveLogs: "保存日志",
	// Cannot create sync location
	cannotCreateSyncLocation: "无法创建同步位置",
	// You need to select at least one sub directory
	cannotCreateSyncLocationSubdir: "您需要最少选择一个子目录",
	// The local path you have selected is already a configured sync location. This could lead to endless sync loops
	cannotCreateSyncLocationLoop: "您选择了配置过的同步路径，这将陷入同步死循环",
	// Could not access the local directory. Maybe you don't have the permissions?
	cannotCreateSyncLocationAccess: "无法访问本地路径，可能是因为文件权限问题",
	// Select remote location
	selectRemoteLocation: "选择云端位置",
	// Sync mode
	syncMode: "同步方式",
	// Two Way
	syncModeTwoWay: "双向同步",
	// Local to Cloud
	syncModeLocalToCloud: "本地到云",
	// Cloud to Local
	syncModeCloudToLocal: "云到本地",
	// Local backup
	syncModeLocalBackup: "备份到云端",
	// Cloud backup
	syncModeCloudBackup: "备份到本地",
	// Selective sync
	selectiveSync: "部分同步",
	// Configure which folders and files you want to have synced locally
	selectiveSyncTooltip: "配置具体需要同步的文件、文件夹",
	// Configure
	configure: "配置",
	// Exclude paths and patterns from syncing. Works just like a .gitignore file
	filenignoreTooltip: "就像 .gitignore 一样，排除路径的规则",
	// Edit
	edit: "编辑",
	// Paused
	paused: "暂停",
	// Delete sync location
	deleteSyncLocation: "删除同步位置",
	// Are you sure you want to delete this sync location?
	confirmDeleteSyncLocation: "确定删除此同步位置吗？",
	// Delete
	delete: "删除",
	// Ignored pattern, separated by a new line
	filenignoreHeader: "排除路径的规则，每行一条",
	// __PERCENT__% of __MAX__ used
	accountStorageUsed: "最大 __MAX__ 已用 __PERCENT__%",
	// Logout
	logout: "退出",
	// Current plan
	accountCurrentPlan: "当前套餐",
	// Upgrade
	accountUpgrade: "升级",
	// __PERCENT__% in use
	accountStorageInUse: "已用 __PERCENT__%",
	// Are you sure you want to logout?
	confirmLogout: "确定退出登录吗？",
	// Resume syncing
	resumeSyncing: "继续同步",
	// No sync issues
	noSyncIssues: "没有冲突",
	// Clear issues
	clearSyncIssues: "冲突已解决",
	// When clearing the shown issues the client will attempt to sync again. Please make sure to resolve all issues before clearing them.
	clearSyncIssuesInfo: "客户端会尝试再次同步，请确保所有冲突已处理完毕，再确认“冲突已解决”",
	// Clear
	clear: "冲突已解决",
	// Upload bandwidth throttling
	uploadBandwidthThrottling: "上传限速",
	// Unlimited
	unlimited: "不限速",
	// Download bandwidth throttling
	downloadBandwidthThrottling: "下载限速",
	// Network throttling
	networkThrottling: "网络限速",
	// Maximum upload bandwidth (in Kbps)
	maximumUploadBandwidth: "最大上传速度（Kbps）",
	// Maximum download bandwidth (in Kbps)
	maximumDownloadBandwidth: "最大下载速度（Kbps）",
	// Setting a value of 0 will disable throttling
	disableThrottlingInfo: "设置 0 为不限速",
	// Reset to defaults
	resetToDefaults: "恢复默认",
	// Change keybind
	changeKeybind: "修改快捷键",
	// Press any key or keycombo
	pressKeyOrCombo: "按下任意键或组合键",
	// General
	settingsGeneral: "通用",
	// Syncs
	settingsSyncs: "同步",
	// Account
	settingsAccount: "账户",
	// Issues
	settingsIssues: "冲突",
	// Networking
	settingsNetworking: "网络",
	// Keybinds
	settingsKeybinds: "快捷键",
	// Folder name
	createFolderPlaceholder: "文件夹名称",
	// Invalid folder name
	invalidFolderName: "无效的文件夹名称",
	// Cloud
	titlebarCloudWindow: "云端",
	// There is an update available, please consider downloading the latest version for bug fixes and performance improvements
	updateAvailable: "新版本可用，建议您下载最新版本，带来问题修复及性能改善",
	// Download update
	downloadUpdateBtn: "下载升级",
	// Pause
	pause: "暂停",
	// Resume
	resume: "恢复",
	// Upload folders
	keybinds_uploadFolders: "上传文件夹",
	// Upload files
	keybinds_uploadFiles: "上传文件",
	// Open settings
	keybinds_openSettings: "打开设置",
	// Pause sync
	keybinds_pauseSync: "暂停同步",
	// Resume sync
	keybinds_resumeSync: "恢复同步",
	// Open website
	keybinds_openWebsite: "进入网页",
	// Not bound
	keybindNotBound: "未绑定",
	// Syncing..
	syncing: "正在同步",
	// You have reached the maximum storage volume of your account. In order to be able to continue synchronizing, we recommend that you upgrade.
	maxStorageReached: "已使用云端最大容量，请升级账户套餐以继续同步",
	// Downloaded from the cloud
	syncTaskDownloadFromRemote: "已从云端下载",
	// Uploaded to the cloud
	syncTaskUploadToRemote: "已上传到云端",
	// Renamed in the cloud
	syncTaskRenameInRemote: "已在云端重命名",
	// Renamed locally
	syncTaskRenameInLocal: "已在本地重命名",
	// Moved in the cloud
	syncTaskMoveInRemote: "已在云端移动",
	// Moved locally
	syncTaskMoveInLocal: "已在本地移动",
	// Deleted in the cloud
	syncTaskDeleteInRemote: "已在云端删除",
	// Deleted locally
	syncTaskDeleteInLocal: "已在本地删除",
	// Queued
	queued: "排队中",
	// Acquiring sync lock..
	acquiringSyncLock: "正在获取同步锁",
	// Sync location created. To start the sync you have to unpause it.
	syncLocationCreated: "已创建同步位置，请取消暂停以开始同步",
	// Checking changes..
	checkingChanges: "检查变动..",
	// Mirror every action in both directions
	syncModeTwoWayInfo: "同时检测两边变动，互相镜像同步",
	// Mirror every action locally to the cloud but never act on remote changes
	syncModeLocalToCloudInfo: "检测本地变动镜像到云端，本地不受云端变动影响",
	// Mirror every action from the cloud but never act on local changes
	syncModeCloudToLocalInfo: "检测云端变动镜像到本地，云端不受本地变动影响",
	// Only upload data to the cloud, never delete anything or act on remote changes
	syncModeLocalBackupInfo: "仅仅上传数据到云端，不会删除任何东西，云端变动不会影响本地",
	// Only download data from the cloud, never delete anything or act on local changes
	syncModeCloudBackupInfo: "仅仅下载数据到本地，不会删除任何东西，本地变动不会影响云端",
	// Cancel
	cancel: "取消",
	// The remote path you have selected is already a configured sync location. This could lead to endless sync loops
	cannotCreateSyncLocationLoop2: "您选择的远程路径已经是配置的同步位置。这可能会导致无限的同步循环",
	// Update available
	titlebarUpdateAvailable: "有可用的更新",
	// A new version has been downloaded and is ready to be installed. Please install it as soon as possible to benefit from bug fixes and new features.
	updateWindowInfo:
		"新版本已下载并准备安装。请尽快安装它，以便从错误修复和新功能中受益。",
	// Install
	updateWindowButton: "安装",
	// The app will exit and start the update flow. Please do not interrupt this process.
	updateWindowInfo2: "应用程序将退出并开始更新流程。请不要中断此过程。",
	// Update installed
	titlebarUpdateInstalled: "已安装更新",
	// Clear local event log
	clearLocalEventLog: "清除本地事件日志",
	// This will clear the local event log shown. Are you sure? This action cannot be undone!
	clearLocalEventLogInfo: "这将清除显示的本地事件日志。你确定吗？此操作无法撤消！",
	// Copied
	copied: "已复制",
	// Public link copied to clipboard
	publicLinkCopied: "公开链接已复制到剪贴板",
	// Clear local trash bins
	clearLocalTrashDirs: "清空本地垃圾箱",
	// Clearing the local trash bins cannot be undone! Are you sure?
	clearLocalTrashDirsInfo: "清空本地垃圾箱的操作无法撤消！你确定吗？",
	// The client will exit and start the update flow in the background. It will restart itself when it is done. Please do not interrupt this process.
	updateWindowInfo3:
		"客户端将退出并在后台启动更新流程。完成后它将自行重新启动。请不要中断此过程。",
	// Please login
	pleaseLogin: "请登录",
	// __NUM__ sync issues
	traySyncIssues: "__NUM__ 个同步问题",
	// Syncing __NUM__ items
	traySyncing: "正在同步 __NUM__ 个项目",
	// Everything synced
	everythingSynced: "均已同步",
	// __NUM__ warnings
	trayWarnings: "__NUM__ 个警告",
	// No sync locations setup yet
	trayNoSyncSetup: "尚未设置同步位置",
	// No remote sync locations setup yet
	trayNoSyncRemoteSetup: "尚未设置远程同步位置",
	// __TIME__ seconds ago
	timeSinceSeconds: "__TIME__ 秒之前",
	// __TIME__ minutes ago
	timeSinceMinutes: "__TIME__ 分钟之前",
	// __TIME__ hours ago
	timeSinceHours: "__TIME__ 小时之前",
	// __TIME__ days ago
	timeSinceDays: "__TIME__ 天之前",
	// __TIME__ months ago
	timeSinceMonths: "__TIME__ 个月之前",
	// __TIME__ years ago
	timeSinceYears: "__TIME__ 年之前",
	// Show
	trayMenuShow: "显示",
	// Force sync
	trayMenuForceSync: "强制同步",
	// Upload folders
	trayMenuUploadFolders: "上传文件夹",
	// Upload files
	trayMenuUploadFiles: "上传文件",
	// Settings
	trayMenuSettings: "设置",
	// Quit Filen
	trayMenuQuit: "退出 Filen",
	// Open local folder
	openLocalFolder: "打开本地文件夹",
	// Open local trash folder
	openLocalTrash: "打开本地垃圾箱文件夹",
	// Help
	help: "帮助",
	// Possible solution
	possibleSolution: "可能的解决方案",
	// Please make sure that the client has all permissions needed to read and write to the above path.
	possibleSolutionEPERM: "请确保客户端具有读取和写入上述路径所需的所有权限。",
	// Please make sure the above path exists on your system.
	possibleSolutionENOENT: "请确保您的系统上存在上述路径。",
	// The client could not access the above path. Please check if other programs are actively using it or locking it.
	possibleSolutionEBUSY:
		"客户端无法访问上述路径。请检查其他程序是否正在使用它或正在锁定它。",
	// Not enough file descriptors or space left on your system.
	possibleSolutionEMFILE: "系统上没有足够的文件描述符或空间。",
	// Please make sure your local sync location does not contain symlinks that result into infinite loops.
	possibleSolutionELOOP: "请确保您的本地同步位置不包含导致无限循环的符号链接。",
	// File name or path too long. Please reduce the length to a value supported by your operating system.
	possibleSolutionENAMETOOLONG: "文件名或路径太长。请将长度减少到您的操作系统支持的值。",
	// Issue
	issue: "问题",
	// Path
	path: "路径"
}

export default zh
