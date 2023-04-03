import React, { memo } from "react"
import { createStandaloneToast, Box, Text } from "@chakra-ui/react"
import useDarkMode from "../../lib/hooks/useDarkMode"

export const showToast = ({
	title = "",
	description = "",
	message = "",
	status = "info",
	duration = 5000,
	isClosable = false
}: {
	title?: string
	description?: string
	message?: string
	status?: string
	duration?: number
	isClosable?: boolean
}) => {
	const { toast } = createStandaloneToast()

	toast({
		title,
		description: description.length > 0 ? description : message,
		duration,
		isClosable,
		render: () => (
			<Toast
				message={description.length > 0 ? description : message}
				status={status}
			/>
		)
	})
}

const Toast = memo(({ message, status }: { message: string; status: string }) => {
	const darkMode = useDarkMode()

	let backgroundColor = darkMode ? "#171717" : "lightgray"
	let textColor = "gray"

	if (status == "error") {
		backgroundColor = "#FF4539"
		textColor = "white"
	} else if (status == "warning") {
		backgroundColor = "#FF9F09"
		textColor = "white"
	} else if (status == "info") {
		backgroundColor = darkMode ? "#171717" : "lightgray"
		textColor = "gray"
	}

	return (
		<Box
			width="90vw"
			height="auto"
			padding="10px"
			backgroundColor={backgroundColor}
			margin="0px auto"
			borderRadius="10px"
			userSelect="none"
			textAlign="center"
		>
			<Text
				color={textColor}
				userSelect="none"
			>
				{message}
			</Text>
		</Box>
	)
})

export default Toast
