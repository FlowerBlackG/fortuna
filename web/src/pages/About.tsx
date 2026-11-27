// SPDX-License-Identifier: MulanPSL-2.0
import { t } from "../i18n";
import { Card, Descriptions, Tag } from "tdesign-react";
import { Logo } from "../components/Logo";
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
  const builds: ["Server" | "Web", BuildInfo][] = [
    ["Server", server],
    ["Web", Version],
  ];
  return (
    <Card className="about-card">
      <header>
        <Logo size={48} />
        <h1 style={{ marginTop: 24 }}>Fortuna</h1>
      </header>
      <Descriptions
        column={1}
        tableLayout="auto"
        colon={false}
        items={[
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
          ...builds.flatMap(([name, build]) => [
            {
              label: t(`${name} version`),
              content: build.code == null ? build.tag : `${build.tag} (${build.code})`,
            },
            { label: t(`${name} build`), content: buildTime(build.buildTime) },
          ]),
        ]}
      />
    </Card>
  );
}
