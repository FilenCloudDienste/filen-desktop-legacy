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
	Tooltip,
	useToast
} from "@chakra-ui/react"
import { i18n } from "../../lib/i18n"
import { HiOutlineCog, HiOutlineSave } from "react-icons/hi"
import { AiOutlineSync, AiOutlinePauseCircle, AiOutlineInfoCircle } from "react-icons/ai"
import useDb from "../../lib/hooks/useDb"
import ipc from "../../lib/ipc"
import * as fsLocal from "../../lib/fs/local"
import { v4 as uuidv4 } from "uuid"
import db from "../../lib/db"
import { IoChevronForwardOutline, IoChevronBackOutline } from "react-icons/io5"
import colors from "../../styles/colors"
import CodeMirror from "@uiw/react-codemirror"
import { createCodeMirrorTheme } from "../../styles/codeMirror"
import { isSubdir } from "../../lib/helpers"
// @ts-ignore
import List from "react-virtualized/dist/commonjs/List"
import { debounce } from "lodash"
import { Location } from "../../../types"
import eventListener from "../../lib/eventListener"

const log = window.require("electron-log")
const { shell } = window.require("electron")
const pathModule = window.require("path")

const SettingsWindowSyncs = memo(
	({ darkMode, lang, platform, userId }: { darkMode: boolean; lang: string; platform: string; userId: number }) => {
		const syncLocations: Location[] = useDb("syncLocations:" + userId, [])
		const toast = useToast()
		const [syncSettingsModalOpen, setSyncSettingsModalOpen] = useState<boolean>(false)
		const [currentSyncLocation, setCurrentSyncLocation] = useState<Location | undefined>(undefined)
		const [confirmDeleteModalOpen, setConfirmDeleteModalOpen] = useState<boolean>(false)
		const [ignoredFilesModalOpen, setIgnoredFilesModalOpen] = useState<boolean>(false)
		const [currentSyncLocationIgnored, setCurrentSyncLocationIgnored] = useState<string>("")
		const [isDeletingSyncLocation, setIsDeletingSyncLocation] = useState<boolean>(false)

		const createNewSyncLocation = () => {
			db.get("syncLocations:" + userId)
				.then((currentSyncLocations: Location[] | null) => {
					ipc.selectFolder()
						.then(result => {
							if (result.canceled) {
								return
							}

							const paths = result.filePaths

							if (!Array.isArray(paths)) {
								return
							}

							if (typeof paths[0] !== "string") {
								return
							}

							const localPath = pathModule.normalize(paths[0])

							if (["/", "c:", "c:/", "c://", "c:\\", "c:\\\\"].includes(localPath.toLowerCase())) {
								return toast({
									title: i18n(lang, "cannotCreateSyncLocation"),
									description: i18n(lang, "cannotCreateSyncLocationSubdir"),
									status: "error",
									duration: 10000,
									isClosable: true,
									position: "bottom",
									containerStyle: {
										backgroundColor: "rgba(255, 69, 58, 1)",
										maxWidth: "85%",
										height: "auto",
										fontSize: 14,
										borderRadius: "15px"
									}
								})
							}

							if (Array.isArray(currentSyncLocations) && currentSyncLocations.length > 0) {
								let found = false

								for (let i = 0; i < currentSyncLocations.length; i++) {
									if (typeof currentSyncLocations[i].local == "string") {
										if (
											currentSyncLocations[i].local == localPath ||
											isSubdir(currentSyncLocations[i].local, localPath) ||
											isSubdir(localPath, currentSyncLocations[i].local)
										) {
											found = true
										}
									}
								}

								if (found) {
									toast({
										title: i18n(lang, "cannotCreateSyncLocation"),
										description: i18n(lang, "cannotCreateSyncLocationLoop"),
										status: "error",
										duration: 10000,
										isClosable: true,
										position: "bottom",
										containerStyle: {
											backgroundColor: "rgba(255, 69, 58, 1)",
											maxWidth: "85%",
											height: "auto",
											fontSize: 14,
											borderRadius: "15px"
										}
									})

									return
								}
							}

							fsLocal
								.smokeTest(localPath)
								.then(async () => {
									const uuid: string = uuidv4()
									let created: boolean = false

									try {
										let currentSyncLocations: Location[] | null = await db.get("syncLocations:" + userId)

										if (!Array.isArray(currentSyncLocations)) {
											currentSyncLocations = []
										}

										if (currentSyncLocations.filter(location => location.local == localPath).length == 0) {
											currentSyncLocations.push({
												uuid,
												local: localPath,
												remote: undefined,
												remoteUUID: undefined,
												remoteName: undefined,
												type: "twoWay",
												paused: true,
												busy: false,
												localChanged: false
											})

											created = true
										}

										await db.set("syncLocations:" + userId, currentSyncLocations)

										if (created) {
											toast({
												description: i18n(lang, "syncLocationCreated"),
												status: "success",
												duration: 7500,
												isClosable: true,
												position: "bottom",
												containerStyle: {
													backgroundColor: "#0ac09d",
													maxWidth: "85%",
													height: "auto",
													fontSize: 14,
													borderRadius: "15px"
												}
											})

											ipc.emitGlobal("global-message", {
												type: "forceSync"
											}).catch(log.error)

											setTimeout(() => {
												ipc.emitGlobal("global-message", {
													type: "forceSync"
												}).catch(log.error)
											}, 15000)
										}
									} catch (e) {
										log.error(e)
									}
								})
								.catch(err => {
									log.error(err)

									toast({
										title: i18n(lang, "cannotCreateSyncLocation"),
										description: i18n(lang, "cannotCreateSyncLocationAccess"),
										status: "error",
										duration: 10000,
										isClosable: true,
										position: "bottom",
										containerStyle: {
											backgroundColor: "rgba(255, 69, 58, 1)",
											maxWidth: "85%",
											height: "auto",
											fontSize: 14,
											borderRadius: "15px"
										}
									})
								})
						})
						.catch(err => {
							log.error(err)
						})
				})
				.catch(err => {
					log.error(err)
				})
		}

		const debounceFilenIgnore = useCallback(
			debounce((value, uuid) => {
				db.set("filenIgnore:" + uuid, value).catch(log.error)
			}, 1000),
			[]
		)

		const toggleSyncPauseStatus = useCallback(
			async (location: Location, paused: boolean) => {
				try {
					let currentSyncLocations: Location[] = await db.get("syncLocations:" + userId)

					if (!Array.isArray(currentSyncLocations)) {
						currentSyncLocations = []
					}

					for (let i = 0; i < currentSyncLocations.length; i++) {
						if (currentSyncLocations[i].uuid == location.uuid) {
							currentSyncLocations[i].paused = paused
						}
					}

					await db.set("syncLocations:" + userId, currentSyncLocations)

					ipc.emitGlobal("global-message", {
						type: "forceSync"
					}).catch(log.error)
				} catch (e) {
					log.error(e)
				}
			},
			[userId]
		)

		useEffect(() => {
			if (typeof currentSyncLocation !== "undefined") {
				for (let i = 0; i < syncLocations.length; i++) {
					if (syncLocations[i].uuid == currentSyncLocation.uuid) {
						setCurrentSyncLocation(syncLocations[i])
					}
				}
			}
		}, [syncLocations])

		useEffect(() => {
			if (typeof currentSyncLocation !== "undefined" && ignoredFilesModalOpen) {
				db.get("filenIgnore:" + currentSyncLocation.uuid)
					.then(filenIgnore => {
						if (typeof filenIgnore !== "string") {
							filenIgnore = ""
						}

						setCurrentSyncLocationIgnored(filenIgnore)
					})
					.catch(err => {
						log.error(err)
					})
			}
		}, [currentSyncLocation, ignoredFilesModalOpen])

		useEffect(() => {
			eventListener.emit("ignoredFilesModalOpen", ignoredFilesModalOpen)
		}, [ignoredFilesModalOpen])

		useEffect(() => {
			const closeIgnoredFilesModalOpenListener = eventListener.on("closeIgnoredFilesModalOpen", () => {
				setIgnoredFilesModalOpen(false)
				setTimeout(() => setSyncSettingsModalOpen(true), 100)
			})

			return () => {
				closeIgnoredFilesModalOpenListener.remove()
			}
		}, [])

		return (
			<>
				{syncLocations.length == 0 ? (
					<Flex
						flexDirection="column"
						width="100%"
						height="400px"
						alignItems="center"
						justifyContent="center"
					>
						<Flex>
							<AiOutlineSync
								size={50}
								color={darkMode ? "gray" : "gray"}
							/>
						</Flex>
						<Flex marginTop="15px">
							<Text color={darkMode ? "gray" : "gray"}>{i18n(lang, "noSyncLocationsSetupYet")}</Text>
						</Flex>
						<Flex marginTop="15px">
							<Link
								color={colors(platform, darkMode, "link")}
								textDecoration="none"
								_hover={{
									textDecoration: "none"
								}}
								onClick={() => createNewSyncLocation()}
							>
								{i18n(lang, "createOne")}
							</Link>
						</Flex>
					</Flex>
				) : (
					<Flex
						flexDirection="column"
						width="100vw"
						height="auto"
						alignItems="center"
						justifyContent="center"
						paddingTop="30px"
					>
						<List
							height={syncLocations.length * 55 >= 420 ? 420 : syncLocations.length * 55}
							width={window.innerWidth * 0.9}
							noRowsRenderer={() => <></>}
							overscanRowCount={8}
							rowCount={syncLocations.length}
							rowHeight={55}
							estimatedRowSize={syncLocations.length * 55}
							rowRenderer={({ index, key, style }: { index: number; key: string; style: React.CSSProperties }) => {
								const location = syncLocations[index]

								return (
									<Flex
										key={key}
										style={style}
										flexDirection="column"
										padding="5px"
										width="100%"
										height="100%"
									>
										<Flex
											width="100%"
											height="100%"
											flexDirection="row"
											backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
											paddingLeft="12px"
											paddingRight="12px"
											borderRadius="15px"
											borderBottom={"0px solid " + colors(platform, darkMode, "borderPrimary")}
										>
											<Flex
												width="45%"
												flexDirection="row"
												justifyContent="flex-start"
												alignItems="center"
											>
												<Tooltip
													label={
														<Text
															color={colors(platform, darkMode, "textPrimary")}
															fontSize={14}
														>
															{location.local}
														</Text>
													}
													placement="top"
													borderRadius="15px"
													backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
													shadow="none"
												>
													<Text
														noOfLines={1}
														color={colors(platform, darkMode, "textPrimary")}
														fontSize={15}
													>
														{location.local}
													</Text>
												</Tooltip>
											</Flex>
											<Flex
												width="10%"
												flexDirection="row"
												justifyContent="center"
												alignItems="center"
											>
												{location.paused ? (
													<AiOutlinePauseCircle
														color={colors(platform, darkMode, "textPrimary")}
														size={15}
														cursor="pointer"
														pointerEvents="all"
														onClick={() => toggleSyncPauseStatus(location, false)}
													/>
												) : (
													<>
														{location.type == "twoWay" && (
															<Flex
																alignItems="center"
																paddingTop="3px"
																cursor="pointer"
																pointerEvents="all"
																onClick={() => toggleSyncPauseStatus(location, true)}
															>
																<IoChevronBackOutline
																	color={colors(platform, darkMode, "textPrimary")}
																	size={15}
																/>
																<IoChevronForwardOutline
																	color={colors(platform, darkMode, "textPrimary")}
																	size={15}
																/>
															</Flex>
														)}
														{location.type == "localToCloud" && (
															<Flex
																alignItems="center"
																paddingTop="3px"
																cursor="pointer"
																pointerEvents="all"
																onClick={() => toggleSyncPauseStatus(location, true)}
															>
																<IoChevronForwardOutline
																	color={colors(platform, darkMode, "textPrimary")}
																	size={15}
																/>
															</Flex>
														)}
														{location.type == "cloudToLocal" && (
															<Flex
																alignItems="center"
																paddingTop="3px"
																cursor="pointer"
																pointerEvents="all"
																onClick={() => toggleSyncPauseStatus(location, true)}
															>
																<IoChevronBackOutline
																	color={colors(platform, darkMode, "textPrimary")}
																	size={15}
																/>
															</Flex>
														)}
														{location.type == "localBackup" && (
															<Flex
																alignItems="center"
																paddingTop="3px"
																cursor="pointer"
																pointerEvents="all"
																onClick={() => toggleSyncPauseStatus(location, true)}
															>
																<HiOutlineSave
																	color={colors(platform, darkMode, "textPrimary")}
																	size={15}
																/>
																<IoChevronForwardOutline
																	color={colors(platform, darkMode, "textPrimary")}
																	size={15}
																/>
															</Flex>
														)}
														{location.type == "cloudBackup" && (
															<Flex
																alignItems="center"
																paddingTop="3px"
																cursor="pointer"
																pointerEvents="all"
																onClick={() => toggleSyncPauseStatus(location, true)}
															>
																<IoChevronBackOutline
																	color={colors(platform, darkMode, "textPrimary")}
																	size={15}
																/>
																<HiOutlineSave
																	color={colors(platform, darkMode, "textPrimary")}
																	size={15}
																/>
															</Flex>
														)}
													</>
												)}
											</Flex>
											<Flex
												width="40%"
												flexDirection="row"
												justifyContent="flex-end"
												alignItems="center"
											>
												{typeof location.remote == "string" && location.remote.length > 0 ? (
													<Tooltip
														label={
															<Text
																color={colors(platform, darkMode, "textPrimary")}
																fontSize={14}
															>
																{location.remote}
															</Text>
														}
														placement="top"
														borderRadius="15px"
														backgroundColor={colors(platform, darkMode, "backgroundSecondary")}
														shadow="none"
													>
														<Text
															noOfLines={1}
															color={colors(platform, darkMode, "textPrimary")}
															fontSize={15}
														>
															{location.remote}
														</Text>
													</Tooltip>
												) : (
													<Link
														color={colors(platform, darkMode, "link")}
														textDecoration="none"
														_hover={{
															textDecoration: "none"
														}}
														fontSize={14}
														onClick={() => {
															db.get("syncLocations:" + userId)
																.then((currentSyncLocations: Location[] | null) => {
																	ipc.selectRemoteFolder()
																		.then(async result => {
																			if (result.canceled) {
																				return false
																			}

																			const { uuid, name, path } = result

																			if (
																				Array.isArray(currentSyncLocations) &&
																				currentSyncLocations.length > 0
																			) {
																				let found = false

																				for (let i = 0; i < currentSyncLocations.length; i++) {
																					if (typeof currentSyncLocations[i].remote == "string") {
																						if (
																							currentSyncLocations[i].remote == path ||
																							isSubdir(
																								currentSyncLocations[i].remote!,
																								path
																							) ||
																							isSubdir(path, currentSyncLocations[i].remote!)
																						) {
																							found = true
																						}
																					}
																				}

																				if (found) {
																					return toast({
																						title: i18n(lang, "cannotCreateSyncLocation"),
																						description: i18n(
																							lang,
																							"cannotCreateSyncLocationLoop2"
																						),
																						status: "error",
																						duration: 5000,
																						isClosable: true,
																						position: "bottom",
																						containerStyle: {
																							backgroundColor: "rgba(255, 69, 58, 1)",
																							maxWidth: "85%",
																							height: "auto",
																							fontSize: 14,
																							borderRadius: "15px"
																						}
																					})
																				}
																			}

																			try {
																				let currentSyncLocations: Location[] | null = await db.get(
																					"syncLocations:" + userId
																				)

																				if (!Array.isArray(currentSyncLocations)) {
																					currentSyncLocations = []
																				}

																				for (let i = 0; i < currentSyncLocations.length; i++) {
																					if (currentSyncLocations[i].uuid == location.uuid) {
																						currentSyncLocations[i].remoteUUID = uuid
																						currentSyncLocations[i].remote = path
																						currentSyncLocations[i].remoteName = name
																					}
																				}

																				await db.set(
																					"syncLocations:" + userId,
																					currentSyncLocations
																				)

																				toast({
																					description: i18n(lang, "syncLocationCreated"),
																					status: "success",
																					duration: 7500,
																					isClosable: true,
																					position: "bottom",
																					containerStyle: {
																						backgroundColor: "#0ac09d",
																						maxWidth: "85%",
																						height: "auto",
																						fontSize: 14,
																						borderRadius: "15px"
																					}
																				})
																			} catch (e) {
																				log.error(e)
																			}
																		})
																		.catch(err => {
																			console.log(err)
																		})
																})
																.catch(err => {
																	console.log(err)
																})
														}}
													>
														{i18n(lang, "selectRemoteLocation")}
													</Link>
												)}
											</Flex>
											<Flex
												width="5%"
												flexDirection="row"
												justifyContent="space-between"
												alignItems="center"
												paddingLeft="12px"
											>
												<HiOutlineCog
													color={colors(platform, darkMode, "textPrimary")}
													size={15}
													cursor="pointer"
													pointerEvents="all"
													style={{
														flexShrink: 0
													}}
													onClick={() => {
														setCurrentSyncLocation(location)
														setSyncSettingsModalOpen(true)
													}}
												/>
											</Flex>
										</Flex>
									</Flex>
								)
							}}
						/>
						<Link
							color={colors(platform, darkMode, "link")}
							marginTop="10px"
							textDecoration="none"
							_hover={{
								textDecoration: "none"
							}}
							onClick={() => createNewSyncLocation()}
						>
							{i18n(lang, "createOne")}
						</Link>
					</Flex>
				)}
				<Modal
					onClose={() => setSyncSettingsModalOpen(false)}
					isOpen={syncSettingsModalOpen}
					isCentered={true}
				>
					<ModalOverlay borderRadius="10px" />
					<ModalContent
						backgroundColor={colors(platform, darkMode, "backgroundPrimary")}
						borderRadius="15px"
					>
						<ModalHeader color={colors(platform, darkMode, "textPrimary")}>{i18n(lang, "settings")}</ModalHeader>
						<ModalCloseButton
							color={colors(platform, darkMode, "textPrimary")}
							_focus={{ _focus: "none" }}
							_hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }}
						/>
						<ModalBody>
							{typeof currentSyncLocation !== "undefined" && (
								<>
									<Flex
										width="100%"
										height="auto"
										justifyContent="space-between"
										alignItems="center"
									>
										<Flex alignItems="center">
											<Text
												color={colors(platform, darkMode, "textPrimary")}
												fontSize={14}
											>
												{i18n(lang, "syncMode")}
											</Text>
											<Tooltip
												label={
													<Flex flexDirection="column">
														<Text
															color={colors(platform, darkMode, "textPrimary")}
															fontWeight="bold"
														>
															{i18n(lang, "syncModeTwoWay")}
														</Text>
														<Text
															color={colors(platform, darkMode, "textPrimary")}
															fontSize={11}
														>
															{i18n(lang, "syncModeTwoWayInfo")}
														</Text>
														<Text
															color={colors(platform, darkMode, "textPrimary")}
															fontWeight="bold"
															marginTop="10px"
														>
															{i18n(lang, "syncModeLocalToCloud")}
														</Text>
														<Text
															color={colors(platform, darkMode, "textPrimary")}
															fontSize={11}
														>
															{i18n(lang, "syncModeLocalToCloudInfo")}
														</Text>
														<Text
															color={colors(platform, darkMode, "textPrimary")}
															fontWeight="bold"
															marginTop="10px"
														>
															{i18n(lang, "syncModeCloudToLocal")}
														</Text>
														<Text
															color={colors(platform, darkMode, "textPrimary")}
															fontSize={11}
														>
															{i18n(lang, "syncModeCloudToLocalInfo")}
														</Text>
														<Text
															color={colors(platform, darkMode, "textPrimary")}
															fontWeight="bold"
															marginTop="10px"
														>
															{i18n(lang, "syncModeLocalBackup")}
														</Text>
														<Text
															color={colors(platform, darkMode, "textPrimary")}
															fontSize={11}
														>
															{i18n(lang, "syncModeLocalBackupInfo")}
														</Text>
														<Text
															color={colors(platform, darkMode, "textPrimary")}
															fontWeight="bold"
															marginTop="10px"
														>
															{i18n(lang, "syncModeCloudBackup")}
														</Text>
														<Text
															color={colors(platform, darkMode, "textPrimary")}
															fontSize={11}
														>
															{i18n(lang, "syncModeCloudBackupInfo")}
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
														size={18}
														color={colors(platform, darkMode, "textPrimary")}
													/>
												</Flex>
											</Tooltip>
										</Flex>
										<Flex alignItems="center">
											<Select
												value={currentSyncLocation.type}
												color={colors(platform, darkMode, "textPrimary")}
												fontSize={14}
												height="30px"
												borderColor={colors(platform, darkMode, "borderPrimary")}
												_focus={{ outline: "none" }}
												outline="none"
												_active={{ outline: "none" }}
												onChange={async (e: any) => {
													const type = e.nativeEvent.target.value

													try {
														let currentSyncLocations: Location[] | null = await db.get(
															"syncLocations:" + userId
														)

														if (!Array.isArray(currentSyncLocations)) {
															currentSyncLocations = []
														}

														for (let i = 0; i < currentSyncLocations.length; i++) {
															if (currentSyncLocations[i].uuid == currentSyncLocation.uuid) {
																currentSyncLocations[i].type = type
															}
														}

														await db.set("syncLocations:" + userId, currentSyncLocations)

														ipc.emitGlobal("global-message", {
															type: "forceSync"
														}).catch(log.error)
													} catch (e) {
														log.error(e)
													}
												}}
											>
												<option
													value="twoWay"
													style={{
														backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
														height: "30px",
														borderRadius: "10px"
													}}
												>
													{i18n(lang, "syncModeTwoWay")}
												</option>
												<option
													value="localToCloud"
													style={{
														backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
														height: "30px",
														borderRadius: "10px"
													}}
												>
													{i18n(lang, "syncModeLocalToCloud")}
												</option>
												<option
													value="cloudToLocal"
													style={{
														backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
														height: "30px",
														borderRadius: "10px"
													}}
												>
													{i18n(lang, "syncModeCloudToLocal")}
												</option>
												<option
													value="localBackup"
													style={{
														backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
														height: "30px",
														borderRadius: "10px"
													}}
												>
													{i18n(lang, "syncModeLocalBackup")}
												</option>
												<option
													value="cloudBackup"
													style={{
														backgroundColor: colors(platform, darkMode, "backgroundSecondary"),
														height: "30px",
														borderRadius: "10px"
													}}
												>
													{i18n(lang, "syncModeCloudBackup")}
												</option>
											</Select>
										</Flex>
									</Flex>
									{typeof currentSyncLocation.remote === "string" && (
										<Flex
											width="100%"
											height="auto"
											justifyContent="space-between"
											alignItems="center"
											marginTop="10px"
										>
											<Flex alignItems="center">
												<Text
													color={colors(platform, darkMode, "textPrimary")}
													fontSize={14}
												>
													{i18n(lang, "selectiveSync")}
												</Text>
												<Tooltip
													label={
														<Flex flexDirection="column">
															<Text color={colors(platform, darkMode, "textPrimary")}>
																{i18n(lang, "selectiveSyncTooltip")}
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
															size={18}
															color={colors(platform, darkMode, "textPrimary")}
														/>
													</Flex>
												</Tooltip>
											</Flex>
											<Flex>
												<Link
													color={colors(platform, darkMode, "link")}
													textDecoration="none"
													_hover={{ textDecoration: "none" }}
													onClick={() => {
														setSyncSettingsModalOpen(false)

														ipc.openSelectiveSyncWindow(currentSyncLocation).catch(log.error)
													}}
												>
													{i18n(lang, "configure")}
												</Link>
											</Flex>
										</Flex>
									)}
									<Flex
										width="100%"
										height="auto"
										justifyContent="space-between"
										alignItems="center"
										marginTop="10px"
									>
										<Flex alignItems="center">
											<Text
												color={colors(platform, darkMode, "textPrimary")}
												fontSize={14}
											>
												.filenignore
											</Text>
											<Tooltip
												label={
													<Flex flexDirection="column">
														<Text color={colors(platform, darkMode, "textPrimary")}>
															{i18n(lang, "filenignoreTooltip")}
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
														size={18}
														color={colors(platform, darkMode, "textPrimary")}
													/>
												</Flex>
											</Tooltip>
										</Flex>
										<Flex>
											<Link
												color={colors(platform, darkMode, "link")}
												textDecoration="none"
												_hover={{ textDecoration: "none" }}
												onClick={() => {
													setSyncSettingsModalOpen(false)
													setTimeout(() => setIgnoredFilesModalOpen(true), 100)
												}}
											>
												{i18n(lang, "edit")}
											</Link>
										</Flex>
									</Flex>
									<Flex
										width="100%"
										height="auto"
										justifyContent="space-between"
										alignItems="center"
										marginTop="10px"
									>
										<Text
											color={colors(platform, darkMode, "textPrimary")}
											fontSize={14}
										>
											{i18n(lang, "paused")}
										</Text>
										<Flex>
											<Switch
												isChecked={currentSyncLocation.paused}
												_focus={{ outline: "none" }}
												outline="none"
												_active={{ outline: "none" }}
												onChange={async (event: any) => {
													const paused = event.nativeEvent.target.checked

													try {
														let currentSyncLocations: Location[] = await db.get("syncLocations:" + userId)

														if (!Array.isArray(currentSyncLocations)) {
															currentSyncLocations = []
														}

														for (let i = 0; i < currentSyncLocations.length; i++) {
															if (currentSyncLocations[i].uuid == currentSyncLocation.uuid) {
																currentSyncLocations[i].paused = paused
															}
														}

														await db.set("syncLocations:" + userId, currentSyncLocations)

														ipc.emitGlobal("global-message", {
															type: "forceSync"
														}).catch(log.error)
													} catch (e) {
														log.error(e)
													}
												}}
											/>
										</Flex>
									</Flex>
									{typeof currentSyncLocation !== "undefined" && typeof currentSyncLocation.remoteUUID == "string" && (
										<>
											<Flex
												width="100%"
												height="auto"
												justifyContent="space-between"
												alignItems="center"
												marginTop="25px"
											>
												<Link
													color={colors(platform, darkMode, "link")}
													textDecoration="none"
													_hover={{ textDecoration: "none" }}
													fontSize={13}
													onClick={async () =>
														shell.openPath(await fsLocal.realPath(currentSyncLocation.local)).catch(log.error)
													}
													marginRight="15px"
												>
													{i18n(lang, "openLocalFolder")}
												</Link>
											</Flex>
											<Flex
												width="100%"
												height="auto"
												justifyContent="space-between"
												alignItems="center"
												marginTop="10px"
											>
												<Link
													color={colors(platform, darkMode, "link")}
													textDecoration="none"
													_hover={{ textDecoration: "none" }}
													fontSize={13}
													onClick={async () =>
														shell
															.openPath(
																await fsLocal.realPath(currentSyncLocation.local + "/.filen.trash.local")
															)
															.catch(log.error)
													}
													marginRight="15px"
												>
													{i18n(lang, "openLocalTrash")}
												</Link>
											</Flex>
										</>
									)}
									{typeof currentSyncLocation !== "undefined" && !currentSyncLocation.busy && (
										<Flex
											width="100%"
											height="auto"
											justifyContent="space-between"
											alignItems="center"
											marginTop="25px"
										>
											<Link
												color={colors(platform, darkMode, "danger")}
												textDecoration="none"
												_hover={{ textDecoration: "none" }}
												fontSize={11}
												onClick={() => {
													setSyncSettingsModalOpen(false)
													setTimeout(() => setConfirmDeleteModalOpen(true), 250)
												}}
												marginRight="15px"
											>
												{i18n(lang, "deleteSyncLocation")}
											</Link>
										</Flex>
									)}
								</>
							)}
						</ModalBody>
						<ModalFooter>
							<Link
								color={colors(platform, darkMode, "link")}
								textDecoration="none"
								_hover={{ textDecoration: "none" }}
								onClick={() => setSyncSettingsModalOpen(false)}
							>
								{i18n(lang, "close")}
							</Link>
						</ModalFooter>
					</ModalContent>
				</Modal>
				<Modal
					onClose={() => setConfirmDeleteModalOpen(false)}
					isOpen={confirmDeleteModalOpen}
					isCentered={true}
				>
					<ModalOverlay borderRadius="10px" />
					<ModalContent
						backgroundColor={colors(platform, darkMode, "backgroundPrimary")}
						borderRadius="15px"
					>
						<ModalHeader color={colors(platform, darkMode, "textPrimary")}>{i18n(lang, "settings")}</ModalHeader>
						<ModalCloseButton
							color={colors(platform, darkMode, "textPrimary")}
							_hover={{ backgroundColor: colors(platform, darkMode, "backgroundSecondary") }}
							disabled={isDeletingSyncLocation}
						/>
						<ModalBody>
							{isDeletingSyncLocation ? (
								<Flex
									width="100%"
									height="100%"
									justifyContent="center"
									alignItems="center"
								>
									<Spinner
										width="32px"
										height="32px"
										color={colors(platform, darkMode, "textPrimary")}
									/>
								</Flex>
							) : (
								<Text
									color={colors(platform, darkMode, "textSecondary")}
									fontSize={14}
								>
									{i18n(lang, "confirmDeleteSyncLocation")}
								</Text>
							)}
						</ModalBody>
						<ModalFooter>
							<Link
								color={isDeletingSyncLocation ? "gray" : colors(platform, darkMode, "danger")}
								textDecoration="none"
								_hover={{ textDecoration: "none" }}
								onClick={async () => {
									if (isDeletingSyncLocation) {
										return false
									}

									if (typeof currentSyncLocation == "undefined") {
										return setConfirmDeleteModalOpen(false)
									}

									setIsDeletingSyncLocation(true)

									try {
										let currentSyncLocations: Location[] | null = await db.get("syncLocations:" + userId)

										if (!Array.isArray(currentSyncLocations)) {
											currentSyncLocations = []
										}

										for (let i = 0; i < currentSyncLocations.length; i++) {
											if (currentSyncLocations[i].uuid == currentSyncLocation.uuid) {
												currentSyncLocations.splice(i, 1)
											}
										}

										await db.set("syncLocations:" + userId, currentSyncLocations)
									} catch (e) {
										log.error(e)
									}

									setIsDeletingSyncLocation(false)
									setConfirmDeleteModalOpen(false)
								}}
							>
								{i18n(lang, "delete")}
							</Link>
						</ModalFooter>
					</ModalContent>
				</Modal>
				<Modal
					onClose={() => {
						setIgnoredFilesModalOpen(false)
						setTimeout(() => setSyncSettingsModalOpen(true), 100)
					}}
					isOpen={ignoredFilesModalOpen}
					size="full"
				>
					<ModalOverlay borderRadius="10px" />
					<ModalContent
						backgroundColor={colors(platform, darkMode, "backgroundPrimary")}
						borderRadius="10px"
					>
						<ModalBody padding="0px">
							<Flex
								width="100%"
								height={window.innerHeight}
								flexDirection="column"
							>
								<Flex
									marginTop="30px"
									width="100%"
									height="auto"
									borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
									justifyContent="center"
									alignItems="center"
								>
									<Text
										color={colors(platform, darkMode, "textPrimary")}
										fontSize={14}
										paddingBottom="5px"
										paddingTop="10px"
									>
										{i18n(lang, "filenignoreHeader")}
									</Text>
								</Flex>
								<CodeMirror
									value={currentSyncLocationIgnored}
									width="100%"
									height="480px"
									placeholder={"ignored/folder\nignoredFile.txt"}
									autoFocus={true}
									theme={createCodeMirrorTheme({ platform, darkMode })}
									onChange={async (value, _) => {
										if (typeof currentSyncLocation == "undefined") {
											return false
										}

										setCurrentSyncLocationIgnored(value)
										debounceFilenIgnore(value, currentSyncLocation.uuid)
									}}
								/>
							</Flex>
						</ModalBody>
						<ModalFooter
							position="absolute"
							bottom="0"
							right="0"
						>
							<Link
								color="gray"
								textDecoration="none"
								_hover={{ textDecoration: "none" }}
								onClick={() => {
									setIgnoredFilesModalOpen(false)
									setTimeout(() => setSyncSettingsModalOpen(true), 100)
								}}
							>
								{i18n(lang, "close")}
							</Link>
						</ModalFooter>
					</ModalContent>
				</Modal>
			</>
		)
	}
)

export default SettingsWindowSyncs
