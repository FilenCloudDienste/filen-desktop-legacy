import { memo, useMemo } from "react"
import { Flex, Text, Spinner } from "@chakra-ui/react"
import { getTimeRemaining } from "../../lib/helpers"
import { AiOutlineCheckCircle, AiOutlinePauseCircle } from "react-icons/ai"
import colors from "../../styles/colors"
import { i18n } from "../../lib/i18n"
import useDb from "../../lib/hooks/useDb"

export interface MainFooterProps {
    platform: string,
    darkMode: boolean,
    lang: string,
    totalRemaining: any,
    syncTasksToDo: number,
    isOnline: boolean,
    acquiringLock: boolean,
    checkingChanges: boolean
}

const MainFooter = memo(({ platform, darkMode, lang, totalRemaining, syncTasksToDo, isOnline, acquiringLock, checkingChanges }: MainFooterProps) => {
    const paused = useDb("paused", false)

    const remainingReadable = useMemo(() => {
        totalRemaining = (totalRemaining + Math.floor(syncTasksToDo / 2))

        return getTimeRemaining((new Date().getTime() + (totalRemaining * 1000)))
    }, [totalRemaining, syncTasksToDo])

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
                    ) : checkingChanges && syncTasksToDo <= 0 ? (
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
                                syncTasksToDo > 0 ? (
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
                                                    if(syncTasksToDo == 1){
                                                        return i18n(lang, "syncingItemsFooterSingular", true, ["__COUNT__"], ["1"])
                                                    }
                                                    
                                                    return i18n(lang, "syncingItemsFooterPlural", true, ["__COUNT__"], [syncTasksToDo.toString()])
                                                })()
                                            }
                                        </Text>
                                    </Flex>
                                ) : syncTasksToDo > 0 ? (
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
                                        syncTasksToDo > 0 && (() => {
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
})

export default MainFooter