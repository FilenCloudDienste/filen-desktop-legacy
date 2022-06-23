import React, { useState } from "react"
import { normalizePlatform } from "../../helpers"

const usePlatform = () => {
    const [platform, setPlatform] = useState(normalizePlatform(process.platform))

	return platform
}

export default usePlatform