const els = {
  navLinks: [...document.querySelectorAll(".nav-link")],
  viewPanels: [...document.querySelectorAll(".view")],
  globalStatus: document.querySelector("#globalStatus"),
  keyState: document.querySelector("#keyState"),
  apiUrl: document.querySelector("#apiUrl"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  backendState: document.querySelector("#backendState"),
  healthModelCount: document.querySelector("#healthModelCount"),
  refreshHealthBtn: document.querySelector("#refreshHealthBtn"),
  saveKeyBtn: document.querySelector("#saveKeyBtn"),
  balanceBtn: document.querySelector("#balanceBtn"),
  servicesBtn: document.querySelector("#servicesBtn"),
  serviceSearchInput: document.querySelector("#serviceSearchInput"),
  serviceSelect: document.querySelector("#serviceSelect"),
  loadServicesBtn: document.querySelector("#loadServicesBtn"),
  selectedServiceInfo: document.querySelector("#selectedServiceInfo"),
  bulkInput: document.querySelector("#bulkInput"),
  parseBtn: document.querySelector("#parseBtn"),
  translateBtn: document.querySelector("#translateBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  sampleBtn: document.querySelector("#sampleBtn"),
  validCount: document.querySelector("#validCount"),
  errorCount: document.querySelector("#errorCount"),
  quantityTotal: document.querySelector("#quantityTotal"),
  serviceCount: document.querySelector("#serviceCount"),
  modelHint: document.querySelector("#modelHint"),
  modelSelect: document.querySelector("#modelSelect"),
  horizonSelect: document.querySelector("#horizonSelect"),
  minQuantityInput: document.querySelector("#minQuantityInput"),
  randomModelToggle: document.querySelector("#randomModelToggle"),
  modelCheckboxList: document.querySelector("#modelCheckboxList"),
  buildPlanBtn: document.querySelector("#buildPlanBtn"),
  commitPlanBtn: document.querySelector("#commitPlanBtn"),
  modelInputCount: document.querySelector("#modelInputCount"),
  slotCount: document.querySelector("#slotCount"),
  planRowCount: document.querySelector("#planRowCount"),
  planTotal: document.querySelector("#planTotal"),
  planCheck: document.querySelector("#planCheck"),
  copyPlanCsvBtn: document.querySelector("#copyPlanCsvBtn"),
  copyPlanJsonBtn: document.querySelector("#copyPlanJsonBtn"),
  copyPlanPipeBtn: document.querySelector("#copyPlanPipeBtn"),
  planBody: document.querySelector("#planBody"),
  resultBody: document.querySelector("#resultBody"),
  copyPipeBtn: document.querySelector("#copyPipeBtn"),
  copyCsvBtn: document.querySelector("#copyCsvBtn"),
  copyJsonBtn: document.querySelector("#copyJsonBtn"),
  copyPayloadBtn: document.querySelector("#copyPayloadBtn"),
  apiOutput: document.querySelector("#apiOutput"),
  apiLastAction: document.querySelector("#apiLastAction"),
  orderInput: document.querySelector("#orderInput"),
  statusBtn: document.querySelector("#statusBtn"),
  orderOutput: document.querySelector("#orderOutput"),
  orderLastAction: document.querySelector("#orderLastAction"),
  batchDirSelect: document.querySelector("#batchDirSelect"),
  batchIntervalInput: document.querySelector("#batchIntervalInput"),
  updateIntervalBtn: document.querySelector("#updateIntervalBtn"),
  refreshBatchBtn: document.querySelector("#refreshBatchBtn"),
  startAllBatchRunnerBtn: document.querySelector("#startAllBatchRunnerBtn"),
  stopAllBatchRunnerBtn: document.querySelector("#stopAllBatchRunnerBtn"),
  startBatchRunnerBtn: document.querySelector("#startBatchRunnerBtn"),
  stopBatchRunnerBtn: document.querySelector("#stopBatchRunnerBtn"),
  batchProjectGrid: document.querySelector("#batchProjectGrid"),
  batchSelectedName: document.querySelector("#batchSelectedName"),
  batchRunnerStatus: document.querySelector("#batchRunnerStatus"),
  batchTaskStats: document.querySelector("#batchTaskStats"),
  batchLogContainer: document.querySelector("#batchLogContainer"),
  batchTaskBody: document.querySelector("#batchTaskBody"),
  batchModeToggle: document.querySelector("#batchModeToggle"),
  batchModeLabel: document.querySelector("#batchModeLabel"),
  batchRunnerHint: document.querySelector("#batchRunnerHint"),
};

let rows = [];
let models = [];
let modelPlan = null;
let serviceList = [];
let batchRunnerPollInterval = null;
let lastSelectedProjectId = "";

function setStatus(text) {
  els.globalStatus.textContent = text;
}

function switchView(view) {
  els.navLinks.forEach((link) => link.classList.toggle("active", link.dataset.view === view));
  els.viewPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === view));
  window.location.hash = view;
  if (view === "model") {
    parseAndRender({ resetModel: false });
    updateModelInputCount();
  }
  if (view === "batch-runner") {
    refreshBatchDirs();
    fetchBatchRunnerStatus();
    startBatchRunnerPolling();
  } else {
    stopBatchRunnerPolling();
  }
}

function selectedServiceId() {
  return String(els.serviceSelect.value || "").trim();
}

function parseBulk(text) {
  const chosenService = selectedServiceId();
  return text
    .split(/\r?\n/)
    .map((line, index) => {
      const raw = line.trim();
      if (!raw) return null;

      const parts = raw.includes("|")
        ? raw.split("|").map((part) => part.trim())
        : raw.split(/\s+/).map((part) => part.trim());

      let inputService = "";
      let service = chosenService;
      let link = parts[0];
      let quantityRaw = parts[1];
      let usedSelectedService = Boolean(chosenService);

      if (/^\d+$/.test(parts[0] || "") && /^https:\/\/(x|twitter)\.com\/[^/\s]+\/status\/\d+/i.test(parts[1] || "")) {
        inputService = parts[0];
        link = parts[1];
        quantityRaw = parts[2];
        if (!chosenService) {
          service = inputService;
          usedSelectedService = false;
        }
      }

      const quantity = Number(String(quantityRaw || "").replace(/,/g, ""));
      const errors = [];

      if (!/^\d+$/.test(service || "")) errors.push("服务ID不是数字");
      if (!/^https:\/\/(x|twitter)\.com\/[^/\s]+\/status\/\d+/i.test(link || "")) {
        errors.push("链接不是推文 status URL");
      }
      if (!Number.isInteger(quantity) || quantity <= 0) errors.push("数量不是正整数");

      return {
        index: index + 1,
        service: service || "",
        link: link || "",
        quantity: Number.isFinite(quantity) ? quantity : 0,
        ok: errors.length === 0,
        errors,
        inputService,
        usedSelectedService,
        raw,
      };
    })
    .filter(Boolean);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(3)}%`;
}

function formatTimeLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatHour(value) {
  const totalMinutes = Math.round(Number(value || 0) * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function validRows() {
  return rows.filter((row) => row.ok);
}

function updateModelInputCount() {
  els.modelInputCount.textContent = formatNumber(validRows().length);
}

function renderRows() {
  const valid = validRows();
  const invalid = rows.filter((row) => !row.ok);
  const total = valid.reduce((sum, row) => sum + row.quantity, 0);
  const services = new Set(valid.map((row) => row.service));

  els.validCount.textContent = formatNumber(valid.length);
  els.errorCount.textContent = formatNumber(invalid.length);
  els.quantityTotal.textContent = formatNumber(total);
  els.serviceCount.textContent = formatNumber(services.size);
  updateModelInputCount();

  if (!rows.length) {
    els.resultBody.innerHTML = '<tr><td colspan="5" class="empty">还没解析内容</td></tr>';
    return;
  }

  els.resultBody.innerHTML = rows
    .map((row) => {
      const serviceNote =
        row.ok && row.inputService && row.usedSelectedService
          ? `已替换外部码 ${row.inputService}`
          : row.ok && row.usedSelectedService
            ? "使用选中服务"
            : "有效";
      const badge = row.ok
        ? `<span class="badge ok">${escapeHtml(serviceNote)}</span>`
        : `<span class="badge bad">${escapeHtml(row.errors.join("；"))}</span>`;
      return `<tr>
        <td>${row.index}</td>
        <td>${escapeHtml(row.service)}</td>
        <td class="link-cell">${escapeHtml(row.link)}</td>
        <td>${formatNumber(row.quantity)}</td>
        <td>${badge}</td>
      </tr>`;
    })
    .join("");
}

function serviceLabel(service) {
  const id = service.service ?? service.id ?? "";
  const name = service.name ?? "";
  const category = service.category ?? "";
  const rate = service.rate ?? "";
  const min = service.min ?? "";
  const max = service.max ?? "";
  return `${id} | ${name}${category ? ` | ${category}` : ""}${rate ? ` | $${rate}/1k` : ""}${min || max ? ` | ${min}-${max}` : ""}`;
}

function normalizeService(service) {
  return {
    service: String(service.service ?? service.id ?? "").trim(),
    name: String(service.name ?? "").trim(),
    category: String(service.category ?? "").trim(),
    type: String(service.type ?? "").trim(),
    rate: String(service.rate ?? "").trim(),
    min: String(service.min ?? "").trim(),
    max: String(service.max ?? "").trim(),
  };
}

function renderServiceOptions() {
  const query = els.serviceSearchInput.value.trim().toLowerCase();
  const filtered = serviceList
    .filter((service) => {
      if (!query) return true;
      return [service.service, service.name, service.category, service.type, service.rate]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .slice(0, 300);

  if (!filtered.length) {
    els.serviceSelect.innerHTML = '<option value="">没有匹配服务</option>';
    updateSelectedServiceInfo();
    return;
  }

  els.serviceSelect.innerHTML = filtered
    .map((service) => `<option value="${escapeHtml(service.service)}">${escapeHtml(serviceLabel(service))}</option>`)
    .join("");
  updateSelectedServiceInfo();
}

function updateSelectedServiceInfo() {
  const service = serviceList.find((item) => item.service === selectedServiceId());
  if (!service) {
    els.selectedServiceInfo.textContent = "选择服务后，可以直接粘贴：推文链接 | 数量";
    return;
  }
  els.selectedServiceInfo.textContent = `当前服务 ${service.service}：${service.name || "未命名"}${service.min || service.max ? `，范围 ${service.min}-${service.max}` : ""}`;
}

async function loadCrazyServices({ showOutput = true } = {}) {
  try {
    const data = await postApi("/api/services");
    const services = Array.isArray(data) ? data : [];
    serviceList = services.map(normalizeService).filter((service) => /^\d+$/.test(service.service));
    renderServiceOptions();
    setStatus(`已拉取 ${formatNumber(serviceList.length)} 个服务`);
    if (showOutput) {
      showApiOutput("服务列表", {
        count: serviceList.length,
        firstTwenty: serviceList.slice(0, 20),
      });
    }
    return serviceList;
  } catch (error) {
    if (showOutput) showApiOutput("服务查询失败", error);
    else setStatus("服务查询失败，请先在 API 状态里保存 Key");
    return [];
  }
}

function resetPlan() {
  modelPlan = null;
  els.commitPlanBtn.disabled = true;
  els.slotCount.textContent = "0";
  els.planRowCount.textContent = "0";
  els.planTotal.textContent = "0";
  els.planCheck.textContent = "-";
  els.planCheck.style.color = "";
  els.planBody.innerHTML = '<tr><td colspan="8" class="empty">还没有生成模型拆分</td></tr>';
  const thead = document.querySelector(".model-table thead tr");
  if (thead) {
    thead.innerHTML = `<th>源行</th><th>服务ID</th><th>链接</th><th>Day</th><th>时间</th><th>阶段</th><th>比例</th><th>数量</th>`;
  }
}

function renderModels() {
  if (!models.length) {
    els.modelSelect.innerHTML = '<option value="">没有模型</option>';
    els.horizonSelect.innerHTML = "";
    els.modelCheckboxList.innerHTML = "";
    return;
  }

  els.modelSelect.innerHTML = models
    .map((model) => {
      const label = `${model.modelId} ${model.modelName} / ${model.modelKey}`;
      return `<option value="${escapeHtml(model.modelKey)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  els.modelCheckboxList.innerHTML = models
    .map(
      (model) => `<label class="checked">
      <input type="checkbox" value="${escapeHtml(model.modelKey)}" checked />
      ${escapeHtml(model.modelKey)}
    </label>`,
    )
    .join("");

  els.modelCheckboxList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      cb.closest("label").classList.toggle("checked", cb.checked);
    });
  });

  const defaultModel = models.find((model) => model.modelKey === "natural_standard") || models[0];
  els.modelSelect.value = defaultModel.modelKey;
  renderHorizonOptions();
}

function renderHorizonOptions() {
  const model = models.find((item) => item.modelKey === els.modelSelect.value);
  const horizons = model?.horizons?.length ? model.horizons : [1];
  els.horizonSelect.innerHTML = horizons
    .map((days) => `<option value="${days}">${days} 天</option>`)
    .join("");
  els.horizonSelect.value = horizons.includes(3) ? "3" : String(horizons[horizons.length - 1]);
  resetPlan();
}

function renderPlan() {
  if (!modelPlan) {
    resetPlan();
    return;
  }

  const allMatched = modelPlan.sourceSummaries.every((item) => item.matched);
  els.slotCount.textContent = formatNumber(modelPlan.slotCount);
  els.planRowCount.textContent = formatNumber(modelPlan.rows.length);
  els.planTotal.textContent = formatNumber(modelPlan.plannedTotal);
  if (modelPlan.skippedSlots > 0) {
    els.planCheck.textContent = `跳过 ${modelPlan.skippedSlots} 槽，重分 ${formatNumber(modelPlan.redistributedTotal)}`;
    els.planCheck.style.color = "#f0c06e";
    els.modelHint.textContent = `最低阈值 ${modelPlan.minQuantity}：低于此值的槽位量已重分配给其余槽位`;
  } else {
    els.planCheck.textContent = allMatched ? "合计一致" : "有误差";
    els.planCheck.style.color = allMatched ? "#65daa5" : "#ff9098";
  }

  if (!modelPlan.rows.length) {
    els.planBody.innerHTML = '<tr><td colspan="8" class="empty">没有可拆分的有效行</td></tr>';
    return;
  }

  const groups = new Map();
  for (const row of modelPlan.rows) {
    if (!groups.has(row.sourceIndex)) {
      groups.set(row.sourceIndex, { rows: [], totalAddQty: 0 });
    }
    const g = groups.get(row.sourceIndex);
    g.rows.push(row);
    g.totalAddQty += row.addQuantity;
  }

  const onlyOneSource = groups.size === 1;
  if (onlyOneSource) {
    const theadReset = document.querySelector(".model-table thead tr");
    if (theadReset) {
      theadReset.innerHTML = `<th>源行</th><th>服务ID</th><th>链接</th><th>Day</th><th>时间</th><th>阶段</th><th>比例</th><th>数量</th>`;
    }
    els.planBody.innerHTML = modelPlan.rows
      .slice(0, 1200)
      .map(
        (row) => `<tr>
          <td>${row.sourceIndex}</td>
          <td>${escapeHtml(row.service)}</td>
          <td class="link-cell">${escapeHtml(row.link)}</td>
          <td>${row.day}</td>
          <td>${formatHour(row.hourStart)}-${formatHour(row.hourEnd)}</td>
          <td>${escapeHtml(row.phase)}</td>
          <td>${formatPercent(row.share)}</td>
          <td>${formatNumber(row.addQuantity)}</td>
        </tr>`,
      )
      .join("");
    if (modelPlan.rows.length > 1200) {
      els.planBody.insertAdjacentHTML("beforeend",
        `<tr><td colspan="8" class="empty">已预览前 1,200 行，共 ${formatNumber(modelPlan.rows.length)} 行</td></tr>`);
    }
  } else {
    const thead = document.querySelector(".model-table thead tr");
    if (thead) {
      thead.innerHTML = `<th>#</th><th>服务</th><th>链接</th><th>模型</th><th>总量</th><th>槽位</th><th>操作</th>`;
    }
    let html = "";
    let groupIdx = 0;
    for (const [srcIdx, g] of groups) {
      const first = g.rows[0];
      const rowId = `plan-src-${groupIdx}`;
      html += `<tr class="plan-source-row" data-plan-group="${rowId}">
        <td>${srcIdx}</td>
        <td>${escapeHtml(first.service)}</td>
        <td class="link-cell">${escapeHtml(first.link)}</td>
        <td>${escapeHtml(first.modelName || first.modelKey)}</td>
        <td>${formatNumber(g.totalAddQty)}</td>
        <td>${g.rows.length}</td>
        <td><button class="plan-expand-btn secondary" data-plan-group="${rowId}">展开</button></td>
      </tr>`;
      html += `<tr class="plan-detail-rows" data-plan-group="${rowId}" style="display:none;">
        <td colspan="7">
          <table class="plan-sub-table">
            <thead><tr><th>Day</th><th>时间</th><th>阶段</th><th>比例</th><th>数量</th></tr></thead>
            <tbody>${g.rows.map((r) => `<tr>
              <td>${r.day}</td>
              <td>${formatHour(r.hourStart)}-${formatHour(r.hourEnd)}</td>
              <td>${escapeHtml(r.phase)}</td>
              <td>${formatPercent(r.share)}</td>
              <td>${formatNumber(r.addQuantity)}</td>
            </tr>`).join("")}</tbody>
          </table>
        </td>
      </tr>`;
      groupIdx += 1;
    }
    els.planBody.innerHTML = html;
  }
}

document.addEventListener("click", (event) => {
  const btn = event.target.closest(".plan-expand-btn");
  if (!btn) return;
  const groupId = btn.dataset.planGroup;
  const detailRows = document.querySelectorAll(`.plan-detail-rows[data-plan-group="${groupId}"]`);
  const expanded = btn.textContent === "收起";
  detailRows.forEach((r) => { r.style.display = expanded ? "none" : ""; });
  btn.textContent = expanded ? "展开" : "收起";
});

function toCsv(values) {
  return values
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? "");
          return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join(","),
    )
    .join("\n");
}

function rowsToCsv() {
  const header = ["service", "link", "quantity"];
  const lines = validRows().map((row) => [row.service, row.link, row.quantity]);
  return toCsv([header, ...lines]);
}

function rowsToPipe() {
  return validRows().map((row) => `${row.service} | ${row.link} | ${row.quantity}`).join("\n");
}

function translateInputToPipe() {
  parseAndRender();
  return rowsToPipe();
}

function planToCsv() {
  if (!modelPlan) return "";
  const header = [
    "source_index",
    "service",
    "link",
    "total_quantity",
    "model_key",
    "model_name",
    "horizon_days",
    "slot",
    "day",
    "hour_start",
    "hour_end",
    "phase",
    "share",
    "add_quantity",
    "cumulative_quantity",
  ];
  const lines = modelPlan.rows.map((row) => [
    row.sourceIndex,
    row.service,
    row.link,
    row.totalQuantity,
    row.modelKey,
    row.modelName,
    row.horizonDays,
    row.slot,
    row.day,
    row.hourStart,
    row.hourEnd,
    row.phase,
    row.share,
    row.addQuantity,
    row.cumulativeQuantity,
  ]);
  return toCsv([header, ...lines]);
}

function planToPipeRows() {
  if (!modelPlan) return "";
  return modelPlan.rows
    .filter((row) => row.addQuantity > 0)
    .map((row) => `${row.service} | ${row.link} | ${row.addQuantity}`)
    .join("\n");
}

function toPayloadText() {
  return validRows()
    .map((row) => `action=add&service=${row.service}&link=${encodeURIComponent(row.link)}&quantity=${row.quantity}`)
    .join("\n");
}

async function copy(text, label, count) {
  await navigator.clipboard.writeText(text);
  setStatus(`${label}：${formatNumber(count)} 行`);
}

async function postApi(path, body = {}, method = "POST") {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw data;
  return data;
}

function showApiOutput(label, data) {
  els.apiLastAction.textContent = label;
  els.apiOutput.textContent = JSON.stringify(data, null, 2);
  setStatus(label);
}

function showOrderOutput(label, data) {
  els.orderLastAction.textContent = label;
  els.orderOutput.textContent = JSON.stringify(data, null, 2);
  setStatus(label);
}

async function getApi(path) {
  const response = await fetch(path, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw data;
  return data;
}

async function refreshBatchDirs() {
  try {
    const data = await getApi("/api/batch-runner/batches");
    const currentValue = els.batchDirSelect.value;
    const batches = data.batches || [];
    els.batchDirSelect.innerHTML = '<option value="">选择批次目录</option>';
    for (const batch of batches) {
      const option = document.createElement("option");
      option.value = batch.path;
      option.textContent = `${batch.name}${batch.hasManifest ? " | manifest" : ""}${batch.hasSchedule ? " | schedule" : ""}`;
      els.batchDirSelect.appendChild(option);
    }
    if (currentValue && batches.some((batch) => batch.path === currentValue)) {
      els.batchDirSelect.value = currentValue;
    }

    if (!batches.length) {
      els.batchProjectGrid.innerHTML = '<div class="empty">还没有批次项目</div>';
    } else {
      els.batchProjectGrid.innerHTML = batches
        .map(
          (batch) => {
            const progress = batch.progress || 0;
            const eta = batch.estimatedCompletion
              ? `预计 ${formatTimeLabel(batch.estimatedCompletion)} 完成`
              : batch.active ? "计算中..." : "";
            return `<div class="project-card${batch.active ? " active" : ""}" data-project="${escapeHtml(batch.name)}">
          <div class="project-card-head">
            <strong>${escapeHtml(batch.name)}</strong>
            <span class="badge ${batch.active ? "ok" : batch.finished ? "" : "warn"}">${batch.active ? "运行中" : batch.finished ? "已完成" : "空闲"}</span>
          </div>
          <div class="project-card-stats">
            <span>${batch.hasManifest ? "manifest" : batch.hasSchedule ? "schedule" : "txt"}</span>
            ${batch.stats ? `<span>${batch.stats.total} 批 | ${progress}%</span>` : ""}
            <span>间隔 ${batch.intervalSeconds || 1800}s</span>
          </div>
          ${eta ? `<div class="project-card-eta">${eta}</div>` : ""}
          <div class="project-card-actions">
            <button class="delete-project-btn secondary" data-path="${escapeHtml(batch.path)}" data-name="${escapeHtml(batch.name)}">删除项目</button>
          </div>
        </div>`;
        },
        )
        .join("");
    }
    setStatus(`已发现 ${formatNumber(batches.length)} 个批次目录`);
  } catch (error) {
    addBatchLocalLog("error", `刷新批次目录失败：${error.error || error.message || "未知错误"}`);
  }
}

async function deleteBatchProject(dirPath, projectName) {
  if (!window.confirm(`确认删除项目「${projectName}」？\n\n这将永久删除该项目的所有文件（批次文件、日志等），不可恢复。`)) return;
  try {
    await postApi("/api/batch-runner/batches", { dirPath }, "DELETE");
    addBatchLocalLog("info", `已删除项目：${projectName}`);
    await refreshBatchDirs();
  } catch (error) {
    addBatchLocalLog("error", `删除失败：${error.error || error.message}`);
  }
}

function renderBatchRunnerStatus(status) {
  const active = Boolean(status.active);
  const selectedActive = Boolean(status.selected?.active);
  const mode = status.selected?.mode || status.mode || "dry-run";
  const modeLabel = mode === "live" ? "正式下单" : "dry-run";
  els.batchRunnerStatus.textContent = selectedActive ? `${modeLabel} 运行中` : `${modeLabel} 未启动`;
  els.batchRunnerStatus.className = selectedActive ? "status-indicator running" : "status-indicator stopped";
  els.startBatchRunnerBtn.disabled = selectedActive;
  els.stopBatchRunnerBtn.disabled = !selectedActive;

  if (status.selected) {
    updateBatchModeUI(mode);
    if (status.selected.intervalSeconds && status.selectedProjectId !== lastSelectedProjectId) {
      els.batchIntervalInput.value = status.selected.intervalSeconds;
    }
    lastSelectedProjectId = status.selectedProjectId;
    const finished = status.selected.finished;
    const isLive = mode === "live";
    if (finished) {
      els.startBatchRunnerBtn.textContent = isLive ? "重新正式下单" : "重新 dry-run";
    } else {
      els.startBatchRunnerBtn.textContent = isLive ? "启动正式下单" : "启动 dry-run";
    }
  }

  const stats = status.selected?.stats || status.stats || {};
  const progress = status.selected?.progress || 0;
  const eta = status.selected?.estimatedCompletion
    ? ` | 预计 ${formatTimeLabel(status.selected.estimatedCompletion)} 完成`
    : "";
  els.batchTaskStats.textContent = `总计 ${stats.total || 0} | 完成 ${stats.completed || 0} | 失败 ${stats.failed || 0} | ${progress}%${eta}`;

  const tasks = status.selected?.tasks || status.tasks || [];
  if (!tasks.length) {
    els.batchTaskBody.innerHTML = '<tr><td colspan="7" class="empty">还没有批次任务</td></tr>';
  } else {
    els.batchTaskBody.innerHTML = tasks
      .slice(0, 500)
      .map(
        (task) => {
          const orderIds = (task.orderResults || [])
            .filter((r) => r.status === "submitted")
            .map((r) => r.orderId)
            .join(", ");
          const dryOrderIds = (task.orderResults || [])
            .filter((r) => r.status === "skipped")
            .map((r) => r.orderId)
            .join(", ");
          const orderDisplay = orderIds || dryOrderIds || "-";
          return `<tr>
          <td>${task.id}</td>
          <td>${escapeHtml(task.file)}</td>
          <td>${escapeHtml(task.timeLabel || task.label || "")}</td>
          <td>${formatNumber(task.lineCount)}</td>
          <td>${formatNumber(task.quantity)}</td>
          <td>${escapeHtml(orderDisplay)}</td>
          <td><span class="badge ${task.status === "failed" ? "bad" : task.status === "completed" ? "ok" : "warn"}">${escapeHtml(task.status)}</span></td>
        </tr>`;
        },
      )
      .join("");
  }

  const logs = status.selected?.logs || status.logs || [];
  els.batchLogContainer.innerHTML = logs
    .map((log) => `<div class="log-${escapeHtml(log.type)}"><span class="time">${escapeHtml(log.time)}</span> ${escapeHtml(log.msg)}</div>`)
    .join("");
  els.batchLogContainer.scrollTop = els.batchLogContainer.scrollHeight;

  // 更新项目卡片（进度、间隔、状态）
  const projects = status.projects || [];
  if (projects.length) {
    updateProjectCards(projects);
  }
}

function updateProjectCards(projects) {
  for (const p of projects) {
    const card = document.querySelector(`.project-card[data-project="${CSS.escape(p.id)}"]`);
    if (!card) continue;
    const badge = card.querySelector(".badge");
    if (badge) {
      badge.textContent = p.active ? "运行中" : p.finished ? "已完成" : "空闲";
      badge.className = `badge ${p.active ? "ok" : p.finished ? "" : "warn"}`;
    }
    const statsEl = card.querySelector(".project-card-stats");
    if (statsEl) {
      const progress = p.progress || 0;
      statsEl.innerHTML = `<span>manifest</span><span>${p.stats?.total || 0} 批 | ${progress}%</span><span>间隔 ${p.intervalSeconds || 1800}s</span>`;
    }
    const etaEl = card.querySelector(".project-card-eta");
    if (etaEl && p.estimatedCompletion) {
      etaEl.textContent = `预计 ${formatTimeLabel(p.estimatedCompletion)} 完成`;
      etaEl.style.display = "";
    } else if (etaEl && !p.active) {
      etaEl.style.display = "none";
    }
  }
}

async function fetchBatchRunnerStatus() {
  try {
    const projectId = els.batchDirSelect.value;
    const path = projectId ? `/api/batch-runner/status?projectId=${encodeURIComponent(projectId)}` : "/api/batch-runner/status";
    renderBatchRunnerStatus(await getApi(path));
  } catch (error) {
    addBatchLocalLog("error", `读取状态失败：${error.error || error.message || "未知错误"}`);
  }
}

function addBatchLocalLog(type, msg) {
  const div = document.createElement("div");
  div.className = `log-${type}`;
  div.innerHTML = `<span class="time">${new Date().toLocaleTimeString()}</span> ${escapeHtml(msg)}`;
  els.batchLogContainer.appendChild(div);
  els.batchLogContainer.scrollTop = els.batchLogContainer.scrollHeight;
}

function updateBatchModeUI(mode) {
  const isLive = mode === "live";
  els.batchModeToggle.checked = isLive;
  els.batchModeLabel.textContent = isLive ? "正式下单" : "dry-run";
  els.batchModeLabel.className = isLive ? "mode-text live" : "mode-text dry";
  if (els.batchRunnerHint) {
    els.batchRunnerHint.textContent = isLive
      ? "正式下单模式 · 逐批调用 API"
      : "dry-run 预览 · 仅写文件";
  }
}

async function toggleBatchMode() {
  const dirPath = els.batchDirSelect.value;
  if (!dirPath) {
    addBatchLocalLog("error", "请先选择批次项目");
    els.batchModeToggle.checked = false;
    return;
  }
  const newMode = els.batchModeToggle.checked ? "live" : "dry-run";
  if (newMode === "live" && !window.confirm("确认切换到「正式下单」模式？\n\n此模式下每个批次将实际调用 CrazySMM API 下单，产生真实费用。")) {
    els.batchModeToggle.checked = false;
    updateBatchModeUI("dry-run");
    return;
  }
  try {
    const data = await postApi("/api/batch-runner/mode", { dirPath, mode: newMode });
    updateBatchModeUI(data.mode);
    addBatchLocalLog("info", `模式已切换为：${data.mode}`);
  } catch (error) {
    addBatchLocalLog("error", `模式切换失败：${error.error || error.message}`);
    els.batchModeToggle.checked = !els.batchModeToggle.checked;
  }
}

function startBatchRunnerPolling() {
  if (batchRunnerPollInterval) return;
  batchRunnerPollInterval = setInterval(fetchBatchRunnerStatus, 3000);
}

function stopBatchRunnerPolling() {
  if (batchRunnerPollInterval) clearInterval(batchRunnerPollInterval);
  batchRunnerPollInterval = null;
}

async function loadConfig() {
  const response = await fetch("/api/config", { cache: "no-store" });
  const data = await response.json();
  els.keyState.textContent = data.hasKey ? "API key 已配置" : "API key 未配置";
  els.keyState.style.color = data.hasKey ? "#65daa5" : "#f0c06e";
  els.apiUrl.textContent = data.apiUrl;
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw data;
    els.backendState.textContent = data.ok ? "正常" : "异常";
    els.backendState.style.color = data.ok ? "#65daa5" : "#ff9098";
    els.healthModelCount.textContent = formatNumber(data.modelCount);
    setStatus(`后台正常，模型 ${formatNumber(data.modelCount)} 个`);
    return data;
  } catch (error) {
    els.backendState.textContent = "异常";
    els.backendState.style.color = "#ff9098";
    els.healthModelCount.textContent = "0";
    showApiOutput("后台状态失败", error);
    return null;
  }
}

async function loadModels() {
  try {
    const response = await fetch("/api/models", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw data;
    models = data.models || [];
    els.modelHint.textContent = `已读取 ${models.length} 个模型`;
    renderModels();
  } catch (error) {
    els.modelHint.textContent = "模型读取失败";
    showApiOutput("模型读取失败", error);
  }
}

function parseAndRender(options = {}) {
  rows = parseBulk(els.bulkInput.value);
  renderRows();
  if (options.resetModel !== false) resetPlan();
}

function initViewFromHash() {
  const hash = window.location.hash.replace("#", "");
  const view = ["batch", "model", "batch-runner", "api", "orders"].includes(hash) ? hash : "batch";
  switchView(view);
}

els.navLinks.forEach((link) => {
  link.addEventListener("click", () => switchView(link.dataset.view));
});

els.parseBtn.addEventListener("click", () => {
  parseAndRender();
  setStatus(`已解析 ${formatNumber(validRows().length)} 行`);
});

els.translateBtn.addEventListener("click", () => {
  const translated = translateInputToPipe();
  if (translated) {
    els.bulkInput.value = translated;
    parseAndRender();
    setStatus(`已翻译成三列：${formatNumber(validRows().length)} 行`);
  } else {
    setStatus("没有可翻译的有效行");
  }
});

els.clearBtn.addEventListener("click", () => {
  els.bulkInput.value = "";
  rows = [];
  renderRows();
  resetPlan();
  setStatus("已清空");
});

els.sampleBtn.addEventListener("click", () => {
  els.bulkInput.value = [
    "https://x.com/iam_elias1/status/2074797317753118953 | 20660",
    "https://x.com/iam_elias1/status/2074797328335319216 | 23379",
    "https://x.com/Meer_AIIT/status/2074799634267230544 | 60473",
  ].join("\n");
  parseAndRender();
  setStatus("已填入示例");
});

els.serviceSearchInput.addEventListener("input", renderServiceOptions);
els.serviceSelect.addEventListener("change", () => {
  updateSelectedServiceInfo();
  parseAndRender();
});
els.loadServicesBtn.addEventListener("click", async () => {
  await loadCrazyServices({ showOutput: false });
});

els.modelSelect.addEventListener("change", renderHorizonOptions);
els.horizonSelect.addEventListener("change", resetPlan);

els.randomModelToggle.addEventListener("change", () => {
  els.modelCheckboxList.style.display = els.randomModelToggle.checked ? "flex" : "none";
  els.modelSelect.disabled = els.randomModelToggle.checked;
  resetPlan();
});

els.buildPlanBtn.addEventListener("click", async () => {
  try {
    parseAndRender({ resetModel: false });
    if (!models.length) await loadModels();
    const valid = validRows();
    if (!valid.length) {
      resetPlan();
      setStatus("没有可拆分的有效行");
      return;
    }

    const randomMode = els.randomModelToggle.checked;
    const modelKeys = randomMode
      ? [...els.modelCheckboxList.querySelectorAll("input:checked")].map((cb) => cb.value)
      : [];
    const data = await postApi("/api/model-plan", {
      modelKey: randomMode ? (modelKeys[0] || "") : els.modelSelect.value,
      modelKeys,
      randomMode,
      horizonDays: Number(els.horizonSelect.value),
      minQuantity: Number(els.minQuantityInput.value || 0),
      rows: valid,
    });
    modelPlan = data;
    renderPlan();
    els.commitPlanBtn.disabled = false;
    setStatus(`模型拆分完成：${formatNumber(data.plannedTotal)} 总量`);
  } catch (error) {
    showApiOutput("模型拆分失败", error);
  }
});

els.commitPlanBtn.addEventListener("click", async () => {
  if (!modelPlan || !modelPlan.rows.length) return;
  const defaultName = `plan_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  const projectName = window.prompt("输入批次项目名称：", defaultName);
  if (!projectName) return;
  try {
    const result = await postApi("/api/model-plan/commit", {
      name: String(projectName).trim(),
      rows: modelPlan.rows,
    });
    setStatus(`已生成批次项目「${result.project}」，${result.slotCount} 槽位，${result.totalQuantity} 总量`);
    els.commitPlanBtn.disabled = true;
    switchView("batch-runner");
    await refreshBatchDirs();
    els.batchDirSelect.value = result.path;
    fetchBatchRunnerStatus();
  } catch (error) {
    showApiOutput("生成批次失败", error);
  }
});

els.copyCsvBtn.addEventListener("click", async () => {
  await copy(rowsToCsv(), "已复制 CSV", validRows().length);
});

els.copyPipeBtn.addEventListener("click", async () => {
  parseAndRender();
  await copy(rowsToPipe(), "已复制三列格式", validRows().length);
});

els.copyJsonBtn.addEventListener("click", async () => {
  await copy(JSON.stringify(validRows(), null, 2), "已复制 JSON", validRows().length);
});

els.copyPayloadBtn.addEventListener("click", async () => {
  await copy(toPayloadText(), "已复制 API Payload", validRows().length);
});

els.copyPlanCsvBtn.addEventListener("click", async () => {
  await copy(planToCsv(), "已复制拆分 CSV", modelPlan?.rows?.length || 0);
});

els.copyPlanJsonBtn.addEventListener("click", async () => {
  await copy(JSON.stringify(modelPlan || {}, null, 2), "已复制拆分 JSON", modelPlan?.rows?.length || 0);
});

els.copyPlanPipeBtn.addEventListener("click", async () => {
  await copy(planToPipeRows(), "已复制三列格式", modelPlan?.rows?.filter((row) => row.addQuantity > 0).length || 0);
});

els.refreshHealthBtn.addEventListener("click", async () => {
  const data = await loadHealth();
  if (data) showApiOutput("后台状态", data);
});

els.refreshBatchBtn.addEventListener("click", refreshBatchDirs);

els.updateIntervalBtn.addEventListener("click", async () => {
  const dirPath = els.batchDirSelect.value;
  if (!dirPath) {
    addBatchLocalLog("error", "请先选择批次项目");
    return;
  }
  try {
    const intervalSeconds = Number(els.batchIntervalInput.value || 1800);
    await postApi("/api/batch-runner/interval", { dirPath, intervalSeconds });
    await refreshBatchDirs();
    await fetchBatchRunnerStatus();
    addBatchLocalLog("info", `间隔已更新为 ${intervalSeconds} 秒`);
    setStatus(`间隔已更新为 ${intervalSeconds} 秒`);
  } catch (error) {
    addBatchLocalLog("error", `修改间隔失败：${error.error || error.message}`);
  }
});

els.batchProjectGrid.addEventListener("click", (event) => {
  const btn = event.target.closest(".delete-project-btn");
  if (!btn) return;
  deleteBatchProject(btn.dataset.path, btn.dataset.name);
});

els.batchModeToggle.addEventListener("change", toggleBatchMode);

els.startBatchRunnerBtn.addEventListener("click", async () => {
  const dirPath = els.batchDirSelect.value;
  if (!dirPath) {
    addBatchLocalLog("error", "请先选择批次目录");
    return;
  }
  try {
    const intervalSeconds = Number(els.batchIntervalInput.value || 1800);
    const mode = els.batchModeToggle.checked ? "live" : "dry-run";
    if (mode === "live" && !window.confirm("确认启动「正式下单」？\n\n将按 30 分钟间隔逐批调用 CrazySMM API 下单，产生真实费用。")) return;
    const status = await postApi("/api/batch-runner/start", { dirPath, intervalSeconds, mode });
    renderBatchRunnerStatus(status);
    startBatchRunnerPolling();
    setStatus(`批次 ${mode === "live" ? "正式下单" : "dry-run"} 已启动`);
  } catch (error) {
    addBatchLocalLog("error", `启动失败：${error.error || error.message || "未知错误"}`);
  }
});

els.stopBatchRunnerBtn.addEventListener("click", async () => {
  try {
    const dirPath = els.batchDirSelect.value;
    const status = await postApi("/api/batch-runner/stop", { dirPath });
    renderBatchRunnerStatus(status);
    setStatus("批次已停止");
  } catch (error) {
    addBatchLocalLog("error", `停止失败：${error.error || error.message || "未知错误"}`);
  }
});

els.startAllBatchRunnerBtn.addEventListener("click", async () => {
  try {
    const intervalSeconds = Number(els.batchIntervalInput.value || 1800);
    const status = await postApi("/api/batch-runner/start-all", { intervalSeconds });
    renderBatchRunnerStatus(status);
    startBatchRunnerPolling();
    setStatus("全部批次已启动");
  } catch (error) {
    addBatchLocalLog("error", `全部启动失败：${error.error || error.message}`);
  }
});

els.stopAllBatchRunnerBtn.addEventListener("click", async () => {
  try {
    const status = await postApi("/api/batch-runner/stop-all", {});
    renderBatchRunnerStatus(status);
    setStatus("全部批次已停止");
  } catch (error) {
    addBatchLocalLog("error", `全部停止失败：${error.error || error.message}`);
  }
});

els.saveKeyBtn.addEventListener("click", async () => {
  try {
    const data = await postApi("/api/config", { apiKey: els.apiKeyInput.value });
    els.apiKeyInput.value = "";
    showApiOutput("保存 Key", { hasKey: data.hasKey, apiUrl: data.apiUrl });
    await loadConfig();
  } catch (error) {
    showApiOutput("保存 Key 失败", error);
  }
});

els.balanceBtn.addEventListener("click", async () => {
  try {
    showApiOutput("余额", await postApi("/api/balance"));
  } catch (error) {
    showApiOutput("余额查询失败", error);
  }
});

els.servicesBtn.addEventListener("click", async () => {
  await loadCrazyServices({ showOutput: true });
});

els.statusBtn.addEventListener("click", async () => {
  const orders = els.orderInput.value
    .split(/[\s,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  try {
    showOrderOutput("订单状态", await postApi("/api/status", { orders }));
  } catch (error) {
    showOrderOutput("订单状态查询失败", error);
  }
});

parseAndRender();
loadConfig();
loadHealth();
loadModels();
initViewFromHash();
