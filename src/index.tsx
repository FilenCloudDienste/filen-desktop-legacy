import React from "react"
import "./renderer/styles/index.css"
import App from "./renderer/App"
import * as ReactDOM from "react-dom/client"
import { createStandaloneToast } from "@chakra-ui/react"

// @ts-ignore
process.noAsar = true

const log = window.require("electron-log")
const { ToastContainer } = createStandaloneToast()

Object.assign(console, log.functions)

window.require("electron-disable-file-drop")

ReactDOM.createRoot(document.getElementById("root")!).render(
	<>
		<App />
		<ToastContainer />
	</>
)
