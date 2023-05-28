const { ipcRenderer } = window.require("electron")

export const sendToAllPorts = (data: any) => ipcRenderer.send("proxy-global-message", data)
