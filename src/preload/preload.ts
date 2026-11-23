import { contextBridge, ipcRenderer } from "electron";
import { ipc, type DesktopApi } from "../shared/ipc";

const api: DesktopApi = {
  collection: async () => ipc.collection.response.parse(await ipcRenderer.invoke(ipc.collection.channel)),
  saveFeedback: async (...args) => ipc.saveFeedback.response.parse(await ipcRenderer.invoke(
    ipc.saveFeedback.channel, ...ipc.saveFeedback.request.parse(args),
  )),
  recommend: async (...args) => ipc.recommend.response.parse(await ipcRenderer.invoke(
    ipc.recommend.channel, ...ipc.recommend.request.parse(args),
  )),
  enrichment: async () => ipc.enrichment.response.parse(await ipcRenderer.invoke(ipc.enrichment.channel)),
  summary: async () => ipc.summary.response.parse(await ipcRenderer.invoke(ipc.summary.channel)),
  importProfile: async () => ipc.importProfile.response.parse(await ipcRenderer.invoke(ipc.importProfile.channel)),
};

contextBridge.exposeInMainWorld("afterDark", api);
