// SPDX-License-Identifier: MulanPSL-2.0
import { useSyncExternalStore } from "react";
import { zhCN } from "./zhCN";

export type Language = "en-US" | "zh-CN";
export const languageOptions = [
  { value: "en-US", label: "English" },
  { value: "zh-CN", label: "简体中文" },
];
const key = "fortuna.language";
const read = (): Language =>
  typeof window !== "undefined" && window.localStorage.getItem(key) === "zh-CN" ? "zh-CN" : "en-US";
let language = read();
const listeners = new Set<() => void>();
function refresh() {
  language = read();
  listeners.forEach((listener) => listener());
}
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key === key || e.key === null) refresh();
  });
export function setLanguage(value: Language) {
  localStorage.setItem(key, value);
  refresh();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getLanguage = () => language;
export function useLanguage() {
  return useSyncExternalStore(subscribe, getLanguage);
}

export function translate(locale: Language, key: keyof typeof zhCN, ...args: (string | number)[]) {
  const text = locale === "zh-CN" ? zhCN[key] : key;
  return args.length
    ? text.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]))
    : text;
}

export function t(key: keyof typeof zhCN, ...args: (string | number)[]) {
  return translate(language, key, ...args);
}

export function serverMessage(message: string) {
  return Object.hasOwn(zhCN, message) ? t(message as keyof typeof zhCN) : message;
}
