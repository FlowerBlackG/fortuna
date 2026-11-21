// SPDX-License-Identifier: MulanPSL-2.0
import { getLanguage, t } from "../i18n";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { v7 as uuidv7 } from "uuid";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Input,
  Loading,
  MessagePlugin,
  Popconfirm,
  Space,
  Switch,
  Table,
} from "tdesign-react";
import type { PrimaryTableCol } from "tdesign-react";
import { DeleteIcon, DownloadIcon, RefreshIcon } from "tdesign-icons-react";
import { request } from "../api";
import { action, settingsObject, showError } from "../helpers";
import { useLoad } from "../useLoad";
import { useMetadata } from "../metadata";
import { convertTotals, number, reportTitle } from "../calculations";
import type { AssetRecord, ExchangeRate, Report } from "../types";
import { ReportExchangeRates } from "../components/ReportExchangeRates";
import {
  FilterControls,
  RecordEditor,
  RecordTable,
  RecordTotals,
  ValuationControls,
} from "../components/Records";
import { emptyFilters, filterRecords, useDefaultCurrency, usePrecision } from "../recordState";
import type { RecordDraft, RecordStatus } from "../components/Records";
import { useTableSort } from "../tableState";
import type { ReportExport } from "../reportExport";
import { ReportExportDialog } from "../components/ReportExportDialog";

const ReportDistribution = lazy(() =>
  import("../components/ReportDistribution").then((module) => ({
    default: module.ReportDistribution,
  })),
);

function ExportButton({
  getInput,
  disabled,
  compact,
}: {
  getInput: () => ReportExport | Promise<ReportExport>;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState<ReportExport>();
  async function open() {
    setLoading(true);
    try {
      setInput(await getInput());
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <Button
        shape="round"
        variant={compact ? "text" : "outline"}
        icon={<DownloadIcon />}
        aria-label={t("Export report")}
        title={t("Export report")}
        loading={loading}
        disabled={disabled}
        onClick={() => action(open)}
      >
        {compact ? undefined : t("Export")}
      </Button>
      {input && <ReportExportDialog input={input} close={() => setInput(undefined)} />}
    </>
  );
}

export function ReportsPage() {
  const navigate = useNavigate();
  const { metadata, refresh } = useMetadata();
  const state = useLoad(async () => {
    const [reports] = await Promise.all([
      request<Report[]>("GET", "/reports?include_totals=true"),
      refresh(),
    ]);
    return reports;
  }, []);
  const [decimals] = usePrecision();
  const defaultId = settingsObject(metadata.settings).default_currency;
  const defaultCurrency = metadata.currencies.find((item) => item.currency_id === defaultId);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  async function create() {
    setCreating(true);
    try {
      const report = await request<Report>("POST", "/reports", {
        report_time: new Date().toISOString(),
      });
      await navigate(`/reports/${report.report_id}`);
    } finally {
      setCreating(false);
    }
  }
  const rows = (state.data || []).filter((report) =>
    reportTitle(report).toLowerCase().includes(search.toLowerCase()),
  );
  const columns: PrimaryTableCol<Report>[] = [
    {
      colKey: "title",
      title: t("Report"),
      sorter: (a, b) => reportTitle(a).localeCompare(reportTitle(b)),
      cell: ({ row }) => <Link to={`/reports/${row.report_id}`}>{reportTitle(row)}</Link>,
    },
    {
      colKey: "report_time",
      title: t("Report time"),
      sorter: (a, b) => Date.parse(a.report_time) - Date.parse(b.report_time),
      cell: ({ row }) => new Date(row.report_time).toLocaleString(getLanguage()),
    },
    {
      colKey: "create_time",
      title: t("Created"),
      sorter: (a, b) => a.create_time.localeCompare(b.create_time),
      cell: ({ row }) => new Date(row.create_time).toLocaleString(getLanguage()),
    },
    {
      colKey: "update_time",
      title: t("Updated"),
      cell: ({ row }) => new Date(row.update_time).toLocaleString(getLanguage()),
    },
    {
      colKey: "actions",
      title: t("Actions"),
      width: 110,
      cell: ({ row }) => (
        <Space size="small">
          <ExportButton
            compact
            getInput={async () => {
              const [report, records, metadata] = await Promise.all([
                request<Report>("GET", `/reports/${row.report_id}`),
                request<AssetRecord[]>("GET", `/records?report_id=${row.report_id}`),
                refresh(),
              ]);
              return {
                report,
                records,
                metadata,
                currency: defaultCurrency?.currency_id ?? "",
                decimals,
              };
            }}
          />
          <Popconfirm
            content={t("Delete this report, its records, and its exchange rates?")}
            onConfirm={() =>
              action(async () => {
                await request("DELETE", `/reports/${row.report_id}`);
                state.setData((current) =>
                  current?.filter((item) => item.report_id !== row.report_id),
                );
              })
            }
          >
            <Button
              shape="round"
              theme="danger"
              variant="text"
              icon={<DeleteIcon />}
              aria-label={t("Delete")}
              title={t("Delete")}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];
  if (defaultCurrency)
    columns.splice(1, 0, {
      colKey: "total",
      title: t("Effective total ({0})", defaultCurrency.name),
      cell: ({ row }) => {
        if (!row.currency_totals) return "—";
        const value = convertTotals(
          row.currency_totals,
          row.exchange_rates,
          defaultCurrency.currency_id,
        );
        return value === null
          ? t("Incomplete — missing conversion")
          : `${number(value, decimals)} ${defaultCurrency.name}`;
      },
    });
  const sorting = useTableSort(rows, columns, { sortBy: "report_time", descending: true });
  return (
    <>
      <div className="page-heading">
        <h1>{t("Reports")}</h1>
        <Button loading={creating} shape="round" onClick={() => action(create)}>
          {t("Create report")}
        </Button>
      </div>
      {state.error && <Alert theme="error" message={state.error} />}
      <Card>
        <div className="toolbar">
          <Input
            clearable
            style={{ width: 280 }}
            placeholder={t("Search reports")}
            value={search}
            onChange={setSearch}
          />
          <Button
            shape="round"
            variant="outline"
            icon={<RefreshIcon />}
            aria-label={t("Refresh")}
            title={t("Refresh")}
            loading={state.loading}
            onClick={() => {
              void state.refresh().catch(() => {});
            }}
          />
        </div>
        <Table
          rowKey="report_id"
          loading={state.loading}
          {...sorting}
          columns={columns}
          pagination={{ total: rows.length, defaultPageSize: 20 }}
          empty={t("No reports yet. Create one to start recording your assets.")}
        />
      </Card>
    </>
  );
}

export function ReportPage() {
  const { reportId = "" } = useParams();
  return <ReportDetail key={reportId} reportId={reportId} />;
}

function ReportDetail({ reportId }: { reportId: string }) {
  const { metadata, refresh: refreshMetadata, ensure } = useMetadata();
  const [records, setRecords] = useState<AssetRecord[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [ratesBusy, setRatesBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [savedTitle, setSavedTitle] = useState("");
  const [savingTime, setSavingTime] = useState(false);
  const state = useLoad(async () => {
    const [report, rows] = await Promise.all([
      request<Report>("GET", `/reports/${reportId}`),
      request<AssetRecord[]>("GET", `/records?report_id=${reportId}`),
      refreshMetadata(),
    ]);
    await ensure(rows);
    setRecords(rows);
    setRates(report.exchange_rates);
    setTitle(report.title);
    setSavedTitle(report.title);
    return { report, rows };
  }, [reportId]);
  const titleQueue = useRef(Promise.resolve());
  const [titleStatus, setTitleStatus] = useState<
    "Saving title…" | "Title saved" | "Title not saved — click Retry"
  >();
  const [editing, setEditing] = useState<AssetRecord | null | undefined>();
  const [editable, setEditable] = useState(true);
  const [statuses, setStatuses] = useState<Record<string, RecordStatus>>({});
  const [filters, setFilters] = useState(emptyFilters);
  const [currency, setCurrency] = useDefaultCurrency();
  const [decimals, setDecimals] = usePrecision();
  const unsynced =
    savingTime ||
    ratesBusy ||
    Object.values(statuses).some((status) => status.saving || status.error);
  useEffect(() => {
    if (!unsynced) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsynced]);
  async function saveTime(timestamp: number) {
    setSavingTime(true);
    try {
      const report = await request<Report>("PATCH", `/reports/${reportId}`, {
        report_time: new Date(timestamp).toISOString(),
      });
      state.setData((current) => current && { ...current, report });
    } finally {
      setSavingTime(false);
    }
  }
  function saveTitle() {
    if (title === savedTitle) return;
    const value = title;
    setSavedTitle(value);
    setTitleStatus("Saving title…");
    titleQueue.current = titleQueue.current.then(async () => {
      try {
        await request("PATCH", `/reports/${reportId}`, { title: value });
        setTitleStatus("Title saved");
      } catch (error) {
        setSavedTitle("\0");
        setTitleStatus("Title not saved — click Retry");
        showError(error);
      }
    });
  }
  function open(record?: AssetRecord) {
    setEditing(record || null);
  }
  function clearStatus(id: string) {
    setStatuses((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }
  async function sync(draft: RecordDraft, record?: AssetRecord, quickInsert = false) {
    const id = record?.record_id || `local:${uuidv7()}`;
    const optimistic = { ...draft, record_id: id, user_id: record?.user_id || "" };
    setRecords((previous) =>
      previous.some((item) => item.record_id === id)
        ? previous.map((item) => (item.record_id === id ? optimistic : item))
        : [...previous, optimistic],
    );
    setStatuses((previous) => ({ ...previous, [id]: { saving: true } }));
    try {
      const saved = await request<AssetRecord>(
        id.startsWith("local:") ? "POST" : "PATCH",
        id.startsWith("local:") ? "/records" : `/records/${id}`,
        draft,
      );
      setRecords((previous) => previous.map((item) => (item.record_id === id ? saved : item)));
      clearStatus(id);
      void MessagePlugin.success(t("Record saved"));
      return true;
    } catch (error) {
      if (quickInsert) {
        setRecords((previous) => previous.filter((item) => item.record_id !== id));
        clearStatus(id);
        showError(error);
      } else {
        setStatuses((previous) => ({
          ...previous,
          [id]: { error: error instanceof Error ? error.message : t("Sync failed") },
        }));
      }
      return false;
    }
  }
  async function remove(record: AssetRecord) {
    setStatuses((previous) => ({ ...previous, [record.record_id]: { saving: true } }));
    try {
      if (!record.record_id.startsWith("local:"))
        await request("DELETE", `/records/${record.record_id}`);
      setRecords((previous) => previous.filter((item) => item.record_id !== record.record_id));
      clearStatus(record.record_id);
    } catch (error) {
      setStatuses((previous) => ({
        ...previous,
        [record.record_id]: {
          operation: "delete",
          error: error instanceof Error ? error.message : t("Delete failed"),
        },
      }));
    }
  }
  if (state.loading && !state.data) return <Loading text={t("Loading report…")} />;
  if (state.error)
    return (
      <Alert
        theme="error"
        message={state.error}
        operation={
          <Button shape="round" variant="text" onClick={() => action(state.refresh)}>
            {t("Retry")}
          </Button>
        }
      />
    );
  const visible = filterRecords(records, filters, metadata);
  return (
    <div className="stack">
      <div className="page-heading">
        <div>
          <Link to="/reports">{t("← All reports")}</Link>
          <h1>{state.data ? reportTitle({ ...state.data.report, title }) : t("Report")}</h1>
          {!editable && state.data && (
            <p className="muted">
              {t("Report time")}:{" "}
              {new Date(state.data.report.report_time).toLocaleString(getLanguage())}
            </p>
          )}
        </div>
        <Space>
          <span>{t("Editing")}</span>
          <Switch
            value={editable}
            disabled={unsynced}
            onChange={(value) => setEditable(Boolean(value))}
          />
        </Space>
      </div>
      <Card>
        {editable && (
          <div className="toolbar">
            {state.data && (
              <DatePicker
                label={t("Report time")}
                enableTimePicker
                allowInput
                valueType="time-stamp"
                format="YYYY-MM-DD HH:mm:ss"
                value={Date.parse(state.data.report.report_time)}
                disabled={savingTime || state.loading}
                onChange={(value) => {
                  if (typeof value === "number") action(() => saveTime(value));
                }}
              />
            )}
            <Input
              style={{ maxWidth: 500 }}
              value={title}
              onChange={setTitle}
              onBlur={saveTitle}
              onEnter={saveTitle}
              placeholder={t("Report title (optional)")}
            />
            <span className="muted">{titleStatus && t(titleStatus)}</span>
            {titleStatus === "Title not saved — click Retry" && (
              <Button shape="round" variant="text" onClick={saveTitle}>
                {t("Retry")}
              </Button>
            )}
          </div>
        )}
        <ValuationControls
          currency={currency}
          setCurrency={setCurrency}
          decimals={decimals}
          setDecimals={setDecimals}
        />
        <FilterControls value={filters} onChange={setFilters} />
        <RecordTotals records={visible} rates={rates} currency={currency} decimals={decimals} />
        <div className="toolbar">
          <span className="muted">{t("{0} of {1} records", visible.length, records.length)}</span>
          {state.data && (
            <ExportButton
              disabled={unsynced || state.loading}
              getInput={() => ({
                report: { ...state.data!.report, title, exchange_rates: rates },
                records: visible,
                metadata,
                currency,
                decimals,
              })}
            />
          )}
          {editable && (
            <Button shape="round" onClick={() => open()}>
              {t("Add record")}
            </Button>
          )}
          <Button
            shape="round"
            variant="outline"
            icon={<RefreshIcon />}
            aria-label={t("Refresh")}
            title={t("Refresh")}
            disabled={unsynced}
            loading={state.loading}
            onClick={() => {
              void state.refresh().catch(() => {});
            }}
          />
        </div>
        {(!metadata.currencies.length ||
          !metadata.institutions.length ||
          !metadata.asset_types.length) && (
          <Alert
            theme="info"
            message={
              <>
                {t(
                  "Before adding records, create your currencies, institutions, and asset types in",
                )}{" "}
                <Link to="/settings">{t("Settings")}</Link>.
              </>
            }
          />
        )}
        <RecordTable
          records={visible}
          rates={rates}
          currency={currency}
          decimals={decimals}
          editable={editable}
          statuses={statuses}
          onEdit={(record) => open(record)}
          onDelete={(record) => action(() => remove(record))}
          onRetry={(record) => {
            if (statuses[record.record_id]?.operation === "delete") void remove(record);
            else void sync(record, record);
          }}
        />
      </Card>
      <ReportExchangeRates
        reportId={reportId}
        rates={rates}
        setRates={setRates}
        editable={editable}
        busy={ratesBusy || state.loading}
        setBusy={setRatesBusy}
      />
      <Suspense fallback={<Loading text={t("Loading distributions…")} />}>
        <ReportDistribution
          records={visible}
          rates={rates}
          selectedCurrency={currency}
          decimals={decimals}
        />
      </Suspense>
      {editing !== undefined && (
        <RecordEditor
          initial={editing || undefined}
          reportId={reportId}
          close={() => setEditing(undefined)}
          onSave={(draft, quickInsert) => sync(draft, editing || undefined, quickInsert)}
        />
      )}
    </div>
  );
}
