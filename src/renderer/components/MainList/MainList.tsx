import { memo, useCallback } from "react"
import { Flex, Text, Link } from "@chakra-ui/react"
import { AiOutlineSync } from "react-icons/ai"
import ipc from "../../lib/ipc"
import colors from "../../styles/colors"
import Item from "../Item"
// @ts-ignore
import { List } from "react-virtualized"
import { i18n } from "../../lib/i18n"
import useDb from "../../lib/hooks/useDb"
import { Location } from "../../../types"

export interface MainListProps {
	userId: number
	email: string
	platform: string
	darkMode: boolean
	lang: string
	activity: any
	isOnline: boolean
}

const MainList = memo(({ userId, platform, darkMode, lang, activity, isOnline }: MainListProps) => {
	const syncLocations: Location[] = useDb("syncLocations:" + userId, [])
	const paused: boolean = useDb("paused", false)

	const rowRenderer = useCallback(
		({ index, key, style }: { index: number; key: string; style: any }) => {
			const task = activity[index]

			return (
				<Item
					key={key + ":" + JSON.stringify(task)}
					task={task}
					style={style}
					lang={lang}
					userId={userId}
					platform={platform}
					darkMode={darkMode}
					paused={paused}
					isOnline={isOnline}
				/>
			)
		},
		[activity]
	)

	return (
		<>
			{Array.isArray(syncLocations) && syncLocations.length > 0 ? (
				<Flex
					height="450px"
					width={window.innerWidth}
					padding="0px"
					flexDirection="column"
					borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
				>
					{activity.length > 0 ? (
						<List
							height={450}
							width={window.innerWidth - 2}
							noRowsRenderer={() => <></>}
							overscanRowCount={8}
							rowCount={activity.length}
							rowHeight={47}
							estimatedRowSize={activity.length * 47}
							rowRenderer={rowRenderer}
						/>
					) : (
						<Flex
							justifyContent="center"
							alignItems="center"
							height="100%"
							width="100%"
							flexDirection="column"
						>
							<Flex>
								<AiOutlineSync
									size={50}
									color={darkMode ? "gray" : "gray"}
								/>
							</Flex>
							<Flex marginTop="10px">
								<Text
									color={darkMode ? "gray" : "gray"}
									fontSize={12}
								>
									{i18n(lang, "noSyncActivityYet")}
								</Text>
							</Flex>
						</Flex>
					)}
				</Flex>
			) : (
				<Flex
					flexDirection="column"
					width="100%"
					height="450px"
					alignItems="center"
					justifyContent="center"
					borderBottom={"1px solid " + colors(platform, darkMode, "borderPrimary")}
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
							onClick={() => ipc.openSettingsWindow("syncs")}
						>
							{i18n(lang, "createOne")}
						</Link>
					</Flex>
				</Flex>
			)}
		</>
	)
})

export default MainList
