import { createServer } from "node:http";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const storageRoot = path.resolve(process.env.DATA_ROOT || __dirname);
const dataDir = path.join(storageRoot, "work", "crazysmm-local");
const envPath = path.join(dataDir, ".env");
const batchRootDir = path.join(storageRoot, "outputs", "half_hour_batches");
const modelCsvPath =
  process.env.GROWTH_MODEL_CSV ||
  path.join(__dirname, "data", "growth-models", "traffic_growth_model_points_normalized_v1.csv");
const apiUrl = process.env.CRAZYSMM_API_URL || "https://crazysmm.com/api/v2";

let apiKey = process.env.CRAZYSMM_API_KEY || "";
let modelCache = null;
const batchRunners = new Map();

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

async function loadLocalEnv() {
  if (!existsSync(envPath)) return;
  const text = await readFile(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*CRAZYSMM_API_KEY\s*=\s*(.+?)\s*$/);
    if (match && !apiKey) apiKey = match[1].replace(/^["']|["']$/g, "");
  }
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

async function loadModels() {
  if (modelCache) return modelCache;

  const text = await readFile(modelCsvPath, "utf8");
  const parsed = parseCsv(text);
  const headers = parsed.shift();
  const rows = parsed.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );

  const modelMap = new Map();
  const slotMap = new Map();

  for (const row of rows) {
    const horizonDays = Number(row.horizon_days);
    const modelKey = row.model_key;
    const entry = {
      modelId: row.model_id,
      modelKey,
      modelName: row.model_name,
      family: row.family,
      horizonDays,
      slot: Number(row.slot),
      day: Number(row.day),
      hourStart: Number(row.hour_start),
      hourEnd: Number(row.hour_end),
      progressStart: Number(row.progress_start),
      progressEnd: Number(row.progress_end),
      phase: row.phase,
      incrementShare: Number(row.increment_share),
      cumulativeShare: Number(row.cumulative_share),
    };

    if (!modelMap.has(modelKey)) {
      modelMap.set(modelKey, {
        modelId: row.model_id,
        modelKey,
        modelName: row.model_name,
        family: row.family,
        horizons: new Set(),
      });
    }
    modelMap.get(modelKey).horizons.add(horizonDays);

    const slotKey = `${modelKey}:${horizonDays}`;
    if (!slotMap.has(slotKey)) slotMap.set(slotKey, []);
    slotMap.get(slotKey).push(entry);
  }

  const models = [...modelMap.values()]
    .map((model) => ({ ...model, horizons: [...model.horizons].sort((a, b) => a - b) }))
    .sort((a, b) => a.modelId.localeCompare(b.modelId, "en", { numeric: true }));

  for (const slots of slotMap.values()) slots.sort((a, b) => a.slot - b.slot);
  modelCache = { models, slotMap, modelCsvPath };
  return modelCache;
}

function getModelSlots(cache, modelKey, horizonDays) {
  const slots = cache.slotMap.get(`${modelKey}:${horizonDays}`);
  if (!slots?.length) {
    const err = new Error("Selected model or horizon was not found");
    err.status = 400;
    throw err;
  }
  return slots;
}

function allocateQuantity(quantity, slots, minQuantity = 0) {
  const totalShare = slots.reduce((sum, slot) => sum + slot.incrementShare, 0);
  const exactParts = slots.map((slot, index) => {
    const exact = totalShare > 0 ? (quantity * slot.incrementShare) / totalShare : 0;
    const floored = Math.floor(exact);
    return { index, addQuantity: floored, fraction: exact - floored };
  });

  let remainder = quantity - exactParts.reduce((sum, part) => sum + part.addQuantity, 0);
  const byRemainder = [...exactParts].sort((a, b) => {
    if (b.fraction !== a.fraction) return b.fraction - a.fraction;
    return a.index - b.index;
  });

  for (let i = 0; i < byRemainder.length && remainder > 0; i += 1) {
    byRemainder[i].addQuantity += 1;
    remainder -= 1;
  }

  if (minQuantity <= 0) return { quantities: exactParts.map((part) => part.addQuantity), skipped: 0, redistributed: 0 };

  let totalSkipped = 0;
  let totalRedistributed = 0;

  for (let round = 0; round < 10; round += 1) {
    const zeroedByThreshold = new Set();
    let roundRedist = 0;
    let roundSkipped = 0;

    for (const part of exactParts) {
      if (part.addQuantity > 0 && part.addQuantity < minQuantity) {
        roundRedist += part.addQuantity;
        part.addQuantity = 0;
        roundSkipped += 1;
        zeroedByThreshold.add(part.index);
      }
    }

    if (!roundSkipped) break;

    totalSkipped += roundSkipped;
    totalRedistributed += roundRedist;

    const keptSlots = [];
    for (let i = 0; i < slots.length; i += 1) {
      if (exactParts[i].addQuantity >= minQuantity || (exactParts[i].addQuantity === 0 && !zeroedByThreshold.has(i))) {
        keptSlots.push({ slot: slots[i], origIdx: i });
      }
    }

    if (!keptSlots.length) break;

    const keptTotalShare = keptSlots.reduce((sum, s) => sum + s.slot.incrementShare, 0);
    if (keptTotalShare <= 0) break;

    const addParts = keptSlots.map((ks) => {
      const exact = (roundRedist * ks.slot.incrementShare) / keptTotalShare;
      const floored = Math.floor(exact);
      return { origIdx: ks.origIdx, redistAdd: floored, redistFrac: exact - floored };
    });

    let redistRemainder = roundRedist - addParts.reduce((sum, p) => sum + p.redistAdd, 0);
    const byFrac = [...addParts].sort((a, b) => {
      if (b.redistFrac !== a.redistFrac) return b.redistFrac - a.redistFrac;
      return a.origIdx - b.origIdx;
    });

    for (let i = 0; i < byFrac.length && redistRemainder > 0; i += 1) {
      exactParts[byFrac[i].origIdx].addQuantity += 1;
      redistRemainder -= 1;
    }

    for (const ap of addParts) {
      exactParts[ap.origIdx].addQuantity += ap.redistAdd;
    }
  }

  return {
    quantities: exactParts.map((part) => part.addQuantity),
    skipped: totalSkipped,
    redistributed: totalRedistributed,
  };
}

async function buildModelPlan(body) {
  const modelKey = String(body.modelKey || "").trim();
  const modelKeys = Array.isArray(body.modelKeys) && body.modelKeys.length ? body.modelKeys : [modelKey];
  const randomMode = Boolean(body.randomMode && modelKeys.length > 1);
  const horizonDays = Number(body.horizonDays);
  const minQuantity = Number(body.minQuantity || 0);
  const inputRows = Array.isArray(body.rows) ? body.rows : [];

  if (!modelKeys[0]) {
    const err = new Error("modelKey or modelKeys is required");
    err.status = 400;
    throw err;
  }
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 7) {
    const err = new Error("horizonDays must be an integer from 1 to 7");
    err.status = 400;
    throw err;
  }

  const cache = await loadModels();
  const slotCache = new Map();
  const planRows = [];
  const sourceSummaries = [];
  let totalSkippedSlots = 0;
  let totalRedistributed = 0;

  inputRows.forEach((source, index) => {
    const service = String(source.service || "").trim();
    const link = String(source.link || "").trim();
    const quantity = toNumber(source.quantity);
    if (!/^\d+$/.test(service) || !/^https:\/\/(x|twitter)\.com\/[^/\s]+\/status\/\d+/i.test(link)) return;
    if (!Number.isInteger(quantity) || quantity <= 0) return;

    const pickedKey = randomMode ? modelKeys[Math.floor(Math.random() * modelKeys.length)] : modelKeys[0];
    if (!slotCache.has(pickedKey)) {
      slotCache.set(pickedKey, getModelSlots(cache, pickedKey, horizonDays));
    }
    const slots = slotCache.get(pickedKey);
    const model = cache.models.find((item) => item.modelKey === pickedKey);

    const result = allocateQuantity(quantity, slots, minQuantity);
    const quantities = result.quantities;
    totalSkippedSlots += result.skipped;
    totalRedistributed += result.redistributed;
    let cumulativeQuantity = 0;

    slots.forEach((slot, slotIndex) => {
      const addQuantity = quantities[slotIndex];
      if (addQuantity <= 0) return;
      cumulativeQuantity += addQuantity;
      planRows.push({
        sourceIndex: Number(source.index) || index + 1,
        service,
        link,
        totalQuantity: quantity,
        modelKey: pickedKey,
        modelName: model?.modelName || pickedKey,
        family: model?.family || "",
        horizonDays,
        slot: slot.slot,
        day: slot.day,
        hourStart: slot.hourStart,
        hourEnd: slot.hourEnd,
        phase: slot.phase,
        share: slot.incrementShare,
        addQuantity,
        cumulativeQuantity,
      });
    });

    sourceSummaries.push({
      sourceIndex: Number(source.index) || index + 1,
      service,
      link,
      requestedQuantity: quantity,
      plannedQuantity: cumulativeQuantity,
      slots: quantities.length,
      matched: cumulativeQuantity === quantity,
    });
  });

  return {
    model: cache.models.find((item) => item.modelKey === modelKeys[0]) || { modelKey: modelKeys[0], modelName: modelKeys[0], family: "" },
    randomMode,
    modelKeys,
    horizonDays,
    minQuantity,
    slotCount: randomMode ? planRows.length : getModelSlots(cache, modelKeys[0], horizonDays).length,
    inputRows: inputRows.length,
    validRows: sourceSummaries.length,
    requestedTotal: sourceSummaries.reduce((sum, item) => sum + item.requestedQuantity, 0),
    plannedTotal: sourceSummaries.reduce((sum, item) => sum + item.plannedQuantity, 0),
    skippedSlots: totalSkippedSlots,
    redistributedTotal: totalRedistributed,
    sourceSummaries,
    rows: planRows,
  };
}

function assertInsideBatchRoot(targetPath) {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(batchRootDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    const err = new Error("Batch directory is outside outputs/half_hour_batches");
    err.status = 400;
    throw err;
  }
  return resolved;
}

function projectIdFromPath(dirPath) {
  return path.basename(path.resolve(dirPath));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runnerStatePath(dirPath) {
  return path.join(dirPath, "runner_state.json");
}

async function saveRunnerState(runner) {
  try {
    const state = {
      cursor: runner.cursor,
      mode: runner.mode,
      intervalSeconds: runner.intervalSeconds,
      finished: runner.finished,
      startedAt: runner.startedAt,
      taskStatuses: runner.tasks.map((t) => ({ id: t.id, status: t.status })),
      logs: runner.logs.slice(-50),
      savedAt: new Date().toISOString(),
    };
    await writeFile(runnerStatePath(runner.dirPath), JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch { /* best-effort, don't crash on save failure */ }
}

async function restoreRunnerState(runner) {
  const sp = runnerStatePath(runner.dirPath);
  if (!existsSync(sp)) return;
  try {
    const state = JSON.parse(await readFile(sp, "utf8"));
    runner.cursor = Number(state.cursor) || 0;
    runner.mode = state.mode || "dry-run";
    runner.intervalSeconds = Number(state.intervalSeconds) || 1800;
    runner.finished = Boolean(state.finished);
    runner.startedAt = state.startedAt || "";
    runner.logs = Array.isArray(state.logs) ? state.logs : [];
    const statusMap = new Map();
    if (Array.isArray(state.taskStatuses)) {
      for (const ts of state.taskStatuses) statusMap.set(ts.id, ts.status);
    }
    runner.tasks = await loadBatchTasks(runner.dirPath);
    for (const task of runner.tasks) {
      if (statusMap.has(task.id)) task.status = statusMap.get(task.id);
    }
  } catch { /* ignore corrupt state file */ }
}

function createBatchRunner(dirPath) {
  const safeDir = assertInsideBatchRoot(dirPath);
  const id = projectIdFromPath(safeDir);
  return {
    id,
    name: id,
    active: false,
    dirPath: safeDir,
    startedAt: "",
    interval: null,
    intervalSeconds: 1800,
    finished: false,
    cursor: 0,
    tasks: [],
    logs: [],
    currentTask: null,
    advancing: false,
    mode: "dry-run",
    orderResultsPath: path.join(safeDir, "order_results.json"),
  };
}

function getBatchRunner(dirPathOrId) {
  const raw = String(dirPathOrId || "").trim();
  if (!raw) {
    const err = new Error("Batch project is required");
    err.status = 400;
    throw err;
  }
  if (batchRunners.has(raw)) return batchRunners.get(raw);

  const maybePath = raw.includes("\\") || raw.includes("/") ? raw : path.join(batchRootDir, raw);
  const safeDir = assertInsideBatchRoot(maybePath);
  const id = projectIdFromPath(safeDir);
  if (!batchRunners.has(id)) batchRunners.set(id, createBatchRunner(safeDir));
  return batchRunners.get(id);
}

function addBatchLog(runner, type, msg) {
  runner.logs.push({ type, msg, time: new Date().toLocaleString("zh-CN", { hour12: false }) });
  runner.logs = runner.logs.slice(-120);
}

async function listBatchDirs() {
  if (!existsSync(batchRootDir)) return [];
  const entries = await readdir(batchRootDir, { withFileTypes: true });
  const dirs = [];
  const seen = new Set();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    seen.add(entry.name);
    const dirPath = path.join(batchRootDir, entry.name);
    const isNew = !batchRunners.has(entry.name);
    if (isNew) batchRunners.set(entry.name, createBatchRunner(dirPath));
    const runner = batchRunners.get(entry.name);
    if (isNew && !runner.active) {
      try { await restoreRunnerState(runner); } catch { /* keep empty */ }
      if (!runner.tasks.length) {
        try { runner.tasks = await loadBatchTasks(dirPath); } catch { /* keep empty */ }
      }
    }
    dirs.push({
      id: entry.name,
      name: entry.name,
      path: dirPath,
      hasManifest: existsSync(path.join(dirPath, "manifest.json")),
      hasSchedule: existsSync(path.join(dirPath, "schedule.csv")),
      active: Boolean(runner?.active),
      stats: runner ? batchStats(runner) : null,
    });
  }

  for (const [id, runner] of batchRunners.entries()) {
    if (seen.has(id)) continue;
    if (runner.interval) clearInterval(runner.interval);
    batchRunners.delete(id);
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  return dirs;
}

async function ensureBatchRunnersFromDirs() {
  await listBatchDirs();
}

async function loadBatchTasks(dirPath) {
  const safeDir = assertInsideBatchRoot(dirPath);
  const manifestPath = path.join(safeDir, "manifest.json");
  const schedulePath = path.join(safeDir, "schedule.csv");

  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    return manifest.map((item, index) => ({
      id: index + 1,
      file: item.file,
      label: item.label || `Batch ${index + 1}`,
      lineCount: Number(item.lineCount || 0),
      quantity: Number(item.quantity || 0),
      status: "pending",
    }));
  }

  if (existsSync(schedulePath)) {
    const parsed = parseCsv(await readFile(schedulePath, "utf8"));
    const headers = parsed.shift();
    return parsed.map((values, index) => {
      const row = Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex] ?? ""]));
      return {
        id: index + 1,
        file: row.file,
        label: `Day ${row.day} slot ${row.slot}`,
        lineCount: Number(row.line_count || 0),
        quantity: Number(row.quantity || 0),
        status: "pending",
      };
    });
  }

  const files = (await readdir(safeDir)).filter((file) => file.endsWith(".txt") && file !== "current_batch.txt").sort();
  return files.map((file, index) => ({
    id: index + 1,
    file,
    label: file,
    lineCount: 0,
    quantity: 0,
    status: "pending",
  }));
}

function batchStats(runner) {
  return {
    total: runner.tasks.length,
    pending: runner.tasks.filter((task) => task.status === "pending").length,
    ready: runner.tasks.filter((task) => task.status === "ready").length,
    completed: runner.tasks.filter((task) => task.status === "completed").length,
    failed: runner.tasks.filter((task) => task.status === "failed").length,
  };
}

async function writeCurrentBatch(runner, task) {
  const safeSource = assertInsideBatchRoot(path.join(runner.dirPath, task.file));
  const content = await readFile(safeSource, "utf8");
  await writeFile(path.join(runner.dirPath, "current_batch.txt"), content, "utf8");
  await writeFile(
    path.join(runner.dirPath, "current_batch.json"),
    `${JSON.stringify(
      {
        emittedAt: new Date().toISOString(),
        dryRun: runner.mode === "dry-run",
        mode: runner.mode,
        projectId: runner.id,
        projectName: runner.name,
        task,
        currentBatchFile: path.join(runner.dirPath, "current_batch.txt"),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function placeBatchOrder(service, link, quantity) {
  try {
    const result = await callCrazySmm("add", { service, link, quantity: String(quantity) });
    if (result?.error || result?.order === undefined || String(result.order).trim() === "") {
      return {
        service,
        link,
        quantity,
        orderId: "",
        status: "failed",
        error: String(result?.error || "CrazySMM did not return an order ID"),
      };
    }
    return { service, link, quantity, orderId: String(result.order ?? ""), status: "submitted", error: null };
  } catch (error) {
    return { service, link, quantity, orderId: "", status: "failed", error: error.message };
  }
}

async function appendOrderResults(runner, batchFile, results) {
  const record = {
    batchFile,
    emittedAt: new Date().toISOString(),
    mode: runner.mode,
    lines: results,
    summary: {
      total: results.length,
      submitted: results.filter((r) => r.status === "submitted").length,
      failed: results.filter((r) => r.status === "failed").length,
    },
  };

  let existing = [];
  if (existsSync(runner.orderResultsPath)) {
    try { existing = JSON.parse(await readFile(runner.orderResultsPath, "utf8")); } catch { existing = []; }
  }
  existing.push(record);
  await writeFile(runner.orderResultsPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
}

function parseBatchLines(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((s) => s.trim());
      return { service: parts[0] || "", link: parts[1] || "", quantity: Number(parts[2]) || 0 };
    })
    .filter((item) => /^\d+$/.test(item.service) && item.link && item.quantity > 0);
}

async function advanceBatchRunner(runner) {
  if (!runner.active || runner.advancing) return;
  runner.advancing = true;
  const task = runner.tasks[runner.cursor];
  if (!task) {
    runner.active = false;
    runner.finished = true;
    if (runner.interval) clearInterval(runner.interval);
    runner.interval = null;
    runner.currentTask = null;
    addBatchLog(runner, "success", `所有批次已完成（模式：${runner.mode}）`);
    saveRunnerState(runner);
    runner.advancing = false;
    return;
  }

  try {
    task.status = "ready";
    runner.currentTask = task;
    await writeCurrentBatch(runner, task);

    const safeSource = assertInsideBatchRoot(path.join(runner.dirPath, task.file));
    const content = await readFile(safeSource, "utf8");
    const lines = parseBatchLines(content);
    const results = [];

    if (runner.mode === "live") {
      for (const item of lines) {
        const result = await placeBatchOrder(item.service, item.link, item.quantity);
        results.push(result);
        addBatchLog(
          runner,
          result.status === "submitted" ? "success" : "error",
          `${task.file} | svc ${item.service} | qty ${item.quantity} → ${result.orderId || result.error}`,
        );
        await delay(500);
      }
    } else {
      for (const item of lines) {
        results.push({ ...item, orderId: "(dry-run)", status: "skipped", error: null });
      }
      addBatchLog(runner, "info", `dry-run：${task.file}，${lines.length} 行，数量 ${lines.reduce((s, l) => s + l.quantity, 0)}`);
    }

    task.orderResults = results;
    task.orderCount = results.filter((r) => r.status === "submitted" || r.status === "skipped").length;
    await appendOrderResults(runner, task.file, results);
    task.status = "completed";
    runner.cursor += 1;
  } catch (error) {
    task.status = "failed";
    runner.cursor += 1;
    addBatchLog(runner, "error", `${task.file} 处理失败：${error.message}`);
  }
  runner.advancing = false;
  if (runner.cursor >= runner.tasks.length) {
    runner.active = false;
    runner.finished = true;
    if (runner.interval) clearInterval(runner.interval);
    runner.interval = null;
    runner.currentTask = null;
    addBatchLog(runner, "success", `所有批次已完成（模式：${runner.mode}）`);
  }
  saveRunnerState(runner);
}

async function startBatchRunner(dirPathOrId, intervalSeconds = 1800, mode = "dry-run") {
  const runner = getBatchRunner(dirPathOrId);
  const info = await stat(runner.dirPath);
  if (!info.isDirectory()) {
    const err = new Error("Selected batch path is not a directory");
    err.status = 400;
    throw err;
  }

  if (runner.interval) clearInterval(runner.interval);
  runner.intervalSeconds = Math.max(1, Number(intervalSeconds)) || 1800;

  if (runner.finished) {
    runner.cursor = 0;
    runner.tasks = await loadBatchTasks(runner.dirPath);
    runner.logs = [];
    runner.finished = false;
  }

  const hasProgress = runner.cursor > 0 && runner.tasks.some((t) => t.status === "completed");
  const wasReset = !hasProgress;

  if (wasReset) {
    runner.cursor = 0;
    runner.tasks = await loadBatchTasks(runner.dirPath);
    runner.logs = [];
  }
  runner.mode = mode === "live" ? "live" : "dry-run";
  runner.active = true;
  runner.startedAt = new Date().toISOString();
  runner.currentTask = null;
  addBatchLog(runner, "info", `${wasReset ? "启动" : "恢复"}批次测试：${runner.name}，共 ${runner.tasks.length} 批，模式：${runner.mode}，从第 ${runner.cursor + 1} 批继续`);
  await advanceBatchRunner(runner);
  if (runner.active) {
    runner.interval = setInterval(() => advanceBatchRunner(runner), runner.intervalSeconds * 1000);
  }
  return runner;
}

async function startAllBatchRunners(intervalSeconds = 1800) {
  const dirs = await listBatchDirs();
  const runners = [];
  for (const dir of dirs) runners.push(await startBatchRunner(dir.path, intervalSeconds));
  return runners;
}

function stopBatchRunner(dirPathOrId) {
  const runner = getBatchRunner(dirPathOrId);
  if (runner.interval) clearInterval(runner.interval);
  runner.interval = null;
  runner.active = false;
  runner.finished = false;
  addBatchLog(runner, "info", "批次测试已停止");
  saveRunnerState(runner);
  return runner;
}

function stopAllBatchRunners() {
  for (const runner of batchRunners.values()) {
    if (runner.interval) clearInterval(runner.interval);
    runner.interval = null;
    runner.active = false;
    addBatchLog(runner, "info", "批次测试已停止");
  }
}

function compactRunnerStatus(runner) {
  const stats = batchStats(runner);
  const remaining = stats.total - stats.completed - stats.failed;
  const progress = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
  let estimatedCompletion = null;
  if (runner.active && remaining > 0 && runner.startedAt) {
    const eta = Date.now() + remaining * runner.intervalSeconds * 1000;
    estimatedCompletion = new Date(eta).toISOString();
  }
  return {
    id: runner.id,
    name: runner.name,
    active: runner.active,
    finished: runner.finished || false,
    dirPath: runner.dirPath,
    startedAt: runner.startedAt,
    cursor: runner.cursor,
    currentTask: runner.currentTask,
    mode: runner.mode,
    intervalSeconds: runner.intervalSeconds,
    stats,
    progress,
    estimatedCompletion,
    lastLog: runner.logs[runner.logs.length - 1] || null,
  };
}

function formatTimeLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function batchRunnerStatus(projectId = "") {
  const runners = [...batchRunners.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  const selected = projectId ? getBatchRunner(projectId) : runners[0];
  let selectedData = null;
  if (selected) {
    const baseStart = (selected.startedAt ? new Date(selected.startedAt).getTime() : Date.now());
    const tasksWithTime = selected.tasks.map((task, i) => {
      const timeLabel = formatTimeLabel(new Date(baseStart + i * selected.intervalSeconds * 1000).toISOString());
      return { ...task, timeLabel };
    });
    selectedData = {
      ...compactRunnerStatus(selected),
      tasks: tasksWithTime,
      logs: selected.logs,
    };
  }
  return {
    active: runners.some((runner) => runner.active),
    projects: runners.map(compactRunnerStatus),
    selectedProjectId: selected?.id || "",
    selected: selectedData,
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function callCrazySmm(action, params = {}) {
  if (!apiKey) {
    const err = new Error("CRAZYSMM_API_KEY is not configured");
    err.status = 400;
    throw err;
  }

  const body = new URLSearchParams({ key: apiKey, action, ...params });
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(`CrazySMM returned HTTP ${response.status}`);
    err.status = response.status;
    err.payload = json;
    throw err;
  }
  return json;
}

async function saveApiKey(nextKey) {
  apiKey = String(nextKey || "").trim();
  await mkdir(dataDir, { recursive: true });
  await writeFile(envPath, `CRAZYSMM_API_KEY=${apiKey}\n`, "utf8");
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const relativePath =
    pathname === "/"
      ? "index.html"
      : path.normalize(pathname.replace(/^\/+/, "")).replace(/^(\.\.[/\\])+/, "");
  const target = path.join(publicDir, relativePath);
  if (!target.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(target);
    res.writeHead(200, {
      "content-type": mimeTypes.get(path.extname(target)) || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");

  try {
    if (url.pathname === "/api/config" && req.method === "GET") {
      sendJson(res, 200, { hasKey: Boolean(apiKey), apiUrl, modelCsvPath });
      return;
    }

    if (url.pathname === "/api/config" && req.method === "POST") {
      const body = await readJson(req);
      await saveApiKey(body.apiKey);
      sendJson(res, 200, { hasKey: Boolean(apiKey), apiUrl, modelCsvPath });
      return;
    }

    if (url.pathname === "/api/models" && req.method === "GET") {
      const cache = await loadModels();
      sendJson(res, 200, { models: cache.models, modelCsvPath: cache.modelCsvPath });
      return;
    }

    if (url.pathname === "/api/health" && req.method === "GET") {
      let modelReady = false;
      let modelCount = 0;
      let modelError = null;
      try {
        const cache = await loadModels();
        modelReady = true;
        modelCount = cache.models.length;
      } catch {
        modelError = "Growth model CSV is unavailable or invalid";
      }
      sendJson(res, modelReady ? 200 : 503, {
        ok: modelReady,
        hasKey: Boolean(apiKey),
        apiUrl,
        modelCsvPath: path.basename(modelCsvPath),
        modelReady,
        modelCount,
        modelError,
      });
      return;
    }

    if (url.pathname === "/api/model-plan" && req.method === "POST") {
      const body = await readJson(req);
      sendJson(res, 200, await buildModelPlan(body));
      return;
    }

    if (url.pathname === "/api/model-plan/commit" && req.method === "POST") {
      const body = await readJson(req);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) {
        sendJson(res, 400, { error: "No plan rows to commit" });
        return;
      }

      const fallbackName = `plan_${Date.now()}`;
      const safeName = String(body.name || fallbackName)
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/^\.+$/, "_")
        .slice(0, 64) || fallbackName;
      const projectDir = assertInsideBatchRoot(path.join(batchRootDir, safeName));
      await mkdir(projectDir, { recursive: true });

      const slotMap = new Map();
      for (const row of rows) {
        const key = `${row.day}|${row.slot}|${row.hourStart}|${row.hourEnd}`;
        if (!slotMap.has(key)) {
          slotMap.set(key, { day: row.day, slot: row.slot, hourStart: row.hourStart, hourEnd: row.hourEnd, lines: [], totalQty: 0 });
        }
        const entry = slotMap.get(key);
        entry.lines.push(`${row.service} | ${row.link} | ${row.addQuantity}`);
      }
      for (const [key, entry] of slotMap) {
        let totalQty = 0;
        for (const line of entry.lines) {
          const m = line.match(/\|\s*(\d+)\s*$/);
          if (m) totalQty += Number(m[1]) || 0;
        }
        entry.totalQty = totalQty;
        entry.key = key;
      }

      const sorted = [...slotMap.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));

      const padDay = (d) => `day${String(d).padStart(2, "0")}`;
      const padSlot = (s) => `slot${String(s).padStart(3, "0")}`;
      const padHour = (h) => String(Math.round(h * 60)).padStart(4, "0");
      const manifest = [];

      for (let i = 0; i < sorted.length; i += 1) {
        const entry = sorted[i];
        const fileName = `${padDay(entry.day)}_${padSlot(entry.slot)}_${padHour(entry.hourStart)}-${padHour(entry.hourEnd)}.txt`;
        await writeFile(path.join(projectDir, fileName), entry.lines.join("\n") + "\n", "utf8");
        manifest.push({
          batchIndex: i,
          day: entry.day,
          slot: entry.slot,
          hourStart: entry.hourStart,
          hourEnd: entry.hourEnd,
          label: `Day ${entry.day} ${String(Math.floor(entry.hourStart)).padStart(2, "0")}:${String((entry.hourStart % 1) * 60).padStart(2, "0")}-${String(Math.floor(entry.hourEnd)).padStart(2, "0")}:${String((entry.hourEnd % 1) * 60).padStart(2, "0")}`,
          lineCount: entry.lines.length,
          quantity: entry.totalQty,
          file: fileName,
        });
      }

      await writeFile(path.join(projectDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

      const csvHeader = "batch_index,day,slot,hour_start,hour_end,line_count,quantity,file";
      const csvLines = manifest.map((m) => `${m.batchIndex},${m.day},${m.slot},${m.hourStart},${m.hourEnd},${m.lineCount},${m.quantity},${m.file}`);
      await writeFile(path.join(projectDir, "schedule.csv"), csvHeader + "\n" + csvLines.join("\n") + "\n", "utf8");

      sendJson(res, 200, {
        project: safeName,
        path: projectDir,
        slotCount: sorted.length,
        totalLines: sorted.reduce((s, e) => s + e.lines.length, 0),
        totalQuantity: sorted.reduce((s, e) => s + e.totalQty, 0),
      });
      return;
    }

    if (url.pathname === "/api/batch-runner/batches" && req.method === "GET") {
      sendJson(res, 200, { batches: await listBatchDirs() });
      return;
    }

    if (url.pathname === "/api/batch-runner/batches" && req.method === "DELETE") {
      const body = await readJson(req);
      const runner = getBatchRunner(body.projectId || body.dirPath);
      if (runner.active) {
        sendJson(res, 400, { error: "Cannot delete active project, stop it first" });
        return;
      }
      const targetDir = assertInsideBatchRoot(runner.dirPath);
      await rm(targetDir, { recursive: true, force: true });
      if (runner.interval) clearInterval(runner.interval);
      batchRunners.delete(runner.id);
      sendJson(res, 200, { deleted: runner.id, path: targetDir });
      return;
    }

    if (url.pathname === "/api/batch-runner/start" && req.method === "POST") {
      const body = await readJson(req);
      const runner = await startBatchRunner(body.projectId || body.dirPath, body.intervalSeconds || 1800, body.mode || "dry-run");
      sendJson(res, 200, batchRunnerStatus(runner.id));
      return;
    }

    if (url.pathname === "/api/batch-runner/mode" && req.method === "GET") {
      const projectId = url.searchParams.get("projectId") || "";
      const runner = projectId ? getBatchRunner(projectId) : null;
      sendJson(res, 200, { mode: runner?.mode || "dry-run", projectId: runner?.id || "" });
      return;
    }

    if (url.pathname === "/api/batch-runner/interval" && req.method === "POST") {
      const body = await readJson(req);
      const runner = getBatchRunner(body.projectId || body.dirPath);
      const newInterval = Math.max(1, Number(body.intervalSeconds || 1800));
      runner.intervalSeconds = newInterval;
      if (runner.active && runner.interval) {
        clearInterval(runner.interval);
        runner.interval = setInterval(() => advanceBatchRunner(runner), runner.intervalSeconds * 1000);
      }
      addBatchLog(runner, "info", `间隔已更新为 ${newInterval} 秒`);
      saveRunnerState(runner);
      sendJson(res, 200, { intervalSeconds: runner.intervalSeconds, projectId: runner.id });
      return;
    }

    if (url.pathname === "/api/batch-runner/mode" && req.method === "POST") {
      const body = await readJson(req);
      const runner = getBatchRunner(body.projectId || body.dirPath);
      if (runner.active) {
        sendJson(res, 400, { error: "Cannot change mode while runner is active" });
        return;
      }
      runner.mode = body.mode === "live" ? "live" : "dry-run";
      addBatchLog(runner, "info", `模式已切换为：${runner.mode}`);
      saveRunnerState(runner);
      sendJson(res, 200, { mode: runner.mode, projectId: runner.id });
      return;
    }

    if (url.pathname === "/api/batch-runner/start-all" && req.method === "POST") {
      const body = await readJson(req);
      await startAllBatchRunners(body.intervalSeconds || 1800);
      sendJson(res, 200, batchRunnerStatus());
      return;
    }

    if (url.pathname === "/api/batch-runner/stop" && req.method === "POST") {
      const body = await readJson(req);
      const runner = stopBatchRunner(body.projectId || body.dirPath);
      sendJson(res, 200, batchRunnerStatus(runner.id));
      return;
    }

    if (url.pathname === "/api/batch-runner/stop-all" && req.method === "POST") {
      stopAllBatchRunners();
      sendJson(res, 200, batchRunnerStatus());
      return;
    }

    if (url.pathname === "/api/batch-runner/status" && req.method === "GET") {
      await ensureBatchRunnersFromDirs();
      sendJson(res, 200, batchRunnerStatus(url.searchParams.get("projectId") || ""));
      return;
    }

    if (url.pathname === "/api/balance" && req.method === "POST") {
      sendJson(res, 200, await callCrazySmm("balance"));
      return;
    }

    if (url.pathname === "/api/services" && req.method === "POST") {
      sendJson(res, 200, await callCrazySmm("services"));
      return;
    }

    if (url.pathname === "/api/status" && req.method === "POST") {
      const body = await readJson(req);
      const orders = Array.isArray(body.orders) ? body.orders : [];
      const cleaned = orders.map((id) => String(id).trim()).filter(Boolean);
      if (!cleaned.length) {
        sendJson(res, 400, { error: "No order IDs provided" });
        return;
      }
      const params = cleaned.length === 1 ? { order: cleaned[0] } : { orders: cleaned.join(",") };
      sendJson(res, 200, await callCrazySmm("status", params));
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || "Server error",
      details: error.payload || null,
    });
  }
}

await loadLocalEnv();

const preferredPort = Number(process.env.PORT || 5178);
const preferredHost = process.env.HOST || "0.0.0.0";
function listen(port) {
  const server = createServer(route);
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && port < preferredPort + 20) {
      listen(port + 1);
      return;
    }
    throw error;
  });
  server.listen(port, preferredHost, () => {
    const displayHost = preferredHost === "0.0.0.0" ? "127.0.0.1" : preferredHost;
    console.log(`CrazySMM console: http://${displayHost}:${port}`);
  });
}

listen(preferredPort);
