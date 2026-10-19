import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { existsSync, readFileSync } from "node:fs";
import { badRequest } from "../lib/errors";
import { EXPORT_LIMIT } from "./operatorInsights";

export type ReportSheet = { name: string; rows: Record<string, unknown>[] };
function fontFile(name: string) {
  const source = new URL(`../../assets/fonts/${name}`, import.meta.url);
  return readFileSync(
    existsSync(source)
      ? source
      : new URL(`../assets/fonts/${name}`, import.meta.url),
  );
}
const moneyFields = new Set([
  "opening",
  "credits",
  "debits",
  "closing",
  "recorded",
  "difference",
  "deposits",
  "withdrawals",
  "stakes",
  "wins_amount",
  "refunds",
  "other",
  "amount",
  "balance_after",
  "gross_stake",
  "gross_payout",
  "stake",
  "settled_stake",
  "settledStake",
  "payout",
  "profit",
  "pending",
  "largest",
  "houseNet",
]);
export function decimalMoney(value: unknown) {
  const n = BigInt(String(value ?? "0")),
    absolute = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
function label(key: string) {
  return key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}
function cell(key: string, value: unknown): string | number {
  if (moneyFields.has(key)) {
    const exact = decimalMoney(value);
    // Excel has 15 significant digits. Preserve larger money values as decimal text.
    return exact.replace(/[-.]/g, "").length <= 15 ? Number(exact) : exact;
  }
  if (value === null || value === undefined) return "";
  if (key === "at" || key.endsWith("_at") || key === "last_bet") {
    const date = new Date(String(value));
    if (Number.isFinite(date.getTime()))
      return `${date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })} IST`;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return typeof value === "number" ? value : String(value);
}
export async function exportInsights(
  format: "xlsx" | "pdf",
  sheets: ReportSheet[],
) {
  if (sheets.some((sheet) => sheet.rows.length > EXPORT_LIMIT))
    throw badRequest(
      `Export exceeds ${EXPORT_LIMIT.toLocaleString()} rows per sheet. Narrow the date or player filters; no partial report was downloaded.`,
    );
  if (format === "xlsx") {
    const book = new ExcelJS.Workbook();
    book.creator = "LunarX Operator Reports";
    for (const sheet of sheets) {
      const page = book.addWorksheet(sheet.name);
      const keys = [...new Set(sheet.rows.flatMap((row) => Object.keys(row)))];
      page.columns = keys.map((key) => ({
        header: `${label(key)}${moneyFields.has(key) ? " (INR)" : ""}`,
        key,
        width: /id|email|reference|memo|reason|description/.test(key) ? 34 : 22,
      }));
      page.views = [{ state: "frozen", ySplit: 1 }];
      page.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      page.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF123D36" },
      };
      for (const row of sheet.rows)
        page.addRow(
          Object.fromEntries(keys.map((key) => [key, cell(key, row[key])])),
        );
      for (const key of keys)
        if (moneyFields.has(key))
          page.getColumn(key).numFmt = "#,##0.00;[Red]-#,##0.00";
      if (keys.length)
        page.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: Math.max(1, page.rowCount), column: keys.length },
        };
    }
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  if (sheets.reduce((n, s) => n + s.rows.length, 0) > 5000)
    throw badRequest(
      "PDF supports 5,000 records per report. Narrow the filters or download the full Excel workbook.",
    );
  const doc = new PDFDocument({
    size: "A4",
    margin: 36,
    info: { Title: "LunarX operator report" },
  });
  doc.registerFont("report", fontFile("NotoSans-Regular.ttf"));
  doc.registerFont("hindi", fontFile("NotoSansDevanagari-Regular.ttf"));
  doc.font("report");
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  for (const [index, sheet] of sheets.entries()) {
    if (index) doc.addPage();
    const heading = () => {
      doc
        .fontSize(15)
        .fillColor("#123d36")
        .text(`LunarX | ${sheet.name}`)
        .moveDown(0.5);
    };
    heading();
    if (!sheet.rows.length) doc.fontSize(10).text("No matching records.");
    sheet.rows.forEach((row, i) => {
      doc.fontSize(8).fillColor("#172d35");
      const lines = Object.entries(row).map(
        ([key, value]) =>
          `${label(key)}${moneyFields.has(key) ? " (INR)" : ""}: ${moneyFields.has(key) ? decimalMoney(value) : cell(key, value)}`,
      );
      if (doc.y > 680) {
        doc.addPage();
        heading();
      }
      doc
        .fontSize(9)
        .text(`Record ${i + 1}`)
        .fontSize(8);
      for (const line of lines) {
        if (doc.y + doc.heightOfString(line, { width: 520 }) > 790) {
          doc.addPage();
          heading();
          doc.fontSize(8);
        }
        const runs = line.match(/[\u0900-\u097f]+|[^\u0900-\u097f]+/g) ?? [
          line,
        ];
        runs.forEach((run, part) =>
          doc
            .font(/[\u0900-\u097f]/.test(run) ? "hindi" : "report")
            .text(run, { width: 520, continued: part < runs.length - 1 }),
        );
        doc.font("report");
      }
      doc.moveDown(0.7);
    });
  }
  doc.end();
  return done;
}
