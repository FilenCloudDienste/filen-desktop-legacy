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
import { formatBytes, isSubdir } from "../../lib/helpers"
import { MdOutlineNetworkCheck } from "react-icons/md"
import { FaCannabis, FaHackerrank } from "react-icons/fa"
import IsOnlineBottomToast from "../../components/IsOnlineBottomToast"
import { BsKeyboard, BsFillFolderFill } from "react-icons/bs"
// @ts-ignore
import List from "react-virtualized/dist/commonjs/List"
import { debounce } from "lodash"

const log = window.require("electron-log")
const { shell, ipcRenderer } = window.require("electron")
const pathModule = window.require("path")
const fs = window.require("fs-extra")

const STARTING_ROUTE_URL_PARAMS = new URLSearchParams(window.location.search)
const STARTING_ROUTE = typeof STARTING_ROUTE_URL_PARAMS.get("page") == "string" ? STARTING_ROUTE_URL_PARAMS.get("page") : "general"

export const logout = async () => {
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

        ipc.exitApp().catch(log.error)
    }
    catch(e){
        log.error(e)
    }
}

const SettingsWindowGeneral = memo(({ darkMode, lang, platform }: { darkMode: boolean, lang: string, platform: string }) => {
    const [openAtStartupAsync, setOpenAtStartupAsync] = useState<any>(undefined)
    const [appVersionAsync, setAppVersionAsync] = useState<any>(undefined)
    const [openAtStartup, setOpenAtStartup] = useState<boolean>(true)
    const [appVersion, setAppVersion] = useState<string>("1")
    const [excludeDot, setExcludeDot] = useState<boolean>(true)

    const getOpenAtStartup = () => {
        ipc.getOpenOnStartup().then((open) => {
            setOpenAtStartupAsync(open)
            setOpenAtStartup(open)
        }).catch(log.error)
    }

    const getAppVersion = () => {
        ipc.getVersion().then((version) => {
            setAppVersionAsync(version)
            setAppVersion(version)
        }).catch(log.error)
    }

    const getExcludeDot = () => {
        db.get("excludeDot").then((exclude) => {
            if(exclude == null){
                setExcludeDot(true)

                return
            }

            if(exclude){
                setExcludeDot(true)
            }
            else{
                setExcludeDot(false)
            }
        }).catch(log.error)
    }

    const populate = () => {
        getOpenAtStartup()
        getAppVersion()
        getExcludeDot()
    }

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
                                    {i18n(lang, "launchAtSystemStartup")}
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
                    marginTop={platform == "linux" ? "50px" : "10px"}
                    paddingBottom="5px" 
                    borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
                >
                    <Flex>
                        <Text 
                            color={colors(platform, darkMode, "textPrimary")} 
                            fontSize={15}
                        >
                            {i18n(lang, "darkMode")}
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
                                    {i18n(lang, "excludeDotTooltip")}
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
                                {i18n(lang, "excludeDot")}
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
                                const newVal = !excludeDot

                                db.set("excludeDot", newVal).then(() => {
                                    setExcludeDot(newVal)
                                }).catch(log.error)
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
                            {i18n(lang, "language")}
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
                        onChange={(e: any) => {
                            Promise.all([
                                db.set("lang", e.nativeEvent.target.value),
                                db.set("langSetManually", true)
                            ]).catch(log.error)
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
                        <option 
                            value="de" 
                            style={{
                                backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                height: "30px",
                                borderRadius: "10px"
                            }}
                        >
                            Deutsch
                        </option>
                        <option 
                            value="nl" 
                            style={{
                                backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                height: "30px",
                                borderRadius: "10px"
                            }}
                        >
                            Nederlands
                        </option>
                        <option 
                            value="fr" 
                            style={{
                                backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                height: "30px",
                                borderRadius: "10px"
                            }}
                        >
                            Français
                        </option>
                        <option 
                            value="ru" 
                            style={{
                                backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                height: "30px",
                                borderRadius: "10px"
                            }}
                        >
                            Русский
                        </option>
                        <option 
                            value="uk" 
                            style={{
                                backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                height: "30px",
                                borderRadius: "10px"
                            }}
                        >
                            Українська
                        </option>
                        <option 
                            value="pl" 
                            style={{
                                backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                height: "30px",
                                borderRadius: "10px"
                            }}
                        >
                            Polski
                        </option>
                        <option 
                            value="zh" 
                            style={{
                                backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                height: "30px",
                                borderRadius: "10px"
                            }}
                        >
                            中文
                        </option>
                        <option 
                            value="ja" 
                            style={{
                                backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                height: "30px",
                                borderRadius: "10px"
                            }}
                        >
                            日本語
                        </option>
                        <option 
                            value="da" 
                            style={{
                                backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                height: "30px",
                                borderRadius: "10px"
                            }}
                        >
                            Dansk
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
                                {i18n(lang, "saveLogs")}
                            </Link>
                        </Flex>
                    </Flex>
                </Flex>
            </Flex>
        </>
    )
})

const SettingsWindowSyncs = memo(({ darkMode, lang, platform, userId }: { darkMode: boolean, lang: string, platform: string, userId: number }) => {
    const syncLocations: any = useDb("syncLocations:" + userId, [])
    const toast = useToast()
    const [syncSettingsModalOpen, setSyncSettingsModalOpen] = useState<boolean>(false)
    const [currentSyncLocation, setCurrentSyncLocation] = useState<any>(undefined)
    const [confirmDeleteModalOpen, setConfirmDeleteModalOpen] = useState<boolean>(false)
    const [ignoredFilesModalOpen, setIgnoredFilesModalOpen] = useState<boolean>(false)
    const [currentSyncLocationIgnored, setCurrentSyncLocationIgnored] = useState<string>("")
    const [isDeletingSyncLocation, setIsDeletingSyncLocation] = useState<boolean>(false)

    const createNewSyncLocation = () => {
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

                if(["/", "c:", "c:/", "c://", "c:\\", "c:\\\\"].includes(localPath.toLowerCase())){
                    return toast({
                        title: i18n(lang, "cannotCreateSyncLocation"),
                        description: i18n(lang, "cannotCreateSyncLocationSubdir"),
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

                /*const parsedPath = pathModule.parse(localPath)

                if(parsedPath.root == parsedPath.dir){
                    return toast({
                        title: i18n(lang, "cannotCreateSyncLocation"),
                        description: i18n(lang, "cannotCreateSyncLocationSubdir"),
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
                }*/

                if(Array.isArray(currentSyncLocations) && currentSyncLocations.length > 0){
                    let found = false

                    for(let i = 0; i < currentSyncLocations.length; i++){
                        if(typeof currentSyncLocations[i].local == "string"){
                            if(
                                currentSyncLocations[i].local == localPath
                                || isSubdir(currentSyncLocations[i].local, localPath)
                                || isSubdir(localPath, currentSyncLocations[i].local)
                            ){
                                found = true
                            }
                        }
                    }

                    if(found){
                        return toast({
                            title: i18n(lang, "cannotCreateSyncLocation"),
                            description: i18n(lang, "cannotCreateSyncLocationLoop"),
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
                    const uuid: string = uuidv4()
                    let created: boolean = false
    
                    try{
                        let currentSyncLocations = await db.get("syncLocations:" + userId)
    
                        if(!Array.isArray(currentSyncLocations)){
                            currentSyncLocations = []
                        }
    
                        if(currentSyncLocations.filter((location: any) => location.local == localPath).length == 0){
                            currentSyncLocations.push({
                                uuid,
                                local: localPath,
                                remote: undefined,
                                remoteUUID: undefined,
                                remoteName: undefined,
                                type: "twoWay",
                                paused: true,
                                busy: false,
                                localChanged: false
                            })

                            created = true
                        }
    
                        await db.set("syncLocations:" + userId, currentSyncLocations)

                        if(created){
                            toast({
                                description: i18n(lang, "syncLocationCreated"),
                                status: "success",
                                duration: 7500,
                                isClosable: true,
                                position: "bottom",
                                containerStyle: {
                                    backgroundColor: "#0ac09d",
                                    maxWidth: "85%",
                                    height: "auto",
                                    fontSize: 14,
                                    borderRadius: "15px"
                                }
                            })
                        }
                    }
                    catch(e){
                        log.error(e)
                    }
                }).catch((err) => {
                    log.error(err)

                    toast({
                        title: i18n(lang, "cannotCreateSyncLocation"),
                        description: i18n(lang, "cannotCreateSyncLocationAccess"),
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
                })
            }).catch((err) => {
                log.error(err)
            })
        }).catch((err) => {
            log.error(err)
        })
    }

    const debounceFilenIgnore = useCallback(debounce((value, uuid) => {
        db.set("filenIgnore:" + uuid, value).catch(log.error)
    }, 1000), [])

    const toggleSyncPauseStatus = async (location: any, paused: boolean) => {
        try{
            let currentSyncLocations = await db.get("syncLocations:" + userId)

            if(!Array.isArray(currentSyncLocations)){
                currentSyncLocations = []
            }

            for(let i = 0; i < currentSyncLocations.length; i++){
                if(currentSyncLocations[i].uuid == location.uuid){
                    currentSyncLocations[i].paused = paused

                    await db.set("localDataChanged:" + currentSyncLocations[i].uuid, true)
                }
            }

            await db.set("syncLocations:" + userId, currentSyncLocations)
        }
        catch(e){
            log.error(e)
        }
    }

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
                    <Flex 
                        flexDirection="column" 
                        width="100%" 
                        height="400px" 
                        alignItems="center" 
                        justifyContent="center"
                    >
                        <Flex>
                            <AiOutlineSync 
                                size={50} 
                                color={darkMode ? "gray" : "gray"} 
                            />
                        </Flex>
                        <Flex marginTop="15px">
                            <Text color={darkMode ? "gray" : "gray"}>
                                {i18n(lang, "noSyncLocationsSetupYet")}
                            </Text>
                        </Flex>
                        <Flex marginTop="15px">
                            <Link 
                                color={colors(platform, darkMode, "link")}
                                textDecoration="none" 
                                _hover={{
                                    textDecoration: "none"
                                }} 
                                onClick={() => createNewSyncLocation()}
                            > 
                                {i18n(lang, "createOne")}
                            </Link>
                        </Flex>
                    </Flex>
                ) : (
                    <Flex 
                        flexDirection="column" 
                        width="100vw" 
                        height="auto" 
                        alignItems="center" 
                        justifyContent="center" 
                        paddingTop="30px"
                    >
                        <List
                            height={(syncLocations.length * 55 >= 420) ? 420 : syncLocations.length * 55}
                            width={window.innerWidth * 0.9}
                            noRowsRenderer={() => <></>}
                            overscanRowCount={8}
                            rowCount={syncLocations.length}
                            rowHeight={55}
                            estimatedRowSize={syncLocations.length * 55}
                            rowRenderer={({ index, key, style }: { index: number, key: string, style: any }) => {
                                const location = syncLocations[index]

                                return (
                                    <Flex 
                                        key={key} 
                                        style={style} 
                                        flexDirection="column" 
                                        padding="5px" 
                                        width="100%" 
                                        height="100%"
                                    >
                                        <Flex 
                                            width="100%" 
                                            height="100%" 
                                            flexDirection="row" 
                                            backgroundColor={colors(platform, darkMode, "backgroundSecondary")} 
                                            paddingLeft="12px" 
                                            paddingRight="12px" 
                                            borderRadius="15px" 
                                            borderBottom={"0px solid " + colors(platform, darkMode, "borderPrimary")}
                                        >
                                            <Flex 
                                                width="45%" 
                                                flexDirection="row" 
                                                justifyContent="flex-start" 
                                                alignItems="center"
                                            >
                                                <Tooltip 
                                                    label={
                                                        <Text 
                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                            fontSize={14}
                                                        >
                                                            {location.local}
                                                        </Text>
                                                    }
                                                    placement="top"
                                                    borderRadius="15px"
                                                    backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
                                                    shadow="none"
                                                >
                                                    <Text 
                                                        noOfLines={1} 
                                                        color={colors(platform, darkMode, "textPrimary")} 
                                                        fontSize={15}
                                                    >
                                                        {location.local}
                                                    </Text>
                                                </Tooltip>
                                            </Flex>
                                            <Flex 
                                                width="10%" 
                                                flexDirection="row" 
                                                justifyContent="center" 
                                                alignItems="center"
                                            >
                                                {
                                                    location.paused ? (
                                                        <AiOutlinePauseCircle 
                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                            size={15}
                                                            cursor="pointer"
                                                            pointerEvents="all"
                                                            onClick={() => toggleSyncPauseStatus(location, false)}
                                                        />
                                                    ) : (
                                                        <>
                                                            {
                                                                location.type == "twoWay" && (
                                                                    <Flex 
                                                                        alignItems="center" 
                                                                        paddingTop="3px"
                                                                        cursor="pointer"
                                                                        pointerEvents="all"
                                                                        onClick={() => toggleSyncPauseStatus(location, true)}
                                                                    >
                                                                        <IoChevronBackOutline 
                                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                                            size={15} 
                                                                        />
                                                                        <IoChevronForwardOutline 
                                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                                            size={15} 
                                                                        />
                                                                    </Flex>
                                                                )
                                                            }
                                                            {
                                                                location.type == "localToCloud" && (
                                                                    <Flex 
                                                                        alignItems="center" 
                                                                        paddingTop="3px"
                                                                        cursor="pointer"
                                                                        pointerEvents="all"
                                                                        onClick={() => toggleSyncPauseStatus(location, true)}
                                                                    >
                                                                        <IoChevronForwardOutline 
                                                                            color={colors(platform, darkMode, "textPrimary")}
                                                                            size={15} 
                                                                        />
                                                                    </Flex>
                                                                )
                                                            }
                                                            {
                                                                location.type == "cloudToLocal" && (
                                                                    <Flex 
                                                                        alignItems="center" 
                                                                        paddingTop="3px"
                                                                        cursor="pointer"
                                                                        pointerEvents="all"
                                                                        onClick={() => toggleSyncPauseStatus(location, true)}
                                                                    >
                                                                        <IoChevronBackOutline 
                                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                                            size={15} 
                                                                        />
                                                                    </Flex>
                                                                )
                                                            }
                                                            {
                                                                location.type == "localBackup" && (
                                                                    <Flex 
                                                                        alignItems="center" 
                                                                        paddingTop="3px"
                                                                        cursor="pointer"
                                                                        pointerEvents="all"
                                                                        onClick={() => toggleSyncPauseStatus(location, true)}
                                                                    >
                                                                        <HiOutlineSave 
                                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                                            size={15} 
                                                                        />
                                                                        <IoChevronForwardOutline 
                                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                                            size={15} 
                                                                        />
                                                                    </Flex>
                                                                )
                                                            }
                                                            {
                                                                location.type == "cloudBackup" && (
                                                                    <Flex 
                                                                        alignItems="center" 
                                                                        paddingTop="3px"
                                                                        cursor="pointer"
                                                                        pointerEvents="all"
                                                                        onClick={() => toggleSyncPauseStatus(location, true)}
                                                                    >
                                                                        <IoChevronBackOutline 
                                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                                            size={15} 
                                                                        />
                                                                        <HiOutlineSave 
                                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                                            size={15} 
                                                                        />
                                                                    </Flex>
                                                                )
                                                            }
                                                        </>
                                                    )
                                                }
                                            </Flex>
                                            <Flex 
                                                width="37%" 
                                                flexDirection="row" 
                                                justifyContent="flex-end" 
                                                alignItems="center"
                                            >
                                                {
                                                    typeof location.remote == "string" && location.remote.length > 0 ? (
                                                        <Tooltip 
                                                            label={
                                                                <Text 
                                                                    color={colors(platform, darkMode, "textPrimary")} 
                                                                    fontSize={14}
                                                                >
                                                                    {location.remote}
                                                                </Text>
                                                            }
                                                            placement="top"
                                                            borderRadius="15px"
                                                            backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
                                                            shadow="none"
                                                        >
                                                            <Text 
                                                                noOfLines={1} 
                                                                color={colors(platform, darkMode, "textPrimary")} 
                                                                fontSize={15}
                                                            >
                                                                {location.remote}
                                                            </Text>
                                                        </Tooltip>
                                                    ) : (
                                                        <Link 
                                                            color={colors(platform, darkMode, "link")} 
                                                            textDecoration="none" 
                                                            _hover={{
                                                                textDecoration: "none"
                                                            }}
                                                            fontSize={14} 
                                                            onClick={() => {
                                                                db.get("syncLocations:" + userId).then((currentSyncLocations) => {
                                                                    ipc.selectRemoteFolder().then(async (result) => {
                                                                        if(result.canceled){
                                                                            return false
                                                                        }
        
                                                                        const { uuid, name, path } = result

                                                                        if(Array.isArray(currentSyncLocations) && currentSyncLocations.length > 0){
                                                                            let found = false

                                                                            for(let i = 0; i < currentSyncLocations.length; i++){
                                                                                if(typeof currentSyncLocations[i].remote == "string"){
                                                                                    if(
                                                                                        currentSyncLocations[i].remote == path
                                                                                        || isSubdir(currentSyncLocations[i].remote, path)
                                                                                        || isSubdir(path, currentSyncLocations[i].remote)
                                                                                    ){
                                                                                        found = true
                                                                                    }
                                                                                }
                                                                            }

                                                                            if(found){
                                                                                return toast({
                                                                                    title: i18n(lang, "cannotCreateSyncLocation"),
                                                                                    description: i18n(lang, "cannotCreateSyncLocationLoop2"),
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

                                                                            toast({
                                                                                description: i18n(lang, "syncLocationCreated"),
                                                                                status: "success",
                                                                                duration: 7500,
                                                                                isClosable: true,
                                                                                position: "bottom",
                                                                                containerStyle: {
                                                                                    backgroundColor: "#0ac09d",
                                                                                    maxWidth: "85%",
                                                                                    height: "auto",
                                                                                    fontSize: 14,
                                                                                    borderRadius: "15px"
                                                                                }
                                                                            })
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
                                                            }}
                                                        >
                                                            {i18n(lang, "selectRemoteLocation")}
                                                        </Link>
                                                    )
                                                }
                                            </Flex>
                                            <Flex 
                                                width="8%" 
                                                flexDirection="row" 
                                                justifyContent="space-between" 
                                                alignItems="center"
                                                paddingLeft="12px"
                                            >
                                                <HiOutlineCog 
                                                    color={colors(platform, darkMode, "textPrimary")} 
                                                    size={15} 
                                                    cursor="pointer" 
                                                    pointerEvents="all" 
                                                    onClick={() => {
                                                        setCurrentSyncLocation(location)
                                                        setSyncSettingsModalOpen(true)
                                                    }}
                                                />
                                                <BsFillFolderFill 
                                                    color={colors(platform, darkMode, "textPrimary")} 
                                                    size={15} 
                                                    cursor="pointer" 
                                                    pointerEvents="all"
                                                    onClick={() => shell.openPath(pathModule.normalize(location.local)).catch(log.error)}
                                                />
                                            </Flex>
                                        </Flex>
                                    </Flex>
                                )
                            }}
                        />
                        <Link 
                            color={colors(platform, darkMode, "link")} 
                            marginTop="10px" 
                            textDecoration="none" 
                            _hover={{
                                textDecoration: "none"
                            }}
                            onClick={() => createNewSyncLocation()}
                        >
                            {i18n(lang, "createOne")}
                        </Link>
                    </Flex>
                )
            }
            <Modal 
                onClose={() => setSyncSettingsModalOpen(false)} 
                isOpen={syncSettingsModalOpen} 
                isCentered={true}
            >
                <ModalOverlay borderRadius="10px" />
                <ModalContent 
                    backgroundColor={colors(platform, darkMode, "backgroundPrimary")} 
                    borderRadius="15px"
                >
                    <ModalHeader color={colors(platform, darkMode, "textPrimary")}>
                        {i18n(lang, "settings")}
                    </ModalHeader>
                    <ModalCloseButton 
                        color={colors(platform, darkMode, "textPrimary")} 
                        _focus={{ _focus: "none" }} 
                        _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }} 
                    />
                    <ModalBody>
                        {
                            typeof currentSyncLocation !== "undefined" && (
                                <>
                                    <Flex 
                                        width="100%" 
                                        height="auto" 
                                        justifyContent="space-between" 
                                        alignItems="center"
                                    >
                                        <Flex alignItems="center">
                                            <Text 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                fontSize={14}>
                                                    {i18n(lang, "syncMode")}
                                                </Text>
                                            <Tooltip 
                                                label={
                                                    <Flex flexDirection="column">
                                                        <Text
                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                            fontWeight="bold"
                                                        >
                                                            {i18n(lang, "syncModeTwoWay")}
                                                        </Text>
                                                        <Text 
                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                            fontSize={11}
                                                        >
                                                            {i18n(lang, "syncModeTwoWayInfo")}
                                                        </Text>
                                                        <Text
                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                            fontWeight="bold"
                                                            marginTop="10px"
                                                        >
                                                            {i18n(lang, "syncModeLocalToCloud")}
                                                        </Text>
                                                        <Text 
                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                            fontSize={11}
                                                        >
                                                            {i18n(lang, "syncModeLocalToCloudInfo")}
                                                        </Text>
                                                        <Text
                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                            fontWeight="bold"
                                                            marginTop="10px"
                                                        >
                                                            {i18n(lang, "syncModeCloudToLocal")}
                                                        </Text>
                                                        <Text 
                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                            fontSize={11}
                                                        >
                                                            {i18n(lang, "syncModeCloudToLocalInfo")}
                                                        </Text>
                                                        <Text
                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                            fontWeight="bold"
                                                            marginTop="10px"
                                                        >
                                                            {i18n(lang, "syncModeLocalBackup")}
                                                        </Text>
                                                        <Text 
                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                            fontSize={11}
                                                        >
                                                            {i18n(lang, "syncModeLocalBackupInfo")}
                                                        </Text>
                                                        <Text
                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                            fontWeight="bold"
                                                            marginTop="10px"
                                                        >
                                                            {i18n(lang, "syncModeCloudBackup")}
                                                        </Text>
                                                        <Text 
                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                            fontSize={11}
                                                        >
                                                            {i18n(lang, "syncModeCloudBackupInfo")}
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
                                                        size={18} 
                                                        color={colors(platform, darkMode, "textPrimary")} 
                                                    />
                                                </Flex>
                                            </Tooltip>
                                        </Flex>
                                        <Flex alignItems="center">
                                            <Select 
                                                value={currentSyncLocation.type}
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                fontSize={14} 
                                                height="30px" 
                                                borderColor={colors(platform, darkMode, "borderPrimary")}
                                                _focus={{ outline: "none" }} 
                                                outline="none" 
                                                _active={{ outline: "none" }}
                                                onChange={async (e: any) => {
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
                                                }}
                                            >
                                                <option 
                                                    value="twoWay" style={{
                                                        backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                                        height: "30px",
                                                        borderRadius: "10px"
                                                    }}
                                                >
                                                    {i18n(lang, "syncModeTwoWay")}
                                                </option>
                                                <option 
                                                    value="localToCloud" 
                                                    style={{
                                                        backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                                        height: "30px",
                                                        borderRadius: "10px"
                                                    }}
                                                >
                                                    {i18n(lang, "syncModeLocalToCloud")}
                                                </option>
                                                <option 
                                                    value="cloudToLocal" 
                                                    style={{
                                                        backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                                        height: "30px",
                                                        borderRadius: "10px"
                                                    }}
                                                >
                                                    {i18n(lang, "syncModeCloudToLocal")}
                                                </option>
                                                <option 
                                                    value="localBackup" 
                                                    style={{
                                                        backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                                        height: "30px",
                                                        borderRadius: "10px"
                                                    }}
                                                >
                                                    {i18n(lang, "syncModeLocalBackup")}
                                                </option>
                                                <option 
                                                    value="cloudBackup" 
                                                    style={{
                                                        backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
                                                        height: "30px",
                                                        borderRadius: "10px"
                                                    }}
                                                >
                                                    {i18n(lang, "syncModeCloudBackup")}
                                                </option>
                                            </Select>
                                        </Flex>
                                    </Flex>
                                    <Flex 
                                        width="100%" 
                                        height="auto" 
                                        justifyContent="space-between" 
                                        alignItems="center" 
                                        marginTop="10px"
                                    >
                                        <Flex alignItems="center">
                                            <Text 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                fontSize={14}
                                            >
                                                {i18n(lang, "selectiveSync")}
                                            </Text>
                                            <Tooltip 
                                                label={
                                                    <Flex flexDirection="column">
                                                        <Text color={colors(platform, darkMode, "textPrimary")}>
                                                            {i18n(lang, "selectiveSyncTooltip")}
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
                                                        size={18} 
                                                        color={colors(platform, darkMode, "textPrimary")} 
                                                    />
                                                </Flex>
                                            </Tooltip>
                                        </Flex>
                                        <Flex>
                                            <Link 
                                                color={colors(platform, darkMode, "link")} 
                                                textDecoration="none" _hover={{ textDecoration: "none" }} 
                                                onClick={() => {
                                                    if(typeof currentSyncLocation.remote !== "string"){
                                                        return false
                                                    }
                                                    
                                                    setSyncSettingsModalOpen(false)
                                                    
                                                    ipc.openSelectiveSyncWindow({ currentSyncLocation })
                                                }}
                                            >
                                                {i18n(lang, "configure")}
                                            </Link>
                                        </Flex>
                                    </Flex>
                                    <Flex 
                                        width="100%" 
                                        height="auto" 
                                        justifyContent="space-between" 
                                        alignItems="center" 
                                        marginTop="10px"
                                    >
                                        <Flex alignItems="center">
                                            <Text 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                fontSize={14}
                                            >
                                                .filenignore
                                            </Text>
                                            <Tooltip 
                                                label={
                                                    <Flex flexDirection="column">
                                                        <Text color={colors(platform, darkMode, "textPrimary")}>
                                                            {i18n(lang, "filenignoreTooltip")}
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
                                                        size={18} 
                                                        color={colors(platform, darkMode, "textPrimary")} 
                                                    />
                                                </Flex>
                                            </Tooltip>
                                        </Flex>
                                        <Flex>
                                            <Link 
                                                color={colors(platform, darkMode, "link")} 
                                                textDecoration="none" 
                                                _hover={{ textDecoration: "none" }} 
                                                onClick={() => {
                                                    setSyncSettingsModalOpen(false)
                                                    setTimeout(() => setIgnoredFilesModalOpen(true), 100)
                                                }}
                                            >
                                                {i18n(lang, "edit")}
                                            </Link>
                                        </Flex>
                                    </Flex>
                                    <Flex 
                                        width="100%" 
                                        height="auto" 
                                        justifyContent="space-between" 
                                        alignItems="center" 
                                        marginTop="10px"
                                    >
                                        <Text 
                                            color={colors(platform, darkMode, "textPrimary")} 
                                            fontSize={14}
                                        >
                                            {i18n(lang, "paused")}
                                        </Text>
                                        <Flex>
                                            <Switch 
                                                isChecked={currentSyncLocation.paused}
                                                _focus={{ outline: "none" }} 
                                                outline="none" 
                                                _active={{ outline: "none" }} 
                                                onChange={async (event: any) => {
                                                    const paused = event.nativeEvent.target.checked

                                                    try{
                                                        let currentSyncLocations = await db.get("syncLocations:" + userId)

                                                        if(!Array.isArray(currentSyncLocations)){
                                                            currentSyncLocations = []
                                                        }

                                                        for(let i = 0; i < currentSyncLocations.length; i++){
                                                            if(currentSyncLocations[i].uuid == currentSyncLocation.uuid){
                                                                currentSyncLocations[i].paused = paused

                                                                if(!paused){
                                                                    await db.set("localDataChanged:" + currentSyncLocations[i].uuid, true)
                                                                }
                                                            }
                                                        }

                                                        await db.set("syncLocations:" + userId, currentSyncLocations)
                                                    }
                                                    catch(e){
                                                        log.error(e)
                                                    }
                                                }}
                                            />
                                        </Flex>
                                    </Flex>
                                    {
                                        typeof currentSyncLocation !== "undefined" && (
                                            <Flex 
                                                width="100%" 
                                                height="auto" 
                                                justifyContent="space-between" 
                                                alignItems="center" 
                                                marginTop="25px"
                                            >
                                                <Link 
                                                    color={colors(platform, darkMode, "danger")} 
                                                    textDecoration="none" 
                                                    _hover={{ textDecoration: "none" }} 
                                                    fontSize={11} 
                                                    onClick={() => {
                                                        setSyncSettingsModalOpen(false)
                                                        setTimeout(() => setConfirmDeleteModalOpen(true), 250)
                                                    }}
                                                    marginRight="15px"
                                                >
                                                    {i18n(lang, "deleteSyncLocation")}
                                                </Link>
                                            </Flex>
                                        )
                                    }
                                </>
                            )
                        }
                    </ModalBody>
                    <ModalFooter>
                        <Link 
                            color={colors(platform, darkMode, "link")} 
                            textDecoration="none" 
                            _hover={{ textDecoration: "none" }} 
                            onClick={() => setSyncSettingsModalOpen(false)}
                        >
                            {i18n(lang, "close")}
                        </Link>
                    </ModalFooter>
                </ModalContent>
            </Modal>
            <Modal 
                onClose={() => setConfirmDeleteModalOpen(false)} 
                isOpen={confirmDeleteModalOpen} 
                isCentered={true}
            >
                <ModalOverlay borderRadius="10px" />
                <ModalContent 
                    backgroundColor={colors(platform, darkMode, "backgroundPrimary")} 
                    borderRadius="15px"
                >
                    <ModalHeader color={colors(platform, darkMode, "textPrimary")}>
                        {i18n(lang, "settings")}
                    </ModalHeader>
                    <ModalCloseButton 
                        color={colors(platform, darkMode, "textPrimary")}
                        _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }}
                        disabled={isDeletingSyncLocation}
                    />
                    <ModalBody>
                        {
                            isDeletingSyncLocation ? (
                                <Flex
                                    width="100%"
                                    height="100%"
                                    justifyContent="center"
                                    alignItems="center"
                                >
                                    <Spinner 
                                        width="32px"
                                        height="32px"
                                        color={colors(platform, darkMode, "textPrimary")}
                                    />
                                </Flex>
                            ) : (
                                <Text 
                                    color={colors(platform, darkMode, "textPrimary")} 
                                    fontSize={14}
                                >
                                    {i18n(lang, "confirmDeleteSyncLocation")}
                                </Text>
                            )
                        }
                    </ModalBody>
                    <ModalFooter>
                        <Link 
                            color={isDeletingSyncLocation ? "gray" : colors(platform, darkMode, "link")} 
                            textDecoration="none" 
                            _hover={{ textDecoration: "none" }} 
                            onClick={() => {
                                if(isDeletingSyncLocation){
                                    return false
                                }

                                setConfirmDeleteModalOpen(false)
                            }} 
                            marginRight="15px"
                        >
                            {i18n(lang, "close")}
                        </Link>
                        <Link 
                            color={isDeletingSyncLocation ? "gray" : colors(platform, darkMode, "danger")} 
                            textDecoration="none" 
                            _hover={{ textDecoration: "none" }} 
                            onClick={async () => {
                                if(isDeletingSyncLocation){
                                    return false
                                }

                                if(typeof currentSyncLocation == "undefined"){
                                    return setConfirmDeleteModalOpen(false)
                                }

                                setIsDeletingSyncLocation(true)

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

                                setIsDeletingSyncLocation(false)
                                setConfirmDeleteModalOpen(false)
                            }}
                        >
                            {i18n(lang, "delete")}
                        </Link>
                    </ModalFooter>
                </ModalContent>
            </Modal>
            <Modal 
                onClose={() => {
                    setIgnoredFilesModalOpen(false)
                    setTimeout(() => setSyncSettingsModalOpen(true), 100)
                }} 
                isOpen={ignoredFilesModalOpen} 
                size="full"
            >
                <ModalOverlay borderRadius="10px" />
                <ModalContent 
                    backgroundColor={colors(platform, darkMode, "backgroundPrimary")} 
                    borderRadius="10px"
                >
                    <ModalBody padding="0px">
                        <Flex 
                            width="100%" 
                            height={window.innerHeight} 
                            flexDirection="column"
                        >
                            <Flex 
                                marginTop="30px" 
                                width="100%" 
                                height="auto" 
                                borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")} 
                                justifyContent="center" 
                                alignItems="center"
                            >
                                <Text 
                                    color={colors(platform, darkMode, "textPrimary")} 
                                    fontSize={14}
                                    paddingBottom="5px"
                                >
                                    {i18n(lang, "filenignoreHeader")}
                                </Text>
                            </Flex>
                            <CodeMirror
                                value={currentSyncLocationIgnored}
                                width="100%"
                                height="490px"
                                placeholder={"ignored/folder\nignoredFile.txt"}
                                autoFocus
                                theme={createCodeMirrorTheme({ platform, darkMode })}
                                onChange={async (value, _) => {
                                    if(typeof currentSyncLocation == "undefined"){
                                        return false
                                    }

                                    setCurrentSyncLocationIgnored(value)
                                    debounceFilenIgnore(value, currentSyncLocation.uuid)
                                }}
                            />
                        </Flex>
                    </ModalBody>
                    <ModalFooter 
                        position="absolute" 
                        bottom="0" 
                        right="0"
                    >
                        <Link 
                            color="gray" 
                            textDecoration="none" 
                            _hover={{ textDecoration: "none" }} 
                            onClick={() => {
                                setIgnoredFilesModalOpen(false)
                                setTimeout(() => setSyncSettingsModalOpen(true), 100)
                            }}
                        >
                            {i18n(lang, "close")}
                        </Link>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    )
})

const SettingsWindowAccount = memo(({ darkMode, lang, platform, email }: { darkMode: boolean, lang: string, platform: string, email: string }) => {
    const [logoutAlertOpen, setLogoutAlertOpen] = useState<boolean>(false)
    const [userInfo, setUserInfo] = useState<any>(undefined)

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
                                                {i18n(lang, "accountStorageUsed", true, ["__PERCENT__", "__MAX__"], [((userInfo.storageUsed / userInfo.maxStorage) * 100) >= 100 ? "100" : ((userInfo.storageUsed / userInfo.maxStorage) * 100).toFixed(2), formatBytes(userInfo.maxStorage)])}
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
                                            {i18n(lang, "logout")}
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
                                                {i18n(lang, "accountCurrentPlan")}
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
                                            {i18n(lang, "accountUpgrade")}
                                        </Link>
                                    </Flex>
                                </Flex>
                                <Flex 
                                    width="100%" 
                                    height="auto" 
                                    marginTop="10px"
                                >
                                    <Progress 
                                        value={((userInfo.storageUsed / userInfo.maxStorage) * 100) >= 100 ? 100 : parseFloat(((userInfo.storageUsed / userInfo.maxStorage) * 100).toFixed(2))}
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
                                        {i18n(lang, "storageUsed", false, ["__USED__", "__MAX__"], [formatBytes(userInfo.storageUsed), formatBytes(userInfo.maxStorage)])}
                                    </Text>
                                    <Text 
                                        color={colors(platform, darkMode, "textPrimary")} 
                                        fontSize={11}
                                    >
                                        {i18n(lang, "accountStorageInUse", false, ["__PERCENT__"], [((userInfo.storageUsed / userInfo.maxStorage) * 100) >= 100 ? "100" : ((userInfo.storageUsed / userInfo.maxStorage) * 100).toFixed(2)])}
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
                                    _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }} 
                                />
                                <ModalHeader color={colors(platform, darkMode, "textPrimary")}>
                                    {i18n(lang, "logout")}
                                </ModalHeader>
                                <ModalBody>
                                    <Text color={colors(platform, darkMode, "textPrimary")}>
                                        {i18n(lang, "confirmLogout")}
                                    </Text>
                                </ModalBody>
                                <ModalFooter>
                                    <Link 
                                        color="gray" 
                                        textDecoration="none" 
                                        _hover={{ textDecoration: "none" }} 
                                        onClick={() => setLogoutAlertOpen(false)}
                                    >
                                        {i18n(lang, "close")}
                                    </Link>
                                    <Link 
                                        color={colors(platform, darkMode, "link")} 
                                        textDecoration="none"
                                        _hover={{ textDecoration: "none" }} 
                                        marginLeft="10px" 
                                        onClick={() => logout()}
                                    >
                                        {i18n(lang, "logout")}
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

const SettingsWindowIssues = memo(({ darkMode, lang, platform }: { darkMode: boolean, lang: string, platform: string }) => {
    const syncIssues: any[] = useDb("syncIssues", [])

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
                                {i18n(lang, "resumeSyncing")}
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
                                <Text color={darkMode ? "gray" : "gray"}>
                                    {i18n(lang, "noSyncIssues")}
                                </Text>
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
                        _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }} 
                    />
                    <ModalHeader color={colors(platform, darkMode, "textPrimary")}>
                        {i18n(lang, "clearSyncIssues")}
                    </ModalHeader>
                    <ModalBody>
                        <Text 
                            color={colors(platform, darkMode, "textPrimary")} 
                            fontSize={14}
                        >
                            {i18n(lang, "clearSyncIssuesInfo")}
                        </Text>
                    </ModalBody>
                    <ModalFooter>
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
                            {i18n(lang, "clear")}
                        </Link>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    )
})

const SettingsWindowNetworking = memo(({ darkMode, lang, platform }: { darkMode: boolean, lang: string, platform: string }) => {
    const [throttlingModalOpen, setThrottlingModalOpen] = useState(false)
    const networkingSettings = useDb("networkingSettings", {
        uploadKbps: 0,
        downloadKbps: 0
    })
    const [uploadKbps, setUploadKbps] = useState(0)
    const [downloadKbps, setDownloadKbps] = useState(0)

    const updateThrottling = async (): Promise<void> => {
        db.set("networkingSettings", {
            ...networkingSettings,
            uploadKbps: parseInt(uploadKbps.toString()) > 0 ? parseInt(uploadKbps.toString()) : 0,
            downloadKbps: parseInt(downloadKbps.toString()) > 0 ? parseInt(downloadKbps.toString()) : 0
        }).catch(log.error)

        setThrottlingModalOpen(false)
    }

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
                                        {i18n(lang, "uploadBandwidthThrottling")}
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
                                            networkingSettings.uploadKbps == 0 ? i18n(lang, "unlimited") : networkingSettings.uploadKbps + " Kbps"
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
                                        {i18n(lang, "configure")}
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
                                        {i18n(lang, "downloadBandwidthThrottling")}
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
                                            networkingSettings.downloadKbps == 0 ? i18n(lang, "unlimited") : networkingSettings.downloadKbps + " Kbps"
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
                                        {i18n(lang, "configure")}
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
                                    _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }} 
                                />
                                <ModalHeader color={colors(platform, darkMode, "textPrimary")}>
                                    {i18n(lang, "networkThrottling")}
                                </ModalHeader>
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
                                                {i18n(lang, "maximumUploadBandwidth")}
                                            </Text>
                                        </Flex>
                                        <Flex width="24%">
                                            <Input 
                                                type="number" 
                                                value={uploadKbps} 
                                                onChange={(event: any) => setUploadKbps(event.target.value)} 
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
                                                onKeyDown={(e) => {
                                                    if(e.key == "Enter"){
                                                        updateThrottling()
                                                    }
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
                                                {i18n(lang, "maximumDownloadBandwidth")}
                                            </Text>
                                        </Flex>
                                        <Flex width="24%">
                                            <Input 
                                                type="number" 
                                                value={downloadKbps} 
                                                onChange={(event: any) => setDownloadKbps(event.target.value)} 
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
                                                onKeyDown={(e) => {
                                                    if(e.key == "Enter"){
                                                        updateThrottling()
                                                    }
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
                                            {i18n(lang, "disableThrottlingInfo")}
                                        </Text>
                                    </Flex>
                                </ModalBody>
                                <ModalFooter>
                                    <Link 
                                        color={colors(platform, darkMode, "link")} 
                                        textDecoration="none" 
                                        _hover={{ textDecoration: "none" }} 
                                        marginLeft="10px" 
                                        onClick={() => updateThrottling()}
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

const SettingsWindowKeybinds = memo(({ darkMode, lang, platform }: { darkMode: boolean, lang: string, platform: string }) => {
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

    const [changeKeybindModalOpen, setChangeKeybindModalOpen] = useState<boolean>(false)
    const [currentKeybind, setCurrentKeybind] = useState<string>("")
    const [keybindToChange, setKeybindToChange] = useState<string>("")
    const keybinds: any[] = useDb("keybinds", defaultKeybinds)

    const keydownListener = (e: any) => {
        if(typeof e.key == "string" && e.key.length > 0){
            setCurrentKeybind((e.ctrlKey && e.key.toLowerCase() !== "control" ? "CommandOrControl+" : "") + (e.shiftKey && e.key.toLowerCase() !== "shift" ? "Shift+" : "") + (e.metaKey && e.key.toLowerCase() !== "meta" ? "Meta+" : "") + (e.altKey && e.key.toLowerCase() !== "alt" ? "Alt+" : "") + e.key.toUpperCase())
        }
    }

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
                                        {i18n(lang, "keybinds_" + keybind.type)}
                                    </Text>
                                    {/*<Tooltip 
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
                                    </Tooltip>*/}
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
                                                keybind.keybind == null ? i18n(lang, "keybindNotBound") : keybind.keybind
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
                                        {i18n(lang, "change")}
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
                    {i18n(lang, "resetToDefaults")}
                </Link>
            </Flex>
            <Modal 
                onClose={() => setChangeKeybindModalOpen(false)} 
                isOpen={changeKeybindModalOpen} 
                isCentered={true}
            >
                <ModalOverlay borderRadius="10px" />
                <ModalContent 
                    backgroundColor={colors(platform, darkMode, "backgroundPrimary")} 
                    borderRadius="15px"
                >
                    <ModalCloseButton 
                        color={colors(platform, darkMode, "textPrimary")}
                        _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }}
                    />
                    <ModalHeader color={colors(platform, darkMode, "textPrimary")}>
                        {i18n(lang, "changeKeybind")}
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
                                        {i18n(lang, "pressKeyOrCombo")}
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

const SettingsSelectionButton = memo(({ darkMode, lang, platform, selection, setSelection, type, title }: { darkMode: boolean, lang: string, platform: string, selection: any, setSelection: any, type: string, title: string }) => {
    return (
        <Flex 
            minWidth="80px"
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

const SettingsSelection = memo(({ darkMode, lang, platform, selection, setSelection }: { darkMode: boolean, lang: string, platform: string, selection: any, setSelection: any }) => {
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
                // @ts-ignore
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
                    // @ts-ignore
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
                    title={i18n(lang, "settingsGeneral")}
                />
                <SettingsSelectionButton 
                    darkMode={darkMode} 
                    lang={lang} 
                    platform={platform} 
                    selection={selection} 
                    setSelection={setSelection} 
                    type="syncs" 
                    title={i18n(lang, "settingsSyncs")} 
                />
                <SettingsSelectionButton 
                    darkMode={darkMode} 
                    lang={lang} 
                    platform={platform} 
                    selection={selection} 
                    setSelection={setSelection} 
                    type="account" 
                    title={i18n(lang, "settingsAccount")}
                />
                <SettingsSelectionButton 
                    darkMode={darkMode} 
                    lang={lang} 
                    platform={platform} 
                    selection={selection} 
                    setSelection={setSelection} 
                    type="issues" 
                    title={i18n(lang, "settingsIssues")} 
                />
                <SettingsSelectionButton 
                    darkMode={darkMode} 
                    lang={lang} 
                    platform={platform} 
                    selection={selection} 
                    setSelection={setSelection} 
                    type="networking" 
                    title={i18n(lang, "settingsNetworking")}
                />
                <SettingsSelectionButton 
                    darkMode={darkMode} 
                    lang={lang} 
                    platform={platform} 
                    selection={selection} 
                    setSelection={setSelection} 
                    type="keybinds"
                    title={i18n(lang, "settingsKeybinds")} 
                />
            </Flex>
        </Flex>
    )
})

const SettingsWindow = memo(({ startingRoute, userId, email, windowId }: { startingRoute: any, userId: number, email: string, windowId: string }) => {
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
                                    />
                                )
                            }
                            {
                                selection == "account" && (
                                    <SettingsWindowAccount 
                                        darkMode={darkMode} 
                                        lang={lang} 
                                        platform={platform}
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
                                    />
                                )
                            }
                            {
                                selection == "networking" && (
                                    <SettingsWindowNetworking
                                        darkMode={darkMode} 
                                        lang={lang} 
                                        platform={platform}
                                    />
                                )
                            }
                            {
                                selection == "keybinds" && (
                                    <SettingsWindowKeybinds 
                                        darkMode={darkMode} 
                                        lang={lang} 
                                        platform={platform}
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