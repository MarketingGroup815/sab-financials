// ============================================================================
// 6. UI RENDERING (KPI CARDS, P&L, VENDOR AUDIT, COMPARISON & COA REFERENCE)
// ============================================================================
function renderAll() {
  const fin = computeFinancials();
  if (!fin) return;

  document.getElementById("activeReportName").textContent = `Active Report: ${activeReport.name}`;
  const periodInput = document.getElementById("reportPeriodInput");
  if (periodInput && activeReport.period) {
    periodInput.value = activeReport.period;
  }

  const reconEl = document.getElementById("reconPill");
  if (Math.abs(fin.reconDiff) < 0.01 && fin.editedCount === 0) {
    reconEl.className = "pill pill-green";
    reconEl.textContent = "RECONCILED • R 0.00 DIFF";
  } else if (fin.editedCount > 0) {
    reconEl.className = "pill pill-gold";
    reconEl.textContent = `${fin.editedCount} EDITED • CSV DIFF ${fmtZar(fin.reconDiff)}`;
  } else {
    reconEl.className = "pill pill-red";
    reconEl.textContent = `VARIANCE • ${fmtZar(fin.reconDiff)}`;
  }

  const flagEl = document.getElementById("flagPill");
  if (fin.flaggedCount === 0) {
    flagEl.className = "pill pill-green";
    flagEl.textContent = "0 AUDIT FLAGS";
  } else {
    flagEl.className = "pill pill-amber";
    flagEl.textContent = `${fin.flaggedCount} AUDIT FLAGS / REVIEW ITEMS`;
  }

  document.getElementById("kpiTurnover").textContent = fmtZar(fin.netTurnover);
  document.getElementById("kpiTurnoverPct").textContent = fin.vatMode === "EXCL" ? "Excl. 15% VAT Basis" : "100.0% Cashbook Inflows";

  document.getElementById("kpiGP").textContent = fmtZar(fin.grossProfit);
  document.getElementById("kpiGPPct").textContent = `${fmtPct(fin.grossProfit, fin.netTurnover)} GP (COGS ${fmtPct(fin.totalCogs, fin.netTurnover)})`;

  document.getElementById("kpiPrime").textContent = fmtZar(fin.primeCost);
  document.getElementById("kpiPrimePct").textContent = `${fmtPct(fin.primeCost, fin.netTurnover)} of Turnover`;

  document.getElementById("kpiCtrl").textContent = fmtZar(fin.controllableProfit);
  document.getElementById("kpiCtrlPct").textContent = `${fmtPct(fin.controllableProfit, fin.netTurnover)} after OpEx`;

  document.getElementById("kpiEbitda").textContent = fmtZar(fin.ebitda);
  document.getElementById("kpiEbitdaPct").textContent = `${fmtPct(fin.ebitda, fin.netTurnover)} Operating Cash Flow`;

  document.getElementById("kpiNpbt").textContent = fmtZar(fin.netProfitBeforeTax);
  document.getElementById("kpiNpbtPct").textContent = `${fmtPct(fin.netProfitBeforeTax, fin.netTurnover)} (VAT & Excl. Removed)`;

  document.getElementById("auditCountTab").textContent = activeReport.items.length;

  renderPnlTab(fin);
  renderAuditTab(fin);
  renderCompareTab(fin);
  if (typeof renderMomTab === "function") renderMomTab();
  renderCoaTab(fin);
}

function buildAccountOptionsHtml(selectedCode) {
  const excludeAcc = ACCOUNT_MAP["EXCLUDE"];
  const topExcludeOpt = excludeAcc
    ? `<option value="EXCLUDE" ${selectedCode === "EXCLUDE" ? "selected" : ""}>EXCLUDE — Exclude from P&amp;L</option>`
    : "";
  const restOpts = COA.filter(r => r.code && r.code !== "EXCLUDE").map(r =>
    `<option value="${r.code}" ${r.code === selectedCode ? "selected" : ""}>${r.code} — ${escapeHtml(r.name)}</option>`
  ).join("");
  return topExcludeOpt + restOpts;
}

function renderPnlTab(fin) {
  const tbody = document.getElementById("pnlTableBody");
  const hideZero = document.getElementById("chkHideZero").checked;
  const subValues = {
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

  let html = "";
  COA.forEach(row => {
    if (row.type === "HEADER") {
      html += `<tr class="sec-header"><td colspan="6">${row.label}</td></tr>`;
    } else if (row.code) {
      const amt = fin.accTotals[row.code] || 0;
      const cnt = fin.accCounts[row.code] || 0;
      if (hideZero && Math.abs(amt) < 0.005 && cnt === 0) return;

      const isExpanded = expandedAccounts.has(row.code);
      const vendors = fin.accVendors[row.code] || [];
      let vendorHtml = "";
      if (isExpanded && vendors.length > 0) {
        const sorted = [...vendors].sort((a, b) => b.amount - a.amount);
        vendorHtml = `<div class="vendor-chips" onclick="event.stopPropagation()">` + sorted.map(v =>
          `<div class="v-chip">
            <span class="v-chip-label">${escapeHtml(v.vendor)}: <strong>${fmtZar(v.amount)}</strong></span>
            <select class="v-chip-select" title="Move this transaction to another GL code"
              onclick="event.stopPropagation()"
              onchange="event.stopPropagation(); onChangeItemCode('${escapeAttr(v.id)}', this.value)">
              ${buildAccountOptionsHtml(v.code)}
            </select>
          </div>`
        ).join("") + `</div>`;
      }

      html += `<tr style="cursor:pointer;" onclick="toggleExpandAccount('${row.code}')">
        <td class="center"><span class="code-badge">${row.code}</span></td>
        <td>
          <div style="font-weight:600;">${escapeHtml(row.name)} ${cnt > 0 ? `<span style="color:var(--text-muted);font-size:11px;">(${isExpanded ? "▾" : "▸"})</span>` : ""}</div>
          ${vendorHtml}
        </td>
        <td style="color:var(--text-secondary);font-size:12px;">${row.group}</td>
        <td class="num">${fmtZar(amt)}</td>
        <td class="num">${fmtPct(amt, fin.netTurnover)}</td>
        <td class="center" style="font-family:var(--font-mono);color:var(--text-secondary);">${cnt}</td>
      </tr>`;
    } else {
      const val = subValues[row.key] || 0;
      const cls = row.type === "FINAL" || row.type === "CASH" ? "final-row" : (row.type === "KPI" ? "kpi-row" : "subtotal-row");
      const lineSum = row.sec ? COA.filter(r => r.sec === row.sec && r.code).reduce((s, r) => s + (fin.accCounts[r.code] || 0), 0) : "";
      html += `<tr class="${cls}">
        <td class="center">&mdash;</td>
        <td>${row.label}</td>
        <td>${row.type === "CASH" ? "Cash Reconciliation" : "P&L Summary"}</td>
        <td class="num">${fmtZar(val)}</td>
        <td class="num">${fmtPct(val, fin.netTurnover)}</td>
        <td class="center" style="font-family:var(--font-mono);">${lineSum}</td>
      </tr>`;
    }
  });

  tbody.innerHTML = html;
}

window.toggleExpandAccount = function(code) {
  if (expandedAccounts.has(code)) expandedAccounts.delete(code);
  else expandedAccounts.add(code);
  renderPnlTab(computeFinancials());
};

function renderAuditTab(fin) {
  const tbody = document.getElementById("auditTableBody");
  const q = document.getElementById("auditSearch").value.trim().toLowerCase();
  const secFilter = document.getElementById("auditSectionFilter").value;
  const statusFilter = document.getElementById("auditStatusFilter").value;

  const filtered = activeReport.items.filter(item => {
    if (secFilter !== "ALL" && item.origSection !== secFilter) return false;
    if (statusFilter === "EDITED" && !isItemAmountEdited(item)) return false;
    if (statusFilter === "FLAGGED" && !(item._status.includes("Audit Flag") || item._status.includes("Needs Review"))) return false;
    if (statusFilter === "RECLASSIFIED" && !item._status.includes("Reclassified")) return false;
    if (statusFilter === "EXCLUDED" && !(item._status.includes("Excluded") || item.code === "EXCLUDE")) return false;
    if (q) {
      const accName = ACCOUNT_MAP[item.code] ? ACCOUNT_MAP[item.code].name.toLowerCase() : "";
      const hay = `${item.id} ${item.vendor} ${item.code} ${accName} ${item.note}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const filteredSum = filtered.reduce((s, x) => s + x.amount, 0);
  const editedTag = fin.editedCount > 0 ? ` | ${fin.editedCount} Edited` : "";
  document.getElementById("auditSummaryStrip").textContent =
    `Showing ${filtered.length} of ${activeReport.items.length} lines${editedTag} | Filtered Sum: ${fmtZar(filteredSum)}`;

  let html = "";
  filtered.forEach(item => {
    const edited = isItemAmountEdited(item);
    const matchingTpl = findTemplateForVendor(item.vendor);
    let rowCls = "";
    let pillCls = "pill-green";
    if (item._status.includes("Variance")) { rowCls = "row-flag-red"; pillCls = "pill-red"; }
    else if (item.code === "EXCLUDE") { rowCls = "row-excluded"; pillCls = "pill-slate"; }
    else if (item._status.includes("Excluded")) { rowCls = "row-flag-amber"; pillCls = "pill-red"; }
    else if (item._status.includes("Audit Flag") || item._status.includes("Needs Review")) { rowCls = "row-flag-amber"; pillCls = "pill-amber"; }
    else if (item._status.includes("Reclassified") || edited) { rowCls = "row-reclass"; pillCls = "pill-gold"; }

    const revertHtml = edited
      ? `<div class="amt-orig-row">
           <span>Orig: ${fmtZar(item.originalAmount)}</span>
           <button type="button" class="btn-revert-amt" title="Revert to original CSV amount" onclick="resetItemAmount('${escapeAttr(item.id)}')">&#8634;</button>
         </div>`
      : "";

    const splitBtnCls = matchingTpl ? "btn-xs-gold" : "btn-xs";
    const splitBtnLabel = matchingTpl ? "Split ★" : "Split";
    const splitBtnTitle = matchingTpl
      ? `Saved Split Template "${matchingTpl.name}" available — click to apply or edit`
      : "Split this line into multiple GL codes (e.g. Rent, Water, Electricity)";

    html += `<tr class="${rowCls}">
      <td class="center" style="font-family:var(--font-mono);color:var(--text-secondary);">${escapeHtml(item.id)}</td>
      <td class="center"><span class="code-badge" style="color:var(--text-primary);">${escapeHtml(item.origSection)}</span></td>
      <td class="center" style="font-family:var(--font-mono);color:var(--text-muted);">${escapeHtml(String(item.csvRow))}</td>
      <td style="font-weight:600;">${escapeHtml(item.vendor)}</td>
      <td class="num">
        <input
          type="text"
          inputmode="decimal"
          class="amt-input ${edited ? "modified" : ""}"
          data-item-id="${escapeHtml(item.id)}"
          value="${item.amount.toFixed(2)}"
          aria-label="Amount for ${escapeHtml(item.vendor)}"
          onfocus="this.select()"
          onchange="onChangeItemAmount('${escapeAttr(item.id)}', this.value, false)"
          onkeydown="onAmountKeyDown(event, '${escapeAttr(item.id)}')"
        />
        ${revertHtml}
      </td>
      <td>
        <select class="gl-select" onchange="onChangeItemCode('${escapeAttr(item.id)}', this.value)">
          ${buildAccountOptionsHtml(item.code)}
        </select>
      </td>
      <td><span class="pill ${pillCls}">${escapeHtml(item._status)}</span></td>
      <td style="font-size:11.5px;color:var(--text-secondary);">${escapeHtml(item.note)}</td>
      <td class="center" style="white-space:nowrap;">
        <button type="button" class="${splitBtnCls}" title="${escapeAttr(splitBtnTitle)}" onclick="openSplitModal('${escapeAttr(item.id)}')">${splitBtnLabel}</button>
        <button type="button" class="btn-xs" style="color:#f87171;border-color:rgba(239,68,68,0.35);margin-left:3px;" title="Delete this audit line" onclick="deleteAuditLine('${escapeAttr(item.id)}')">Del</button>
      </td>
    </tr>`;
  });

  tbody.innerHTML = html;
}

function parseUserAmount(rawStr) {
  let s = String(rawStr === undefined || rawStr === null ? "" : rawStr).trim();
  if (s === "") return 0;
  let isNeg = false;
  if (/^\(.*\)$/.test(s)) {
    isNeg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[R$\s,]/g, "");
  if (s === "" || s === "-" || s === "+") return 0;
  const num = Number(s);
  if (!isFinite(num) || isNaN(num)) return null;
  const signed = isNeg ? -Math.abs(num) : num;
  return Math.round(signed * 100) / 100;
}

function stripEditSuffix(note) {
  return String(note || "").replace(/\s*\|\s*\[Amount edited from .*?\]$/, "");
}

window.onChangeItemAmount = function(itemId, rawValue, advanceNext) {
  const item = activeReport.items.find(x => x.id === itemId);
  if (!item) return;

  const parsed = parseUserAmount(rawValue);
  if (parsed === null) {
    showToast("Invalid amount entered — reverted to previous value");
    renderAuditTab(computeFinancials());
    return;
  }

  const changed = Math.abs(parsed - item.amount) >= 0.005;
  item.amount = parsed;

  const baseNote = stripEditSuffix(item.note);
  if (isItemAmountEdited(item)) {
    item.note = `${baseNote} | [Amount edited from ${fmtZar(item.originalAmount)} to ${fmtZar(item.amount)}]`;
  } else {
    item.note = baseNote;
  }

  autoSaveActiveState();
  renderAll();

  if (changed) {
    showToast(`Updated "${item.vendor}" amount to ${fmtZar(item.amount)}`);
  }

  if (advanceNext) {
    const inputs = Array.from(document.querySelectorAll("#auditTableBody .amt-input"));
    const idx = inputs.findIndex(inp => inp.dataset.itemId === itemId);
    if (idx >= 0 && idx + 1 < inputs.length) {
      inputs[idx + 1].focus();
      inputs[idx + 1].select();
    }
  }
};

window.onAmountKeyDown = function(e, itemId) {
  if (e.key === "Enter") {
    e.preventDefault();
    onChangeItemAmount(itemId, e.target.value, true);
  } else if (e.key === "Escape") {
    e.preventDefault();
    const item = activeReport.items.find(x => x.id === itemId);
    if (item) e.target.value = item.amount.toFixed(2);
    e.target.blur();
  }
};

window.resetItemAmount = function(itemId) {
  const item = activeReport.items.find(x => x.id === itemId);
  if (!item) return;
  item.amount = item.originalAmount;
  item.note = stripEditSuffix(item.note);
  autoSaveActiveState();
  renderAll();
  showToast(`Reverted "${item.vendor}" to ${fmtZar(item.originalAmount)}`);
};

window.onChangeItemCode = function(itemId, newCode) {
  const item = activeReport.items.find(x => x.id === itemId);
  if (!item) return;
  item.code = newCode;
  item.autoMatched = true;
  const acc = ACCOUNT_MAP[newCode];
  const baseNote = newCode === "EXCLUDE"
    ? "Manually excluded from P&L & saved to browser storage"
    : `Manually assigned to ${newCode} (${acc ? acc.name : newCode}) & saved to browser storage`;
  item.note = isItemAmountEdited(item)
    ? `${baseNote} | [Amount edited from ${fmtZar(item.originalAmount)} to ${fmtZar(item.amount)}]`
    : baseNote;

  if (!item.isVarianceRow && !item.isSplitChild && !item.isManualLine) {
    customRules[normKey(item.vendor)] = { code: newCode, note: baseNote };
    persistRules();
  }
  autoSaveActiveState();
  renderAll();
  showToast(`Moved "${item.vendor}" → ${newCode} (${acc ? acc.name : newCode})`);
};

window.deleteAuditLine = function(itemId) {
  const idx = activeReport.items.findIndex(x => x.id === itemId);
  if (idx < 0) return;
  const item = activeReport.items[idx];
  if (!confirm(`Delete audit line "${item.vendor}" (${fmtZar(item.amount)})?`)) return;
  activeReport.items.splice(idx, 1);
  autoSaveActiveState();
  renderAll();
  showToast(`Deleted "${item.vendor}"`);
};

// ============================================================================
// 6B. SPLIT LINE, RECURRING SPLIT TEMPLATES & ADD NEW LINE MODALS
// ============================================================================
function renderSplitTemplatesDropdown(selectedTplId) {
  const sel = document.getElementById("splitTemplateSelect");
  const all = Object.values(splitTemplates).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  if (all.length === 0) {
    sel.innerHTML = `<option value="">-- No saved split templates yet --</option>`;
    return;
  }
  sel.innerHTML = `<option value="">-- Select a saved split template (${all.length}) --</option>` + all.map(tpl => {
    const modeTag = tpl.mode === "PCT" ? "% Ratio" : "Fixed ZAR";
    const bindTag = tpl.vendorKey ? ` • Bound: ${tpl.vendorKey}` : "";
    const selected = tpl.id === selectedTplId ? "selected" : "";
    return `<option value="${escapeAttr(tpl.id)}" ${selected}>${escapeHtml(tpl.name)} (${tpl.rows.length} lines, ${modeTag}${escapeHtml(bindTag)})</option>`;
  }).join("");
}

function applyTemplateToDraft(tplId) {
  const parent = activeReport.items.find(x => x.id === activeSplitParentId);
  const tpl = splitTemplates[tplId];
  if (!parent || !tpl) return;

  splitDraftRows = computeRowsFromTemplate(tpl, parent.vendor, parent.amount);
  document.getElementById("splitTemplateLoadedHint").textContent = `Loaded: ${tpl.name}`;
  renderSplitModal();
}

window.openSplitModal = function(itemId) {
  const parent = activeReport.items.find(x => x.id === itemId);
  if (!parent) return;
  activeSplitParentId = itemId;

  const matchedTpl = findTemplateForVendor(parent.vendor);
  renderSplitTemplatesDropdown(matchedTpl ? matchedTpl.id : "");

  document.getElementById("saveSplitTplName").value = matchedTpl ? matchedTpl.name : parent.vendor;
  document.getElementById("saveSplitTplMode").value = matchedTpl ? matchedTpl.mode : "FIXED";
  document.getElementById("bindVendorLabel").textContent = `"${parent.vendor}"`;
  document.getElementById("chkBindTplVendor").checked = true;
  document.getElementById("chkAutoApplyTplUpload").checked = matchedTpl ? Boolean(matchedTpl.autoApplyOnUpload) : true;

  if (matchedTpl) {
    splitDraftRows = computeRowsFromTemplate(matchedTpl, parent.vendor, parent.amount);
    document.getElementById("splitTemplateLoadedHint").textContent = `Auto-loaded template: ${matchedTpl.name}`;
  } else {
    document.getElementById("splitTemplateLoadedHint").textContent = "";
    const suggestedSecondCode = parent.code === "8010" ? "7230" : (parent.code === "7230" ? "7210" : "7210");
    splitDraftRows = [
      {
        vendor: `${parent.vendor} — Base Rent`,
        amount: parent.amount,
        code: parent.code === "EXCLUDE" ? "8010" : parent.code
      },
      {
        vendor: `${parent.vendor} — Water & Electricity`,
        amount: 0,
        code: suggestedSecondCode
      }
    ];
  }

  renderSplitModal();
  document.getElementById("splitModalBackdrop").classList.add("open");
};

function renderSplitModal() {
  const parent = activeReport.items.find(x => x.id === activeSplitParentId);
  if (!parent) return;

  const allocated = Math.round(splitDraftRows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
  const remaining = Math.round((parent.amount - allocated) * 100) / 100;
  const isBalanced = Math.abs(remaining) < 0.005;

  document.getElementById("splitSummaryBar").innerHTML = `
    <div><span style="color:var(--text-secondary);">Parent (${escapeHtml(parent.id)}):</span> <strong>${escapeHtml(parent.vendor)}</strong></div>
    <div><span style="color:var(--text-secondary);">Original:</span> <strong>${fmtZar(parent.amount)}</strong></div>
    <div><span style="color:var(--text-secondary);">Allocated:</span> <strong style="color:var(--accent-gold);">${fmtZar(allocated)}</strong></div>
    <div><span style="color:var(--text-secondary);">Remaining:</span> <strong style="color:${isBalanced ? "#34d399" : "#fbbf24"};">${fmtZar(remaining)}</strong></div>
  `;

  const warnEl = document.getElementById("splitWarningText");
  warnEl.textContent = isBalanced
    ? "Balanced to original line amount (R 0.00 reconciliation variance)."
    : `Note: Split total differs from original line by ${fmtZar(remaining)}.`;
  warnEl.style.color = isBalanced ? "#34d399" : "#fbbf24";

  const tbody = document.getElementById("splitRowsTbody");
  tbody.innerHTML = splitDraftRows.map((row, idx) => `
    <tr>
      <td>
        <input type="text" style="width:100%;" value="${escapeHtml(row.vendor)}"
          oninput="updateSplitDraftField(${idx}, 'vendor', this.value)" />
      </td>
      <td class="num">
        <input type="text" inputmode="decimal" class="amt-input" style="width:125px;" value="${Number(row.amount || 0).toFixed(2)}"
          onfocus="this.select()"
          onchange="updateSplitDraftAmount(${idx}, this.value)" />
      </td>
      <td>
        <select class="gl-select" style="min-width:230px;" onchange="updateSplitDraftField(${idx}, 'code', this.value)">
          ${buildAccountOptionsHtml(row.code)}
        </select>
      </td>
      <td class="center" style="white-space:nowrap;">
        <button type="button" class="btn-xs" title="Assign remaining unallocated balance to this row" onclick="fillSplitRemainder(${idx})">Fill Rem.</button>
        ${splitDraftRows.length > 2 ? `<button type="button" class="btn-xs" style="color:#f87171;margin-left:3px;" onclick="removeSplitSubRow(${idx})">✕</button>` : ""}
      </td>
    </tr>
  `).join("");
}

window.updateSplitDraftField = function(idx, field, val) {
  if (!splitDraftRows[idx]) return;
  splitDraftRows[idx][field] = val;
};

window.updateSplitDraftAmount = function(idx, rawVal) {
  if (!splitDraftRows[idx]) return;
  const parsed = parseUserAmount(rawVal);
  splitDraftRows[idx].amount = parsed === null ? 0 : parsed;
  renderSplitModal();
};

window.fillSplitRemainder = function(idx) {
  const parent = activeReport.items.find(x => x.id === activeSplitParentId);
  if (!parent || !splitDraftRows[idx]) return;
  const othersSum = splitDraftRows.reduce((s, r, i) => i === idx ? s : s + (Number(r.amount) || 0), 0);
  splitDraftRows[idx].amount = Math.round((parent.amount - othersSum) * 100) / 100;
  renderSplitModal();
};

window.removeSplitSubRow = function(idx) {
  if (splitDraftRows.length <= 2) return;
  splitDraftRows.splice(idx, 1);
  renderSplitModal();
};

function saveCurrentSplitAsTemplate() {
  const parent = activeReport.items.find(x => x.id === activeSplitParentId);
  if (!parent) return;

  const tplName = document.getElementById("saveSplitTplName").value.trim();
  if (!tplName) {
    alert("Please enter a Template Name before saving.");
    return;
  }

  const validRows = splitDraftRows.filter(r => String(r.vendor || "").trim() !== "");
  if (validRows.length < 2) {
    alert("A split template requires at least 2 split lines.");
    return;
  }

  const mode = document.getElementById("saveSplitTplMode").value;
  const bindVendor = document.getElementById("chkBindTplVendor").checked;
  const autoApply = bindVendor && document.getElementById("chkAutoApplyTplUpload").checked;
  const vendorKey = bindVendor ? normKey(parent.vendor) : "";

  const totalDraft = validRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const parentPrefixRegex = new RegExp(`^${parent.vendor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[—\\-]\\s*`, "i");

  const tplRows = validRows.map(r => {
    const rawDesc = String(r.vendor).trim();
    const cleanSuffix = rawDesc.replace(parentPrefixRegex, "").trim();
    const amt = Math.round((Number(r.amount) || 0) * 100) / 100;
    const pct = Math.abs(totalDraft) > 0.005 ? Number(((amt / totalDraft) * 100).toFixed(4)) : Number((100 / validRows.length).toFixed(4));
    return {
      suffix: cleanSuffix || rawDesc,
      code: r.code,
      amount: amt,
      pct
    };
  });

  const existing = Object.values(splitTemplates).find(t =>
    (vendorKey && t.vendorKey === vendorKey) || normKey(t.name) === normKey(tplName)
  );
  const tplId = existing ? existing.id : ("tpl_" + Date.now());

  splitTemplates[tplId] = {
    id: tplId,
    name: tplName,
    vendorKey,
    autoApplyOnUpload: autoApply,
    mode,
    createdAt: new Date().toISOString(),
    rows: tplRows
  };

  persistSplitTemplates();
  renderSplitTemplatesDropdown(tplId);
  document.getElementById("splitTemplateLoadedHint").textContent = `Saved: ${tplName}`;
  renderAuditTab(computeFinancials());
  showToast(`Saved split template "${tplName}" to browser localStorage`);
}

function applySplitModal() {
  const parentIdx = activeReport.items.findIndex(x => x.id === activeSplitParentId);
  if (parentIdx < 0) return;
  const parent = activeReport.items[parentIdx];

  const validRows = splitDraftRows.filter(r => String(r.vendor || "").trim() !== "");
  if (validRows.length === 0) {
    alert("Please enter at least one split description.");
    return;
  }

  const allocated = Math.round(validRows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
  const remaining = Math.round((parent.amount - allocated) * 100) / 100;
  const isBalanced = Math.abs(remaining) < 0.005;

  const baseId = parent.id.replace(/[a-z]+$/i, "");
  const newItems = validRows.map((r, i) => {
    const suffix = String.fromCharCode(97 + i);
    const amt = Math.round((Number(r.amount) || 0) * 100) / 100;
    const acc = ACCOUNT_MAP[r.code];
    return {
      id: `${baseId}${suffix}`,
      origSection: parent.origSection,
      csvRow: parent.csvRow,
      vendor: String(r.vendor).trim(),
      amount: amt,
      originalAmount: isBalanced ? amt : (i === 0 ? Math.round((amt + remaining) * 100) / 100 : amt),
      code: r.code,
      note: `Split from ${parent.id} (${parent.vendor}, Orig: ${fmtZar(parent.amount)}) → ${r.code} (${acc ? acc.name : r.code})`,
      autoMatched: true,
      isVarianceRow: false,
      isSplitChild: true
    };
  });

  activeReport.items.splice(parentIdx, 1, ...newItems);
  document.getElementById("splitModalBackdrop").classList.remove("open");
  activeSplitParentId = null;
  autoSaveActiveState();
  renderAll();
  showToast(`Split into ${newItems.length} audit lines`);
}

function openAddLineModal() {
  document.getElementById("newLineCode").innerHTML = buildAccountOptionsHtml("8010");
  document.getElementById("newLineVendor").value = "";
  document.getElementById("newLineAmount").value = "0.00";
  document.getElementById("newLineNote").value = "";
  document.getElementById("addLineModalBackdrop").classList.add("open");
  setTimeout(() => document.getElementById("newLineVendor").focus(), 40);
}

function confirmAddNewLine() {
  const sec = document.getElementById("newLineSection").value;
  const vendor = document.getElementById("newLineVendor").value.trim();
  const amtParsed = parseUserAmount(document.getElementById("newLineAmount").value);
  const code = document.getElementById("newLineCode").value;
  const customNote = document.getElementById("newLineNote").value.trim();

  if (!vendor) {
    alert("Please enter a Vendor / Transaction Description.");
    return;
  }
  if (amtParsed === null) {
    alert("Please enter a valid numeric ZAR amount.");
    return;
  }

  const manualCount = activeReport.items.filter(x => String(x.id).startsWith("ADD-")).length + 1;
  const newId = `ADD-${String(manualCount).padStart(2, "0")}`;
  const acc = ACCOUNT_MAP[code];

  activeReport.items.push({
    id: newId,
    origSection: sec,
    csvRow: "MANUAL",
    vendor,
    amount: amtParsed,
    originalAmount: amtParsed,
    code,
    note: customNote || `Manually added line → ${code} (${acc ? acc.name : code})`,
    autoMatched: true,
    isVarianceRow: false,
    isManualLine: true
  });

  document.getElementById("addLineModalBackdrop").classList.remove("open");
  autoSaveActiveState();
  renderAll();
  showToast(`Added "${vendor}" (${fmtZar(amtParsed)})`);
}

function renderCompareTab(fin) {
  const raw = activeReport.rawSectionTotals;
  const rawRev = raw["Income"] || 0;
  const rawCogs = raw["COGS"] || 0;
  const rawGP = rawRev - rawCogs;
  const rawLabour = raw["Labour"] || 0;
  const rawPrime = rawCogs + rawLabour;
  const rawOpex = raw["OPEX"] || 0;
  const rawDebit = raw["Debit Orders"] || 0;
  const rawEbitda = rawGP - rawLabour - rawOpex - rawDebit;
  const rawNonOpex = raw["NonOPEX"] || 0;
  const rawNet = rawEbitda - rawNonOpex;
  const totalNonPnl = fin.bsVat + fin.bsCap - fin.excludedNetCashAdj;

  const rows = [
    { label: "Net Turnover (Cash Inflows)", rVal: rawRev, nVal: fin.netTurnover, driver: "Top-line cash inflows (less any excluded revenue lines)", type: "NORMAL" },
    { label: "Cost of Sales (COGS)", rVal: rawCogs, nVal: fin.totalCogs, driver: "Moves fresh produce (Market) & coffee beans into COGS; EasiShoppe moved to LP Gas", type: "NORMAL" },
    { label: "GROSS PROFIT (GP)", rVal: rawGP, nVal: fin.grossProfit, driver: "Reflects true store-level food & beverage margin", type: "SUB" },
    { label: "Labour & People Costs", rVal: rawLabour, nVal: fin.totalLabour, driver: "Consolidates Staff Transport, Uber, Uniforms & LMS training", type: "NORMAL" },
    { label: "PRIME COST (COGS + LABOUR)", rVal: rawPrime, nVal: fin.primeCost, driver: "Primary controllable restaurant benchmark", type: "KPI" },
    { label: "Controllable Operating Expenses", rVal: rawOpex, nVal: fin.totalOpex, driver: "Includes Royalties, Nat. Marketing, Charity (7490) & EasiShoppe LP Gas; excludes Market & Transport", type: "NORMAL" },
    { label: "Occupancy & Debit Orders", rVal: rawDebit, nVal: fin.totalOccupancy, driver: "Isolates store rental, commercial insurance & unreconciled debit order gap", type: "NORMAL" },
    { label: "EBITDA", rVal: rawEbitda, nVal: fin.ebitda, driver: "True operating cash flow before interest, Balance Sheet VAT & Excluded items", type: "KPI" },
    { label: "Non-OpEx / Finance Costs", rVal: rawNonOpex, nVal: fin.totalBelow, driver: "Removes SARS VAT settlement & moves LSM/Maintenance to OpEx", type: "NORMAL" },
    { label: "NET PROFIT BEFORE TAX (P&L)", rVal: rawNet, nVal: fin.netProfitBeforeTax, driver: "True P&L profit once Balance Sheet VAT & Excluded items are removed", type: "FINAL" },
    { label: "Balance Sheet VAT & Excluded Items", rVal: 0, nVal: totalNonPnl, driver: "SARS VAT liability, CapEx & items marked EXCLUDE outside P&L", type: "NORMAL" },
    { label: "RECONCILED NET CASH SURPLUS", rVal: rawNet, nVal: fin.netCashSurplus, driver: "Exact cash surplus reconciliation to adjusted audit lines", type: "FINAL" }
  ];

  const tbody = document.getElementById("compareTableBody");
  tbody.innerHTML = rows.map(r => {
    const cls = r.type === "FINAL" ? "final-row" : (r.type === "KPI" ? "kpi-row" : (r.type === "SUB" ? "subtotal-row" : ""));
    const diff = r.nVal - r.rVal;
    return `<tr class="${cls}">
      <td>${r.label}</td>
      <td class="num">${fmtZar(r.rVal)}</td>
      <td class="num">${fmtPct(r.rVal, rawRev)}</td>
      <td class="num">${fmtZar(r.nVal)}</td>
      <td class="num">${fmtPct(r.nVal, fin.netTurnover)}</td>
      <td class="num">${fmtZar(diff)}</td>
      <td style="font-size:11.5px;opacity:0.9;">${r.driver}</td>
    </tr>`;
  }).join("");

  const chartItems = [
    { label: "Cost of Sales (COGS)", r: rawCogs, n: fin.totalCogs },
    { label: "Labour & People Costs", r: rawLabour, n: fin.totalLabour },
    { label: "Controllable OpEx", r: rawOpex, n: fin.totalOpex },
    { label: "Occupancy & Debit Orders", r: rawDebit, n: fin.totalOccupancy },
    { label: "Non-OpEx / Interest", r: rawNonOpex, n: fin.totalBelow },
    { label: "Net Profit Before Tax", r: rawNet, n: fin.netProfitBeforeTax }
  ];
  const maxVal = Math.max(...chartItems.flatMap(x => [Math.abs(x.r), Math.abs(x.n)]), 1);

  document.getElementById("comparisonBars").innerHTML = chartItems.map(c => {
    const wR = Math.min(100, Math.max(1, (Math.abs(c.r) / maxVal) * 100)).toFixed(1);
    const wN = Math.min(100, Math.max(1, (Math.abs(c.n) / maxVal) * 100)).toFixed(1);
    return `<div class="bar-row">
      <div style="font-weight:600;font-size:12px;">${c.label}</div>
      <div class="bar-tracks">
        <div class="bar-track" title="Raw: ${fmtZar(c.r)}"><div class="bar-fill-raw" style="width:${wR}%"></div></div>
        <div class="bar-track" title="2026: ${fmtZar(c.n)}"><div class="bar-fill-2026" style="width:${wN}%"></div></div>
      </div>
      <div style="font-family:var(--font-mono);font-size:11px;text-align:right;">
        <div style="color:var(--text-secondary);">Raw: ${fmtZar(c.r)}</div>
        <div style="color:var(--accent-gold);font-weight:700;">2026: ${fmtZar(c.n)}</div>
      </div>
    </div>`;
  }).join("");
}

function buildEffectiveRulesByCode() {
  const merged = { ...DEFAULT_VENDOR_RULES, ...customRules };
  const byCode = {};
  Object.entries(merged).forEach(([vendorKey, rule]) => {
    const code = migrateLegacyCode(rule.code);
    if (!byCode[code]) byCode[code] = [];
    byCode[code].push(vendorKey);
  });
  Object.keys(byCode).forEach(code => byCode[code].sort());
  return byCode;
}

function renderCoaTab(fin) {
  const tbody = document.getElementById("coaTableBody");
  const q = document.getElementById("coaSearch").value.trim().toLowerCase();
  const secFilter = document.getElementById("coaSectionFilter").value;
  const rulesByCode = buildEffectiveRulesByCode();

  const totalAccounts = COA.filter(r => r.code).length;
  document.getElementById("coaCountTab").textContent = totalAccounts;

  let visibleCount = 0;
  let html = "";
  let pendingHeader = null;

  COA.forEach(row => {
    if (row.type === "HEADER") {
      pendingHeader = (secFilter !== "ALL" && row.sec !== secFilter) ? null : row;
      return;
    }
    if (!row.code) return;
    if (secFilter !== "ALL" && row.sec !== secFilter) return;

    const mappedVendors = rulesByCode[row.code] || [];
    const vatText = row.vatable ? "Vatable (15%)" : "Non-VAT / Statutory";

    if (q) {
      const hay = `${row.code} ${row.name} ${row.group} ${vatText} ${mappedVendors.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return;
    }

    if (pendingHeader) {
      html += `<tr class="sec-header"><td colspan="6">${escapeHtml(pendingHeader.label)}</td></tr>`;
      pendingHeader = null;
    }

    visibleCount++;
    const activeLines = fin && fin.accCounts ? (fin.accCounts[row.code] || 0) : 0;
    const vatPill = row.vatable
      ? `<span class="pill pill-green">Vatable (15%)</span>`
      : `<span class="pill pill-slate">Non-VAT / Statutory</span>`;

    const vendorsHtml = mappedVendors.length > 0
      ? `<div class="vendor-chips">${mappedVendors.map(v => `<span class="v-chip">${escapeHtml(v)}</span>`).join("")}</div>`
      : `<span style="color:var(--text-muted);font-size:11.5px;">No fixed vendor rule (manual assignment)</span>`;

    html += `<tr>
      <td class="center"><span class="code-badge">${escapeHtml(row.code)}</span></td>
      <td style="font-weight:600;">${escapeHtml(row.name)}</td>
      <td style="color:var(--text-secondary);font-size:12px;">${escapeHtml(row.group)}</td>
      <td class="center">${vatPill}</td>
      <td>${vendorsHtml}</td>
      <td class="center" style="font-family:var(--font-mono);color:${activeLines > 0 ? "var(--accent-gold)" : "var(--text-muted)"};font-weight:${activeLines > 0 ? "700" : "400"};">${activeLines}</td>
    </tr>`;
  });

  if (visibleCount === 0) {
    html = `<tr><td colspan="6" class="center" style="padding:20px;color:var(--text-secondary);">No GL codes match your filter criteria.</td></tr>`;
  }

  document.getElementById("coaSummaryStrip").textContent =
    `Showing ${visibleCount} of ${totalAccounts} 2026 GL Accounts (Uneditable Reference)`;
  tbody.innerHTML = html;
}

// ============================================================================
// 7. SNAPSHOTS & RULES / TEMPLATES MODAL
// ============================================================================
function renderSnapshotDropdown() {
  const sel = document.getElementById("savedReportsSelect");
  const keys = Object.keys(savedSnapshots);
  let opts = `<option value="">-- Saved Browser Snapshots (${keys.length}) --</option>`;
  keys.sort((a, b) => (savedSnapshots[b].period || "").localeCompare(savedSnapshots[a].period || "")).forEach(k => {
    const snap = savedSnapshots[k];
    const selected = activeReport && activeReport.id === snap.id ? "selected" : "";
    const pTag = snap.period ? `[${snap.period}] ` : "";
    opts += `<option value="${snap.id}" ${selected}>${escapeHtml(pTag + snap.name)} (${snap.items.length} lines)</option>`;
  });
  sel.innerHTML = opts;
}

function updateRuleBadge() {
  document.getElementById("ruleCountBadge").textContent = Object.keys(customRules).length;
  document.getElementById("tplCountBadge").textContent = Object.keys(splitTemplates).length;
}

function renderRulesModalTable() {
  const tplTbody = document.getElementById("splitTemplatesManagerTbody");
  const tplList = Object.values(splitTemplates).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  if (tplList.length === 0) {
    tplTbody.innerHTML = `<tr><td colspan="5" class="center" style="color:var(--text-secondary);padding:16px;">No recurring split templates saved yet. Click <strong>Split</strong> on any row in Tab 2 to create and save one.</td></tr>`;
  } else {
    tplTbody.innerHTML = tplList.map(tpl => {
      const modeLabel = tpl.mode === "PCT" ? "% Ratio" : "Fixed ZAR";
      const autoLabel = tpl.autoApplyOnUpload ? "Auto-Split ON" : "Manual Apply";
      const breakdownHtml = (tpl.rows || []).map(r => {
        const valText = tpl.mode === "PCT" ? `${Number(r.pct || 0).toFixed(1)}%` : fmtZar(r.amount);
        return `<span class="v-chip">${escapeHtml(r.suffix)} (${r.code}: ${valText})</span>`;
      }).join("");
      return `<tr>
        <td style="font-weight:600;">${escapeHtml(tpl.name)}</td>
        <td style="font-family:var(--font-mono);color:var(--text-secondary);">${tpl.vendorKey ? escapeHtml(tpl.vendorKey) : "&mdash;"}</td>
        <td class="center"><span class="pill ${tpl.autoApplyOnUpload ? "pill-green" : "pill-gold"}">${modeLabel} &bull; ${autoLabel}</span></td>
        <td><div class="vendor-chips">${breakdownHtml}</div></td>
        <td class="center"><button type="button" onclick="deleteSplitTemplateById('${escapeAttr(tpl.id)}')" style="color:#f87171;padding:3px 8px;font-size:11px;">Remove</button></td>
      </tr>`;
    }).join("");
  }

  const tbody = document.getElementById("rulesTableBody");
  const keys = Object.keys(customRules).sort();
  if (keys.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="center" style="color:var(--text-secondary);padding:18px;">No custom single-vendor overrides saved yet. Change any vendor's GL code in Tab 1 or Tab 2 to store a permanent rule.</td></tr>`;
    return;
  }
  tbody.innerHTML = keys.map(k => {
    const r = customRules[k];
    const acc = ACCOUNT_MAP[r.code];
    return `<tr>
      <td style="font-family:var(--font-mono);">${escapeHtml(k)}</td>
      <td><span class="code-badge">${r.code}</span></td>
      <td>${acc ? escapeHtml(acc.name) : "Unknown"}</td>
      <td class="center"><button type="button" onclick="deleteCustomRule('${escapeAttr(k)}')" style="color:#f87171;padding:3px 8px;font-size:11px;">Remove</button></td>
    </tr>`;
  }).join("");
}

window.deleteSplitTemplateById = function(tplId) {
  const tpl = splitTemplates[tplId];
  if (!tpl) return;
  delete splitTemplates[tplId];
  persistSplitTemplates();
  renderRulesModalTable();
  renderAuditTab(computeFinancials());
  showToast(`Removed split template "${tpl.name}"`);
};

window.deleteCustomRule = function(key) {
  delete customRules[key];
  persistRules();
  renderRulesModalTable();
  renderCoaTab(computeFinancials());
  showToast(`Removed saved rule for "${key}"`);
};
