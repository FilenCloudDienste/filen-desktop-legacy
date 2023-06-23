import React, { memo } from "react"
import { Flex } from "@chakra-ui/react"
import colors from "../../styles/colors"
import usePlatform from "../../lib/hooks/usePlatform"
import useDarkMode from "../../lib/hooks/useDarkMode"

export interface ContainerProps {
	children: React.ReactNode
}

export const Container = memo(({ children }: ContainerProps) => {
	const darkMode = useDarkMode()
	const platform = usePlatform()

	return (
		<Flex
			padding="1px"
			flexDirection="column"
			width={window.innerWidth}
			height={window.innerHeight}
		>
			<Flex
				backgroundColor={
					window.location.href.indexOf("main") !== -1
						? colors(platform, darkMode, "backgroundSecondary")
						: colors(platform, darkMode, "backgroundPrimary")
				}
				width={"100%"}
				height={"100%"}
				color={colors(platform, darkMode, "textPrimary")}
				borderBottomLeftRadius="10px"
				borderBottomRightRadius="10px"
				borderTopLeftRadius="10px"
				borderTopRightRadius="10px"
				border={"1px solid " + (darkMode ? "#393939" : "darkgray")}
				overflow="hidden"
				flexDirection="column"
			>
				{children}
			</Flex>
		</Flex>
	)
})

export default Container
