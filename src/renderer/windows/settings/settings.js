import React, { memo, useState, useEffect, useCallback, useRef } from "react"
import { Flex, Text, Link, Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter, Switch, Box, Spinner, Select, Tooltip, Avatar, Progress, Badge, Input, useToast, Kbd } from "@chakra-ui/react"
import useDarkMode from "../../lib/hooks/useDarkMode"
import useLang from "../../lib/hooks/useLang"
import usePlatform from "../../lib/hooks/usePlatform"
import Titlebar from "../../components/Titlebar"
import { i18n } from "../../lib/i18n"
import { HiOutlineCog, HiOutlineSave } from "react-icons/hi"
import { AiOutlineSync, AiOutlinePauseCircle, AiOutlineInfoCircle } from "react-icons/ai"
import { VscAccount } from "react-icons/vsc"
import useDb from "../../lib/hooks/useDb"
import ipc from "../../lib/ipc"
import * as fsLocal from "../../lib/fs/local"
import { v4 as uuidv4 } from "uuid"
import db from "../../lib/db"
import { IoChevronForwardOutline, IoChevronBackOutline } from "react-icons/io5"
import colors from "../../styles/colors"
import Container from "../../components/Container"
import CodeMirror from "@uiw/react-codemirror"
import { createCodeMirrorTheme } from "../../styles/codeMirror"
import { GoIssueReopened } from "react-icons/go"
import { userInfo as getUserInfo } from "../../lib/api"
import { formatBytes } from "../../lib/helpers"
import { MdOutlineNetworkCheck } from "react-icons/md"
import { FaCannabis, FaHackerrank } from "react-icons/fa"
import IsOnlineBottomToast from "../../components/IsOnlineBottomToast"
import { BsKeyboard } from "react-icons/bs"
import { List } from "react-virtualized"
import { debounce } from "lodash"

const log = window.require("electron-log")
const { shell, ipcRenderer } = window.require("electron")
const pathModule = window.require("path")
const fs = window.require("fs-extra")

const STARTING_ROUTE_URL_PARAMS = new URLSearchParams(window.location.search)
const STARTING_ROUTE = typeof STARTING_ROUTE_URL_PARAMS.get("page") == "string" ? STARTING_ROUTE_URL_PARAMS.get("page") : "general"

const SettingsWindowGeneral = memo(({ darkMode, lang, platform }) => {
    const [openAtStartupAsync, setOpenAtStartupAsync] = useState(undefined)
    const [appVersionAsync, setAppVersionAsync] = useState(undefined)
    const [openAtStartup, setOpenAtStartup] = useState(true)
    const [appVersion, setAppVersion] = useState("1")
    const excludeDot = useDb("excludeDot", true)

    const getOpenAtStartup = useCallback(() => {
        ipc.getOpenOnStartup().then((open) => {
            setOpenAtStartupAsync(open)
            setOpenAtStartup(open)
        }).catch(log.error)
    })

    const getAppVersion = useCallback(() => {
        ipc.getVersion().then((version) => {
            setAppVersionAsync(version)
            setAppVersion(version)
        }).catch(log.error)
    })

    const populate = useCallback(() => {
        getOpenAtStartup()
        getAppVersion()
    })

    useEffect(() => {
        if(typeof openAtStartupAsync !== "undefined"){
            setOpenAtStartup(openAtStartupAsync)
        }

        if(typeof appVersionAsync !== "undefined"){
            setAppVersion(appVersionAsync)
        }
    }, [openAtStartupAsync, appVersionAsync])

    useEffect(() => {
        populate()
    }, [])

    return (
        <>
            <Flex 
                width="100%" 
                height="100%" 
                flexDirection="column"
            >
                {
                    platform !== "linux" && (
                        <Flex 
                            flexDirection="row" 
                            justifyContent="space-between" 
                            alignItems="center" 
                            width="80%" 
                            margin="0px auto" 
                            marginTop="50px" 
                            paddingBottom="5px" 
                            borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
                        >
                            <Flex>
                                <Text 
                                    color={colors(platform, darkMode, "textPrimary")} 
                                    fontSize={15}
                                >
                                    Launch at system startup
                                </Text>
                            </Flex>
                            <Flex>
                                <Switch 
                                    isChecked={openAtStartup} 
                                    _focus={{ outline: "none" }} 
                                    outline="none" 
                                    _active={{ outline: "none" }} 
                                    onChange={() => {
                                        const value = !openAtStartup

                                        setOpenAtStartup(value)

                                        ipc.setOpenOnStartup(value).catch((err) => {
                                            log.error()

                                            setOpenAtStartup(!value)
                                        })
                                    }}
                                />
                            </Flex>
                        </Flex>
                    )
                }
                <Flex 
                    flexDirection="row" 
                    justifyContent="space-between" 
                    alignItems="center" 
                    width="80%" 
                    margin="0px auto" 
                    marginTop="10px" 
                    paddingBottom="5px" 
                    borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
                >
                    <Flex>
                        <Text 
                            color={colors(platform, darkMode, "textPrimary")} 
                            fontSize={15}
                        >
                            Dark mode
                        </Text>
                    </Flex>
                    <Flex>
                        <Switch 
                            isChecked={darkMode} 
                            _focus={{ outline: "none" }} 
                            outline="none" 
                            _active={{ outline: "none" }} 
                            onChange={() => {
                                db.set("userSelectedTheme", darkMode ? "light" : "dark").catch(log.error)
                            }}
                        />
                    </Flex>
                </Flex>
                <Flex 
                    flexDirection="row" 
                    justifyContent="space-between" 
                    alignItems="center" 
                    width="80%" 
                    margin="0px auto" 
                    marginTop="10px" 
                    paddingBottom="5px" 
                    borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
                >
                    <Flex>
                        <Tooltip 
                            label={
                                <Text 
                                    color={colors(platform, darkMode, "textPrimary")} 
                                    fontSize={14}
                                >
                                    Exclude files and folders starting with a dot, e.g. ".gitignore, .DS_Store"
                                </Text>
                            }
                            placement="top-end"
                            borderRadius="15px"
                            backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
                            shadow="none"
                        >
                            <Text 
                                color={colors(platform, darkMode, "textPrimary")} 
                                fontSize={15}
                            >
                                Exclude dot files and folders (recommended)
                            </Text>
                        </Tooltip>
                    </Flex>
                    <Flex>
                        <Switch 
                            isChecked={excludeDot} 
                            _focus={{ outline: "none" }} 
                            outline="none" 
                            _active={{ outline: "none" }} 
                            onChange={() => {
                                db.set("excludeDot", !excludeDot).catch(log.error)
                            }}
                        />
                    </Flex>
                </Flex>
                <Flex 
                    flexDirection="row" 
                    justifyContent="space-between" 
                    alignItems="center" 
                    width="80%" 
                    margin="0px auto" 
                    marginTop="10px" 
                    paddingBottom="5px" 
                    borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
                >
                    <Flex>
                        <Text 
                            color={colors(platform, darkMode, "textPrimary")} 
                            fontSize={15}
                        >
                            Language
                        </Text>
                    </Flex>
                    <Flex>
                    <Select
                        value={lang} 
                        color={colors(platform, darkMode, "textPrimary")}
                        fontSize={14} 
                        height="30px" 
                        borderColor={colors(platform, darkMode, "borderPrimary")} 
                        _focus={{
                            outline: "none"
                        }} 
                        outline="none" 
                        _active={{
                            outline: "none"
                        }} 
                        onChange={(e) => {
                            db.set("lang", e.nativeEvent.target.value).catch(log.error)
                        }}
                    >
                        <option 
                            value="en" 
                            style={{
                                backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                height: "30px",
                                borderRadius: "10px"
                            }}
                        >
                            English
                        </option>
                    </Select>
                    </Flex>
                </Flex>
                <Flex 
                    width="100%" 
                    height="auto" 
                    bottom="50px" 
                    position="fixed"
                >
                    <Flex 
                        flexDirection="row" 
                        justifyContent="space-between" 
                        alignItems="center" 
                        width="80%" 
                        margin="0px auto" 
                        paddingTop="5px" 
                        paddingBottom="5px" 
                        borderTop={"1px solid " + colors(platform, darkMode, "borderPrimary")}
                    >
                        <Flex>
                            <Text 
                                color={colors(platform, darkMode, "textPrimary")} 
                                fontSize={13}
                            >
                                v{appVersion}
                            </Text>
                        </Flex>
                        <Flex>
                            <Link 
                                color={colors(platform, darkMode, "link")} 
                                fontSize={13} 
                                textDecoration="none" 
                                _hover={{
                                    textDecoration: "none"
                                }}
                                onClick={() => ipc.saveLogs().then(log.info).catch(log.error)}
                            >
                                Save logs
                            </Link>
                        </Flex>
                    </Flex>
                </Flex>
            </Flex>
        </>
    )
})

const SettingsWindowSyncs = memo(({ darkMode, lang, platform, userId }) => {
    const syncLocations = useDb("syncLocations:" + userId, [])
    const toast = useToast()
    const [syncSettingsModalOpen, setSyncSettingsModalOpen] = useState(false)
    const [currentSyncLocation, setCurrentSyncLocation] = useState(undefined)
    const [confirmDeleteModalOpen, setConfirmDeleteModalOpen] = useState(false)
    const [ignoredFilesModalOpen, setIgnoredFilesModalOpen] = useState(false)
    const [currentSyncLocationIgnored, setCurrentSyncLocationIgnored] = useState("")

    const createNewSyncLocation = useCallback(() => {
        db.get("syncLocations:" + userId).then((currentSyncLocations) => {
            ipc.selectFolder().then((result) => {
                if(result.canceled){
                    return false
                }
    
                const paths = result.filePaths
    
                if(!Array.isArray(paths)){
                    return false
                }
    
                const localPath = pathModule.normalize(paths[0])
    
                if(typeof localPath !== "string"){
                    return false
                }

                const ex = platform == "windows" ? localPath.indexOf("\\") : localPath.indexOf("//")

                if(ex.length <= 1 || pathModule.dirname(localPath).length <= 0 || (ex.length >= 2 && ex[1].length <= 0)){
                    return toast({
                        title: "Cannot create sync location",
                        description: "You need to select at least one sub directory.",
                        status: "error",
                        duration: 10000,
                        isClosable: true,
                        position: "bottom",
                        containerStyle: {
                            backgroundColor: "rgba(255, 69, 58, 1)",
                            maxWidth: "85%",
                            height: "auto",
                            fontSize: 14,
                            borderRadius: "15px"
                        }
                    })
                }

                if(Array.isArray(currentSyncLocations) && currentSyncLocations.length > 0){
                    if(currentSyncLocations.filter(location => location.local == localPath || location.local.indexOf(localPath) !== -1 || localPath.indexOf(location.local) !== -1).length > 0){
                        return toast({
                            title: "Cannot create sync location",
                            description: "The local path you have selected is already a configured sync location. This could lead to endless sync loops.",
                            status: "error",
                            duration: 10000,
                            isClosable: true,
                            position: "bottom",
                            containerStyle: {
                                backgroundColor: "rgba(255, 69, 58, 1)",
                                maxWidth: "85%",
                                height: "auto",
                                fontSize: 14,
                                borderRadius: "15px"
                            }
                        })
                    }
                }
    
                Promise.all([
                    fs.access(localPath, fs.constants.R_OK | fs.constants.W_OK),
                    fsLocal.smokeTest(localPath)
                ]).then(async () => {
                    const uuid = uuidv4()
    
                    try{
                        let currentSyncLocations = await db.get("syncLocations:" + userId)
    
                        if(!Array.isArray(currentSyncLocations)){
                            currentSyncLocations = []
                        }
    
                        if(currentSyncLocations.filter(location => location.local == localPath).length == 0){
                            currentSyncLocations.push({
                                uuid,
                                local: localPath,
                                remote: undefined,
                                remoteUUID: undefined,
                                remoteName: undefined,
                                type: "twoWay",
                                paused: false,
                                busy: false,
                                localChanged: false
                            })
                        }
    
                        await db.set("syncLocations:" + userId, currentSyncLocations)
                    }
                    catch(e){
                        log.error(e)
                    }
                }).catch((err) => {
                    log.error(err)
                })
            }).catch((err) => {
                log.error(err)
            })
        }).catch((err) => {
            log.error(err)
        })
    })

    const debounceFilenIgnore = useCallback(debounce((value, uuid) => {
        console.log(value)

        db.set("filenIgnore:" + uuid, value).catch((err) => {
            log.error(err)
        })
    }, 1000), [])

    useEffect(() => {
        if(typeof currentSyncLocation !== "undefined"){
            for(let i = 0; i < syncLocations.length; i++){
                if(syncLocations[i].uuid == currentSyncLocation.uuid){
                    setCurrentSyncLocation(syncLocations[i])
                }
            }
        }
    }, [syncLocations])

    useEffect(() => {
        if(typeof currentSyncLocation !== "undefined" && ignoredFilesModalOpen){
            db.get("filenIgnore:" + currentSyncLocation.uuid).then((filenIgnore) => {
                if(typeof filenIgnore !== "string"){
                    filenIgnore = ""
                }

                if(currentSyncLocationIgnored.length == 0){
                    setCurrentSyncLocationIgnored(filenIgnore)
                }
            }).catch((err) => {
                log.error(err)
            })
        }
    }, [currentSyncLocation, ignoredFilesModalOpen])

    return (
        <>
            {
                syncLocations.length == 0 ? (
                    <Flex flexDirection="column" width="100%" height="400px" alignItems="center" justifyContent="center">
                        <Flex>
                            <AiOutlineSync size={50} color={darkMode ? "gray" : "gray"} />
                        </Flex>
                        <Flex marginTop="15px">
                            <Text color={darkMode ? "gray" : "gray"}>No sync locations setup yet.</Text>
                        </Flex>
                        <Flex marginTop="15px">
                            <Link color={colors(platform, darkMode, "link")} textDecoration="none" _hover={{
                                textDecoration: "none"
                            }} onClick={() => createNewSyncLocation()}>Create one</Link>
                        </Flex>
                    </Flex>
                ) : (
                    <Flex flexDirection="column" width="100vw" height="auto" alignItems="center" justifyContent="center" paddingTop="30px">
                        <List
                            height={(syncLocations.length * 55 >= 420) ? 420 : syncLocations.length * 55}
                            width={window.innerWidth * 0.9}
                            noRowsRenderer={() => <></>}
                            overscanRowCount={8}
                            rowCount={syncLocations.length}
                            rowHeight={55}
                            estimatedRowSize={syncLocations.length * 55}
                            rowRenderer={({ index, key, style }) => {
                                const location = syncLocations[index]

                                return (
                                    <Flex key={key} style={style} flexDirection="column" padding="5px" width="100%" height="100%">
                                        <Flex width="100%" height="100%" flexDirection="row" backgroundColor={colors(platform, darkMode, "backgroundSecondary")} paddingLeft="12px" paddingRight="12px" borderRadius="15px" borderBottom={"0px solid " + colors(platform, darkMode, "borderPrimary")}>
                                            <Flex width="45%" flexDirection="row" justifyContent="flex-start" alignItems="center">
                                                <Tooltip 
                                                    label={
                                                        <Text color={colors(platform, darkMode, "textPrimary")} fontSize={14}>{location.local}</Text>
                                                    }
                                                    placement="top"
                                                    borderRadius="15px"
                                                    backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
                                                    shadow="none"
                                                >
                                                    <Text noOfLines={1} color={colors(platform, darkMode, "textPrimary")} fontSize={15}>{location.local}</Text>
                                                </Tooltip>
                                            </Flex>
                                            <Flex width="10%" flexDirection="row" justifyContent="center" alignItems="center">
                                                {
                                                    location.paused ? (
                                                        <AiOutlinePauseCircle color={colors(platform, darkMode, "textPrimary")} size={15} />
                                                    ) : (
                                                        <>
                                                            {
                                                                location.type == "twoWay" && (
                                                                    <Flex alignItems="center" paddingTop="3px">
                                                                        <IoChevronBackOutline color={colors(platform, darkMode, "textPrimary")} size={15} />
                                                                        <IoChevronForwardOutline color={colors(platform, darkMode, "textPrimary")} size={15} />
                                                                    </Flex>
                                                                )
                                                            }
                                                            {
                                                                location.type == "localToCloud" && (
                                                                    <Flex alignItems="center" paddingTop="3px">
                                                                        <IoChevronForwardOutline color={colors(platform, darkMode, "textPrimary")} size={15} />
                                                                    </Flex>
                                                                )
                                                            }
                                                            {
                                                                location.type == "cloudToLocal" && (
                                                                    <Flex alignItems="center" paddingTop="3px">
                                                                        <IoChevronBackOutline color={colors(platform, darkMode, "textPrimary")} size={15} />
                                                                    </Flex>
                                                                )
                                                            }
                                                            {
                                                                location.type == "localBackup" && (
                                                                    <Flex alignItems="center" paddingTop="3px">
                                                                        <HiOutlineSave color={colors(platform, darkMode, "textPrimary")} size={15} />
                                                                        <IoChevronForwardOutline color={colors(platform, darkMode, "textPrimary")} size={15} />
                                                                    </Flex>
                                                                )
                                                            }
                                                            {
                                                                location.type == "cloudBackup" && (
                                                                    <Flex alignItems="center" paddingTop="3px">
                                                                        <IoChevronBackOutline color={colors(platform, darkMode, "textPrimary")} size={15} />
                                                                        <HiOutlineSave color={colors(platform, darkMode, "textPrimary")} size={15} />
                                                                    </Flex>
                                                                )
                                                            }
                                                        </>
                                                    )
                                                }
                                            </Flex>
                                            <Flex width="40%" flexDirection="row" justifyContent="flex-end" alignItems="center">
                                                {
                                                    typeof location.remote == "string" && location.remote.length > 0 ? (
                                                        <Tooltip 
                                                            label={
                                                                <Text color={colors(platform, darkMode, "textPrimary")} fontSize={14}>{location.remote}</Text>
                                                            }
                                                            placement="top"
                                                            borderRadius="15px"
                                                            backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
                                                            shadow="none"
                                                        >
                                                            <Text noOfLines={1} color={colors(platform, darkMode, "textPrimary")} fontSize={15}>{location.remote}</Text>
                                                        </Tooltip>
                                                    ) : (
                                                        <Link color={colors(platform, darkMode, "link")} textDecoration="none" _hover={{
                                                            textDecoration: "none"
                                                        }} fontSize={14} onClick={() => {
                                                            db.get("syncLocations:" + userId).then((currentSyncLocations) => {
                                                                ipc.selectRemoteFolder().then(async (result) => {
                                                                    if(result.canceled){
                                                                        return false
                                                                    }
    
                                                                    const { uuid, name, path } = result

                                                                    if(Array.isArray(currentSyncLocations) && currentSyncLocations.length > 0){
                                                                        if(currentSyncLocations.filter(location => (typeof location.remote == "string" ? location.remote == path : false) || (typeof location.remote == "string" ? location.remote.indexOf(path) !== -1 : false) || (typeof location.remote == "string" ? path.indexOf(location.remote) !== -1 : false)).length > 0){
                                                                            return toast({
                                                                                title: "Cannot create sync location",
                                                                                description: "The remote path you have selected is already a configured sync location. This could lead to endless sync loops.",
                                                                                status: "error",
                                                                                duration: 5000,
                                                                                isClosable: true,
                                                                                position: "bottom",
                                                                                containerStyle: {
                                                                                    backgroundColor: "rgba(255, 69, 58, 1)",
                                                                                    maxWidth: "85%",
                                                                                    height: "auto",
                                                                                    fontSize: 14,
                                                                                    borderRadius: "15px"
                                                                                }
                                                                            })
                                                                        }
                                                                    }
    
                                                                    try{
                                                                        let currentSyncLocations = await db.get("syncLocations:" + userId)
    
                                                                        if(!Array.isArray(currentSyncLocations)){
                                                                            currentSyncLocations = []
                                                                        }
    
                                                                        for(let i = 0; i < currentSyncLocations.length; i++){
                                                                            if(currentSyncLocations[i].uuid == location.uuid){
                                                                                currentSyncLocations[i].remoteUUID = uuid
                                                                                currentSyncLocations[i].remote = path
                                                                                currentSyncLocations[i].remoteName = name
                                                                            }
                                                                        }
    
                                                                        await db.set("syncLocations:" + userId, currentSyncLocations)
                                                                    }
                                                                    catch(e){
                                                                        log.error(e)
                                                                    }
                                                                }).catch((err) => {
                                                                    console.log(err)
                                                                })
                                                            }).catch((err) => {
                                                                console.log(err)
                                                            })
                                                        }}>Select remote location</Link>
                                                    )
                                                }
                                            </Flex>
                                            <Flex width="5%" flexDirection="row" justifyContent="flex-end" alignItems="center">
                                                <HiOutlineCog color={colors(platform, darkMode, "textPrimary")} size={15} cursor="pointer" pointerEvents="all" onClick={() => {
                                                    setCurrentSyncLocation(location)
                                                    setSyncSettingsModalOpen(true)
                                                }} />
                                            </Flex>
                                        </Flex>
                                    </Flex>
                                )
                            }}
                        />
                        <Link color={colors(platform, darkMode, "link")} marginTop="10px" textDecoration="none" _hover={{
                            textDecoration: "none"
                        }} onClick={() => createNewSyncLocation()}>Create one</Link>
                    </Flex>
                )
            }
            <Modal onClose={() => setSyncSettingsModalOpen(false)} isOpen={syncSettingsModalOpen} isCentered={true}>
                <ModalOverlay borderRadius="10px" />
                <ModalContent backgroundColor={colors(platform, darkMode, "backgroundPrimary")} borderRadius="15px">
                    <ModalHeader color={colors(platform, darkMode, "textPrimary")}>Settings</ModalHeader>
                    <ModalCloseButton color={colors(platform, darkMode, "textPrimary")} _focus={{ _focus: "none" }} _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }} />
                    <ModalBody>
                        {
                            typeof currentSyncLocation !== "undefined" && (
                                <>
                                    <Flex width="100%" height="auto" justifyContent="space-between" alignItems="center">
                                        <Flex alignItems="center">
                                            <Text color={colors(platform, darkMode, "textPrimary")} fontSize={14}>Sync mode</Text>
                                            <Tooltip 
                                                label={
                                                    <Flex flexDirection="column">
                                                        <Text color="white">
                                                            This is
                                                        </Text>
                                                        <Text color="white">
                                                            a text
                                                        </Text>
                                                    </Flex>
                                                }
                                                placement="right"
                                                borderRadius="15px"
                                                backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
                                                shadow="none"
                                            >
                                                <Flex marginLeft="5px">
                                                    <AiOutlineInfoCircle size={18} color={colors(platform, darkMode, "textPrimary")} />
                                                </Flex>
                                            </Tooltip>
                                        </Flex>
                                        <Flex alignItems="center">
                                            <Select value={currentSyncLocation.type} color={colors(platform, darkMode, "textPrimary")} fontSize={14} height="30px" borderColor={colors(platform, darkMode, "borderPrimary")}  _focus={{ outline: "none" }} outline="none" _active={{ outline: "none" }} disabled={typeof currentSyncLocation.remote !== "string"} onChange={async (e) => {
                                                const type = e.nativeEvent.target.value

                                                try{
                                                    let currentSyncLocations = await db.get("syncLocations:" + userId)

                                                    if(!Array.isArray(currentSyncLocations)){
                                                        currentSyncLocations = []
                                                    }

                                                    for(let i = 0; i < currentSyncLocations.length; i++){
                                                        if(currentSyncLocations[i].uuid == currentSyncLocation.uuid){
                                                            currentSyncLocations[i].type = type
                                                        }
                                                    }

                                                    await db.set("syncLocations:" + userId, currentSyncLocations)
                                                }
                                                catch(e){
                                                    log.error(e)
                                                }
                                            }}>
                                                <option value="twoWay" style={{
                                                    backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                                    height: "30px",
                                                    borderRadius: "10px"
                                                }}>Two Way</option>
                                                <option value="localToCloud" style={{
                                                    backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                                    height: "30px",
                                                    borderRadius: "10px"
                                                }}>Local to Cloud</option>
                                                <option value="cloudToLocal" style={{
                                                    backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                                    height: "30px",
                                                    borderRadius: "10px"
                                                }}>Cloud to Local</option>
                                                <option value="localBackup" style={{
                                                    backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                                    height: "30px",
                                                    borderRadius: "10px"
                                                }} >Local backup</option>
                                                <option value="cloudBackup" style={{
                                                    backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                                    height: "30px",
                                                    borderRadius: "10px"
                                                }}>Cloud backup</option>
                                            </Select>
                                        </Flex>
                                    </Flex>
                                    <Flex width="100%" height="auto" justifyContent="space-between" alignItems="center" marginTop="10px">
                                        <Flex alignItems="center">
                                            <Text color={colors(platform, darkMode, "textPrimary")} fontSize={14}>Selective Sync</Text>
                                            <Tooltip 
                                                label={
                                                    <Flex flexDirection="column">
                                                        <Text color={colors(platform, darkMode, "textPrimary")}>
                                                            Configure which folders and files you want to have synced locally
                                                        </Text>
                                                    </Flex>
                                                }
                                                placement="right"
                                                borderRadius="15px"
                                                backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
                                                shadow="none"
                                            >
                                                <Flex marginLeft="5px">
                                                    <AiOutlineInfoCircle size={18} color={colors(platform, darkMode, "textPrimary")} />
                                                </Flex>
                                            </Tooltip>
                                        </Flex>
                                        <Flex>
                                            <Link color={colors(platform, darkMode, "link")} textDecoration="none" _hover={{ textDecoration: "none" }} onClick={() => {
                                                if(typeof currentSyncLocation.remote !== "string"){
                                                    return false
                                                }
                                                
                                                setSyncSettingsModalOpen(false)
                                                
                                                ipc.openSelectiveSyncWindow({
                                                    currentSyncLocation
                                                })
                                            }}>Configure</Link>
                                        </Flex>
                                    </Flex>
                                    <Flex width="100%" height="auto" justifyContent="space-between" alignItems="center" marginTop="10px">
                                        <Flex alignItems="center">
                                            <Text color={colors(platform, darkMode, "textPrimary")} fontSize={14}>.filenignore</Text>
                                            <Tooltip 
                                                label={
                                                    <Flex flexDirection="column">
                                                        <Text color={colors(platform, darkMode, "textPrimary")}>
                                                            Exclude paths and patterns from syncing. Works just like a .gitignore file
                                                        </Text>
                                                    </Flex>
                                                }
                                                placement="right"
                                                borderRadius="15px"
                                                backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
                                                shadow="none"
                                            >
                                                <Flex marginLeft="5px">
                                                    <AiOutlineInfoCircle size={18} color={colors(platform, darkMode, "textPrimary")} />
                                                </Flex>
                                            </Tooltip>
                                        </Flex>
                                        <Flex>
                                            <Link color={colors(platform, darkMode, "link")} textDecoration="none" _hover={{ textDecoration: "none" }} onClick={() => {
                                                if(typeof currentSyncLocation.remote !== "string"){
                                                    return false
                                                }

                                                setSyncSettingsModalOpen(false)
                                                setTimeout(() => setIgnoredFilesModalOpen(true), 100)
                                            }}>Edit</Link>
                                        </Flex>
                                    </Flex>
                                    <Flex width="100%" height="auto" justifyContent="space-between" alignItems="center" marginTop="10px">
                                        <Text color={colors(platform, darkMode, "textPrimary")} fontSize={14}>Paused</Text>
                                        <Flex>
                                            <Switch isChecked={currentSyncLocation.paused} disabled={typeof currentSyncLocation.remote !== "string"} _focus={{ outline: "none" }} outline="none" _active={{ outline: "none" }} onChange={async (event) => {
                                                const paused = event.nativeEvent.target.checked

                                                try{
                                                    let currentSyncLocations = await db.get("syncLocations:" + userId)

                                                    if(!Array.isArray(currentSyncLocations)){
                                                        currentSyncLocations = []
                                                    }

                                                    for(let i = 0; i < currentSyncLocations.length; i++){
                                                        if(currentSyncLocations[i].uuid == currentSyncLocation.uuid){
                                                            currentSyncLocations[i].paused = paused
                                                        }
                                                    }

                                                    await db.set("syncLocations:" + userId, currentSyncLocations)
                                                }
                                                catch(e){
                                                    log.error(e)
                                                }
                                            }} />
                                        </Flex>
                                    </Flex>
                                    {
                                        typeof currentSyncLocation !== "undefined" && (
                                            <Flex width="100%" height="auto" justifyContent="space-between" alignItems="center" marginTop="25px">
                                                <Link color={currentSyncLocation.busy ? "gray" : colors(platform, darkMode, "danger")} textDecoration="none" _hover={{ textDecoration: "none" }} fontSize={11} onClick={() => {
                                                    if(currentSyncLocation.busy){
                                                        return false
                                                    }

                                                    setSyncSettingsModalOpen(false)
                                                    setTimeout(() => setConfirmDeleteModalOpen(true), 250)
                                                }} marginRight="15px">Delete sync location</Link>
                                            </Flex>
                                        )
                                    }
                                </>
                            )
                        }
                    </ModalBody>
                    <ModalFooter>
                        <Link color={colors(platform, darkMode, "link")} textDecoration="none" _hover={{ textDecoration: "none" }} onClick={() => setSyncSettingsModalOpen(false)}>Close</Link>
                    </ModalFooter>
                </ModalContent>
            </Modal>
            <Modal onClose={() => setConfirmDeleteModalOpen(false)} isOpen={confirmDeleteModalOpen} isCentered>
                <ModalOverlay borderRadius="10px" />
                <ModalContent backgroundColor={colors(platform, darkMode, "backgroundPrimary")} borderRadius="15px">
                    <ModalHeader color={colors(platform, darkMode, "textPrimary")}>Settings</ModalHeader>
                    <ModalCloseButton color={colors(platform, darkMode, "textPrimary")} _focus={{ _focus: false }} _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }} />
                    <ModalBody>
                        <Text color={colors(platform, darkMode, "textPrimary")} fontSize={14}>Are you sure you want to delete this sync?</Text>
                    </ModalBody>
                    <ModalFooter>
                        <Link color={colors(platform, darkMode, "link")} textDecoration="none" _hover={{ textDecoration: "none" }} onClick={() => setConfirmDeleteModalOpen(false)} marginRight="15px">Close</Link>
                        <Link color={colors(platform, darkMode, "danger")} textDecoration="none" _hover={{ textDecoration: "none" }} onClick={async () => {
                            if(typeof currentSyncLocation == "undefined"){
                                return setConfirmDeleteModalOpen(false)
                            }

                            if(currentSyncLocation.busy){
                                return setConfirmDeleteModalOpen(false)
                            }

                            try{
                                let currentSyncLocations = await db.get("syncLocations:" + userId)

                                if(!Array.isArray(currentSyncLocations)){
                                    currentSyncLocations = []
                                }

                                for(let i = 0; i < currentSyncLocations.length; i++){
                                    if(currentSyncLocations[i].uuid == currentSyncLocation.uuid){
                                        currentSyncLocations.splice(i, 1)
                                    }
                                }

                                await db.set("syncLocations:" + userId, currentSyncLocations)
                            }
                            catch(e){
                                log.error(e)
                            }

                            setConfirmDeleteModalOpen(false)
                        }}>Delete</Link>
                    </ModalFooter>
                </ModalContent>
            </Modal>
            <Modal onClose={() => {
                setIgnoredFilesModalOpen(false)
                setTimeout(() => setSyncSettingsModalOpen(true), 100)
            }} isOpen={ignoredFilesModalOpen} size="full">
                <ModalOverlay borderRadius="10px" />
                <ModalContent backgroundColor={colors(platform, darkMode, "backgroundPrimary")} borderRadius="10px">
                    <ModalCloseButton color={colors(platform, darkMode, "textPrimary")} _focus={{ _focus: false }} _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }} />
                    <ModalBody padding="0px">
                        <Flex width="100%" height={window.innerHeight} flexDirection="column">
                            <Flex marginTop="30px" width="100%" height="auto" borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")} justifyContent="center" alignItems="center">
                                <Text color={colors(platform, darkMode, "textPrimary")} fontSize={14} paddingBottom="5px">Ignored pattern, seperated by a new line</Text>
                            </Flex>
                            <CodeMirror
                                value={currentSyncLocationIgnored}
                                width="100%"
                                height="490px"
                                placeholder={"ignored/folder\nignoredFile.txt"}
                                autoFocus={true}
                                theme={createCodeMirrorTheme({ platform, darkMode })}
                                onChange={async (value, viewUpdate) => {
                                    if(typeof currentSyncLocation == "undefined"){
                                        return false
                                    }

                                    setCurrentSyncLocationIgnored(value)
                                    debounceFilenIgnore(value, currentSyncLocation.uuid)
                                }}
                            />
                        </Flex>
                    </ModalBody>
                    <ModalFooter position="absolute" bottom="0" right="0">
                        <Link color="gray" textDecoration="none" _hover={{ textDecoration: "none" }} onClick={() => {
                            setIgnoredFilesModalOpen(false)
                            setTimeout(() => setSyncSettingsModalOpen(true), 100)
                        }}>{i18n(lang, "close")}</Link>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    )
})

const SettingsWindowAccount = memo(({ darkMode, lang, platform, email }) => {
    const [logoutAlertOpen, setLogoutAlertOpen] = useState(false)
    const [userInfo, setUserInfo] = useState(undefined)

    const logout = useCallback(async () => {
        try{
            await Promise.all([
                db.remove("apiKey"),
                db.remove("email"),
                db.remove("userId"),
                db.remove("masterKeys"),
                db.remove("authVersion"),
                db.remove("isLoggedIn"),
                db.remove("privateKey"),
                db.remove("publicKey")
            ])

            ipc.restartApp().catch(log.error)
        }
        catch(e){
            log.error(e)
        }
    })

    useEffect(() => {
        db.get("apiKey").then((apiKey) => {
            getUserInfo({ apiKey }).then((info) => {
                setUserInfo(info)
            }).catch(log.error)
        }).catch(log.error)
    }, [])

    return (
        <>
            {
                typeof userInfo == "object" ? (
                    <>
                        <Flex 
                            width="100%" 
                            height="100%" 
                            flexDirection="column"
                        >
                            <Flex 
                                width="80%" 
                                height="auto" 
                                margin="0px auto" 
                                marginTop="50px"
                            >
                                <Flex 
                                    justifyContent="space-between" 
                                    alignItems="center" 
                                    width="100%" 
                                    height="auto"
                                >
                                    <Flex 
                                        justifyContent="center" 
                                        alignItems="center"
                                    >
                                        <Avatar name={email} />
                                        <Flex flexDirection="column">
                                            <Text 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                fontWeight="bold" 
                                                marginLeft="8px" 
                                                fontSize={18}
                                            >
                                                {email}
                                            </Text>
                                            <Text 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                fontSize={12} marginLeft="8px"
                                            >
                                                {((userInfo.storageUsed / userInfo.maxStorage) * 100) >= 100 ? 100 : ((userInfo.storageUsed / userInfo.maxStorage) * 100).toFixed(2)}% of {formatBytes(userInfo.maxStorage)} used
                                            </Text>
                                        </Flex>
                                    </Flex>
                                    <Flex 
                                        justifyContent="center" 
                                        alignItems="center"
                                    >
                                        <Link 
                                            color={colors(platform, darkMode, "link")} 
                                            textDecoration="none" 
                                            _hover={{ textDecoration: "none" }} 
                                            onClick={() => logout()}
                                        >
                                            Logout
                                        </Link>
                                    </Flex>
                                </Flex>
                            </Flex>
                            <Flex 
                                padding="25px" 
                                backgroundColor={colors(platform, darkMode, "backgroundSecondary")} 
                                borderRadius="15px" 
                                width="80%" 
                                height="auto" 
                                margin="0px auto" 
                                marginTop="35px" 
                                flexDirection="column"
                            >
                                <Flex 
                                    justifyContent="space-between" 
                                    alignItems="center" 
                                    width="100%" 
                                    height="auto"
                                >
                                    <Flex 
                                        justifyContent="center" 
                                        alignItems="center"
                                    >
                                        <Flex flexDirection="column">
                                            <Text 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                fontSize={12}
                                            >
                                                Current Plan
                                            </Text>
                                            <Text 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                fontWeight="bold" 
                                                fontSize={20}
                                            >
                                                {formatBytes(userInfo.maxStorage)}
                                            </Text>
                                        </Flex>
                                    </Flex>
                                    <Flex 
                                        justifyContent="center" 
                                        alignItems="center"
                                    >
                                        <Link 
                                            color={colors(platform, darkMode, "link")} 
                                            textDecoration="none" 
                                            _hover={{ textDecoration: "none" }} 
                                            onClick={() => shell.openExternal("https://filen.io/pro")}
                                        >
                                            Upgrade
                                        </Link>
                                    </Flex>
                                </Flex>
                                <Flex 
                                    width="100%" 
                                    height="auto" 
                                    marginTop="10px"
                                >
                                    <Progress 
                                        value={((userInfo.storageUsed / userInfo.maxStorage) * 100) >= 100 ? 100 : ((userInfo.storageUsed / userInfo.maxStorage) * 100).toFixed(2)}
                                        color="blue.100" 
                                        min={0} 
                                        max={100} 
                                        width="100%" 
                                        height="6px" 
                                        borderRadius="15px" 
                                    />
                                </Flex>
                                <Flex 
                                    justifyContent="space-between" 
                                    alignItems="center" 
                                    width="100%" 
                                    height="auto" 
                                    marginTop="3px"
                                >
                                    <Text 
                                        color={colors(platform, darkMode, "textPrimary")} 
                                        fontSize={11} 
                                        fontWeight="bold"
                                    >
                                        {formatBytes(userInfo.storageUsed)} of {formatBytes(userInfo.maxStorage)} used
                                    </Text>
                                    <Text 
                                        color={colors(platform, darkMode, "textPrimary")} 
                                        fontSize={11}
                                    >
                                        {((userInfo.storageUsed / userInfo.maxStorage) * 100) >= 100 ? 100 : ((userInfo.storageUsed / userInfo.maxStorage) * 100).toFixed(2)}% in use
                                    </Text>
                                </Flex>
                            </Flex>
                        </Flex>
                        <Modal 
                            onClose={() => setLogoutAlertOpen(false)} 
                            isOpen={logoutAlertOpen} 
                            isCentered={true}
                        >
                            <ModalOverlay borderRadius="10px" />
                            <ModalContent 
                                backgroundColor={colors(platform, darkMode, "backgroundPrimary")} 
                                borderRadius="15px"
                            >
                                <ModalCloseButton 
                                    color={colors(platform, darkMode, "textPrimary")} 
                                    _focus={{ _focus: false }} 
                                    _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }} 
                                />
                                <ModalHeader color={colors(platform, darkMode, "textPrimary")}>Logout</ModalHeader>
                                <ModalBody>
                                    <Text color={colors(platform, darkMode, "textPrimary")}>
                                        Are you sure you want to logout?
                                    </Text>
                                </ModalBody>
                                <ModalFooter>
                                    <Link 
                                        color="gray" 
                                        textDecoration="none" 
                                        _hover={{ textDecoration: "none" }} 
                                        onClick={() => setLogoutAlertOpen(false)}
                                    >
                                        Close
                                    </Link>
                                    <Link 
                                        color={colors(platform, darkMode, "link")} 
                                        textDecoration="none"
                                        _hover={{ textDecoration: "none" }} 
                                        marginLeft="10px" 
                                        onClick={() => logout()}
                                    >
                                        Logout
                                    </Link>
                                </ModalFooter>
                            </ModalContent>
                        </Modal>
                    </>
                ) : (
                    <Flex 
                        flexDirection="column" 
                        width="100%" 
                        height="400px" 
                        alignItems="center" 
                        justifyContent="center"
                    >
                        <Flex>
                            <Spinner color={colors(platform, darkMode, "textPrimary")} />
                        </Flex>
                    </Flex>
                )
            }
        </>
    )
})

const SettingsWindowIssues = memo(({ darkMode, lang, platform }) => {
    const syncIssues = useDb("syncIssues", [])

    const [clearIssuesModalOpen, setClearIssuesModalOpen] = useState(false)

    return (
        <>
            <Flex 
                width="100%" 
                height="100%" 
                flexDirection="column" 
                justifyContent="center" 
                alignItems="center"
            >
                {
                    syncIssues.length > 0 ? (
                        <>
                            <Box 
                                width="80%" 
                                height="380px" 
                                backgroundColor={colors(platform, darkMode, "backgroundSecondary")} 
                                overflowY="scroll" 
                                overflowX="hidden" 
                                display="inline-block" 
                                borderRadius="15px" 
                                marginTop="45px"
                            >
                                {
                                    syncIssues.map((issue, index) => {
                                        return (
                                            <Flex 
                                                key={index} 
                                                paddingLeft="10px" 
                                                paddingRight="10px" 
                                                paddingTop="3px" 
                                                paddingBottom="5px" 
                                                flexDirection="row" 
                                                borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
                                            >
                                                <Flex 
                                                    flexDirection="column" 
                                                    justifyContent="flex-start" 
                                                    paddingTop="8px"
                                                >
                                                    <Badge 
                                                        colorScheme="gray" 
                                                        height="20px" 
                                                        borderRadius="10px" 
                                                        paddingLeft="5px" 
                                                        paddingRight="5px"
                                                    >
                                                        {new Date(issue.timestamp).toLocaleString()}
                                                    </Badge>
                                                </Flex>
                                                <Flex 
                                                    flexDirection="row" 
                                                    paddingTop="4px"
                                                >
                                                    <Text 
                                                        color={colors(platform, darkMode, "textPrimary")} 
                                                        fontSize={13} 
                                                        marginLeft="10px" 
                                                        width="100%" 
                                                        wordBreak="break-all"
                                                    >
                                                        {issue.message}
                                                    </Text>
                                                </Flex>
                                            </Flex>
                                        )
                                    })
                                }
                            </Box>
                            <Link 
                                color={colors(platform, darkMode, "link")} 
                                textDecoration="none" 
                                _hover={{ textDecoration: "none" }} 
                                marginTop="15px" 
                                onClick={() => setClearIssuesModalOpen(true)}
                            >
                                Resume syncing
                            </Link>
                        </>
                    ) : (
                        <Flex 
                            flexDirection="column" 
                            width="100%" 
                            height="400px"
                            alignItems="center" 
                            justifyContent="center"
                        >
                            <Flex>
                                <GoIssueReopened 
                                    size={50} 
                                    color={darkMode ? "gray" : "gray"} 
                                />
                            </Flex>
                            <Flex marginTop="15px">
                                <Text color={darkMode ? "gray" : "gray"}>No sync issues.</Text>
                            </Flex>
                        </Flex>
                    )
                }
            </Flex>
            <Modal 
                onClose={() => setClearIssuesModalOpen(false)} 
                isOpen={clearIssuesModalOpen} 
                isCentered={true}
            >
                <ModalOverlay borderRadius="10px" />
                <ModalContent 
                    backgroundColor={colors(platform, darkMode, "backgroundPrimary")} 
                    borderRadius="15px"
                >
                    <ModalCloseButton 
                        color={colors(platform, darkMode, "textPrimary")} 
                        _focus={{ _focus: false }} 
                        _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }} 
                    />
                    <ModalHeader color={colors(platform, darkMode, "textPrimary")}>Clear issues</ModalHeader>
                    <ModalBody>
                        <Text 
                            color={colors(platform, darkMode, "textPrimary")} 
                            fontSize={14}
                        >
                            When clearing the shown issues the client will attempt to sync again. Please make sure to resolve all issues before clearing them.
                        </Text>
                    </ModalBody>
                    <ModalFooter>
                        <Link 
                            color="gray" 
                            textDecoration="none" 
                            _hover={{ textDecoration: "none" }} 
                            onClick={() => setClearIssuesModalOpen(false)}
                        >
                            {i18n(lang, "close")}
                        </Link>
                        <Link 
                            color={colors(platform, darkMode, "link")} 
                            textDecoration="none" 
                            _hover={{ textDecoration: "none" }} 
                            marginLeft="10px" 
                            onClick={async () => {
                                db.set("syncIssues", []).catch(log.error)

                                setClearIssuesModalOpen(false)
                            }}
                        >
                            Clear
                        </Link>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    )
})

const SettingsWindowNetworking = memo(({ darkMode, lang, platform }) => {
    const [throttlingModalOpen, setThrottlingModalOpen] = useState(false)
    const networkingSettings = useDb("networkingSettings", {
        uploadKbps: 0,
        downloadKbps: 0
    })
    const [uploadKbps, setUploadKbps] = useState(0)
    const [downloadKbps, setDownloadKbps] = useState(0)

    useEffect(() => {
        if(typeof networkingSettings == "object"){
            setUploadKbps(networkingSettings.uploadKbps)
            setDownloadKbps(networkingSettings.downloadKbps)
        }
    }, [networkingSettings])

    return (
        <>
            {
                typeof networkingSettings == "object" ? (
                    <>
                        <Flex 
                            width="100%" 
                            height="100%" 
                            flexDirection="column"
                        >
                            <Flex 
                                flexDirection="row" 
                                justifyContent="space-between" 
                                alignItems="center" 
                                width="80%" 
                                margin="0px auto" 
                                marginTop="50px"
                            >
                                <Flex width="50%">
                                    <Text 
                                        color={colors(platform, darkMode, "textPrimary")} 
                                        fontSize={15}
                                    >
                                        Upload bandwidth throttling
                                    </Text>
                                </Flex>
                                <Flex>
                                    {
                                        networkingSettings.uploadKbps == 420 && (
                                            <Flex 
                                                marginTop="3px" 
                                                marginRight="8px"
                                            >
                                                <FaCannabis 
                                                    color="green" 
                                                    size={18} 
                                                />
                                            </Flex>
                                        )
                                    }
                                    {
                                        networkingSettings.uploadKbps == 1337 && (
                                            <Flex 
                                                marginTop="3px" 
                                                marginRight="8px"
                                            >
                                                <FaHackerrank 
                                                    color={colors(platform, darkMode, "textPrimary")} 
                                                    size={18} 
                                                />
                                            </Flex>
                                        )
                                    }
                                    <Text 
                                        color={colors(platform, darkMode, "textPrimary")} 
                                        fontSize={15}
                                    >
                                        {
                                            networkingSettings.uploadKbps == 0 ? "Unlimited" : networkingSettings.uploadKbps + " Kbps"
                                        }
                                    </Text>
                                </Flex>
                                <Flex>
                                    <Link 
                                        color={colors(platform, darkMode, "link")} 
                                        textDecoration="none" 
                                        _hover={{
                                            textDecoration: "none"
                                        }} 
                                        onClick={() => setThrottlingModalOpen(true)} 
                                        fontSize={15}
                                    >
                                        Configure
                                    </Link>
                                </Flex>
                            </Flex>
                            <Flex 
                                flexDirection="row" 
                                justifyContent="space-between" 
                                alignItems="center" 
                                width="80%" 
                                margin="0px auto" 
                                marginTop="5px" 
                                borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")} 
                                paddingBottom="10px"
                            >
                                <Flex width="50%">
                                    <Text 
                                        color={colors(platform, darkMode, "textPrimary")} 
                                        fontSize={15}
                                    >
                                        Download bandwidth throttling
                                    </Text>
                                </Flex>
                                <Flex>
                                    {
                                        networkingSettings.downloadKbps == 420 && (
                                            <Flex 
                                                marginTop="3px" 
                                                marginRight="8px"
                                            >
                                                <FaCannabis 
                                                    color="green" 
                                                    size={18} 
                                                />
                                            </Flex>
                                        )
                                    }
                                    {
                                        networkingSettings.downloadKbps == 1337 && (
                                            <Flex 
                                                marginTop="3px" 
                                                marginRight="8px"
                                            >
                                                <FaHackerrank 
                                                    color={colors(platform, darkMode, "textPrimary")} 
                                                    size={18} 
                                                />
                                            </Flex>
                                        )
                                    }
                                    <Text 
                                        color={colors(platform, darkMode, "textPrimary")} 
                                        fontSize={15}
                                    >
                                        {
                                            networkingSettings.downloadKbps == 0 ? "Unlimited" : networkingSettings.downloadKbps + " Kbps"
                                        }
                                    </Text>
                                </Flex>
                                <Flex>
                                    <Link 
                                        color={colors(platform, darkMode, "link")} 
                                        textDecoration="none" 
                                        _hover={{
                                            textDecoration: "none"
                                        }} 
                                        onClick={() => setThrottlingModalOpen(true)} 
                                        fontSize={15}
                                    >
                                        Configure
                                    </Link>
                                </Flex>
                            </Flex>
                        </Flex>
                        <Modal 
                            onClose={() => setThrottlingModalOpen(false)} 
                            isOpen={throttlingModalOpen}
                            isCentered={true}
                        >
                            <ModalOverlay borderRadius="10px" />
                            <ModalContent 
                                backgroundColor={colors(platform, darkMode, "backgroundPrimary")} 
                                borderRadius="15px"
                            >
                                <ModalCloseButton 
                                    color={colors(platform, darkMode, "textPrimary")} 
                                    _focus={{ _focus: false }} 
                                    _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }} 
                                />
                                <ModalHeader color={colors(platform, darkMode, "textPrimary")}>Networking throttling</ModalHeader>
                                <ModalBody>
                                    <Flex 
                                        flexDirection="row" 
                                        justifyContent="space-between"
                                    >
                                        <Flex width="75%">
                                            <Text 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                fontSize={14}
                                            >
                                                Maximum upload bandwidth (in Kbps)
                                            </Text>
                                        </Flex>
                                        <Flex width="24%">
                                            <Input 
                                                type="number" 
                                                value={uploadKbps} 
                                                onChange={(event) => setUploadKbps(event.target.value)} 
                                                placeholder="0 Kbps" 
                                                userSelect="none" 
                                                style={{
                                                    border: "none",
                                                    backgroundColor: darkMode ? "#171717" : "lightgray",
                                                    color: "gray",
                                                    height: "25px",
                                                    textAlign: "center",
                                                    paddingLeft: "5px",
                                                    paddingRight: "5px"
                                                }} 
                                                _placeholder={{
                                                    color: "gray"
                                                }} 
                                            />
                                        </Flex>
                                    </Flex>
                                    <Flex 
                                        flexDirection="row" 
                                        justifyContent="space-between" 
                                        marginTop="5px"
                                    >
                                        <Flex width="75%">
                                            <Text 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                fontSize={14}
                                            >
                                                Maximum download bandwidth (in Kbps)
                                            </Text>
                                        </Flex>
                                        <Flex width="24%">
                                            <Input 
                                                type="number" 
                                                value={downloadKbps} 
                                                onChange={(event) => setDownloadKbps(event.target.value)} 
                                                placeholder="0 Kbps" 
                                                userSelect="none" 
                                                style={{
                                                    border: "none",
                                                    backgroundColor: darkMode ? "#171717" : "lightgray",
                                                    color: "gray",
                                                    height: "25px",
                                                    textAlign: "center",
                                                    paddingLeft: "5px",
                                                    paddingRight: "5px"
                                                }} 
                                                _placeholder={{
                                                    color: "gray"
                                                }} 
                                            />
                                        </Flex>
                                    </Flex>
                                    <Flex 
                                        flexDirection="row" 
                                        justifyContent="space-between" 
                                        marginTop="25px"
                                    >
                                        <Text 
                                            color={colors(platform, darkMode, "textPrimary")} 
                                            fontSize={11}
                                        >
                                            Setting a value of 0 will disable throttling
                                        </Text>
                                    </Flex>
                                </ModalBody>
                                <ModalFooter>
                                    <Link 
                                        color="gray" 
                                        textDecoration="none" 
                                        _hover={{ textDecoration: "none" }} 
                                        onClick={() => setThrottlingModalOpen(false)}
                                    >
                                        {i18n(lang, "close")}
                                    </Link>
                                    <Link 
                                        color={colors(platform, darkMode, "link")} 
                                        textDecoration="none" 
                                        _hover={{ textDecoration: "none" }} 
                                        marginLeft="10px" 
                                        onClick={async () => {
                                            db.set("networkingSettings", {
                                                ...networkingSettings,
                                                uploadKbps: parseInt(uploadKbps) > 0 ? parseInt(uploadKbps) : 0,
                                                downloadKbps: parseInt(downloadKbps) > 0 ? parseInt(downloadKbps) : 0
                                            }).catch(log.error)

                                            setThrottlingModalOpen(false)
                                        }}
                                    >
                                        {i18n(lang, "save")}
                                    </Link>
                                </ModalFooter>
                            </ModalContent>
                        </Modal>
                    </>
                ) : (
                    <Flex 
                        flexDirection="column" 
                        width="100%" 
                        height="400px" 
                        alignItems="center" 
                        justifyContent="center"
                    >
                        <Flex>
                            <Spinner color={colors(platform, darkMode, "textPrimary")} />
                        </Flex>
                    </Flex>
                )
            }
        </>
    )
})

const SettingsWindowKeybinds = memo(({ darkMode, lang, platform }) => {
    const defaultKeybinds = useRef([
        {
            type: "uploadFolders",
            keybind: null
        },
        {
            type: "uploadFiles",
            keybind: null
        },
        /*{
            type: "download",
            keybind: null
        },*/
        {
            type: "openSettings",
            keybind: null
        },
        {
            type: "pauseSync",
            keybind: null
        },
        {
            type: "resumeSync",
            keybind: null
        },
        {
            type: "openWebsite",
            keybind: null
        }
    ]).current

    const [changeKeybindModalOpen, setChangeKeybindModalOpen] = useState(false)
    const [currentKeybind, setCurrentKeybind] = useState("")
    const [keybindToChange, setKeybindToChange] = useState("")
    const keybinds = useDb("keybinds", defaultKeybinds)

    const keydownListener = useCallback((e) => {
        if(typeof e.key == "string" && e.key.length > 0){
            setCurrentKeybind((e.ctrlKey && e.key.toLowerCase() !== "control" ? "CommandOrControl+" : "") + (e.shiftKey && e.key.toLowerCase() !== "shift" ? "Shift+" : "") + (e.metaKey && e.key.toLowerCase() !== "meta" ? "Meta+" : "") + (e.altKey && e.key.toLowerCase() !== "alt" ? "Alt+" : "") + e.key.toUpperCase())
        }
    })

    useEffect(() => {
        if(changeKeybindModalOpen){
            ipc.disableKeybinds().catch(log.error)
        }
        else{
            ipc.updateKeybinds().catch(log.error)
        }
    }, [changeKeybindModalOpen])

    useEffect(() => {
        document.addEventListener("keydown", keydownListener)

        return () => {
            document.removeEventListener("keydown", keydownListener)
        }
    }, [])

    return (
        <>
            <Flex
                width="80%"
                height="auto"
                flexDirection="column"
                margin="0px auto"
                marginTop="50px"
            >
                {
                    keybinds.map((keybind, index) => {
                        return (
                            <Flex
                                key={index}
                                width="100%"
                                height="35px"
                                backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
                                borderRadius="15px"
                                flexDirection="row"
                                alignItems="center"
                                justifyContent="space-between"
                                paddingLeft="10px"
                                paddingRight="10px"
                                marginTop={index > 0 ? "10px" : "0px"}
                            >
                                <Flex
                                    alignItems="center"
                                    justifyContent="center"
                                >
                                    <Text
                                        fontSize={14}
                                        color={colors(platform, darkMode, "textPrimary")}
                                    >
                                        {keybind.type}
                                    </Text>
                                    <Tooltip 
                                        label={
                                            <Flex flexDirection="column">
                                                <Text color={colors(platform, darkMode, "textPrimary")}>
                                                    Exclude paths and patterns from syncing. Works just like a .gitignore file
                                                </Text>
                                            </Flex>
                                        }
                                        placement="right"
                                        borderRadius="15px"
                                        backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
                                        shadow="none"
                                    >
                                        <Flex marginLeft="5px">
                                            <AiOutlineInfoCircle
                                                size={14} 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                            />
                                        </Flex>
                                    </Tooltip>
                                </Flex>
                                <Flex
                                    alignItems="center"
                                    justifyContent="center"
                                >
                                    <Text
                                        fontSize={14}
                                        color={colors(platform, darkMode, "textPrimary")}
                                    >
                                        <Kbd 
                                            backgroundColor={colors(platform, darkMode, "backgroundPrimary")}
                                            color={colors(platform, darkMode, "textPrimary")}
                                            borderColor={colors(platform, darkMode, "backgroundPrimary")}
                                        >
                                            {
                                                keybind.keybind == null ? "Not bound" : keybind.keybind
                                            }
                                        </Kbd>
                                    </Text>
                                    <Link
                                        color={colors(platform, darkMode, "link")}
                                        fontSize={14}
                                        textDecoration="none"
                                        marginLeft="10px"
                                        _hover={{
                                            textDecoration: "none"
                                        }}
                                        onClick={() => {
                                            setKeybindToChange(keybind.type)
                                            setCurrentKeybind("")
                                            setChangeKeybindModalOpen(true)
                                        }}
                                    >
                                        Change
                                    </Link>
                                </Flex>
                            </Flex>
                        )
                    })
                }
                <Link 
                    color={colors(platform, darkMode, "link")} 
                    textDecoration="none" 
                    _hover={{ textDecoration: "none" }} 
                    margin="0px auto"
                    marginTop="25px"
                    onClick={() => db.set("keybinds", defaultKeybinds).catch(log.error)}
                >
                    Reset to defaults
                </Link>
            </Flex>
            <Modal onClose={() => setChangeKeybindModalOpen(false)} isOpen={changeKeybindModalOpen} isCentered={true}>
                <ModalOverlay borderRadius="10px" />
                <ModalContent 
                    backgroundColor={colors(platform, darkMode, "backgroundPrimary")} 
                    borderRadius="15px"
                >
                    <ModalCloseButton 
                        color={colors(platform, darkMode, "textPrimary")} 
                        _focus={{ _focus: false }} 
                        _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }}
                    />
                    <ModalHeader color={colors(platform, darkMode, "textPrimary")}>
                        Change keybind
                    </ModalHeader>
                    <ModalBody>
                        <Flex
                            width="100%"
                            height="100px"
                            justifyContent="center"
                            alignItems="center"
                        >
                            {
                                currentKeybind.length == 0 ? (
                                    <Text
                                        color={colors(platform, darkMode, "textPrimary")}
                                        fontSize={20}
                                    >
                                        Press any key or keycombo
                                    </Text>
                                ) : (
                                    <Kbd
                                        backgroundColor={colors(platform, darkMode, "backgroundPrimary")}
                                        color={colors(platform, darkMode, "textPrimary")}
                                        borderColor={colors(platform, darkMode, "backgroundPrimary")}
                                    >
                                        {currentKeybind}
                                    </Kbd>
                                )
                            }
                        </Flex>
                    </ModalBody>
                    <ModalFooter>
                        <Link 
                            color="gray" 
                            textDecoration="none" 
                            _hover={{ textDecoration: "none" }} 
                            onClick={() => setChangeKeybindModalOpen(false)}
                        >
                            {i18n(lang, "close")}
                        </Link>
                        <Link 
                            color={colors(platform, darkMode, "link")} 
                            textDecoration="none" 
                            _hover={{ textDecoration: "none" }} 
                            marginLeft="10px" 
                            onClick={() => {
                                if(keybindToChange.length == 0 || currentKeybind.length == 0){
                                    return setChangeKeybindModalOpen(false)
                                }

                                db.set("keybinds", keybinds.map(item => item.type == keybindToChange ? { ...item, keybind: currentKeybind } : item)).then(() => {
                                    setKeybindToChange("")
                                    setCurrentKeybind("")
                                    setChangeKeybindModalOpen(false)
                                }).catch(log.error)
                            }}
                        >
                            {i18n(lang, "save")}
                        </Link>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    )
})

const SettingsSelectionButton = memo(({ darkMode, lang, platform, selection, setSelection, type, title }) => {
    return (
        <Flex 
            width="80px"
            height="100%"
            backgroundColor={selection == type ? colors(platform, darkMode, "backgroundPrimary") : "transparent"}
            borderRadius="15px"
            paddingLeft="15px"
            paddingRight="15px"
            paddingTop="5px"
            paddingBottom="5px"
            onClick={() => {
                setSelection(type)
            }}
            cursor="pointer"
            pointerEvents="all"
            userSelect="none"
            marginLeft="3px"
            _hover={{
                backgroundColor: colors(platform, darkMode, "backgroundPrimary")
            }}
        >
            <Flex 
                width="100%" 
                height="100%" 
                flexDirection="column" 
                justifyContent="center" 
                alignItems="center" 
                userSelect="none"
            >
                {
                    type == "general" && (
                        <HiOutlineCog 
                            size={20} 
                            color={darkMode ? "white" : "gray"} 
                        />
                    )
                }
                {
                    type == "syncs" && (
                        <AiOutlineSync 
                            size={20} 
                            color={darkMode ? "white" : "gray"} 
                        />
                    )
                }
                {
                    type == "account" && (
                        <VscAccount 
                            size={20} 
                            color={darkMode ? "white" : "gray"} 
                        />
                    )
                }
                {
                    type == "issues" && (
                        <GoIssueReopened 
                            size={20} 
                            color={darkMode ? "white" : "gray"} 
                        />
                    )
                }
                {
                    type == "networking" && (
                        <MdOutlineNetworkCheck 
                            size={20} 
                            color={darkMode ? "white" : "gray"} 
                        />
                    )
                }
                {
                    type == "keybinds" && (
                        <BsKeyboard 
                            size={20} 
                            color={darkMode ? "white" : "gray"} 
                        />
                    )
                }
                <Text 
                    fontSize={13} 
                    fontWeight="bold" 
                    color={darkMode ? "white" : "gray"} 
                    userSelect="none"
                >
                    {title}
                </Text>
            </Flex>
        </Flex>
    )
})

const SettingsSelection = memo(({ darkMode, lang, platform, selection, setSelection }) => {
    return (
        <Flex 
            flexDirection="row" 
            justifyContent="center" 
            alignItems="center" 
            borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")} 
            paddingBottom="10px" 
            paddingTop="20px" 
            userSelect="none" 
            style={{
                WebkitAppRegion: "drag"
            }} 
            backgroundColor={colors(platform, darkMode, "titlebarBackgroundPrimary")}
        >
            <Flex 
                flexDirection="row" 
                width="auto" 
                height="auto" 
                userSelect="none" 
                style={{
                    WebkitAppRegion: "none"
                }}
            >
                <SettingsSelectionButton 
                    darkMode={darkMode} 
                    lang={lang} 
                    platform={platform} 
                    selection={selection} 
                    setSelection={setSelection} 
                    type="general" 
                    title="General" 
                />
                <SettingsSelectionButton 
                    darkMode={darkMode} 
                    lang={lang} 
                    platform={platform} 
                    selection={selection} 
                    setSelection={setSelection} 
                    type="syncs" 
                    title="Syncs" 
                />
                <SettingsSelectionButton 
                    darkMode={darkMode} 
                    lang={lang} 
                    platform={platform} 
                    selection={selection} 
                    setSelection={setSelection} 
                    type="account" 
                    title="Account" 
                />
                <SettingsSelectionButton 
                    darkMode={darkMode} 
                    lang={lang} 
                    platform={platform} 
                    selection={selection} 
                    setSelection={setSelection} 
                    type="issues" 
                    title="Issues" 
                />
                <SettingsSelectionButton 
                    darkMode={darkMode} 
                    lang={lang} 
                    platform={platform} 
                    selection={selection} 
                    setSelection={setSelection} 
                    type="networking" 
                    title="Networking" 
                />
                <SettingsSelectionButton 
                    darkMode={darkMode} 
                    lang={lang} 
                    platform={platform} 
                    selection={selection} 
                    setSelection={setSelection} 
                    type="keybinds" title="Keybinds" 
                />
            </Flex>
        </Flex>
    )
})

const SettingsWindow = memo(({ startingRoute, userId, email, windowId }) => {
    const darkMode = useDarkMode()
    const lang = useLang()
    const platform = usePlatform()

    const [selection, setSelection] = useState(typeof startingRoute[1] == "string" && startingRoute[1].length > 0 ? startingRoute[1] : STARTING_ROUTE)

    useEffect(() => {
        ipcRenderer.send("window-ready", windowId)
    }, [])

    return (
        <Container 
            darkMode={darkMode} 
            lang={lang} 
            platform={platform}
        >
            <Titlebar 
                darkMode={darkMode} 
                lang={lang} 
                platform={platform} 
                title={i18n(lang, "titlebarSettings")} 
            />
            {
                userId !== 0 && (
                    <Flex 
                        flexDirection="column" 
                        width="100%" 
                        height="570px" 
                        paddingTop="20px"
                    >
                        <SettingsSelection 
                            darkMode={darkMode} 
                            lang={lang} 
                            platform={platform} 
                            selection={selection} 
                            setSelection={setSelection} 
                        />
                        <Flex>
                            {
                                selection == "general" && (
                                    <SettingsWindowGeneral 
                                        darkMode={darkMode} 
                                        lang={lang} 
                                        platform={platform} 
                                        userId={userId} 
                                        email={email} 
                                    />
                                )
                            }
                            {
                                selection == "syncs" && (
                                    <SettingsWindowSyncs 
                                        darkMode={darkMode} 
                                        lang={lang} 
                                        platform={platform} 
                                        userId={userId} 
                                        email={email} 
                                    />
                                )
                            }
                            {
                                selection == "account" && (
                                    <SettingsWindowAccount 
                                        darkMode={darkMode} 
                                        lang={lang} 
                                        platform={platform} 
                                        userId={userId} 
                                        email={email} 
                                    />
                                )
                            }
                            {
                                selection == "issues" && (
                                    <SettingsWindowIssues 
                                        darkMode={darkMode} 
                                        lang={lang} 
                                        platform={platform} 
                                        userId={userId} 
                                        email={email} 
                                    />
                                )
                            }
                            {
                                selection == "networking" && (
                                    <SettingsWindowNetworking
                                        darkMode={darkMode} 
                                        lang={lang} 
                                        platform={platform} 
                                        userId={userId} 
                                        email={email} 
                                    />
                                )
                            }
                            {
                                selection == "keybinds" && (
                                    <SettingsWindowKeybinds 
                                        darkMode={darkMode} 
                                        lang={lang} 
                                        platform={platform} 
                                        userId={userId} 
                                        email={email} 
                                    />
                                )
                            }
                        </Flex>
                    </Flex>
                )
            }
            <IsOnlineBottomToast 
                userId={userId} 
                email={email} 
                platform={platform} 
                darkMode={darkMode} 
                lang={lang} 
            />
        </Container>
    )
})

export default SettingsWindow