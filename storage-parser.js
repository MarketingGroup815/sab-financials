// ============================================================================
// 3. LOCALSTORAGE STATE MANAGEMENT, PERIOD INFERENCE & MIGRATION
// ============================================================================
const LS_KEYS = {
  RULES: "sabino_spur_2026_vendor_rules_v1",
  SPLIT_TEMPLATES: "sabino_spur_2026_split_templates_v1",
  SNAPSHOTS: "sabino_spur_2026_snapshots_v1",
  ACTIVE_ID: "sabino_spur_2026_active_id_v1",
  WORKING_DRAFT: "sabino_spur_2026_working_draft_v1",
  MOM_OVERRIDES: "sabino_spur_2026_mom_overrides_v1"
};

let customRules = {};
let splitTemplates = {};
let savedSnapshots = {};
let momSlotOverrides = {}; // "YYYY-MM" -> snapshotId
let activeReport = null;
let expandedAccounts = new Set();

let activeSplitParentId = null;
let splitDraftRows = [];

function migrateLegacyCode(code) {
  if (code === "4020" || code === "4030") return "4010";
  if (code === "6030") return "6020";
  if (code === "6120") return "6110";
  if (code === "7110") return "7480";
  if (code === "7120") return "7460";
  if (code === "7240") return "7470";
  if (code === "8030" || code === "8050") return "8020";
  return code;
}

function inferPeriodFromText(text, fallbackIso) {
  const s = String(text || "").toLowerCase();
  const isoMatch = s.match(/(20\d{2})[-_/](0[1-9]|1[0-2])/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;

  const monthMap = {
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06",
    jul: "07", july: "07", aug: "08", august: "08", sep: "09", sept: "09", september: "09",
    oct: "10", october: "10", nov: "11", november: "11", dec: "12", december: "12"
  };
  const nameMatch = s.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b[\s_-]*(20\d{2})?/);
  if (nameMatch) {
    const mm = monthMap[nameMatch[1]];
    let yyyy = nameMatch[2];
    if (!yyyy) {
      const mNum = Number(mm);
      yyyy = (mNum === 1 || mNum === 2) ? "2027" : "2026";
    }
    return `${yyyy}-${mm}`;
  }
  if (fallbackIso && /^\d{4}-\d{2}/.test(fallbackIso)) return fallbackIso.slice(0, 7);
  return "2026-10";
}

function sanitizeReport(rep) {
  if (!rep || !Array.isArray(rep.items)) return rep;
  if (!rep.period || !/^\d{4}-\d{2}$/.test(rep.period)) {
    rep.period = inferPeriodFromText(rep.name, rep.savedAt);
  }
  if (rep.pilotMode === undefined) rep.pilotMode = false;
  if (rep.pilotTurnoverExVat === undefined) rep.pilotTurnoverExVat = 0;
  if (rep.pilotCogsExVat === undefined) rep.pilotCogsExVat = 0;

  rep.items.forEach(item => {
    item.code = migrateLegacyCode(item.code);
    const vKey = normKey(item.vendor);
    if ((vKey === "easishoppe" || vKey === "easi shoppe") && !customRules[vKey] && item.code === "5010") {
      item.code = "7220";
      item.note = DEFAULT_VENDOR_RULES["easishoppe"].note;
    }
    if (vKey === "spurfound donations ftf" && !customRules[vKey] && item.code === "7480") {
      item.code = "7490";
      item.note = DEFAULT_VENDOR_RULES["spurfound donations ftf"].note;
    }
    if (!ACCOUNT_MAP[item.code]) {
      item.code = "7480";
    }
  });
  return rep;
}

function loadStorage() {
  try {
    const r = localStorage.getItem(LS_KEYS.RULES);
    if (r) {
      customRules = JSON.parse(r);
      Object.keys(customRules).forEach(k => {
        if (customRules[k] && customRules[k].code) {
          customRules[k].code = migrateLegacyCode(customRules[k].code);
        }
      });
    }
  } catch (e) { console.warn("Failed reading rules", e); }

  try {
    const t = localStorage.getItem(LS_KEYS.SPLIT_TEMPLATES);
    if (t) {
      splitTemplates = JSON.parse(t);
      Object.values(splitTemplates).forEach(tpl => {
        if (tpl && Array.isArray(tpl.rows)) {
          tpl.rows.forEach(row => { row.code = migrateLegacyCode(row.code); });
        }
      });
    }
  } catch (e) { console.warn("Failed reading templates", e); }

  try {
    const s = localStorage.getItem(LS_KEYS.SNAPSHOTS);
    if (s) {
      savedSnapshots = JSON.parse(s);
      Object.keys(savedSnapshots).forEach(id => sanitizeReport(savedSnapshots[id]));
    }
  } catch (e) { console.warn("Failed reading snapshots", e); }

  try {
    const m = localStorage.getItem(LS_KEYS.MOM_OVERRIDES);
    if (m) momSlotOverrides = JSON.parse(m);
  } catch (e) { console.warn("Failed reading MoM overrides", e); }
}

function persistRules() {
  try {
    localStorage.setItem(LS_KEYS.RULES, JSON.stringify(customRules));
    updateRuleBadge();
  } catch (e) { showToast("Warning: Could not write rules to localStorage"); }
}

function persistSplitTemplates() {
  try {
    localStorage.setItem(LS_KEYS.SPLIT_TEMPLATES, JSON.stringify(splitTemplates));
    updateRuleBadge();
  } catch (e) { showToast("Warning: Could not write templates to localStorage"); }
}

function persistSnapshots() {
  try {
    localStorage.setItem(LS_KEYS.SNAPSHOTS, JSON.stringify(savedSnapshots));
    if (activeReport && activeReport.id) {
      localStorage.setItem(LS_KEYS.ACTIVE_ID, activeReport.id);
    }
    renderSnapshotDropdown();
  } catch (e) { showToast("Warning: Could not write snapshot to localStorage"); }
}

function persistMomOverrides() {
  try {
    localStorage.setItem(LS_KEYS.MOM_OVERRIDES, JSON.stringify(momSlotOverrides));
  } catch (e) { console.warn("Failed saving MoM overrides", e); }
}

function autoSaveActiveState() {
  if (!activeReport) return;
  try {
    localStorage.setItem(LS_KEYS.WORKING_DRAFT, JSON.stringify(activeReport));
    if (activeReport.id && savedSnapshots[activeReport.id]) {
      savedSnapshots[activeReport.id] = JSON.parse(JSON.stringify(activeReport));
      localStorage.setItem(LS_KEYS.SNAPSHOTS, JSON.stringify(savedSnapshots));
    }
  } catch (e) { console.warn("Could not auto-save working draft", e); }
}

function normKey(str) {
  return String(str || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeHtml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return String(str || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function findTemplateForVendor(vendorName) {
  const key = normKey(vendorName);
  if (!key) return null;
  return Object.values(splitTemplates).find(t => t && t.vendorKey && normKey(t.vendorKey) === key) || null;
}

function computeRowsFromTemplate(tpl, parentVendor, parentAmount) {
  const rows = tpl.rows || [];
  if (rows.length === 0) return [];
  const pAmt = Number(parentAmount || 0);

  if (tpl.mode === "PCT") {
    let running = 0;
    return rows.map((r, i) => {
      let amt = 0;
      if (i === rows.length - 1) {
        amt = Math.round((pAmt - running) * 100) / 100;
      } else {
        amt = Math.round((pAmt * (Number(r.pct || 0) / 100)) * 100) / 100;
        running = Math.round((running + amt) * 100) / 100;
      }
      const desc = r.suffix ? `${parentVendor} — ${r.suffix}` : parentVendor;
      return { vendor: desc, amount: amt, code: migrateLegacyCode(r.code) };
    });
  } else {
    return rows.map(r => {
      const amt = Math.round(Number(r.amount || 0) * 100) / 100;
      const desc = r.suffix ? `${parentVendor} — ${r.suffix}` : parentVendor;
      return { vendor: desc, amount: amt, code: migrateLegacyCode(r.code) };
    });
  }
}

// ============================================================================
// 4. INTELLIGENT SIDE-BY-SIDE MANAGEMENT REPORT PARSER (CSV & XLSX)
// ============================================================================
function resolveVendorCode(vendorName, origSection) {
  const key = normKey(vendorName);
  if (customRules[key]) {
    return { code: migrateLegacyCode(customRules[key].code), note: customRules[key].note || "Mapped via saved browser rule", auto: true };
  }
  if (DEFAULT_VENDOR_RULES[key]) {
    return { code: DEFAULT_VENDOR_RULES[key].code, note: DEFAULT_VENDOR_RULES[key].note, auto: true };
  }
  if (/vat|sars/i.test(key)) return { code: "BS-VAT", note: "Auto-matched SARS/VAT keyword (verify Balance Sheet treatment)", auto: false };
  if (/donation|charity|spurfound|full tummy/i.test(key)) return { code: "7490", note: "Auto-matched charity / donation keyword (Non-VAT; verify Section 18A certificate)", auto: false };
  if (/rent|lease|landlord/i.test(key)) return { code: "8010", note: "Auto-matched lease/rent keyword – verify store rental invoice", auto: false };
  if (/eskom|electric/i.test(key)) return { code: "7210", note: "Auto-matched electricity keyword", auto: false };
  if (/water|munic|refuse|sewer/i.test(key)) return { code: "7230", note: "Auto-matched municipal water/refuse keyword", auto: false };
  if (/gas|afrox|affrox|easishop/i.test(key)) return { code: "7220", note: "Auto-matched LP gas keyword", auto: false };
  if (/diesel|fuel|engen|shell|bp|caltex|sasol/i.test(key)) return { code: "7470", note: "Auto-matched fuel/diesel keyword", auto: false };
  if (/yoco|speedpoint|merchant/i.test(key)) return { code: "7460", note: "Auto-matched merchant card / bank fee keyword", auto: false };
  if (/uif|sdl/i.test(key)) return { code: "6110", note: "Auto-matched statutory payroll levy", auto: false };
  if (/salary|salaries/i.test(key)) return { code: "6010", note: "Auto-matched management salary keyword", auto: false };
  if (/wage|labour|payroll/i.test(key)) return { code: "6020", note: "Auto-matched FOH/BOH wages keyword", auto: false };
  if (/interest/i.test(key)) return { code: "8610", note: "Auto-matched finance interest keyword", auto: false };
  if (/insurance|momentum|sanlam|old mutual|santam|outsurance/i.test(key)) return { code: "8040", note: "Auto-matched insurance keyword", auto: false };
  if (/telkom|vodacom|mtn|afrihost|fibre|wifi/i.test(key)) return { code: "7420", note: "Auto-matched telecoms/Wi-Fi keyword", auto: false };
  if (/liquor|sab|distell|heineken/i.test(key)) return { code: "5030", note: "Auto-matched alcoholic beverage supplier", auto: false };

  if (origSection === "Income") return { code: "4050", note: "Needs Review: New Income line – verify POS vs EFT", auto: false };
  if (origSection === "COGS")   return { code: "5010", note: "Needs Review: New COGS supplier – verify Food vs Beverage", auto: false };
  if (origSection === "Labour") return { code: "6020", note: "Needs Review: New Labour line – verify Wages vs Management", auto: false };
  return { code: "7480", note: "Needs Review: Unrecognized vendor – assign exact 2026 GL code", auto: false };
}

function classifyStatus(origSection, code, autoMatched, isVarianceRow) {
  if (isVarianceRow) return "Audit Flag – Unreconciled Variance";
  if (code === "EXCLUDE") return "Excluded – Non-P&L Item";
  if (code && code.startsWith("BS-")) return "Excluded – Balance Sheet";
  const acc = ACCOUNT_MAP[code];
  if (!acc) return "Needs Review – Unmapped";

  const expectedSectionByGroup = {
    "Revenue": ["Income"],
    "COGS": ["COGS"],
    "Labour": ["Labour"],
    "Controllable OpEx": ["OPEX"],
    "Occupancy & Fixed": ["Debit Orders"],
    "Below-the-Line": ["NonOPEX"]
  };
  const expected = expectedSectionByGroup[acc.group] || [];
  const movedAcross = !expected.includes(origSection);

  if (!autoMatched) return "Needs Review – New Vendor";
  if (movedAcross) return "Reclassified Across Sections";
  return "Retained in Category";
}

function parse2DGridToReport(grid, reportName) {
  if (!grid || grid.length < 2) throw new Error("Uploaded file appears empty.");

  let headerRowIdx = 0;
  for (let r = 0; r < Math.min(10, grid.length); r++) {
    const rowStr = grid[r].map(c => String(c || "").trim().toLowerCase()).join("|");
    if (rowStr.includes("income") && (rowStr.includes("cogs") || rowStr.includes("opex"))) {
      headerRowIdx = r;
      break;
    }
  }

  const headerRow = grid[headerRowIdx];
  const targetSections = ["Income", "COGS", "OPEX", "NonOPEX", "Labour", "Debit Orders"];
  const sectionCols = [];

  headerRow.forEach((cellVal, cIdx) => {
    const clean = String(cellVal || "").trim();
    const match = targetSections.find(s => s.toLowerCase() === clean.toLowerCase());
    if (match) {
      sectionCols.push({ name: match, labelCol: cIdx, valCol: cIdx + 1 });
    }
  });

  if (sectionCols.length === 0) {
    throw new Error("Could not find standard columns (Income, COGS, OPEX, NonOPEX, Labour, Debit Orders) in the uploaded file.");
  }

  const rawSectionTotals = {};
  const extractedItems = [];
  let seq = 1;

  sectionCols.forEach(sec => {
    const secItems = [];
    let reportedTotal = null;

    for (let r = headerRowIdx + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const rawLbl = String(row[sec.labelCol] !== undefined && row[sec.labelCol] !== null ? row[sec.labelCol] : "").trim();
      const rawValCell = row[sec.valCol];
      let numVal = NaN;
      if (typeof rawValCell === "number") {
        numVal = rawValCell;
      } else if (rawValCell !== undefined && rawValCell !== null && String(rawValCell).trim() !== "") {
        const cleanedNum = String(rawValCell).replace(/[^0-9.-]/g, "");
        if (cleanedNum !== "" && !isNaN(Number(cleanedNum))) {
          numVal = Number(cleanedNum);
        }
      }

      if ((rawLbl === "" || /^total/i.test(rawLbl)) && !isNaN(numVal) && secItems.length > 0 && reportedTotal === null) {
        const currentSum = secItems.reduce((a, b) => a + b.amount, 0);
        if (Math.abs(numVal) > 2 || currentSum <= 2) {
          reportedTotal = Math.round(numVal * 100) / 100;
          break;
        }
      }

      if (rawLbl !== "" && !isNaN(numVal)) {
        secItems.push({
          csvRow: r + 1,
          vendor: rawLbl,
          amount: Math.round(numVal * 100) / 100
        });
      }
    }

    const sumExtracted = Math.round(secItems.reduce((a, b) => a + b.amount, 0) * 100) / 100;
    rawSectionTotals[sec.name] = reportedTotal !== null ? reportedTotal : sumExtracted;

    secItems.forEach(item => {
      const boundTpl = findTemplateForVendor(item.vendor);
      if (boundTpl && boundTpl.autoApplyOnUpload && Array.isArray(boundTpl.rows) && boundTpl.rows.length > 0) {
        const baseId = `AUD-${String(seq++).padStart(3, "0")}`;
        const splitLines = computeRowsFromTemplate(boundTpl, item.vendor, item.amount);
        const allocSum = Math.round(splitLines.reduce((s, r) => s + r.amount, 0) * 100) / 100;
        const rem = Math.round((item.amount - allocSum) * 100) / 100;

        splitLines.forEach((sr, i) => {
          const suffix = String.fromCharCode(97 + i);
          const acc = ACCOUNT_MAP[sr.code];
          extractedItems.push({
            id: `${baseId}${suffix}`,
            origSection: sec.name,
            csvRow: item.csvRow,
            vendor: sr.vendor,
            amount: sr.amount,
            originalAmount: i === 0 ? Math.round((sr.amount + rem) * 100) / 100 : sr.amount,
            code: sr.code,
            note: `Auto-split via template "${boundTpl.name}" (Orig: ${fmtZar(item.amount)}) → ${sr.code} (${acc ? acc.name : sr.code})`,
            autoMatched: true,
            isVarianceRow: false,
            isSplitChild: true
          });
        });
      } else {
        const resolved = resolveVendorCode(item.vendor, sec.name);
        extractedItems.push({
          id: `AUD-${String(seq++).padStart(3, "0")}`,
          origSection: sec.name,
          csvRow: item.csvRow,
          vendor: item.vendor,
          amount: item.amount,
          originalAmount: item.amount,
          code: resolved.code,
          note: resolved.note,
          autoMatched: resolved.auto,
          isVarianceRow: false
        });
      }
    });

    if (reportedTotal !== null && Math.abs(reportedTotal - sumExtracted) >= 0.01) {
      const gap = Math.round((reportedTotal - sumExtracted) * 100) / 100;
      const defaultVarCode = sec.name === "Debit Orders" ? "8090" : (sec.name === "Income" ? "4050" : "7480");
      extractedItems.push({
        id: `AUD-${String(seq++).padStart(3, "0")}`,
        origSection: sec.name,
        csvRow: "TOTAL",
        vendor: `Unreconciled ${sec.name} Variance (Report Total Gap)`,
        amount: gap,
        originalAmount: gap,
        code: defaultVarCode,
        note: `CRITICAL: Reported ${sec.name} total (R ${reportedTotal.toFixed(2)}) differs from listed items (R ${sumExtracted.toFixed(2)}) by R ${gap.toFixed(2)}`,
        autoMatched: true,
        isVarianceRow: true
      });
    }
  });

  const nowIso = new Date().toISOString();
  const prevPilotMode = activeReport ? Boolean(activeReport.pilotMode) : false;

  return {
    id: "rep_" + Date.now(),
    name: reportName,
    period: inferPeriodFromText(reportName, nowIso),
    savedAt: nowIso,
    pilotMode: prevPilotMode,
    pilotTurnoverExVat: 0,
    pilotCogsExVat: 0,
    rawSectionTotals,
    items: extractedItems
  };
}

// ============================================================================
// 5. FINANCIAL COMPUTATION ENGINE (SUPPORTS PILOT POS EX-VAT OVERRIDE)
// ============================================================================
function isItemAmountEdited(item) {
  if (item.originalAmount === undefined) item.originalAmount = item.amount;
  return Math.abs(item.amount - item.originalAmount) >= 0.005;
}

function isItemSuppressedByPilot(rep, item) {
  if (!rep || !rep.pilotMode) return false;
  if (item.origSection === "Income") return true;
  if (item.origSection === "COGS" && item.code !== "7220") return true;
  const acc = ACCOUNT_MAP[item.code];
  if (acc && acc.sec === "COGS") return true;
  return false;
}

function computeFinancialsForReport(rep, vatModeOverride) {
  if (!rep) return null;
  const vatMode = vatModeOverride || document.getElementById("vatModeSelect").value;
  const pilotActive = Boolean(rep.pilotMode);
  const pilotTurnover = Number(rep.pilotTurnoverExVat || 0);
  const pilotCogs = Number(rep.pilotCogsExVat || 0);

  const accTotals = {};
  const accCounts = {};
  const accVendors = {};

  COA.forEach(row => {
    if (row.code) {
      accTotals[row.code] = 0;
      accCounts[row.code] = 0;
      accVendors[row.code] = [];
    }
  });

  let rawInflows = 0;
  let rawOutflows = 0;
  let flaggedCount = 0;
  let editedCount = 0;
  let excludedNetCashAdj = 0;
  let pilotSuppressedIncome = 0;
  let pilotSuppressedCogs = 0;

  rep.items.forEach(item => {
    if (isItemAmountEdited(item)) editedCount++;
    const suppressed = isItemSuppressedByPilot(rep, item);
    const status = suppressed
      ? "Excluded – Replaced by Pilot POS"
      : classifyStatus(item.origSection, item.code, item.autoMatched, item.isVarianceRow);
    item._status = status;

    if (!suppressed && (status.includes("Audit Flag") || status.includes("Needs Review"))) {
      flaggedCount++;
    }

    if (item.origSection === "Income") rawInflows += item.amount;
    else rawOutflows += item.amount;

    if (suppressed) {
      if (item.origSection === "Income") {
        pilotSuppressedIncome += item.amount;
        excludedNetCashAdj += item.amount;
      } else {
        pilotSuppressedCogs += item.amount;
        excludedNetCashAdj -= item.amount;
      }
      accTotals["EXCLUDE"] += item.amount;
      accCounts["EXCLUDE"] += 1;
      accVendors["EXCLUDE"].push({
        id: item.id,
        vendor: `[CSV Replaced by Pilot] ${item.vendor}`,
        amount: item.amount,
        origSection: item.origSection,
        code: "EXCLUDE"
      });
      return;
    }

    const acc = ACCOUNT_MAP[item.code];
    let effectiveAmt = item.amount;
    if (vatMode === "EXCL" && acc && acc.vatable) {
      effectiveAmt = item.amount / 1.15;
    }

    if (item.code === "EXCLUDE") {
      if (item.origSection === "Income") excludedNetCashAdj += effectiveAmt;
      else excludedNetCashAdj -= effectiveAmt;
    }

    if (accTotals[item.code] !== undefined) {
      accTotals[item.code] += effectiveAmt;
      accCounts[item.code] += 1;
      accVendors[item.code].push({
        id: item.id,
        vendor: item.vendor,
        amount: effectiveAmt,
        origSection: item.origSection,
        code: item.code
      });
    }
  });

  // Inject Pilot POS Turnover (Excl. VAT) & Cost of Sales (Excl. VAT) at face value (no 1.15 division)
  if (pilotActive) {
    accTotals["4010"] += pilotTurnover;
    accCounts["4010"] += 1;
    accVendors["4010"].unshift({
      id: "PILOT-REV",
      vendor: "Pilot POS Turnover (Excl. VAT)",
      amount: pilotTurnover,
      origSection: "Pilot POS",
      code: "4010"
    });

    accTotals["5010"] += pilotCogs;
    accCounts["5010"] += 1;
    accVendors["5010"].unshift({
      id: "PILOT-COGS",
      vendor: "Pilot POS Cost of Sales (Excl. VAT)",
      amount: pilotCogs,
      origSection: "Pilot POS",
      code: "5010"
    });
  }

  const sumSec = (secName) => COA.filter(r => r.sec === secName && r.code).reduce((s, r) => s + (accTotals[r.code] || 0), 0);

  const netTurnover = sumSec("REV");
  const totalCogs = sumSec("COGS");
  const grossProfit = netTurnover - totalCogs;
  const totalLabour = sumSec("LAB");
  const primeCost = totalCogs + totalLabour;
  const totalOpex = sumSec("OPEX");
  const controllableProfit = grossProfit - totalLabour - totalOpex;
  const totalOccupancy = sumSec("OCC");
  const ebitda = controllableProfit - totalOccupancy;
  const totalBelow = sumSec("BELOW");
  const netProfitBeforeTax = ebitda - totalBelow;
  const bsVat = accTotals["BS-VAT"] || 0;
  const bsCap = accTotals["BS-CAP"] || 0;
  const bsExcl = accTotals["EXCLUDE"] || 0;
  const netCashSurplus = pilotActive
    ? (rawInflows - rawOutflows)
    : (netProfitBeforeTax - bsVat - bsCap + excludedNetCashAdj);

  const expectedRawIn = (rep.rawSectionTotals && rep.rawSectionTotals["Income"]) || 0;
  const expectedRawOut = ["COGS", "OPEX", "NonOPEX", "Labour", "Debit Orders"].reduce((s, k) => s + ((rep.rawSectionTotals && rep.rawSectionTotals[k]) || 0), 0);
  const reconDiff = Math.round(((rawInflows - expectedRawIn) - (rawOutflows - expectedRawOut)) * 100) / 100;

  return {
    vatMode,
    pilotActive,
    pilotTurnover,
    pilotCogs,
    pilotSuppressedIncome,
    pilotSuppressedCogs,
    accTotals,
    accCounts,
    accVendors,
    netTurnover,
    totalCogs,
    grossProfit,
    totalLabour,
    primeCost,
    totalOpex,
    controllableProfit,
    totalOccupancy,
    ebitda,
    totalBelow,
    netProfitBeforeTax,
    bsVat,
    bsCap,
    bsExcl,
    excludedNetCashAdj,
    netCashSurplus,
    rawInflows,
    rawOutflows,
    reconDiff,
    flaggedCount,
    editedCount
  };
}

function computeFinancials() {
  return computeFinancialsForReport(activeReport);
}

function fmtZar(val) {
  const n = Number(val || 0);
  const abs = Math.abs(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(R ${abs})` : `R ${abs}`;
}

function fmtPct(val, base) {
  if (!base || Math.abs(base) < 0.0001) return "0.0%";
  return ((val / base) * 100).toFixed(1) + "%";
}
