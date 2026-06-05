import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API_BASE =
  process.env.OPEN_ASSEMBLY_API_BASE ||
  "https://open.assembly.go.kr/portal/openapi";
const BILL_LIST_ENDPOINT =
  process.env.BILL_LIST_ENDPOINT || `${API_BASE}/ALLBILLV2`;
const BILL_SUMMARY_ENDPOINT =
  process.env.BILL_SUMMARY_ENDPOINT || `${API_BASE}/BPMBILLSUMMARY`;
const API_KEY = process.env.OPEN_ASSEMBLY_API_KEY || process.env.NA_OPEN_API_KEY;
const OUTPUT = process.env.OUTPUT || "data/bills.json";
const WATCHLIST_PATH = process.env.WATCHLIST_PATH || "data/watchlist.json";
const BILL_ERACO = process.env.BILL_ERACO || process.env.BILL_AGE || "22";
const BILL_NO = process.env.BILL_NO || process.env.TEST_BILL_NO || "";
const BILL_NOS = (process.env.BILL_NOS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 100);
const MAX_PAGES = Number(process.env.MAX_PAGES || 5);
const FETCH_SUMMARIES = process.env.FETCH_SUMMARIES !== "false";
const BILL_KEYWORDS = (process.env.BILL_KEYWORDS || "개정,일부개정,전부개정")
  .split(",")
  .map((word) => word.trim())
  .filter(Boolean);

if (!API_KEY) {
  throw new Error(
    "OPEN_ASSEMBLY_API_KEY is required. Add it as a GitHub Actions secret or local environment variable.",
  );
}

const rules = await readJson("data/impact-rules.json", []);
const overrides = await readJson("data/impact-overrides.json", {});
const targetBillNos = await readTargetBillNos();
const targetBillNoSet = new Set(targetBillNos);
const listParamsLog = [];
const rows = [];

if (targetBillNos.length > 0) {
  for (const billNo of targetBillNos) {
    const listParams = await resolveListParams(billNo);
    listParamsLog.push(listParams);
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const pageRows = await fetchPage(BILL_LIST_ENDPOINT, page, listParams);
      rows.push(...pageRows);
      if (pageRows.length < PAGE_SIZE) break;
    }
  }
} else {
  const listParams = await resolveListParams();
  listParamsLog.push(listParams);
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const pageRows = await fetchPage(BILL_LIST_ENDPOINT, page, listParams);
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }
}

const normalizedBills = rows.map(normalizeBill).filter((bill) => bill.billName);
const summaryByBillNo = FETCH_SUMMARIES
  ? await fetchSummaryMap(normalizedBills.map((bill) => bill.billNo))
  : new Map();

const bills = normalizedBills
  .filter(
    (bill) => targetBillNoSet.size === 0 || targetBillNoSet.has(bill.billNo),
  )
  .filter(
    (bill) =>
      targetBillNoSet.size > 0 ||
      BILL_KEYWORDS.some((word) => bill.billName.includes(word)),
  )
  .map((bill) => ({
    ...bill,
    summary: bill.summary || summaryByBillNo.get(bill.billNo) || "",
  }))
  .map(enrichBill)
  .sort((a, b) => String(b.proposeDate).localeCompare(String(a.proposeDate)));

const output = {
  generatedAt: new Date().toISOString(),
  source: "open.assembly.go.kr",
  query: {
    billListEndpoint: BILL_LIST_ENDPOINT,
    billSummaryEndpoint: BILL_SUMMARY_ENDPOINT,
    billEraco: BILL_ERACO,
    billNos: targetBillNos,
    billListParams: listParamsLog,
    keywords: BILL_KEYWORDS,
    maxPages: MAX_PAGES,
  },
  bills,
};

await mkdir(dirname(resolve(OUTPUT)), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${bills.length} bills to ${OUTPUT}`);

async function readTargetBillNos() {
  if (BILL_NO) return [BILL_NO];
  if (BILL_NOS.length > 0) return unique(BILL_NOS);

  const watchlist = await readJson(WATCHLIST_PATH, { billNos: [] });
  const billNos = Array.isArray(watchlist) ? watchlist : watchlist.billNos;
  return unique(
    (Array.isArray(billNos) ? billNos : [])
      .map((value) => String(value).trim())
      .filter(Boolean),
  );
}

async function resolveListParams(billNo = "") {
  const candidates = billNo
    ? [
        { BILL_NO: billNo, ERACO: BILL_ERACO },
        { BILL_NO: billNo, ERACO: formatEraco(BILL_ERACO) },
        { BILL_NO: billNo, AGE: BILL_ERACO },
        { BILL_NO: billNo },
      ]
    : [
        { ERACO: BILL_ERACO },
        { ERACO: formatEraco(BILL_ERACO) },
        { AGE: BILL_ERACO },
        {},
      ];

  for (const params of candidates) {
    const rows = await fetchPage(BILL_LIST_ENDPOINT, 1, params);
    if (rows.length > 0) {
      console.log(`Using bill list params: ${JSON.stringify(params)}`);
      return params;
    }
  }

  console.warn(
    `No bill list data found from ${BILL_LIST_ENDPOINT}. Writing an empty dashboard dataset.`,
  );
  return candidates[0];
}

async function fetchPage(endpoint, page, params = {}) {
  const url = new URL(endpoint);
  url.searchParams.set("KEY", API_KEY);
  url.searchParams.set("Type", "json");
  url.searchParams.set("pIndex", String(page));
  url.searchParams.set("pSize", String(PAGE_SIZE));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url).catch((error) => {
    throw new Error(
      `Open Assembly API request failed. Check network access and endpoint: ${error.message}`,
    );
  });
  if (!response.ok) {
    throw new Error(`Open Assembly API failed: ${response.status}`);
  }
  const payload = await response.json();
  return extractRows(payload);
}

async function fetchSummaryMap(billNos) {
  const summaryRows = [];
  const uniqueBillNos = [...new Set(billNos.filter(Boolean))];

  for (const billNo of uniqueBillNos) {
    try {
      summaryRows.push(
        ...(await fetchPage(BILL_SUMMARY_ENDPOINT, 1, { BILL_NO: billNo })),
      );
    } catch (error) {
      console.warn(`Skipping summary for ${billNo}: ${error.message}`);
    }
  }

  return new Map(
    summaryRows
      .map((row) => [
        pick(row, ["BILL_NO", "BILL_NUM", "billNo", "의안번호"]),
        pick(row, ["SUMMARY", "summary", "제안이유및주요내용", "주요내용"]),
      ])
      .filter(([billNo, summary]) => billNo && summary),
  );
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;

  const directRows = payload?.row;
  if (Array.isArray(directRows)) return directRows;

  for (const value of Object.values(payload ?? {})) {
    if (Array.isArray(value)) {
      const rowGroup = value.find((entry) => Array.isArray(entry?.row));
      if (rowGroup) return rowGroup.row;
    }
  }

  const result = payload?.RESULT || payload?.result;
  if (result?.CODE && result.CODE !== "INFO-000") {
    if (result.CODE === "INFO-200") return [];
    throw new Error(`Open Assembly API error ${result.CODE}: ${result.MESSAGE}`);
  }

  return [];
}

function formatEraco(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("대")) return text;
  return `제${text}대`;
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeBill(row) {
  const id = pick(row, [
    "BILL_ID",
    "billId",
    "BILL_NO",
    "billNo",
    " 의안ID",
    "의안ID",
  ]);
  const billNo = pick(row, ["BILL_NO", "billNo", "의안번호", "BILL_NUM"]);
  const billName = pick(row, [
    "BILL_NAME",
    "BILL_NM",
    "billName",
    "의안명",
    "TITLE",
  ]);

  return {
    id: id || billNo || billName,
    billNo: billNo || id || "",
    billName,
    proposer: pick(row, [
      "PROPOSER",
      "PPSR",
      "PPSR_NM",
      "PPSR_KIND",
      "RST_PROPOSER",
      "제안자",
      "대표발의자",
      "제안자구분",
    ]),
    proposeDate: toIsoDate(
      pick(row, [
        "PROPOSE_DT",
        "PROPOSE_DATE",
        "PPSL_DT",
        "PPSL_DATE",
        "제안일",
        "발의일",
      ]),
    ),
    committee: pick(row, [
      "CURR_COMMITTEE",
      "COMMITTEE",
      "COMMITTEE_NAME",
      "JRCMIT_NM",
      "소관위원회",
      "위원회",
    ]),
    status: buildStatus(row),
    summary: pick(row, [
      "SUMMARY",
      "MAIN_CONTENT",
      "BILL_SUMMARY",
      "제안이유및주요내용",
      "주요내용",
    ]),
    url:
      pick(row, ["DETAIL_LINK", "BILL_URL", "LINK_URL", "HWP_URL1", "상세링크"]) ||
      buildBillUrl(id),
    raw: row,
  };
}

function buildStatus(row) {
  const candidates = [
    pick(row, ["PROC_RESULT", "PROC_RSLT", "BILL_STATUS", "STATUS", "처리상태"]),
    pick(row, ["JRCMIT_PROC_RSLT", "JRCMIT_PROC_RESULT", "소관위처리결과"]),
    pick(row, ["RGS_CONF_RSLT", "본회의심의결과"]),
    pick(row, ["PROC_STAGE_CD", "처리단계"]),
  ].filter(Boolean);

  return candidates[0] || "";
}

function enrichBill(bill) {
  const override = overrides[bill.id] || overrides[bill.billNo] || {};
  const text = `${bill.billName} ${bill.summary}`.toLowerCase();
  const matchedRule = rules.find((rule) =>
    rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())),
  );

  const impactArea =
    override.impactArea || matchedRule?.impactArea || "공통/기타";
  const businessImpact =
    override.businessImpact ||
    matchedRule?.businessImpact ||
    "담당 부서 검토 후 사업영향 보정 필요";
  const oc = override.oc || override.oC || override["O/C"] || "";

  return {
    ...bill,
    summary: bill.summary || `${bill.billName}에 대한 주요 내용 확인 필요`,
    status: bill.status || "상태 확인 필요",
    committee: bill.committee || "소관위원회 확인 필요",
    businessImpact,
    oc,
    importance:
      override.importance ||
      adjustImportance(matchedRule?.importance || "low", bill.status),
    impactArea,
  };
}

function adjustImportance(base, status) {
  const text = String(status || "");
  if (/(가결|통과|대안반영|공포|정부이송)/.test(text)) return "high";
  if (base === "high") return "high";
  if (/(소위|상정|심사)/.test(text) && base === "low") return "medium";
  return base;
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
  const dashed = text.replace(/[./]/g, "-").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dashed) {
    return [
      dashed[1],
      dashed[2].padStart(2, "0"),
      dashed[3].padStart(2, "0"),
    ].join("-");
  }
  return text;
}

function buildBillUrl(id) {
  if (!id) return "https://likms.assembly.go.kr/bill/main.do";
  const url = new URL("https://likms.assembly.go.kr/bill/billDetail.do");
  url.searchParams.set("billId", id);
  return url.toString();
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}
