// ============================================================================
// 8. MONTH-OVER-MONTH (FY MAR – FEB) ENGINE & SPUR PEGASUS EXCEL EXPORT
// ============================================================================
const MOM_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatShortYm(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || "";
  const [yyyy, mm] = ym.split("-");
  const mIdx = Number(mm) - 1;
  return `${MOM_MONTH_NAMES[mIdx] || mm} ${yyyy.slice(2)}`;
}

function getFyStartYearForYm(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    const now = new Date();
    return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
  }
  const [yyyy, mm] = ym.split("-").map(Number);
  return mm >= 3 ? yyyy : yyyy - 1;
}

function buildFyDefinition(startYear) {
  const months = [];
  for (let i = 0; i < 12; i++) {
    const m = ((2 + i) % 12) + 1;
    const y = startYear + (2 + i >= 12 ? 1 : 0);
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return {
    startYear,
    value: String(startYear),
    label: `FY ${startYear}/${startYear + 1} (Mar ${startYear} – Feb ${startYear + 1})`,
    months
  };
}

function ensureMomFyOptions() {
  const sel = document.getElementById("momFySelect");
  const years = new Set();
  if (activeReport && activeReport.period) years.add(getFyStartYearForYm(activeReport.period));
  Object.values(savedSnapshots || {}).forEach(s => {
    if (s && s.period) years.add(getFyStartYearForYm(s.period));
  });
  Object.keys(momSlotOverrides || {}).forEach(ym => {
    years.add(getFyStartYearForYm(ym));
  });
  if (years.size === 0) years.add(getFyStartYearForYm(""));

  const sortedYears = Array.from(years).sort((a, b) => b - a);
  const currentVal = sel ? sel.value : "";

  if (sel) {
    sel.innerHTML = sortedYears
      .map(y => {
        const def = buildFyDefinition(y);
        return `<option value="${def.value}">${escapeHtml(def.label)}</option>`;
      })
      .join("");
    if (currentVal && sortedYears.includes(Number(currentVal))) {
      sel.value = currentVal;
    } else if (activeReport && activeReport.period) {
      sel.value = String(getFyStartYearForYm(activeReport.period));
    }
  }

  const chosenYear = sel && sel.value ? Number(sel.value) : sortedYears[0];
  return buildFyDefinition(chosenYear);
}

function computeFinForSpecificReport(rep) {
  if (!rep) return null;
  if (typeof computeFinancialsForReport === "function") {
    return computeFinancialsForReport(rep);
  }
  const prevReport = activeReport;
  try {
    activeReport = rep;
    return computeFinancials();
  } finally {
    activeReport = prevReport;
  }
}

function buildMomColumns(fyDef) {
  const monthFins = {};
  const snapList = Object.values(savedSnapshots || {});

  fyDef.months.forEach(ym => {
    let chosenRep = null;
    let sourceLabel = "";
    const overrideId = (momSlotOverrides || {})[ym];

    if (overrideId === "__NONE__") {
      chosenRep = null;
    } else if (overrideId === "__ACTIVE__" && activeReport) {
      chosenRep = activeReport;
      sourceLabel = activeReport.name;
    } else if (overrideId && savedSnapshots[overrideId]) {
      chosenRep = savedSnapshots[overrideId];
      sourceLabel = chosenRep.name;
    } else if (activeReport && activeReport.period === ym) {
      chosenRep = activeReport;
      sourceLabel = activeReport.name;
    } else {
      const match = snapList.find(s => s && s.period === ym);
      if (match) {
        chosenRep = match;
        sourceLabel = match.name;
      }
    }

    if (chosenRep) {
      const sanitized = sanitizeReport(JSON.parse(JSON.stringify(chosenRep)));
      const fin = computeFinForSpecificReport(sanitized);
      if (fin) {
        monthFins[ym] = { report: sanitized, fin, sourceLabel };
      }
    }
  });

  const cols = [];
  fyDef.months.forEach((ym, idx) => {
    cols.push({
      type: "MONTH",
      ym,
      label: formatShortYm(ym),
      entry: monthFins[ym] || null
    });
    if (idx > 0) {
      const prevYm = fyDef.months[idx - 1];
      cols.push({
        type: "VAR",
        label: `${formatShortYm(ym)} vs ${formatShortYm(prevYm)}`,
        currEntry: monthFins[ym] || null,
        prevEntry: monthFins[prevYm] || null
      });
    }
  });

  return { cols, monthFins };
}

function getMetricValueFromFin(fin, row) {
  if (!fin || !row) return 0;
  if (row.code) return Number(fin.accTotals[row.code] || 0);
  const map = {
    NET_TURNOVER: fin.netTurnover,
    TOTAL_COGS: fin.totalCogs,
    GROSS_PROFIT: fin.grossProfit,
    TOTAL_LABOUR: fin.totalLabour,
    PRIME_COST: fin.primeCost,
    TOTAL_OPEX: fin.totalOpex,
    CONTROLLABLE_PROFIT: fin.controllableProfit,
    TOTAL_OCCUPANCY: fin.totalOccupancy,
    EBITDA: fin.ebitda,
    TOTAL_BELOW: fin.totalBelow,
    NET_PROFIT: fin.netProfitBeforeTax,
    NET_CASH: fin.netCashSurplus
  };
  return Number(map[row.key] || 0);
}

function renderMomTab() {
  const fyDef = ensureMomFyOptions();
  const { cols, monthFins } = buildMomColumns(fyDef);
  const detailMode = (document.getElementById("momDetailSelect") || {}).value || "DETAILED";
  const showPct = Boolean((document.getElementById("chkMomShowPct") || {}).checked);
  const pilotToggled = Boolean(
    (activeReport && activeReport.pilotMode) ||
    fyDef.months.some(ym => monthFins[ym] && monthFins[ym].fin && monthFins[ym].fin.pilotActive)
  );

  // Render optional month-slot assignment cards if present in index.html
  const slotContainer = document.getElementById("momSlotsGrid") || document.getElementById("momSlotAssignment");
  if (slotContainer) {
    const snapOptions = Object.values(savedSnapshots || {});
    slotContainer.innerHTML = fyDef.months.map(ym => {
      const entry = monthFins[ym];
      const curOverride = (momSlotOverrides || {})[ym] || "";
      let opts = `<option value="">Auto-Match (${entry ? escapeHtml(entry.sourceLabel) : "Empty"})</option>`;
      if (activeReport) {
        opts += `<option value="__ACTIVE__" ${curOverride === "__ACTIVE__" ? "selected" : ""}>Active: ${escapeHtml(activeReport.name)}</option>`;
      }
      snapOptions.forEach(s => {
        opts += `<option value="${escapeHtml(s.id)}" ${curOverride === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`;
      });
      opts += `<option value="__NONE__" ${curOverride === "__NONE__" ? "selected" : ""}>— Leave Empty —</option>`;

      return `<div class="mom-slot-card ${entry ? "filled" : ""}">
        <div class="mom-slot-hdr"><strong>${escapeHtml(formatShortYm(ym))}</strong><span>${entry ? "Loaded" : "Empty"}</span></div>
        <select class="mom-slot-select" data-ym="${ym}">${opts}</select>
      </div>`;
    }).join("");

    slotContainer.querySelectorAll(".mom-slot-select").forEach(sel => {
      sel.addEventListener("change", (e) => {
        const ym = e.target.dataset.ym;
        const val = e.target.value;
        if (!val) delete momSlotOverrides[ym];
        else momSlotOverrides[ym] = val;
        if (typeof persistMomOverrides === "function") persistMomOverrides();
        renderMomTab();
      });
    });
  }

  const thead = document.getElementById("momTableHead");
  const tbody = document.getElementById("momTableBody");
  if (!thead || !tbody) return;

  let thHtml = `<tr><th style="min-width:250px;">2026 Spur Account / Category</th>`;
  cols.forEach(c => {
    thHtml += `<th class="num">${escapeHtml(c.label)}</th>`;
  });
  thHtml += `<th class="num">FY YTD</th></tr>`;
  thead.innerHTML = thHtml;

  let tbHtml = "";
  COA.forEach(row => {
    if (typeof isNonPnlSectionRow === "function" && isNonPnlSectionRow(row)) return;
    if (row.type === "HEADER") {
      tbHtml += `<tr class="sec-row"><td colspan="${cols.length + 2}">${escapeHtml(row.label)}</td></tr>`;
      return;
    }
    if (row.code && detailMode === "SUMMARY") return;
    if (row.code) {
      if (pilotToggled && (row.sec === "REV" || row.sec === "COGS") && row.code !== "4010" && row.code !== "5010") {
        return;
      }
      const isPilotCore = pilotToggled && (row.code === "4010" || row.code === "5010");
      const anyNonZero = fyDef.months.some(ym => {
        const e = monthFins[ym];
        return e && Math.abs(e.fin.accTotals[row.code] || 0) >= 0.005;
      });
      if (!isPilotCore && !anyNonZero) return;
    }

    const rowCls = row.type === "FINAL" ? "final-row" : (row.type === "KPI" ? "kpi-row" : (row.type === "SUBTOTAL" ? "sub-row" : ""));
    const labelHtml = row.code
      ? `<span class="gl-pill">${escapeHtml(row.code)}</span> ${escapeHtml(row.name)}`
      : escapeHtml(row.label);

    let rHtml = `<tr class="${rowCls}"><td>${labelHtml}</td>`;
    let ytd = 0;
    let ytdRev = 0;

    cols.forEach(col => {
      if (col.type === "MONTH") {
        if (!col.entry) {
          rHtml += `<td class="num muted">&mdash;</td>`;
        } else {
          const val = getMetricValueFromFin(col.entry.fin, row);
          ytd += val;
          ytdRev += col.entry.fin.netTurnover || 0;
          const pctSub = showPct && col.entry.fin.netTurnover
            ? `<div class="sub-pct">${fmtPct(val, col.entry.fin.netTurnover)}</div>`
            : "";
          rHtml += `<td class="num">${fmtZar(val)}${pctSub}</td>`;
        }
      } else {
        if (!col.currEntry || !col.prevEntry) {
          rHtml += `<td class="num muted">&mdash;</td>`;
        } else {
          const diff = getMetricValueFromFin(col.currEntry.fin, row) - getMetricValueFromFin(col.prevEntry.fin, row);
          const sign = diff > 0.004 ? "+" : "";
          rHtml += `<td class="num">${sign}${fmtZar(diff)}</td>`;
        }
      }
    });

    const ytdPctSub = showPct && ytdRev ? `<div class="sub-pct">${fmtPct(ytd, ytdRev)}</div>` : "";
    rHtml += `<td class="num"><strong>${fmtZar(ytd)}</strong>${ytdPctSub}</td></tr>`;
    tbHtml += rHtml;
  });

  tbody.innerHTML = tbHtml;
}

// ============================================================================
// MONTH-OVER-MONTH EXCEL (.XLSX) EXPORT — SPUR PEGASUS STYLED
// (No Header Subline, No GL Code Column, No MoM Variance Columns, Pilot-Clean)
// ============================================================================
function excelColLetter(zeroBasedIdx) {
  let s = "";
  let n = zeroBasedIdx;
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function exportMomWorkbook() {
  if (typeof XLSX === "undefined") {
    alert("Excel export requires internet connection to load the spreadsheet library.");
    return;
  }

  const fyDef = ensureMomFyOptions();
  const { cols, monthFins } = buildMomColumns(fyDef);
  const monthCols = cols.filter(c => c.type === "MONTH");
  const detailMode = (document.getElementById("momDetailSelect") || {}).value || "DETAILED";
  const pilotToggled = Boolean(
    (activeReport && activeReport.pilotMode) ||
    fyDef.months.some(ym => monthFins[ym] && monthFins[ym].fin && monthFins[ym].fin.pilotActive)
  );

  // Fallback styles in case PEGASUS_XLSX_STYLES is unavailable
  const S = (typeof PEGASUS_XLSX_STYLES !== "undefined") ? PEGASUS_XLSX_STYLES : {
    title: { fill: { patternType: "solid", fgColor: { rgb: "1B365D" } }, font: { bold: true, color: { rgb: "FFFFFF" }, sz: 13 } },
    thLeft: { fill: { patternType: "solid", fgColor: { rgb: "C8102E" } }, font: { bold: true, color: { rgb: "FFFFFF" } } },
    thRight: { fill: { patternType: "solid", fgColor: { rgb: "C8102E" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "right" } },
    secHeader: { fill: { patternType: "solid", fgColor: { rgb: "1B365D" } }, font: { bold: true, color: { rgb: "FFFFFF" } } },
    rowEvenLeft: { fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } } },
    rowEvenRight: { fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } }, alignment: { horizontal: "right" } },
    rowOddLeft: { fill: { patternType: "solid", fgColor: { rgb: "F8FAFC" } } },
    rowOddRight: { fill: { patternType: "solid", fgColor: { rgb: "F8FAFC" } }, alignment: { horizontal: "right" } },
    subtotalLeft: { fill: { patternType: "solid", fgColor: { rgb: "E6ECF5" } }, font: { bold: true, color: { rgb: "1B365D" } } },
    subtotalRight: { fill: { patternType: "solid", fgColor: { rgb: "E6ECF5" } }, font: { bold: true, color: { rgb: "1B365D" } }, alignment: { horizontal: "right" } },
    kpiLeft: { fill: { patternType: "solid", fgColor: { rgb: "FEF3C7" } }, font: { bold: true, color: { rgb: "78350F" } } },
    kpiRight: { fill: { patternType: "solid", fgColor: { rgb: "FEF3C7" } }, font: { bold: true, color: { rgb: "78350F" } }, alignment: { horizontal: "right" } },
    finalLeft: { fill: { patternType: "solid", fgColor: { rgb: "C8102E" } }, font: { bold: true, color: { rgb: "FFFFFF" } } },
    finalRight: { fill: { patternType: "solid", fgColor: { rgb: "C8102E" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "right" } }
  };

  const totalColsCount = 1 + monthCols.length + 1; // Account/Category + 12 Months + FY YTD
  const allColLetters = [];
  for (let c = 0; c < totalColsCount; c++) allColLetters.push(excelColLetter(c));

  const firstMonthCol = excelColLetter(1); // B
  const lastMonthCol = excelColLetter(monthCols.length); // M
  const ytdCol = excelColLetter(totalColsCount - 1); // N

  // Row 1: Spur Pegasus Title Banner (Header Subline removed per user request)
  const titleRow = [`Sabino Canyon Spur - Month-over-Month Income Statement (${fyDef.label})`];
  while (titleRow.length < totalColsCount) titleRow.push("");

  // Row 2: Clean Spacer Row
  const spacerRow = new Array(totalColsCount).fill("");

  // Row 3: Table Column Headers (No GL code column, no MoM variance columns)
  const headerRow = ["Account / Category", ...monthCols.map(c => c.label), "FY YTD"];

  const aoa = [titleRow, spacerRow, headerRow];
  const exportRowsMeta = [];
  const rowIndexMap = {};
  const secRowBounds = {};
  let rNum = 4;

  COA.forEach(row => {
    if (typeof isNonPnlSectionRow === "function" && isNonPnlSectionRow(row)) return;
    if (row.type === "HEADER") {
      const cleanCat = typeof stripCategoryCodeRange === "function"
        ? stripCategoryCodeRange(row.label)
        : String(row.label || "").replace(/\s*\(\d{4}\s*[–-]\s*\d{4}\)\s*$/g, "").trim();
      const rArr = [cleanCat];
      while (rArr.length < totalColsCount) rArr.push("");
      aoa.push(rArr);
      rowIndexMap[row.label] = rNum;
      exportRowsMeta.push({ row, rNum, kind: "HEADER" });
      rNum++;
      return;
    }

    if (row.code && detailMode === "SUMMARY") return;
    if (row.code) {
      if (pilotToggled && (row.sec === "REV" || row.sec === "COGS") && row.code !== "4010" && row.code !== "5010") {
        return;
      }
      const isPilotCore = pilotToggled && (row.code === "4010" || row.code === "5010");
      const anyNonZero = fyDef.months.some(ym => {
        const e = monthFins[ym];
        return e && Math.abs(e.fin.accTotals[row.code] || 0) >= 0.005;
      });
      if (!isPilotCore && !anyNonZero) return;

      rowIndexMap[row.code] = rNum;
      if (!secRowBounds[row.sec]) secRowBounds[row.sec] = { first: rNum, last: rNum };
      secRowBounds[row.sec].last = rNum;

      const rArr = [row.name];
      while (rArr.length < totalColsCount) rArr.push(0);
      aoa.push(rArr);
      exportRowsMeta.push({ row, rNum, kind: "DETAIL" });
      rNum++;
    } else if (row.key) {
      rowIndexMap[row.key] = rNum;
      const rArr = [row.label];
      while (rArr.length < totalColsCount) rArr.push(0);
      aoa.push(rArr);
      const kind = row.type === "FINAL" ? "FINAL" : (row.type === "KPI" ? "KPI" : "SUB");
      exportRowsMeta.push({ row, rNum, kind });
      rNum++;
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalColsCount - 1 } }];

  // Style Title Banner & Column Headers
  allColLetters.forEach((colL, cIdx) => {
    const tAddr = `${colL}1`;
    if (!ws[tAddr]) ws[tAddr] = { t: "s", v: "" };
    ws[tAddr].s = S.title;

    const hAddr = `${colL}3`;
    if (!ws[hAddr]) ws[hAddr] = { t: "s", v: "" };
    ws[hAddr].s = cIdx === 0 ? S.thLeft : S.thRight;
  });

  const rowHeights = [{ hpt: 28 }, { hpt: 10 }, { hpt: 24 }];
  let detailStripe = 0;

  exportRowsMeta.forEach(({ row, rNum: r, kind }) => {
    if (kind === "HEADER") {
      allColLetters.forEach(colL => {
        const addr = `${colL}${r}`;
        if (!ws[addr]) ws[addr] = { t: "s", v: "" };
        ws[addr].s = S.secHeader;
      });
      rowHeights.push({ hpt: 22 });
      detailStripe = 0;
      return;
    }

    if (kind === "DETAIL") {
      const isEven = detailStripe++ % 2 === 0;
      const stL = isEven ? S.rowEvenLeft : S.rowOddLeft;
      const stR = isEven ? S.rowEvenRight : S.rowOddRight;
      ws[`A${r}`].s = stL;

      let ytdSum = 0;
      monthCols.forEach((col, mIdx) => {
        const colL = excelColLetter(1 + mIdx);
        const val = col.entry ? Number(getMetricValueFromFin(col.entry.fin, row).toFixed(2)) : 0;
        ytdSum += val;
        ws[`${colL}${r}`] = { t: "n", v: val, z: '"R "#,##0.00', s: stR };
      });

      ws[`${ytdCol}${r}`] = {
        t: "n",
        f: `SUM(${firstMonthCol}${r}:${lastMonthCol}${r})`,
        v: Number(ytdSum.toFixed(2)),
        z: '"R "#,##0.00',
        s: stR
      };
      rowHeights.push({ hpt: 19 });
      return;
    }

    // Subtotals, KPIs & Final Profit
    const stL = kind === "FINAL" ? S.finalLeft : (kind === "KPI" ? S.kpiLeft : S.subtotalLeft);
    const stR = kind === "FINAL" ? S.finalRight : (kind === "KPI" ? S.kpiRight : S.subtotalRight);
    ws[`A${r}`].s = stL;

    let ytdVal = 0;
    monthCols.forEach((col, mIdx) => {
      const colL = excelColLetter(1 + mIdx);
      const numVal = col.entry ? Number(getMetricValueFromFin(col.entry.fin, row).toFixed(2)) : 0;
      ytdVal += numVal;

      let formulaStr = null;
      if (row.sec) {
        const b = secRowBounds[row.sec];
        if (b) formulaStr = `SUM(${colL}${b.first}:${colL}${b.last})`;
      } else if (row.key === "GROSS_PROFIT") {
        formulaStr = `${colL}${rowIndexMap["NET_TURNOVER"]}-${colL}${rowIndexMap["TOTAL_COGS"]}`;
      } else if (row.key === "PRIME_COST") {
        formulaStr = `${colL}${rowIndexMap["TOTAL_COGS"]}+${colL}${rowIndexMap["TOTAL_LABOUR"]}`;
      } else if (row.key === "CONTROLLABLE_PROFIT") {
        formulaStr = `${colL}${rowIndexMap["GROSS_PROFIT"]}-${colL}${rowIndexMap["TOTAL_LABOUR"]}-${colL}${rowIndexMap["TOTAL_OPEX"]}`;
      } else if (row.key === "EBITDA") {
        formulaStr = `${colL}${rowIndexMap["CONTROLLABLE_PROFIT"]}-${colL}${rowIndexMap["TOTAL_OCCUPANCY"]}`;
      } else if (row.key === "NET_PROFIT") {
        formulaStr = `${colL}${rowIndexMap["EBITDA"]}-${colL}${rowIndexMap["TOTAL_BELOW"]}`;
      }

      if (formulaStr) {
        ws[`${colL}${r}`] = { t: "n", f: formulaStr, v: numVal, z: '"R "#,##0.00', s: stR };
      } else {
        ws[`${colL}${r}`] = { t: "n", v: numVal, z: '"R "#,##0.00', s: stR };
      }
    });

    ws[`${ytdCol}${r}`] = {
      t: "n",
      f: `SUM(${firstMonthCol}${r}:${lastMonthCol}${r})`,
      v: Number(ytdVal.toFixed(2)),
      z: '"R "#,##0.00',
      s: stR
    };
    rowHeights.push({ hpt: kind === "FINAL" ? 24 : 21 });
  });

  ws["!rows"] = rowHeights;
  const colWidths = [{ wch: 48 }];
  for (let i = 0; i < monthCols.length; i++) colWidths.push({ wch: 15 });
  colWidths.push({ wch: 17 });
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Month_over_Month_PnL");
  const outName = `Sabino_Canyon_Spur_MoM_PnL_FY${fyDef.startYear}_${fyDef.startYear + 1}.xlsx`;
  XLSX.writeFile(wb, outName);
  showToast(`Exported Spur Pegasus MoM Excel Workbook: ${outName}`);
}
