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
const GITHUB_BILLS_PATH = "data/bills.json";
const GITHUB_OVERRIDES_PATH = "data/impact-overrides.json";
const GITHUB_WORKFLOW_ID = "update-bills.yml";
const GITHUB_BRANCH = "master";
const OC_OPTIONS = ["SKI", "SKE", "SKIPC", "SKGC", "SKO", "SKE&S", "SKTI", "SKEO", "SKEN"];
const OVERRIDES_SYNC_DEBOUNCE_MS = 800;

let overrides = {};
let dirtyOverridePatch = {};
let overridesSyncTimer = null;
let overridesSyncInFlight = null;
let watchlistDirty = false;
let billsDirty = false;

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
  oc: document.querySelector("#ocFilter"),
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

function splitOcValues(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function setupFilters(bills) {
  fillSelect(
    els.oc,
    uniqueSorted(bills.flatMap((bill) => splitOcValues(getBillWithOverrides(bill).oc))),
  );
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
  const oc = els.oc.value;
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
      (oc === "all" || splitOcValues(b.oc).includes(oc)) &&
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

// 공용 워치리스트(data/watchlist.json)를 직접 받아옵니다. 누구나 읽을 수 있는
// 정적 파일이므로 PAT 없이도 항상 "팀 전체의 최신 추적 목록"을 확인할 수 있고,
// 이를 기준으로 삼아야 한 기기의 추가/삭제가 다른 기기에도 전파됩니다.
async function loadRemoteWatchlist() {
  try {
    const { data: remote } = await getGithubJsonFile(GITHUB_WATCHLIST_PATH, { billNos: [] }, { pat: "" });
    const billNos = Array.isArray(remote) ? remote : remote?.billNos;
    if (!Array.isArray(billNos)) return null;
    return uniqueBillNos(
      billNos.map((value) => String(value).trim()).filter(Boolean),
    );
  } catch {
    try {
      const remote = await loadJson(`${GITHUB_WATCHLIST_PATH}?_=${Date.now()}`);
      const billNos = Array.isArray(remote) ? remote : remote?.billNos;
      if (!Array.isArray(billNos)) return null;
      return uniqueBillNos(
        billNos.map((value) => String(value).trim()).filter(Boolean),
      );
    } catch {
      return null;
    }
  }
}

function initializeWatchlist(data, remoteWatchlist) {
  // 1순위: 공용(GitHub) 워치리스트 — 가져오는 데 성공했다면 이것이 항상 최신
  // "팀 전체" 목록이므로 기준으로 삼는다(로컬에 남아있는 옛 캐시는 덮어씀).
  if (Array.isArray(remoteWatchlist) && remoteWatchlist.length > 0) {
    state.watchlist = remoteWatchlist;
    saveWatchlist();
    return;
  }

  // 2순위: 공용 목록을 못 가져온 경우(오프라인 등)에만 로컬 캐시 사용
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
  if (addedCount > 0) watchlistDirty = true;
  els.billNoInput.value = "";
  renderWatchlist();
  await fetchMissingBills(valid, { promptForKey: true });
  await syncWatchlistToGithub();
  await syncBillsToGithub();
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
    billsDirty = true;
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
  watchlistDirty = true;
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
  els.oc.value = "all";
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

function markOverrideDirty(billNo, field, value) {
  if (!dirtyOverridePatch[billNo]) dirtyOverridePatch[billNo] = {};
  dirtyOverridePatch[billNo][field] = value;
}

function hasDirtyOverrides() {
  return Object.keys(dirtyOverridePatch).length > 0;
}

function queueOverridesSync() {
  if (!loadGithubPat()) return;
  window.clearTimeout(overridesSyncTimer);
  setGithubSyncMsg("편집 내용 저장됨 — GitHub 동기화 대기 중");
  overridesSyncTimer = window.setTimeout(() => {
    syncOverridesToGithub();
  }, OVERRIDES_SYNC_DEBOUNCE_MS);
}

function mergeOverridePatches(...patches) {
  const merged = {};
  patches.forEach((patch) => {
    Object.entries(patch || {}).forEach(([billNo, fields]) => {
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) return;
      if (!merged[billNo]) merged[billNo] = {};
      Object.assign(merged[billNo], fields);
    });
  });
  return merged;
}

function applyOverridePatch(base, patch) {
  const merged = JSON.parse(JSON.stringify(base || {}));
  Object.entries(patch || {}).forEach(([billNo, fields]) => {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) return;
    if (!merged[billNo] || typeof merged[billNo] !== "object" || Array.isArray(merged[billNo])) {
      merged[billNo] = {};
    }
    Object.entries(fields).forEach(([field, value]) => {
      if (value === null) delete merged[billNo][field];
      else merged[billNo][field] = value;
    });
    if (Object.keys(merged[billNo]).length === 0) delete merged[billNo];
  });
  return merged;
}

function createGithubHeaders(pat = loadGithubPat()) {
  const headers = {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  if (pat) headers.Authorization = `Bearer ${pat}`;
  return headers;
}

function getGithubContentUrl(path) {
  const url = new URL(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`);
  url.searchParams.set("ref", GITHUB_BRANCH);
  return url.toString();
}

function decodeBase64Utf8(content) {
  const binary = atob(String(content || "").replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

async function getGithubJsonFile(path, fallback, options = {}) {
  const { pat = loadGithubPat() } = options;
  const response = await fetch(getGithubContentUrl(path), {
    headers: createGithubHeaders(pat),
    cache: "no-store",
  });
  if (response.status === 404) return { sha: undefined, data: fallback, text: "" };
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const error = new Error(err.message || `GitHub API ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const file = await response.json();
  const text = decodeBase64Utf8(file.content);
  return {
    sha: file.sha,
    data: JSON.parse(text),
    text,
  };
}

function handleGithubAuthError() {
  saveGithubPat("");
  renderGithubSyncState();
  setGithubSyncMsg("PAT가 유효하지 않습니다. 다시 입력해주세요.", "error");
}

// 팀 공용 편집 내용(O/C, 중요도 등)을 GitHub에서 직접 받아옵니다.
// 워치리스트와 마찬가지로 누구나 읽을 수 있는 정적 파일이라, 다른
// 팀원이 PAT로 동기화한 편집 내용을 새로고침만으로 받아볼 수 있습니다.
async function loadRemoteOverrides() {
  try {
    const { data: remote } = await getGithubJsonFile(GITHUB_OVERRIDES_PATH, {}, { pat: "" });
    return remote && typeof remote === "object" && !Array.isArray(remote)
      ? remote
      : null;
  } catch {
    try {
      const remote = await loadJson(`${GITHUB_OVERRIDES_PATH}?_=${Date.now()}`);
      return remote && typeof remote === "object" && !Array.isArray(remote)
        ? remote
        : null;
    } catch {
      return null;
    }
  }
}

function getBillWithOverrides(bill) {
  const o = overrides[bill.billNo];
  return o ? { ...bill, ...o } : bill;
}

function setOverride(billNo, field, value) {
  if (!overrides[billNo]) overrides[billNo] = {};
  overrides[billNo][field] = value;
  markOverrideDirty(billNo, field, value);
  saveOverrides();
  setupFilters(state.bills);
  applyFilters();
  queueOverridesSync();
}

function clearOverride(billNo, field) {
  if (!overrides[billNo]) return;
  delete overrides[billNo][field];
  if (Object.keys(overrides[billNo]).length === 0) delete overrides[billNo];
  markOverrideDirty(billNo, field, null);
  saveOverrides();
  setupFilters(state.bills);
  applyFilters();
  queueOverridesSync();
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

async function syncWatchlistToGithub(options = {}) {
  const { force = false } = options;
  const pat = loadGithubPat();
  if (!pat) return;
  if (!force && !watchlistDirty) return;

  setGithubSyncMsg("동기화 중...", "syncing");
  const headers = createGithubHeaders(pat);

  try {
    const { sha, data: existing } = await getGithubJsonFile(
      GITHUB_WATCHLIST_PATH,
      { billNos: [] },
      { pat },
    );
    const existingBillNos = uniqueBillNos(
      (Array.isArray(existing) ? existing : existing?.billNos || [])
        .map((value) => String(value).trim())
        .filter(Boolean),
    );
    if (JSON.stringify(existingBillNos) === JSON.stringify(state.watchlist)) {
      watchlistDirty = false;
      setGithubSyncMsg("추적 목록 변경 사항 없음");
      return;
    }

    // watchlist.json 업데이트
    const newContent = JSON.stringify({ billNos: state.watchlist }, null, 2) + "\n";
    const putRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_WATCHLIST_PATH}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: `의안 목록 업데이트 (${state.watchlist.length}건)`,
          content: encodeBase64Utf8(newContent),
          sha,
          branch: GITHUB_BRANCH,
        }),
      },
    );
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      const error = new Error(err.message || `GitHub API ${putRes.status}`);
      error.status = putRes.status;
      throw error;
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

    watchlistDirty = false;
    setGithubSyncMsg("✓ 동기화 완료 — 1~2분 후 반영됩니다");
  } catch (error) {
    if (error.status === 401) {
      handleGithubAuthError();
      return;
    }
    console.error("GitHub sync failed:", error);
    setGithubSyncMsg(`동기화 실패: ${error.message}`, "error");
  }
}

// 브라우저가 직접(개인 API 키로) 가져온 의안 데이터를 공용 bills.json에 반영합니다.
// GitHub Actions 러너가 국회 Open API에 접속하지 못해 1건짜리 데이터로
// 되돌아가는 문제를 우회하기 위해, 이미 데이터를 보유한 브라우저가
// 곧바로 저장소의 bills.json을 갱신합니다(워치리스트 동기화와 동일한 PAT 사용).
async function syncBillsToGithub(options = {}) {
  const { force = false } = options;
  const pat = loadGithubPat();
  if (!pat) return;
  if (!force && !billsDirty) return;

  const watchlistSet = new Set(state.watchlist);
  const billsToSync = state.bills.filter((bill) => watchlistSet.has(bill.billNo));
  if (billsToSync.length === 0) return;

  setGithubSyncMsg("의안 데이터 동기화 중...", "syncing");
  const headers = createGithubHeaders(pat);

  try {
    const { sha, data: existing } = await getGithubJsonFile(
      GITHUB_BILLS_PATH,
      { bills: [] },
      { pat },
    );

    // 기존 데이터와 병합 — 더 최신(또는 더 풍부한) 쪽을 유지
    const merged = mergeBills(Array.isArray(existing.bills) ? existing.bills : [], billsToSync);
    if (JSON.stringify(merged) === JSON.stringify(existing.bills || [])) {
      billsDirty = false;
      setGithubSyncMsg("의안 데이터 변경 사항 없음");
      return;
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      source: "open.assembly.go.kr (브라우저 동기화)",
      query: existing.query || {},
      bills: merged,
    };
    const newContent = JSON.stringify(payload, null, 2) + "\n";

    const putRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_BILLS_PATH}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: `의안 데이터 브라우저 동기화 (${merged.length}건)`,
          content: encodeBase64Utf8(newContent),
          sha,
          branch: GITHUB_BRANCH,
        }),
      },
    );
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      const error = new Error(err.message || `GitHub API ${putRes.status}`);
      error.status = putRes.status;
      throw error;
    }

    billsDirty = false;
    setGithubSyncMsg(`✓ 의안 데이터 ${merged.length}건 동기화 완료 — 1~2분 후 모든 기기에 반영됩니다`);
  } catch (error) {
    if (error.status === 401) {
      handleGithubAuthError();
      return;
    }
    console.error("Bills sync failed:", error);
    setGithubSyncMsg(`의안 데이터 동기화 실패: ${error.message}`, "error");
  }
}

// O/C·중요도 등 사용자가 표에서 직접 수정한 편집 내용(overrides)을
// data/impact-overrides.json에 동기화합니다. 이전에는 이 편집 내용이
// localStorage에만 저장되어 다른 팀원에게는 절대 공유되지 않았습니다.
function syncOverridesToGithub(options = {}) {
  if (overridesSyncInFlight) return overridesSyncInFlight;

  overridesSyncInFlight = syncOverridesToGithubNow(options)
    .finally(() => {
      overridesSyncInFlight = null;
      if (hasDirtyOverrides()) queueOverridesSync();
    });

  return overridesSyncInFlight;
}

async function syncOverridesToGithubNow(options = {}) {
  const { force = false } = options;
  const pat = loadGithubPat();
  if (!pat) return;
  if (!force && !hasDirtyOverrides()) return;
  if (force && Object.keys(overrides).length === 0 && !hasDirtyOverrides()) return;

  window.clearTimeout(overridesSyncTimer);
  setGithubSyncMsg("편집 내용 동기화 중...", "syncing");
  const headers = createGithubHeaders(pat);
  const patch = force
    ? mergeOverridePatches(overrides, dirtyOverridePatch)
    : dirtyOverridePatch;
  dirtyOverridePatch = {};

  try {
    const { sha, data } = await getGithubJsonFile(
      GITHUB_OVERRIDES_PATH,
      {},
      { pat },
    );
    const existing = data && typeof data === "object" && !Array.isArray(data)
      ? data
      : {};

    // 동일 의안에 대해선 "내가 방금 수정한 값"을 우선 적용하고,
    // 그 외엔 팀원들이 동기화해 둔 값을 그대로 유지합니다.
    const merged = applyOverridePatch(existing, patch);
    if (JSON.stringify(merged) === JSON.stringify(existing)) {
      // 푸시할 새로운 변경 사항이 없으면 건너뜀
      if (JSON.stringify(merged) !== JSON.stringify(overrides)) {
        overrides = merged;
        saveOverrides();
      }
      return;
    }

    const newContent = JSON.stringify(merged, null, 2) + "\n";
    const putRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_OVERRIDES_PATH}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: `의안별 편집 내용 동기화 (O/C·중요도 등, ${Object.keys(merged).length}건)`,
          content: encodeBase64Utf8(newContent),
          sha,
          branch: GITHUB_BRANCH,
        }),
      },
    );
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      const error = new Error(err.message || `GitHub API ${putRes.status}`);
      error.status = putRes.status;
      throw error;
    }

    overrides = merged;
    saveOverrides();
    setGithubSyncMsg(`✓ 편집 내용 ${Object.keys(merged).length}건 동기화 완료`);
  } catch (error) {
    dirtyOverridePatch = mergeOverridePatches(patch, dirtyOverridePatch);
    if (error.status === 401) {
      handleGithubAuthError();
      return;
    }
    console.error("Overrides sync failed:", error);
    setGithubSyncMsg(`편집 내용 동기화 실패: ${error.message}`, "error");
  }
}

function importOverrides(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      overrides = { ...overrides, ...parsed };
      dirtyOverridePatch = mergeOverridePatches(dirtyOverridePatch, parsed);
      saveOverrides();
      setupFilters(state.bills);
      applyFilters();
      queueOverridesSync();
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
  [els.search, els.importance, els.oc, els.status, els.impact].forEach((control) => {
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

  els.githubSyncNow.addEventListener("click", async () => {
    await syncWatchlistToGithub();
    await syncBillsToGithub();
    await syncOverridesToGithub({ force: true });
  });
}

async function init() {
  const data = await loadData();
  state.bills = mergeBills(
    Array.isArray(data.bills) ? data.bills : [],
    loadClientBills(),
  );
  overrides = loadOverrides();
  const remoteOverrides = await loadRemoteOverrides();
  if (remoteOverrides && Object.keys(remoteOverrides).length > 0) {
    // 같은 의안에 동시 편집이 있으면 "내 로컬 편집"을 우선하고,
    // 그 외 필드는 팀원들이 동기화해 둔 값을 받아옵니다.
    overrides = mergeOverridePatches(remoteOverrides, overrides);
    saveOverrides();
  }
  renderGithubSyncState();
  const remoteWatchlist = await loadRemoteWatchlist();
  initializeWatchlist(data, remoteWatchlist);
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
