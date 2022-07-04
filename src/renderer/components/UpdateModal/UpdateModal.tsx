import React, { memo, useEffect, useState, useCallback, useRef } from "react"
import { Flex, Text, Link, Image, Modal, ModalOverlay, ModalContent, ModalCloseButton, ModalBody } from "@chakra-ui/react"
import { i18n } from "../../lib/i18n"
import useIsOnline from "../../lib/hooks/useIsOnline"
import { apiRequest } from "../../lib/api"
import { compareVersions } from "../../lib/helpers"
import colors from "../../styles/colors"
// @ts-ignore
import DarkLogo from "../../../../src/assets/images/dark_logo.png"
// @ts-ignore
import LightLogo from "../../../../src/assets/images/light_logo.png"
import ipc from "../../lib/ipc"

const log = window.require("electron-log")
const { shell } = window.require("electron")

const UpdateModal = memo(({ lang, darkMode, platform }: { lang: string, darkMode: boolean, platform: string }) => {
    const isOnline = useIsOnline()
    const [showModal, setShowModal] = useState(false)
    const currentVersion = useRef("100")
    const closed = useRef(false)

    const isUpdateAvailable = useCallback(() => {
        (async () => {
            if(closed.current){
                return false
            }
    
            if(!isOnline){
                return setTimeout(isUpdateAvailable, 5000)
            }
    
            try{
                const response = await apiRequest({
                    method: "POST",
                    endpoint: "/v1/currentVersions",
                    data: {
                        platform: "desktop"
                    },
                    timeout: 60000
                })
    
                if(!response.status){
                    return log.error(response.message)
                }
    
                if(compareVersions(currentVersion.current, response.data.desktop) == "update" && !closed.current){
                    return setShowModal(true)
                }
            }
            catch(e){
                log.error(e)
            }
    
            return setTimeout(isUpdateAvailable, 60000)
        })()
    }, []) 
    
    useEffect(() => {
        isUpdateAvailable()

        ipc.getVersion().then((version) => currentVersion.current = version).catch(log.error)
    }, [])

    return (
        <Modal 
            onClose={() => setShowModal(false)} 
            isOpen={showModal} 
            size="full"
        >
            <ModalOverlay borderRadius="10px" />
            <ModalContent 
                backgroundColor={colors(platform, darkMode, "backgroundPrimary")} 
                borderRadius="10px"
            >
                <ModalCloseButton 
                    color={colors(platform, darkMode, "textPrimary")}
                    _hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }}
                    onClick={() => closed.current = true}
                />
                <ModalBody overflow="hidden">
                    <Flex
                        width="100%"
                        height="500px"
                        justifyContent="center"
                        alignItems="center"
                        overflow="hidden"
                        flexDirection="column"
                        textAlign="center"
                    >
                        <Image 
                            src={darkMode ? LightLogo : DarkLogo} 
                            userSelect="none" 
                            width="75px" 
                            marginBottom="40px" 
                        />
                        <Text
                            color={colors(platform, darkMode, "textPrimary")}
                        >
                            {i18n(lang, "updateAvailable")}
                        </Text>
                        <Link 
                            color={colors(platform, darkMode, "link")} 
                            fontSize={16} 
                            textDecoration="none" 
                            _hover={{
                                textDecoration: "none"
                            }}
                            marginTop="40px"
                            onClick={() => shell.openExternal("https://cdn.filen.io/desktop/release/" + (platform == "linux" ? "filen.AppImage" : (platform == "mac" ? "filen.dmg" : "filen.exe"))).catch(log.error)}
                        >
                            {i18n(lang, "downloadUpdateBtn")}
                        </Link>
                    </Flex>
                </ModalBody>
            </ModalContent>
        </Modal>
    )
})

export default UpdateModal