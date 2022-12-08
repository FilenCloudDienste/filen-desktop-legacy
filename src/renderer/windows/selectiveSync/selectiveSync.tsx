import React, { memo, useState, useEffect, useRef } from "react"
import { Flex, Spinner, Text, Box, Checkbox, Image } from "@chakra-ui/react"
import useDarkMode from "../../lib/hooks/useDarkMode"
import useLang from "../../lib/hooks/useLang"
import usePlatform from "../../lib/hooks/usePlatform"
import Titlebar from "../../components/Titlebar"
import { i18n } from "../../lib/i18n"
import Container from "../../components/Container"
import IsOnlineBottomToast from "../../components/IsOnlineBottomToast"
import { Base64 } from "js-base64"
import colors from "../../styles/colors"
import { BsFileEarmark } from "react-icons/bs"
import { updateKeys } from "../../lib/user"
import { showToast } from "../../components/Toast"
import { folderContent } from "../../lib/api"
import db from "../../lib/db"
import useDb from "../../lib/hooks/useDb"
import ipc from "../../lib/ipc"
import { IoFolder, IoFolderOpen } from "react-icons/io5"
import { BsFileEarmarkFill } from "react-icons/bs"
import { AiOutlineCaretRight, AiOutlineCaretDown } from "react-icons/ai"

const log = window.require("electron-log")
const { ipcRenderer } = window.require("electron")

const TreeItem = memo(({ darkMode, lang, platform, item, location, excluded }: { darkMode: boolean, lang: string, platform: string, item: any, location: any, excluded: any }) => {
    const [isOpen, setIsOpen] = useState<boolean>(false)
    const [itemIcon, setItemIcon] = useState<string | undefined>(undefined)

    const isItemExcluded = (): boolean => {
        if(typeof excluded[item.path] !== "undefined"){
            return true
        }

        for(const path in excluded){
            if(item.path.indexOf(item.type == "folder" ? path + "/" : path) !== -1){
                return true
            }
        }

        return false
    }

    const isParentExcluded = (): boolean => {
        for(const path in excluded){
            if(item.path.indexOf(item.type == "folder" ? path + "/" : path) !== -1 && item.path !== path){
                return true
            }
        }

        return false
    }

    const onToggleExcluded = async () => {
        if(isParentExcluded()){
            return false
        }

        const isExcluded = typeof excluded[item.path] !== "undefined"

        try{
            let currentExcluded = await db.get("selectiveSync:remote:" + location.uuid)

            if(currentExcluded == null){
                currentExcluded = {}
            }

            if(isExcluded){
                delete currentExcluded[item.path]
            }
            else{
                currentExcluded[item.path] = true
            }

            await Promise.all([
                db.set("selectiveSync:remote:" + location.uuid, currentExcluded),
                db.set("localDataChanged:" + location.uuid, true),
                db.set("remoteDataChanged:" + location.uuid, true)
            ])
        }
        catch(e){
            log.error(e)
        }
    }

    const onToggleOpen = () => {
        if(item.type !== "folder"){
            return false
        }

        setIsOpen(!isOpen)
    }

    useEffect(() => {
        ipc.getFileIconName(item.name).then((icon) => {
            if(typeof icon == "string" && icon.indexOf("data:") !== -1){
                setItemIcon(icon)
            }
        }).catch(log.error)
    }, [])

    return (
        <Box 
            width="100%"
            height="auto" 
            key={item.path} 
            cursor="default"
            marginBottom="5px"
        >
            <Flex 
                flexDirection="row" 
                alignItems="center"
            >
                <Flex 
                    flexDirection="row" 
                    alignItems="center" 
                    width="auto"
                >
                    <Checkbox 
                        isChecked={!isItemExcluded()} 
                        _focus={{ outline: "none" }} 
                        outline="none" 
                        _active={{ outline: "none" }} 
                        onChange={onToggleExcluded} 
                    />
                </Flex>
                <Flex 
                    flexDirection="row" 
                    alignItems="center" 
                    width="auto" 
                    cursor={item.type == "folder" ? "pointer" : "default"} 
                    onClick={onToggleOpen} 
                    marginLeft={item.type == "folder" ? "6px" : "10px"}
                >
                    {
                        item.type == "folder" ? (
                            isOpen ? (
                                <>
                                    <AiOutlineCaretDown
                                        color="gray"
                                    />
                                    <IoFolderOpen 
                                        color={platform == "mac" ? "#3ea0d5" : "#ffd04c"} 
                                        style={{
                                            marginLeft: 4
                                        }} 
                                    />
                                </>
                            ) : (
                                <>
                                    <AiOutlineCaretRight
                                        color="gray"
                                    />
                                    <IoFolder 
                                        color={platform == "mac" ? "#3ea0d5" : "#ffd04c"} 
                                        style={{
                                            marginLeft: 4
                                        }} 
                                    />
                                </>
                            )
                        ) : (
                            <>
                                {
                                    typeof itemIcon == "string" ? (
                                        <Image 
                                            src={itemIcon}
                                            width="16px"
                                            height="16px" 
                                        />
                                    ) : (
                                        <BsFileEarmarkFill
                                            color={colors(platform, darkMode, "textPrimary")}
                                        />
                                    )
                                }
                            </>
                        )
                    }
                </Flex>
                <Flex 
                    flexDirection="row" 
                    alignItems="center" 
                    width="90%" 
                    cursor={item.type == "folder" ? "pointer" : "default"} 
                    onClick={onToggleOpen} 
                    marginLeft="10px"
                >
                    <Text
                        color={colors(platform, darkMode, "textPrimary")}
                        noOfLines={1}
                        wordBreak="break-all"
                        fontSize={14}
                    >
                        {item.name}
                    </Text>
                </Flex>
            </Flex>
            <Box 
                width="100%" 
                height="auto" 
                display={isOpen ? "block" : "none"} 
                paddingLeft="30px"
            >
                {
                    isOpen && item.type == "folder" && (
                        <Tree 
                            darkMode={darkMode} 
                            lang={lang} 
                            platform={platform} 
                            parent={item.uuid} 
                            location={location}
                            excluded={excluded}
                            currentPath={item.path}
                        />
                    )
                }
            </Box>
        </Box>
    )
})

const Tree = memo(({ darkMode, lang, platform, parent, location, excluded, currentPath }: { darkMode: boolean, lang: string, platform: string, parent: string, location: any, excluded: any, currentPath: string }) => {
    const [loading, setLoading] = useState<boolean>(true)
    const [items, setItems] = useState<any>([])

    useEffect(() => {
        setLoading(true)

        Promise.all([
            db.get("apiKey"),
            db.get("masterKeys")
        ]).then(([apiKey, masterKeys]) => {
            folderContent({
                apiKey,
                uuid: parent
            }).then(async (response) => {
                const folders: any[] = []
                const files: any[] = []

                for(let i = 0; i < response.folders.length; i++){
                    const folder: any = response.folders[i]
                    const folderName: string = await ipc.decryptFolderName(folder.name)

                    if(folderName.length > 0){
                        folders.push({
                            ...folder,
                            name: folderName,
                            type: "folder",
                            path: currentPath.length == 0 ? folderName : currentPath + "/" + folderName
                        })
                    }
                }

                for(let i = 0; i < response.uploads.length; i++){
                    const file: any = response.uploads[i]
                    const metadata: any = await ipc.decryptFileMetadata(file.metadata, masterKeys)
                    
                    if(metadata.name.length > 0){
                        files.push({
                            ...file,
                            ...metadata,
                            type: "file",
                            path: currentPath.length == 0 ? metadata.name : currentPath + "/" + metadata.name
                        })
                    }
                }

                setItems([...folders.sort((a, b) => a.name.localeCompare(b.name)), ...files.sort((a, b) => a.name.localeCompare(b.name))])
                setLoading(false)
            }).catch((err) => {
                showToast({ message: err.toString(), status: "error" })

                log.error(err)
            })
        }).catch((err) => {
            showToast({ message: err.toString(), status: "error" })

            log.error(err)
        })
    }, [])

    if(loading && currentPath.length > 0){
        return (
            <Spinner 
                width="16px" 
                height="16px" 
                color={colors(platform, darkMode, "textPrimary")} 
            />
        )
    }

    return (
        <Flex
            marginTop="5px"
            width="100%"
            flexDirection="column"
        >
            {
                items.map((item: any) => {
                    return (
                        <TreeItem 
                            darkMode={darkMode} 
                            lang={lang} 
                            platform={platform} 
                            key={item.uuid} 
                            item={item} 
                            location={location} 
                            excluded={excluded} 
                        />
                    )
                })
            }
        </Flex>
    )
})

const SelectiveSyncWindow = memo(({ userId, email, windowId }: { userId: number, email: string, windowId: string }) => {
    const darkMode: boolean = useDarkMode()
    const lang: string = useLang()
    const platform: string = usePlatform()
    const args: any = useRef(JSON.parse(Base64.decode(decodeURIComponent(new URLSearchParams(window.location.search).get("args") as string)))).current
    const [ready, setReady] = useState<boolean>(false)
    const [rootItemsLength, setRootItemsLength] = useState<number>(0)
    const excluded: any = useDb("selectiveSync:remote:" + (args.currentSyncLocation.uuid || ""), {})

    useEffect(() => {
        if(typeof args.currentSyncLocation !== "undefined"){
            Promise.all([
                updateKeys(),
                db.get("apiKey")
            ]).then(([_, apiKey]) => {
                folderContent({
                    apiKey,
                    uuid: args.currentSyncLocation.remoteUUID
                }).then((response) => {
                    setRootItemsLength(response.folders.length + response.uploads.length)
                    setReady(true)
                }).catch((err) => {
                    showToast({ message: err.toString(), status: "error" })

                    log.error(err)
                })
            }).catch((err) => {
                showToast({ message: err.toString(), status: "error" })

                log.error(err)
            })
        }

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
                title={i18n(lang, "titlebarSelectiveSync")} 
            />
            {
                userId !== 0 && (
                    <Flex 
                        flexDirection="column" 
                        width="100%" 
                        height="570px" 
                        marginTop="28px"
                    >
                        {
                            !ready ? (
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
                            ) : rootItemsLength > 0 ? (
                                <Flex
                                    flexDirection="column" 
                                    width="100%" 
                                    height="570px"
                                    paddingLeft="10px"
                                    paddingRight="10px"
                                    marginTop="12px"
                                    paddingBottom="10px"
                                    overflowY="scroll"
                                >
                                    <Tree 
                                        darkMode={darkMode} 
                                        lang={lang} 
                                        platform={platform} 
                                        parent={args.currentSyncLocation.remoteUUID} 
                                        location={args.currentSyncLocation}
                                        excluded={excluded}
                                        currentPath=""
                                    />
                                </Flex>
                            ) : (
                                <Flex
                                    flexDirection="column" 
                                    width="100%" 
                                    height="570px"
                                    justifyContent="center"
                                    alignItems="center"
                                >
                                    <Flex>
                                        <BsFileEarmark
                                            size={64}
                                            color={darkMode ? "gray" : "gray"} 
                                        />
                                    </Flex>
                                    <Flex
                                        marginTop="15px"
                                    >
                                        <Text
                                            color={darkMode ? "gray" : "gray"}
                                            fontSize={14}
                                        >
                                            {i18n(lang, "noFilesOrFoldersUploadedYet")}
                                        </Text>
                                    </Flex>
                                </Flex>
                            )
                        }
                    </Flex>
                )
            }
            <IsOnlineBottomToast
                lang={lang} 
            />
        </Container>
    )
})

export default SelectiveSyncWindow