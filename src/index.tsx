import React from "react"
import "./renderer/styles/index.css"
import App from "./renderer/App"
import { createRoot } from "react-dom/client"

// @ts-ignore
process.noAsar = true

window.require("electron-disable-file-drop")

window.onkeydown = (e: KeyboardEvent) => {
    if(
        e.which == 82
        || e.which == 82 && e.ctrlKey
        || e.which == 82 && e.metaKey
        || e.which == 82 && e.altKey
    ){
        e.preventDefault()
    }
}

window.onkeyup = (e: KeyboardEvent) => {
    if(
        e.which == 82
        || e.which == 82 && e.ctrlKey
        || e.which == 82 && e.metaKey
        || e.which == 82 && e.altKey
    ){
        e.preventDefault()
    }
}

// @ts-ignore
createRoot(document.getElementById("root")).render(<App />)