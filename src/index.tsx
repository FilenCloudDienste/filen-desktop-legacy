import React from "react"
import "./renderer/styles/index.css"
import App from "./renderer/App"
import { createRoot } from "react-dom/client"
import * as Sentry from "@sentry/react"
import { BrowserTracing } from "@sentry/tracing"

const is = window.require("electron-is")

if(!is.dev()){
    Sentry.init({
        dsn: "https://0aa7266bc9364f0b9bb7445331e82959@o4504039703314432.ingest.sentry.io/4504057873498112",
        integrations: [new BrowserTracing()],
        tracesSampleRate: 1.0
    })
}

const log = window.require("electron-log")

Object.assign(console, log.functions)

// @ts-ignore
process.noAsar = true

window.require("electron-disable-file-drop")

const keyEvent = (e: KeyboardEvent) => {
    if(window.location.href.indexOf("auth") !== -1){
        return
    }

    if(
        e.which == 116
        || (e.which == 82 && e.ctrlKey)
        || (e.which == 82 && e.metaKey)
        || (e.which == 116 && e.ctrlKey)
        || (e.which == 116 && e.metaKey)
    ){
        e.preventDefault()
    }
}

window.onkeydown = keyEvent
window.onkeyup = keyEvent

// @ts-ignore
createRoot(document.getElementById("root")).render(<App />)