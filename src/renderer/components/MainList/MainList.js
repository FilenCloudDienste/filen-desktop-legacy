import React from "react"
import { Flex, Text, Link } from "@chakra-ui/react"
import { AiOutlineSync } from "react-icons/ai"
import ipc from "../../lib/ipc"
import colors from "../../styles/colors"
import Item from "../Item"
import { List } from "react-virtualized"
import isEqual from "react-fast-compare"
import { i18n } from "../../lib/i18n"

export default class MainList extends React.Component {
    shouldComponentUpdate(nextProps){
        return !isEqual(nextProps, this.props)
    }

    render(){
        const { userId, email, platform, darkMode, lang, activity, paused, syncLocations } = this.props

        return (
            <>
                {
                    Array.isArray(syncLocations) && syncLocations.length > 0 ? (
                        <Flex
                            height="450px"
                            width={window.innerWidth}
                            padding="0px"
                            flexDirection="column"
                            borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
                        >
                            {
                                activity.length > 0 ? (
                                    <List
                                        height={450}
                                        width={window.innerWidth - 2}
                                        noRowsRenderer={() => <></>}
                                        overscanRowCount={8}
                                        rowCount={activity.length}
                                        rowHeight={47}
                                        estimatedRowSize={activity.length * 47}
                                        rowRenderer={({ index, key, style }) => {
                                            const task = activity[index]

                                            return <Item key={key + ":" + JSON.stringify(task)} task={task} style={style} userId={userId} platform={platform} darkMode={darkMode} paused={paused} />
                                        }}
                                    />
                                ) : (
                                    <Flex
                                        justifyContent="center"
                                        alignItems="center"
                                        height="100%"
                                        width="100%"
                                        flexDirection="column"
                                    >
                                        <Flex>
                                            <AiOutlineSync
                                                size={50}
                                                color={darkMode ? "gray" : "gray"} 
                                            />
                                        </Flex>
                                        <Flex marginTop="10px">
                                            <Text
                                                color={darkMode ? "gray" : "gray"}
                                                fontSize={12}
                                            >
                                                {i18n(lang, "noSyncActivityYet")}
                                            </Text>
                                        </Flex>
                                    </Flex>
                                )
                            }
                        </Flex>
                    ) : (
                        <Flex
                            flexDirection="column"
                            width="100%"
                            height="450px"
                            alignItems="center"
                            justifyContent="center" 
                            borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
                        >
                            <Flex>
                                <AiOutlineSync
                                    size={50}
                                    color={darkMode ? "gray" : "gray"}
                                />
                            </Flex>
                            <Flex marginTop="15px">
                                <Text color={darkMode ? "gray" : "gray"}>
                                    {i18n(lang, "noSyncLocationsSetupYet")}
                                </Text>
                            </Flex>
                            <Flex marginTop="15px">
                                <Link
                                    color={colors(platform, darkMode, "link")}
                                    textDecoration="none"
                                    _hover={{
                                        textDecoration: "none"
                                    }}
                                    onClick={() => ipc.openSettingsWindow("syncs")}
                                >
                                    {i18n(lang, "createOne")}
                                </Link>
                            </Flex>
                        </Flex>
                    )
                }
            </>
        )
    }
}