import { useEffect, useState } from "react"

const useColorScheme = (): string => {
	const isDarkMode: boolean = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
	const [colorScheme, setColorScheme] = useState<string>(isDarkMode ? "dark" : "light")

	useEffect(() => {
		const listener: any = window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", event => {
			const newColorScheme = event.matches ? "dark" : "light"

			setColorScheme(newColorScheme)
		})

		return () => {
			window.matchMedia("(prefers-color-scheme: dark)").removeEventListener("change", listener)
		}
	}, [])

	return colorScheme
}

export default useColorScheme
