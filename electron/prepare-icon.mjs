// SPDX-License-Identifier: MulanPSL-2.0
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(import.meta.dirname, "../build/electron");
export const desktopIconPath = path.join(output, "desktop-icon.png");

const mac = process.platform === "darwin";
if (mac || process.platform === "win32") {
  const { PNG } = (await import("pngjs")).default;
  const source = path.join(import.meta.dirname, "resources/icon.png");
  const icon = PNG.sync.read(await readFile(source));
  if (icon.width !== icon.height) throw new Error("The desktop icon must be square");

  // Mask the background to an inset rounded square without resizing the artwork.
  const size = icon.width;
  const center = size / 2;
  const radius = ((mac ? 185 : 160) / 1024) * size;
  const padding = ((mac ? 100 : 48) / 1024) * size;
  const flatEdge = center - padding - radius;
  for (let y = 0; y < size; y++) {
    const dy = Math.max(0, Math.abs(y + 0.5 - center) - flatEdge);
    for (let x = 0; x < size; x++) {
      const dx = Math.max(0, Math.abs(x + 0.5 - center) - flatEdge);
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - Math.hypot(dx, dy)));
      const alpha = (y * size + x) * 4 + 3;
      icon.data[alpha] = Math.round(icon.data[alpha] * coverage);
    }
  }

  await mkdir(output, { recursive: true });
  await writeFile(desktopIconPath, PNG.sync.write(icon));
}
