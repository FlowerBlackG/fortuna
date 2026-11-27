// SPDX-License-Identifier: MulanPSL-2.0
import { arch, platform } from "node:process";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import manifest from "./package.json" with { type: "json" };
import { build, Platform, Arch } from "electron-builder";

const mac = platform === "darwin" && arch === "arm64";
const win = platform === "win32" && arch === "x64";
if (!mac && !win) throw new Error("Build on native Apple Silicon or Windows x64");
const signed = process.argv.includes("--signed");
if (
  mac &&
  signed &&
  !(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)
) {
  throw new Error("Set Apple notarization credentials for the signed release");
}
for (const target of mac ? ["dir"] : ["nsis", "zip"]) {
  const portable = win && target === "zip";
  await build({
    projectDir: import.meta.dirname,
    targets: (mac ? Platform.MAC : Platform.WINDOWS).createTarget(
      target,
      mac ? Arch.arm64 : Arch.x64,
    ),
    publish: "never",
    config: {
      appId: "org.flowerblackg.fortuna",
      productName: "Fortuna",
      icon: "icon.png",
      artifactName: `Fortuna-\${version}-\${os}-\${arch}${portable ? "-portable" : ""}${signed ? "" : "-dev"}.\${ext}`,
      directories: {
        buildResources: "resources",
        output: `../build/desktop/${portable ? "portable" : "installed"}`,
      },
      extraMetadata: { main: "main.mjs" },
      files: [
        "package.json",
        { from: "../build/electron", to: ".", filter: ["*.mjs", "*.cjs"] },
        { from: "../build/ui", to: "ui" },
      ],
      extraResources: [{ from: "../build/backend/fortuna-backend", to: "fortuna-backend" }],
      electronFuses: {
        runAsNode: false,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        onlyLoadAppFromAsar: true,
        enableEmbeddedAsarIntegrityValidation: true,
      },
      forceCodeSigning: signed,
      mac: {
        minimumSystemVersion: "26.0",
        hardenedRuntime: signed,
        identity: signed ? undefined : "-",
        entitlements: "entitlements.plist",
        entitlementsInherit: "entitlements.plist",
        notarize: signed,
        binaries: ["Contents/Resources/fortuna-backend/fortuna-backend"],
      },
      win: { signExts: signed ? [".dll", ".pyd"] : [] },
      nsis: { oneClick: true, perMachine: false, deleteAppDataOnUninstall: false },
      afterPack: portable
        ? (ctx) => writeFile(path.join(ctx.appOutDir, "resources/portable.flag"), "")
        : undefined,
    },
  });
}
if (mac) {
  const output = path.resolve(import.meta.dirname, "../build/desktop/installed");
  execFileSync("/usr/bin/ditto", [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    path.join(output, "mac-arm64/Fortuna.app"),
    path.join(output, `Fortuna-${manifest.version}-mac-arm64${signed ? "" : "-adhoc"}.zip`),
  ]);
}
