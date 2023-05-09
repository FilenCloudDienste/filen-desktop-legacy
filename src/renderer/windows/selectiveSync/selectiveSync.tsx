import React, { memo, useState, useEffect, useRef } from "react"
import { Flex, Spinner, Text, Box, Checkbox, Image } from "@chakra-ui/react"
import useDarkMode from "../../lib/hooks/useDarkMode"
import useLang from "../../lib/hooks/useLang"
import usePlatform from "../../lib/hooks/usePlatform"
import Titlebar from "../../components/Titlebar"
import { i18n } from "../../lib/i18n"
import Container from "../../components/Container"
import IsOnlineBottomToast from "../../components/IsOnlineBottomToast"
import { Base64 } from "js-base64"
import colors from "../../styles/colors"
import { BsFileEarmark } from "react-icons/bs"
import { updateKeys } from "../../lib/user"
import { showToast } from "../../components/Toast"
import { folderContent } from "../../lib/api"
import db from "../../lib/db"
import useDb from "../../lib/hooks/useDb"
import ipc from "../../lib/ipc"
import { IoFolder, IoFolderOpen } from "react-icons/io5"
import { BsFileEarmarkFill } from "react-icons/bs"
import { AiOutlineCaretRight, AiOutlineCaretDown } from "react-icons/ai"
import { Location } from "../../../types"
import { decryptFileMetadata, decryptFolderName } from "../../lib/crypto"

const log = window.require("electron-log")
const { ipcRenderer } = window.require("electron")

const TreeItem = memo(
	({
		darkMode,
		lang,
		platform,
		item,
		location,
		excluded
	}: {
		darkMode: boolean
		lang: string
		platform: string
		item: any
		location: any
		excluded: any
	}) => {
		const [isOpen, setIsOpen] = useState<boolean>(false)
		const [itemIcon, setItemIcon] = useState<string | undefined>(undefined)

		const isItemExcluded = (): boolean => {
			if (typeof excluded[item.path] !== "undefined") {
				return true
			}

			for (const path in excluded) {
				if (item.path.indexOf(item.type == "folder" ? path + "/" : path) !== -1) {
					return true
				}
			}

			return false
		}

		const isParentExcluded = (): boolean => {
			for (const path in excluded) {
				if (item.path.indexOf(item.type == "folder" ? path + "/" : path) !== -1 && item.path !== path) {
					return true
				}
			}

			return false
		}

		const onToggleExcluded = async () => {
			if (isParentExcluded()) {
				return false
			}

			const isExcluded = typeof excluded[item.path] !== "undefined"

			try {
				let currentExcluded = await db.get("selectiveSync:remote:" + location.uuid)

				if (currentExcluded == null) {
					currentExcluded = {}
				}

				if (isExcluded) {
					delete currentExcluded[item.path]
				} else {
					currentExcluded[item.path] = true
				}

				await db.set("selectiveSync:remote:" + location.uuid, currentExcluded)

				ipc.emitGlobal("global-message", {
					type: "forceSync"
				}).catch(log.error)
			} catch (e) {
				log.error(e)
			}
		}

		const onToggleOpen = () => {
			if (item.type !== "folder") {
				return false
			}

			setIsOpen(!isOpen)
		}

		useEffect(() => {
			ipc.getFileIconName(item.name)
				.then(icon => {
					if (typeof icon == "string" && icon.indexOf("data:") !== -1) {
						setItemIcon(icon)
					}
				})
				.catch(log.error)
		}, [])

		return (
			<Box
				width="100%"
				height="auto"
				key={item.path}
				cursor="default"
				marginBottom="5px"
			>
				<Flex
					flexDirection="row"
					alignItems="center"
				>
					<Flex
						flexDirection="row"
						alignItems="center"
						width="auto"
					>
						<Checkbox
							checked={!isItemExcluded()}
							onChange={onToggleExcluded}
						/>
					</Flex>
					<Flex
						flexDirection="row"
						alignItems="center"
						width="auto"
						cursor={item.type == "folder" ? "pointer" : "default"}
						onClick={onToggleOpen}
						marginLeft={item.type == "folder" ? "6px" : "10px"}
					>
						{item.type == "folder" ? (
							isOpen ? (
								<>
									<AiOutlineCaretDown color="gray" />
									<IoFolderOpen
										color={platform == "mac" ? "#3ea0d5" : "#ffd04c"}
										style={{
											marginLeft: 4
										}}
									/>
								</>
							) : (
								<>
									<AiOutlineCaretRight color="gray" />
									<IoFolder
										color={platform == "mac" ? "#3ea0d5" : "#ffd04c"}
										style={{
											marginLeft: 4
										}}
									/>
								</>
							)
						) : (
							<>
								{typeof itemIcon == "string" ? (
									<Image
										src={itemIcon}
										width="16px"
										height="16px"
									/>
								) : (
									<BsFileEarmarkFill color={colors(platform, darkMode, "textPrimary")} />
								)}
							</>
						)}
					</Flex>
					<Flex
						flexDirection="row"
						alignItems="center"
						width="90%"
						cursor={item.type == "folder" ? "pointer" : "default"}
						onClick={onToggleOpen}
						marginLeft="10px"
					>
						<Text
							color={colors(platform, darkMode, "textPrimary")}
							noOfLines={1}
							wordBreak="break-all"
							fontSize={14}
						>
							{item.name}
						</Text>
					</Flex>
				</Flex>
				<Box
					width="100%"
					height="auto"
					display={isOpen ? "block" : "none"}
					paddingLeft="30px"
				>
					{isOpen && item.type == "folder" && (
						<Tree
							darkMode={darkMode}
							lang={lang}
							platform={platform}
							parent={item.uuid}
							location={location}
							excluded={excluded}
							currentPath={item.path}
						/>
					)}
				</Box>
			</Box>
		)
	}
)

const Tree = memo(
	({
		darkMode,
		lang,
		platform,
		parent,
		location,
		excluded,
		currentPath
	}: {
		darkMode: boolean
		lang: string
		platform: string
		parent: string
		location: any
		excluded: any
		currentPath: string
	}) => {
		const [loading, setLoading] = useState<boolean>(true)
		const [items, setItems] = useState<any>([])

		useEffect(() => {
			;(async () => {
				setLoading(true)

				try {
					let [masterKeys, response] = await Promise.all([db.get("masterKeys"), folderContent(parent)])

					if (!Array.isArray(masterKeys)) {
						masterKeys = []
					}

					const folders: any[] = []
					const files: any[] = []
					const promises: Promise<void>[] = []

					for (const folder of response.folders) {
						promises.push(
							new Promise((resolve, reject) => {
								decryptFolderName(folder.name, masterKeys)
									.then(folderName => {
										if (folderName.length > 0) {
											folders.push({
												...folder,
												name: folderName,
												type: "folder",
												path: currentPath.length == 0 ? folderName : currentPath + "/" + folderName
											})
										}

										resolve()
									})
									.catch(reject)
							})
						)
					}

					for (const file of response.uploads) {
						promises.push(
							new Promise((resolve, reject) => {
								decryptFileMetadata(file.metadata, masterKeys)
									.then(metadata => {
										if (metadata.name.length > 0) {
											files.push({
												...file,
												...metadata,
												type: "file",
												path: currentPath.length == 0 ? metadata.name : currentPath + "/" + metadata.name
											})
										}

										resolve()
									})
									.catch(reject)
							})
						)
					}

					await Promise.allSettled(promises)

					setItems([
						...folders.sort((a, b) => a.name.localeCompare(b.name)),
						...files.sort((a, b) => a.name.localeCompare(b.name))
					])
				} catch (e: any) {
					log.error(e)

					showToast({ message: e.toString(), status: "error" })
				}

				setLoading(false)
			})()
		}, [])

		if (loading && currentPath.length > 0) {
			return (
				<Spinner
					width="16px"
					height="16px"
					color={colors(platform, darkMode, "textPrimary")}
				/>
			)
		}

		return (
			<Flex
				marginTop="5px"
				width="100%"
				flexDirection="column"
			>
				{items.map((item: any) => {
					return (
						<TreeItem
							darkMode={darkMode}
							lang={lang}
							platform={platform}
							key={item.uuid}
							item={item}
							location={location}
							excluded={excluded}
						/>
					)
				})}
			</Flex>
		)
	}
)

const SelectiveSyncWindow = memo(({ userId, email, windowId }: { userId: number; email: string; windowId: string }) => {
	const darkMode = useDarkMode()
	const lang = useLang()
	const platform = usePlatform()
	const location: Location = useRef(
		JSON.parse(Base64.decode(decodeURIComponent(new URLSearchParams(window.location.search).get("args") as string)))
	).current
	const [ready, setReady] = useState<boolean>(false)
	const [rootItemsLength, setRootItemsLength] = useState<number>(0)
	const excluded: any = useDb("selectiveSync:remote:" + location.uuid, {})

	useEffect(() => {
		updateKeys()
			.then(() => {
				folderContent(location.remoteUUID!)
					.then(response => {
						setRootItemsLength(response.folders.length + response.uploads.length)
						setReady(true)
					})
					.catch(err => {
						showToast({ message: err.toString(), status: "error" })

						log.error(err)
					})
			})
			.catch(err => {
				showToast({ message: err.toString(), status: "error" })

				log.error(err)
			})

		ipcRenderer.send("window-ready", windowId)
	}, [])

	return (
		<Container
			darkMode={darkMode}
			lang={lang}
			platform={platform}
		>
			<Titlebar
				darkMode={darkMode}
				lang={lang}
				platform={platform}
				title={i18n(lang, "titlebarSelectiveSync")}
			/>
			{userId !== 0 && (
				<Flex
					flexDirection="column"
					width="100%"
					height="570px"
					marginTop="28px"
				>
					{!ready ? (
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
					) : rootItemsLength > 0 ? (
						<Flex
							flexDirection="column"
							width="100%"
							height="570px"
							paddingLeft="10px"
							paddingRight="10px"
							marginTop="12px"
							paddingBottom="10px"
							overflowY="scroll"
						>
							<Tree
								darkMode={darkMode}
								lang={lang}
								platform={platform}
								parent={location.remoteUUID!}
								location={location}
								excluded={excluded}
								currentPath=""
							/>
						</Flex>
					) : (
						<Flex
							flexDirection="column"
							width="100%"
							height="570px"
							justifyContent="center"
							alignItems="center"
						>
							<Flex>
								<BsFileEarmark
									size={64}
									color={darkMode ? "gray" : "gray"}
								/>
							</Flex>
							<Flex marginTop="15px">
								<Text
									color={darkMode ? "gray" : "gray"}
									fontSize={14}
								>
									{i18n(lang, "noFilesOrFoldersUploadedYet")}
								</Text>
							</Flex>
						</Flex>
					)}
				</Flex>
			)}
			<IsOnlineBottomToast lang={lang} />
		</Container>
	)
})

export default SelectiveSyncWindow
