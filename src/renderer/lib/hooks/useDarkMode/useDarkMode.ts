import { useEffect, useState } from "react"
import useColorScheme from "../useColorScheme"
import useDb from "../useDb"

const useDarkMode = (): boolean => {
    const colorScheme: string = useColorScheme()
    const [darkMode, setDarkMode] = useState<boolean>(colorScheme == "dark")
	const userSelectedTheme: string | null = useDb("userSelectedTheme", null)

	useEffect(() => {
		setDarkMode(typeof userSelectedTheme == "string" ? (userSelectedTheme == "dark") : (colorScheme == "dark"))
	}, [colorScheme, userSelectedTheme])

	useEffect(() => {
		const listener: any = window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
            setDarkMode(event.matches)
        })

		return () => {
			window.matchMedia("(prefers-color-scheme: dark)").removeEventListener("change", listener)
		}
	}, [])

	return darkMode
}

export default useDarkMode