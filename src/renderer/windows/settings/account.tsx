import React, { memo, useState, useEffect } from "react"
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
	Box,
	Spinner,
	Avatar,
	Progress
} from "@chakra-ui/react"
import { i18n } from "../../lib/i18n"
import ipc from "../../lib/ipc"
import db from "../../lib/db"
import colors from "../../styles/colors"
import { GoIssueReopened } from "react-icons/go"
import { userInfo as getUserInfo } from "../../lib/api"
import { formatBytes } from "../../lib/helpers"
import useSyncIssues from "../../lib/hooks/useSyncIssues"

const log = window.require("electron-log")
const { shell } = window.require("electron")

export const logout = async () => {
	try {
		await Promise.all([
			db.remove("apiKey"),
			db.remove("email"),
			db.remove("userId"),
			db.remove("masterKeys"),
			db.remove("authVersion"),
			db.remove("isLoggedIn"),
			db.remove("privateKey"),
			db.remove("publicKey")
		])

		ipc.exitApp().catch(log.error)
	} catch (e) {
		log.error(e)
	}
}

const SettingsWindowAccount = memo(
	({ darkMode, lang, platform, email }: { darkMode: boolean; lang: string; platform: string; email: string }) => {
		const [logoutAlertOpen, setLogoutAlertOpen] = useState<boolean>(false)
		const [userInfo, setUserInfo] = useState<any>(undefined)

		useEffect(() => {
			db.get("apiKey")
				.then(apiKey => {
					getUserInfo({ apiKey })
						.then(info => {
							setUserInfo(info)
						})
						.catch(log.error)
				})
				.catch(log.error)
		}, [])

		return (
			<>
				{typeof userInfo == "object" ? (
					<>
						<Flex
							width="100%"
							height="100%"
							flexDirection="column"
						>
							<Flex
								width="80%"
								height="auto"
								margin="0px auto"
								marginTop="50px"
							>
								<Flex
									justifyContent="space-between"
									alignItems="center"
									width="100%"
									height="auto"
								>
									<Flex
										justifyContent="center"
										alignItems="center"
									>
										<Avatar
											name={
												typeof userInfo.avatarURL == "string" && userInfo.avatarURL.indexOf("https://") !== -1
													? undefined
													: email
											}
											src={
												typeof userInfo.avatarURL == "string" && userInfo.avatarURL.indexOf("https://") !== -1
													? userInfo.avatarURL
													: undefined
											}
										/>
										<Flex flexDirection="column">
											<Text
												color={colors(platform, darkMode, "textPrimary")}
												fontWeight="bold"
												marginLeft="8px"
												fontSize={18}
											>
												{email}
											</Text>
											<Text
												color={colors(platform, darkMode, "textPrimary")}
												fontSize={12}
												marginLeft="8px"
											>
												{i18n(
													lang,
													"accountStorageUsed",
													true,
													["__PERCENT__", "__MAX__"],
													[
														(userInfo.storageUsed / userInfo.maxStorage) * 100 >= 100
															? "100"
															: ((userInfo.storageUsed / userInfo.maxStorage) * 100).toFixed(2),
														formatBytes(userInfo.maxStorage)
													]
												)}
											</Text>
										</Flex>
									</Flex>
									<Flex
										justifyContent="center"
										alignItems="center"
									>
										<Link
											color={colors(platform, darkMode, "link")}
											textDecoration="none"
											_hover={{ textDecoration: "none" }}
											onClick={() => logout()}
										>
											{i18n(lang, "logout")}
										</Link>
									</Flex>
								</Flex>
							</Flex>
							<Flex
								padding="25px"
								backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
								borderRadius="15px"
								width="80%"
								height="auto"
								margin="0px auto"
								marginTop="35px"
								flexDirection="column"
							>
								<Flex
									justifyContent="space-between"
									alignItems="center"
									width="100%"
									height="auto"
								>
									<Flex
										justifyContent="center"
										alignItems="center"
									>
										<Flex flexDirection="column">
											<Text
												color={colors(platform, darkMode, "textPrimary")}
												fontSize={12}
											>
												{i18n(lang, "accountCurrentPlan")}
											</Text>
											<Text
												color={colors(platform, darkMode, "textPrimary")}
												fontWeight="bold"
												fontSize={20}
											>
												{formatBytes(userInfo.maxStorage)}
											</Text>
										</Flex>
									</Flex>
									<Flex
										justifyContent="center"
										alignItems="center"
									>
										<Link
											color={colors(platform, darkMode, "link")}
											textDecoration="none"
											_hover={{ textDecoration: "none" }}
											onClick={() => shell.openExternal("https://filen.io/pro")}
										>
											{i18n(lang, "accountUpgrade")}
										</Link>
									</Flex>
								</Flex>
								<Flex
									width="100%"
									height="auto"
									marginTop="10px"
								>
									<Progress
										value={
											(userInfo.storageUsed / userInfo.maxStorage) * 100 >= 100
												? 100
												: parseFloat(((userInfo.storageUsed / userInfo.maxStorage) * 100).toFixed(2))
										}
										color="blue.100"
										min={0}
										max={100}
										width="100%"
										height="6px"
										borderRadius="15px"
									/>
								</Flex>
								<Flex
									justifyContent="space-between"
									alignItems="center"
									width="100%"
									height="auto"
									marginTop="3px"
								>
									<Text
										color={colors(platform, darkMode, "textPrimary")}
										fontSize={11}
										fontWeight="bold"
									>
										{i18n(
											lang,
											"storageUsed",
											false,
											["__USED__", "__MAX__"],
											[formatBytes(userInfo.storageUsed), formatBytes(userInfo.maxStorage)]
										)}
									</Text>
									<Text
										color={colors(platform, darkMode, "textPrimary")}
										fontSize={11}
									>
										{i18n(
											lang,
											"accountStorageInUse",
											false,
											["__PERCENT__"],
											[
												(userInfo.storageUsed / userInfo.maxStorage) * 100 >= 100
													? "100"
													: ((userInfo.storageUsed / userInfo.maxStorage) * 100).toFixed(2)
											]
										)}
									</Text>
								</Flex>
							</Flex>
						</Flex>
						<Modal
							onClose={() => setLogoutAlertOpen(false)}
							isOpen={logoutAlertOpen}
							isCentered={true}
						>
							<ModalOverlay borderRadius="10px" />
							<ModalContent
								backgroundColor={colors(platform, darkMode, "backgroundPrimary")}
								borderRadius="15px"
							>
								<ModalCloseButton
									color={colors(platform, darkMode, "textPrimary")}
									_hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }}
								/>
								<ModalHeader color={colors(platform, darkMode, "textPrimary")}>{i18n(lang, "logout")}</ModalHeader>
								<ModalBody>
									<Text color={colors(platform, darkMode, "textSecondary")}>{i18n(lang, "confirmLogout")}</Text>
								</ModalBody>
								<ModalFooter>
									<Link
										color={colors(platform, darkMode, "link")}
										textDecoration="none"
										_hover={{ textDecoration: "none" }}
										onClick={() => logout()}
									>
										{i18n(lang, "logout")}
									</Link>
								</ModalFooter>
							</ModalContent>
						</Modal>
					</>
				) : (
					<Flex
						flexDirection="column"
						width="100%"
						height="400px"
						alignItems="center"
						justifyContent="center"
					>
						<Flex>
							<Spinner color={colors(platform, darkMode, "textPrimary")} />
						</Flex>
					</Flex>
				)}
			</>
		)
	}
)

const SettingsWindowIssues = memo(({ darkMode, lang, platform }: { darkMode: boolean; lang: string; platform: string }) => {
	const syncIssues = useSyncIssues()
	const [clearIssuesModalOpen, setClearIssuesModalOpen] = useState(false)

	return (
		<>
			<Flex
				width="100%"
				height="100%"
				flexDirection="column"
				justifyContent="center"
				alignItems="center"
			>
				{syncIssues.length > 0 ? (
					<>
						<Box
							width="80%"
							height="380px"
							backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
							overflowY="scroll"
							overflowX="hidden"
							display="inline-block"
							borderRadius="15px"
							marginTop="45px"
						>
							{syncIssues.map((issue, index) => {
								return (
									<Flex
										key={index}
										paddingLeft="10px"
										paddingRight="10px"
										paddingTop="3px"
										paddingBottom="5px"
										flexDirection="row"
										borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
									>
										<Flex
											flexDirection="row"
											paddingTop="4px"
										>
											<Text
												color={colors(platform, darkMode, "textPrimary")}
												fontSize={13}
												marginLeft="10px"
												width="100%"
												wordBreak="break-all"
											>
												{issue.info}
											</Text>
										</Flex>
									</Flex>
								)
							})}
						</Box>
						<Link
							color={colors(platform, darkMode, "link")}
							textDecoration="none"
							_hover={{ textDecoration: "none" }}
							marginTop="15px"
							onClick={() => setClearIssuesModalOpen(true)}
						>
							{i18n(lang, "resumeSyncing")}
						</Link>
					</>
				) : (
					<Flex
						flexDirection="column"
						width="100%"
						height="400px"
						alignItems="center"
						justifyContent="center"
					>
						<Flex>
							<GoIssueReopened
								size={50}
								color={darkMode ? "gray" : "gray"}
							/>
						</Flex>
						<Flex marginTop="15px">
							<Text color={darkMode ? "gray" : "gray"}>{i18n(lang, "noSyncIssues")}</Text>
						</Flex>
					</Flex>
				)}
			</Flex>
			<Modal
				onClose={() => setClearIssuesModalOpen(false)}
				isOpen={clearIssuesModalOpen}
				isCentered={true}
			>
				<ModalOverlay borderRadius="10px" />
				<ModalContent
					backgroundColor={colors(platform, darkMode, "backgroundPrimary")}
					borderRadius="15px"
				>
					<ModalCloseButton
						color={colors(platform, darkMode, "textPrimary")}
						_hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }}
					/>
					<ModalHeader color={colors(platform, darkMode, "textPrimary")}>{i18n(lang, "clearSyncIssues")}</ModalHeader>
					<ModalBody>
						<Text
							color={colors(platform, darkMode, "textSecondary")}
							fontSize={14}
						>
							{i18n(lang, "clearSyncIssuesInfo")}
						</Text>
					</ModalBody>
					<ModalFooter alignItems="center">
						<Link
							color={colors(platform, darkMode, "link")}
							textDecoration="none"
							_hover={{ textDecoration: "none" }}
							onClick={async () => {
								try {
									await ipc.clearSyncIssues()

									ipc.emitGlobal("global-message", {
										type: "forceSync"
									}).catch(log.error)
								} catch (e) {
									log.error(e)
								}

								setClearIssuesModalOpen(false)
							}}
						>
							{i18n(lang, "clear")}
						</Link>
					</ModalFooter>
				</ModalContent>
			</Modal>
		</>
	)
})

export default SettingsWindowAccount
