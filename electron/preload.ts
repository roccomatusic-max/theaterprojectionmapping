import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("api", {
  invoke: (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args),
  on: (ch: string, fn: (...a: unknown[]) => void) => {
    const h = (_e: unknown, ...a: unknown[]) => fn(...a);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  },
  send: (ch: string, ...args: unknown[]) => ipcRenderer.send(ch, ...args),
});
