(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OBRegion = api;
  if (root.document) root.document.addEventListener("DOMContentLoaded", api.start);
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NUMBER_FIELDS = [
    "attempts", "success", "attemptAmountUsd", "successAmountUsd",
    "failed", "pending", "pendingOver2h"
  ];

  function currentRate(row) {
    return row.attempts ? row.success / row.attempts * 100 : null;
  }

  function deriveTotals(rows) {
    const totals = Object.fromEntries(NUMBER_FIELDS.map(field => [field, 0]));
    let processingWeight = 0;
    let weightedProcessing = 0;
    rows.forEach(row => {
      NUMBER_FIELDS.forEach(field => { totals[field] += Number(row[field]) || 0; });
      const terminal = (Number(row.success) || 0) + (Number(row.failed) || 0);
      processingWeight += terminal;
      weightedProcessing += (Number(row.avgProcessingSec) || 0) * terminal;
    });
    totals.successRate = totals.attempts ? totals.success / totals.attempts * 100 : null;
    totals.avgProcessingSec = processingWeight ? weightedProcessing / processingWeight : null;
    return totals;
  }

  function filterRows(rows, filters) {
    return rows.filter(row => [
      ["module", filters.module],
      ["channel", filters.channel],
      ["destinationBank", filters.destinationBank],
      ["status", filters.status]
    ].every(([field, wanted]) => !wanted || wanted.toLowerCase() === "all" || row[field] === wanted));
  }

  function sortExceptions(rows) {
    return [...rows].sort((a, b) => {
      const impact = row => (Number(row.failed) || 0) + (Number(row.pending) || 0);
      const degradation = row => (currentRate(row) ?? 100) - Number(row.previousSr || 0);
      return impact(b) - impact(a) || degradation(a) - degradation(b);
    });
  }

  function transitionIncident(incident, action) {
    const transitions = {
      open: { acknowledge: "acknowledged" },
      acknowledged: { start: "investigating" },
      investigating: { recover: "recovered" }
    };
    const next = transitions[incident.state] && transitions[incident.state][action];
    if (!next) throw new Error(`Invalid incident transition: ${incident.state} → ${action}`);
    incident.state = next;
    return incident;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[character]);
  }

  const count = value => new Intl.NumberFormat("en-US").format(Math.round(value));
  const money = value => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0
  }).format(value);
  const rate = value => value == null ? "—" : `${value.toFixed(2)}%`;
  const signedRate = value => `${value >= 0 ? "+" : ""}${value.toFixed(2)} pp`;
  const titleCase = value => value.replace(/\b\w/g, letter => letter.toUpperCase());

  function options(rows, field) {
    return [...new Set(rows.map(row => row[field]))].sort().map(value =>
      `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
    ).join("");
  }

  function renderSummary(region, element) {
    const totals = deriveTotals(region.paymentDetails);
    const metrics = [
      ["Valid Attempts", count(totals.attempts)],
      ["Successful Payments", count(totals.success)],
      ["Success Rate", rate(totals.successRate)],
      ["Attempt Amount", money(totals.attemptAmountUsd)],
      ["Success Amount", money(totals.successAmountUsd)],
      ["Failed", count(totals.failed)],
      ["Pending", count(totals.pending)],
      ["Pending >2h", count(totals.pendingOver2h)],
      ["Avg Processing", totals.avgProcessingSec == null ? "—" : `${Math.round(totals.avgProcessingSec)} sec`]
    ];
    element.innerHTML = metrics.map(([label, value]) =>
      `<div class="kpi"><span>${label}</span><strong>${value}</strong></div>`
    ).join("");
  }

  function trendPoints(values, width, height, min, max) {
    return values.map((value, index) => {
      const x = 38 + index * (width - 58) / (values.length - 1);
      const y = 18 + (max - value) / (max - min || 1) * (height - 52);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }

  function renderTrend(region, element) {
    const all = [...region.trends.SPM, ...region.trends.APM];
    const width = 680;
    const height = 220;
    const min = Math.floor((Math.min(...all) - 0.1) * 10) / 10;
    const max = Math.ceil((Math.max(...all) + 0.1) * 10) / 10;
    const labels = region.trends.dates.map((date, index) => {
      const x = 38 + index * (width - 58) / 6;
      return `<text x="${x}" y="210" text-anchor="middle" class="trend-label">${escapeHtml(date.slice(5))}</text>`;
    }).join("");
    element.innerHTML = `<div class="legend"><span class="legend-spm">SPM ${rate(region.trends.SPM.at(-1))}</span><span class="legend-apm">APM ${rate(region.trends.APM.at(-1))}</span></div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Seven day SPM and APM success-rate trend from ${min.toFixed(1)} to ${max.toFixed(1)} percent">
        <line x1="38" y1="30" x2="660" y2="30" class="trend-grid"/><line x1="38" y1="105" x2="660" y2="105" class="trend-grid"/><line x1="38" y1="180" x2="660" y2="180" class="trend-grid"/>
        <polyline points="${trendPoints(region.trends.SPM, width, height, min, max)}" class="trend-line"/><polyline points="${trendPoints(region.trends.APM, width, height, min, max)}" class="trend-line secondary"/>${labels}
      </svg>`;
  }

  function renderAging(region, element) {
    const buckets = [
      ["<5m", region.pendingAging.under5m],
      ["5–30m", region.pendingAging.from5To30m],
      ["30m–2h", region.pendingAging.from30mTo2h],
      [">2h", region.pendingAging.over2h]
    ];
    const max = Math.max(...buckets.map(([, value]) => value), 1);
    element.innerHTML = buckets.map(([label, value]) => `<div class="aging-row">
      <span>${label}</span><div class="aging-track"><i style="width:${value / max * 100}%"></i></div><strong>${count(value)}</strong>
    </div>`).join("");
  }

  function recommendedAction(row) {
    const actions = {
      timeout: "Check channel latency and bank timeout logs.",
      "bank unavailable": "Confirm bank availability and prepare channel reroute.",
      validation: "Review validation rejects and field mapping."
    };
    return actions[row.topError] || "Compare the channel and bank error breakdown.";
  }

  function renderExceptions(region, element) {
    element.innerHTML = sortExceptions(region.paymentDetails).slice(0, 5).map(row => {
      const current = currentRate(row);
      const change = current == null ? 0 : current - row.previousSr;
      return `<article class="exception-card ${escapeHtml(row.status)}">
        <div class="exception-title"><span>${escapeHtml(row.module)} · ${escapeHtml(row.channel)} → ${escapeHtml(row.destinationBank)}</span><span>${rate(current)}</span></div>
        <div class="exception-meta">Impact ${count(row.failed + row.pending)} · DoD <span class="${change < 0 ? "down" : "up"}">${signedRate(change)}</span> · ${escapeHtml(row.topError)}</div>
        <div class="exception-action">Action: ${escapeHtml(recommendedAction(row))}</div>
      </article>`;
    }).join("");
  }

  function rowHtml(row) {
    const current = currentRate(row);
    const change = current == null ? 0 : current - row.previousSr;
    return `<tr><td><span class="status-pill ${escapeHtml(row.status)}">${escapeHtml(row.module)}</span></td><td>${escapeHtml(row.channel)}</td><td>${escapeHtml(row.destinationBank)}</td><td>${count(row.attempts)}</td><td>${count(row.success)}</td><td>${rate(current)}</td><td>${money(row.attemptAmountUsd)}</td><td>${money(row.successAmountUsd)}</td><td>${count(row.failed)}</td><td>${count(row.pending)}</td><td>${count(row.pendingOver2h)}</td><td>${count(row.avgProcessingSec)} sec</td><td>${escapeHtml(row.topError)}</td><td class="${change < 0 ? "down" : "up"}">${signedRate(change)}</td></tr>`;
  }

  function totalsHtml(totals) {
    return `<tr><th colspan="3" scope="row">Visible total</th><td>${count(totals.attempts)}</td><td>${count(totals.success)}</td><td>${rate(totals.successRate)}</td><td>${money(totals.attemptAmountUsd)}</td><td>${money(totals.successAmountUsd)}</td><td>${count(totals.failed)}</td><td>${count(totals.pending)}</td><td>${count(totals.pendingOver2h)}</td><td>${totals.avgProcessingSec == null ? "—" : `${Math.round(totals.avgProcessingSec)} sec`}</td><td colspan="2">—</td></tr>`;
  }

  function summarizeAccountStatusDistribution(account) {
    const modules = new Map(account.modules.map(row => [row.module, row]));
    return account.statusDistribution.map(row => {
      const module = modules.get(row.module);
      const calculatedTotal = row.active + row.inactive + row.banned;
      if (!module || calculatedTotal !== row.total || module.active !== row.active || module.banned !== row.banned) {
        throw new Error(`${row.module} status distribution does not reconcile`);
      }
      const share = value => row.total ? value / row.total * 100 : 0;
      return {
        ...row,
        activeShare: share(row.active),
        inactiveShare: share(row.inactive),
        bannedShare: share(row.banned)
      };
    });
  }

  function renderAccount(region, element) {
    const distribution = summarizeAccountStatusDistribution(region.account).map(row => `<article class="distribution-card">
      <div class="distribution-title"><strong>${escapeHtml(row.module)}</strong><span>${count(row.total)} total</span></div>
      <div class="distribution-bar" aria-label="${escapeHtml(row.module)} status distribution">
        <i class="active" style="width:${row.activeShare}%"></i><i class="inactive" style="width:${row.inactiveShare}%"></i><i class="banned" style="width:${row.bannedShare}%"></i>
      </div>
      <div class="distribution-legend"><span><i class="key active"></i>Active ${count(row.active)} (${rate(row.activeShare)})</span><span><i class="key inactive"></i>Inactive ${count(row.inactive)} (${rate(row.inactiveShare)})</span><span><i class="key banned"></i>Banned ${count(row.banned)} (${rate(row.bannedShare)})</span></div>
    </article>`).join("");
    const cards = region.account.modules.map(row => `<article class="account-card">
      <div class="account-title"><strong>${escapeHtml(row.module)}</strong><span class="status-pill ${row.rejectRate >= 1.5 ? "watch" : "healthy"}">${rate(row.rejectRate)}</span></div>
      <dl><div><dt>New</dt><dd>${count(row.new)}</dd></div><div><dt>Active</dt><dd>${count(row.active)}</dd></div><div><dt>Checked</dt><dd>${count(row.checked)}</dd></div><div><dt>Rejected</dt><dd>${count(row.rejected)}</dd></div><div><dt>Banned</dt><dd>${count(row.banned)}</dd></div><div><dt>Default rate</dt><dd>${rate(row.defaultRate)}</dd></div></dl>
    </article>`).join("");
    const banks = [...region.account.bankExceptions].sort((a, b) => b.rejectRate - a.rejectRate).map(row =>
      `<tr><td>${escapeHtml(row.bank)}</td><td>${rate(row.rejectRate)}</td><td><span class="status-pill ${escapeHtml(row.status)}">${titleCase(row.status)}</span></td></tr>`
    ).join("");
    element.innerHTML = `<section class="account-distribution" aria-labelledby="statusDistributionHeading"><h3 id="statusDistributionHeading">Status distribution</h3><div class="distribution-grid">${distribution}</div></section><div class="account-modules">${cards}</div><div class="table-wrap compact-table"><table><caption>Bank-level account exceptions</caption><thead><tr><th scope="col">Bank</th><th scope="col">Reject Rate</th><th scope="col">Status</th></tr></thead><tbody>${banks}</tbody></table></div>`;
  }

  function incidentButtons(incident, index) {
    const buttons = {
      open: ["acknowledge", "ACK"],
      acknowledged: ["start", "Start"],
      investigating: ["recover", "Recovered"]
    };
    if (!buttons[incident.state]) return "";
    const [action, label] = buttons[incident.state];
    return `<button class="btn primary" type="button" data-incident="${index}" data-action="${action}">${label}</button>`;
  }

  function renderIncidents(region, element) {
    const activeCount = region.incidents.filter(item => item.state !== "recovered").length;
    const cards = region.incidents.length ? region.incidents.map((incident, index) => `<article class="incident ${incident.state === "recovered" ? "recovered" : ""}">
      <div class="incident-title"><span>${escapeHtml(incident.severity)} · ${escapeHtml(incident.title)}</span><span>${escapeHtml(titleCase(incident.state))}</span></div>
      <div class="incident-meta">${escapeHtml(incident.reference)} · Owner: ${escapeHtml(incident.owner)}<br>${escapeHtml(incident.impact)}<br>ACK deadline: ${escapeHtml(incident.ackDeadline.replace("T", " ").slice(0, 16))}</div>
      <div class="actions">${incidentButtons(incident, index)}</div>
    </article>`).join("") : '<p class="empty">No P0/P1 incidents.</p>';
    element.innerHTML = `<div class="incident-count" role="status" aria-live="polite">${activeCount} open P0/P1</div><div class="incident-list">${cards}</div>`;
  }

  function renderFreshness(region, element) {
    element.innerHTML = region.freshness.map(item => `<div class="source"><span>${escapeHtml(item.source)}</span><strong class="${escapeHtml(item.state)}">${escapeHtml(item.state.toUpperCase())}</strong><small>Updated ${escapeHtml(item.updatedAt.replace("T", " ").slice(0, 16))}</small></div>`).join("");
  }

  function renderMetadata(metadata, region, elements) {
    elements.title.textContent = `${elements.code} · ${region.name}`;
    elements.health.innerHTML = `<span class="dot"></span>${titleCase(region.health.status)} · ${region.health.score}/100`;
    elements.health.className = `badge ${region.health.status}`;
    elements.subtitle.textContent = region.health.summary;
    elements.metadata.textContent = `Business date ${metadata.businessDate} · Generated ${metadata.generatedAt.replace("T", " ").slice(0, 16)} ${metadata.timezone}`;
    const ready = region.freshness.every(item => item.state === "ready");
    elements.readiness.textContent = ready ? "DATA READY" : "DATA DELAYED";
    elements.readiness.className = `badge ${ready ? "ready" : "delayed"}`;
  }

  function createRegionApp(elements, fetcher) {
    let region;
    function filters() {
      return {
        module: elements.moduleFilter.value,
        channel: elements.channelFilter.value,
        destinationBank: elements.bankFilter.value,
        status: elements.statusFilter.value
      };
    }
    function renderTable() {
      const visible = sortExceptions(filterRows(region.paymentDetails, filters()));
      elements.tableBody.innerHTML = visible.map(rowHtml).join("") || '<tr><td colspan="14" class="empty">No rows match all selected filters.</td></tr>';
      elements.tableTotals.innerHTML = totalsHtml(deriveTotals(visible));
      const reconciled = visible.length === region.paymentDetails.length;
      elements.reconciliation.textContent = reconciled
        ? `Reconciled: all ${visible.length} detail rows equal the payment summary.`
        : `Filtered view: ${visible.length} of ${region.paymentDetails.length} rows. Visible totals shown below.`;
    }
    function onIncidentClick(event) {
      const button = event.target.closest("button[data-incident]");
      if (!button) return;
      transitionIncident(region.incidents[Number(button.dataset.incident)], button.dataset.action);
      renderIncidents(region, elements.incidents);
    }
    async function load() {
      try {
        const response = await fetcher("../assets/mock-data.json");
        if (!response.ok) throw new Error(`Data request failed (${response.status})`);
        const data = await response.json();
        region = data.regions[elements.code];
        if (!region) throw new Error(`Unknown region ${elements.code}`);
        renderMetadata(data.metadata, region, elements);
        renderSummary(region, elements.paymentSummary);
        renderTrend(region, elements.trend);
        renderAging(region, elements.pendingAging);
        renderExceptions(region, elements.exceptions);
        renderAccount(region, elements.accountHealth);
        renderIncidents(region, elements.incidents);
        renderFreshness(region, elements.freshness);
        elements.moduleFilter.insertAdjacentHTML("beforeend", options(region.paymentDetails, "module"));
        elements.channelFilter.insertAdjacentHTML("beforeend", options(region.paymentDetails, "channel"));
        elements.bankFilter.insertAdjacentHTML("beforeend", options(region.paymentDetails, "destinationBank"));
        renderTable();
        elements.loading.hidden = true;
        return true;
      } catch (error) {
        elements.loading.hidden = true;
        elements.error.hidden = false;
        elements.error.textContent = `Unable to load dashboard data. ${error.message}`;
        return false;
      }
    }
    [elements.moduleFilter, elements.channelFilter, elements.bankFilter, elements.statusFilter]
      .forEach(select => select.addEventListener("change", renderTable));
    elements.incidents.addEventListener("click", onIncidentClick);
    return { load, renderTable };
  }

  function start() {
    const code = document.body.dataset.region;
    const byId = id => document.getElementById(id);
    createRegionApp({
      code,
      title: byId("regionTitle"), subtitle: byId("regionSubtitle"), health: byId("healthBadge"),
      metadata: byId("reportMetadata"), readiness: byId("readinessBadge"), loading: byId("loadingState"), error: byId("errorState"),
      paymentSummary: byId("paymentSummary"), trend: byId("trend"), pendingAging: byId("pendingAging"), exceptions: byId("exceptions"),
      moduleFilter: byId("moduleFilter"), channelFilter: byId("channelFilter"), bankFilter: byId("bankFilter"), statusFilter: byId("statusFilter"),
      tableBody: byId("paymentDetailsBody"), tableTotals: byId("paymentDetailsTotals"), reconciliation: byId("reconciliation"),
      accountHealth: byId("accountHealth"), incidents: byId("incidents"), freshness: byId("freshness")
    }, fetch).load();
  }

  return { createRegionApp, deriveTotals, filterRows, sortExceptions, start, summarizeAccountStatusDistribution, transitionIncident };
}));
