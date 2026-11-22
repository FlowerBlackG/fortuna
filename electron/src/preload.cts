// SPDX-License-Identifier: MulanPSL-2.0
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DesktopAPI, DesktopOperations } from "../../shared/desktop.js";

function invoke<T>(name: keyof DesktopOperations, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(`fortuna:${name}`, ...args);
}
const api: DesktopAPI = {
  runtime: () => invoke("runtime"),
  setMode: (mode) => invoke("setMode", mode),
  chooseDatabase: (action) => invoke("chooseDatabase", action),
  connect: (address) => invoke("connect", address),
  ping: (address) => invoke("ping", address),
  request: (mode, address, token, method, route, data) =>
    invoke("request", mode, address, token, method, route, data),
  reveal: () => invoke("reveal"),
  backup: () => invoke("backup"),
  onUnavailable: (callback) => {
    const listener = (_event: IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on("fortuna:unavailable", listener);
    return () => {
      ipcRenderer.off("fortuna:unavailable", listener);
    };
  },
};
contextBridge.exposeInMainWorld("fortunaDesktop", api);
