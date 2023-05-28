import packageJSON from "../../../../../package.json"

const useAppVersion = (): string => {
	return packageJSON.version
}

export default useAppVersion
