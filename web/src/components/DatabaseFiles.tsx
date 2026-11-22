// SPDX-License-Identifier: MulanPSL-2.0
import { useState } from "react";
import { Alert, Button, Space } from "tdesign-react";
import { FolderOpenIcon, AddIcon } from "tdesign-icons-react";
import { chooseDatabase, runtime, switchMode } from "../desktop";
import { t } from "../i18n";

export function DatabaseFiles({ showName = true }: { showName?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function select(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Space direction="vertical">
      {showName && runtime?.mode === "file" && <strong>{runtime.databaseName}</strong>}
      <span className="muted">{t("Sign in or create an account in the database you choose.")}</span>
      <Space breakLine>
        <Button
          shape="round"
          theme="default"
          icon={<FolderOpenIcon />}
          disabled={busy}
          onClick={() => void select(() => chooseDatabase("open"))}
        >
          {t("Open database…")}
        </Button>
        <Button
          shape="round"
          theme="default"
          variant="outline"
          icon={<AddIcon />}
          disabled={busy}
          onClick={() => void select(() => chooseDatabase("create"))}
        >
          {t("Create database…")}
        </Button>
      </Space>
      {runtime?.mode !== "file" && runtime?.databaseName && (
        <Button
          shape="round"
          theme="default"
          variant="text"
          disabled={busy}
          onClick={() => void select(() => switchMode("file"))}
        >
          {t("Reopen {0}", runtime.databaseName)}
        </Button>
      )}
      {error && (
        <Alert
          theme="error"
          title={t("Could not open the workspace")}
          message={
            <details>
              <summary>{t("Diagnostics")}</summary>
              <pre className="database-diagnostics">{error}</pre>
            </details>
          }
        />
      )}
    </Space>
  );
}
