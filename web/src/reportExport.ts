// SPDX-License-Identifier: MulanPSL-2.0
import { zipSync } from "fflate";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import writeXlsxFile, { type SheetData } from "write-excel-file/browser";
import fontUrl from "@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf?url";
import { displayValue } from "./helpers";
import {
  conversion,
  customFields,
  customValue,
  number,
  reportTitle,
  totals,
  validFieldValue,
} from "./calculations";
import type { AssetRecord, Metadata, Report } from "./types";

interface Section {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  amounts?: number[];
}

export interface ReportExport {
  report: Report;
  records: AssetRecord[];
  metadata: Metadata;
  currency: string;
  decimals: number;
  assetType?: string;
}

function reportSections({
  report,
  records,
  metadata,
  currency,
  assetType,
}: ReportExport): Section[] {
  const names = new Map(metadata.currencies.map((item) => [item.currency_id, item.name]));
  const currencyName = (id: string) => names.get(id) ?? "Missing currency";
  const types = new Map(metadata.asset_types.map((item) => [item.asset_type_id, item]));
  const institutions = new Map(
    metadata.institutions.map((item) => [item.institution_id, item.name]),
  );
  const rates = report.exchange_rates;
  const summary = totals(records, rates, currency);
  const sections: Section[] = [
    {
      title: "Exchange rates",
      columns: ["Currency pair", "Rate"],
      rows: rates.map((r) => [
        `${currencyName(r.numerator_currency_id)} / ${currencyName(r.denominator_currency_id)}`,
        r.exchange_rate,
      ]),
    },
    {
      title: summary.missing ? "Totals (partial)" : "Totals",
      columns: ["Currency", "Nominal amount", "Effective value"],
      amounts: [1, 2],
      rows: [...summary.amounts].map(([id, value]) => [
        currencyName(id),
        value.nominal,
        value.effective,
      ]),
    },
  ];
  const fields = customFields(assetType && types.get(assetType)?.custom_fields);
  const displayed = [...fields].sort((a, b) => a.display_order - b.display_order);
  const columns = [
    "Content",
    "Asset type",
    "Currency",
    "Nominal amount",
    "Effective rate",
    "Effective value",
  ];
  const amounts = [3, 5];
  const converted = currency && records.some((row) => row.currency_id !== currency);
  if (converted) {
    columns.push(`Nominal (${currencyName(currency)})`, `Effective (${currencyName(currency)})`);
    amounts.push(6, 7);
  }
  columns.push(...displayed.map((field) => field.field_name));
  const groups = new Map<string, Section>();
  for (const record of records) {
    const id = record.institution_id;
    if (!groups.has(id))
      groups.set(id, {
        title: institutions.get(id) ?? "Missing institution",
        columns,
        amounts,
        rows: [],
      });
    const effective = record.amount * record.effective_rate;
    const row = [
      record.content,
      types.get(record.asset_type_id)?.name ?? "Missing asset type",
      currencyName(record.currency_id),
      record.amount,
      record.effective_rate,
      effective,
    ];
    if (converted) {
      const factor = conversion(rates, record.currency_id, currency);
      for (const amount of [record.amount, effective])
        row.push(factor === null ? "No conversion path" : amount * factor);
    }
    for (const field of displayed) {
      const value = customValue(record, fields, field);
      row.push(
        !validFieldValue(field, value)
          ? "Needs correction"
          : value == null
            ? "—"
            : `${field.prefix}${displayValue(value)}${field.postfix}`,
      );
    }
    groups
      .get(id)!
      .rows.push(
        row.map((v) => (typeof v === "number" && !Number.isFinite(v) ? "Invalid value" : v)),
      );
  }
  if (!groups.size) sections.push({ title: "Records", columns, rows: [] });
  return sections.concat([...groups.values()].sort((a, b) => a.title.localeCompare(b.title)));
}

function workbook(title: string, date: string, sections: Section[], decimals: number) {
  const width = Math.max(...sections.map((s) => s.columns.length));
  const sheet: SheetData = [
    [{ value: title, columnSpan: width, fontSize: 18, fontWeight: "bold", wrap: true }],
    ["Report time", date],
  ];
  const format = decimals ? `#,##0.${"0".repeat(decimals)}` : "#,##0";
  for (const section of sections) {
    sheet.push(
      [],
      [{ value: section.title, columnSpan: width, fontWeight: "bold", fontSize: 13, wrap: true }],
    );
    if (!section.rows.length) {
      sheet.push(["None"]);
      continue;
    }
    sheet.push(
      section.columns.map((value) => ({
        value,
        fontWeight: "bold",
        bottomBorderStyle: "thin",
        bottomBorderColor: "#888888",
        wrap: true,
      })),
    );
    for (const row of section.rows)
      sheet.push(
        row.map((value, index) => ({
          value,
          wrap: true,
          alignVertical: "top",
          format:
            section.amounts?.includes(index) && typeof value === "number" ? format : undefined,
        })),
      );
  }
  return writeXlsxFile(sheet, {
    sheet: "Report",
    showGridLines: false,
    orientation: "landscape",
    columns: Array.from({ length: width }, (_, i) => ({ width: i === 0 ? 36 : i === 1 ? 26 : 18 })),
  }).toBlob();
}

async function pdfDocument(title: string, date: string, sections: Section[], decimals: number) {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });
  doc.setProperties({ title, creator: "Fortuna" });
  let font = "helvetica";
  // The PDF's built-in Latin fonts can't render CJK names or record content.
  if (/[\u0100-\u200f\u2028-\u{10ffff}]/u.test(JSON.stringify([title, date, sections]))) {
    const response = await fetch(fontUrl);
    if (!response.ok) throw new Error("Could not load the PDF font");
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    doc.addFileToVFS("NotoSansSC.ttf", binary);
    font = "NotoSansSC";
    doc.addFont("NotoSansSC.ttf", font, "normal");
  }
  const margin = 32;
  const width = doc.internal.pageSize.getWidth() - 2 * margin;
  const bold = font === "helvetica" ? "bold" : "normal";
  doc.setFont(font, bold).setFontSize(19);
  const lines: string[] = doc.splitTextToSize(title, width);
  // AutoTable paginates long titles, multiline records and repeated column headings.
  let y = margin;
  const common = {
    theme: "plain" as const,
    margin,
    styles: { font, fontStyle: "normal" as const, textColor: 28, fontSize: 9, cellPadding: 4 },
    didDrawPage: ({ cursor }: { cursor: { y: number } | null }) => {
      if (cursor) y = cursor.y + 12;
    },
  };
  autoTable(doc, {
    ...common,
    startY: y,
    body: [
      [{ content: lines, styles: { fontSize: 19, fontStyle: bold } }],
      [`Report time  ${date}`],
    ],
  });
  for (const section of sections) {
    const body = section.rows.map((row) =>
      row.map((value, i) =>
        typeof value === "number" && section.amounts?.includes(i)
          ? number(value, decimals)
          : String(value),
      ),
    );
    const columns = section.rows.length ? section.columns : [""];
    autoTable(doc, {
      ...common,
      startY: y,
      horizontalPageBreak: columns.length > 9,
      horizontalPageBreakRepeat: 0,
      headStyles: { fontStyle: bold, textColor: 28, lineWidth: { bottom: 0.5 }, lineColor: 170 },
      head: [
        [
          {
            content: section.title,
            colSpan: columns.length,
            styles: { fontSize: 12, lineWidth: 0 },
          },
        ],
        ...(body.length ? [columns] : []),
      ],
      body: body.length ? body : [["None"]],
      columnStyles: Object.fromEntries(
        columns.map((_, i) => [
          i,
          {
            halign: section.amounts?.includes(i) ? "right" : "left",
            cellWidth: columns.length > 9 ? (i === 0 ? 165 : 83) : "auto",
          },
        ]),
      ),
    });
  }
  const count = doc.getNumberOfPages();
  for (let i = 1; i <= count; i++) {
    doc.setPage(i).setFont(font, "normal").setFontSize(8).setTextColor(95);
    doc.text(`${i} / ${count}`, width + margin, doc.internal.pageSize.getHeight() - 14, {
      align: "right",
    });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

export async function downloadReport(input: ReportExport) {
  const title = reportTitle(input.report);
  const date = new Date(input.report.report_time).toLocaleString();
  const sections = reportSections(input);
  const [xlsx, pdf] = await Promise.all([
    workbook(title, date, sections, input.decimals),
    pdfDocument(title, date, sections, input.decimals),
  ]);
  const base =
    title
      .replace(/[\p{Cc}<>:"/\\|?*]/gu, "_")
      .slice(0, 90)
      .replace(/[. ]+$/, "") || "Report";
  const zip = zipSync(
    { [`${base}.xlsx`]: new Uint8Array(await xlsx.arrayBuffer()), [`${base}.pdf`]: pdf },
    { level: 0 },
  );
  const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${base}.zip`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
