import React, { memo, useState, useEffect } from "react"
import { Flex, Text, Link, Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter, Spinner, Input } from "@chakra-ui/react"
import { i18n } from "../../lib/i18n"
import useDb from "../../lib/hooks/useDb"
import db from "../../lib/db"
import colors from "../../styles/colors"
import { FaCannabis, FaHackerrank } from "react-icons/fa"

const log = window.require("electron-log")

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
                                                placeholder="0 KiB/s" 
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
                                                placeholder="0 KiB/s" 
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

export default SettingsWindowNetworking