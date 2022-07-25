import React from "react"
import "./renderer/styles/index.css"
import App from "./renderer/App"
import { createRoot } from "react-dom/client"

// @ts-ignore
process.noAsar = true

window.require("electron-disable-file-drop")

const keyEvent = (e: KeyboardEvent) => {
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