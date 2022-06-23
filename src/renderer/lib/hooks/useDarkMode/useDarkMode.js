import React, { useEffect, useState } from "react"
import useColorScheme from "../useColorScheme"
import useDb from "../useDb"

const useDarkMode = () => {
    const colorScheme = useColorScheme()
    const [darkMode, setDarkMode] = useState(colorScheme == "dark")
	const userSelectedTheme = useDb("userSelectedTheme", null)

	useEffect(() => {
		setDarkMode(typeof userSelectedTheme == "string" ? (userSelectedTheme == "dark") : (colorScheme == "dark"))
	}, [colorScheme, userSelectedTheme])

	useEffect(() => {
		const listener = window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
            setDarkMode(event.matches)
        })

		return () => {
			window.matchMedia("(prefers-color-scheme: dark)").removeEventListener("change", listener)
		}
	}, [])

	return darkMode
}

export default useDarkMode