// SPDX-License-Identifier: MulanPSL-2.0
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
import { DeleteIcon } from "tdesign-icons-react";
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
  const submitting = useRef(false);
  const endpoint = `/reports/${reportId}/exchange-rates`;
  const options = metadata.currencies.map((item) => ({
    value: item.currency_id,
    label: item.name,
  }));
  const name = (id: string) =>
    metadata.currencies.find((item) => item.currency_id === id)?.name || "Missing currency";
  function open(row?: ExchangeRate) {
    setEditing(row || null);
    setNumerator(row?.numerator_currency_id || "");
    setDenominator(row?.denominator_currency_id || "");
    setRate(row?.exchange_rate ?? 1);
    setError("");
  }
  async function save() {
    if (submitting.current) return;
    if (
      !numerator ||
      !denominator ||
      numerator === denominator ||
      !rate ||
      !Number.isFinite(rate) ||
      rate <= 0
    ) {
      setError("Choose different currencies and a positive rate");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
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
      setError(reason instanceof Error ? reason.message : "Save failed");
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
      setError(reason instanceof Error ? reason.message : "Delete failed");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Report exchange rates">
      <Card title="Report exchange rates">
        <p className="muted">
          These rates belong only to this report. USD / CNY = 6 means 1 USD = 6 CNY. Inverse
          conversion is automatic and uses the shortest path.
        </p>
        {error && editing === undefined && <Alert theme="error" message={error} />}
        {editable && (
          <div className="toolbar">
            <Button disabled={busy} onClick={() => open()}>
              Add exchange rate
            </Button>
          </div>
        )}
        <Table
          rowKey="key"
          data={rates.map((row) => ({
            ...row,
            key: `${row.numerator_currency_id}/${row.denominator_currency_id}`,
          }))}
          empty="No exchange rates in this report yet."
          columns={[
            {
              colKey: "pair",
              title: "Currency pair",
              cell: ({ row }) =>
                `${name(row.numerator_currency_id)} / ${name(row.denominator_currency_id)}`,
            },
            { colKey: "exchange_rate", title: "Rate" },
            ...(editable
              ? [
                  {
                    colKey: "actions",
                    title: "Actions",
                    width: 160,
                    cell: ({ row }: { row: ExchangeRate }) => (
                      <Space>
                        <Button variant="text" disabled={busy} onClick={() => open(row)}>
                          Edit
                        </Button>
                        <Popconfirm
                          content="Delete this rate from this report?"
                          onConfirm={() => void remove(row)}
                        >
                          <Button
                            variant="text"
                            theme="danger"
                            icon={<DeleteIcon />}
                            aria-label="Delete exchange rate"
                            title="Delete exchange rate"
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
            header="Report exchange rate"
            onClose={() => {
              if (!busy) setEditing(undefined);
            }}
            onConfirm={() => void save()}
            confirmBtn={{ content: "Save", loading: busy }}
            closeOnOverlayClick={false}
          >
            {error && <Alert theme="error" message={error} />}
            <Form labelAlign="top">
              <Form.FormItem label="Numerator currency">
                <Select
                  value={numerator}
                  options={options}
                  disabled={!!editing || busy}
                  onChange={(value) => setNumerator(selectString(value))}
                />
              </Form.FormItem>
              <Form.FormItem label="Denominator currency">
                <Select
                  value={denominator}
                  options={options}
                  disabled={!!editing || busy}
                  onChange={(value) => setDenominator(selectString(value))}
                />
              </Form.FormItem>
              <Form.FormItem label="Exchange rate">
                <InputNumber
                  value={rate}
                  disabled={busy}
                  decimalPlaces={10}
                  onChange={(value) => setRate(typeof value === "number" ? value : undefined)}
                />
              </Form.FormItem>
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
