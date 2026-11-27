// SPDX-License-Identifier: MulanPSL-2.0
import { build } from "vite-plus";

export function watchDesktopRenderer() {
  return build({
    root: import.meta.dirname,
    mode: "desktop",
    build: {
      outDir: "../build/ui-dev",
      emptyOutDir: true,
      watch: {},
    },
  });
}
