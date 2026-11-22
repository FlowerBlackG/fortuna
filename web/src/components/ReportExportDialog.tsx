// SPDX-License-Identifier: MulanPSL-2.0
import { useState } from "react";
import { Checkbox, Dialog, Form, Select, Space, Switch } from "tdesign-react";
import { request } from "../api";
import { getLanguage, languageOptions, t } from "../i18n";
import { reportGroupings, type GroupBy } from "../calculations";
import { selectString, showError } from "../helpers";
import { reportFields } from "../reportFields";
import { filterRecords } from "../recordState";
import { isEarlierReport, type ReportSnapshot } from "../reportComparison";
import type { ReportExport } from "../reportExport";
import type { AssetRecord, Report } from "../types";
import { useLoad } from "../useLoad";
import { EditorField } from "./Editor";

function EarlierReportPicker({
  current,
  value,
  onChange,
  busy,
}: {
  current: Report;
  value: string;
  onChange: (id: string) => void;
  busy: boolean;
}) {
  const { data, loading, error } = useLoad(async () => {
    const reports = await request<Report[]>("GET", "/reports");
    return reports.filter((report) => isEarlierReport(report, current));
  }, [current.report_id, current.report_time]);
  return (
    <EditorField
      label={t("Earlier report")}
      warning={error}
      help={data && !data.length ? t("No earlier reports") : undefined}
    >
      <Select
        value={value}
        loading={loading}
        disabled={busy || !data?.length}
        filterable
        onChange={(value) => onChange(selectString(value))}
        options={data?.map((report) => ({
          value: report.report_id,
          label: [report.title.trim(), new Date(report.report_time).toLocaleString(getLanguage())]
            .filter(Boolean)
            .join(" · "),
        }))}
      />
    </EditorField>
  );
}

export function ReportExportDialog({ input, close }: { input: ReportExport; close: () => void }) {
  const [currency, setCurrency] = useState(input.currency);
  const [language, setLanguage] = useState(getLanguage);
  const [groupings, setGroupings] = useState<GroupBy[]>(() =>
    reportGroupings.map(({ key }) => key),
  );
  const [fields] = useState(() => reportFields(input.records, input.metadata.asset_types));
  const [selected, setSelected] = useState(() => new Set(fields.map((f) => f.key)));
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState(false);
  const [earlierId, setEarlierId] = useState("");
  const canExport = groupings.length > 0 && (!compare || !!earlierId);
  async function download() {
    if (busy || !canExport) return;
    setBusy(true);
    try {
      let comparison: ReportSnapshot | undefined;
      if (compare) {
        const [report, records] = await Promise.all([
          request<Report>("GET", `/reports/${earlierId}`),
          request<AssetRecord[]>("GET", `/records?report_id=${earlierId}`),
        ]);
        if (!isEarlierReport(report, input.report)) {
          setEarlierId("");
          setCompare(false);
          throw new Error(t("The selected report is no longer earlier than this report"));
        }
        comparison = {
          report,
          records: input.filters ? filterRecords(records, input.filters, input.metadata) : records,
        };
      }
      const { downloadReport } = await import("../reportExport");
      await downloadReport({
        ...input,
        currency,
        selectedFields: selected,
        language,
        groupings,
        comparison,
      });
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
        disabled: !canExport,
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
        <EditorField label={t("Compare with an earlier report")}>
          <Switch
            aria-label={t("Compare with an earlier report")}
            value={compare}
            disabled={busy}
            onChange={(value) => {
              setCompare(Boolean(value));
              setEarlierId("");
            }}
          />
        </EditorField>
        {compare && (
          <EarlierReportPicker
            current={input.report}
            value={earlierId}
            onChange={setEarlierId}
            busy={busy}
          />
        )}
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
