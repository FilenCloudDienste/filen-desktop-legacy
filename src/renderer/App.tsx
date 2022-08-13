// @ts-nocheck

import React, { memo, lazy, Suspense } from "react"
import { ChakraProvider, theme } from "@chakra-ui/react"
import useDb from "./lib/hooks/useDb"

const MainWindow = lazy(() => import("./windows/main"))
const WorkerWindow = lazy(() => import("./windows/worker"))
const AuthWindow = lazy(() => import("./windows/auth"))
const SettingsWindow = lazy(() => import("./windows/settings"))
const DownloadWindow = lazy(() => import("./windows/download"))
const UploadWindow = lazy(() => import("./windows/upload"))
const CloudWindow = lazy(() => import("./windows/cloud"))
const SelectiveSyncWindow = lazy(() => import("./windows/selectiveSync"))
const UpdateWindow = lazy(() => import("./windows/update"))

const startingRoute = window.location.hash.replace("#", "").split("/")
const getParams = new URLSearchParams(window.location.search)

console.log(startingRoute[0])

const customTheme = {
	...theme,
	shadows: {
		...theme.shadows,
		outline: "none"
	}
}

let App: any = () => <></>

if(startingRoute[0] == "worker"){
	App = memo(() => {
		return (
			<Suspense
				fallback={
					<></>
				}
			>
				<WorkerWindow windowId={getParams.get("id")} />
			</Suspense>
		)
	})
}
else if(startingRoute[0] == "auth"){
	App = memo(() => {
		return (
			<ChakraProvider theme={customTheme}>
				<Suspense
					fallback={
						<></>
					}
				>
					<AuthWindow windowId={getParams.get("id")} />
				</Suspense>
			</ChakraProvider>
		)
	})
}
else if(startingRoute[0] == "main"){
	App = memo(() => {
		const userId: number = useDb("userId", 0)
		const email: string = useDb("email", "")

		if(userId == 0 || email == ""){
			return null
		}

		return (
			<ChakraProvider theme={customTheme}>
				<Suspense
					fallback={
						<></>
					}
				>
					<MainWindow userId={userId} email={email} windowId={getParams.get("id")} />
				</Suspense>
			</ChakraProvider>
		)
	})
}
else if(startingRoute[0] == "settings"){
	App = memo(() => {
		const userId: number = useDb("userId", 0)
		const email: string = useDb("email", "")

		if(userId == 0 || email == ""){
			return null
		}

		return (
			<ChakraProvider theme={customTheme}>
				<SettingsWindow startingRoute={startingRoute} userId={userId} email={email} windowId={getParams.get("id")} />
			</ChakraProvider>
		)
	})
}
else if(startingRoute[0] == "download"){
	App = memo(() => {
		const userId: number = useDb("userId", 0)
		const email: string = useDb("email", "")

		if(userId == 0 || email == ""){
			return null
		}

		return (
			<ChakraProvider theme={customTheme}>
				<Suspense
					fallback={
						<></>
					}
				>
					<DownloadWindow userId={userId} email={email} windowId={getParams.get("id")} />
				</Suspense>
			</ChakraProvider>
		)
	})
}
else if(startingRoute[0] == "upload"){
	App = memo(() => {
		const userId: number = useDb("userId", 0)
		const email: string = useDb("email", "")

		if(userId == 0 || email == ""){
			return null
		}

		return (
			<ChakraProvider theme={customTheme}>
				<Suspense
					fallback={
						<></>
					}
				>
					<UploadWindow userId={userId} email={email} windowId={getParams.get("id")} />
				</Suspense>
			</ChakraProvider>
		)
	})
}
else if(startingRoute[0] == "selectiveSync"){
	App = memo(() => {
		const userId: number = useDb("userId", 0)
		const email: string = useDb("email", "")

		if(userId == 0 || email == ""){
			return null
		}

		return (
			<ChakraProvider theme={customTheme}>
				<Suspense
					fallback={
						<></>
					}
				>
					<SelectiveSyncWindow userId={userId} email={email} windowId={getParams.get("id")} />
				</Suspense>
			</ChakraProvider>
		)
	})
}
else if(startingRoute[0] == "cloud"){
	App = memo(() => {
		const userId: number = useDb("userId", 0)
		const email: string = useDb("email", "")

		if(userId == 0 || email == ""){
			return null
		}

		return (
			<ChakraProvider theme={customTheme}>
				<Suspense
					fallback={
						<></>
					}
				>
					<CloudWindow userId={userId} email={email} windowId={getParams.get("id")} />
				</Suspense>
			</ChakraProvider>
		)
	})
}

else if(startingRoute[0] == "update"){
	App = memo(() => {
		return (
			<ChakraProvider theme={customTheme}>
				<Suspense
					fallback={
						<></>
					}
				>
					<UpdateWindow windowId={getParams.get("id")} toVersion={getParams.get("toVersion")} />
				</Suspense>
			</ChakraProvider>
		)
	})
}

export default App