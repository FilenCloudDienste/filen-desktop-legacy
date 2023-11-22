import React, { memo, useEffect, useState } from "react"
import { Flex, Text, Link, Modal, ModalOverlay, ModalContent, ModalCloseButton, ModalBody } from "@chakra-ui/react"
import { i18n } from "../../lib/i18n"
import colors from "../../styles/colors"
import { MdOutlineSdStorage } from "react-icons/md"
import useDb from "../../lib/hooks/useDb"

const log = window.require("electron-log")
const { shell } = window.require("electron")

const MaxStorageModal = memo(({ lang, darkMode, platform }: { lang: string; darkMode: boolean; platform: string }) => {
	const [showModal, setShowModal] = useState<boolean>(false)
	const maxStorageReached: boolean = useDb("maxStorageReached", false)

	useEffect(() => {
		setShowModal(maxStorageReached)
	}, [maxStorageReached])

	return (
		<Modal
			onClose={() => setShowModal(false)}
			isOpen={showModal}
			size="full"
		>
			<ModalOverlay borderRadius="10px" />
			<ModalContent
				backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
				borderRadius="10px"
				border={"1px solid " + colors(platform, darkMode, "borderPrimary")}
			>
				<ModalCloseButton
					color={colors(platform, darkMode, "textPrimary")}
					_hover={{
						backgroundColor: colors(platform, darkMode, "backgroundSecondary")
					}}
				/>
				<ModalBody overflow="hidden">
					<Flex
						width="100%"
						height="500px"
						justifyContent="center"
						alignItems="center"
						overflow="hidden"
						flexDirection="column"
						textAlign="center"
					>
						<MdOutlineSdStorage
							fontSize={72}
							color={colors(platform, darkMode, "textPrimary")}
						/>
						<Text
							color={colors(platform, darkMode, "textSecondary")}
							marginTop="15px"
						>
							{i18n(lang, "maxStorageReached")}
						</Text>
						<Link
							color={colors(platform, darkMode, "linkPrimary")}
							fontSize={16}
							textDecoration="none"
							_hover={{
								textDecoration: "none"
							}}
							marginTop="40px"
							onClick={() => shell.openExternal("https://filen.io/pro").catch(log.error)}
						>
							{i18n(lang, "accountUpgrade")}
						</Link>
					</Flex>
				</ModalBody>
			</ModalContent>
		</Modal>
	)
})

export default MaxStorageModal
