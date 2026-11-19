// SPDX-License-Identifier: MulanPSL-2.0
import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Loading,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Textarea,
} from "tdesign-react";
import type { PrimaryTableCol } from "tdesign-react";
import { DeleteIcon, EditIcon } from "tdesign-icons-react";
import { EditorDialog, EditorField } from "./Editor";
import {
  conversion,
  customFields,
  customValue,
  number,
  totals,
  validFieldValue,
} from "../calculations";
import { useMetadata } from "../metadata";
import { displayValue, selectString } from "../helpers";
import { emptyFilters } from "../recordState";
import type { RecordFilters } from "../recordState";
import type { AssetRecord, CustomField, ExchangeRate } from "../types";
import { useTableSort } from "../tableState";

export function FilterControls({
  value,
  onChange,
}: {
  value: RecordFilters;
  onChange: (value: RecordFilters) => void;
}) {
  const { metadata } = useMetadata();
  const fields =
    value.assetTypes.length === 1
      ? customFields(
          metadata.asset_types.find((item) => item.asset_type_id === value.assetTypes[0])
            ?.custom_fields,
        )
      : [];
  return (
    <>
      <div className="toolbar">
        <Select
          multiple
          // TDesign's auto-width input resizes itself inside its ResizeObserver callback.
          inputProps={{ autoWidth: false }}
          clearable
          filterable
          placeholder="All asset types"
          value={value.assetTypes}
          options={metadata.asset_types.map((item) => ({
            value: item.asset_type_id,
            label: item.name,
          }))}
          onChange={(assetTypes) =>
            onChange({ ...value, assetTypes: assetTypes as string[], custom: {} })
          }
        />
        <Select
          multiple
          inputProps={{ autoWidth: false }}
          clearable
          filterable
          placeholder="All institutions"
          value={value.institutions}
          options={metadata.institutions.map((item) => ({
            value: item.institution_id,
            label: item.name,
          }))}
          onChange={(institutions) =>
            onChange({ ...value, institutions: institutions as string[] })
          }
        />
        <Input
          style={{ width: 240 }}
          clearable
          placeholder="Search record content"
          value={value.search}
          onChange={(search) => onChange({ ...value, search })}
        />
        <Button variant="text" onClick={() => onChange(emptyFilters)}>
          Clear filters
        </Button>
      </div>
      {!!fields.length && (
        <div className="toolbar">
          {[...fields]
            .sort((a, b) => a.display_order - b.display_order)
            .map((field) => {
              const filter = value.custom[field.data_order] || {};
              const change = (key: string, input: string) =>
                onChange({
                  ...value,
                  custom: { ...value.custom, [field.data_order]: { ...filter, [key]: input } },
                });
              return (
                <Space key={field.data_order} align="center" breakLine>
                  <span>{field.field_name}</span>
                  {field.type === "str" ? (
                    <Input
                      style={{ width: 160 }}
                      clearable
                      placeholder="Contains"
                      value={filter.text || ""}
                      onChange={(text) => change("text", text)}
                    />
                  ) : field.type === "date" ? (
                    <>
                      <DatePicker
                        clearable
                        placeholder="From"
                        value={filter.min || ""}
                        onChange={(date) => change("min", String(date || ""))}
                      />
                      <DatePicker
                        clearable
                        placeholder="Through"
                        value={filter.max || ""}
                        onChange={(date) => change("max", String(date || ""))}
                      />
                    </>
                  ) : (
                    <>
                      <InputNumber
                        theme="normal"
                        style={{ width: 140 }}
                        placeholder="Minimum"
                        value={filter.min ? Number(filter.min) : undefined}
                        onChange={(number) =>
                          change("min", number === undefined ? "" : String(number))
                        }
                      />
                      <InputNumber
                        theme="normal"
                        style={{ width: 140 }}
                        placeholder="Maximum"
                        value={filter.max ? Number(filter.max) : undefined}
                        onChange={(number) =>
                          change("max", number === undefined ? "" : String(number))
                        }
                      />
                    </>
                  )}
                </Space>
              );
            })}
        </div>
      )}
    </>
  );
}

export function ValuationControls({
  currency,
  setCurrency,
  decimals,
  setDecimals,
  singleCurrency = false,
}: {
  currency: string;
  setCurrency: (value: string) => void;
  decimals: number;
  setDecimals: (value: number) => void;
  singleCurrency?: boolean;
}) {
  const { metadata } = useMetadata();
  return (
    <div className="toolbar">
      <span>Display in</span>
      <Select
        value={currency}
        options={[
          ...(!singleCurrency ? [{ value: "", label: "Original currencies" }] : []),
          ...metadata.currencies.map((item) => ({ value: item.currency_id, label: item.name })),
        ]}
        onChange={(value) => setCurrency(selectString(value))}
      />
      <span>Decimal places</span>
      <InputNumber
        value={decimals}
        min={0}
        max={10}
        decimalPlaces={0}
        onChange={(value) => {
          if (typeof value === "number") setDecimals(Math.min(10, Math.max(0, Math.round(value))));
        }}
      />
    </div>
  );
}

export function RecordTotals({
  records,
  rates,
  currency,
  decimals,
}: {
  records: AssetRecord[];
  rates: ExchangeRate[];
  currency: string;
  decimals: number;
}) {
  const { metadata } = useMetadata();
  const result = totals(records, rates, currency);
  return (
    <>
      {result.missing > 0 && (
        <Alert
          theme="warning"
          message={`${result.missing} record(s) cannot be valued because of missing conversion paths or invalid values. Totals below are partial.`}
        />
      )}
      <Space breakLine className="summary-space">
        {[...result.amounts].map(([id, amount]) => (
          <Card
            key={id}
            size="small"
            className="summary-card"
            title={
              metadata.currencies.find((item) => item.currency_id === id)?.name ||
              "Missing currency"
            }
          >
            <div className="muted">Effective value{result.missing ? " (partial)" : ""}</div>
            <div className="total-number">{number(amount.effective, decimals)}</div>
            <div className="muted">Nominal {number(amount.nominal, decimals)}</div>
          </Card>
        ))}
        {!result.amounts.size && (
          <Card size="small">
            {records.length ? "No convertible records" : "No matching records"}
          </Card>
        )}
      </Space>
    </>
  );
}

export interface RecordStatus {
  saving?: boolean;
  error?: string;
  operation?: "save" | "delete";
}
export function RecordTable({
  records,
  rates,
  currency,
  decimals,
  assetType,
  editable = false,
  statuses = {},
  onEdit,
  onDelete,
  onRetry,
}: {
  records: AssetRecord[];
  rates: ExchangeRate[];
  currency: string;
  decimals: number;
  assetType?: string;
  editable?: boolean;
  statuses?: Record<string, RecordStatus>;
  onEdit?: (record: AssetRecord) => void;
  onDelete?: (record: AssetRecord) => void;
  onRetry?: (record: AssetRecord) => void;
}) {
  const { metadata } = useMetadata();
  const fields = customFields(
    metadata.asset_types.find((item) => item.asset_type_id === assetType)?.custom_fields,
  );
  function money(record: AssetRecord, effective: boolean) {
    const amount = record.amount * (effective ? record.effective_rate : 1);
    const name =
      metadata.currencies.find((item) => item.currency_id === record.currency_id)?.name ||
      "Missing currency";
    const factor = currency ? conversion(rates, record.currency_id, currency) : null;
    return (
      <>
        <span>
          {number(amount, decimals)} {name}
        </span>
        {currency && currency !== record.currency_id && (
          <div className="muted">
            {factor === null
              ? "No conversion path"
              : `(${number(amount * factor, decimals)} ${metadata.currencies.find((item) => item.currency_id === currency)?.name || "Missing currency"})`}
          </div>
        )}
      </>
    );
  }
  const columns: PrimaryTableCol<AssetRecord>[] = [
    {
      colKey: "content",
      title: "Content",
      minWidth: 180,
      sorter: (a, b) => a.content.localeCompare(b.content),
      cell: ({ row }) => <span className="multiline">{row.content || "—"}</span>,
    },
    {
      colKey: "asset_type_id",
      title: "Asset type",
      width: 140,
      cell: ({ row }) => {
        const type = metadata.asset_types.find((item) => item.asset_type_id === row.asset_type_id);
        return type ? (
          <Space>
            <span
              style={{ color: /^[0-9A-F]{6}$/.test(type.color) ? `#${type.color}` : "#6b7972" }}
            >
              ●
            </span>
            {type.name}
          </Space>
        ) : (
          "Missing asset type"
        );
      },
    },
    {
      colKey: "institution_id",
      title: "Institution",
      width: 140,
      cell: ({ row }) =>
        metadata.institutions.find((item) => item.institution_id === row.institution_id)?.name ||
        "Missing institution",
    },
    {
      colKey: "amount",
      title: "Nominal amount",
      width: 175,
      sorter: (a, b) => a.amount - b.amount,
      cell: ({ row }) => money(row, false),
    },
    {
      colKey: "effective_rate",
      title: "Effective rate",
      width: 135,
      sorter: (a, b) => a.effective_rate - b.effective_rate,
    },
    {
      colKey: "effective",
      title: "Effective value",
      width: 175,
      sorter: (a, b) => {
        const left =
          a.amount *
          a.effective_rate *
          (currency ? (conversion(rates, a.currency_id, currency) ?? 0) : 1);
        const right =
          b.amount *
          b.effective_rate *
          (currency ? (conversion(rates, b.currency_id, currency) ?? 0) : 1);
        return left - right;
      },
      cell: ({ row }) => money(row, true),
    },
    ...[...fields]
      .sort((a, b) => a.display_order - b.display_order)
      .map((field): PrimaryTableCol<AssetRecord> => ({
        colKey: `custom_${field.data_order}`,
        title: field.field_name,
        width: 160,
        sorter: (a, b) => {
          const left = customValue(a, fields, field);
          const right = customValue(b, fields, field);
          return field.type === "int" || field.type === "float"
            ? Number(left) - Number(right)
            : displayValue(left).localeCompare(displayValue(right));
        },
        cell: ({ row }) => {
          const value = customValue(row, fields, field);
          return !validFieldValue(field, value)
            ? "Needs correction"
            : value === null
              ? "—"
              : `${field.prefix}${displayValue(value)}${field.postfix}`;
        },
      })),
  ];
  if (editable)
    columns.push({
      colKey: "actions",
      title: "Actions / sync",
      width: 200,
      fixed: "right",
      cell: ({ row }) => {
        const status = statuses[row.record_id];
        if (status?.saving) return <Loading size="small" text="Syncing…" />;
        return (
          <Space direction="vertical" size="small">
            {status?.error && <span className="muted">Not synced: {status.error}</span>}
            <Space size="small">
              <Button
                size="small"
                variant="text"
                icon={<EditIcon />}
                aria-label="Edit"
                title="Edit"
                onClick={() => onEdit?.(row)}
              />
              {status?.error && (
                <Button size="small" variant="text" onClick={() => onRetry?.(row)}>
                  Retry
                </Button>
              )}
              <Popconfirm content="Delete this record?" onConfirm={() => onDelete?.(row)}>
                <Button
                  size="small"
                  theme="danger"
                  variant="text"
                  icon={<DeleteIcon />}
                  aria-label="Delete"
                  title="Delete"
                />
              </Popconfirm>
            </Space>
          </Space>
        );
      },
    });
  const sorting = useTableSort(records, columns);
  return (
    <Table
      rowKey="record_id"
      {...sorting}
      columns={columns}
      tableLayout="auto"
      hover
      pagination={{ total: records.length, defaultPageSize: 20, pageSizeOptions: [20, 50, 100] }}
      empty="No records match this view."
    />
  );
}

export type RecordDraft = Omit<AssetRecord, "record_id" | "user_id">;
const recordDefaults = {
  content: "",
  amount: 0,
  effective_rate: 1,
  currency_id: "",
  asset_type_id: "",
  institution_id: "",
};

function defaultCustomValue(field: CustomField) {
  if (field.nullable) return null;
  if (field.type === "str") return "";
  if (field.type === "date") return new Date().toISOString().slice(0, 10);
  return 0;
}

export function RecordEditor({
  initial,
  reportId,
  close,
  onSave,
}: {
  initial?: AssetRecord;
  reportId: string;
  close: () => void;
  onSave: (draft: RecordDraft, quickInsert: boolean) => Promise<boolean>;
}) {
  const { metadata } = useMetadata();
  const [draft, setDraft] = useState<RecordDraft>(
    () => initial ?? { ...recordDefaults, report_id: reportId, asset_custom_fields_data: [] },
  );
  const [quickInsert, setQuickInsert] = useState(false);
  const [kept, setKept] = useState<Set<string | number>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [attempted, setAttempted] = useState(false);
  const assetType = metadata.asset_types.find((item) => item.asset_type_id === draft.asset_type_id);
  const fields = customFields(assetType?.custom_fields);
  const values = Array.isArray(draft.asset_custom_fields_data)
    ? draft.asset_custom_fields_data
    : [];
  const invalid = {
    type: !assetType,
    institution: !metadata.institutions.some(
      (item) => item.institution_id === draft.institution_id,
    ),
    currency: !metadata.currencies.some((item) => item.currency_id === draft.currency_id),
    amount: !Number.isFinite(draft.amount),
    rate: !Number.isFinite(draft.effective_rate),
  };
  const invalidCustom = fields.map((field, index) => {
    const value = values[index];
    return (
      !validFieldValue(field, value) ||
      (!field.nullable && typeof value === "string" && !value.trim())
    );
  });
  const update = (value: Partial<RecordDraft>) =>
    setDraft((previous) => ({ ...previous, ...value }));
  function keepBox(key: keyof typeof recordDefaults | number, label: string) {
    if (!quickInsert) return null;
    return (
      <Checkbox
        title={`Keep ${label}`}
        checked={kept.has(key)}
        onChange={(checked) => {
          setKept((previous) => {
            const next = new Set(previous);
            if (checked) {
              next.add(key);
              if (typeof key === "number") next.add("asset_type_id");
            } else {
              next.delete(key);
              if (key === "asset_type_id")
                for (const field of fields) next.delete(field.data_order);
            }
            return next;
          });
        }}
      >
        <span className="sr-only">Keep {label}</span>
      </Checkbox>
    );
  }
  function chooseType(id: string) {
    if (id === draft.asset_type_id) return;
    setKept((previous) => new Set([...previous].filter((key) => typeof key === "string")));
    const definitions = customFields(
      metadata.asset_types.find((item) => item.asset_type_id === id)?.custom_fields,
    );
    update({
      asset_type_id: id,
      asset_custom_fields_data: definitions.map(defaultCustomValue),
    });
  }
  async function save() {
    if (submitting.current) return;
    if (Object.values(invalid).some(Boolean) || invalidCustom.some(Boolean)) {
      setAttempted(true);
      return;
    }
    const record = {
      ...draft,
      content: draft.content.replace(/\r\n?/g, "\n"),
      asset_custom_fields_data: fields.map((_, index) => values[index] ?? null),
    };
    submitting.current = true;
    if (!quickInsert) {
      void onSave(record, false);
      close();
      return;
    }
    setSaving(true);
    try {
      if (await onSave(record, true)) {
        setAttempted(false);
        const reset = Object.entries(recordDefaults).filter(([key]) => !kept.has(key));
        setDraft({
          ...record,
          ...Object.fromEntries(reset),
          asset_custom_fields_data: kept.has("asset_type_id")
            ? fields.map((field, i) =>
                kept.has(field.data_order) ? values[i] : defaultCustomValue(field),
              )
            : [],
        });
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  return (
    <EditorDialog
      title={initial ? "Edit record" : "Add record"}
      saveLabel="Save record"
      saving={saving}
      onSave={() => void save()}
      onClose={close}
    >
      <div inert={saving}>
        {!initial && (
          <label className="toolbar">
            Quick insert mode
            <Switch
              value={quickInsert}
              aria-label="Quick insert mode"
              aria-checked={quickInsert}
              onChange={(value) => setQuickInsert(Boolean(value))}
            />
          </label>
        )}
        <Form labelAlign="top">
          <div className={quickInsert ? "form-grid quick-insert-grid" : "form-grid"}>
            <EditorField
              label="Asset type"
              warning={attempted && invalid.type && "Choose an asset type"}
            >
              <Select
                autofocus
                filterable
                value={draft.asset_type_id}
                options={metadata.asset_types.map((item) => ({
                  value: item.asset_type_id,
                  label: item.name,
                }))}
                onChange={(value) => chooseType(selectString(value))}
              />
              {keepBox("asset_type_id", "asset type")}
            </EditorField>
            <EditorField
              label="Institution"
              warning={attempted && invalid.institution && "Choose an institution"}
            >
              <Select
                filterable
                value={draft.institution_id}
                options={metadata.institutions.map((item) => ({
                  value: item.institution_id,
                  label: item.name,
                }))}
                onChange={(value) => update({ institution_id: selectString(value) })}
              />
              {keepBox("institution_id", "institution")}
            </EditorField>
            <EditorField
              label="Currency"
              warning={attempted && invalid.currency && "Choose a currency"}
            >
              <Select
                filterable
                value={draft.currency_id}
                options={metadata.currencies.map((item) => ({
                  value: item.currency_id,
                  label: item.name,
                }))}
                onChange={(value) => update({ currency_id: selectString(value) })}
              />
              {keepBox("currency_id", "currency")}
            </EditorField>
            <EditorField label="Amount" warning={attempted && invalid.amount && "Enter a number"}>
              <InputNumber
                value={invalid.amount ? "" : draft.amount}
                onChange={(value) => update({ amount: typeof value === "number" ? value : NaN })}
              />
              {keepBox("amount", "amount")}
            </EditorField>
            <EditorField
              label="Effective rate"
              warning={attempted && invalid.rate && "Enter a number"}
            >
              <InputNumber
                value={invalid.rate ? "" : draft.effective_rate}
                onChange={(value) =>
                  update({ effective_rate: typeof value === "number" ? value : NaN })
                }
              />
              {keepBox("effective_rate", "effective rate")}
            </EditorField>
            <EditorField label="Content" className="wide">
              <Textarea
                value={draft.content}
                onChange={(content) => update({ content })}
                autosize={{ minRows: 2, maxRows: 6 }}
              />
              {keepBox("content", "content")}
            </EditorField>
            {[...fields]
              .sort((a, b) => a.display_order - b.display_order)
              .map((field) => {
                const index = fields.findIndex((item) => item.data_order === field.data_order);
                const value = values[index];
                function change(value: unknown) {
                  const copy = fields.map((_, index) => values[index] ?? null);
                  copy[index] = value;
                  update({ asset_custom_fields_data: copy });
                }
                return (
                  <EditorField
                    key={`${draft.asset_type_id}:${field.data_order}`}
                    label={`${field.field_name}${field.nullable ? " (optional)" : " *"}`}
                    warning={attempted && invalidCustom[index] && "Enter a valid value"}
                    help={`${field.prefix}${field.postfix ? ` … ${field.postfix}` : ""}`}
                  >
                    {field.type === "str" ? (
                      <Input
                        clearable
                        value={typeof value === "string" ? value : ""}
                        onChange={(text) => change(field.nullable && !text ? null : text)}
                      />
                    ) : field.type === "date" ? (
                      <DatePicker
                        clearable
                        value={
                          typeof value === "string" && Number.isFinite(Date.parse(value))
                            ? value.slice(0, 10)
                            : ""
                        }
                        onChange={(date) => change(date ? String(date) : null)}
                      />
                    ) : (
                      <InputNumber
                        value={typeof value === "number" ? value : ""}
                        decimalPlaces={field.type === "int" ? 0 : undefined}
                        onChange={(number) => change(typeof number === "number" ? number : null)}
                      />
                    )}
                    {keepBox(field.data_order, field.field_name)}
                  </EditorField>
                );
              })}
          </div>
        </Form>
        {quickInsert && (
          <p className="muted">Check a field to keep its value for the next record.</p>
        )}
      </div>
    </EditorDialog>
  );
}
