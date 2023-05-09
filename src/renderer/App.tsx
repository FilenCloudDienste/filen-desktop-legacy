import React, { memo, lazy, Suspense } from "react"
import { ChakraProvider, theme } from "@chakra-ui/react"
import useDb from "./lib/hooks/useDb"

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

if (startingRoute[0] == "worker") {
	const WorkerWindow = lazy(() => import("./windows/worker"))

	App = memo(() => {
		const userId: number = useDb("userId", 0)

		if (userId == 0) {
			return null
		}

		return (
			<Suspense fallback={<></>}>
				<WorkerWindow userId={userId} />
			</Suspense>
		)
	})
} else if (startingRoute[0] == "auth") {
	const AuthWindow = lazy(() => import("./windows/auth"))

	App = memo(() => {
		return (
			<ChakraProvider theme={customTheme}>
				<Suspense fallback={<></>}>
					<AuthWindow windowId={getParams.get("id")!} />
				</Suspense>
			</ChakraProvider>
		)
	})
} else if (startingRoute[0] == "main") {
	const MainWindow = lazy(() => import("./windows/main"))

	App = memo(() => {
		const userId: number = useDb("userId", 0)
		const email: string = useDb("email", "")

		if (userId == 0 || email == "") {
			return null
		}

		return (
			<ChakraProvider theme={customTheme}>
				<Suspense fallback={<></>}>
					<MainWindow
						userId={userId}
						email={email}
						windowId={getParams.get("id")!}
					/>
				</Suspense>
			</ChakraProvider>
		)
	})
} else if (startingRoute[0] == "settings") {
	const SettingsWindow = lazy(() => import("./windows/settings"))

	App = memo(() => {
		const userId: number = useDb("userId", 0)
		const email: string = useDb("email", "")

		if (userId == 0 || email == "") {
			return null
		}

		return (
			<ChakraProvider theme={customTheme}>
				<SettingsWindow
					startingRoute={startingRoute}
					userId={userId}
					email={email}
					windowId={getParams.get("id")!}
				/>
			</ChakraProvider>
		)
	})
} else if (startingRoute[0] == "download") {
	const DownloadWindow = lazy(() => import("./windows/download"))

	App = memo(() => {
		const userId: number = useDb("userId", 0)
		const email: string = useDb("email", "")

		if (userId == 0 || email == "") {
			return null
		}

		return (
			<ChakraProvider theme={customTheme}>
				<Suspense fallback={<></>}>
					<DownloadWindow
						userId={userId}
						email={email}
						windowId={getParams.get("id")!}
					/>
				</Suspense>
			</ChakraProvider>
		)
	})
} else if (startingRoute[0] == "upload") {
	const UploadWindow = lazy(() => import("./windows/upload"))

	App = memo(() => {
		const userId: number = useDb("userId", 0)
		const email: string = useDb("email", "")

		if (userId == 0 || email == "") {
			return null
		}

		return (
			<ChakraProvider theme={customTheme}>
				<Suspense fallback={<></>}>
					<UploadWindow
						userId={userId}
						email={email}
						windowId={getParams.get("id")!}
					/>
				</Suspense>
			</ChakraProvider>
		)
	})
} else if (startingRoute[0] == "selectiveSync") {
	const SelectiveSyncWindow = lazy(() => import("./windows/selectiveSync"))

	App = memo(() => {
		const userId: number = useDb("userId", 0)
		const email: string = useDb("email", "")

		if (userId == 0 || email == "") {
			return null
		}

		return (
			<ChakraProvider theme={customTheme}>
				<Suspense fallback={<></>}>
					<SelectiveSyncWindow
						userId={userId}
						email={email}
						windowId={getParams.get("id")!}
					/>
				</Suspense>
			</ChakraProvider>
		)
	})
} else if (startingRoute[0] == "cloud") {
	const CloudWindow = lazy(() => import("./windows/cloud"))

	App = memo(() => {
		const userId: number = useDb("userId", 0)
		const email: string = useDb("email", "")

		if (userId == 0 || email == "") {
			return null
		}

		return (
			<ChakraProvider theme={customTheme}>
				<Suspense fallback={<></>}>
					<CloudWindow
						userId={userId}
						email={email}
						windowId={getParams.get("id")!}
					/>
				</Suspense>
			</ChakraProvider>
		)
	})
} else if (startingRoute[0] == "update") {
	const UpdateWindow = lazy(() => import("./windows/update"))

	App = memo(() => {
		return (
			<ChakraProvider theme={customTheme}>
				<Suspense fallback={<></>}>
					<UpdateWindow
						windowId={getParams.get("id")!}
						toVersion={getParams.get("toVersion")!}
					/>
				</Suspense>
			</ChakraProvider>
		)
	})
}

export default App
