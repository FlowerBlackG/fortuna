// SPDX-License-Identifier: MulanPSL-2.0
import { t } from "../i18n";
import { Button, Descriptions, Tag } from "tdesign-react";
import { Logo } from "../components/Logo";
import { desktop } from "../desktop";
import Version, { type BuildInfo, type ServerInfo } from "../version";

function buildTime(value?: string) {
  const match = value?.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) return t("Unavailable");
  const [, date, time, offset] = match;
  const zone =
    offset === "+08:00"
      ? "CST"
      : offset === "Z"
        ? "+0"
        : offset.replace(/^([+-])0/, "$1").replace(/:00$/, "");
  return `${date} ${time} ${zone}`;
}

export function AboutPage({ server }: { server: ServerInfo }) {
  const versions = desktop?.versions;
  const builds: ["Server" | "Web", BuildInfo][] = [
    ["Web", Version],
    ["Server", server],
  ];
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: 24,
    }}>

      <Logo size={48} />
      <h1 style={{ marginTop: 24 }}>Fortuna</h1>

      <Button
        style={{ 
          visibility: "hidden",
          height: 0,
          margin: 0,
          padding: 0
          // TODO
        }}
        onClick={() => {
          const url = "https://github.com/FlowerBlackG/fortuna"
          // TODO
        }}
      >GitHub</Button>

      <Descriptions
        column={1}
        style={{ marginTop: 24 }}
        labelStyle={{ paddingInlineEnd: 28 }}
        tableLayout="auto"
        colon={false}
        items={[
          ...builds.flatMap(([name, build]) => [
            {
              label: t(`${name} version`),
              content: build.code == null ? build.tag : `${build.tag} (${build.code})`,
            },
            { label: t(`${name} build`), content: buildTime(build.buildTime) },
          ]),

          {
            label: t("Server environment"),
            content: server.environment ? (
              <Tag shape="round" theme="primary" variant="light">
                {t(server.environment)}
              </Tag>
            ) : (
              t("Unavailable")
            ),
          },

          ...(versions
            ? [
                { label: "Electron", content: versions.electron },
                { label: "Chromium", content: versions.chromium },
              ]
            : []),
        ]}
      />
    </div>
  );
}
