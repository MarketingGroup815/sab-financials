// ============================================================================
// 9. NATIVE 3-TAB FORMULA EXCEL (.XLSX) & PDF REPORT EXPORT ENGINE
// ============================================================================
function isNonPnlSectionRow(row) {
  if (!row) return false;
  if (row.sec === "BS" || row.type === "CASH" || row.key === "NET_CASH") return true;
  if (row.code === "EXCLUDE" || (row.code && row.code.startsWith("BS-"))) return true;
  if (row.type === "HEADER" && /BALANCE SHEET|EXCLUDED ITEMS/i.test(row.label || "")) return true;
  return false;
}

function buildExportAuditRows(fin) {
  const rows = [];
  activeReport.items.forEach(item => {
    const suppressed = typeof isItemSuppressedByPilot === "function" && isItemSuppressedByPilot(activeReport, item);
    const effCode = suppressed ? "EXCLUDE" : item.code;
    const acc = ACCOUNT_MAP[effCode];
    const effAmt = (!suppressed && fin.vatMode === "EXCL" && acc && acc.vatable)
      ? Number((item.amount / 1.15).toFixed(2))
      : item.amount;
    const statusText = suppressed ? "Excluded – Replaced by Pilot POS" : item._status;
    const noteText = suppressed
      ? `Replaced by Pilot POS ${item.origSection === "Income" ? "Turnover (Excl. VAT)" : "Cost of Sales (Excl. VAT)"} — ${item.note}`
      : item.note;

    rows.push({
      id: item.id,
      origSection: item.origSection,
      csvRow: item.csvRow,
      vendor: item.vendor,
      amount: effAmt,
      code: effCode,
      accName: acc ? acc.name : "UNMAPPED",
      accGroup: acc ? acc.group : "CHECK",
      status: statusText,
      note: noteText
    });
  });

  if (fin.pilotActive) {
    const accRev = ACCOUNT_MAP["4010"];
    const accCogs = ACCOUNT_MAP["5010"];
    rows.push({
      id: "PILOT-REV",
      origSection: "Pilot POS",
      csvRow: "PILOT",
      vendor: "Pilot POS Turnover (Excl. VAT)",
      amount: Number(fin.pilotTurnover.toFixed(2)),
      code: "4010",
      accName: accRev ? accRev.name : "Food & Beverage Sales (POS)",
      accGroup: accRev ? accRev.group : "Revenue",
      status: "Pilot POS Override (Excl. VAT)",
      note: "Authoritative Pilot POS Turnover Excl. VAT (replaces cashbook Income rows)"
    });
    rows.push({
      id: "PILOT-COGS",
      origSection: "Pilot POS",
      csvRow: "PILOT",
      vendor: "Pilot POS Cost of Sales (Excl. VAT)",
      amount: Number(fin.pilotCogs.toFixed(2)),
      code: "5010",
      accName: accCogs ? accCogs.name : "Cost of Sales - Food (Proteins, Dry & Groceries)",
      accGroup: accCogs ? accCogs.group : "COGS",
      status: "Pilot POS Override (Excl. VAT)",
      note: "Authoritative Pilot POS Cost of Sales Excl. VAT (replaces cashbook COGS rows)"
    });
  }

  return rows;
}

function exportThreeTabWorkbook() {
  const fin = computeFinancials();
  if (!fin) return;

  if (typeof XLSX === "undefined") {
    showToast("Offline fallback: Downloading CSV summary...");
    exportOfflineCsv(fin);
    return;
  }

  const wb = XLSX.utils.book_new();
  const exportAuditRows = buildExportAuditRows(fin);
  const auditCount = exportAuditRows.length;
  const audStart = 5;
  const audEnd = audStart + auditCount - 1;

  // Exclude Section 7 (Balance Sheet & Excluded Items) and R 0.00 GL accounts from downloaded P&L
  const activePnlRows = COA.filter(item => {
    if (isNonPnlSectionRow(item)) return false;
    if (!item.code) return true;
    const amt = fin.accTotals[item.code] || 0;
    const cnt = fin.accCounts[item.code] || 0;
    return Math.abs(amt) >= 0.005 || cnt > 0;
  });

  const basisLabel = fin.pilotActive
    ? `Pilot POS Turnover & COGS (Excl. VAT) + Cashbook Expenses (${fin.vatMode === "EXCL" ? "15% VAT Stripped" : "Incl. 15% VAT"})`
    : (fin.vatMode === "EXCL" ? "VAT-Exclusive (15% Stripped)" : "Cashbook / VAT-Inclusive");

  // TAB 1: 2026_Income_Statement (4 Columns: Account Name, Classification, Amount, % Turnover)
  const wsPnlData = [
    ["SABINO CANYON SPUR — 2026 INCOME STATEMENT (USAR STANDARD)"],
    [`Source: ${activeReport.name} | Period: ${activeReport.period || "N/A"} | Basis: ${basisLabel}`],
    [],
    ["2026 Spur Account Name", "P&L Classification", "Amount (ZAR)", "% of Turnover"]
  ];

  const rowIndexMap = {};
  const secRowBounds = {};
  let rNum = 5;

  activePnlRows.forEach(item => {
    if (item.type === "HEADER") {
      wsPnlData.push([item.label, "", "", ""]);
      rowIndexMap[item.label] = rNum++;
    } else if (item.code) {
      rowIndexMap[item.code] = rNum;
      if (!secRowBounds[item.sec]) secRowBounds[item.sec] = { first: rNum, last: rNum };
      secRowBounds[item.sec].last = rNum;
      wsPnlData.push([item.name, item.group, 0, 0]);
      rNum++;
    } else {
      rowIndexMap[item.key] = rNum;
      wsPnlData.push([item.label, item.type === "CASH" ? "Cash Reconciliation" : "P&L Summary", 0, 0]);
      rNum++;
    }
  });

  const wsPnl = XLSX.utils.aoa_to_sheet(wsPnlData);
  const netRevRow = rowIndexMap["NET_TURNOVER"];

  activePnlRows.forEach(item => {
    if (item.code) {
      const r = rowIndexMap[item.code];
      const valAmt = Number((fin.accTotals[item.code] || 0).toFixed(2));
      const valPct = fin.netTurnover ? valAmt / fin.netTurnover : 0;

      wsPnl[`C${r}`] = {
        t: "n",
        f: `SUMIFS('Vendor_Mapping_Audit'!$E$${audStart}:$E$${audEnd},'Vendor_Mapping_Audit'!$F$${audStart}:$F$${audEnd},"${item.code}")`,
        v: valAmt,
        z: '"R "#,##0.00'
      };
      wsPnl[`D${r}`] = {
        t: "n",
        f: `IFERROR(C${r}/$C$${netRevRow},0)`,
        v: valPct,
        z: "0.0%"
      };
    } else if (item.key) {
      const r = rowIndexMap[item.key];
      const setSub = (formulaStr, numVal) => {
        wsPnl[`C${r}`] = { t: "n", f: formulaStr, v: Number(numVal.toFixed(2)), z: '"R "#,##0.00' };
        wsPnl[`D${r}`] = { t: "n", f: `IFERROR(C${r}/$C$${netRevRow},0)`, v: fin.netTurnover ? numVal / fin.netTurnover : 0, z: "0.0%" };
      };

      if (item.sec) {
        const b = secRowBounds[item.sec];
        const secTotMap = {
          NET_TURNOVER: fin.netTurnover,
          TOTAL_COGS: fin.totalCogs,
          TOTAL_LABOUR: fin.totalLabour,
          TOTAL_OPEX: fin.totalOpex,
          TOTAL_OCCUPANCY: fin.totalOccupancy,
          TOTAL_BELOW: fin.totalBelow
        };
        if (b) {
          setSub(`SUM(C${b.first}:C${b.last})`, secTotMap[item.key] || 0);
        } else {
          wsPnl[`C${r}`] = { t: "n", v: 0, z: '"R "#,##0.00' };
          wsPnl[`D${r}`] = { t: "n", f: `IFERROR(C${r}/$C$${netRevRow},0)`, v: 0, z: "0.0%" };
        }
      } else if (item.key === "GROSS_PROFIT") {
        setSub(`C${netRevRow}-C${rowIndexMap["TOTAL_COGS"]}`, fin.grossProfit);
      } else if (item.key === "PRIME_COST") {
        setSub(`C${rowIndexMap["TOTAL_COGS"]}+C${rowIndexMap["TOTAL_LABOUR"]}`, fin.primeCost);
      } else if (item.key === "CONTROLLABLE_PROFIT") {
        setSub(`C${rowIndexMap["GROSS_PROFIT"]}-C${rowIndexMap["TOTAL_LABOUR"]}-C${rowIndexMap["TOTAL_OPEX"]}`, fin.controllableProfit);
      } else if (item.key === "EBITDA") {
        setSub(`C${rowIndexMap["CONTROLLABLE_PROFIT"]}-C${rowIndexMap["TOTAL_OCCUPANCY"]}`, fin.ebitda);
      } else if (item.key === "NET_PROFIT") {
        setSub(`C${rowIndexMap["EBITDA"]}-C${rowIndexMap["TOTAL_BELOW"]}`, fin.netProfitBeforeTax);
      }
    }
  });

  wsPnl["!cols"] = [{ wch: 52 }, { wch: 24 }, { wch: 18 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsPnl, "2026_Income_Statement");

  // TAB 2: Vendor_Mapping_Audit
  const wsAudData = [
    ["SABINO CANYON SPUR — VENDOR & TRANSACTION MAPPING AUDIT TRAIL"],
    ["CSV Inflows:", 0, "CSV Outflows:", 0, "Cashbook Surplus:", 0, "Unmapped:", 0, "Status:", ""],
    [],
    ["Audit ID", "Source Section", "Row", "Vendor / Transaction Description", "Amount (ZAR)", "Mapped 2026 Code", "Mapped 2026 Account Name", "P&L Classification", "Reclassification Status", "Audit & Compliance Notes"]
  ];

  exportAuditRows.forEach(r => {
    wsAudData.push([
      r.id, r.origSection, r.csvRow, r.vendor, r.amount,
      r.code, r.accName, r.accGroup, r.status, r.note
    ]);
  });

  const audTotRow = audEnd + 1;
  wsAudData.push(["TOTAL", "", "", `All ${auditCount} Audit & Override Lines`, 0, "", "", "", "", ""]);

  const wsAud = XLSX.utils.aoa_to_sheet(wsAudData);
  wsAud["B2"] = { t: "n", f: `SUMIF(B${audStart}:B${audEnd},"Income",E${audStart}:E${audEnd})`, v: Number(fin.rawInflows.toFixed(2)), z: '"R "#,##0.00' };
  wsAud["D2"] = { t: "n", f: `SUMIFS(E${audStart}:E${audEnd},B${audStart}:B${audEnd},"<>Income",B${audStart}:B${audEnd},"<>Pilot POS")`, v: Number(fin.rawOutflows.toFixed(2)), z: '"R "#,##0.00' };
  wsAud["F2"] = { t: "n", f: "B2-D2", v: Number(fin.netCashSurplus.toFixed(2)), z: '"R "#,##0.00' };
  wsAud["H2"] = { t: "n", f: `COUNTIF(G${audStart}:G${audEnd},"UNMAPPED")`, v: 0, z: "#,##0" };
  wsAud["J2"] = { t: "s", f: `IF(H2=0,"RECONCILED (0 UNMAPPED)","CHECK UNMAPPED")`, v: "RECONCILED (0 UNMAPPED)" };

  exportAuditRows.forEach((rowObj, idx) => {
    const r = audStart + idx;
    wsAud[`E${r}`] = { t: "n", v: rowObj.amount, z: '"R "#,##0.00' };
    wsAud[`G${r}`] = { t: "s", v: rowObj.accName };
    wsAud[`H${r}`] = { t: "s", v: rowObj.accGroup };
  });

  wsAud[`E${audTotRow}`] = {
    t: "n",
    f: `SUM(E${audStart}:E${audEnd})`,
    v: Number(exportAuditRows.reduce((s, r) => s + r.amount, 0).toFixed(2)),
    z: '"R "#,##0.00'
  };

  wsAud["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 9 }, { wch: 42 }, { wch: 16 }, { wch: 16 }, { wch: 44 }, { wch: 22 }, { wch: 30 }, { wch: 54 }];
  XLSX.utils.book_append_sheet(wb, wsAud, "Vendor_Mapping_Audit");

  // TAB 3: Raw_vs_2026_Comparison
  const wsCmpData = [
    ["SABINO CANYON SPUR — RAW REPORT vs. RECLASSIFIED 2026 P&L BRIDGE"],
    ["Cross-Sheet Reconciled Variance Summary"],
    [],
    ["P&L Category / Metric", "Raw Report (ZAR)", "Raw %", "Reclassified 2026 (ZAR)", "2026 %", "Variance (ZAR)", "Primary Structural Driver"],
    ["Net Turnover", 0, 0, 0, 0, 0, fin.pilotActive ? "Uses Pilot POS Turnover (Excl. VAT); cashbook Income rows suppressed" : "Top-line inflows (less any excluded revenue lines)"],
    ["Cost of Sales (COGS)", 0, 0, 0, 0, 0, fin.pilotActive ? "Uses Pilot POS Cost of Sales (Excl. VAT); EasiShoppe kept in LP Gas (7220)" : "Moves fresh produce (Market) & coffee beans into COGS; EasiShoppe moved to LP Gas"],
    ["GROSS PROFIT (GP)", 0, 0, 0, 0, 0, "True store-level food & beverage margin"],
    ["Labour & People Costs", 0, 0, 0, 0, 0, "Consolidates Staff Transport, Uber, Uniforms & LMS training (15% VAT retained)"],
    ["PRIME COST (COGS + LABOUR)", 0, 0, 0, 0, 0, "Core controllable restaurant benchmark"],
    ["Controllable Operating Expenses", 0, 0, 0, 0, 0, "Includes Royalties, Nat. Marketing, Charity (7490) & EasiShoppe LP Gas (15% VAT retained)"],
    ["Occupancy & Debit Orders", 0, 0, 0, 0, 0, "Store rental, commercial insurance & debit orders (15% VAT retained)"],
    ["EBITDA", 0, 0, 0, 0, 0, "True operating cash flow before interest, Balance Sheet VAT & Excluded items"],
    ["Non-OpEx / Finance Costs", 0, 0, 0, 0, 0, "Removes SARS VAT settlement & moves LSM/Maintenance to OpEx"],
    ["NET PROFIT BEFORE TAX (P&L)", 0, 0, 0, 0, 0, "True P&L profit once Pilot POS & Balance Sheet VAT adjustments are applied"],
    [fin.pilotActive ? "Suppressed CSV Income/COGS & Non-P&L" : "Balance Sheet VAT & Excluded Items", 0, 0, 0, 0, 0, fin.pilotActive ? "Cashbook Income & COGS replaced by Pilot POS, plus SARS VAT & CapEx outside P&L" : "SARS VAT liability, CapEx & items marked EXCLUDE outside P&L"],
    ["RECONCILED CASHBOOK SURPLUS", 0, 0, 0, 0, 0, "Exact cashbook surplus reconciliation to source report"]
  ];

  const wsCmp = XLSX.utils.aoa_to_sheet(wsCmpData);
  const raw = activeReport.rawSectionTotals;
  const rawRev = raw["Income"] || 0;
  const rawCogs = raw["COGS"] || 0;
  const rawGP = rawRev - rawCogs;
  const rawLab = raw["Labour"] || 0;
  const rawPrime = rawCogs + rawLab;
  const rawOpex = raw["OPEX"] || 0;
  const rawDebit = raw["Debit Orders"] || 0;
  const rawEbitda = rawGP - rawLab - rawOpex - rawDebit;
  const rawNonOp = raw["NonOPEX"] || 0;
  const rawNet = rawEbitda - rawNonOp;
  const totalNonPnl = fin.bsVat + fin.bsCap - fin.excludedNetCashAdj + (fin.pilotActive ? (fin.pilotTurnover - fin.pilotCogs) : 0);

  const bsAuditSum = `SUMIFS('Vendor_Mapping_Audit'!$E$${audStart}:$E$${audEnd},'Vendor_Mapping_Audit'!$F$${audStart}:$F$${audEnd},"BS-VAT")+SUMIFS('Vendor_Mapping_Audit'!$E$${audStart}:$E$${audEnd},'Vendor_Mapping_Audit'!$F$${audStart}:$F$${audEnd},"BS-CAP")+`;
  const pilotBridgeTerm = fin.pilotActive
    ? `+SUMIFS('Vendor_Mapping_Audit'!$E$${audStart}:$E$${audEnd},'Vendor_Mapping_Audit'!$B$${audStart}:$B$${audEnd},"Pilot POS",'Vendor_Mapping_Audit'!$F$${audStart}:$F$${audEnd},"4010")-SUMIFS('Vendor_Mapping_Audit'!$E$${audStart}:$E$${audEnd},'Vendor_Mapping_Audit'!$B$${audStart}:$B$${audEnd},"Pilot POS",'Vendor_Mapping_Audit'!$F$${audStart}:$F$${audEnd},"5010")`
    : "";
  const nonPnlFormula = `${bsAuditSum}SUMIFS('Vendor_Mapping_Audit'!$E$${audStart}:$E$${audEnd},'Vendor_Mapping_Audit'!$F$${audStart}:$F$${audEnd},"EXCLUDE",'Vendor_Mapping_Audit'!$B$${audStart}:$B$${audEnd},"<>Income")-SUMIFS('Vendor_Mapping_Audit'!$E$${audStart}:$E$${audEnd},'Vendor_Mapping_Audit'!$F$${audStart}:$F$${audEnd},"EXCLUDE",'Vendor_Mapping_Audit'!$B$${audStart}:$B$${audEnd},"Income")${pilotBridgeTerm}`;

  const cmpFormulas = [
    [5,  `SUMIF('Vendor_Mapping_Audit'!$B$${audStart}:$B$${audEnd},"Income",'Vendor_Mapping_Audit'!$E$${audStart}:$E$${audEnd})`, rawRev, `'2026_Income_Statement'!C${netRevRow}`, fin.netTurnover],
    [6,  `SUMIF('Vendor_Mapping_Audit'!$B$${audStart}:$B$${audEnd},"COGS",'Vendor_Mapping_Audit'!$E$${audStart}:$E$${audEnd})`, rawCogs, `'2026_Income_Statement'!C${rowIndexMap["TOTAL_COGS"]}`, fin.totalCogs],
    [7,  "B5-B6", rawGP, "D5-D6", fin.grossProfit],
    [8,  `SUMIF('Vendor_Mapping_Audit'!$B$${audStart}:$B$${audEnd},"Labour",'Vendor_Mapping_Audit'!$E$${audStart}:$E$${audEnd})`, rawLab, `'2026_Income_Statement'!C${rowIndexMap["TOTAL_LABOUR"]}`, fin.totalLabour],
    [9,  "B6+B8", rawPrime, "D6+D8", fin.primeCost],
    [10, `SUMIF('Vendor_Mapping_Audit'!$B$${audStart}:$B$${audEnd},"OPEX",'Vendor_Mapping_Audit'!$E$${audStart}:$E$${audEnd})`, rawOpex, `'2026_Income_Statement'!C${rowIndexMap["TOTAL_OPEX"]}`, fin.totalOpex],
    [11, `SUMIF('Vendor_Mapping_Audit'!$B$${audStart}:$B$${audEnd},"Debit Orders",'Vendor_Mapping_Audit'!$E$${audStart}:$E$${audEnd})`, rawDebit, `'2026_Income_Statement'!C${rowIndexMap["TOTAL_OCCUPANCY"]}`, fin.totalOccupancy],
    [12, "B7-B8-B10-B11", rawEbitda, "D7-D8-D10-D11", fin.ebitda],
    [13, `SUMIF('Vendor_Mapping_Audit'!$B$${audStart}:$B$${audEnd},"NonOPEX",'Vendor_Mapping_Audit'!$E$${audStart}:$E$${audEnd})`, rawNonOp, `'2026_Income_Statement'!C${rowIndexMap["TOTAL_BELOW"]}`, fin.totalBelow],
    [14, "B12-B13", rawNet, "D12-D13", fin.netProfitBeforeTax],
    [15, "0", 0, nonPnlFormula, totalNonPnl],
    [16, "B14-B15", rawNet, "D14-D15", fin.netCashSurplus]
  ];

  cmpFormulas.forEach(([r, fB, vB, fD, vD]) => {
    wsCmp[`B${r}`] = { t: "n", f: fB, v: Number(vB.toFixed(2)), z: '"R "#,##0.00' };
    wsCmp[`C${r}`] = { t: "n", f: `IFERROR(B${r}/$B$5,0)`, v: rawRev ? vB / rawRev : 0, z: "0.0%" };
    wsCmp[`D${r}`] = { t: "n", f: fD, v: Number(vD.toFixed(2)), z: '"R "#,##0.00' };
    wsCmp[`E${r}`] = { t: "n", f: `IFERROR(D${r}/$D$5,0)`, v: fin.netTurnover ? vD / fin.netTurnover : 0, z: "0.0%" };
    wsCmp[`F${r}`] = { t: "n", f: `D${r}-B${r}`, v: Number((vD - vB).toFixed(2)), z: '"R "#,##0.00' };
  });

  wsCmp["!cols"] = [{ wch: 36 }, { wch: 18 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 58 }];
  XLSX.utils.book_append_sheet(wb, wsCmp, "Raw_vs_2026_Comparison");

  const safeTitle = activeReport.name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");
  const outName = `Sabino_Canyon_Spur_2026_PnL_${safeTitle}.xlsx`;
  XLSX.writeFile(wb, outName);
  showToast(`Exported 3-Tab Excel Workbook: ${outName}`);
}

function exportOfflineCsv(fin) {
  let csvLines = ["2026 Spur Account Name,P&L Classification,Amount (ZAR),% Turnover"];
  COA.forEach(item => {
    if (isNonPnlSectionRow(item)) return;
    if (item.code) {
      const amt = fin.accTotals[item.code] || 0;
      if (Math.abs(amt) < 0.005) return;
      const pct = fin.netTurnover ? (amt / fin.netTurnover * 100).toFixed(1) + "%" : "0.0%";
      csvLines.push(`"${item.name}","${item.group}",${amt.toFixed(2)},"${pct}"`);
    }
  });
  downloadBlob(new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" }), "Sabino_Canyon_Spur_2026_PnL_Offline.csv");
}

// ============================================================================
// 10. CLEAN EXECUTIVE PDF EXPORT (SINGLE-MONTH P&L + MONTH-OVER-MONTH FY)
// ============================================================================
function exportStatementPdf(mode) {
  const fin = computeFinancials();
  if (!fin) return;

  const isMom = mode === "MOM";
  const win = window.open("", "_blank", "width=1120,height=820");
  if (!win) {
    alert("Pop-up blocked — please allow pop-ups for this site to generate the PDF.");
    return;
  }

  const taxLabel = fin.pilotActive
    ? `Pilot POS Turnover & COGS (Excl. VAT) + Cashbook Expenses (${fin.vatMode === "EXCL" ? "15% VAT Stripped" : "Incl. 15% VAT"})`
    : (fin.vatMode === "EXCL" ? "VAT-Exclusive (15% Stripped)" : "Cashbook / VAT-Inclusive");
  const generatedDate = new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" });

  let title = `Sabino Canyon Spur — 2026 USAR Income Statement`;
  let subtitle = `Report: ${escapeHtml(activeReport.name)} | Period: ${escapeHtml(activeReport.period || "N/A")} | Basis: ${taxLabel} | Generated: ${generatedDate}`;
  let tableHtml = "";

  if (!isMom) {
    const subValues = {
      NET_TURNOVER: fin.netTurnover, TOTAL_COGS: fin.totalCogs, GROSS_PROFIT: fin.grossProfit,
      TOTAL_LABOUR: fin.totalLabour, PRIME_COST: fin.primeCost, TOTAL_OPEX: fin.totalOpex,
      CONTROLLABLE_PROFIT: fin.controllableProfit, TOTAL_OCCUPANCY: fin.totalOccupancy,
      EBITDA: fin.ebitda, TOTAL_BELOW: fin.totalBelow, NET_PROFIT: fin.netProfitBeforeTax
    };
    let rowsHtml = "";
    COA.forEach(row => {
      if (isNonPnlSectionRow(row)) return;
      if (row.type === "HEADER") {
        rowsHtml += `<tr class="sec"><td colspan="4">${escapeHtml(row.label)}</td></tr>`;
      } else if (row.code) {
        const amt = fin.accTotals[row.code] || 0;
        const cnt = fin.accCounts[row.code] || 0;
        if (Math.abs(amt) < 0.005 && cnt === 0) return;
        rowsHtml += `<tr>
          <td class="mono">${escapeHtml(row.code)}</td>
          <td>${escapeHtml(row.name)}</td>
          <td class="num">${fmtZar(amt)}</td>
          <td class="num">${fmtPct(amt, fin.netTurnover)}</td>
        </tr>`;
      } else {
        const val = subValues[row.key] || 0;
        const cls = row.type === "FINAL" ? "final" : (row.type === "KPI" ? "kpi" : "sub");
        rowsHtml += `<tr class="${cls}">
          <td></td>
          <td>${escapeHtml(row.label)}</td>
          <td class="num">${fmtZar(val)}</td>
          <td class="num">${fmtPct(val, fin.netTurnover)}</td>
        </tr>`;
      }
    });
    tableHtml = `<table>
      <thead><tr><th style="width:70px;">GL Code</th><th>2026 Spur Account Name</th><th class="num" style="width:140px;">Amount (ZAR)</th><th class="num" style="width:95px;">% Turnover</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
  } else {
    const fyDef = ensureMomFyOptions();
    const { cols, monthFins } = buildMomColumns(fyDef);
    const detailMode = document.getElementById("momDetailSelect").value;
    title = `Sabino Canyon Spur — Month-over-Month P&L Comparison`;
    subtitle = `${escapeHtml(fyDef.label)} | Basis: ${taxLabel} | Generated: ${generatedDate}`;

    let thHtml = `<tr><th>GL / Account Name</th>`;
    cols.forEach(c => { thHtml += `<th class="num">${escapeHtml(c.label)}</th>`; });
    thHtml += `<th class="num">FY YTD</th></tr>`;

    let tbHtml = "";
    COA.forEach(row => {
      if (isNonPnlSectionRow(row)) return;
      if (row.type === "HEADER") {
        tbHtml += `<tr class="sec"><td colspan="${cols.length + 2}">${escapeHtml(row.label)}</td></tr>`;
        return;
      }
      if (row.code && detailMode === "SUMMARY") return;
      if (row.code) {
        const anyNonZero = fyDef.months.some(ym => {
          const e = monthFins[ym];
          return e && Math.abs(e.fin.accTotals[row.code] || 0) >= 0.005;
        });
        if (!anyNonZero) return;
      }
      const cls = row.type === "FINAL" ? "final" : (row.type === "KPI" ? "kpi" : (row.type === "SUBTOTAL" ? "sub" : ""));
      const lbl = row.code ? `${row.code} — ${escapeHtml(row.name)}` : escapeHtml(row.label);
      let rHtml = `<tr class="${cls}"><td>${lbl}</td>`;
      let ytd = 0;
      cols.forEach(col => {
        if (col.type === "MONTH") {
          if (!col.entry) { rHtml += `<td class="num">&mdash;</td>`; }
          else {
            const val = getMetricValueFromFin(col.entry.fin, row);
            ytd += val;
            rHtml += `<td class="num">${fmtZar(val)}</td>`;
          }
        } else {
          if (!col.currEntry || !col.prevEntry) { rHtml += `<td class="num">&mdash;</td>`; }
          else {
            const diff = getMetricValueFromFin(col.currEntry.fin, row) - getMetricValueFromFin(col.prevEntry.fin, row);
            const sign = diff > 0.004 ? "+" : "";
            rHtml += `<td class="num">${sign}${fmtZar(diff)}</td>`;
          }
        }
      });
      rHtml += `<td class="num"><strong>${fmtZar(ytd)}</strong></td></tr>`;
      tbHtml += rHtml;
    });

    tableHtml = `<table><thead>${thHtml}</thead><tbody>${tbHtml}</tbody></table>`;
  }

  const landscapeCss = isMom ? "@page { size: A4 landscape; margin: 10mm; }" : "@page { size: A4 portrait; margin: 12mm; }";
  win.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title>
    <style>
      ${landscapeCss}
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: ${isMom ? "8.5px" : "10px"}; margin: 0; }
      .hdr { border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end; }
      .hdr h1 { font-size: 15px; margin: 0 0 3px; }
      .hdr p { font-size: 10px; color: #475569; margin: 0; }
      .badge { background: #0f172a; color: #facc15; font-weight: 800; padding: 4px 8px; border-radius: 4px; font-size: 10px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #0f172a; color: #ffffff; text-align: left; padding: 5px 6px; font-size: ${isMom ? "8px" : "9.5px"}; }
      td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; }
      .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .mono { font-family: monospace; font-weight: 700; }
      tr.sec td { background: #f1f5f9; font-weight: 800; text-transform: uppercase; color: #1e293b; padding-top: 6px; }
      tr.sub td { background: #e2e8f0; font-weight: 700; border-top: 1px solid #94a3b8; }
      tr.kpi td { background: #fef9c3; font-weight: 800; border-top: 1px solid #ca8a04; border-bottom: 1px solid #ca8a04; }
      tr.final td { background: #0f172a; color: #ffffff; font-weight: 800; }
    </style></head><body>
    <div class="hdr"><div><h1>${escapeHtml(title)}</h1><p>${subtitle}</p></div><div class="badge">SABINO CANYON SPUR</div></div>
    ${tableHtml}
    <script>window.onload = function() { window.print(); };<\/script>
  </body></html>`);
  win.document.close();
}

// ============================================================================
// 11. CSV / EXCEL FILE UPLOAD HANDLERS
// ============================================================================
function parseCsvTextToGrid(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\r" && next === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
      else if (ch === "\n" || ch === "\r") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else { cell += ch; }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function handleUploadedFile(file) {
  if (!file) return;
  const ext = file.name.split(".").pop().toLowerCase();

  if (ext === "csv") {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const grid = parseCsvTextToGrid(e.target.result);
        activeReport = parse2DGridToReport(grid, file.name);
        autoSaveActiveState();
        renderAll();
        showToast(`Loaded "${file.name}" (${activeReport.items.length} lines mapped)`);
      } catch (err) {
        alert("CSV Parse Error: " + err.message);
      }
    };
    reader.readAsText(file);
  } else if (ext === "xlsx" || ext === "xls") {
    if (typeof XLSX === "undefined") {
      alert("Excel binary parser requires internet connection to load SheetJS CDN, or save your sheet as .CSV first.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });
        activeReport = parse2DGridToReport(grid, file.name);
        autoSaveActiveState();
        renderAll();
        showToast(`Loaded Excel "${file.name}" (${activeReport.items.length} lines mapped)`);
      } catch (err) {
        alert("Excel Parse Error: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    alert("Please upload a .csv, .xlsx, or .xls Management Report.");
  }
}

// ============================================================================
// 12. EVENT LISTENERS & APPLICATION STARTUP
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  loadStorage();
  updateRuleBadge();
  renderSnapshotDropdown();

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });

  const fileInput = document.getElementById("fileInput");
  fileInput.addEventListener("change", (e) => {
    handleUploadedFile(e.target.files[0]);
    e.target.value = "";
  });

  // Global & Dropzone Drag-and-Drop Support across all tabs
  const dz = document.getElementById("dropzone");
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (dz) dz.classList.add("dragover");
  });
  window.addEventListener("dragleave", (e) => {
    if (e.relatedTarget === null && dz) dz.classList.remove("dragover");
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    if (dz) dz.classList.remove("dragover");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUploadedFile(e.dataTransfer.files[0]);
    }
  });

  document.getElementById("reportPeriodInput").addEventListener("change", (e) => {
    if (!activeReport || !e.target.value) return;
    activeReport.period = e.target.value;
    autoSaveActiveState();
    renderSnapshotDropdown();
    if (typeof renderMomTab === "function") renderMomTab();
    showToast(`Assigned reporting period ${activeReport.period}`);
  });

  // Pilot POS Override Mode Controls (Excl. VAT Turnover & COGS)
  const chkPilotMode = document.getElementById("chkPilotMode");
  if (chkPilotMode) {
    chkPilotMode.addEventListener("change", (e) => {
      if (!activeReport) return;
      activeReport.pilotMode = e.target.checked;
      autoSaveActiveState();
      renderAll();
      showToast(activeReport.pilotMode
        ? "Pilot POS Mode ON — CSV Income & COGS replaced; expenses keep 15% VAT"
        : "Pilot POS Mode OFF — Using Management Report Income & COGS");
    });
  }

  const pilotTurnoverInput = document.getElementById("pilotTurnoverInput");
  if (pilotTurnoverInput) {
    pilotTurnoverInput.addEventListener("focus", function() { this.select(); });
    pilotTurnoverInput.addEventListener("change", (e) => {
      if (!activeReport) return;
      const parsed = parseUserAmount(e.target.value);
      if (parsed === null) {
        showToast("Invalid Pilot Turnover amount entered");
        e.target.value = Number(activeReport.pilotTurnoverExVat || 0).toFixed(2);
        return;
      }
      activeReport.pilotTurnoverExVat = parsed;
      if (Math.abs(parsed) >= 0.005 && !activeReport.pilotMode) {
        activeReport.pilotMode = true;
      }
      autoSaveActiveState();
      renderAll();
      showToast(`Set Pilot Turnover (Excl. VAT) to ${fmtZar(parsed)}`);
    });
    pilotTurnoverInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        pilotTurnoverInput.dispatchEvent(new Event("change"));
        const cogsEl = document.getElementById("pilotCogsInput");
        if (cogsEl) { cogsEl.focus(); cogsEl.select(); }
      }
    });
  }

  const pilotCogsInput = document.getElementById("pilotCogsInput");
  if (pilotCogsInput) {
    pilotCogsInput.addEventListener("focus", function() { this.select(); });
    pilotCogsInput.addEventListener("change", (e) => {
      if (!activeReport) return;
      const parsed = parseUserAmount(e.target.value);
      if (parsed === null) {
        showToast("Invalid Pilot Cost of Sales amount entered");
        e.target.value = Number(activeReport.pilotCogsExVat || 0).toFixed(2);
        return;
      }
      activeReport.pilotCogsExVat = parsed;
      if (Math.abs(parsed) >= 0.005 && !activeReport.pilotMode) {
        activeReport.pilotMode = true;
      }
      autoSaveActiveState();
      renderAll();
      showToast(`Set Pilot Cost of Sales (Excl. VAT) to ${fmtZar(parsed)}`);
    });
    pilotCogsInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        pilotCogsInput.dispatchEvent(new Event("change"));
        pilotCogsInput.blur();
      }
    });
  }

  document.getElementById("btnLoadSample").addEventListener("click", () => {
    const grid = parseCsvTextToGrid(SAMPLE_CSV_DATA);
    activeReport = parse2DGridToReport(grid, "Management_Report.csv (Sample)");
    autoSaveActiveState();
    renderAll();
    showToast("Loaded sample Management_Report.csv");
  });

  document.getElementById("btnSaveSnapshot").addEventListener("click", () => {
    if (!activeReport) return;
    const defaultLabel = activeReport.name.replace(/\s*\(Sample\)$/i, "");
    const label = prompt("Enter a name for this saved monthly snapshot (e.g., '2026-10 October P&L'):", defaultLabel);
    if (!label) return;
    const snapId = "snap_" + normKey(label).replace(/[^a-z0-9]/g, "_");
    activeReport.id = snapId;
    activeReport.name = label.trim();
    activeReport.savedAt = new Date().toISOString();
    savedSnapshots[snapId] = JSON.parse(JSON.stringify(activeReport));
    persistSnapshots();
    autoSaveActiveState();
    renderAll();
    showToast(`Saved "${activeReport.name}" (${activeReport.period}) to browser localStorage`);
  });

  document.getElementById("savedReportsSelect").addEventListener("change", (e) => {
    const id = e.target.value;
    if (id && savedSnapshots[id]) {
      activeReport = sanitizeReport(JSON.parse(JSON.stringify(savedSnapshots[id])));
      localStorage.setItem(LS_KEYS.ACTIVE_ID, id);
      autoSaveActiveState();
      renderAll();
      showToast(`Loaded snapshot: ${activeReport.name}`);
    }
  });

  document.getElementById("btnDeleteSnapshot").addEventListener("click", () => {
    if (!activeReport || !savedSnapshots[activeReport.id]) {
      showToast("Current report is not saved in snapshots.");
      return;
    }
    if (!confirm(`Delete saved snapshot "${activeReport.name}" from browser storage?`)) return;
    delete savedSnapshots[activeReport.id];
    persistSnapshots();
    const grid = parseCsvTextToGrid(SAMPLE_CSV_DATA);
    activeReport = parse2DGridToReport(grid, "Management_Report.csv (Sample)");
    autoSaveActiveState();
    renderAll();
    showToast("Snapshot deleted");
  });

  document.getElementById("chkHideZero").addEventListener("change", () => renderPnlTab(computeFinancials()));
  document.getElementById("vatModeSelect").addEventListener("change", renderAll);
  document.getElementById("auditSearch").addEventListener("input", () => renderAuditTab(computeFinancials()));
  document.getElementById("auditSectionFilter").addEventListener("change", () => renderAuditTab(computeFinancials()));
  document.getElementById("auditStatusFilter").addEventListener("change", () => renderAuditTab(computeFinancials()));
  document.getElementById("coaSearch").addEventListener("input", () => renderCoaTab(computeFinancials()));
  document.getElementById("coaSectionFilter").addEventListener("change", () => renderCoaTab(computeFinancials()));

  // Month-over-Month Controls
  document.getElementById("momFySelect").addEventListener("change", renderMomTab);
  document.getElementById("momDetailSelect").addEventListener("change", renderMomTab);
  document.getElementById("chkMomShowPct").addEventListener("change", renderMomTab);
  document.getElementById("btnExportMomXlsx").addEventListener("click", exportMomWorkbook);
  const btnMomPdf = document.getElementById("btnExportMomPdf");
  if (btnMomPdf) btnMomPdf.addEventListener("click", () => exportStatementPdf("MOM"));

  // Split Modal Listeners
  const splitBackdrop = document.getElementById("splitModalBackdrop");
  document.getElementById("btnCloseSplitModal").addEventListener("click", () => splitBackdrop.classList.remove("open"));
  document.getElementById("btnCancelSplit").addEventListener("click", () => splitBackdrop.classList.remove("open"));
  splitBackdrop.addEventListener("click", (e) => { if (e.target === splitBackdrop) splitBackdrop.classList.remove("open"); });
  document.getElementById("btnAddSplitSubRow").addEventListener("click", () => {
    const parent = activeReport.items.find(x => x.id === activeSplitParentId);
    splitDraftRows.push({
      vendor: parent ? `${parent.vendor} — Split ${splitDraftRows.length + 1}` : "Split Line",
      amount: 0,
      code: "7210"
    });
    renderSplitModal();
  });
  document.getElementById("btnApplySplitTemplate").addEventListener("click", () => {
    const tplId = document.getElementById("splitTemplateSelect").value;
    if (!tplId) { showToast("Select a saved split template first"); return; }
    applyTemplateToDraft(tplId);
  });
  document.getElementById("btnDeleteSplitTemplate").addEventListener("click", () => {
    const tplId = document.getElementById("splitTemplateSelect").value;
    if (!tplId || !splitTemplates[tplId]) { showToast("Select a saved split template to delete"); return; }
    const name = splitTemplates[tplId].name;
    if (!confirm(`Delete saved split template "${name}"?`)) return;
    delete splitTemplates[tplId];
    persistSplitTemplates();
    renderSplitTemplatesDropdown("");
    document.getElementById("splitTemplateLoadedHint").textContent = "";
    renderAuditTab(computeFinancials());
    showToast(`Deleted split template "${name}"`);
  });
  document.getElementById("btnSaveSplitTemplate").addEventListener("click", saveCurrentSplitAsTemplate);
  document.getElementById("btnConfirmSplit").addEventListener("click", applySplitModal);

  // Add Line Modal Listeners
  const addBackdrop = document.getElementById("addLineModalBackdrop");
  document.getElementById("btnOpenAddLine").addEventListener("click", openAddLineModal);
  document.getElementById("btnCloseAddModal").addEventListener("click", () => addBackdrop.classList.remove("open"));
  document.getElementById("btnCancelAddLine").addEventListener("click", () => addBackdrop.classList.remove("open"));
  addBackdrop.addEventListener("click", (e) => { if (e.target === addBackdrop) addBackdrop.classList.remove("open"); });
  document.getElementById("btnConfirmAddLine").addEventListener("click", confirmAddNewLine);

  // Export Excel & PDF
  document.getElementById("btnExportXlsx").addEventListener("click", exportThreeTabWorkbook);
  const btnPnlPdf = document.getElementById("btnExportPdf");
  if (btnPnlPdf) btnPnlPdf.addEventListener("click", () => exportStatementPdf("PNL"));

  // Rules & Templates Modal
  const modal = document.getElementById("rulesModalBackdrop");
  document.getElementById("btnRulesModal").addEventListener("click", () => {
    renderRulesModalTable();
    modal.classList.add("open");
  });
  document.getElementById("btnCloseModal").addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("open"); });

  document.getElementById("btnExportJson").addEventListener("click", () => {
    const payload = { exportedAt: new Date().toISOString(), customRules, splitTemplates, savedSnapshots, momSlotOverrides };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "Sabino_Canyon_Spur_PnL_Backup.json");
  });

  document.getElementById("jsonImportInput").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (parsed.customRules) {
          Object.keys(parsed.customRules).forEach(k => {
            if (parsed.customRules[k] && parsed.customRules[k].code) {
              parsed.customRules[k].code = migrateLegacyCode(parsed.customRules[k].code);
            }
          });
          customRules = { ...customRules, ...parsed.customRules };
        }
        if (parsed.splitTemplates) {
          Object.values(parsed.splitTemplates).forEach(tpl => {
            if (tpl && Array.isArray(tpl.rows)) {
              tpl.rows.forEach(r => { r.code = migrateLegacyCode(r.code); });
            }
          });
          splitTemplates = { ...splitTemplates, ...parsed.splitTemplates };
        }
        if (parsed.savedSnapshots) {
          Object.keys(parsed.savedSnapshots).forEach(id => sanitizeReport(parsed.savedSnapshots[id]));
          savedSnapshots = { ...savedSnapshots, ...parsed.savedSnapshots };
        }
        if (parsed.momSlotOverrides) {
          momSlotOverrides = { ...momSlotOverrides, ...parsed.momSlotOverrides };
        }
        persistRules();
        persistSplitTemplates();
        persistSnapshots();
        persistMomOverrides();
        renderRulesModalTable();
        renderAll();
        showToast("Backup restored successfully!");
      } catch (err) {
        alert("Invalid JSON backup file.");
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  });

  document.getElementById("btnResetRules").addEventListener("click", () => {
    if (!confirm("Reset all custom vendor overrides back to defaults?")) return;
    customRules = {};
    persistRules();
    renderRulesModalTable();
    renderAll();
    showToast("Custom vendor rules cleared");
  });

  // Boot initial state
  let booted = false;
  try {
    const draftRaw = localStorage.getItem(LS_KEYS.WORKING_DRAFT);
    if (draftRaw) {
      const parsedDraft = JSON.parse(draftRaw);
      if (parsedDraft && Array.isArray(parsedDraft.items) && parsedDraft.items.length > 0) {
        activeReport = sanitizeReport(parsedDraft);
        booted = true;
      }
    }
  } catch (e) { console.warn("Could not restore working draft", e); }

  if (!booted) {
    const lastId = localStorage.getItem(LS_KEYS.ACTIVE_ID);
    if (lastId && savedSnapshots[lastId]) {
      activeReport = sanitizeReport(JSON.parse(JSON.stringify(savedSnapshots[lastId])));
    } else {
      const grid = parseCsvTextToGrid(SAMPLE_CSV_DATA);
      activeReport = parse2DGridToReport(grid, "Management_Report.csv (Sample)");
    }
  }
  autoSaveActiveState();
  renderAll();
});
