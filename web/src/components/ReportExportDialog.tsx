// SPDX-License-Identifier: MulanPSL-2.0
import { useState } from "react";
import { Checkbox, Dialog, Form, Select, Space } from "tdesign-react";
import { getLanguage, languageOptions, t } from "../i18n";
import { reportGroupings, type GroupBy } from "../calculations";
import { selectString, showError } from "../helpers";
import { reportFields } from "../reportFields";
import type { ReportExport } from "../reportExport";
import { EditorField } from "./Editor";

export function ReportExportDialog({ input, close }: { input: ReportExport; close: () => void }) {
  const [currency, setCurrency] = useState(input.currency);
  const [language, setLanguage] = useState(getLanguage);
  const [groupings, setGroupings] = useState<GroupBy[]>(() =>
    reportGroupings.map(({ key }) => key),
  );
  const [fields] = useState(() => reportFields(input.records, input.metadata.asset_types));
  const [selected, setSelected] = useState(() => new Set(fields.map((f) => f.key)));
  const [busy, setBusy] = useState(false);
  async function download() {
    if (busy || !groupings.length) return;
    setBusy(true);
    try {
      const { downloadReport } = await import("../reportExport");
      await downloadReport({ ...input, currency, selectedFields: selected, language, groupings });
      close();
    } catch (error) {
      showError(error);
      setBusy(false);
    }
  }
  return (
    <Dialog
      visible
      className="editor-dialog"
      header={t("Export report")}
      placement="center"
      confirmBtn={{
        tag: "button",
        shape: "round",
        content: t("Export"),
        loading: busy,
        disabled: !groupings.length,
      }}
      onConfirm={() => void download()}
      onClose={() => {
        if (!busy) close();
      }}
      closeOnOverlayClick={false}
    >
      <Form labelAlign="top">
        <EditorField
          label={t("Group by")}
          warning={!groupings.length && t("Select at least one grouping")}
        >
          <Checkbox.Group<GroupBy[]>
            disabled={busy}
            value={groupings}
            options={reportGroupings.map(({ key, label }) => ({ value: key, label: t(label) }))}
            onChange={setGroupings}
          />
        </EditorField>
        <EditorField label={t("Report language")}>
          <Select
            disabled={busy}
            value={language}
            options={languageOptions}
            onChange={(value) => setLanguage(value === "zh-CN" ? "zh-CN" : "en-US")}
          />
        </EditorField>
        <EditorField label={t("Preferred currency")}>
          <Select
            disabled={busy}
            value={currency}
            onChange={(value) => setCurrency(selectString(value))}
            options={[
              { value: "", label: t("Original currencies") },
              ...input.metadata.currencies.map((c) => ({ value: c.currency_id, label: c.name })),
            ]}
          />
        </EditorField>
        {fields.length > 0 && <h3>{t("Custom fields")}</h3>}
        {input.metadata.asset_types.map((type) => {
          const columns = fields.filter((column) => column.assetType === type);
          if (!columns.length) return null;
          return (
            <EditorField key={type.asset_type_id} label={type.name}>
              <Space breakLine>
                {columns.map(({ key, field }) => (
                  <Checkbox
                    key={key}
                    disabled={busy}
                    checked={selected.has(key)}
                    onChange={(checked) =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        if (checked) next.add(key);
                        else next.delete(key);
                        return next;
                      })
                    }
                  >
                    {field.field_name}
                  </Checkbox>
                ))}
              </Space>
            </EditorField>
          );
        })}
      </Form>
    </Dialog>
  );
}
