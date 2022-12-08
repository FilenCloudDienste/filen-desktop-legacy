import React, { memo, useState, useEffect, useRef } from "react"
import { Flex, Text, Link, Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter, Input, Spinner, Image } from "@chakra-ui/react"
import useDarkMode from "../../lib/hooks/useDarkMode"
import useLang from "../../lib/hooks/useLang"
import usePlatform from "../../lib/hooks/usePlatform"
import Titlebar from "../../components/Titlebar"
import { i18n } from "../../lib/i18n"
import { baseFolders, folderContent } from "../../lib/api"
import db from "../../lib/db"
import { IoChevronForwardOutline, IoFolderOpenOutline, IoChevronBackOutline } from "react-icons/io5"
import { getParentFromParentFromURL, fileAndFolderNameValidation } from "../../lib/helpers"
import ipc from "../../lib/ipc"
import colors from "../../styles/colors"
import Container from "../../components/Container"
import IsOnlineBottomToast from "../../components/IsOnlineBottomToast"
import { BsFillFolderFill, BsFillFileFill } from "react-icons/bs"
// @ts-ignore
import { List } from "react-virtualized"
import { showToast } from "../../components/Toast"
import { createFolder } from "../../lib/api"
import { v4 as uuidv4 } from "uuid"
import { updateKeys } from "../../lib/user"

const log = window.require("electron-log")
const { ipcRenderer } = window.require("electron")

const CloudItem = memo(({ style, item, platform, darkMode, index, navigateToFolder }: { style: any, item: any, platform: string, darkMode: boolean, index: number, navigateToFolder: (uuid: string) => void }) => {
    const [icon, setIcon] = useState<string>("")

    useEffect(() => {
        if(item.type == "file"){
            ipc.getFileIconName(item.metadata.name).then((gotIcon) => {
                setIcon(gotIcon)
            }).catch(log.error)
        }
    }, [])

    return (
        <Flex
            style={style} 
            width="100%" 
            flexDirection="row" 
            justifyContent={item.type == "folder" ? "space-between" : "flex-start"} 
            alignItems="center" 
            _hover={item.type == "folder" ? {
                backgroundColor: "gray"
            } : {}} 
            borderRadius="15px" 
            paddingLeft="10px" 
            paddingRight="10px" 
            cursor={item.type == "folder" ? "pointer" : "auto"}
            pointerEvents="all" 
            onClick={() => {
                if(item.type !== "folder"){
                    return
                }

                navigateToFolder(item.uuid)
            }}
        >
            {
                item.type == "folder" ? (
                    <>
                        <Flex 
                            flexDirection="row" 
                            justifyContent="flex-start" 
                            alignItems="center"
                            width="100%" 
                        >
                            <BsFillFolderFill
                                size={18}
                                color={platform == "mac" ? "#3ea0d5" : "#ffd04c"}
                            />
                            <Text 
                                noOfLines={1}
                                color={colors(platform, darkMode, "textPrimary")} 
                                width="540px" 
                                marginLeft="10px"
                                wordBreak="break-all"
                            >
                                {item.name}
                            </Text>
                        </Flex>
                        <IoChevronForwardOutline 
                            color={colors(platform, darkMode, "textPrimary")}
                            size={18}
                        />
                    </>
                ) : (
                    <Flex 
                        key={index} 
                        width="100%" 
                        height="35px" 
                        flexDirection="row" 
                        justifyContent="flex-start" 
                        alignItems="center" 
                        borderRadius="15px"
                    >
                        {
                            typeof icon == "string" && icon.length > 0 ? (
                                <Image
                                    src={icon} 
                                    height="18px" 
                                    width="18px" 
                                    marginRight="10px" 
                                />
                            ) : (
                                <BsFillFileFill
                                    size={18}
                                    color={colors(platform, darkMode, "textPrimary")}
                                />
                            )
                        }
                        <Text 
                            noOfLines={1} 
                            color={colors(platform, darkMode, "textPrimary")} 
                            width="540px" 
                            wordBreak="break-all"
                        >
                            {item.metadata.name}
                        </Text>
                    </Flex>
                )
            }
        </Flex>
    )
})

const CloudWindow = memo(({ userId, email, windowId }: { userId: number, email: string, windowId: string }) => {
    const darkMode: boolean = useDarkMode()
    const lang: string = useLang()
    const platform: string = usePlatform()

    const [isLoading, setIsLoading] = useState<boolean>(true)
    const url = useRef<any>("")
    const path = useRef<any>("")
    const mode = useRef<string>(new URLSearchParams(window.location.search).get("mode") as string).current
    const defaultFolderUUID = useRef<any>(undefined)
    const defaultFolderName = useRef<any>(undefined)
    const folderNames = useRef<any>({}).current
    const [currentItems, setCurrentItems] = useState<any>([])
    const [selectedFolder, setSelectedFolder] = useState<any>(undefined)
    const resultSent = useRef<boolean>(false)
    const [sendingResult, setSendingResult] = useState<boolean>(false)
    const [createFolderModalOpen, setCreateFolderModalOpen] = useState<boolean>(false)
    const [createFolderName, setCreateFolderName] = useState<string>("")
    const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false)

    const fetchFolderContent = async (uuid: string): Promise<any> => {
        setIsLoading(true)

        try{
            let masterKeys = await db.get("masterKeys")

            if(!Array.isArray(masterKeys)){
                masterKeys = []
            }

            const response: any = await folderContent({ apiKey: await db.get("apiKey"), uuid })

            const folders: any[] = []
            const files: any[] = []

            for(let i = 0; i < response.folders.length; i++){
                const folder: any = response.folders[i]
                const folderName: string = await ipc.decryptFolderName(folder.name)

                if(folderName.length > 0){
                    folderNames[folder.uuid] = folderName

                    folders.push({
                        ...folder,
                        name: folderName,
                        type: "folder"
                    })
                }
            }

            for(let i = 0; i < response.uploads.length; i++){
                const file: any = response.uploads[i]
                const metadata: any = await ipc.decryptFileMetadata(file.metadata, masterKeys)
                
                if(metadata.name.length > 0){
                    files.push({
                        ...file,
                        metadata,
                        icon: undefined,
                        type: "file"
                    })
                }
            }

            setSelectedFolder((prev: any) => prev.uuid !== uuid ? {
                name: folderNames[uuid],
                uuid
            } : prev)

            setCurrentItems([...folders.sort((a, b) => a.name.localeCompare(b.name)), ...files.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))])
        }
        catch(e){
            log.error(e)
        }

        setIsLoading(false)
    }

    const navigateToFolder = (uuid: string): void => {
        url.current = url.current + "/" + uuid
        path.current = path.current + "/" + folderNames[uuid]

        fetchFolderContent(uuid)
    }

    const goBack = (): void => {
        const uuid: string = getParentFromParentFromURL(url.current)
        let newURL: string = url.current.split("/").slice(0, -1).join("/")
        let newPath: string = path.current.split("/").slice(0, -1).join("/")

        if(newURL.endsWith("/")){
            newURL = newURL.slice(0, newURL.length - 1)
        }

        if(newPath.endsWith("/")){
            newPath = newPath.slice(0, newPath.length - 1)
        }

        if(typeof uuid == "string" && uuid.length > 16){
            url.current = newURL
            path.current = newPath

            fetchFolderContent(uuid)
        }
    }

    useEffect(() => {
        if(createFolderModalOpen){
            setCreateFolderName("")
        }
    }, [createFolderModalOpen])

    useEffect(() => {
        (async () => {
            try{
                await updateKeys()
                
                const response = await baseFolders({ apiKey: await db.get("apiKey") })
    
                for(let i = 0; i < response.folders.length; i++){
                    const folder = response.folders[i]

                    if(folder.is_default){
                        const folderName = await ipc.decryptFolderName(folder.name)

                        defaultFolderUUID.current = folder.uuid
                        defaultFolderName.current = folderName
                        folderNames[folder.uuid] = folderName
                    }
                }
            }
            catch(e){
                return log.error(e)
            }

            if(typeof defaultFolderUUID.current == "undefined"){
                return log.info("No default folder found")
            }

            setSelectedFolder({
                name: defaultFolderName.current,
                uuid: defaultFolderUUID.current
            })

            url.current = defaultFolderUUID.current
            path.current = defaultFolderName.current
            
            fetchFolderContent(defaultFolderUUID.current)
        })()

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
                title={i18n(lang, "titlebarCloudWindow")} 
            />
            <Flex 
                flexDirection="column" 
                width="100%" 
                height="600px" 
                paddingTop="15px"
            >
                <Flex 
                    flexDirection="column" 
                    width="100%" 
                    height="100%" 
                    alignItems="center" 
                    justifyContent="center" 
                    paddingTop="30px"
                >
                    {
                        typeof selectedFolder !== "undefined" && (
                            <Flex 
                                flexDirection="column" 
                                width="90%" 
                                height="auto" 
                                paddingLeft="15px" 
                                paddingRight="15px" 
                                paddingTop="10px" 
                                paddingBottom="10px" 
                                backgroundColor={colors(platform, darkMode, "backgroundSecondary")} 
                                borderRadius="15px"
                                position="fixed"
                                top="60px"
                            >
                                <Flex 
                                    width="100%" 
                                    height="auto" 
                                    flexDirection="row" 
                                    justifyContent="space-between" 
                                    alignItems="center"
                                >
                                    <Flex 
                                        flexDirection="row" 
                                        alignItems="center" 
                                        justifyContent="center" 
                                        width="60%"
                                    >
                                        {
                                            url.current.indexOf("/") !== -1 && (
                                                <Flex 
                                                    marginRight="15px" 
                                                    cursor="pointer" 
                                                    pointerEvents="all" 
                                                    onClick={() => goBack()}
                                                >
                                                    <IoChevronBackOutline 
                                                        color={colors(platform, darkMode, "link")} 
                                                        size={18} 
                                                        fontWeight="bold" 
                                                    />
                                                </Flex>
                                            )
                                        }
                                        <Text 
                                            noOfLines={1} 
                                            color={colors(platform, darkMode, "textPrimary")} 
                                            width="100%"
                                            wordBreak="break-all"
                                        >
                                            {path.current.split("/").length > 1 ? "/" + path.current.split("/").slice(1).join("/") : "/"}
                                        </Text>
                                    </Flex>
                                    <Flex
                                        flexDirection="row" 
                                        alignItems="center" 
                                        justifyContent="center"
                                    >
                                        <Link 
                                            color={colors(platform, darkMode, "link")} 
                                            textDecoration="none" 
                                            _hover={{
                                                textDecoration: "none"
                                            }} 
                                            onClick={() => setCreateFolderModalOpen(true)}
                                            marginRight="10px"
                                            noOfLines={1}
                                            wordBreak="break-all"
                                        >
                                            {i18n(lang, "createFolder")}
                                        </Link>
                                        {
                                            mode == "selectFolder" ? (
                                                <>
                                                    {
                                                        sendingResult ? (
                                                            <Spinner 
                                                                width="18px" 
                                                                height="18px" 
                                                                color={colors(platform, darkMode, "textPrimary")} 
                                                            />
                                                        ) : (
                                                            <Link 
                                                                color={colors(platform, darkMode, "link")} 
                                                                textDecoration="none" 
                                                                _hover={{
                                                                    textDecoration: "none"
                                                                }} 
                                                                onClick={() => {
                                                                    if(!resultSent.current){
                                                                        resultSent.current = true

                                                                        setSendingResult(true)

                                                                        let remotePath = path.current.split("/").slice(1).join("/")

                                                                        if(remotePath.length == 0){
                                                                            remotePath = "/"
                                                                        }

                                                                        if(remotePath == defaultFolderName.current){
                                                                            remotePath = "/"
                                                                        }

                                                                        if(!remotePath.startsWith("/")){
                                                                            remotePath = "/" + remotePath
                                                                        }
                    
                                                                        ipc.remoteFolderSelected({
                                                                            uuid: selectedFolder.uuid,
                                                                            path: remotePath,
                                                                            name: folderNames[selectedFolder.uuid],
                                                                            canceled: false,
                                                                            windowId
                                                                        })
                                                                    }
                                                                }}
                                                            >
                                                                {i18n(lang, "select")}
                                                            </Link>
                                                        )
                                                    }
                                                </>
                                            ) : <></>
                                        }
                                    </Flex>
                                </Flex>
                            </Flex>
                        )
                    }
                    {
                        isLoading ? (
                            <Flex 
                                flexDirection="column" 
                                width="100%" 
                                height="500px"
                                alignItems="center" 
                                justifyContent="center"
                            >
                                <Spinner 
                                    color={colors(platform, darkMode, "textPrimary")} 
                                    width="40px" 
                                    height="40px" 
                                />
                            </Flex>
                        ) : (
                            <List
                                height={475}
                                width={window.innerWidth * 0.9}
                                noRowsRenderer={() => {
                                    return (
                                        <Flex 
                                            flexDirection="column" 
                                            width="100%" 
                                            height="auto" 
                                            alignItems="center" 
                                            justifyContent="center" 
                                            marginTop="125px"
                                        >
                                            <IoFolderOpenOutline 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                size={60} 
                                            />
                                            <Text 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                marginTop="10px"
                                            >
                                                {i18n(lang, "thisFolderIsEmpty")}
                                            </Text>
                                            <Link 
                                                color={colors(platform, darkMode, "link")} 
                                                textDecoration="none" 
                                                marginTop="10px" 
                                                _hover={{
                                                    textDecoration: "none"
                                                }} onClick={() => setCreateFolderModalOpen(true)}
                                            >
                                                {i18n(lang, "createFolder")}
                                            </Link>
                                        </Flex>
                                    )
                                }}
                                overscanRowCount={8}
                                rowCount={currentItems.length}
                                rowHeight={35}
                                estimatedRowSize={currentItems.length * 35}
                                style={{
                                    position: "fixed",
                                    top: 120
                                }}
                                rowRenderer={({ index, key, style }: { index: number, key: string, style: any }) => {
                                    const item = currentItems[index]

                                    return (
                                        <CloudItem item={item} key={key} style={style} index={index} darkMode={darkMode} platform={platform} navigateToFolder={navigateToFolder} />
                                    )
                                }}
                            />
                        )
                    }
                </Flex>
            </Flex>
            <Modal 
                onClose={() => setCreateFolderModalOpen(false)} 
                isOpen={createFolderModalOpen} 
                isCentered
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
                        {i18n(lang, "createFolder")}
                    </ModalHeader>
                    <ModalBody>
                        <Input 
                            type="text"
                            value={createFolderName}
                            onChange={(event) => setCreateFolderName(event.target.value)}
                            placeholder={i18n(lang, "createFolderPlaceholder")}
                            userSelect="none" 
                            style={{
                                border: "none",
                                backgroundColor: darkMode ? "#171717" : "lightgray",
                                color: "gray",
                                height: "37.5px",
                                paddingLeft: "10px",
                                paddingRight: "10px"
                            }} 
                            _placeholder={{
                                color: "gray"
                            }}
                            autoFocus={true}
                            disabled={isCreatingFolder}
                        />
                    </ModalBody>
                    <ModalFooter>
                        {
                            isCreatingFolder ? (
                                <Spinner
                                    width="32px"
                                    height="32px"
                                    color={colors(platform, darkMode, "textPrimary")}
                                />
                            ) : (
                                <>
                                    <Link 
                                        color={colors(platform, darkMode, "link")} 
                                        textDecoration="none" 
                                        _hover={{ textDecoration: "none" }} 
                                        marginLeft="10px" 
                                        onClick={async () => {
                                            const folderName = createFolderName.trim()

                                            if(folderName.length == 0){
                                                return showToast({ message: i18n(lang, "invalidFolderName"), status: "error" })
                                            }

                                            if(!fileAndFolderNameValidation(folderName)){
                                                return showToast({ message: i18n(lang, "invalidFolderName"), status: "error" })
                                            }

                                            const ex = url.current.split("/")
                                            const parent = ex[ex.length - 1].trim()

                                            setIsCreatingFolder(true)

                                            try{
                                                await createFolder({
                                                    uuid: uuidv4(),
                                                    name: folderName,
                                                    parent
                                                })
                                            }
                                            catch(e: any){
                                                log.error(e)

                                                setIsCreatingFolder(false)

                                                return showToast({ message: e.toString(), status: "error" })
                                            }

                                            setCreateFolderModalOpen(false)
                                            fetchFolderContent(parent)
                                            setIsCreatingFolder(false)
                                        }}
                                    >
                                        {i18n(lang, "create")}
                                    </Link>
                                </>
                            )
                        }
                    </ModalFooter>
                </ModalContent>
            </Modal>
            <IsOnlineBottomToast
                lang={lang} 
            />
        </Container>
    )
})

export default CloudWindow