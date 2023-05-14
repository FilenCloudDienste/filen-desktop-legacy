import { decryptMetadata } from "../../crypto"
import db from "../../db"
import ipc from "../../ipc"
import eventListener from "../../eventListener"

const { ipcRenderer } = window.require("electron")
const log = window.require("electron-log")

export const listen = () => {
	eventListener.on("socket-event", async (request: any) => {
		const { type, data } = request
		const { args } = data

		if (type === "fm-to-sync-client-message") {
			try {
				let masterKeys = await db.get("masterKeys")

				if (!Array.isArray(masterKeys)) {
					masterKeys = []
				}

				let gotArgs

				for (let i = 0; i < masterKeys.length; i++) {
					try {
						const obj = JSON.parse(await decryptMetadata(args, masterKeys[i]))

						if (obj && typeof obj == "object") {
							gotArgs = obj
						}
					} catch (e) {
						continue
					}
				}

				if (typeof gotArgs === "undefined") {
					return log.error(new Error("[fm-to-sync-client-message] gotArgs undefined"))
				}

				if (gotArgs.type === "download-folder") {
					ipc.openDownloadWindow(gotArgs).catch(log.error)
				}
			} catch (e) {
				log.error(e)
			}
		}
	})
}

export const sendToAllPorts = (data: any) => ipcRenderer.send("proxy-global-message", data)
