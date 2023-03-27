import React, { memo, useState, useEffect } from "react"
import { Flex, Text, Link, Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter, Spinner, Tooltip } from "@chakra-ui/react"
import { i18n } from "../../lib/i18n"
import ipc from "../../lib/ipc"
import colors from "../../styles/colors"
import { GoIssueReopened } from "react-icons/go"
import useSyncIssues from "../../lib/hooks/useSyncIssues"
import { SyncIssue } from "../../../types"
import eventListener from "../../lib/eventListener"

const log = window.require("electron-log")

const Issue = memo(({ darkMode, lang, platform, issue }: { darkMode: boolean, lang: string, platform: string, issue: SyncIssue }) => {
    return (
        <Flex
            paddingLeft="3px" 
            paddingRight="10px"
            paddingTop="8px"
            paddingBottom="8px"
            height="auto"
            flexDirection="row" 
            borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
            width="100%"
        >
            <Flex 
                width="100%"
                height="auto"
                alignItems="center"
                flexDirection="row"
                justifyContent="space-between"
                gap="15px"
            >
                <Flex
                    flexDirection="row"
                    paddingLeft="10px"
                >
                    <Text 
                        color={colors(platform, darkMode, "textPrimary")} 
                        fontSize={13}
                        width="100%" 
                        wordBreak="break-all"
                        userSelect="text"
                    >
                        {issue.info}
                    </Text>
                </Flex>
                {
                    issue.err && issue.err.message && (
                        <Flex
                            flexShrink={0}
                        >
                            <Text 
                                color={colors(platform, darkMode, "link")} 
                                fontSize={13} 
                                marginLeft="10px" 
                                width="100%"
                                cursor="pointer"
                                onClick={() => eventListener.emit("openSyncIssueHelpModal", issue)}
                            >
                                {i18n(lang, "help")}
                            </Text>
                        </Flex>
                    )
                }
            </Flex>
        </Flex>
    )
})

const SettingsWindowIssues = memo(({ darkMode, lang, platform }: { darkMode: boolean, lang: string, platform: string }) => {
    const syncIssues = useSyncIssues()
    const [clearIssuesModalOpen, setClearIssuesModalOpen] = useState<boolean>(false)
    const [syncIssueHelpModalOpen, setSyncIssueHelpModalOpen] = useState<boolean>(false)
    const [syncIssueHelp, setSyncIssueHelp] = useState<SyncIssue>()

    useEffect(() => {
        const openSyncIssueHelpModalListener = eventListener.on("openSyncIssueHelpModal", (issue: SyncIssue) => {
            setSyncIssueHelp(issue)
            setSyncIssueHelpModalOpen(true)
        })

        return () => {
            openSyncIssueHelpModalListener.remove()
        }
    }, [])

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
                            <Flex 
                                width="80%" 
                                height="380px" 
                                backgroundColor={colors(platform, darkMode, "backgroundSecondary")} 
                                overflow="hidden"
                                borderRadius="15px" 
                                marginTop="45px"
                            >
                                <Flex
                                    width="100%"
                                    height="100%"
                                    overflowY="auto"
                                    overflowX="hidden"
                                    flexDirection="column"
                                >
                                    {
                                        syncIssues.slice(0, 1024).map((issue, index) => {
                                            return (
                                                <Issue
                                                    key={index}
                                                    issue={issue}
                                                    darkMode={darkMode}
                                                    platform={platform}
                                                    lang={lang}
                                                />
                                            )
                                        })
                                }
                                </Flex>
                            </Flex>
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
                            color={colors(platform, darkMode, "textSecondary")} 
                            fontSize={14}
                        >
                            {i18n(lang, "clearSyncIssuesInfo")}
                        </Text>
                    </ModalBody>
                    <ModalFooter
                        alignItems="center"
                    >
                        <Link 
                            color={colors(platform, darkMode, "link")} 
                            textDecoration="none" 
                            _hover={{ textDecoration: "none" }}
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
            <Modal 
                onClose={() => setSyncIssueHelpModalOpen(false)} 
                isOpen={syncIssueHelpModalOpen} 
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
                        {i18n(lang, "help")}
                    </ModalHeader>
                    <ModalBody>
                        {
                            syncIssueHelp && syncIssueHelp.err && syncIssueHelp.err.message && syncIssueHelp.path && (
                                <>
                                    <Text 
                                        color={colors(platform, darkMode, "textPrimary")} 
                                        fontSize={16}
                                    >
                                        {i18n(lang, "issue")}
                                    </Text>
                                    <Text 
                                        color={colors(platform, darkMode, "textSecondary")} 
                                        fontSize={14}
                                        marginTop="5px"
                                    >
                                        {syncIssueHelp.err.message}
                                    </Text>
                                    <Text 
                                        color={colors(platform, darkMode, "textPrimary")} 
                                        fontSize={16}
                                        marginTop="20px"
                                    >
                                        {i18n(lang, "path")}
                                    </Text>
                                    <Text 
                                        color={colors(platform, darkMode, "textSecondary")} 
                                        fontSize={14}
                                        marginTop="5px"
                                    >
                                        {syncIssueHelp.path}
                                    </Text>
                                    <Text 
                                        color={colors(platform, darkMode, "textPrimary")} 
                                        fontSize={16}
                                        marginTop="20px"
                                    >
                                        {i18n(lang, "possibleSolution")}
                                    </Text>
                                    <Text 
                                        color={colors(platform, darkMode, "textSecondary")} 
                                        fontSize={14}
                                        marginTop="5px"
                                    >
                                        {
                                        (() => {
                                            if(syncIssueHelp.err.message.indexOf("ENOENT") !== -1){
                                                return i18n(lang, "possibleSolutionENOENT")
                                            }

                                            if(syncIssueHelp.err.message.indexOf("EPERM") !== -1 || syncIssueHelp.err.message.indexOf("EACCES") !== -1){
                                                return i18n(lang, "possibleSolutionEPERM")
                                            }

                                            if(syncIssueHelp.err.message.indexOf("EBUSY") !== -1 || syncIssueHelp.err.message.indexOf("ELOCKED")){
                                                return i18n(lang, "possibleSolutionEBUSY")
                                            }

                                            if(syncIssueHelp.err.message.indexOf("EMFILE") !== -1 || syncIssueHelp.err.message.indexOf("ENOSPC") !== -1){
                                                return i18n(lang, "possibleSolutionEMFILE")
                                            }

                                            return i18n(lang, "possibleSolutionEPERM")
                                        })()  
                                    }
                                    </Text>
                                </>
                            )
                        }
                    </ModalBody>
                    <ModalFooter
                        alignItems="center"
                    >
                        <Link 
                            color={colors(platform, darkMode, "textSecondary")} 
                            textDecoration="none" 
                            _hover={{ textDecoration: "none" }}
                            onClick={() => setSyncIssueHelpModalOpen(false)}
                        >
                            {i18n(lang, "close")}
                        </Link>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    )
})

export default SettingsWindowIssues