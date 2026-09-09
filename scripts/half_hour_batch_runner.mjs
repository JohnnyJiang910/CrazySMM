import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {
    input: "",
    output: "",
    intervalMinutes: 30,
    startAt: "",
    watch: false,
    once: false,
    includeZero: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--watch") args.watch = true;
    else if (arg === "--once") args.once = true;
    else if (arg === "--include-zero") args.includeZero = true;
    else if (arg === "--input") args.input = argv[++i] || "";
    else if (arg === "--output") args.output = argv[++i] || "";
    else if (arg === "--interval-minutes") args.intervalMinutes = Number(argv[++i] || 30);
    else if (arg === "--start-at") args.startAt = argv[++i] || "";
    else if (arg === "--help") args.help = true;
  }

  return args;
}

function usage() {
  return `Usage:
  node scripts/half_hour_batch_runner.mjs --input plan.csv
  node scripts/half_hour_batch_runner.mjs --input plan.csv --watch --start-at 2026-07-10T16:00:00+08:00

Options:
  --input              Growth model split CSV exported by the local site.
  --output             Output directory. Defaults to outputs/half_hour_batches/<timestamp>.
  --watch              Keep running and expose the due batch every interval.
  --once               In watch mode, emit only the currently due batch and exit.
  --interval-minutes   Interval length for watch mode. Default: 30.
  --start-at           Start time for slot 1. Default: now.
  --include-zero       Keep zero-quantity rows. Default: skipped.
`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function toNumber(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : fallback;
}

function toInt(value) {
  return Math.round(toNumber(value));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatHour(value) {
  const minutesTotal = Math.round(toNumber(value) * 60);
  return `${pad2(Math.floor(minutesTotal / 60))}${pad2(minutesTotal % 60)}`;
}

function formatHourLabel(start, end) {
  const startText = formatHour(start);
  const endText = formatHour(end);
  return `${startText.slice(0, 2)}:${startText.slice(2)}-${endText.slice(0, 2)}:${endText.slice(2)}`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function parsePlanCsv(text, includeZero) {
  const parsed = parseCsv(text);
  const headers = parsed.shift();
  if (!headers?.length) throw new Error("Input CSV has no header");

  const rows = parsed.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );

  const required = ["service", "link", "day", "slot", "hour_start", "hour_end", "add_quantity"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Input CSV is missing columns: ${missing.join(", ")}`);

  return rows
    .map((row) => ({
      sourceIndex: row.source_index,
      service: String(row.service || "").trim(),
      link: String(row.link || "").trim(),
      totalQuantity: toInt(row.total_quantity),
      modelKey: row.model_key,
      modelName: row.model_name,
      horizonDays: toInt(row.horizon_days),
      slot: toInt(row.slot),
      day: toInt(row.day),
      hourStart: toNumber(row.hour_start),
      hourEnd: toNumber(row.hour_end),
      phase: row.phase,
      share: toNumber(row.share),
      addQuantity: toInt(row.add_quantity),
      cumulativeQuantity: toInt(row.cumulative_quantity),
    }))
    .filter((row) => row.service && row.link && (includeZero || row.addQuantity > 0));
}

function groupBatches(rows) {
  const batchMap = new Map();

  for (const row of rows) {
    const key = `${row.day}:${row.slot}:${row.hourStart}:${row.hourEnd}`;
    if (!batchMap.has(key)) {
      batchMap.set(key, {
        day: row.day,
        slot: row.slot,
        hourStart: row.hourStart,
        hourEnd: row.hourEnd,
        rows: [],
      });
    }
    batchMap.get(key).rows.push(row);
  }

  const batches = [...batchMap.values()].sort((a, b) => {
    if (a.day !== b.day) return a.day - b.day;
    return a.slot - b.slot;
  });

  return batches.map((batch, index) => {
    const merged = new Map();
    for (const row of batch.rows) {
      const key = `${row.service}\t${row.link}`;
      const current = merged.get(key) || { service: row.service, link: row.link, quantity: 0 };
      current.quantity += row.addQuantity;
      merged.set(key, current);
    }
    const lines = [...merged.values()].filter((row) => row.quantity > 0);
    const quantity = lines.reduce((sum, row) => sum + row.quantity, 0);
    const filename = `day${pad2(batch.day)}_slot${String(batch.slot).padStart(3, "0")}_${formatHour(batch.hourStart)}-${formatHour(batch.hourEnd)}.txt`;
    return {
      index: index + 1,
      ...batch,
      lines,
      quantity,
      filename,
      label: `Day ${batch.day} ${formatHourLabel(batch.hourStart, batch.hourEnd)}`,
    };
  });
}

async function writeBatchFiles(outputDir, batches) {
  await mkdir(outputDir, { recursive: true });

  const scheduleRows = [
    ["batch_index", "day", "slot", "hour_start", "hour_end", "line_count", "quantity", "file"],
  ];
  const manifest = [];

  for (const batch of batches) {
    const text = batch.lines.map((row) => `${row.service} | ${row.link} | ${row.quantity}`).join("\n");
    await writeFile(path.join(outputDir, batch.filename), `${text}\n`, "utf8");
    scheduleRows.push([
      batch.index,
      batch.day,
      batch.slot,
      batch.hourStart,
      batch.hourEnd,
      batch.lines.length,
      batch.quantity,
      batch.filename,
    ]);
    manifest.push({
      batchIndex: batch.index,
      day: batch.day,
      slot: batch.slot,
      hourStart: batch.hourStart,
      hourEnd: batch.hourEnd,
      label: batch.label,
      lineCount: batch.lines.length,
      quantity: batch.quantity,
      file: batch.filename,
    });
  }

  await writeFile(path.join(outputDir, "schedule.csv"), `${toCsv(scheduleRows)}\n`, "utf8");
  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function emitCurrentBatch(outputDir, batches, startAt, intervalMinutes, once) {
  const startTime = startAt ? new Date(startAt) : new Date();
  if (Number.isNaN(startTime.getTime())) throw new Error(`Invalid --start-at value: ${startAt}`);

  const intervalMs = intervalMinutes * 60 * 1000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("--interval-minutes must be a positive number");
  }

  await mkdir(outputDir, { recursive: true });

  async function tick() {
    const now = new Date();
    const elapsed = now.getTime() - startTime.getTime();
    const batchIndex = Math.max(0, Math.floor(elapsed / intervalMs));
    const batch = batches[batchIndex];

    if (!batch) {
      console.log(`[done] No more batches. now=${now.toISOString()}`);
      process.exit(0);
    }

    const text = batch.lines.map((row) => `${row.service} | ${row.link} | ${row.quantity}`).join("\n");
    const currentPath = path.join(outputDir, "current_batch.txt");
    const metaPath = path.join(outputDir, "current_batch.json");
    await writeFile(currentPath, `${text}\n`, "utf8");
    await writeFile(
      metaPath,
      `${JSON.stringify(
        {
          emittedAt: now.toISOString(),
          startAt: startTime.toISOString(),
          intervalMinutes,
          batchIndex: batch.index,
          day: batch.day,
          slot: batch.slot,
          label: batch.label,
          lineCount: batch.lines.length,
          quantity: batch.quantity,
          sourceFile: batch.filename,
          currentBatchFile: currentPath,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    console.log(`[batch ${batch.index}/${batches.length}] ${batch.label} quantity=${batch.quantity} lines=${batch.lines.length}`);
    console.log(currentPath);

    if (once) process.exit(0);
  }

  await tick();
  setInterval(tick, intervalMs);
}

const args = parseArgs(process.argv);
if (args.help || !args.input) {
  console.log(usage());
  process.exit(args.help ? 0 : 1);
}

const inputPath = path.resolve(args.input);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.resolve(args.output || path.join(rootDir, "outputs", "half_hour_batches", stamp));

const inputText = await readFile(inputPath, "utf8");
const rows = parsePlanCsv(inputText, args.includeZero);
const batches = groupBatches(rows);
await writeBatchFiles(outputDir, batches);

const totalQuantity = batches.reduce((sum, batch) => sum + batch.quantity, 0);
const totalLines = batches.reduce((sum, batch) => sum + batch.lines.length, 0);
console.log(`Output: ${outputDir}`);
console.log(`Batches: ${batches.length}`);
console.log(`Lines: ${totalLines}`);
console.log(`Quantity: ${totalQuantity}`);

if (args.watch) {
  await emitCurrentBatch(outputDir, batches, args.startAt, args.intervalMinutes, args.once);
}
