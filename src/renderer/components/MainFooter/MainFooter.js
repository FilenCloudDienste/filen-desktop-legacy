import React from "react"
import { Flex, Text, Spinner } from "@chakra-ui/react"
import { getTimeRemaining } from "../../lib/helpers"
import { AiOutlineCheckCircle, AiOutlinePauseCircle } from "react-icons/ai"
import colors from "../../styles/colors"
import isEqual from "react-fast-compare"
import { i18n } from "../../lib/i18n"

export default class MainFooter extends React.Component {
    shouldComponentUpdate(nextProps){
        return !isEqual(nextProps, this.props)
    }

    render(){
        const { userId, email, platform, darkMode, lang, currentUploads, currentDownloads, paused, runningTasks, totalRemaining, runningSyncTasks } = this.props

        return (
            <Flex
                flexDirection="row" 
                justifyContent="space-between" 
                paddingTop="8px" 
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
                                    {i18n(lang, (runningTasks.length + Object.keys(currentUploads).length + Object.keys(currentDownloads).length) == 1 ? "syncingItemsFooterSingular" : "syncingItemsFooterPlural", true, ["__COUNT__"], [(runningTasks.length + Object.keys(currentUploads).length + Object.keys(currentDownloads).length)])}
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
                </Flex>
                <Flex 
                    alignItems="center" 
                    overflow="hidden"
                >
                    {
                        paused ? (
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
            </Flex>
        )
    }
}