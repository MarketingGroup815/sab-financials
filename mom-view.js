// ============================================================================
// 8. MONTH-OVER-MONTH P&L COMPARISON ENGINE (OCT–FEB CLOSE & MAR–FEB 12M FY)
// ============================================================================
const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatYmShort(ym) {
  const [y, m] = ym.split("-");
  const idx = Math.max(0, Math.min(11, Number(m) - 1));
  return `${MONTH_NAMES_SHORT[idx]} ${y}`;
}

function buildMarToFebMonths(startYear) {
  const list = [];
  for (let m = 3; m <= 12; m++) {
    list.push(`${startYear}-${String(m).padStart(2, "0")}`);
  }
  list.push(`${startYear + 1}-01`);
  list.push(`${startYear + 1}-02`);
  return list;
}

function getFinancialYearDefinitions() {
  const defs = [
    {
      id: "FY26_CLOSE",
      label: "FY 2026/2027 Closing Window (Oct 2026 – Feb 2027 • 5 Months)",
      banner: "FY 2026/2027 Closing Window (Oct 2026 – Feb 2027) — Financial Year-End: 28 Feb 2027",
      months: ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]
    },
    {
      id: "FY27_28",
      label: "FY 2027/2028 Full Year (Mar 2027 – Feb 2028 • 12 Months)",
      banner: "FY 2027/2028 New Financial Year (Mar 2027 – Feb 2028 • 12-Month Rolling Comparison)",
      months: buildMarToFebMonths(2027)
    },
    {
      id: "FY28_29",
      label: "FY 2028/2029 Full Year (Mar 2028 – Feb 2029 • 12 Months)",
      banner: "FY 2028/2029 Financial Year (Mar 2028 – Feb 2029 • 12-Month Rolling Comparison)",
      months: buildMarToFebMonths(2028)
    }
  ];

  // Auto-add any future March–Feb FY if snapshots exist beyond Feb 2029
  const extraStartYears = new Set();
  const checkPeriod = (p) => {
    if (!p || !/^\d{4}-\d{2}$/.test(p)) return;
    const [yStr, mStr] = p.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const fyStart = m >= 3 ? y : y - 1;
    if (fyStart >= 2029) extraStartYears.add(fyStart);
  };
  if (activeReport) checkPeriod(activeReport.period);
  Object.values(savedSnapshots).forEach(s => checkPeriod(s.period));

  Array.from(extraStartYears).sort().forEach(yr => {
    defs.push({
      id: `FY_${yr}_${yr + 1}`,
      label: `FY ${yr}/${yr + 1} Full Year (Mar ${yr} – Feb ${yr + 1} • 12 Months)`,
      banner: `FY ${yr}/${yr + 1} Financial Year (Mar ${yr} – Feb ${yr + 1} • 12-Month Rolling Comparison)`,
      months: buildMarToFebMonths(yr)
    });
  });

  return defs;
}

function ensureMomFyOptions() {
  const sel = document.getElementById("momFySelect");
  if (!sel) return null;
  const defs = getFinancialYearDefinitions();
  const prevChoice = sel.value;

  sel.innerHTML = defs.map(d => `<option value="${d.id}">${escapeHtml(d.label)}</option>`).join("");

  if (prevChoice && defs.some(d => d.id === prevChoice)) {
    sel.value = prevChoice;
  } else if (activeReport && activeReport.period) {
    const match = defs.find(d => d.months.includes(activeReport.period));
    sel.value = match ? match.id : defs[0].id;
  } else {
    sel.value = defs[0].id;
  }
  return defs.find(d => d.id === sel.value) || defs[0];
}

function resolveReportForMonth(ym) {
  const overrideId = momSlotOverrides[ym];
  if (overrideId === "__NONE__") return null;
  if (overrideId) {
    if (activeReport && activeReport.id === overrideId) return activeReport;
    if (savedSnapshots[overrideId]) return savedSnapshots[overrideId];
  }
  if (activeReport && activeReport.period === ym) {
    return activeReport;
  }
  const matches = Object.values(savedSnapshots)
    .filter(s => s && s.period === ym)
    .sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
  return matches[0] || null;
}

window.onAssignMomSlot = function(ym, selectedId) {
  if (!selectedId) {
    momSlotOverrides[ym] = "__NONE__";
  } else {
    momSlotOverrides[ym] = selectedId;
  }
  persistMomOverrides();
  renderMomTab();
  showToast(`Updated ${formatYmShort(ym)} comparison slot`);
};

function getMetricValueFromFin(fin, row) {
  if (!fin) return 0;
  if (row.code) return fin.accTotals[row.code] || 0;
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
  return map[row.key] || 0;
}

function isFavorableVariance(row, diff) {
  if (Math.abs(diff) < 0.005) return null;
  const positiveGoodKeys = new Set(["NET_TURNOVER", "GROSS_PROFIT", "CONTROLLABLE_PROFIT", "EBITDA", "NET_PROFIT", "NET_CASH"]);
  if (row.code) {
    if (row.code === "4900") return diff < 0; // Discounts: lower is better
    if (row.sec === "REV") return diff > 0;
    return diff < 0; // Expenses & COGS: lower is better
  }
  if (positiveGoodKeys.has(row.key)) return diff > 0;
  return diff < 0;
}

function buildMomColumns(fyDef) {
  const cols = [];
  const monthFins = {};
  fyDef.months.forEach(ym => {
    const rep = resolveReportForMonth(ym);
    monthFins[ym] = rep ? { rep, fin: computeFinancialsForReport(rep) } : null;
  });

  fyDef.months.forEach((ym, idx) => {
    cols.push({ type: "MONTH", ym, label: formatYmShort(ym), entry: monthFins[ym] });
    if (idx > 0) {
      const prevYm = fyDef.months[idx - 1];
      cols.push({
        type: "VAR",
        ym,
        prevYm,
        label: `${MONTH_NAMES_SHORT[Number(ym.split("-")[1]) - 1]} vs ${MONTH_NAMES_SHORT[Number(prevYm.split("-")[1]) - 1]}`,
        currEntry: monthFins[ym],
        prevEntry: monthFins[prevYm]
      });
    }
  });

  return { cols, monthFins };
}

function renderMomTab() {
  const thead = document.getElementById("momTableHead");
  const tbody = document.getElementById("momTableBody");
  if (!thead || !tbody) return;

  const fyDef = ensureMomFyOptions();
  if (!fyDef) return;

  document.getElementById("momWindowBanner").textContent = fyDef.banner;
  const detailMode = document.getElementById("momDetailSelect").value;
  const showPct = document.getElementById("chkMomShowPct").checked;
  const { cols, monthFins } = buildMomColumns(fyDef);

  const allSnapList = Object.values(savedSnapshots).sort((a, b) => (a.period || "").localeCompare(b.period || ""));

  // Build Header Row
  let headHtml = `<tr><th class="mom-sticky-col">GL / 2026 Spur Account Name</th>`;
  cols.forEach(col => {
    if (col.type === "MONTH") {
      const currentRep = col.entry ? col.entry.rep : null;
      const activeMatchesSlot = activeReport && activeReport.period === col.ym && (!currentRep || currentRep.id === activeReport.id);

      let opts = `<option value="">-- Empty --</option>`;
      if (activeReport && !savedSnapshots[activeReport.id]) {
        const selAttr = currentRep && currentRep.id === activeReport.id ? "selected" : "";
        opts += `<option value="${escapeAttr(activeReport.id)}" ${selAttr}>Active: ${escapeHtml(activeReport.name)}</option>`;
      }
      allSnapList.forEach(s => {
        const selAttr = currentRep && currentRep.id === s.id ? "selected" : "";
        opts += `<option value="${escapeAttr(s.id)}" ${selAttr}>${escapeHtml(s.name)}</option>`;
      });

      const statusTag = currentRep
        ? (activeMatchesSlot && !savedSnapshots[activeReport.id] ? " (Unsaved Active)" : "")
        : "";

      headHtml += `<th class="num" style="min-width:155px;">
        <div>${escapeHtml(col.label)}${statusTag}</div>
        <select class="mom-hdr-select" title="Assign saved snapshot to ${escapeAttr(col.label)}" onchange="onAssignMomSlot('${col.ym}', this.value)">
          ${opts}
        </select>
      </th>`;
    } else {
      headHtml += `<th class="num" style="min-width:130px;background:#0f172a;color:#94a3b8;">
        <div>${escapeHtml(col.label)}</div>
        <div style="font-size:9.5px;font-weight:500;color:var(--text-muted);margin-top:4px;">MoM Change (ZAR / %)</div>
      </th>`;
    }
  });
  headHtml += `<th class="num" style="min-width:165px;border-left:2px solid var(--accent-gold);">FY YTD Total</th></tr>`;
  thead.innerHTML = headHtml;

  // Build Body Rows
  let bodyHtml = "";
  const totalColsCount = cols.length + 2;

  COA.forEach(row => {
    if (row.type === "HEADER") {
      bodyHtml += `<tr class="sec-header"><td class="mom-sticky-col">${escapeHtml(row.label)}</td><td colspan="${totalColsCount - 1}"></td></tr>`;
      return;
    }

    if (row.code && detailMode === "SUMMARY") return;

    // In FULL mode, hide GL accounts that are R 0.00 across every populated month in this FY
    if (row.code) {
      const anyNonZero = fyDef.months.some(ym => {
        const e = monthFins[ym];
        return e && Math.abs(e.fin.accTotals[row.code] || 0) >= 0.005;
      });
      if (!anyNonZero) return;
    }

    const rowCls = row.type === "FINAL" || row.type === "CASH"
      ? "final-row"
      : (row.type === "KPI" ? "kpi-row" : (row.type === "SUBTOTAL" ? "subtotal-row" : ""));

    const labelHtml = row.code
      ? `<span class="code-badge" style="margin-right:6px;">${row.code}</span><span style="font-weight:600;">${escapeHtml(row.name)}</span>`
      : escapeHtml(row.label);

    let rowHtml = `<tr class="${rowCls}"><td class="mom-sticky-col">${labelHtml}</td>`;

    let ytdSum = 0;
    let ytdTurnover = 0;

    cols.forEach(col => {
      if (col.type === "MONTH") {
        if (!col.entry) {
          rowHtml += `<td class="num" style="color:var(--text-muted);">&mdash;</td>`;
        } else {
          const val = getMetricValueFromFin(col.entry.fin, row);
          const turn = col.entry.fin.netTurnover || 0;
          ytdSum += val;
          ytdTurnover += turn;
          const pctSub = showPct ? `<span class="mom-cell-sub">${fmtPct(val, turn)}</span>` : "";
          rowHtml += `<td class="num">${fmtZar(val)}${pctSub}</td>`;
        }
      } else {
        if (!col.currEntry || !col.prevEntry) {
          rowHtml += `<td class="num" style="color:var(--text-muted);background:rgba(15,23,42,0.45);">&mdash;</td>`;
        } else {
          const currVal = getMetricValueFromFin(col.currEntry.fin, row);
          const prevVal = getMetricValueFromFin(col.prevEntry.fin, row);
          const diff = currVal - prevVal;
          const fav = isFavorableVariance(row, diff);
          const vCls = fav === null ? "" : (fav ? "var-good" : "var-bad");
          const sign = diff > 0.004 ? "+" : "";
          const pctDiff = Math.abs(prevVal) >= 0.01 ? `${sign}${((diff / Math.abs(prevVal)) * 100).toFixed(1)}%` : "n/a";
          rowHtml += `<td class="num ${vCls}" style="background:rgba(15,23,42,0.45);">
            ${sign}${fmtZar(diff)}
            <span class="mom-cell-sub">${pctDiff}</span>
          </td>`;
        }
      }
    });

    const ytdPctSub = showPct ? `<span class="mom-cell-sub">${fmtPct(ytdSum, ytdTurnover)}</span>` : "";
    rowHtml += `<td class="num" style="border-left:2px solid var(--accent-gold);font-weight:700;">${fmtZar(ytdSum)}${ytdPctSub}</td></tr>`;
    bodyHtml += rowHtml;
  });

  tbody.innerHTML = bodyHtml;
}

function exportMomWorkbook() {
  const fyDef = ensureMomFyOptions();
  if (!fyDef) return;
  if (typeof XLSX === "undefined") {
    alert("Excel export requires internet connection to load SheetJS.");
    return;
  }

  const { cols, monthFins } = buildMomColumns(fyDef);
  const wb = XLSX.utils.book_new();

  const headerRow = ["GL Code", "2026 Spur Account Name", "P&L Classification"];
  cols.forEach(c => headerRow.push(c.type === "MONTH" ? c.label : `${c.label} (Var)`));
  headerRow.push("FY YTD Total (ZAR)");

  const aoa = [
    [`SABINO CANYON SPUR — MONTH-OVER-MONTH P&L COMPARISON (${fyDef.label})`],
    ["Generated from Sabino Canyon Spur 2026 USAR Mapper"],
    [],
    headerRow
  ];

  COA.forEach(row => {
    if (row.type === "HEADER") {
      aoa.push(["", row.label, ""]);
      return;
    }
    const line = [row.code || "", row.code ? row.name : row.label, row.group || "Summary"];
    let ytd = 0;

    cols.forEach(col => {
      if (col.type === "MONTH") {
        if (!col.entry) {
          line.push(0);
        } else {
          const val = Number(getMetricValueFromFin(col.entry.fin, row).toFixed(2));
          ytd += val;
          line.push(val);
        }
      } else {
        if (!col.currEntry || !col.prevEntry) {
          line.push(0);
        } else {
          const diff = getMetricValueFromFin(col.currEntry.fin, row) - getMetricValueFromFin(col.prevEntry.fin, row);
          line.push(Number(diff.toFixed(2)));
        }
      }
    });

    line.push(Number(ytd.toFixed(2)));
    aoa.push(line);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 11 }, { wch: 46 }, { wch: 22 }, ...cols.map(() => ({ wch: 18 })), { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, "Month_over_Month_PnL");

  const safeFy = fyDef.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const outName = `Sabino_Canyon_Spur_MoM_PnL_${safeFy}.xlsx`;
  XLSX.writeFile(wb, outName);
  showToast(`Exported Month-over-Month Workbook: ${outName}`);
}
