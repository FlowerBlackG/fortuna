// SPDX-License-Identifier: MulanPSL-2.0
export const defaultFonts = {
  English: "Linux Libertine O",
  "Non-English": "MiSans",
  "English Mono": "Linux Libertine Mono O",
  "Non-English Mono": "MiSans",
};
export type FontRole = keyof typeof defaultFonts;
export const fontRoles = Object.keys(defaultFonts) as FontRole[];
export function savedFont(role: FontRole) {
  return localStorage.getItem(`fortuna.exportFont.${role}`) ?? "";
}
export function setFont(role: FontRole, name: string) {
  if (name.trim()) localStorage.setItem(`fortuna.exportFont.${role}`, name);
  else localStorage.removeItem(`fortuna.exportFont.${role}`);
}
export function exportFonts() {
  const fonts = { ...defaultFonts };
  for (const role of fontRoles) fonts[role] = savedFont(role).trim() || defaultFonts[role];
  return fonts;
}
