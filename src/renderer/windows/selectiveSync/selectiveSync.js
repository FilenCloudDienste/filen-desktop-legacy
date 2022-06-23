import React, { memo, useState, useEffect, useCallback, useRef } from "react"
import { Flex, Spinner, Text } from "@chakra-ui/react"
import useDarkMode from "../../lib/hooks/useDarkMode"
import useLang from "../../lib/hooks/useLang"
import usePlatform from "../../lib/hooks/usePlatform"
import Titlebar from "../../components/Titlebar"
import { i18n } from "../../lib/i18n"
import ipc from "../../lib/ipc"
import Container from "../../components/Container"
import IsOnlineBottomToast from "../../components/IsOnlineBottomToast"
import { Base64 } from "js-base64"
import SettingsSelectiveSyncTree from "../../components/SettingsSelectiveSyncTree"
import colors from "../../styles/colors"
import { BsFileEarmark } from "react-icons/bs"

const log = window.require("electron-log")
const { ipcRenderer } = window.require("electron")

const SelectiveSyncWindow = memo(({ startingRoute, userId, email, windowId }) => {
    const darkMode = useDarkMode()
    const lang = useLang()
    const platform = usePlatform()

    const args = useRef(JSON.parse(Base64.decode(decodeURIComponent(new URLSearchParams(window.location.search).get("args"))))).current

    const [selectiveSyncRemoteTree, setSelectiveSyncRemoteTree] = useState({})
    const [isLoadingSelectiveSyncTrees, setIsLoadingSelectiveSyncTrees] = useState(true)

    const convertTree = useCallback((tree) => {
        const getPath = (ex, position) => {
            if(position <= 0){
                return ex[0]
            }

            const path = []

            for(let i = 0; i < (position + 1); i++){
                path.push(ex[i])
            }

            return path.join("/")
        }

        let paths = []
        const result = []
        const level = { result }
        let files = []
        let folders = []

        for(const path in tree.files){
            if(!files.includes(path)){
                files.push(path)
            }
        }

        for(const path in tree.folders){
            if(!folders.includes(path)){
                folders.push(path)
            }
        }

        files = files.sort((a, b) => {
            return a.localeCompare(b)
        })

        folders = folders.sort((a, b) => {
            return a.localeCompare(b)
        })

        paths = folders.concat(files)

        paths.forEach(path => {
            path.split("/").reduce((r, name, i, a) => {
                if(!r[name]){
                    const thisPath = getPath(a, i)

                    r[name] = { result: [] }
                    r.result.push({
                        name, path: thisPath,
                        i,
                        a,
                        children: r[name].result,
                        type: typeof tree.folders[thisPath] !== "undefined" ? "folder" : "file"
                    })
                }
                else if(i === a.length - 1){
                    r.result.push({
                        name,
                        children: []
                    })
                }
              
                return r[name]
            }, level)
        })

        return result
    })

    useEffect(() => {
        if(typeof args.currentSyncLocation !== "undefined"){
            setIsLoadingSelectiveSyncTrees(true)

            ipc.remoteTree(args.currentSyncLocation).then((remoteTree) => {
                const convertedRemoteTree = convertTree(remoteTree.data)

                console.log(remoteTree.data)

                setSelectiveSyncRemoteTree(convertedRemoteTree)
                setIsLoadingSelectiveSyncTrees(false)
            }).catch((err) => {
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
                            isLoadingSelectiveSyncTrees ? (
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
                            ) : typeof selectiveSyncRemoteTree == "object" && selectiveSyncRemoteTree.length > 0 ? (
                                <Flex
                                    flexDirection="column" 
                                    width="100%" 
                                    height="570px"
                                    paddingLeft="10px"
                                    paddingRight="10px"
                                    paddingTop="5px"
                                    paddingBottom="5px"
                                    overflowY="scroll"
                                >
                                    <SettingsSelectiveSyncTree
                                        darkMode={darkMode} 
                                        lang={lang} 
                                        platform={platform} 
                                        data={selectiveSyncRemoteTree} 
                                        location={args.currentSyncLocation} 
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
                                    <Flex marginTop="10px">
                                        <Text
                                            color={darkMode ? "gray" : "gray"}
                                            fontSize={13}
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
                userId={userId} 
                email={email} 
                platform={platform} 
                darkMode={darkMode} 
                lang={lang} 
            />
        </Container>
    )
})

export default SelectiveSyncWindow