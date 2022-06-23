import React, { memo, useState, useEffect, useCallback } from "react"
import { Flex, Text, Spinner, Avatar } from "@chakra-ui/react"
import useDb from "../../lib/hooks/useDb"
import { formatBytes } from "../../lib/helpers"
import { AiOutlinePauseCircle, AiOutlinePlayCircle } from "react-icons/ai"
import ipc from "../../lib/ipc"
import colors from "../../styles/colors"
import db from "../../lib/db"
import { userInfo as getUserInfo } from "../../lib/api"
import { GoIssueReopened } from "react-icons/go"
import MainHeaderMenu from "./MainHeaderMenu"
import { throttle } from "lodash"
import { i18n } from "../../lib/i18n"

const log = window.require("electron-log")

const MainHeader = memo(({ userId, email, platform, darkMode, lang, doneTasks, currentUploads, currentDownloads }) => {
    const paused = useDb("paused")
    const syncIssues = useDb("syncIssues")
    const [userInfo, setUserInfo] = useState(undefined)

    const updateUserUsage = useCallback(throttle(() => {
        db.get("apiKey").then((apiKey) => {
            getUserInfo({ apiKey }).then((info) => {
                setUserInfo(info)
            }).catch(log.error)
        }).catch(log.error)
    }, 5000), [])

    useEffect(() => {
        updateUserUsage()
    }, [doneTasks])

    useEffect(() => {
        updateUserUsage()

        const updateUsageInterval = setInterval(updateUserUsage, 180000)

        return () => {
            clearInterval(updateUsageInterval)
        }
    }, [])

    return (
        <Flex
            flexDirection="row"
            justifyContent="space-between"
            paddingTop="10px"
            paddingLeft="15px" 
            paddingRight="15px" 
            paddingBottom="10px" 
            borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")} 
            style={{
                WebkitAppRegion: platform == "linux" ? "drag" : "no-drag"
            }}
        >
            <Flex
                flexDirection="row"
                justifyContent="center"
            >
                {
                    typeof userInfo == "object" ? (
                        <Flex
                            flexDirection="column"
                            justifyContent="center" 
                            paddingTop="2px"
                        >
                            {
                                typeof userInfo.avatarURL == "string" && userInfo.avatarURL.indexOf("filen.io") !== -1 ? (
                                    <Avatar 
                                        src={userInfo.avatarURL}
                                        width="32px" 
                                        height="32px"
                                    />
                                ) : (
                                    <Avatar 
                                        name={email}
                                        width="32px"
                                        height="32px"
                                    />
                                )
                            }
                        </Flex>
                    ) : (
                        <Flex 
                            flexDirection="column" 
                            justifyContent="center" 
                            paddingTop="2px"
                        >
                            <Spinner
                                width="32px"
                                height="32px"
                            />
                        </Flex>
                    )
                }
                <Flex
                    flexDirection="column"
                    justifyContent="center"
                    marginLeft="10px"
                >
                    <Text
                        fontSize={14} 
                        fontWeight="bold"
                        noOfLines={1} 
                        maxWidth="200px" 
                        userSelect="none"
                    >
                        {email}
                    </Text>
                    {
                        typeof userInfo !== "object" ? (
                            <Spinner
                                width="14px"
                                height="14px"
                                marginTop="2px"
                            />
                        ) : (
                            <Text 
                                fontSize={13}
                                noOfLines={1} 
                                maxWidth="200px"
                                userSelect="none"
                            >
                                {i18n(lang, "storageUsed", false, ["__USED__", "__MAX__"], [formatBytes(userInfo.storageUsed), formatBytes(userInfo.maxStorage)])}
                            </Text>
                        )
                    }
                </Flex>
            </Flex>
            <Flex
                flexDirection="row"
                justifyContent="center"
                alignItems="center"
                paddingTop={platform == "linux" ? "15px" : "0px"}
                marginRight="-5px"
            >
                {
                    (Object.keys(currentUploads).length + Object.keys(currentDownloads).length) > 0 && (
                        <>
                            {
                                paused ? (
                                    <Flex
                                        width="32px" 
                                        height="32px" 
                                        backgroundColor="transparent" 
                                        borderRadius={5} 
                                        alignItems="center" 
                                        justifyContent="center" 
                                        cursor="pointer" 
                                        _hover={{
                                            backgroundColor: colors(platform, darkMode, "backgroundSecondary")
                                        }}
                                        onClick={() => db.set("paused", false).catch(log.error)}
                                    >
                                        <AiOutlinePlayCircle
                                            size={24}
                                            cursor="pointer"
                                            color={colors(platform, darkMode, "textPrimary")}
                                        />
                                    </Flex>
                                ) : (
                                    <Flex 
                                        width="32px" 
                                        height="32px" 
                                        backgroundColor="transparent" 
                                        borderRadius={5} 
                                        alignItems="center" 
                                        justifyContent="center" 
                                        cursor="pointer" 
                                        _hover={{
                                            backgroundColor: colors(platform, darkMode, "backgroundSecondary")
                                        }} 
                                        onClick={() => db.set("paused", true).catch(log.error)}
                                    >
                                        <AiOutlinePauseCircle
                                            size={24} 
                                            cursor="pointer" 
                                            color={colors(platform, darkMode, "textPrimary")} 
                                        />
                                    </Flex>
                                )
                            }
                        </>
                    )
                }
                {
                    Array.isArray(syncIssues) && syncIssues.length > 0 && (
                        <Flex 
                            width="32px" 
                            height="32px" 
                            backgroundColor="transparent" 
                            borderRadius={5} 
                            alignItems="center" 
                            justifyContent="center" 
                            cursor="pointer" 
                            _hover={{
                                backgroundColor: colors(platform, darkMode, "backgroundSecondary")
                            }} 
                            onClick={() => ipc.openSettingsWindow("issues")}
                        >
                            <GoIssueReopened
                                size={24}
                                cursor="pointer" 
                                color="rgba(255, 69, 58, 1)" 
                            />
                        </Flex>
                    )
                }
                <MainHeaderMenu
                    userId={userId} 
                    email={email} 
                    platform={platform} 
                    darkMode={darkMode} 
                    lang={lang} 
                />
            </Flex>
        </Flex>
    )
})

export default MainHeader