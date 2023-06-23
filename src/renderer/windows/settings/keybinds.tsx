import React, { memo, useState, useEffect, useRef } from "react"
import {
	Flex,
	Text,
	Link,
	Modal,
	ModalOverlay,
	ModalContent,
	ModalHeader,
	ModalCloseButton,
	ModalBody,
	ModalFooter,
	Kbd
} from "@chakra-ui/react"
import { i18n } from "../../lib/i18n"
import useDb from "../../lib/hooks/useDb"
import ipc from "../../lib/ipc"
import db from "../../lib/db"
import colors from "../../styles/colors"

const log = window.require("electron-log")

const SettingsWindowKeybinds = memo(({ darkMode, lang, platform }: { darkMode: boolean; lang: string; platform: string }) => {
	const defaultKeybinds = useRef([
		{
			type: "uploadFolders",
			keybind: null
		},
		{
			type: "uploadFiles",
			keybind: null
		},
		/*{
            type: "download",
            keybind: null
        },*/
		{
			type: "openSettings",
			keybind: null
		},
		{
			type: "pauseSync",
			keybind: null
		},
		{
			type: "resumeSync",
			keybind: null
		},
		{
			type: "openWebsite",
			keybind: null
		}
	]).current

	const [changeKeybindModalOpen, setChangeKeybindModalOpen] = useState<boolean>(false)
	const [currentKeybind, setCurrentKeybind] = useState<string>("")
	const [keybindToChange, setKeybindToChange] = useState<string>("")
	const keybinds: any[] = useDb("keybinds", defaultKeybinds)

	const keydownListener = (e: any) => {
		if (typeof e.key == "string" && e.key.length > 0) {
			setCurrentKeybind(
				(e.ctrlKey && e.key.toLowerCase() !== "control" ? "CommandOrControl+" : "") +
					(e.shiftKey && e.key.toLowerCase() !== "shift" ? "Shift+" : "") +
					(e.metaKey && e.key.toLowerCase() !== "meta" ? "Meta+" : "") +
					(e.altKey && e.key.toLowerCase() !== "alt" ? "Alt+" : "") +
					e.key.toUpperCase()
			)
		}
	}

	useEffect(() => {
		if (changeKeybindModalOpen) {
			ipc.disableKeybinds().catch(log.error)
		} else {
			ipc.updateKeybinds().catch(log.error)
		}
	}, [changeKeybindModalOpen])

	useEffect(() => {
		document.addEventListener("keydown", keydownListener)

		return () => {
			document.removeEventListener("keydown", keydownListener)
		}
	}, [])

	return (
		<>
			<Flex
				width="80%"
				height="auto"
				flexDirection="column"
				margin="0px auto"
				marginTop="50px"
			>
				{keybinds.map((keybind, index) => {
					return (
						<Flex
							key={index}
							width="100%"
							height="35px"
							backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
							borderRadius="10px"
							flexDirection="row"
							alignItems="center"
							justifyContent="space-between"
							paddingLeft="10px"
							paddingRight="10px"
							marginTop={index > 0 ? "8px" : "0px"}
							border="1px solid transparent"
							_hover={{
								borderColor: colors(platform, darkMode, "borderPrimary")
							}}
							onClick={() => {
								setKeybindToChange(keybind.type)
								setCurrentKeybind("")
								setChangeKeybindModalOpen(true)
							}}
							cursor="pointer"
						>
							<Flex
								alignItems="center"
								justifyContent="center"
							>
								<Text
									fontSize={14}
									color={colors(platform, darkMode, "textPrimary")}
									fontWeight="400 !important"
								>
									{i18n(lang, "keybinds_" + keybind.type)}
								</Text>
								{/*<Tooltip 
                                        label={
                                            <Flex flexDirection="column">
                                                <Text color={colors(platform, darkMode, "textPrimary")}>
                                                    Exclude paths and patterns from syncing. Works just like a .gitignore file
                                                </Text>
                                            </Flex>
                                        }
                                        placement="right"
                                        borderRadius="15px"
                                        backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
                                        shadow="none"
                                    >
                                        <Flex marginLeft="5px">
                                            <AiOutlineInfoCircle
                                                size={14} 
                                                color={colors(platform, darkMode, "textPrimary")} 
                                            />
                                        </Flex>
                                    </Tooltip>*/}
							</Flex>
							<Flex
								alignItems="center"
								justifyContent="center"
							>
								<Text
									fontSize={14}
									color={colors(platform, darkMode, "textSecondary")}
								>
									<Kbd
										backgroundColor={colors(platform, darkMode, "backgroundPrimary")}
										color={colors(platform, darkMode, "textSecondary")}
										borderColor={colors(platform, darkMode, "backgroundPrimary")}
									>
										{keybind.keybind == null ? i18n(lang, "keybindNotBound") : keybind.keybind}
									</Kbd>
								</Text>
								<Link
									color={colors(platform, darkMode, "linkPrimary")}
									fontSize={14}
									textDecoration="none"
									marginLeft="10px"
									_hover={{
										textDecoration: "underline"
									}}
									onClick={() => {
										setKeybindToChange(keybind.type)
										setCurrentKeybind("")
										setChangeKeybindModalOpen(true)
									}}
								>
									{i18n(lang, "change")}
								</Link>
							</Flex>
						</Flex>
					)
				})}
				<Link
					color={colors(platform, darkMode, "linkPrimary")}
					textDecoration="none"
					_hover={{ textDecoration: "underline" }}
					margin="0px auto"
					marginTop="25px"
					onClick={() => db.set("keybinds", defaultKeybinds).catch(log.error)}
				>
					{i18n(lang, "resetToDefaults")}
				</Link>
			</Flex>
			<Modal
				onClose={() => setChangeKeybindModalOpen(false)}
				isOpen={changeKeybindModalOpen}
				isCentered={true}
			>
				<ModalOverlay borderRadius="10px" />
				<ModalContent
					backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
					borderRadius="10px"
					border={"1px solid " + colors(platform, darkMode, "borderPrimary")}
				>
					<ModalCloseButton
						color={colors(platform, darkMode, "textPrimary")}
						_hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }}
					/>
					<ModalHeader color={colors(platform, darkMode, "textPrimary")}>{i18n(lang, "changeKeybind")}</ModalHeader>
					<ModalBody>
						<Flex
							width="100%"
							height="100px"
							justifyContent="center"
							alignItems="center"
						>
							{currentKeybind.length == 0 ? (
								<Text
									color={colors(platform, darkMode, "textPrimary")}
									fontSize={20}
								>
									{i18n(lang, "pressKeyOrCombo")}
								</Text>
							) : (
								<Kbd
									backgroundColor={colors(platform, darkMode, "backgroundPrimary")}
									color={colors(platform, darkMode, "textPrimary")}
									borderColor={colors(platform, darkMode, "backgroundPrimary")}
								>
									{currentKeybind}
								</Kbd>
							)}
						</Flex>
					</ModalBody>
					<ModalFooter>
						<Link
							color={colors(platform, darkMode, "linkPrimary")}
							textDecoration="none"
							_hover={{ textDecoration: "underline" }}
							onClick={() => {
								if (keybindToChange.length == 0 || currentKeybind.length == 0) {
									return setChangeKeybindModalOpen(false)
								}

								db.set(
									"keybinds",
									keybinds.map(item => (item.type == keybindToChange ? { ...item, keybind: currentKeybind } : item))
								)
									.then(() => {
										setKeybindToChange("")
										setCurrentKeybind("")
										setChangeKeybindModalOpen(false)
									})
									.catch(log.error)
							}}
						>
							{i18n(lang, "save")}
						</Link>
					</ModalFooter>
				</ModalContent>
			</Modal>
		</>
	)
})

export default SettingsWindowKeybinds
