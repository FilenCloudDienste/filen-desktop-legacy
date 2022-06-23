import React, { useEffect, useState } from "react"
import useDb from "../useDb"

const useLang = () => {
    const dbLang = useDb("lang", "en")
    const [lang, setLang] = useState(dbLang)

	useEffect(() => {
		setLang(dbLang)
	}, [dbLang])

	return lang
}

export default useLang