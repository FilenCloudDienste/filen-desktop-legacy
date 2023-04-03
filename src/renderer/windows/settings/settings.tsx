import React, { memo, useState, useEffect, useMemo } from "react"
import { Flex, Text } from "@chakra-ui/react"
import useDarkMode from "../../lib/hooks/useDarkMode"
import useLang from "../../lib/hooks/useLang"
import usePlatform from "../../lib/hooks/usePlatform"
import Titlebar from "../../components/Titlebar"
import { i18n } from "../../lib/i18n"
import { HiOutlineCog } from "react-icons/hi"
import { AiOutlineSync } from "react-icons/ai"
import { VscAccount } from "react-icons/vsc"
import colors from "../../styles/colors"
import Container from "../../components/Container"
import { GoIssueReopened } from "react-icons/go"
import { MdOutlineNetworkCheck } from "react-icons/md"
import IsOnlineBottomToast from "../../components/IsOnlineBottomToast"
import { BsKeyboard } from "react-icons/bs"
import useSyncIssues from "../../lib/hooks/useSyncIssues"
import SettingsWindowGeneral from "./general"
import SettingsWindowSyncs from "./syncs"
import SettingsWindowAccount from "./account"
import SettingsWindowIssues from "./issues"
import SettingsWindowNetworking from "./networking"
import SettingsWindowKeybinds from "./keybinds"

const { ipcRenderer } = window.require("electron")

const STARTING_ROUTE_URL_PARAMS = new URLSearchParams(window.location.search)
const STARTING_ROUTE = typeof STARTING_ROUTE_URL_PARAMS.get("page") == "string" ? STARTING_ROUTE_URL_PARAMS.get("page") : "general"

const SettingsSelectionButton = memo(
	({
		darkMode,
		lang,
		platform,
		selection,
		setSelection,
		type,
		title,
		color
	}: {
		darkMode: boolean
		lang: string
		platform: string
		selection: any
		setSelection: any
		type: string
		title: string
		color?: string
	}) => {
		return (
			<Flex
				minWidth="80px"
				height="100%"
				backgroundColor={selection == type ? colors(platform, darkMode, "backgroundPrimary") : "transparent"}
				borderRadius="15px"
				paddingLeft="15px"
				paddingRight="15px"
				paddingTop="5px"
				paddingBottom="5px"
				onClick={() => {
					setSelection(type)
				}}
				cursor="pointer"
				pointerEvents="all"
				userSelect="none"
				marginLeft="3px"
				_hover={{
					backgroundColor: colors(platform, darkMode, "backgroundPrimary")
				}}
			>
				<Flex
					width="100%"
					height="100%"
					flexDirection="column"
					justifyContent="center"
					alignItems="center"
					userSelect="none"
				>
					{type == "general" && (
						<HiOutlineCog
							size={20}
							color={darkMode ? "white" : "gray"}
						/>
					)}
					{type == "syncs" && (
						<AiOutlineSync
							size={20}
							color={darkMode ? "white" : "gray"}
						/>
					)}
					{type == "account" && (
						<VscAccount
							size={20}
							color={darkMode ? "white" : "gray"}
						/>
					)}
					{type == "issues" && (
						<GoIssueReopened
							size={20}
							color={typeof color == "string" ? color : darkMode ? "white" : "gray"}
						/>
					)}
					{type == "networking" && (
						<MdOutlineNetworkCheck
							size={20}
							color={darkMode ? "white" : "gray"}
						/>
					)}
					{type == "keybinds" && (
						<BsKeyboard
							size={20}
							color={darkMode ? "white" : "gray"}
						/>
					)}
					<Text
						fontSize={13}
						fontWeight="bold"
						color={darkMode ? "white" : "gray"}
						userSelect="none"
					>
						{title}
					</Text>
				</Flex>
			</Flex>
		)
	}
)

const SettingsSelection = memo(
	({
		darkMode,
		lang,
		platform,
		selection,
		setSelection
	}: {
		darkMode: boolean
		lang: string
		platform: string
		selection: any
		setSelection: any
	}) => {
		const syncIssues = useSyncIssues()

		const [syncIssuesIncludesCritical] = useMemo(() => {
			const filtered = syncIssues.filter(issue => ["critical", "conflict", "warning"].includes(issue.type))
			const includesCritical = filtered.filter(issue => issue.type == "critical").length > 0

			return [includesCritical]
		}, [syncIssues])

		return (
			<Flex
				flexDirection="row"
				justifyContent="center"
				alignItems="center"
				borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
				paddingBottom="10px"
				paddingTop="20px"
				userSelect="none"
				style={{
					// @ts-ignore
					WebkitAppRegion: "drag"
				}}
				backgroundColor={colors(platform, darkMode, "titlebarBackgroundPrimary")}
			>
				<Flex
					flexDirection="row"
					width="auto"
					height="auto"
					userSelect="none"
					style={{
						// @ts-ignore
						WebkitAppRegion: "none"
					}}
				>
					<SettingsSelectionButton
						darkMode={darkMode}
						lang={lang}
						platform={platform}
						selection={selection}
						setSelection={setSelection}
						type="general"
						title={i18n(lang, "settingsGeneral")}
					/>
					<SettingsSelectionButton
						darkMode={darkMode}
						lang={lang}
						platform={platform}
						selection={selection}
						setSelection={setSelection}
						type="syncs"
						title={i18n(lang, "settingsSyncs")}
					/>
					<SettingsSelectionButton
						darkMode={darkMode}
						lang={lang}
						platform={platform}
						selection={selection}
						setSelection={setSelection}
						type="account"
						title={i18n(lang, "settingsAccount")}
					/>
					<SettingsSelectionButton
						darkMode={darkMode}
						lang={lang}
						platform={platform}
						selection={selection}
						setSelection={setSelection}
						type="issues"
						title={i18n(lang, "settingsIssues")}
						color={
							syncIssues.length > 0
								? syncIssuesIncludesCritical
									? "rgba(255, 69, 58, 1)"
									: "rgba(255, 149, 0, 1)"
								: undefined
						}
					/>
					<SettingsSelectionButton
						darkMode={darkMode}
						lang={lang}
						platform={platform}
						selection={selection}
						setSelection={setSelection}
						type="networking"
						title={i18n(lang, "settingsNetworking")}
					/>
					<SettingsSelectionButton
						darkMode={darkMode}
						lang={lang}
						platform={platform}
						selection={selection}
						setSelection={setSelection}
						type="keybinds"
						title={i18n(lang, "settingsKeybinds")}
					/>
				</Flex>
			</Flex>
		)
	}
)

const SettingsWindow = memo(
	({ startingRoute, userId, email, windowId }: { startingRoute: string[]; userId: number; email: string; windowId: string }) => {
		const darkMode = useDarkMode()
		const lang = useLang()
		const platform = usePlatform()

		const [selection, setSelection] = useState(
			typeof startingRoute[1] == "string" && startingRoute[1].length > 0 ? startingRoute[1] : STARTING_ROUTE
		)

		useEffect(() => {
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
					title={i18n(lang, "titlebarSettings")}
				/>
				{userId !== 0 && (
					<Flex
						flexDirection="column"
						width="100%"
						height="570px"
						paddingTop="20px"
					>
						<SettingsSelection
							darkMode={darkMode}
							lang={lang}
							platform={platform}
							selection={selection}
							setSelection={setSelection}
						/>
						<Flex>
							{selection == "general" && (
								<SettingsWindowGeneral
									darkMode={darkMode}
									lang={lang}
									platform={platform}
								/>
							)}
							{selection == "syncs" && (
								<SettingsWindowSyncs
									darkMode={darkMode}
									lang={lang}
									platform={platform}
									userId={userId}
								/>
							)}
							{selection == "account" && (
								<SettingsWindowAccount
									darkMode={darkMode}
									lang={lang}
									platform={platform}
									email={email}
								/>
							)}
							{selection == "issues" && (
								<SettingsWindowIssues
									darkMode={darkMode}
									lang={lang}
									platform={platform}
								/>
							)}
							{selection == "networking" && (
								<SettingsWindowNetworking
									darkMode={darkMode}
									lang={lang}
									platform={platform}
								/>
							)}
							{selection == "keybinds" && (
								<SettingsWindowKeybinds
									darkMode={darkMode}
									lang={lang}
									platform={platform}
								/>
							)}
						</Flex>
					</Flex>
				)}
				<IsOnlineBottomToast lang={lang} />
			</Container>
		)
	}
)

export default SettingsWindow
