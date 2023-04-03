import { useState } from "react"
import { normalizePlatform } from "../../helpers"

const usePlatform = (): string => {
	const [platform, _] = useState<string>(normalizePlatform(process.platform))

	return platform
}

export default usePlatform
