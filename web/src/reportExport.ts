// SPDX-License-Identifier: MulanPSL-2.0
import { t, translate, type Language } from "./i18n";
import { exportFonts } from "./exportFonts";
import { zipSync } from "fflate";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import ExcelJS from "exceljs";
import fontUrl from "@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf?url";
import { formatReportField, mergeReportFields, reportFields } from "./reportFields";
import { addPdfBookmarks, type PdfBookmark } from "./pdfBookmarks";
import { compareSnapshots, type ReportSnapshot } from "./reportComparison";
import type { RecordFilters } from "./recordState";
import {
  formatEffectiveValue,
  number,
  reportGroupings,
  reportTitle,
  totals,
  type GroupBy,
} from "./calculations";
import type { Metadata } from "./types";

interface Section {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  footer?: (string | number)[];
  amounts?: number[];
  mono?: number[];
  bookmark?: boolean;
}

interface ReportView {
  name: string;
  sections: Section[];
}

export interface ReportExport extends ReportSnapshot {
  filters?: RecordFilters;
  metadata: Metadata;
  currency: string;
  decimals: number;
}

interface ConfiguredReport extends ReportExport {
  language: Language;
  groupings: GroupBy[];
  comparison?: ReportSnapshot;
  selectedFields?: ReadonlySet<string>;
}

function reportSections({
  report,
  records,
  metadata,
  currency,
  decimals,
  language,
  groupings,
  comparison,
  selectedFields,
}: ConfiguredReport): ReportView[] {
  const t = translate.bind(null, language);
  const names = new Map(metadata.currencies.map((item) => [item.currency_id, item.name]));
  const currencyName = (id: string) => names.get(id) ?? t("Missing currency");
  const types = new Map(metadata.asset_types.map((item) => [item.asset_type_id, item]));
  const institutions = new Map(
    metadata.institutions.map((item) => [item.institution_id, item.name]),
  );
  const rates = report.exchange_rates;
  const summary = totals(records, rates, currency);
  const sections: Section[] = [
    {
      title: t("Exchange rates"),
      mono: [0, 1],
      columns: [t("Currency pair"), t("Rate")],
      rows: rates.map((r) => [
        `${currencyName(r.numerator_currency_id)} / ${currencyName(r.denominator_currency_id)}`,
        r.exchange_rate,
      ]),
    },
    {
      title: summary.missing ? t("Totals (partial)") : t("Totals"),
      columns: [t("Currency"), t("Effective value")],
      amounts: [1],
      mono: [0, 1],
      rows: [...summary.amounts].map(([id, value]) => [currencyName(id), value]),
    },
  ];
  const fields = mergeReportFields(
    reportFields(records, metadata.asset_types).filter(
      (column) => !selectedFields || selectedFields.has(column.key),
    ),
  );
  const dimensions = {
    institution_id: t("Institution"),
    asset_type_id: t("Asset type"),
    currency_id: t("Currency"),
  };
  const keys = reportGroupings.map(({ key }) => key);
  const financial = [t("Amount"), t("Effective rate"), t("Effective value")];
  const amounts = [3, 5];
  const groupName = {
    institution_id: (id: string) => institutions.get(id) ?? t("Missing institution"),
    asset_type_id: (id: string) => types.get(id)?.name ?? t("Missing asset type"),
    currency_id: currencyName,
  };
  const valued = records.map((record) => {
    const labels = {
      institution_id: groupName.institution_id(record.institution_id),
      asset_type_id: groupName.asset_type_id(record.asset_type_id),
      currency_id: currencyName(record.currency_id),
    };
    const effective =
      currency && currency !== record.currency_id
        ? formatEffectiveValue(record, rates, currency, decimals, currencyName, language)
        : record.amount * record.effective_rate;
    const row: (string | number)[] = [record.amount, record.effective_rate, effective];
    return {
      record,
      labels,
      row: row.map((v) => (typeof v === "number" && !Number.isFinite(v) ? t("Invalid value") : v)),
    };
  });
  const selectedGroups = reportGroupings.filter(({ key }) => groupings.includes(key));
  const views: ReportView[] = selectedGroups.map(({ key, label }) => {
    const others = keys.filter((k) => k !== key);
    const columns = [t("Content"), ...others.map((k) => dimensions[k]), ...financial];
    const groups = new Map<string, typeof valued>();
    const mono = [...others.flatMap((k, i) => (k === "currency_id" ? [i + 1] : [])), 5];
    for (const item of valued) {
      const id = item.record[key];
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id)!.push(item);
    }
    const sorted = [...groups.values()]
      .map((items): Section => {
        const present = new Set(items.map(({ record }) => record.asset_type_id));
        const displayed = fields.filter((column) =>
          [...present].some((id) => column.byType.has(id)),
        );
        const section: Section = {
          title: items[0].labels[key],
          bookmark: true,
          columns: [...columns, ...displayed.map((column) => column.title)],
          amounts,
          mono,
          rows: items.map(({ record, labels, row }) => [
            record.content,
            ...others.map((k) => labels[k]),
            ...row,
            ...displayed.map((column) => formatReportField(record, column, language)),
          ]),
        };
        if (currency) {
          const subtotal = totals(
            items.map(({ record }) => record),
            rates,
            currency,
          );
          section.footer = Array<string | number>(section.columns.length).fill("");
          section.footer[0] = t(
            subtotal.missing ? "Partial subtotal ({0})" : "Subtotal ({0})",
            currencyName(currency),
          );
          section.footer[5] = subtotal.amounts.get(currency) ?? "—";
        }
        return section;
      })
      .sort((a, b) => a.title.localeCompare(b.title, language));
    return {
      name: t(label),
      sections: [
        ...sections,
        ...(sorted.length ? sorted : [{ title: t("Records"), columns, rows: [] }]),
      ],
    };
  });
  if (comparison) {
    const previousTime = new Date(comparison.report.report_time).toLocaleString(language);
    const previousTitle = comparison.report.title.trim();
    const title = t(
      "Change since {0}",
      previousTitle ? `${previousTitle} (${previousTime})` : previousTime,
    );
    for (const { key, growthLabel } of selectedGroups) {
      const table = compareSnapshots({ report, records }, comparison, key, currency);
      const rows = table.rows.map(({ id, changes }) => [
        groupName[key](id),
        ...changes.map((v) => v ?? t("Unavailable")),
      ]);
      rows.sort((a, b) => String(a[0]).localeCompare(String(b[0]), language));
      views.push({
        name: t(growthLabel),
        sections: [
          {
            title,
            columns: [
              dimensions[key],
              ...table.currencies.map((id) =>
                id ? t("Change ({0})", currencyName(id)) : t("Change"),
              ),
            ],
            rows,
            amounts: table.currencies.map((_, i) => i + 1),
          },
        ],
      });
    }
  }
  return views;
}

async function workbook(
  title: string,
  date: string,
  views: ReportView[],
  decimals: number,
  language: Language,
) {
  const book = new ExcelJS.Workbook();
  const fonts = exportFonts();
  const format = decimals ? `#,##0.${"0".repeat(decimals)}` : "#,##0";
  for (const view of views) {
    const sheet = book.addWorksheet(view.name, {
      views: [{ showGridLines: false }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const width = Math.max(...view.sections.map((s) => s.columns.length));
    sheet.columns = Array.from({ length: width }, (_, i) => ({
      width: i === 0 ? 36 : i === 1 ? 26 : 18,
    }));
    function add(values: (string | number)[], size = 11, bold = false, monoColumns: number[] = []) {
      const row = sheet.addRow(values.map((value) => (value === "" ? null : value)));
      values.forEach((value, i) => {
        const cell = row.getCell(i + 1);
        const mono = typeof value === "number" || monoColumns.includes(i);
        const latin = fonts[mono ? "English Mono" : "English"];
        const other = fonts[mono ? "Non-English Mono" : "Non-English"];
        const runs =
          typeof value === "string"
            ? value.match(/[\p{ASCII}\p{Script=Latin}]+|[^\p{ASCII}\p{Script=Latin}]+/gu)
            : null;
        const font = (text: string) => ({
          name: /^[\p{ASCII}\p{Script=Latin}]/u.test(text) ? latin : other,
          size,
          bold,
        });
        cell.font = runs?.length ? font(runs[0]) : { name: latin, size, bold };
        if (runs && runs.length > 1)
          cell.value = { richText: runs.map((text) => ({ text, font: font(text) })) };
        cell.alignment = { wrapText: true, vertical: "top" };
      });
      return row;
    }
    function heading(text: string, size: number) {
      const row = add([text], size, true);
      sheet.mergeCells(row.number, 1, row.number, width);
    }
    heading(title, 18);
    add([translate(language, "Report time"), date], 11, false, [1]);
    for (const section of view.sections) {
      sheet.addRow([]);
      heading(section.title, 13);
      if (!section.rows.length) {
        add([translate(language, "None")]);
        continue;
      }
      add(section.columns, 11, true).eachCell((cell) => {
        cell.border = { bottom: { style: "thin", color: { argb: "FF888888" } } };
      });
      for (const values of section.rows) {
        const row = add(values, 11, false, section.mono);
        for (const i of section.amounts ?? [])
          if (typeof values[i] === "number") row.getCell(i + 1).numFmt = format;
      }
      if (section.footer) {
        const footer = add(section.footer, 11, true);
        for (const i of section.amounts ?? [])
          if (typeof section.footer[i] === "number") footer.getCell(i + 1).numFmt = format;
      }
    }
  }
  return new Uint8Array(await book.xlsx.writeBuffer());
}

const pdfTableFontSize = 9;
const pdfCellPadding = 4;

function layoutPdfTable(
  doc: jsPDF,
  section: Section,
  decimals: number,
  language: Language,
  font: string,
  bold: "normal" | "bold",
) {
  const formatRow = (row: (string | number)[]) =>
    row.map((value, i) =>
      typeof value === "number" && section.amounts?.includes(i)
        ? number(value, decimals, language)
        : String(value),
    );
  const columns = section.rows.length ? section.columns : [""];
  const body = section.rows.length ? section.rows.map(formatRow) : [[translate(language, "None")]];
  const foot = section.footer ? [formatRow(section.footer)] : [];
  function textWidth(text: string, limit: number) {
    let width = 0;
    for (const line of text.split(/\r\n|\r|\n/)) {
      width = Math.max(width, doc.getTextWidth(line));
      if (width >= limit) return limit;
    }
    return width;
  }
  doc.setFont(font, bold).setFontSize(pdfTableFontSize);
  const widths = columns.map((label) => textWidth(label, 120));
  for (const row of foot)
    row.forEach((text, i) => {
      widths[i] = Math.max(widths[i], textWidth(text, 220));
    });
  if (columns.length === 1) {
    doc.setFontSize(12);
    widths[0] = Math.max(widths[0], textWidth(section.title, 220));
  }
  doc.setFont(font, "normal").setFontSize(pdfTableFontSize);
  for (const row of body)
    row.forEach((text, i) => {
      widths[i] = Math.max(widths[i], textWidth(text, 220));
    });
  const cellWidths = widths.map((w) => Math.ceil(w) + 2 * pdfCellPadding + 1);
  return {
    section,
    columns,
    body,
    foot,
    cellWidths,
    width: cellWidths.reduce((sum, w) => sum + w, 0),
  };
}

async function pdfDocument(
  title: string,
  date: string,
  views: ReportView[],
  decimals: number,
  language: Language,
) {
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
  if (/[\u0100-\u200f\u2028-\u{10ffff}]/u.test(JSON.stringify([title, date, views]))) {
    const response = await fetch(fontUrl);
    if (!response.ok) throw new Error(t("Could not load the PDF font"));
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    doc.addFileToVFS("NotoSansSC.ttf", binary);
    font = "NotoSansSC";
    doc.addFont("NotoSansSC.ttf", font, "normal");
  }
  const margin = 32;
  const bold = font === "helvetica" ? "bold" : "normal";
  let pageWidth = doc.internal.pageSize.getWidth();
  const layouts = views.map((view) => ({
    name: view.name,
    tables: view.sections.map((section) => {
      const table = layoutPdfTable(doc, section, decimals, language, font, bold);
      pageWidth = Math.max(pageWidth, table.width + 2 * margin);
      return table;
    }),
  }));
  // jsPDF uses the last added page format for automatic continuation pages.
  if (pageWidth > doc.internal.pageSize.getWidth()) {
    pageWidth = Math.min(pageWidth, 14400);
    doc.addPage([pageWidth, doc.internal.pageSize.getHeight()], "landscape");
    doc.deletePage(1);
  }
  const width = pageWidth - 2 * margin;
  doc.setFont(font, bold).setFontSize(19);
  const lines: string[] = doc.splitTextToSize(title, width);
  // AutoTable paginates long titles, multiline records and repeated column headings.
  let y = margin;
  const common = {
    theme: "plain" as const,
    margin,
    styles: {
      font,
      fontStyle: "normal" as const,
      textColor: 28,
      fontSize: pdfTableFontSize,
      cellPadding: pdfCellPadding,
    },
    didDrawPage: ({ cursor }: { cursor: { y: number } | null }) => {
      if (cursor) y = cursor.y + 12;
    },
  };
  const bookmarks: PdfBookmark[] = [];
  for (const [index, view] of layouts.entries()) {
    if (index) doc.addPage();
    const children: PdfBookmark[] = [];
    bookmarks.push({
      title: view.name,
      page: doc.getCurrentPageInfo().pageNumber,
      y: doc.internal.pageSize.getHeight(),
      children,
    });
    y = margin;
    autoTable(doc, {
      ...common,
      startY: y,
      body: [
        [{ content: lines, styles: { fontSize: 19, fontStyle: bold } }],
        [`${view.name}   ·   ${translate(language, "Report time")}  ${date}`],
      ],
    });
    for (const table of view.tables) {
      const { section, columns, body, foot, cellWidths } = table;
      const scale = Math.min(1, width / table.width);
      let bookmarkPending = section.bookmark;
      autoTable(doc, {
        ...common,
        startY: y,
        willDrawCell: ({ section: part, cell }) => {
          if (bookmarkPending && part === "head") {
            children.push({
              title: section.title,
              page: doc.getCurrentPageInfo().pageNumber,
              y: doc.internal.pageSize.getHeight() - cell.y,
            });
            bookmarkPending = false;
          }
        },
        tableWidth: table.width * scale,
        styles: {
          ...common.styles,
          cellPadding: pdfCellPadding * scale,
          fontSize: pdfTableFontSize * scale,
        },
        headStyles: { fontStyle: bold, textColor: 28, lineWidth: { bottom: 0.5 }, lineColor: 170 },
        head: [
          [
            {
              content: section.title,
              colSpan: columns.length,
              styles: { fontSize: 12 * scale, lineWidth: 0 },
            },
          ],
          ...(section.rows.length ? [columns] : []),
        ],
        body,
        foot,
        showFoot: "lastPage",
        footStyles: { fontStyle: bold, textColor: 28, lineWidth: { top: 0.5 }, lineColor: 170 },
        columnStyles: Object.fromEntries(
          cellWidths.map((cellWidth, i) => [
            i,
            {
              halign: section.amounts?.includes(i) ? "right" : "left",
              cellWidth: cellWidth * scale,
            },
          ]),
        ),
      });
    }
  }
  const count = doc.getNumberOfPages();
  addPdfBookmarks(doc, bookmarks);
  for (let i = 1; i <= count; i++) {
    doc.setPage(i).setFont(font, "normal").setFontSize(8).setTextColor(95);
    doc.text(`${i} / ${count}`, width + margin, doc.internal.pageSize.getHeight() - 14, {
      align: "right",
    });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

export async function downloadReport(input: ConfiguredReport) {
  const { language, decimals } = input;
  const title = reportTitle(input.report, language);
  const date = new Date(input.report.report_time).toLocaleString(language);
  const sections = reportSections(input);
  const [xlsx, pdf] = await Promise.all([
    workbook(title, date, sections, decimals, language),
    pdfDocument(title, date, sections, decimals, language),
  ]);
  const base =
    title
      .replace(/[\p{Cc}<>:"/\\|?*]/gu, "_")
      .slice(0, 90)
      .replace(/[. ]+$/, "") || translate(language, "Report");
  const zip = zipSync({ [`${base}.xlsx`]: xlsx, [`${base}.pdf`]: pdf }, { level: 0 });
  const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${base}.zip`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
