// SPDX-License-Identifier: MulanPSL-2.0
import { t } from "./i18n";
import { MessagePlugin } from "tdesign-react";
import type { UserSettings } from "./types";

export function showError(error: unknown) {
  void MessagePlugin.error(error instanceof Error ? error.message : t("Operation failed"));
}
export function action(task: () => Promise<unknown>) {
  void task().catch(showError);
}
export function settingsObject(value: unknown): UserSettings {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UserSettings) : {};
}
export function selectString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function displayValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
