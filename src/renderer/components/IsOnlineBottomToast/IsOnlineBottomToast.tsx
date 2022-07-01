import React, { memo } from "react"
import { Flex, Text } from "@chakra-ui/react"
import { BsWifiOff } from "react-icons/bs"
import useIsOnline from "../../lib/hooks/useIsOnline"
import { i18n } from "../../lib/i18n"

interface Props {
    userId: number,
    email: string,
    lang: string,
    darkMode: boolean,
    platform: string
}

const IsOnlineBottomToast = memo(({ userId, email, lang, darkMode, platform }: Props) => {
    const isOnline: boolean = useIsOnline()

    if(isOnline){
        return null
    }

    return (
        <Flex
            position="fixed"
            bottom="15px"
            width="100%"
            height="auto"
            paddingLeft="15px"
            paddingRight="15px"
        >
            <Flex
                width="100%"
                height="auto"
                padding="5px"
                paddingLeft="10px"
                paddingRight="10px"
                borderRadius="15px"
                backgroundColor="rgba(255, 69, 58, 1)"
                alignItems="center"
            >
                <BsWifiOff
                    size={16}
                    color="white"
                />
                <Text
                    color="white"
                    marginLeft="7px"
                    fontSize={15}
                >
                    {i18n(lang, "youAreOffline")}
                </Text>
            </Flex>
        </Flex>
    )
})

export default IsOnlineBottomToast