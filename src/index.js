import React from "react"
import "./renderer/styles/index.css"
import App from "./renderer/App"
import { createRoot } from "react-dom/client"

window.require("electron-disable-file-drop")

window.onkeydown = (e) => {
    if([82, 91].includes(e.which) && (e.ctrlKey || e.altKey || e.metaKey)){
        e.preventDefault()
    }
}

window.onkeyup = (e) => {
    if([82, 91].includes(e.which) && (e.ctrlKey || e.altKey || e.metaKey)){
        e.preventDefault()
    }
}

createRoot(document.getElementById("root")).render(<App />)