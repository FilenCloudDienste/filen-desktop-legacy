import React, { memo, useEffect, useState } from "react"
import useDarkMode from "../../lib/hooks/useDarkMode"
import useLang from "../../lib/hooks/useLang"
import usePlatform from "../../lib/hooks/usePlatform"
import Container from "../../components/Container"
import { i18n } from "../../lib/i18n"
import Titlebar from "../../components/Titlebar"
import { AiOutlineDownload } from "react-icons/ai"
import { Flex, Text, Link, Spinner } from "@chakra-ui/react"
import ipc from "../../lib/ipc"
import colors from "../../styles/colors"

const { ipcRenderer } = window.require("electron")
const log = window.require("electron-log")

const UpdateWindow = memo(({ windowId, toVersion }: { windowId: string, toVersion: string }) => {
    const darkMode: boolean = useDarkMode()
    const lang: string = useLang()
    const platform: string = usePlatform()
    const [isInstalling, setIsInstalling] = useState<boolean>(false)

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
                title={i18n(lang, "titlebarUpdateAvailable")}
            />
            <Flex
                width="100vw"
                height="100vh"
                flexDirection="column"
                justifyContent="center"
                alignItems="center"
                textAlign="center"
                padding="50px"
            >
                <AiOutlineDownload 
                    size={64} 
                    color={darkMode ? "white" : "gray"} 
                />
                <Text
                    color={darkMode ? "white" : "gray"}
                    marginTop="15px"
                    fontSize={14}
                >
                    {i18n(lang, "updateWindowInfo")}
                </Text>
                <Text
                    color={darkMode ? "white" : "gray"}
                    marginTop="25px"
                    fontSize={14}
                >
                    {i18n(lang, "updateWindowInfo2")}
                </Text>
                {
                    isInstalling ? (
                        <Spinner
                            width="24px"
                            height="24px"
                            color={colors(platform, darkMode, "textPrimary")}
                            marginTop="25px"
                        />
                    ) : (
                        <Link 
                            color="#0A84FF" 
                            textDecoration="none" 
                            _hover={{
                                textDecoration: "none"
                            }} 
                            marginTop="25px"
                            onClick={() => {
                                if(isInstalling){
                                    return
                                }
                                
                                setIsInstalling(true)

                                ipc.installUpdate().catch((err) => {
                                    log.error(err)

                                    setTimeout(() => setIsInstalling(false), 15000)
                                })
                            }}
                        >
                            {i18n(lang, "updateWindowButton")}
                        </Link>
                    )
                }
            </Flex>
        </Container>
    )
})

export default UpdateWindow