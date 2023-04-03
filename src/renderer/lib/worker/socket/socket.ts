import db from "../../db"
import eventListener from "../../eventListener"

const io = window.require("socket.io-client")
const log = window.require("electron-log")

let HEARTBEAT_INTERVAL: NodeJS.Timer
let SOCKET: any = undefined

const auth = async (): Promise<void> => {
	const apiKey = await new Promise(resolve => {
		const waitForLoggedInInterval = setInterval(() => {
			Promise.all([db.get("isLoggedIn"), db.get("apiKey")])
				.then(([isLoggedIn, apiKey]) => {
					if (isLoggedIn && typeof apiKey == "string" && apiKey.length >= 32) {
						clearInterval(waitForLoggedInInterval)

						return resolve(apiKey)
					}
				})
				.catch(log.error)
		}, 1000)
	})

	log.info("Sending socket auth")

	if (typeof SOCKET !== "undefined" && typeof SOCKET.emit == "function" && SOCKET.connected) {
		SOCKET.emit("auth", {
			apiKey
		})
	}
}

export const listen = (): void => {
	try {
		SOCKET = io("https://socket.filen.io", {
			path: "",
			timeout: 15000,
			reconnection: true,
			reconnectionAttempts: Infinity,
			reconnectionDelay: 1000,
			transports: ["websocket"]
		})

		SOCKET.on("connect", () => {
			log.info("Socket connected")

			auth()

			clearInterval(HEARTBEAT_INTERVAL)

			HEARTBEAT_INTERVAL = setInterval(() => {
				if (typeof SOCKET !== "undefined" && typeof SOCKET.emit == "function" && SOCKET.connected) {
					SOCKET.emit("heartbeat")
				}
			}, 5000)
		})

		SOCKET.on("disconnect", () => {
			log.warn("Socket disconnected")

			clearInterval(HEARTBEAT_INTERVAL)
		})

		SOCKET.on("fm-to-sync-client-message", (data: any) => {
			eventListener.emit("socket-event", {
				type: "fm-to-sync-client-message",
				data
			})
		})
	} catch (e) {
		log.error(e)

		setTimeout(listen, 5000)
	}
}

export default {
	listen
}
