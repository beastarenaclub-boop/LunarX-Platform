import { dayIST, type Entry, type LiveMember, type LiveTask } from "./types";
export type Range = { from: string; to: string };
export function rangeFor(period: string, today = dayIST()): Range {
  const current = new Date(today + "T12:00:00Z");
  if (period === "Today") return { from: today, to: today };
  if (period === "Yesterday") {
    current.setUTCDate(current.getUTCDate() - 1);
    const d = current.toISOString().slice(0, 10);
    return { from: d, to: d };
  }
  if (period === "This month")
    return { from: today.slice(0, 7) + "-01", to: today };
  if (period === "Last month") {
    const first = new Date(today.slice(0, 7) + "-01T12:00:00Z");
    first.setUTCDate(0);
    return {
      from: first.toISOString().slice(0, 7) + "-01",
      to: first.toISOString().slice(0, 10),
    };
  }
  return { from: "2000-01-01", to: today };
}
export function selectEntries(
  entries: Entry[],
  range: Range,
  bank: string,
  members: LiveMember[],
) {
  const accountIds = new Set(
    members
      .flatMap((m) => m.profile.accounts || [])
      .filter((a) => a.bank === bank)
      .map((a) => a.id),
  );
  return entries.filter(
    (e) =>
      e.date >= range.from &&
      e.date <= range.to &&
      (bank === "All banks" ||
        (!!e.account_id && accountIds.has(e.account_id))),
  );
}
export function totals(entries: Entry[]) {
  const approved = entries.filter((e) => e.status === "Approved");
  const sum = (kind: string) =>
    approved
      .filter((e) => e.kind === kind)
      .reduce((n, e) => n + e.amount_paise, 0);
  const income = sum("Income"),
    expense = sum("Expense");
  return {
    turnover: sum("Turnover"),
    income,
    expense,
    net: income - expense,
    approved: approved.length,
    pending: entries.filter((e) => e.status === "Pending").length,
  };
}
export function groups(entries: Entry[], key: (e: Entry) => string) {
  const map = new Map<string, Entry[]>();
  for (const e of entries) {
    const label = key(e);
    map.set(label, [...(map.get(label) || []), e]);
  }
  return [...map]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, items]) => ({ label, ...totals(items) }));
}
type Cell = string | number;
export type ExportSheet = { name: string; headings: string[]; rows: Cell[][] };
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export async function excel(sheets: ExportSheet[], filename: string) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  workbook.creator = "SYNDICATE";
  workbook.created = new Date();
  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(spec.name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.addRow(spec.headings);
    for (const row of spec.rows)
      sheet.addRow(
        row.map((v) =>
          typeof v === "string" && /^[=+@-]/.test(v) ? "'" + v : v,
        ),
      );
    sheet.getRow(1).font = { bold: true, color: { argb: "FFF2E8C9" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF252D21" },
    };
    sheet.getRow(1).height = 25;
    sheet.columns.forEach((column, i) => {
      column.width = Math.min(
        45,
        Math.max(
          18,
          ...spec.rows.map((row) => String(row[i] ?? "").length + 2),
        ),
      );
      column.alignment = { vertical: "top", wrapText: true };
    });
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: {
        row: Math.max(1, spec.rows.length + 1),
        column: spec.headings.length,
      },
    };
  }
  const buffer = await workbook.xlsx.writeBuffer();
  save(
    new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename + ".xlsx",
  );
}
export async function pdf(
  title: string,
  subtitle: string,
  sheets: ExportSheet[],
  filename: string,
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  let pages = 0;
  for (const sheet of sheets) {
    const width = 1120,
      height = 792,
      pad = 40;
    const columns = sheet.headings.length;
    const cw = (width - pad * 2) / columns;
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D;
    let y = 0;
    function start() {
      canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      ctx = canvas.getContext("2d")!;
      ctx.scale(2, 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#20291d";
      ctx.fillRect(0, 0, width, 108);
      ctx.fillStyle = "#d7c387";
      ctx.font = "600 12px sans-serif";
      ctx.fillText("SYNDICATE / MEMBER OPERATIONS", pad, 28);
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 23px sans-serif";
      ctx.fillText(title, pad, 61);
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#c1ceb5";
      ctx.fillText(subtitle, pad, 85);
      ctx.fillStyle = "#20291d";
      ctx.font = "600 16px sans-serif";
      ctx.fillText(sheet.name, pad, 139);
      ctx.fillStyle = "#ecefe7";
      ctx.fillRect(pad, 155, width - pad * 2, 35);
      ctx.fillStyle = "#3a4433";
      ctx.font = "bold 10px sans-serif";
      sheet.headings.forEach((h, i) => ctx.fillText(h, pad + i * cw + 7, 177));
      y = 191;
    }
    function finish() {
      ctx.font = "10px sans-serif";
      ctx.fillStyle = "#718167";
      ctx.fillText(
        `Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
        pad,
        height - 27,
      );
      ctx.fillText(`Page ${pages + 1}`, width - 90, height - 27);
      if (pages) doc.addPage();
      doc.addImage(
        canvas.toDataURL("image/jpeg", 0.93),
        "JPEG",
        0,
        0,
        841.89,
        595.28,
      );
      pages++;
    }
    function wrap(value: Cell) {
      ctx.font = "11px sans-serif";
      const output: string[] = [];
      let line = "";
      for (const char of String(value)) {
        if (ctx.measureText(line + char).width > cw - 15 || char === "\n") {
          output.push(line);
          line = char === "\n" ? "" : char;
        } else line += char;
      }
      output.push(line);
      return output;
    }
    start();
    for (const [index, row] of (sheet.rows.length
      ? sheet.rows
      : [["No records in this period."]]
    ).entries()) {
      const lines = row.map(wrap);
      let offset = 0;
      const count = Math.max(...lines.map((v) => v.length));
      while (offset < count) {
        if (height - 55 - y < 32) {
          finish();
          start();
        }
        const take = Math.min(
          count - offset,
          Math.floor((height - 55 - y - 16) / 15),
        );
        const rh = Math.max(32, take * 15 + 16);
        ctx!.fillStyle = index % 2 ? "#f5f7f2" : "#ffffff";
        ctx!.fillRect(pad, y, width - pad * 2, rh);
        ctx!.fillStyle = "#293522";
        ctx!.font = "11px sans-serif";
        lines.forEach((ls, i) =>
          ls
            .slice(offset, offset + take)
            .forEach((line, n) =>
              ctx!.fillText(line, pad + i * cw + 7, y + 20 + n * 15),
            ),
        );
        y += rh;
        offset += take;
        ctx!.strokeStyle = "#dce3d7";
        ctx!.beginPath();
        ctx!.moveTo(pad, y);
        ctx!.lineTo(width - pad, y);
        ctx!.stroke();
        if (offset < count) {
          finish();
          start();
        }
      }
    }
    finish();
  }
  doc.save(filename + ".pdf");
}
export function financialSheets(
  entries: Entry[],
  members: LiveMember[],
  groupBy: "day" | "month" = "day",
): ExportSheet[] {
  const summary = totals(entries);
  const bank = (e: Entry) =>
    members
      .flatMap((m) => m.profile.accounts || [])
      .find((a) => a.id === e.account_id)?.bank || "Company ledger";
  const table = (items: ReturnType<typeof groups>) =>
    items.map((g) => [
      g.label,
      g.turnover / 100,
      g.income / 100,
      g.expense / 100,
      g.net / 100,
      g.pending,
    ]);
  return [
    {
      name: "Summary",
      headings: ["Metric", "Value"],
      rows: [
        ["Turnover (INR)", summary.turnover / 100],
        ["Income (INR)", summary.income / 100],
        ["Expense (INR)", summary.expense / 100],
        ["Net income (INR)", summary.net / 100],
        ["Approved records", summary.approved],
        ["Pending records", summary.pending],
      ],
    },
    {
      name: groupBy === "day" ? "Daily totals" : "Monthly totals",
      headings: [
        "Period",
        "Turnover INR",
        "Income INR",
        "Expense INR",
        "Net INR",
        "Pending",
      ],
      rows: table(
        groups(entries, (e) =>
          groupBy === "day" ? e.date : e.date.slice(0, 7),
        ),
      ),
    },
    {
      name: "Bank totals",
      headings: [
        "Bank",
        "Turnover INR",
        "Income INR",
        "Expense INR",
        "Net INR",
        "Pending",
      ],
      rows: table(groups(entries, bank)),
    },
    {
      name: "Transactions",
      headings: [
        "Date",
        "Reference",
        "Member",
        "Bank",
        "Kind",
        "Amount INR",
        "Status",
        "Source",
      ],
      rows: entries.map((e) => [
        e.date,
        e.reference,
        members.find((m) => m.id === e.member_id)?.name || e.member_id,
        bank(e),
        e.kind,
        e.amount_paise / 100,
        e.status,
        e.source,
      ]),
    },
  ];
}
export function taskSheets(
  tasks: LiveTask[],
  members: LiveMember[],
): ExportSheet[] {
  return [
    {
      name: "Task register",
      headings: ["Task", "Instructions", "Assigned to", "Due date", "Status"],
      rows: tasks.map((t) => [
        t.title,
        t.description,
        members.find((m) => m.id === t.assignee)?.name || t.assignee,
        t.due,
        t.status,
      ]),
    },
  ];
}
