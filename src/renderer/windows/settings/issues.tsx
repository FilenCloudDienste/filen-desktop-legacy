import React, { memo, useState } from "react"
import { Flex, Text, Link, Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter, Box } from "@chakra-ui/react"
import { i18n } from "../../lib/i18n"
import ipc from "../../lib/ipc"
import colors from "../../styles/colors"
import { GoIssueReopened } from "react-icons/go"
import useSyncIssues from "../../lib/hooks/useSyncIssues"

const log = window.require("electron-log")

const SettingsWindowIssues = memo(({ darkMode, lang, platform }: { darkMode: boolean, lang: string, platform: string }) => {
    const syncIssues = useSyncIssues()
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
                                                        {issue.info}
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
                    <ModalFooter
                        alignItems="center"
                    >
                        <Link 
                            color={colors(platform, darkMode, "textSecondary")} 
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
                                try{
                                    await ipc.clearSyncIssues()

                                    ipc.emitGlobal("global-message", {
                                        type: "forceSync"
                                    }).catch(log.error)
                                }
                                catch(e){
                                    log.error(e)
                                }

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

export default SettingsWindowIssues