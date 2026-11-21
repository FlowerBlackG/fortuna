// SPDX-License-Identifier: MulanPSL-2.0
import { t } from "../i18n";
import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Alert,
  Button,
  Card,
  Dialog,
  Form,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
} from "tdesign-react";
import { DeleteIcon, EditIcon } from "tdesign-icons-react";
import { EditorField } from "./Editor";
import { request } from "../api";
import { selectString } from "../helpers";
import { useMetadata } from "../metadata";
import type { ExchangeRate } from "../types";

export function ReportExchangeRates({
  reportId,
  rates,
  setRates,
  editable,
  busy,
  setBusy,
}: {
  reportId: string;
  rates: ExchangeRate[];
  setRates: Dispatch<SetStateAction<ExchangeRate[]>>;
  editable: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const { metadata } = useMetadata();
  const [editing, setEditing] = useState<ExchangeRate | null | undefined>();
  const [numerator, setNumerator] = useState("");
  const [denominator, setDenominator] = useState("");
  const [rate, setRate] = useState<number | undefined>(1);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const invalidRate = rate === undefined || !Number.isFinite(rate) || rate <= 0;
  const submitting = useRef(false);
  const endpoint = `/reports/${reportId}/exchange-rates`;
  const options = metadata.currencies.map((item) => ({
    value: item.currency_id,
    label: item.name,
  }));
  const name = (id: string) =>
    metadata.currencies.find((item) => item.currency_id === id)?.name || t("Missing currency");
  function open(row?: ExchangeRate) {
    setEditing(row || null);
    setNumerator(row?.numerator_currency_id || "");
    setDenominator(row?.denominator_currency_id || "");
    setRate(row?.exchange_rate ?? 1);
    setError("");
    setAttempted(false);
  }
  async function save() {
    if (submitting.current) return;
    setError("");
    if (!numerator || !denominator || numerator === denominator || invalidRate) {
      setAttempted(true);
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const saved = await request<ExchangeRate>("PUT", endpoint, {
        numerator_currency_id: numerator,
        denominator_currency_id: denominator,
        exchange_rate: rate,
      });
      setRates((current) => [
        ...current.filter(
          (item) =>
            item.numerator_currency_id !== numerator ||
            item.denominator_currency_id !== denominator,
        ),
        saved,
      ]);
      setEditing(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Save failed"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function remove(row: ExchangeRate) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await request("DELETE", endpoint, {
        numerator_currency_id: row.numerator_currency_id,
        denominator_currency_id: row.denominator_currency_id,
      });
      setRates((current) =>
        current.filter(
          (item) =>
            item.numerator_currency_id !== row.numerator_currency_id ||
            item.denominator_currency_id !== row.denominator_currency_id,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Delete failed"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label={t("Report exchange rates")}>
      <Card title={t("Report exchange rates")}>
        <p className="muted">
          {t(
            "These rates belong only to this report. USD / CNY = 6 means 1 USD = 6 CNY. Inverse conversion is automatic and uses the shortest path.",
          )}
        </p>
        {error && editing === undefined && <Alert theme="error" message={error} />}
        {editable && (
          <div className="toolbar">
            <Button shape="round" disabled={busy} onClick={() => open()}>
              {t("Add exchange rate")}
            </Button>
          </div>
        )}
        <Table
          rowKey="key"
          data={rates.map((row) => ({
            ...row,
            key: `${row.numerator_currency_id}/${row.denominator_currency_id}`,
          }))}
          empty={t("No exchange rates in this report yet.")}
          columns={[
            {
              colKey: "pair",
              title: t("Currency pair"),
              cell: ({ row }) =>
                `${name(row.numerator_currency_id)} / ${name(row.denominator_currency_id)}`,
            },
            { colKey: "exchange_rate", title: t("Rate") },
            ...(editable
              ? [
                  {
                    colKey: "actions",
                    title: t("Actions"),
                    width: 160,
                    cell: ({ row }: { row: ExchangeRate }) => (
                      <Space>
                        <Button
                          variant="text"
                          icon={<EditIcon />}
                          aria-label={t("Edit")}
                          title={t("Edit")}
                          disabled={busy}
                          onClick={() => open(row)}
                        />
                        <Popconfirm
                          content={t("Delete this rate from this report?")}
                          onConfirm={() => void remove(row)}
                        >
                          <Button
                            variant="text"
                            theme="danger"
                            icon={<DeleteIcon />}
                            aria-label={t("Delete exchange rate")}
                            title={t("Delete exchange rate")}
                            disabled={busy}
                          />
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]
              : []),
          ]}
        />
        {editing !== undefined && (
          <Dialog
            visible
            className="editor-dialog"
            placement="center"
            header={t("Report exchange rate")}
            onClose={() => {
              if (!busy) setEditing(undefined);
            }}
            onConfirm={() => void save()}
            confirmBtn={{ content: t("Save"), loading: busy }}
            closeOnOverlayClick={false}
          >
            {error && <Alert theme="error" message={error} />}
            <Form labelAlign="top">
              <EditorField
                label={t("Numerator currency")}
                warning={attempted && !numerator && t("Choose a currency")}
              >
                <Select
                  value={numerator}
                  options={options}
                  disabled={!!editing || busy}
                  onChange={(value) => setNumerator(selectString(value))}
                />
              </EditorField>
              <EditorField
                label={t("Denominator currency")}
                warning={
                  attempted &&
                  (!denominator
                    ? t("Choose a currency")
                    : numerator === denominator && t("Choose a different currency"))
                }
              >
                <Select
                  value={denominator}
                  options={options}
                  disabled={!!editing || busy}
                  onChange={(value) => setDenominator(selectString(value))}
                />
              </EditorField>
              <EditorField
                label={t("Exchange rate")}
                warning={attempted && invalidRate && t("Enter a positive rate")}
              >
                <InputNumber
                  value={rate ?? ""}
                  disabled={busy}
                  decimalPlaces={10}
                  onChange={(value) => setRate(typeof value === "number" ? value : undefined)}
                />
              </EditorField>
              {numerator && denominator && (
                <p>
                  1 {name(numerator)} = {rate ?? "?"} {name(denominator)}
                </p>
              )}
            </Form>
          </Dialog>
        )}
      </Card>
    </section>
  );
}
