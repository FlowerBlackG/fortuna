// SPDX-License-Identifier: MulanPSL-2.0
import type { ConnectionMode, DesktopAPI, DesktopRuntime } from "../../shared/desktop";
declare global {
  interface Window {
    fortunaDesktop?: DesktopAPI;
  }
}

export const desktopBuild = import.meta.env.MODE === "desktop";
export const desktop = desktopBuild ? window.fortunaDesktop : undefined;
export let runtime: DesktopRuntime | undefined;
export function initializeRuntime(value: DesktopRuntime) {
  runtime = value;
}
export const isBuiltin = () => runtime?.mode === "builtin";
export const isLocal = () => isBuiltin() || runtime?.mode === "file";

export async function switchMode(mode: ConnectionMode) {
  if (!desktop) throw new Error("Desktop unavailable");
  await desktop.setMode(mode);
  reloadWorkspace();
}

export async function chooseDatabase(action: "open" | "create") {
  if (await desktop?.chooseDatabase(action)) reloadWorkspace();
}

function reloadWorkspace() {
  window.location.hash = "/reports";
  window.location.reload();
}
