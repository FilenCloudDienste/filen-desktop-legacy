import React, { memo, useState, useEffect, useCallback, useRef } from "react"
import { Flex, Text, Spinner, Progress, Link } from "@chakra-ui/react"
import useDarkMode from "../../lib/hooks/useDarkMode"
import useLang from "../../lib/hooks/useLang"
import usePlatform from "../../lib/hooks/usePlatform"
import Titlebar from "../../components/Titlebar"
import { i18n } from "../../lib/i18n"
import Container from "../../components/Container"
import IsOnlineBottomToast from "../../components/IsOnlineBottomToast"
import { Base64 } from "js-base64"
import colors from "../../styles/colors"
import * as fsLocal from "../../lib/fs/local"
import * as fsRemote from "../../lib/fs/remote"
import db from "../../lib/db"
import { markUploadAsDone, checkIfItemParentIsShared, uploadChunk } from "../../lib/api"
import {
	convertTimestampToMs,
	getTimeRemaining,
	bpsToReadable,
	Semaphore,
	generateRandomString,
	chunkedPromiseAll
} from "../../lib/helpers"
import { v4 as uuidv4 } from "uuid"
import constants from "../../../constants.json"
import eventListener from "../../lib/eventListener"
import { throttle } from "lodash"
import { AiOutlineCheckCircle } from "react-icons/ai"
import { showToast } from "../../components/Toast"
import { encryptData, encryptMetadata, hashFn } from "../../lib/crypto"
import useDb from "../../lib/hooks/useDb"
import { AiOutlinePauseCircle } from "react-icons/ai"
import { Stats } from "fs-extra"

const log = window.require("electron-log")
const pathModule = window.require("path")
const mimeTypes = window.require("mime-types")
const readdirp = window.require("readdirp")
const { ipcRenderer } = window.require("electron")

const UPLOAD_VERSION = 2
const FROM_ID = "upload-" + uuidv4()
const params = new URLSearchParams(window.location.search)
const passedArgs =
	typeof params.get("args") == "string" ? JSON.parse(Base64.decode(decodeURIComponent(params.get("args") as string))) : undefined
const uploadSemaphore = new Semaphore(constants.maxConcurrentUploads)
const uploadThreadsSemaphore = new Semaphore(constants.maxUploadThreads)

const uploadFile = (path: string, parent: string): Promise<boolean> => {
	return new Promise(async (resolve, reject) => {
		await new Promise(resolve => {
			const getPausedStatus = () => {
				db.get("uploadPaused")
					.then(paused => {
						if (paused) {
							return setTimeout(getPausedStatus, 1000)
						}

						return resolve(true)
					})
					.catch(err => {
						log.error(err)

						return setTimeout(getPausedStatus, 1000)
					})
			}

			return getPausedStatus()
		})

		try {
			var absolutePath = pathModule.normalize(path)
			var name = pathModule.basename(absolutePath)
			var nameHashed = hashFn(name.toLowerCase())
		} catch (e) {
			return reject(e)
		}

		if (typeof name !== "string") {
			showToast({ message: "Could not upload file: Name invalid: " + name, status: "error" })

			return reject(new Error("Could not upload file: Name invalid: " + name))
		}

		if (name.length <= 0) {
			showToast({ message: "Could not upload file: Name invalid: " + name, status: "error" })

			return reject(new Error("Could not upload file: Name invalid: " + name))
		}

		const uuid = uuidv4()

		db.get("masterKeys")
			.then(masterKeys => {
				fsLocal
					.canReadAtPath(absolutePath)
					.then(canRead => {
						if (!canRead) {
							return reject(new Error("Cannot read file, permission denied: " + absolutePath))
						}

						fsLocal
							.gracefulLStat(absolutePath)
							.then(async stat => {
								const size = parseInt(stat.size.toString())
								const lastModified = Math.floor(stat.mtimeMs)
								const mime = mimeTypes.lookup(name) || ""
								let dummyOffset = 0
								let fileChunks = 0

								while (dummyOffset < size) {
									fileChunks += 1
									dummyOffset += constants.chunkSize
								}

								try {
									var key = generateRandomString(32)
									var rm = generateRandomString(32)
									var uploadKey = generateRandomString(32)
									var [nameEnc, mimeEnc, sizeEnc, metaData, origStats]: [string, string, string, string, Stats] =
										await Promise.all([
											encryptMetadata(name, key),
											encryptMetadata(mime, key),
											encryptMetadata(size.toString(), key),
											encryptMetadata(
												JSON.stringify(
													{
														name,
														size,
														mime,
														key,
														lastModified
													},
													(_, value) => (typeof value == "bigint" ? parseInt(value.toString()) : value)
												),
												masterKeys[masterKeys.length - 1]
											),
											fsLocal.gracefulLStat(absolutePath)
										])
								} catch (e: any) {
									log.error("Metadata generation failed for " + absolutePath)
									log.error(e)

									showToast({
										message: "Metadata generation failed for " + absolutePath + ": " + e.toString(),
										status: "error"
									})

									return reject(e)
								}

								const uploadTask = (index: number) => {
									return new Promise(async (resolve, reject) => {
										if (!(await fsRemote.doesExistLocally(absolutePath))) {
											return reject("deletedLocally")
										}

										try {
											const stats: Stats = await fsLocal.gracefulLStat(absolutePath)

											if (
												origStats.birthtimeMs !== stats.birthtimeMs ||
												origStats.size !== stats.size ||
												origStats.ino !== stats.ino ||
												origStats.mtimeMs !== stats.mtimeMs
											) {
												return reject("deletedLocally")
											}
										} catch (e: any) {
											if (e.code && e.code == "ENOENT") {
												return reject("deletedLocally")
											}
										}

										fsLocal.readChunk(absolutePath, index * constants.chunkSize, constants.chunkSize).then(data => {
											encryptData(data, key)
												.then(encrypted => {
													uploadChunk({
														queryParams: new URLSearchParams({
															uuid,
															index,
															parent,
															uploadKey
														} as any).toString(),
														data: encrypted,
														from: FROM_ID
													})
														.then(response => {
															if (!response.status) {
																return reject(new Error(response.message))
															}

															return resolve(response.data)
														})
														.catch(reject)
												})
												.catch(reject)
										})
									})
								}

								try {
									await uploadTask(0)

									await new Promise((resolve, reject) => {
										let done = 0

										for (let i = 0; i < fileChunks; i++) {
											uploadThreadsSemaphore.acquire().then(() => {
												uploadTask(i)
													.then(() => {
														done += 1

														uploadThreadsSemaphore.release()

														if (done >= fileChunks) {
															return resolve(true)
														}
													})
													.catch(err => {
														uploadThreadsSemaphore.release()

														return reject(err)
													})
											})
										}
									})

									const stats: Stats = await fsLocal.gracefulLStat(absolutePath)

									if (
										origStats.birthtimeMs !== stats.birthtimeMs ||
										origStats.size !== stats.size ||
										origStats.ino !== stats.ino ||
										origStats.mtimeMs !== stats.mtimeMs
									) {
										return reject("deletedLocally")
									}

									if (!(await fsRemote.smokeTest(parent))) {
										return reject("parentMissing")
									}

									await markUploadAsDone({
										uuid,
										name: nameEnc,
										nameHashed,
										size: sizeEnc,
										chunks: fileChunks,
										mime: mimeEnc,
										rm,
										metadata: metaData,
										version: UPLOAD_VERSION,
										uploadKey
									})
								} catch (e: any) {
									if (!(await fsRemote.doesExistLocally(absolutePath))) {
										return reject("deletedLocally")
									}

									if (typeof e.code !== "undefined") {
										if (e.code == "EPERM") {
											return reject(e)
										}

										if (e.code == "ENOENT") {
											return resolve(true)
										}
									}

									if (e.toString().toLowerCase().indexOf("already exists") !== -1) {
										return resolve(true)
									}

									return reject(e)
								}

								try {
									await checkIfItemParentIsShared({
										type: "file",
										parent,
										metaData: {
											uuid,
											name,
											size,
											mime,
											key,
											lastModified
										}
									})
								} catch (e) {
									log.error(e)
								}

								return resolve(true)
							})
							.catch(reject)
					})
					.catch(reject)
			})
			.catch(reject)
	})
}

const UploadWindow = memo(({ userId, email, windowId }: { userId: number; email: string; windowId: string }) => {
	const darkMode = useDarkMode()
	const lang = useLang()
	const platform = usePlatform()
	const args = useRef(passedArgs).current
	const paused = useDb("uploadPaused", false)

	const [timeLeft, setTimeLeft] = useState(1)
	const [speed, setSpeed] = useState(0)
	const [percent, setPercent] = useState(0)
	const [done, setDone] = useState(false)
	const [foldersCreated, setFoldersCreated] = useState(0)
	const [foldersNeeded, setFoldersNeeded] = useState(0)

	const totalBytes = useRef(0)
	const bytes = useRef(0)
	const started = useRef(-1)

	const startUploading = async () => {
		setFoldersCreated(0)
		setFoldersNeeded(0)

		try {
			await db.set("uploadPaused", false)
		} catch (e: any) {
			log.error(e)

			showToast({ message: e.toString(), status: "error" })
		}

		if (args.type == "files") {
			const files = args.local.filePaths
			const filesToUpload = []

			for (let i = 0; i < files.length; i++) {
				try {
					const stat = await fsLocal.gracefulLStat(pathModule.normalize(files[i]))

					if (!stat.isDir) {
						if (stat.size > 0) {
							filesToUpload.push(files[i])

							totalBytes.current += parseInt(stat.size.toString())
						}
					} else {
						showToast({ message: pathModule.basename(files[i]) + " is a directory", status: "error" })
					}
				} catch (e: any) {
					log.error(e)

					showToast({ message: e.toString(), status: "error" })
				}
			}

			if (filesToUpload.length > 0) {
				try {
					await chunkedPromiseAll([
						...filesToUpload.map(
							path =>
								new Promise((resolve, reject) => {
									uploadSemaphore
										.acquire()
										.then(() => {
											uploadFile(pathModule.normalize(path), args.remote.uuid)
												.then(() => {
													uploadSemaphore.release()

													return resolve(true)
												})
												.catch(reject)
										})
										.catch(reject)
								})
						)
					])
				} catch (e: any) {
					log.error(e)

					showToast({ message: e.toString(), status: "error" })
				}
			}

			setDone(true)
		} else {
			try {
				for (let i = 0; i < args.local.filePaths.length; i++) {
					await new Promise((resolve, reject) => {
						const basePath: string = pathModule.normalize(args.local.filePaths[i])
						const folders: any = {}
						const files: any = {}

						fsLocal
							.gracefulLStat(basePath)
							.then(stat => {
								if (!stat.isDir) {
									return reject(pathModule.basename(basePath) + " is not a directory")
								}

								fsLocal
									.canReadAtPath(basePath)
									.then(canRead => {
										if (!canRead) {
											return reject(pathModule.basename(basePath) + " cannot read, permission denied")
										}

										let statting = 0

										const dirStream = readdirp(basePath, {
											alwaysStat: false,
											lstat: false,
											type: "all",
											depth: 2147483648
										})

										dirStream.on("data", async (item: any) => {
											statting += 1

											try {
												if (platform == "windows") {
													item.path = item.path.split("\\").join("/") // Convert windows \ style path seperators to / for internal database, we only use UNIX style path seperators internally
												}

												item.stats = await fsLocal.gracefulLStat(item.fullPath)

												if (!item.stats.isLink) {
													if (item.stats.isDir) {
														folders[item.path] = {
															name: item.basename,
															lastModified: convertTimestampToMs(parseInt(item.stats.mtimeMs.toString())) //.toString() because of BigInt
														}
													} else {
														if (item.stats.size > 0) {
															files[item.path] = {
																name: item.basename,
																size: parseInt(item.stats.size.toString()), //.toString() because of BigInt
																lastModified: convertTimestampToMs(parseInt(item.stats.mtimeMs.toString())) //.toString() because of BigInt
															}

															totalBytes.current += parseInt(item.stats.size.toString())
														}
													}
												}
											} catch (e: any) {
												log.error(e)

												showToast({ message: e.toString(), status: "error" })
											}

											statting -= 1
										})

										dirStream.on("warn", (warn: any) => {
											log.error(warn)

											showToast({ message: warn.toString(), status: "error" })
										})

										dirStream.on("error", (err: any) => {
											dirStream.destroy()

											statting = 0

											return reject(err)
										})

										dirStream.on("end", async () => {
											await new Promise(resolve => {
												const wait = setInterval(() => {
													if (statting <= 0) {
														clearInterval(wait)

														return resolve(true)
													}
												}, 10)
											})

											statting = 0

											dirStream.destroy()

											let baseParentUUID: string = uuidv4()
											const baseParentName: string = pathModule.basename(basePath)
											const foldersSorted: string[] = [...Object.keys(folders).sort((a, b) => a.length - b.length)]
											const createdFolderUUIDs: any = {}

											setFoldersNeeded(foldersSorted.length + 1)

											try {
												baseParentUUID = await fsRemote.createDirectory(
													baseParentUUID,
													baseParentName,
													args.remote.uuid
												)

												setFoldersCreated(prev => prev + 1)
											} catch (e) {
												return reject(e)
											}

											if (foldersSorted.length > 0) {
												for (let i = 0; i < foldersSorted.length; i++) {
													try {
														const folderName = pathModule.basename(foldersSorted[i])
														let folderUUID = uuidv4()
														const parentPath = pathModule.dirname(foldersSorted[i])
														const parentUUID =
															parentPath == "." ? baseParentUUID : createdFolderUUIDs[parentPath]

														folderUUID = await fsRemote.createDirectory(folderUUID, folderName, parentUUID)

														createdFolderUUIDs[foldersSorted[i]] = folderUUID

														setFoldersCreated(prev => prev + 1)
													} catch (e) {
														return reject(e)
													}
												}
											}

											if (Object.keys(files).length > 0) {
												try {
													await chunkedPromiseAll([
														...Object.keys(files).map(
															filePath =>
																new Promise((resolve, reject) => {
																	uploadSemaphore
																		.acquire()
																		.then(() => {
																			const parentPath = pathModule.dirname(filePath)
																			const parentUUID =
																				parentPath == "."
																					? baseParentUUID
																					: createdFolderUUIDs[parentPath]

																			uploadFile(
																				pathModule.normalize(pathModule.join(basePath, filePath)),
																				parentUUID
																			)
																				.then(() => {
																					uploadSemaphore.release()

																					return resolve(true)
																				})
																				.catch(reject)
																		})
																		.catch(reject)
																})
														)
													])
												} catch (e: any) {
													log.error(e)

													showToast({ message: e.toString(), status: "error" })
												}
											}

											return resolve(true)
										})
									})
									.catch(reject)
							})
							.catch(reject)
					})
				}
			} catch (e: any) {
				log.error(e)

				return showToast({ message: e.toString(), status: "error" })
			}

			setDone(true)
		}
	}

	const calcSpeed = (now: number, started: number, bytes: number): number => {
		now = Date.now() - 1000

		const secondsDiff = (now - started) / 1000
		const bps = Math.floor((bytes / secondsDiff) * constants.speedMultiplier)

		return bps > 0 ? bps : 0
	}

	const calcTimeLeft = (loadedBytes: number, totalBytes: number, started: number): number => {
		const elapsed = Date.now() - started
		const speed = loadedBytes / (elapsed / 1000)
		const remaining = (totalBytes - loadedBytes) / speed

		return remaining > 0 ? remaining : 0
	}

	const throttleUpdates = useCallback(
		throttle(() => {
			setSpeed(calcSpeed(Date.now(), started.current, bytes.current))
			setPercent(Math.round((bytes.current / (totalBytes.current * constants.sizeOverheadMultiplier)) * 100))
		}, 100),
		[]
	)

	const throttleTimeLeft = useCallback(
		throttle(() => {
			setTimeLeft(calcTimeLeft(bytes.current, totalBytes.current * constants.sizeOverheadMultiplier, started.current))
		}, 1000),
		[]
	)

	useEffect(() => {
		startUploading()

		const progressListener = eventListener.on("uploadProgressSeperate", (data: any) => {
			if (data.from == FROM_ID) {
				if (started.current == -1) {
					started.current = Date.now()
				}

				bytes.current += parseInt(data.bytes)

				throttleUpdates()
				throttleTimeLeft()
			}
		})

		ipcRenderer.send("window-ready", windowId)

		return () => {
			progressListener.remove()
		}
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
				title={i18n(lang, "titlebarUpload")}
			/>
			{userId !== 0 && typeof args == "object" && (
				<Flex
					width="100%"
					height="380px"
					paddingTop="25px"
				>
					<Flex
						width="100%"
						height="100%"
						justifyContent="center"
						flexDirection="column"
						alignItems="center"
					>
						{!done && bytes.current <= 0 ? (
							<>
								<Spinner
									width="40px"
									height="40px"
									color={colors(platform, darkMode, "textPrimary")}
								/>
								<Text
									fontSize={14}
									color={colors(platform, darkMode, "textPrimary")}
									noOfLines={1}
									marginTop="10px"
								>
									{args.type == "files"
										? i18n(lang, "preparingUpload")
										: i18n(lang, "preparingUploadFolders") + " (" + foldersCreated + "/" + foldersNeeded + ")"}
								</Text>
							</>
						) : done ? (
							<>
								<AiOutlineCheckCircle
									color="green"
									size={64}
								/>
								<Text
									fontSize={14}
									color={colors(platform, darkMode, "textPrimary")}
									noOfLines={1}
									marginTop="10px"
								>
									{i18n(lang, "uploadDone")}
								</Text>
							</>
						) : (
							<Flex
								width="80%"
								height="auto"
								flexDirection="column"
							>
								<Progress
									value={percent > 100 ? 100 : parseFloat(percent.toFixed(2))}
									height="5px"
									borderRadius="10px"
									colorScheme="blue"
									min={0}
									max={100}
									marginTop="5px"
									width="100%"
									isIndeterminate={paused}
								/>
								<Flex
									flexDirection="row"
									justifyContent="space-between"
									marginTop="2px"
								>
									{paused ? (
										<AiOutlinePauseCircle
											size={14}
											color={colors(platform, darkMode, "textPrimary")}
											style={{
												marginTop: "5px"
											}}
										/>
									) : (
										(() => {
											const remainingReadable = getTimeRemaining(Date.now() + timeLeft * 1000)

											if (remainingReadable.total <= 1 || remainingReadable.minutes <= 1) {
												remainingReadable.total = 1
												remainingReadable.days = 0
												remainingReadable.hours = 0
												remainingReadable.minutes = 1
												remainingReadable.seconds = 1
											}

											return (
												<Text
													fontSize={14}
													color={colors(platform, darkMode, "textPrimary")}
													noOfLines={1}
												>
													{bpsToReadable(speed) +
														", " +
														i18n(
															lang,
															"aboutRemaining",
															false,
															["__TIME__"],
															[
																(remainingReadable.days > 0 ? remainingReadable.days + "d " : "") +
																	(remainingReadable.hours > 0 ? remainingReadable.hours + "h " : "") +
																	(remainingReadable.minutes > 0 ? remainingReadable.minutes + "m " : "")
															]
														)}
												</Text>
											)
										})()
									)}
									{percent < 100 && !done && (
										<>
											{paused ? (
												<Link
													color={colors(platform, darkMode, "link")}
													textDecoration="none"
													_hover={{ textDecoration: "none" }}
													marginLeft="10px"
													onClick={() => db.set("uploadPaused", false)}
												>
													{i18n(lang, "resume")}
												</Link>
											) : (
												<Link
													color={colors(platform, darkMode, "link")}
													textDecoration="none"
													_hover={{ textDecoration: "none" }}
													marginLeft="10px"
													onClick={() => db.set("uploadPaused", true)}
												>
													{i18n(lang, "pause")}
												</Link>
											)}
										</>
									)}
								</Flex>
							</Flex>
						)}
					</Flex>
				</Flex>
			)}
			<IsOnlineBottomToast lang={lang} />
		</Container>
	)
})

export default UploadWindow
