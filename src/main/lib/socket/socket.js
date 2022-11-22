const io = require("socket.io-client")
const log = require("electron-log")

let HEARTBEAT_INTERVAL = undefined
let SOCKET = undefined

const auth = async () => {
    const apiKey = await new Promise((resolve) => {
        const waitForLoggedInInterval = setInterval(() => {
            Promise.all([
                require("../db").get("isLoggedIn"),
                require("../db").get("apiKey")
            ]).then(([isLoggedIn, apiKey]) => {
                if(isLoggedIn && typeof apiKey == "string" && apiKey.length >= 32){
                    clearInterval(waitForLoggedInInterval)

                    return resolve(apiKey)
                }
            }).catch(log.error)
        }, 1000)
    })

    log.info("Sending socket auth")

    if(typeof SOCKET !== "undefined" && typeof SOCKET.emit == "function" && SOCKET.connected){
        SOCKET.emit("auth", {
            apiKey
        })
    }

    return true
}

const listen = () => {
    return new Promise((resolve) => {
        require("../shared").remove("SOCKET")

        SOCKET = io("https://socket.filen.io", {
            path: "",
            timeout: 15000,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            transports: [
                "websocket"
            ]
        })

        SOCKET.on("connect", () => {
            log.info("Socket connected")

            require("../shared").set("SOCKET", SOCKET)

            auth()

            clearInterval(HEARTBEAT_INTERVAL)

            HEARTBEAT_INTERVAL = setInterval(() => {
                if(typeof SOCKET !== "undefined" && typeof SOCKET.emit == "function" && SOCKET.connected){
                    SOCKET.emit("heartbeat")
                }
            }, 5000)
        })

        SOCKET.on("disconnect", () => {
            log.warn("Socket disconnected")

            clearInterval(HEARTBEAT_INTERVAL)

            require("../shared").remove("SOCKET")
        })

        SOCKET.on("fm-to-sync-client-message", (data) => {
            require("../ipc").emitGlobal("socket-event", {
                type: "fm-to-sync-client-message",
                data
            })
        })

        return resolve(true)
    })
}

module.exports = {
    listen
}