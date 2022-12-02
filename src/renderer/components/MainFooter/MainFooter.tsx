import React from "react"
import { Flex, Text, Spinner } from "@chakra-ui/react"
import { getTimeRemaining } from "../../lib/helpers"
import { AiOutlineCheckCircle, AiOutlinePauseCircle } from "react-icons/ai"
import colors from "../../styles/colors"
import isEqual from "react-fast-compare"
import { i18n } from "../../lib/i18n"
import { maxConcurrentSyncTasks } from "../../lib/constants"

interface Props {
    userId: number,
    email: string,
    platform: string,
    darkMode: boolean,
    lang: string,
    currentUploads: any,
    currentDownloads: any,
    paused: boolean,
    runningTasks: any,
    totalRemaining: any,
    runningSyncTasks: any,
    isOnline: boolean,
    acquiringLock: boolean,
    checkingChanges: boolean
}

export default class MainFooter extends React.Component<Props> {
    shouldComponentUpdate(nextProps: any){
        return !isEqual(nextProps, this.props)
    }

    render(){
        const {
            userId,
            email,
            platform,
            darkMode,
            lang,
            currentUploads,
            currentDownloads,
            paused,
            runningTasks,
            totalRemaining,
            runningSyncTasks,
            isOnline,
            acquiringLock,
            checkingChanges
        }: Props = this.props

        return (
            <Flex
                flexDirection="row" 
                justifyContent="space-between" 
                paddingTop="9px" 
                paddingLeft="12px" 
                paddingRight="12px" 
                overflow="hidden" 
                width="100%"
            >
                <Flex 
                    alignItems="center" 
                    overflow="hidden"
                >
                    {
                        acquiringLock ? (
                            <Flex alignItems="center">
                                <Spinner
                                    width="12px"
                                    height="12px"
                                    color={colors(platform, darkMode, "textPrimary")}
                                />
                                <Text 
                                    fontSize={12} 
                                    color={colors(platform, darkMode, "textPrimary")} 
                                    marginLeft="5px" 
                                    noOfLines={1}
                                >
                                    {i18n(lang, "acquiringSyncLock")}
                                </Text>
                            </Flex>
                        ) : checkingChanges && (runningTasks.length + runningSyncTasks + Object.keys(currentUploads).length + Object.keys(currentDownloads).length) <= 0 ? (
                            <Flex alignItems="center">
                                <Spinner
                                    width="12px"
                                    height="12px"
                                    color={colors(platform, darkMode, "textPrimary")}
                                />
                                <Text 
                                    fontSize={12} 
                                    color={colors(platform, darkMode, "textPrimary")} 
                                    marginLeft="5px" 
                                    noOfLines={1}
                                >
                                    {i18n(lang, "checkingChanges")}
                                </Text>
                            </Flex>
                        ) : (
                            <>
                                {
                                    (runningTasks.length + Object.keys(currentUploads).length + Object.keys(currentDownloads).length) > 0 ? (
                                        <Flex alignItems="center">
                                            <Spinner
                                                width="12px"
                                                height="12px"
                                                color={colors(platform, darkMode, "textPrimary")}
                                            />
                                            <Text 
                                                fontSize={12} 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                marginLeft="5px" 
                                                noOfLines={1}
                                            >
                                                {
                                                    (() => {
                                                        const runningTaskCount = (runningTasks.length + Object.keys(currentUploads).length + Object.keys(currentDownloads).length)

                                                        if(runningTaskCount == 1){
                                                            return i18n(lang, "syncingItemsFooterSingular", true, ["__COUNT__"], ["1"])
                                                        }
                                                        else{
                                                            if(runningTaskCount > 32 && ((runningTaskCount + 32) > maxConcurrentSyncTasks)){
                                                                return i18n(lang, "syncingItemsFooterPlural", true, ["__COUNT__"], [maxConcurrentSyncTasks.toString() + "+"])
                                                            }
                                                            else{
                                                                return i18n(lang, "syncingItemsFooterPlural", true, ["__COUNT__"], [runningTaskCount.toString()])
                                                            }
                                                        }
                                                    })()
                                                }
                                            </Text>
                                        </Flex>
                                    ) : runningSyncTasks > 0 ? (
                                        <Flex alignItems="center">
                                            <Spinner
                                                width="12px"
                                                height="12px"
                                                color={colors(platform, darkMode, "textPrimary")}
                                            />
                                            <Text 
                                                fontSize={12} 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                                marginLeft="5px" 
                                                noOfLines={1}
                                            >
                                                {i18n(lang, "syncing")}
                                            </Text>
                                        </Flex>
                                    ) : (
                                        <Flex alignItems="center">
                                            <AiOutlineCheckCircle
                                                size={13}
                                                color="green" 
                                            />
                                            <Text
                                                fontSize={12}
                                                color={colors(platform, darkMode, "textPrimary")}
                                                marginLeft="5px"
                                                noOfLines={1}
                                            >
                                                {i18n(lang, "syncingFooterEverythingSynced")}
                                            </Text>
                                        </Flex>
                                    )
                                }
                            </>
                        )
                    }
                </Flex>
                {
                    !acquiringLock && (
                        <Flex 
                            alignItems="center" 
                            overflow="hidden"
                        >
                            {
                                (paused || !isOnline) ? (
                                    <AiOutlinePauseCircle
                                        color={colors(platform, darkMode, "textPrimary")}
                                        size={14}
                                    />
                                ) : (
                                    <>
                                        {
                                            (Object.keys(currentUploads).length + Object.keys(currentDownloads).length) > 0 && (() => {
                                                const remainingReadable = getTimeRemaining((new Date().getTime() + (totalRemaining * 1000)))

                                                if(remainingReadable.total <= 1 || remainingReadable.minutes <= 1){
                                                    remainingReadable.total = 1
                                                    remainingReadable.days = 0
                                                    remainingReadable.hours = 0
                                                    remainingReadable.minutes = 1
                                                    remainingReadable.seconds = 1
                                                }

                                                return (
                                                    <Text 
                                                        fontSize={12}
                                                        color={colors(platform, darkMode, "textPrimary")}
                                                        marginLeft="5px"
                                                        noOfLines={1}
                                                    >
                                                        {i18n(lang, "aboutRemaining", false, ["__TIME__"], [(remainingReadable.days > 0 ? remainingReadable.days + "d " : "") + (remainingReadable.hours > 0 ? remainingReadable.hours + "h " : "") + (remainingReadable.minutes > 0 ? remainingReadable.minutes + "m " : "")])}
                                                    </Text>
                                                )
                                            })()
                                        }
                                    </>
                                )
                            }
                        </Flex>
                    )
                }
            </Flex>
        )
    }
}