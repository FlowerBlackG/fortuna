// SPDX-License-Identifier: MulanPSL-2.0
import { useSyncExternalStore } from "react";
import type { ThemePreference } from "../../shared/desktop";
import { desktop } from "./desktop";

const key = "fortuna.theme";
const changes = new EventTarget();
let preference: ThemePreference = "system";
let resolved: "light" | "dark" = "light";

function subscribe(listener: () => void) {
  changes.addEventListener("change", listener);
  return () => changes.removeEventListener("change", listener);
}

function refresh() {
  const stored = localStorage.getItem(key);
  preference = stored === "dark" || stored === "light" ? stored : "system";
  const systemTheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  resolved = preference === "system" ? systemTheme : preference;
  document.documentElement.setAttribute("theme-mode", resolved);
  changes.dispatchEvent(new Event("change"));
}

function syncPreference() {
  refresh();
  void desktop?.setTheme(preference).catch(console.error);
}

export function initializeTheme() {
  syncPreference();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", refresh);
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) syncPreference();
  });
}

export function setTheme(value: ThemePreference) {
  localStorage.setItem(key, value);
  syncPreference();
}

export const useThemePreference = () => useSyncExternalStore(subscribe, () => preference);
export const useResolvedTheme = () => useSyncExternalStore(subscribe, () => resolved);
