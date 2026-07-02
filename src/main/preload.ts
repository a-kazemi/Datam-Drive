import { contextBridge, ipcRenderer } from 'electron'

// Expose a safe, minimal API surface to the renderer via context isolation
contextBridge.exposeInMainWorld('datamDrive', {
  invoke: (channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),

  on: (channel: string, fn: (...args: unknown[]) => void) => {
    const listener = (_: Electron.IpcRendererEvent, ...args: unknown[]) => fn(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
})
