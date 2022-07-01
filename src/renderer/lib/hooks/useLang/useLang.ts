import { useEffect, useState } from "react"
import useDb from "../useDb"

const useLang = (): string => {
    const dbLang: string = useDb("lang", "en")
    const [lang, setLang] = useState<string>(dbLang)

	useEffect(() => {
		setLang(dbLang)
	}, [dbLang])

	return lang
}

export default useLang