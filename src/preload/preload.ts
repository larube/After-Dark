import { contextBridge, ipcRenderer } from "electron";
import { ipc, type DesktopApi } from "../shared/ipc";

const api: DesktopApi = {
  summary: async () => ipc.summary.response.parse(await ipcRenderer.invoke(ipc.summary.channel)),
  importProfile: async () => ipc.importProfile.response.parse(await ipcRenderer.invoke(ipc.importProfile.channel)),
};

contextBridge.exposeInMainWorld("afterDark", api);
