const DATA_URL = "data/bills.json";
const FALLBACK_URL = "data/bills.sample.json";
const SUMMARY_PREVIEW_LENGTH = 140;
const WATCHLIST_STORAGE_KEY = "law-monitor.watchlist.v1";
const API_KEY_STORAGE_KEY = "law-monitor.openAssemblyApiKey.v1";
const CLIENT_BILLS_STORAGE_KEY = "law-monitor.clientBills.v1";
const OPEN_ASSEMBLY_API_BASE = "https://open.assembly.go.kr/portal/openapi";
const BILL_ERACO = "22";
const PAGE_SIZE = 10;
const IMPORTANCE_ORDER = { high: 0, medium: 1, low: 2 };
const OVERRIDES_STORAGE_KEY = "law-monitor.overrides.v1";
const AUTH_HASH = "b9455a18a15d9b8c23ee939d0a39be0b69bb650a8c97e24f52f3c22e84e27516";
const AUTH_TOKEN_KEY = "law-monitor.auth.v1";
const GITHUB_PAT_STORAGE_KEY = "law-monitor.githubPat.v1";
const GITHUB_REPO = "K-Rim-Choi/law-monitor";
const GITHUB_WATCHLIST_PATH = "data/watchlist.json";
const GITHUB_WORKFLOW_ID = "update-bills.yml";
const GITHUB_BRANCH = "master";
const OC_OPTIONS = ["SKI", "SKE", "SKIPC", "SKGC", "SKO", "SKE&S", "SKTI", "SKEO", "SKEN"];

let overrides = {};

const state = {
  bills: [],
  filtered: [],
  watchlist: [],
  sort: { column: "proposeDate", direction: "desc" },
  page: 1,
};

const els = {
  generatedAt: document.querySelector("#generatedAt"),
  sourceName: document.querySelector("#sourceName"),
  totalCount: document.querySelector("#totalCount"),
  highCount: document.querySelector("#highCount"),
  reviewCount: document.querySelector("#reviewCount"),
  recentCount: document.querySelector("#recentCount"),
  resultCount: document.querySelector("#resultCount"),
  rows: document.querySelector("#billRows"),
  emptyState: document.querySelector("#emptyState"),
  search: document.querySelector("#searchInput"),
  importance: document.querySelector("#importanceFilter"),
  status: document.querySelector("#statusFilter"),
  impact: document.querySelector("#impactFilter"),
  reset: document.querySelector("#resetButton"),
  watchlistForm: document.querySelector("#watchlistForm"),
  billNoInput: document.querySelector("#billNoInput"),
  watchlistHint: document.querySelector("#watchlistHint"),
  pagination: document.querySelector("#pagination"),
  saveBtn: document.querySelector("#importFile"),
  saveMenu: document.querySelector("#saveMenu"),
  summaryModal: document.querySelector("#summaryModal"),
  summaryModalText: document.querySelector("#summaryModalText"),
  summaryModalClose: document.querySelector("#summaryModalClose"),
  githubSyncBadge: document.querySelector("#githubSyncBadge"),
  githubSyncMsg: document.querySelector("#githubSyncMsg"),
  githubPatSetup: document.querySelector("#githubPatSetup"),
  githubPatReady: document.querySelector("#githubPatReady"),
  githubPatInput: document.querySelector("#githubPatInput"),
  githubPatSave: document.querySelector("#githubPatSave"),
  githubSyncNow: document.querySelector("#githubSyncNow"),
  githubPatClear: document.querySelector("#githubPatClear"),
};

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url} ${response.status}`);
  }
  return response.json();
}

async function loadData() {
  try {
    return await loadJson(DATA_URL);
  } catch (error) {
    console.warn("Using sample data:", error);
    return loadJson(FALLBACK_URL);
  }
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getImportanceLabel(value) {
  return {
    high: "높음",
    medium: "중간",
    low: "낮음",
  }[value] ?? "미정";
}

function isUnderReview(status) {
  const text = normalizeText(status);
  return ["심사", "소위", "위원회", "상정", "계류"].some((word) =>
    text.includes(word),
  );
}

function isRecent(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const days = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  return days >= 0 && days <= 30;
}

function updateSummary(bills) {
  els.totalCount.textContent = bills.length.toLocaleString("ko-KR");
  els.highCount.textContent = bills
    .filter((bill) => getBillWithOverrides(bill).importance === "high")
    .length.toLocaleString("ko-KR");
  els.reviewCount.textContent = bills
    .filter((bill) => isUnderReview(bill.status))
    .length.toLocaleString("ko-KR");
  els.recentCount.textContent = bills
    .filter((bill) => isRecent(bill.proposeDate))
    .length.toLocaleString("ko-KR");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko-KR"),
  );
}

function fillSelect(select, values) {
  const current = select.value;
  select.querySelectorAll("option:not([value='all'])").forEach((option) =>
    option.remove(),
  );
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  select.value = values.includes(current) ? current : "all";
}

function setupFilters(bills) {
  fillSelect(els.status, uniqueSorted(bills.map((bill) => bill.status)));
  fillSelect(els.impact, uniqueSorted(bills.map((bill) => bill.impactArea)));
}

function billMatchesSearch(bill, term) {
  if (!term) return true;
  const haystack = [
    bill.billName,
    bill.proposer,
    bill.summary,
    bill.status,
    bill.businessImpact,
    bill.impactArea,
  ]
    .map(normalizeText)
    .join(" ");
  return haystack.includes(term);
}

function applyFilters() {
  const term = normalizeText(els.search.value);
  const importance = els.importance.value;
  const status = els.status.value;
  const impact = els.impact.value;
  const watchlistSet = new Set(state.watchlist);
  const visibleBills = state.bills.filter((bill) =>
    watchlistSet.has(bill.billNo),
  );

  updateSummary(visibleBills);

  state.filtered = visibleBills.filter((bill) => {
    const b = getBillWithOverrides(bill);
    return (
      billMatchesSearch(b, term) &&
      (importance === "all" || b.importance === importance) &&
      (status === "all" || b.status === status) &&
      (impact === "all" || b.impactArea === impact)
    );
  });

  state.page = 1;
  renderTable();
}

function renderRows(bills) {
  els.rows.replaceChildren();

  bills.forEach((bill) => {
    const b = getBillWithOverrides(bill);
    const billNo = escapeHtml(bill.billNo || "");
    const isImportanceEdited = overrides[bill.billNo]?.importance !== undefined;
    const isOcEdited = overrides[bill.billNo]?.oc !== undefined;
    const url = b.url || "#";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="editable-cell${isImportanceEdited ? " cell-edited" : ""}" data-bill-no="${billNo}" data-field="importance">
        <span class="badge ${b.importance}">${getImportanceLabel(b.importance)}</span>
        <button type="button" class="reset-cell-btn" title="원본으로 되돌리기" aria-label="중요도 초기화">↩</button>
      </td>
      <td class="oc-cell editable-cell${isOcEdited ? " cell-edited" : ""}" data-bill-no="${billNo}" data-field="oc">
        <span class="oc-value">${escapeHtml(b.oc || "-")}</span>
        <button type="button" class="reset-cell-btn" title="원본으로 되돌리기" aria-label="O/C 초기화">↩</button>
      </td>
      <td>
        <div class="bill-title">
          <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(b.billName || "법안명 미확인")}</a>
          <span class="bill-id">${escapeHtml(bill.billNo || bill.id || "-")}</span>
        </div>
      </td>
      <td>${escapeHtml(b.proposer || "-")}</td>
      <td>${escapeHtml(b.committee || "-")}</td>
      <td>${escapeHtml(formatDate(b.proposeDate))}</td>
      <td>${renderStatusCell(b.status, b.statusDate)}</td>
      <td>${renderSummaryCell(b.summary)}</td>
      <td class="remove-cell">
        <button type="button" class="remove-btn" data-bill-no="${billNo}" aria-label="${escapeHtml(b.billName || billNo)} 추적 해제">✕</button>
      </td>
    `;
    els.rows.append(row);
  });

  if (state.filtered.length === 0) {
    els.emptyState.hidden = false;
    els.emptyState.textContent = "조건에 맞는 개정안이 없습니다.";
  } else {
    els.emptyState.hidden = true;
  }
}

function initializeWatchlist(data) {
  const saved = loadWatchlist();
  if (saved) {
    state.watchlist = saved;
    return;
  }

  const queryBillNos = Array.isArray(data.query?.billNos)
    ? data.query.billNos
    : [];
  const dataBillNos = state.bills.map((bill) => bill.billNo);
  state.watchlist = uniqueBillNos(
    queryBillNos.length > 0 ? queryBillNos : dataBillNos,
  );
  saveWatchlist();
}

function loadWatchlist() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WATCHLIST_STORAGE_KEY));
    if (!Array.isArray(parsed)) return null;
    return uniqueBillNos(parsed);
  } catch {
    return null;
  }
}

function saveWatchlist() {
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(state.watchlist));
}

function loadClientBills() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CLIENT_BILLS_STORAGE_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveClientBills() {
  const deployedBillNos = new Set(state.watchlist);
  const clientBills = state.bills.filter((bill) =>
    deployedBillNos.has(bill.billNo),
  );
  localStorage.setItem(CLIENT_BILLS_STORAGE_KEY, JSON.stringify(clientBills));
}

async function addBillNos(value) {
  const { valid, invalid } = parseBillNos(value);
  if (valid.length === 0) {
    els.watchlistHint.textContent =
      invalid.length > 0
        ? "의안번호는 7자리 숫자만 추가할 수 있습니다."
        : "추가할 의안번호를 입력하세요.";
    return;
  }

  const beforeCount = state.watchlist.length;
  state.watchlist = uniqueBillNos([...state.watchlist, ...valid]);
  const addedCount = state.watchlist.length - beforeCount;
  saveWatchlist();
  els.billNoInput.value = "";
  renderWatchlist();
  await fetchMissingBills(valid, { promptForKey: true });
  await syncWatchlistToGithub();
  setupFilters(state.bills);
  if (invalid.length > 0) {
    els.watchlistHint.textContent = `${valid.length}건 중 ${addedCount}건 추가, ${invalid.length}건은 7자리 숫자가 아니라 제외했습니다.`;
  } else if (addedCount === 0) {
    els.watchlistHint.textContent = "이미 추가된 의안번호입니다.";
  }
  applyFilters();
}

async function fetchMissingBills(billNos, options = {}) {
  const { promptForKey = true } = options;
  const knownBillNos = new Set(state.bills.map((bill) => bill.billNo));
  const missingBillNos = billNos.filter((billNo) => !knownBillNos.has(billNo));
  if (missingBillNos.length === 0) return;

  const apiKey = getApiKey({ prompt: promptForKey });
  if (!apiKey) {
    els.watchlistHint.textContent =
      "국회 API 키가 없어 누락 의안은 자동 조회되지 않았습니다.";
    return;
  }

  els.watchlistHint.textContent = `${missingBillNos.length}건을 국회 API에서 조회 중입니다.`;
  const fetchedBills = [];

  for (const billNo of missingBillNos) {
    try {
      const bill = await fetchBillFromOpenAssembly(billNo, apiKey);
      if (bill) fetchedBills.push(bill);
    } catch (error) {
      console.warn(`Failed to fetch bill ${billNo}:`, error);
    }
  }

  if (fetchedBills.length > 0) {
    state.bills = mergeBills(state.bills, fetchedBills);
    saveClientBills();
    renderWatchlist();
    const failedCount = missingBillNos.length - fetchedBills.length;
    els.watchlistHint.textContent =
      failedCount > 0
        ? `${fetchedBills.length}건을 불러왔고 ${failedCount}건은 조회하지 못했습니다.`
        : `${fetchedBills.length}건을 국회 API에서 불러왔습니다.`;
  } else {
    els.watchlistHint.textContent =
      "새 의안을 불러오지 못했습니다. API 키, CORS, 의안번호를 확인하세요.";
  }
}

function getApiKey(options = {}) {
  const { prompt = true } = options;
  const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (stored) return stored;
  if (!prompt) return "";

  const entered = window.prompt("국회 API 키를 입력하세요. 이 브라우저에만 저장됩니다.");
  const apiKey = String(entered || "").trim();
  if (!apiKey) return "";
  localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  return apiKey;
}

async function fetchBillFromOpenAssembly(billNo, apiKey) {
  const rows = await fetchBillRows(billNo, apiKey);
  const row = rows.find((entry) => pick(entry, ["BILL_NO"]) === billNo) || rows[0];
  if (!row) return null;

  const summary = await fetchBillSummary(billNo, apiKey);
  return enrichClientBill({
    ...normalizeBillRow(row),
    summary,
  });
}

async function fetchBillRows(billNo, apiKey) {
  const endpoint = `${OPEN_ASSEMBLY_API_BASE}/ALLBILLV2`;
  const candidates = [
    { BILL_NO: billNo, ERACO: BILL_ERACO },
    { BILL_NO: billNo, ERACO: `제${BILL_ERACO}대` },
    { BILL_NO: billNo, AGE: BILL_ERACO },
    { BILL_NO: billNo },
  ];

  for (const params of candidates) {
    const rows = await fetchOpenAssemblyRows(endpoint, apiKey, params);
    if (rows.length > 0) return rows;
  }
  return [];
}

async function fetchBillSummary(billNo, apiKey) {
  const rows = await fetchOpenAssemblyRows(
    `${OPEN_ASSEMBLY_API_BASE}/BPMBILLSUMMARY`,
    apiKey,
    { BILL_NO: billNo },
  );
  const row = rows[0] || {};
  return pick(row, ["SUMMARY", "summary", "제안이유및주요내용", "주요내용"]);
}

async function fetchOpenAssemblyRows(endpoint, apiKey, params) {
  const url = new URL(endpoint);
  url.searchParams.set("KEY", apiKey);
  url.searchParams.set("Type", "json");
  url.searchParams.set("pIndex", "1");
  url.searchParams.set("pSize", "100");
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open Assembly API ${response.status}`);
  return extractRows(await response.json());
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.row)) return payload.row;

  for (const value of Object.values(payload ?? {})) {
    if (!Array.isArray(value)) continue;
    const rowGroup = value.find((entry) => Array.isArray(entry?.row));
    if (rowGroup) return rowGroup.row;
  }

  const result = payload?.RESULT || payload?.result;
  if (result?.CODE === "INFO-200") return [];
  if (result?.CODE && result.CODE !== "INFO-000") {
    throw new Error(`${result.CODE}: ${result.MESSAGE}`);
  }
  return [];
}

function normalizeBillRow(row) {
  const id = pick(row, ["BILL_ID", "billId", "BILL_NO", "billNo", "의안ID"]);
  const billNo = pick(row, ["BILL_NO", "billNo", "의안번호", "BILL_NUM"]);
  return {
    id: id || billNo,
    billNo,
    billName: pick(row, ["BILL_NAME", "BILL_NM", "billName", "의안명"]),
    proposer: pick(row, ["PROPOSER", "PPSR", "PPSR_NM", "제안자", "대표발의자"]),
    proposeDate: toIsoDate(
      pick(row, ["PROPOSE_DT", "PROPOSE_DATE", "PPSL_DT", "제안일", "발의일"]),
    ),
    committee: pick(row, ["CURR_COMMITTEE", "COMMITTEE", "JRCMIT_NM", "소관위원회"]),
    status: buildStatus(row),
    summary: "",
    businessImpact: "",
    impactArea: "",
    importance: "low",
    oc: "",
    url: pick(row, ["DETAIL_LINK", "BILL_URL", "LINK_URL", "상세링크"]) ||
      buildBillUrl(id),
    raw: row,
  };
}

function enrichClientBill(bill) {
  return {
    ...bill,
    summary: bill.summary || `${bill.billName}에 대한 주요 내용 확인 필요`,
    status: bill.status || "상태 확인 필요",
    committee: bill.committee || "소관위원회 확인 필요",
    businessImpact: "담당 부서 검토 후 사업영향 보정 필요",
    impactArea: "공통/기타",
    importance: bill.importance || "low",
    oc: bill.oc || "",
  };
}

function buildStatus(row) {
  return (
    pick(row, ["PROC_RESULT", "PROC_RSLT", "BILL_STATUS", "STATUS", "처리상태"]) ||
    pick(row, ["JRCMIT_PROC_RSLT", "JRCMIT_PROC_RESULT", "소관위처리결과"]) ||
    pick(row, ["RGS_CONF_RSLT", "본회의심의결과"]) ||
    pick(row, ["PROC_STAGE_CD", "처리단계"])
  );
}

function buildBillUrl(id) {
  if (!id) return "https://likms.assembly.go.kr/bill/main.do";
  const url = new URL("https://likms.assembly.go.kr/bill/billDetail.do");
  url.searchParams.set("billId", id);
  return url.toString();
}

function mergeBills(currentBills, newBills) {
  const byBillNo = new Map(currentBills.map((bill) => [bill.billNo, bill]));
  newBills.forEach((bill) => byBillNo.set(bill.billNo, bill));
  return [...byBillNo.values()].sort((a, b) =>
    String(b.proposeDate).localeCompare(String(a.proposeDate)),
  );
}

function removeBillNo(value) {
  state.watchlist = state.watchlist.filter((billNo) => billNo !== value);
  saveWatchlist();
  renderWatchlist();
  applyFilters();
  syncWatchlistToGithub();
}

function renderWatchlist() {
  const availableBillNos = new Set(state.bills.map((bill) => bill.billNo));
  const pendingCount = state.watchlist.filter(
    (billNo) => !availableBillNos.has(billNo),
  ).length;

  if (state.watchlist.length === 0) {
    els.watchlistHint.textContent = "추적 중인 의안번호가 없습니다.";
  } else if (pendingCount > 0) {
    els.watchlistHint.textContent = `${state.watchlist.length}건 추적 중 (${pendingCount}건 데이터 조회 대기)`;
  } else {
    els.watchlistHint.textContent = `${state.watchlist.length}건 추적 중`;
  }
}

function parseBillNos(value) {
  const tokens = String(value || "")
    .split(/[\s,;，、]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const valid = [];
  const invalid = [];
  tokens.forEach((token) => {
    if (/^\d{7}$/.test(token)) {
      valid.push(token);
    } else {
      invalid.push(token);
    }
  });

  return { valid: uniqueBillNos(valid), invalid };
}

function normalizeBillNo(value) {
  const text = String(value || "").trim();
  return /^\d{7}$/.test(text) ? text : "";
}

function uniqueBillNos(values) {
  return [...new Set(values.map(normalizeBillNo).filter(Boolean))];
}

function pick(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function toIsoDate(value) {
  if (!value) return "";
  const text = String(value).trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const dashed = text
    .replace(/[./]/g, "-")
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dashed) {
    return [
      dashed[1],
      dashed[2].padStart(2, "0"),
      dashed[3].padStart(2, "0"),
    ].join("-");
  }
  return text;
}

function renderStatusCell(status, statusDate) {
  const text = escapeHtml(status || "-");
  if (!statusDate) return text;
  return `${text}<span class="status-date">${escapeHtml(formatDate(statusDate))}</span>`;
}

function renderSummaryCell(summary) {
  const text = String(summary || "").trim();
  if (!text) return "-";

  const preview = truncateText(text, SUMMARY_PREVIEW_LENGTH);
  if (preview === text) {
    return `<p class="summary-preview">${escapeHtml(text)}</p>`;
  }

  return `
    <div class="summary-cell">
      <p class="summary-preview">${escapeHtml(preview)}</p>
      <button type="button" class="summary-expand-btn" data-full-text="${escapeHtml(text)}">▶ 전체 보기</button>
    </div>
  `;
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resetFilters() {
  els.search.value = "";
  els.importance.value = "all";
  els.status.value = "all";
  els.impact.value = "all";
  applyFilters();
}

function loadOverrides() {
  try {
    const parsed = JSON.parse(localStorage.getItem(OVERRIDES_STORAGE_KEY));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveOverrides() {
  localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
}

function getBillWithOverrides(bill) {
  const o = overrides[bill.billNo];
  return o ? { ...bill, ...o } : bill;
}

function setOverride(billNo, field, value) {
  if (!overrides[billNo]) overrides[billNo] = {};
  overrides[billNo][field] = value;
  saveOverrides();
  setupFilters(state.bills);
  applyFilters();
}

function clearOverride(billNo, field) {
  if (!overrides[billNo]) return;
  delete overrides[billNo][field];
  if (Object.keys(overrides[billNo]).length === 0) delete overrides[billNo];
  saveOverrides();
  setupFilters(state.bills);
  applyFilters();
}

function openImportanceEditor(cell) {
  const billNo = cell.dataset.billNo;
  const bill = state.bills.find((b) => b.billNo === billNo);
  if (!bill) return;
  const current = getBillWithOverrides(bill).importance || "low";

  const select = document.createElement("select");
  select.className = "inline-select";
  [["high", "높음"], ["medium", "중간"], ["low", "낮음"]].forEach(([val, label]) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    opt.selected = val === current;
    select.append(opt);
  });

  cell.replaceChildren(select);
  select.focus();

  let committed = false;
  select.addEventListener("change", () => {
    committed = true;
    setOverride(billNo, "importance", select.value);
  });
  select.addEventListener("blur", () => { if (!committed) renderTable(); });
  select.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { committed = true; renderTable(); }
  });
}

function openOcEditor(cell) {
  const billNo = cell.dataset.billNo;
  const bill = state.bills.find((b) => b.billNo === billNo);
  if (!bill) return;
  const current = getBillWithOverrides(bill).oc || "";
  const selected = new Set(current.split(",").map((s) => s.trim()).filter(Boolean));

  document.querySelector(".oc-dropdown")?.remove();

  const dropdown = document.createElement("div");
  dropdown.className = "oc-dropdown";

  OC_OPTIONS.forEach((option) => {
    const label = document.createElement("label");
    label.className = "oc-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = option;
    checkbox.checked = selected.has(option);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(option);
      else selected.delete(option);
    });
    label.append(checkbox, document.createTextNode(option));
    dropdown.append(label);
  });

  // 위치 계산 전 hidden 상태로 먼저 마운트해 실제 높이 측정
  dropdown.style.visibility = "hidden";
  dropdown.style.top = "0px";
  dropdown.style.left = "0px";
  document.body.append(dropdown);

  const rect = cell.getBoundingClientRect();
  const dropH = dropdown.offsetHeight;
  const dropW = dropdown.offsetWidth;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 아래 공간이 부족하면 위쪽에 표시
  const top = (vh - rect.bottom >= dropH + 4 || rect.top < dropH + 4)
    ? rect.bottom + 4
    : rect.top - dropH - 4;

  // 오른쪽 끝이 잘리면 왼쪽으로 당김
  const left = Math.min(rect.left, vw - dropW - 8);

  Object.assign(dropdown.style, {
    top: `${top}px`,
    left: `${Math.max(8, left)}px`,
    visibility: "visible",
  });

  function close() {
    if (!document.body.contains(dropdown)) return;
    dropdown.remove();
    document.removeEventListener("click", handleOutside, true);
    document.removeEventListener("keydown", handleKey);
    const newValue = OC_OPTIONS.filter((o) => selected.has(o)).join(", ");
    if (newValue === current) return;
    if (newValue === "") {
      clearOverride(billNo, "oc");
    } else {
      setOverride(billNo, "oc", newValue);
    }
  }

  function handleOutside(e) {
    if (!dropdown.contains(e.target) &&
        !e.target.closest(`td[data-bill-no="${billNo}"][data-field="oc"]`)) {
      close();
    }
  }

  function handleKey(e) {
    if (e.key === "Escape") close();
  }

  setTimeout(() => {
    document.addEventListener("click", handleOutside, true);
    document.addEventListener("keydown", handleKey);
  }, 0);
}

function exportOverrides() {
  const blob = new Blob([JSON.stringify(overrides, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: `law-monitor-overrides-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

function exportAsExcel() {
  const bills = (state.filtered || []).map((bill) => getBillWithOverrides(bill));
  const headers = ["중요도", "O/C", "법안명", "의안번호", "발의자", "소관위원회", "발의일", "처리현황", "사업영향", "링크"];
  const rows = bills.map((b) => [
    getImportanceLabel(b.importance),
    b.oc || "",
    b.billName || "",
    b.billNo || "",
    b.proposer || "",
    b.committee || "",
    formatDate(b.proposeDate),
    b.status || "",
    b.impactArea || "",
    b.url || "",
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const bom = "﻿";
  const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: `law-monitor-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

function exportAsPdf() {
  window.print();
}

function loadGithubPat() {
  return localStorage.getItem(GITHUB_PAT_STORAGE_KEY) || "";
}

function saveGithubPat(pat) {
  if (pat) localStorage.setItem(GITHUB_PAT_STORAGE_KEY, pat);
  else localStorage.removeItem(GITHUB_PAT_STORAGE_KEY);
}

function renderGithubSyncState() {
  const connected = !!loadGithubPat();
  els.githubPatSetup.hidden = connected;
  els.githubPatReady.hidden = !connected;
  els.githubSyncBadge.textContent = connected ? "연결됨" : "미설정";
  els.githubSyncBadge.className = `github-sync-badge${connected ? " connected" : ""}`;
}

function setGithubSyncMsg(text, type = "") {
  els.githubSyncMsg.textContent = text;
  els.githubSyncMsg.className = `github-sync-msg${type ? ` ${type}` : ""}`;
  if (type === "syncing") {
    els.githubSyncBadge.textContent = "동기화 중";
    els.githubSyncBadge.className = "github-sync-badge syncing";
  } else if (type === "error") {
    els.githubSyncBadge.textContent = "오류";
    els.githubSyncBadge.className = "github-sync-badge error";
  } else if (text) {
    els.githubSyncBadge.textContent = "연결됨";
    els.githubSyncBadge.className = "github-sync-badge connected";
  }
}

async function syncWatchlistToGithub() {
  const pat = loadGithubPat();
  if (!pat) return;

  setGithubSyncMsg("동기화 중...", "syncing");

  const headers = {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  try {
    // 현재 파일 SHA 조회
    const getRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_WATCHLIST_PATH}`,
      { headers },
    );
    if (getRes.status === 401) {
      saveGithubPat("");
      renderGithubSyncState();
      setGithubSyncMsg("PAT가 유효하지 않습니다. 다시 입력해주세요.", "error");
      return;
    }
    if (!getRes.ok) throw new Error(`GitHub API ${getRes.status}`);
    const { sha } = await getRes.json();

    // watchlist.json 업데이트
    const newContent = JSON.stringify({ billNos: state.watchlist }, null, 2) + "\n";
    const putRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_WATCHLIST_PATH}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: `의안 목록 업데이트 (${state.watchlist.length}건)`,
          content: btoa(newContent),
          sha,
          branch: GITHUB_BRANCH,
        }),
      },
    );
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API ${putRes.status}`);
    }

    // 워크플로 즉시 실행
    await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW_ID}/dispatches`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ ref: GITHUB_BRANCH }),
      },
    );

    setGithubSyncMsg("✓ 동기화 완료 — 1~2분 후 반영됩니다");
  } catch (error) {
    console.error("GitHub sync failed:", error);
    setGithubSyncMsg(`동기화 실패: ${error.message}`, "error");
  }
}

function importOverrides(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      overrides = { ...overrides, ...parsed };
      saveOverrides();
      setupFilters(state.bills);
      applyFilters();
    } catch {
      console.warn("잘못된 override 파일 형식");
    }
  };
  reader.readAsText(file);
}

function sortBills(bills) {
  const { column, direction } = state.sort;
  if (!column) return bills;
  return [...bills].sort((a, b) => {
    const ae = getBillWithOverrides(a);
    const be = getBillWithOverrides(b);
    if (column === "importance") {
      const aVal = IMPORTANCE_ORDER[ae.importance] ?? 3;
      const bVal = IMPORTANCE_ORDER[be.importance] ?? 3;
      return direction === "asc" ? aVal - bVal : bVal - aVal;
    }
    const aVal = normalizeText(ae[column]);
    const bVal = normalizeText(be[column]);
    const cmp = aVal.localeCompare(bVal, "ko-KR");
    return direction === "asc" ? cmp : -cmp;
  });
}

function renderTable() {
  const sorted = sortBills(state.filtered);
  const totalCount = sorted.length;
  els.resultCount.textContent = `${totalCount.toLocaleString("ko-KR")}건 표시`;
  const start = (state.page - 1) * PAGE_SIZE;
  renderRows(sorted.slice(start, start + PAGE_SIZE));
  renderPagination(totalCount);
  updateSortHeaders();
}

function renderPagination(totalCount) {
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  els.pagination.replaceChildren();
  if (totalPages <= 1) return;

  const prev = Object.assign(document.createElement("button"), {
    type: "button",
    className: "page-nav",
    textContent: "이전",
    disabled: state.page === 1,
  });
  prev.addEventListener("click", () => { state.page--; renderTable(); });
  els.pagination.append(prev);

  getPageRange(state.page, totalPages).forEach((p) => {
    if (p === "...") {
      const ellipsis = document.createElement("span");
      ellipsis.className = "page-ellipsis";
      ellipsis.textContent = "…";
      els.pagination.append(ellipsis);
      return;
    }
    const btn = Object.assign(document.createElement("button"), {
      type: "button",
      className: p === state.page ? "page-btn active" : "page-btn",
      textContent: String(p),
    });
    if (p === state.page) btn.setAttribute("aria-current", "page");
    btn.addEventListener("click", () => { state.page = p; renderTable(); });
    els.pagination.append(btn);
  });

  const next = Object.assign(document.createElement("button"), {
    type: "button",
    className: "page-nav",
    textContent: "다음",
    disabled: state.page === totalPages,
  });
  next.addEventListener("click", () => { state.page++; renderTable(); });
  els.pagination.append(next);
}

function getPageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "...", total];
  if (current >= total - 3) return [1, "...", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "...", current - 1, current, current + 1, "...", total];
}

function updateSortHeaders() {
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    const col = th.dataset.sort;
    th.setAttribute(
      "aria-sort",
      state.sort.column === col
        ? state.sort.direction === "asc" ? "ascending" : "descending"
        : "none",
    );
  });
}

function bindEvents() {
  [els.search, els.importance, els.status, els.impact].forEach((control) => {
    control.addEventListener("input", applyFilters);
    control.addEventListener("change", applyFilters);
  });
  els.reset.addEventListener("click", resetFilters);
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (state.sort.column === col) {
        state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
      } else {
        state.sort.column = col;
        state.sort.direction = col === "proposeDate" ? "desc" : "asc";
      }
      state.page = 1;
      renderTable();
    });
  });
  els.watchlistForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addBillNos(els.billNoInput.value);
  });
  els.rows.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;

    const removeBtn = event.target.closest(".remove-btn");
    if (removeBtn) {
      removeBillNo(removeBtn.dataset.billNo);
      return;
    }

    const resetBtn = event.target.closest(".reset-cell-btn");
    if (resetBtn) {
      event.stopPropagation();
      const cell = resetBtn.closest("td[data-bill-no]");
      if (cell) clearOverride(cell.dataset.billNo, cell.dataset.field);
      return;
    }

    const expandBtn = event.target.closest(".summary-expand-btn");
    if (expandBtn) {
      els.summaryModalText.textContent = expandBtn.dataset.fullText;
      els.summaryModal.hidden = false;
      document.body.style.overflow = "hidden";
      return;
    }

    const importanceCell = event.target.closest("td[data-field='importance']");
    if (importanceCell && !importanceCell.querySelector("select")) {
      openImportanceEditor(importanceCell);
      return;
    }

    const ocCell = event.target.closest("td[data-field='oc']");
    if (ocCell && !ocCell.querySelector("input")) {
      openOcEditor(ocCell);
      return;
    }
  });

  function closeSummaryModal() {
    els.summaryModal.hidden = true;
    document.body.style.overflow = "";
  }

  els.summaryModalClose.addEventListener("click", closeSummaryModal);
  els.summaryModal.addEventListener("click", (e) => {
    if (e.target === els.summaryModal) closeSummaryModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSummaryModal();
  });

  els.saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    els.saveMenu.hidden = !els.saveMenu.hidden;
  });

  els.saveMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    const btn = e.target.closest("[data-format]");
    if (!btn) return;
    els.saveMenu.hidden = true;
    if (btn.dataset.format === "excel") exportAsExcel();
    else if (btn.dataset.format === "pdf") exportAsPdf();
  });

  document.addEventListener("click", () => {
    els.saveMenu.hidden = true;
  });

  els.githubPatSave.addEventListener("click", () => {
    const pat = els.githubPatInput.value.trim();
    if (!pat) return;
    saveGithubPat(pat);
    els.githubPatInput.value = "";
    renderGithubSyncState();
    setGithubSyncMsg("PAT가 저장됐습니다. 의안을 추가하면 자동으로 동기화됩니다.");
  });

  els.githubPatClear.addEventListener("click", () => {
    saveGithubPat("");
    renderGithubSyncState();
    setGithubSyncMsg("");
  });

  els.githubSyncNow.addEventListener("click", () => syncWatchlistToGithub());
}

async function init() {
  const data = await loadData();
  state.bills = mergeBills(
    Array.isArray(data.bills) ? data.bills : [],
    loadClientBills(),
  );
  overrides = loadOverrides();
  renderGithubSyncState();
  initializeWatchlist(data);
  els.generatedAt.textContent = `마지막 갱신 ${formatDate(data.generatedAt)}`;
  els.sourceName.textContent = "SKI 정책Comm.팀";
  setupFilters(state.bills);
  renderWatchlist();
  applyFilters();
  bindEvents();
  await fetchMissingBills(state.watchlist, { promptForKey: false });
  setupFilters(state.bills);
  renderWatchlist();
  applyFilters();
}

async function hashPassword(password) {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(password),
  );
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isAuthenticated() {
  return localStorage.getItem(AUTH_TOKEN_KEY) === "ok";
}

async function authenticate(password) {
  const hash = await hashPassword(password);
  if (hash === AUTH_HASH) {
    localStorage.setItem(AUTH_TOKEN_KEY, "ok");
    return true;
  }
  return false;
}

function runApp() {
  init().catch((error) => {
    console.error(error);
    els.generatedAt.textContent = "데이터 로드 실패";
    const btn = Object.assign(document.createElement("button"), {
      type: "button",
      className: "retry-btn",
      textContent: "다시 시도",
    });
    btn.addEventListener("click", runApp);
    els.emptyState.replaceChildren(
      Object.assign(document.createElement("span"), {
        textContent: "대시보드 데이터를 불러오지 못했습니다.",
      }),
      btn,
    );
    els.emptyState.hidden = false;
  });
}

function startApp() {
  if (!isAuthenticated()) {
    document.getElementById("authPassword")?.focus();
    return;
  }
  document.getElementById("authGate").hidden = true;
  runApp();
}

document.getElementById("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("authPassword");
  const ok = await authenticate(input.value);
  if (ok) {
    document.getElementById("authGate").hidden = true;
    runApp();
  } else {
    document.getElementById("authError").hidden = false;
    input.value = "";
    input.focus();
  }
});

startApp();
