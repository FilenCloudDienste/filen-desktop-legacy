import React from "react"
import "./renderer/styles/index.css"
import App from "./renderer/App"
import { createRoot } from "react-dom/client"
import * as Sentry from "@sentry/electron/renderer"

const is = window.require("electron-is")
const log = window.require("electron-log")

Object.assign(console, log.functions)

if(!is.dev()){
    Sentry.init({
        dsn: "https://765df844a3364aff92ec3648f1815ff8@o4504039703314432.ingest.sentry.io/4504205266321408",
        beforeSend: (event) =>{
            try{
                log.error(event.exception?.values)
            }
            catch(e){
                console.error(e)
            }

            return event
        }
    })
}

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