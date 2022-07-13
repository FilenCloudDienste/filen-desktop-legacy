require("dotenv").config()
const { notarize } = require("electron-notarize")
const { exec } = require("child_process")

exports.default = async function notarizing(context){
	return true

	const { electronPlatformName, appOutDir } = context;

	if(electronPlatformName !== "darwin"){
		return true
	}

	const appName = context.packager.appInfo.productFilename
	const arch = context.packager.appInfo.arch

	return await notarize({
		appBundleId: "io.filen.desktop",
		appPath: arch == "arm64" ? (appOutDir + "/mac-arm64/" + appName + ".app") : (appOutDir + "/mac/" + appName + ".app"),
		appleId: process.env.NOTARIZE_ID,
		appleIdPassword: process.env.NOTARIZE_PASS
	})
}