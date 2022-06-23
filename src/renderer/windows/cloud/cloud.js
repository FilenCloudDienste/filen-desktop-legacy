import React, { memo, useState, useEffect, useCallback, useRef } from "react"
import { Flex, Text, Link, Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter, Button, Input, Spinner, Image } from "@chakra-ui/react"
import useDarkMode from "../../lib/hooks/useDarkMode"
import useLang from "../../lib/hooks/useLang"
import usePlatform from "../../lib/hooks/usePlatform"
import Titlebar from "../../components/Titlebar"
import { i18n } from "../../lib/i18n"
import { baseFolders, folderContent } from "../../lib/api"
import db from "../../lib/db"
import { IoChevronForwardOutline, IoFolderOpenOutline, IoChevronBackOutline } from "react-icons/io5"
import { getParentFromParentFromURL } from "../../lib/helpers"
import ipc from "../../lib/ipc"
import colors from "../../styles/colors"
import Container from "../../components/Container"
import IsOnlineBottomToast from "../../components/IsOnlineBottomToast"
import useIsOnline from "../../lib/hooks/useIsOnline"
import { BsFillFolderFill } from "react-icons/bs"
import { List } from "react-virtualized"

const log = window.require("electron-log")
const { ipcRenderer } = window.require("electron")

const CloudWindow = memo(({ userId, email, windowId }) => {
    const darkMode = useDarkMode()
    const lang = useLang()
    const platform = usePlatform()

    const [isLoading, setIsLoading] = useState(true)
    const url = useRef("")
    const path = useRef("")
    const mode = useRef(new URLSearchParams(window.location.search).get("mode")).current
    const defaultFolderUUID = useRef(undefined)
    const defaultFolderName = useRef(undefined)
    const folderNames = useRef({}).current
    const [currentItems, setCurrentItems] = useState([])
    const [selectedFolder, setSelectedFolder] = useState(undefined)
    const resultSent = useRef(false)
    const [sendingResult, setSendingResult] = useState(false)
    const [createFolderModalOpen, setCreateFolderModalOpen] = useState(false)
    const [createFolderName, setCreateFolderName] = useState("")

    const fetchFolderContent = useCallback(async (uuid) => {
        setIsLoading(true)

        try{
            let masterKeys = await db.get("masterKeys")

            if(!Array.isArray(masterKeys)){
                masterKeys = []
            }

            const response = await folderContent({ apiKey: await db.get("apiKey"), uuid })

            const folders = []
            const files = []

            for(let i = 0; i < response.folders.length; i++){
                const folder = response.folders[i]
                const folderName = await ipc.decryptFolderName(folder.name)

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
                const file = response.uploads[i]
                const metadata = await ipc.decryptFileMetadata(file.metadata, masterKeys)
                
                if(metadata.name.length > 0){
                    files.push({
                        ...file,
                        metadata: metadata,
                        icon: await ipc.getFileIconName(metadata.name),
                        type: "file"
                    })
                }
            }

            setSelectedFolder(prev => prev.uuid !== uuid ? {
                name: folderNames[uuid],
                uuid
            } : prev)

            setCurrentItems([...folders.sort((a, b) => a.name.localeCompare(b.name)), ...files.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))])
        }
        catch(e){
            log.error(e)
        }

        setIsLoading(false)
    })

    const navigateToFolder = useCallback((uuid) => {
        url.current = url.current + "/" + uuid
        path.current = path.current + "/" + folderNames[uuid]

        fetchFolderContent(uuid)
    })

    const goBack = useCallback(() => {
        const uuid = getParentFromParentFromURL(url.current)
        let newURL = url.current.split("/").slice(0, -1).join("/")
        let newPath = path.current.split("/").slice(0, -1).join("/")

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
    })

    useEffect(() => {
        (async () => {
            try{
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
                                        width="80%"
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
                                        >
                                            {path.current.split("/").length > 1 ? "/" + path.current.split("/").slice(1).join("/") : "/"}
                                        </Text>
                                    </Flex>
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
                                                            Select
                                                        </Link>
                                                    )
                                                }
                                            </>
                                        ) : <></>
                                    }
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
                                                This folder is empty
                                            </Text>
                                            <Link 
                                                color={colors(platform, darkMode, "link")} 
                                                textDecoration="none" 
                                                marginTop="10px" 
                                                _hover={{
                                                    textDecoration: "none"
                                                }} onClick={() => setCreateFolderModalOpen(true)}
                                            >
                                                Create folder
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
                                rowRenderer={({ index, key, style }) => {
                                    const item = currentItems[index]

                                    return (
                                        <Flex 
                                            key={key} 
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
                                            onClick={() => navigateToFolder(item.uuid)}
                                        >
                                            {
                                                item.type == "folder" ? (
                                                    <>
                                                        <Flex 
                                                            flexDirection="row" 
                                                            justifyContent="flex-start" 
                                                            alignItems="center"
                                                        >
                                                            <BsFillFolderFill
                                                                size={18}
                                                                color={platform == "mac" ? "#3ea0d5" : "#ffd04c"}
                                                            />
                                                            <Text 
                                                                noOfLines={1}
                                                                color={colors(platform, darkMode, "textPrimary")} 
                                                                maxWidth="85%" 
                                                                marginLeft="10px"
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
                                                            typeof item.icon == "string" && (
                                                                <Image
                                                                    src={item.icon} 
                                                                    height="18px" 
                                                                    width="18px" 
                                                                    marginRight="10px" 
                                                                />
                                                            )
                                                        }
                                                        <Text 
                                                            noOfLines={1} 
                                                            color={colors(platform, darkMode, "textPrimary")} 
                                                            maxWidth="85%"
                                                        >
                                                            {item.metadata.name}
                                                        </Text>
                                                    </Flex>
                                                )
                                            }
                                        </Flex>
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
                isCentered={true}
            >
                <ModalOverlay borderRadius="10px" />
                <ModalContent backgroundColor="#171717">
                    <ModalHeader color="white">Create folder</ModalHeader>
                    <ModalCloseButton color="white" />
                    <ModalBody>
                        <Input 
                            type="text"
                            value={createFolderName}
                            onChange={(event) => setCreateFolderName(event.target.value)}
                            placeholder={i18n(lang, "createFolderPlaceholder")}
                            userSelect="none"
                            style={{
                                marginBottom: 10,
                                border: "none",
                                backgroundColor: "lightgray",
                                color: "gray"
                            }} 
                            _placeholder={{
                                color: "gray"
                            }} 
                        />
                    </ModalBody>
                    <ModalFooter>
                        <Button 
                            onClick={() => setCreateFolderModalOpen(false)}
                            backgroundColor="white"
                        >
                            Close
                        </Button>
                        <Button
                            onClick={() => setCreateFolderModalOpen(false)}
                            marginLeft="10px"
                            backgroundColor={colors(platform, darkMode, "link")}
                            color="white"
                        >
                            Create
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
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

export default CloudWindow