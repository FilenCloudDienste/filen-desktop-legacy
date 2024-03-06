import React, { memo, useState, useEffect, useCallback } from "react"
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
	Switch,
	Spinner,
	Select,
	Tooltip
} from "@chakra-ui/react"
import { i18n } from "../../lib/i18n"
import ipc from "../../lib/ipc"
import * as fsLocal from "../../lib/fs/local"
import db from "../../lib/db"
import colors from "../../styles/colors"
import { formatBytes } from "../../lib/helpers"
import { sendToAllPorts } from "../../lib/worker/ipc"
import { Location } from "../../../types"

const log = window.require("electron-log")

const SettingsWindowGeneral = memo(({ darkMode, lang, platform }: { darkMode: boolean; lang: string; platform: string }) => {
	const [openAtStartupAsync, setOpenAtStartupAsync] = useState<boolean | undefined>(undefined)
	const [appVersionAsync, setAppVersionAsync] = useState<string | number | undefined>(undefined)
	const [openAtStartup, setOpenAtStartup] = useState<boolean>(true)
	const [appVersion, setAppVersion] = useState<string | number | undefined>("1")
	const [excludeDot, setExcludeDot] = useState<boolean>(true)
	const [clearLocalEventLogModalOpen, setClearLocalEventLogModalOpen] = useState<boolean>(false)
	const [clearLocalTrashDirsModalOpen, setClearLocalTrashDirsModalOpen] = useState<boolean>(false)
	const [localTrashDirsSize, setLocalTrashDirsSize] = useState<number>(0)
	const [clearingLocalTrashDirs, setClearingLocalTrashDirs] = useState<boolean>(false)

	const getOpenAtStartup = useCallback(() => {
		ipc.getOpenOnStartup()
			.then(open => {
				setOpenAtStartupAsync(open)
				setOpenAtStartup(open)
			})
			.catch(log.error)
	}, [])

	const getAppVersion = useCallback(() => {
		ipc.getVersion()
			.then(version => {
				setAppVersionAsync(version)
				setAppVersion(version)
			})
			.catch(log.error)
	}, [])

	const getExcludeDot = useCallback(() => {
		db.get("excludeDot")
			.then(exclude => {
				if (exclude == null) {
					setExcludeDot(true)

					return
				}

				setExcludeDot(exclude)
			})
			.catch(log.error)
	}, [])

	const getLocalTrashDirsSize = useCallback(() => {
		setLocalTrashDirsSize(0)

		db.get("userId")
			.then((userId: number | null) => {
				if (!userId || !Number.isInteger(userId)) {
					return
				}

				db.get("syncLocations:" + userId)
					.then((syncLocations: Location[] | null) => {
						if (!syncLocations || !Array.isArray(syncLocations)) {
							return
						}

						for (let i = 0; i < syncLocations.length; i++) {
							db.get("localTrashDirSize:" + syncLocations[i].uuid)
								.then((size: number | null) => {
									if (!size || !Number.isInteger(size)) {
										return
									}

									setLocalTrashDirsSize(prev => prev + size)
								})
								.catch(log.error)
						}
					})
					.catch(log.error)
			})
			.catch(log.error)
	}, [])

	const populate = useCallback(() => {
		getOpenAtStartup()
		getAppVersion()
		getExcludeDot()
		getLocalTrashDirsSize()
	}, [])

	useEffect(() => {
		if (typeof openAtStartupAsync !== "undefined") {
			setOpenAtStartup(openAtStartupAsync)
		}

		if (typeof appVersionAsync !== "undefined") {
			setAppVersion(appVersionAsync)
		}
	}, [openAtStartupAsync, appVersionAsync])

	useEffect(() => {
		populate()

		fsLocal.clearLocalTrashDirs().catch(log.error)

		const updateLocalTrashDirsSizeInterval = setInterval(getLocalTrashDirsSize, 5000)

		return () => {
			clearInterval(updateLocalTrashDirsSizeInterval)
		}
	}, [])

	return (
		<>
			<Flex
				width="100%"
				height="100%"
				flexDirection="column"
			>
				{platform !== "linux" && (
					<Flex
						flexDirection="row"
						justifyContent="space-between"
						alignItems="center"
						width="80%"
						margin="0px auto"
						marginTop="50px"
						paddingBottom="5px"
						borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
					>
						<Flex>
							<Text
								color={colors(platform, darkMode, "textPrimary")}
								fontSize={15}
								fontWeight="400 !important"
							>
								{i18n(lang, "launchAtSystemStartup")}
							</Text>
						</Flex>
						<Flex>
							<Switch
								isChecked={openAtStartup}
								_focus={{ outline: "none" }}
								outline="none"
								_active={{ outline: "none" }}
								onChange={() => {
									const value = !openAtStartup

									setOpenAtStartup(value)

									ipc.setOpenOnStartup(value).catch(err => {
										log.error()

										setOpenAtStartup(!value)
									})
								}}
							/>
						</Flex>
					</Flex>
				)}
				<Flex
					flexDirection="row"
					justifyContent="space-between"
					alignItems="center"
					width="80%"
					margin="0px auto"
					marginTop={platform == "linux" ? "50px" : "10px"}
					paddingBottom="5px"
					borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
				>
					<Flex>
						<Text
							color={colors(platform, darkMode, "textPrimary")}
							fontSize={15}
							fontWeight="400 !important"
						>
							{i18n(lang, "darkMode")}
						</Text>
					</Flex>
					<Flex>
						<Switch
							isChecked={darkMode}
							_focus={{ outline: "none" }}
							outline="none"
							_active={{ outline: "none" }}
							onChange={() => {
								db.set("userSelectedTheme", darkMode ? "light" : "dark").catch(log.error)
							}}
						/>
					</Flex>
				</Flex>
				<Flex
					flexDirection="row"
					justifyContent="space-between"
					alignItems="center"
					width="80%"
					margin="0px auto"
					marginTop="10px"
					paddingBottom="5px"
					borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
				>
					<Flex>
						<Tooltip
							label={
								<Text
									color={colors(platform, darkMode, "textSecondary")}
									fontSize={14}
									fontWeight="400 !important"
								>
									{i18n(lang, "excludeDotTooltip")}
								</Text>
							}
							placement="top-end"
							borderRadius="10px"
							backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
							border={"1px solid " + colors(platform, darkMode, "borderPrimary")}
							shadow="none"
							padding="10px"
						>
							<Text
								color={colors(platform, darkMode, "textPrimary")}
								fontSize={15}
								fontWeight="400 !important"
							>
								{i18n(lang, "excludeDot")}
							</Text>
						</Tooltip>
					</Flex>
					<Flex>
						<Switch
							isChecked={excludeDot}
							_focus={{ outline: "none" }}
							outline="none"
							_active={{ outline: "none" }}
							onChange={() => {
								const newVal = !excludeDot

								db.set("excludeDot", newVal)
									.then(() => {
										setExcludeDot(newVal)
									})
									.catch(log.error)
							}}
						/>
					</Flex>
				</Flex>
				<Flex
					flexDirection="row"
					justifyContent="space-between"
					alignItems="center"
					width="80%"
					margin="0px auto"
					marginTop="10px"
					paddingBottom="8px"
					borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
				>
					<Flex>
						<Text
							color={colors(platform, darkMode, "textPrimary")}
							fontSize={15}
							fontWeight="400 !important"
						>
							{i18n(lang, "language")}
						</Text>
					</Flex>
					<Flex>
						<Select
							value={lang}
							color={colors(platform, darkMode, "textPrimary")}
							fontSize={14}
							height="30px"
							borderColor={colors(platform, darkMode, "borderPrimary")}
							shadow="none"
							cursor="pointer"
							_focus={{
								outline: "none",
								shadow: "none",
								borderColor: colors(platform, darkMode, "borderSecondary")
							}}
							outline="none"
							_active={{
								outline: "none",
								shadow: "none",
								borderColor: colors(platform, darkMode, "borderSecondary")
							}}
							_expanded={{
								outline: "none",
								shadow: "none",
								borderColor: colors(platform, darkMode, "borderSecondary")
							}}
							_highlighted={{
								outline: "none",
								shadow: "none",
								borderColor: colors(platform, darkMode, "borderSecondary")
							}}
							_hover={{
								outline: "none",
								shadow: "none",
								borderColor: colors(platform, darkMode, "borderSecondary")
							}}
							_selected={{
								outline: "none",
								shadow: "none",
								borderColor: colors(platform, darkMode, "borderSecondary")
							}}
							_pressed={{
								outline: "none",
								shadow: "none",
								borderColor: colors(platform, darkMode, "borderSecondary")
							}}
							onChange={(e: any) => {
								Promise.all([db.set("lang", e.nativeEvent.target.value), db.set("langSetManually", true)]).catch(log.error)
							}}
						>
							<option
								value="en"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								English
							</option>
							<option
								value="de"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								Deutsch
							</option>
							<option
								value="nl"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								Nederlands
							</option>
							<option
								value="fr"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								Français
							</option>
							<option
								value="ru"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								Русский
							</option>
							<option
								value="uk"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								Українська
							</option>
							<option
								value="pl"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								Polski
							</option>
							<option
								value="zh"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								中文
							</option>
							<option
								value="ja"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								日本語
							</option>
							<option
								value="da"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								Dansk
							</option>
							<option
								value="fi"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								Suomalainen
							</option>
							<option
								value="es"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								Español
							</option>
							<option
								value="el"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								Ελληνικά
							</option>
							<option
								value="it"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								Italiano
							</option>
							<option
								value="tr"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								Türk
							</option>
							<option
								value="sv"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								Svenska
							</option>
							<option
								value="ko"
								style={{
									backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
									height: "30px",
									borderRadius: "10px"
								}}
							>
								한국어
							</option>
						</Select>
					</Flex>
				</Flex>
				<Flex
					flexDirection="row"
					justifyContent="space-between"
					alignItems="center"
					width="80%"
					margin="0px auto"
					marginTop="10px"
					paddingBottom="5px"
					borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
				>
					<Flex>
						<Text
							color={colors(platform, darkMode, "textPrimary")}
							fontSize={15}
							fontWeight="400 !important"
						>
							{i18n(lang, "clearLocalEventLog")}
						</Text>
					</Flex>
					<Flex>
						<Link
							color={colors(platform, darkMode, "linkPrimary")}
							fontSize={14}
							textDecoration="none"
							_hover={{
								textDecoration: "underline"
							}}
							onClick={() => setClearLocalEventLogModalOpen(true)}
						>
							{i18n(lang, "clear")}
						</Link>
					</Flex>
				</Flex>
				<Flex
					flexDirection="row"
					justifyContent="space-between"
					alignItems="center"
					width="80%"
					margin="0px auto"
					marginTop="10px"
					paddingBottom="5px"
					borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
				>
					<Flex>
						<Text
							color={colors(platform, darkMode, "textPrimary")}
							fontSize={15}
							fontWeight="400 !important"
						>
							{i18n(lang, "clearLocalTrashDirs")}
						</Text>
					</Flex>
					<Flex
						gap="10px"
						flexDirection="row"
						alignItems="center"
					>
						<Text
							color={colors(platform, darkMode, "textSecondary")}
							fontSize={localTrashDirsSize > 0 ? 12 : 15}
						>
							{formatBytes(localTrashDirsSize)}
						</Text>
						{localTrashDirsSize > 0 && (
							<Link
								color={colors(platform, darkMode, "linkPrimary")}
								fontSize={14}
								textDecoration="none"
								_hover={{
									textDecoration: "underline"
								}}
								onClick={() => setClearLocalTrashDirsModalOpen(true)}
							>
								{i18n(lang, "clear")}
							</Link>
						)}
					</Flex>
				</Flex>
				<Flex
					width="100%"
					height="auto"
					bottom="50px"
					position="fixed"
				>
					<Flex
						flexDirection="row"
						justifyContent="space-between"
						alignItems="center"
						width="80%"
						margin="0px auto"
						paddingTop="5px"
						paddingBottom="5px"
						borderTop={"1px solid " + colors(platform, darkMode, "borderPrimary")}
					>
						<Flex>
							<Text
								color={colors(platform, darkMode, "textSecondary")}
								fontSize={11}
								fontWeight="400 !important"
							>
								v{appVersion} - JupiterPi v0.0.1
							</Text>
						</Flex>
						<Flex>
							<Link
								color={colors(platform, darkMode, "linkPrimary")}
								fontSize={11}
								fontWeight="400 !important"
								textDecoration="none"
								_hover={{
									textDecoration: "underline"
								}}
								onClick={() => ipc.saveLogs().then(log.info).catch(log.error)}
							>
								{i18n(lang, "saveLogs")}
							</Link>
						</Flex>
					</Flex>
				</Flex>
			</Flex>
			<Modal
				onClose={() => setClearLocalEventLogModalOpen(false)}
				isOpen={clearLocalEventLogModalOpen}
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
					<ModalHeader color={colors(platform, darkMode, "textPrimary")}>{i18n(lang, "clearLocalEventLog")}</ModalHeader>
					<ModalBody>
						<Flex
							width="100%"
							height="100px"
							justifyContent="center"
							alignItems="center"
						>
							<Text
								color={colors(platform, darkMode, "textSecondary")}
								fontSize={15}
							>
								{i18n(lang, "clearLocalEventLogInfo")}
							</Text>
						</Flex>
					</ModalBody>
					<ModalFooter>
						<Link
							color="red.500"
							textDecoration="none"
							_hover={{ textDecoration: "none" }}
							onClick={() => {
								db.get("userId")
									.then(userId => {
										db.set("doneTasks:" + userId, [])
											.then(() => {
												setClearLocalEventLogModalOpen(false)

												sendToAllPorts({
													type: "doneTasksCleared",
													data: {}
												})
											})
											.catch(log.error)
									})
									.catch(log.error)
							}}
						>
							{i18n(lang, "clear")}
						</Link>
					</ModalFooter>
				</ModalContent>
			</Modal>
			<Modal
				onClose={() => setClearLocalTrashDirsModalOpen(false)}
				isOpen={clearLocalTrashDirsModalOpen}
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
					<ModalHeader color={colors(platform, darkMode, "textPrimary")}>{i18n(lang, "clearLocalTrashDirs")}</ModalHeader>
					<ModalBody>
						<Flex
							width="100%"
							height="100px"
							justifyContent="center"
							alignItems="center"
						>
							<Text
								color={colors(platform, darkMode, "textSecondary")}
								fontSize={15}
							>
								{i18n(lang, "clearLocalTrashDirsInfo")}
							</Text>
						</Flex>
					</ModalBody>
					<ModalFooter>
						<Flex
							flexDirection="row"
							alignItems="center"
						>
							<Link
								color="red.500"
								textDecoration="none"
								_hover={{ textDecoration: "none" }}
								cursor={clearingLocalTrashDirs ? "not-allowed" : "pointer"}
								onClick={() => {
									if (clearingLocalTrashDirs) {
										return
									}

									setClearingLocalTrashDirs(true)

									fsLocal
										.clearLocalTrashDirs(true)
										.then(() => {
											setClearLocalTrashDirsModalOpen(false)
											setLocalTrashDirsSize(0)
											setClearingLocalTrashDirs(false)
										})
										.catch(err => {
											log.error(err)

											setClearLocalTrashDirsModalOpen(false)
											setClearingLocalTrashDirs(false)
										})
								}}
							>
								{clearingLocalTrashDirs ? (
									<Spinner
										width="15px"
										height="15px"
										color={colors(platform, darkMode, "textSecondary")}
									/>
								) : (
									i18n(lang, "clear")
								)}
							</Link>
						</Flex>
					</ModalFooter>
				</ModalContent>
			</Modal>
		</>
	)
})

export default SettingsWindowGeneral
