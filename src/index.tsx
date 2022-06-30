import React from "react"
import "./renderer/styles/index.css"
import App from "./renderer/App"
import { createRoot } from "react-dom/client"

// @ts-ignore
process.noAsar = true

window.require("electron-disable-file-drop")

window.onkeydown = (e: any) => {
    if([82, 91].includes(e.which) && (e.ctrlKey || e.altKey || e.metaKey)){
        e.preventDefault()
    }
}

window.onkeyup = (e: any) => {
    if([82, 91].includes(e.which) && (e.ctrlKey || e.altKey || e.metaKey)){
        e.preventDefault()
    }
}

// @ts-ignore
createRoot(document.getElementById("root")).render(<App />)