require("dotenv").config()
const { notarize } = require("electron-notarize")

exports.default = async function notarizing(context) {
	const { electronPlatformName, appOutDir } = context

	if (electronPlatformName !== "darwin") {
		return true
	}

	const appName = context.packager.appInfo.productFilename

	return await notarize({
		appBundleId: "io.filen.desktop",
		appPath: `${appOutDir}/${appName}.app`,
		appleId: process.env.NOTARIZE_ID,
		appleIdPassword: process.env.NOTARIZE_PASS,
		tool: "notarytool",
		teamId: process.env.NOTARIZE_TEAM_ID
	})
}
