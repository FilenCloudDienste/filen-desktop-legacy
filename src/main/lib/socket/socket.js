const io = require("socket.io-client")
const log = require("electron-log")
const shared = require("../shared")
const db = require("../db")

let HEARTBEAT_INTERVAL = undefined

const auth = async (socket) => {
    const apiKey = await new Promise((resolve) => {
        const waitForLoggedInInterval = setInterval(() => {
            Promise.all([
                db.get("isLoggedIn"),
                db.get("apiKey")
            ]).then(([isLoggedIn, apiKey]) => {
                if(isLoggedIn && typeof apiKey == "string" && apiKey.length >= 32){
                    clearInterval(waitForLoggedInInterval)

                    return resolve(apiKey)
                }
            }).catch(log.error)
        }, 1000)
    })

    log.info("Sending socket auth")

    socket.emit("auth", {
        apiKey
    })

    return true
}

const listen = () => {
    return new Promise((resolve) => {
        shared.remove("SOCKET")

        const socket = io("https://socket.filen.io", {
            path: "",
            timeout: 15000,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            transports: [
                "websocket"
            ]
        })

        socket.on("connect", () => {
            log.info("Socket connected")

            shared.set("SOCKET", socket)

            auth(socket)

            HEARTBEAT_INTERVAL = setInterval(() => {
                if(typeof shared.get("SOCKET") == "undefined"){
                    return clearInterval(HEARTBEAT_INTERVAL)
                }

                socket.emit("heartbeat")
            }, 5000)
        })

        socket.on("disconnect", () => {
            log.warn("Socket disconnected")

            clearInterval(HEARTBEAT_INTERVAL)

            shared.remove("SOCKET")
        })

        socket.on("fm-to-sync-client-message", (data) => {
            require("../ipc").emitGlobal("socket-event", {
                type: "fm-to-sync-client-message",
                data
            })
        })

        socket.on("new-event", (data) => {
            require("../ipc").emitGlobal("socket-event", {
                type: "new-event",
                data
            })
        })

        return resolve(true)
    })
}

module.exports = {
    listen
}