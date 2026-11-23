import { contextBridge, ipcRenderer } from "electron";
import { ipc, type DesktopApi } from "../shared/ipc";

function invoke<A extends unknown[], T>(route: {
  channel: string; request: { parse: (input: unknown) => unknown[] }; response: { parse: (input: unknown) => T };
}) {
  return async (...args: A): Promise<T> => route.response.parse(await ipcRenderer.invoke(route.channel, ...route.request.parse(args)));
}

const api: DesktopApi = {
  franchises: invoke(ipc.franchises), setFranchise: invoke(ipc.setFranchise),
  openAllocine: invoke(ipc.openAllocine),
  discoveryCurrent: invoke(ipc.discoveryCurrent), discoveryGenerate: invoke(ipc.discoveryGenerate),
  discoveryPosters: invoke(ipc.discoveryPosters), discoveryExport: invoke(ipc.discoveryExport),
  labCurrent: invoke(ipc.labCurrent), labStart: invoke(ipc.labStart), labPause: invoke(ipc.labPause),
  labAbandon: invoke(ipc.labAbandon), labAnswer: invoke(ipc.labAnswer), labFinish: invoke(ipc.labFinish), labResults: invoke(ipc.labResults),
  labTransferSeen: invoke(ipc.labTransferSeen),
  labExport: invoke(ipc.labExport),
  collection: async () => ipc.collection.response.parse(await ipcRenderer.invoke(ipc.collection.channel)),
  deferViewing: async (...args) => ipc.deferViewing.response.parse(await ipcRenderer.invoke(
    ipc.deferViewing.channel, ...ipc.deferViewing.request.parse(args),
  )),
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
