import React, { memo, useState, useEffect, useRef, useCallback } from "react"
import { Flex, Text, Progress, Spinner, Image, useToast } from "@chakra-ui/react"
import { bpsToReadable, timeSince } from "../../lib/helpers"
import colors from "../../styles/colors"
import { BsFileEarmark, BsFillFolderFill } from "react-icons/bs"
import { IoSearchOutline, IoArrowDown, IoArrowUp } from "react-icons/io5"
import { AiOutlinePauseCircle, AiOutlineLink } from "react-icons/ai"
import ipc from "../../lib/ipc"
import memoryCache from "../../lib/memoryCache"
import { i18n } from "../../lib/i18n"
import { itemPublicLinkInfo, enableItemPublicLink, filePresent, getFileMetadata } from "../../lib/api"
import { copyToClipboard } from "../../lib/helpers"
import { decryptFolderLinkKey } from "../../lib/crypto"
import db from "../../lib/db"
import { v4 as uuidv4 } from "uuid"
import { ItemProps } from "../../../types"
import { createLocalTrashDirs } from "../../lib/fs/local"
import useDarkMode from "../../lib/hooks/useDarkMode"
import useLang from "../../lib/hooks/useLang"

const pathModule = window.require("path")
const { shell } = window.require("electron")
const log = window.require("electron-log")

const PUBLIC_LINK_ALLOWED_TYPES: string[] = [
	"uploadToRemote",
	"renameInRemote",
	"moveInRemote",
	"downloadFromRemote",
	"moveInLocal",
	"renameInLocal"
]

/*
task.realtime !== "undefined" -> active upload/download
task.running !== "undefined" -> active move/rename/delete
task.done !== "undefined" -> done task
*/

const ItemTimeSince = memo(({ task, lang }: { task: any; lang: string }) => {
	const [itemTimeSince, setItemTimeSince] = useState<string>(
		timeSince(typeof task.timestamp == "number" ? task.timestamp : Date.now(), lang)
	)
	const timeSinceInterval = useRef<NodeJS.Timer>()

	const startTimeSinceInterval = useCallback(() => {
		clearInterval(timeSinceInterval.current)

		setItemTimeSince(timeSince(typeof task.timestamp == "number" ? task.timestamp : Date.now(), lang))

		timeSinceInterval.current = setInterval(() => {
			setItemTimeSince(timeSince(typeof task.timestamp == "number" ? task.timestamp : Date.now(), lang))
		}, 1000)
	}, [])

	useEffect(() => {
		startTimeSinceInterval()

		return () => {
			clearInterval(timeSinceInterval.current)
		}
	}, [])

	return <>{itemTimeSince}</>
})

const Item = memo(({ task, style, userId, platform, paused, isOnline }: ItemProps) => {
	const darkMode = useDarkMode()
	const lang = useLang()
	const itemName: string = useRef(pathModule.basename(task.task.path)).current
	const itemExt: string = useRef(itemName.indexOf(".") !== -1 ? pathModule.extname(itemName) : "").current
	const itemIconCacheKey: string = useRef("fileIconExt:" + itemExt).current
	const [hovering, setHovering] = useState<boolean>(false)
	const [itemIcon, setItemIcon] = useState<any>(
		task.task.type == "folder" ? "folder" : memoryCache.has(itemIconCacheKey) ? memoryCache.get(itemIconCacheKey) : undefined
	)
	const [creatingPublicLink, setCreatingPublicLink] = useState<boolean>(false)
	const [canCreatePublicLink, setCanCreatePublicLink] = useState<boolean>(true)
	const toast = useToast()
	const publicLinkInfo = useRef<any>(undefined)
	const publicLinkKey = useRef<string>("")
	const didCheckIfCanCreatePublicLinkOnHover = useRef<boolean>(false)

	const getFileIcon = useCallback(() => {
		if (task.task.type == "file" && typeof task.location !== "undefined" && typeof task.location.local !== "undefined") {
			if (memoryCache.has(itemIconCacheKey)) {
				setItemIcon(memoryCache.get(itemIconCacheKey))
			} else {
				ipc.getFileIconName(uuidv4() + itemName)
					.then(icon => {
						if (typeof icon == "string" && icon.indexOf("data:") !== -1) {
							memoryCache.set(itemIconCacheKey, icon)

							setItemIcon(icon)
						} else {
							setItemIcon(null)
						}
					})
					.catch(log.error)
			}
		}
	}, [task])

	const fetchPublicLinkInfo = useCallback(
		(uuid: string, type: "folder" | "file", waitUntilEnabled: boolean = false, waitUntilDisabled: boolean = false): Promise<any> => {
			return new Promise((resolve, reject) => {
				const req = () => {
					itemPublicLinkInfo(uuid, type)
						.then(async info => {
							const exists: boolean =
								type == "file"
									? typeof info.enabled == "boolean" && info.enabled
									: typeof info.exists == "boolean" && info.exists

							if (waitUntilEnabled && !exists) {
								return setTimeout(req, 250)
							}

							if (waitUntilDisabled && exists) {
								return setTimeout(req, 250)
							}

							if (type == "folder" && exists) {
								const masterKeys: string[] = await db.get("masterKeys")
								const keyDecrypted: string = await decryptFolderLinkKey(info.key, masterKeys)

								if (keyDecrypted.length == 0) {
									return reject(new Error("Could not decrypt link key"))
								}

								publicLinkKey.current = keyDecrypted
							}

							publicLinkInfo.current = info

							return resolve(info)
						})
						.catch(reject)
				}

				return req()
			})
		},
		[]
	)

	const copyPublicLink = useCallback(
		(uuid: string, type: "folder" | "file", info: any) => {
			if (type == "file") {
				getFileMetadata(uuid)
					.then(metadata => {
						copyToClipboard("https://drive.filen.io/d/" + info.uuid + "#" + metadata.key)
							.then(() => {
								toast({
									position: "bottom",
									title: i18n(lang, "copied"),
									description: i18n(lang, "publicLinkCopied"),
									status: "success",
									duration: 2500,
									containerStyle: {
										fontSize: 13,
										padding: 5
									}
								})

								setCreatingPublicLink(false)
							})
							.catch(err => {
								log.error(err)

								setCreatingPublicLink(false)
							})
					})
					.catch(err => {
						log.error(err)

						setCreatingPublicLink(false)
					})
			} else {
				copyToClipboard("https://drive.filen.io/f/" + info.uuid + "#" + publicLinkKey.current)
					.then(() => {
						toast({
							position: "bottom",
							title: i18n(lang, "copied"),
							description: i18n(lang, "publicLinkCopied"),
							status: "success",
							duration: 2500,
							containerStyle: {
								fontSize: 13,
								padding: 5
							}
						})

						setCreatingPublicLink(false)
					})
					.catch(err => {
						log.error(err)

						setCreatingPublicLink(false)
					})
			}
		},
		[task, lang]
	)

	const createPublicLink = useCallback((uuid: string, type: "folder" | "file") => {
		setCreatingPublicLink(true)

		filePresent(uuid)
			.then(present => {
				if (!present.present) {
					setCreatingPublicLink(false)
					setCanCreatePublicLink(false)

					return
				}

				if (present.versioned || present.trash) {
					setCreatingPublicLink(false)
					setCanCreatePublicLink(false)

					return
				}

				fetchPublicLinkInfo(uuid, type)
					.then(info => {
						const enabled: boolean =
							type == "file"
								? typeof info.enabled == "boolean" && info.enabled
								: typeof info.exists == "boolean" &&
								  info.exists &&
								  typeof publicLinkKey.current == "string" &&
								  publicLinkKey.current.length >= 32

						if (enabled) {
							copyPublicLink(uuid, type, info)

							return
						}

						enableItemPublicLink(uuid, type)
							.then(() => {
								fetchPublicLinkInfo(uuid, type, true)
									.then(info => {
										copyPublicLink(uuid, type, info)
									})
									.catch(err => {
										log.error(err)

										setCreatingPublicLink(false)
									})
							})
							.catch(err => {
								log.error(err)

								setCreatingPublicLink(false)
							})
					})
					.catch(err => {
						log.error(err)

						setCreatingPublicLink(false)
					})
			})
			.catch(err => {
				log.error(err)

				setCreatingPublicLink(false)
			})
	}, [])

	useEffect(() => {
		if (
			hovering &&
			!didCheckIfCanCreatePublicLinkOnHover.current &&
			PUBLIC_LINK_ALLOWED_TYPES.includes(task.type) &&
			typeof task.task.type == "string" &&
			task.task.type == "file"
		) {
			didCheckIfCanCreatePublicLinkOnHover.current = true

			setTimeout(() => {
				didCheckIfCanCreatePublicLinkOnHover.current = false
			}, 60000)

			filePresent(task.task.item.uuid)
				.then(present => {
					if (!present.present) {
						setCanCreatePublicLink(false)

						return
					}

					if (present.versioned || present.trash) {
						setCanCreatePublicLink(false)

						return
					}

					setCanCreatePublicLink(true)
				})
				.catch(err => {
					log.error(err)

					setCanCreatePublicLink(false)
				})
		}
	}, [hovering, task])

	useEffect(() => {
		getFileIcon()
	}, [])

	return (
		<Flex
			style={style}
			width={window.innerWidth}
			justifyContent="space-between"
			alignItems="center"
			borderBottom={"0px solid " + colors(platform, darkMode, "borderPrimary")}
			paddingLeft="10px"
			paddingRight="10px"
			paddingTop="5px"
			paddingBottom="5px"
			onMouseEnter={() => setHovering(true)}
			onMouseLeave={() => setHovering(false)}
		>
			<Flex
				width={typeof task.realtime == "undefined" ? "270px" : "250px"}
				height="100%"
				justifyContent="flex-start"
				alignItems="center"
				flexDirection="row"
			>
				<Flex width="14%">
					{itemIcon == "folder" ? (
						<Flex>
							<BsFillFolderFill
								size={25}
								color={platform == "mac" ? "#3ea0d5" : "#ffd04c"}
							/>
						</Flex>
					) : memoryCache.has(itemIconCacheKey) ? (
						<Flex>
							<Image
								src={memoryCache.get(itemIconCacheKey)}
								width="24px"
								height="24px"
							/>
						</Flex>
					) : typeof itemIcon == "string" ? (
						<Flex>
							<Image
								src={itemIcon}
								width="24px"
								height="24px"
							/>
						</Flex>
					) : itemIcon == null ? (
						<Flex>
							{task.task.type == "folder" ? (
								<BsFillFolderFill
									size={25}
									color={platform == "mac" ? "#3ea0d5" : "#ffd04c"}
								/>
							) : (
								<BsFileEarmark
									size={25}
									color={colors(platform, darkMode, "textPrimary")}
								/>
							)}
						</Flex>
					) : (
						<Flex>
							<Spinner
								width="24px"
								height="24px"
								color={colors(platform, darkMode, "textPrimary")}
							/>
						</Flex>
					)}
				</Flex>
				<Flex
					flexDirection="column"
					width={typeof task.realtime == "undefined" ? "95%" : "85%"}
				>
					<Text
						noOfLines={1}
						wordBreak="break-all"
						color={colors(platform, darkMode, "textPrimary")}
						fontSize={12}
						fontWeight="bold"
						maxWidth="100%"
						width="100%"
					>
						{itemName}
					</Text>
					<Flex alignItems="center">
						{typeof task.realtime !== "undefined" ? (
							<>
								{task.type == "uploadToRemote" && (
									<IoArrowUp
										size={11}
										color={colors(platform, darkMode, "textPrimary")}
										style={{
											marginRight: "5px",
											marginTop: "3px"
										}}
									/>
								)}
								{task.type == "downloadFromRemote" && (
									<IoArrowDown
										size={11}
										color={colors(platform, darkMode, "textPrimary")}
										style={{
											marginRight: "5px",
											marginTop: "3px"
										}}
									/>
								)}
								{paused || task.task.percent <= 0 || !isOnline ? (
									<Progress
										value={0}
										height="5px"
										borderRadius="10px"
										colorScheme="blue"
										min={0}
										max={100}
										marginTop="5px"
										width="100%"
									/>
								) : (
									<Progress
										value={task.task.percent > 100 ? 100 : parseFloat(task.task.percent.toFixed(2))}
										height="5px"
										borderRadius="10px"
										colorScheme="blue"
										min={0}
										max={100}
										marginTop="5px"
										width="100%"
									/>
								)}
							</>
						) : (
							<>
								{hovering && typeof task.task.path == "string" && typeof task.realtime == "undefined" ? (
									<Text
										noOfLines={1}
										wordBreak="break-all"
										color={colors(platform, darkMode, "textPrimary")}
										marginTop="1px"
										fontSize={11}
										maxWidth="100%"
										width="100%"
									>
										{pathModule.join(pathModule.basename(task.location.local), task.task.path)}
									</Text>
								) : (
									<Text
										noOfLines={1}
										wordBreak="break-all"
										color={colors(platform, darkMode, "textPrimary")}
										marginTop="1px"
										fontSize={11}
										maxWidth="100%"
										width="100%"
									>
										{task.type == "downloadFromRemote" && i18n(lang, "syncTaskDownloadFromRemote")}
										{task.type == "uploadToRemote" && i18n(lang, "syncTaskUploadToRemote")}
										{task.type == "renameInRemote" && i18n(lang, "syncTaskRenameInRemote")}
										{task.type == "renameInLocal" && i18n(lang, "syncTaskRenameInLocal")}
										{task.type == "moveInRemote" && i18n(lang, "syncTaskMoveInRemote")}
										{task.type == "moveInLocal" && i18n(lang, "syncTaskMoveInLocal")}
										{task.type == "deleteInRemote" && i18n(lang, "syncTaskDeleteInRemote")}
										{task.type == "deleteInLocal" && i18n(lang, "syncTaskDeleteInLocal")}
										&nbsp; &#8226; &nbsp;
										<ItemTimeSince
											task={task}
											lang={lang}
										/>
									</Text>
								)}
							</>
						)}
					</Flex>
				</Flex>
			</Flex>
			<Flex
				width={typeof task.realtime == "undefined" ? "65px" : "65px"}
				justifyContent="flex-end"
				flexDirection="row"
			>
				<Flex
					flexDirection="column"
					justifyContent="center"
				>
					{typeof task.realtime !== "undefined" || typeof task.running !== "undefined" ? (
						<Flex
							alignItems="center"
							justifyContent="flex-end"
							flexDirection="row"
						>
							{typeof task.realtime !== "undefined" ? (
								<>
									{paused || !isOnline ? (
										<AiOutlinePauseCircle
											color={colors(platform, darkMode, "textPrimary")}
											fontSize={18}
										/>
									) : task.task.percent <= 0 ? (
										<Text
											noOfLines={1}
											color={colors(platform, darkMode, "textPrimary")}
											fontSize={12}
											wordBreak="break-all"
										>
											{i18n(lang, "queued")}
										</Text>
									) : task.task.percent >= 99 ? (
										<Spinner
											width="16px"
											height="16px"
											color={colors(platform, darkMode, "textPrimary")}
										/>
									) : (
										<Text
											noOfLines={1}
											color={colors(platform, darkMode, "textPrimary")}
											fontSize={12}
											wordBreak="break-all"
										>
											{bpsToReadable(task.task.lastBps)}
										</Text>
									)}
								</>
							) : (
								<Spinner
									width="16px"
									height="16px"
									color={colors(platform, darkMode, "textPrimary")}
								/>
							)}
						</Flex>
					) : (
						<>
							{hovering &&
							[
								"renameInLocal",
								"downloadFromRemote",
								"moveInLocal",
								"uploadToRemote",
								"renameInRemote",
								"moveInRemote",
								"deleteInLocal"
							].includes(task.type) ? (
								<Flex
									alignItems="center"
									justifyContent="flex-end"
									flexDirection="row"
								>
									{PUBLIC_LINK_ALLOWED_TYPES.includes(task.type) &&
										typeof task.task.type == "string" &&
										task.task.type == "file" &&
										canCreatePublicLink && (
											<>
												{creatingPublicLink ? (
													<Spinner
														width="14px"
														height="14px"
														marginRight="10px"
														color={colors(platform, darkMode, "textPrimary")}
													/>
												) : (
													<AiOutlineLink
														size={18}
														color={colors(platform, darkMode, "textPrimary")}
														cursor="pointer"
														style={{
															marginRight: "10px"
														}}
														onClick={() => createPublicLink(task.task.item.uuid, "file")}
													/>
												)}
											</>
										)}
									<IoSearchOutline
										size={18}
										color={colors(platform, darkMode, "textPrimary")}
										cursor="pointer"
										onClick={() => {
											if (task.type == "deleteInLocal") {
												createLocalTrashDirs()
													.then(() => {
														shell
															.openPath(
																pathModule.normalize(
																	pathModule.join(task.location.local, ".filen.trash.local")
																)
															)
															.catch(log.error)
													})
													.catch(log.error)
											} else {
												try {
													shell.showItemInFolder(
														pathModule.normalize(pathModule.join(task.location.local, task.task.path))
													)
												} catch (e) {
													log.error(e)
												}
											}
										}}
									/>
								</Flex>
							) : (
								<></>
							)}
						</>
					)}
				</Flex>
			</Flex>
		</Flex>
	)
})

export default Item
