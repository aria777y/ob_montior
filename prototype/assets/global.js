"use strict";

const countFormatter = new Intl.NumberFormat("en-US");
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "code",
  maximumFractionDigits: 0
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + row[field], 0);
}

function calculateRate(numerator, denominator, numeratorLabel, denominatorLabel) {
  if (numerator > denominator) {
    throw new Error(`${numeratorLabel} cannot exceed ${denominatorLabel}`);
  }
  return denominator === 0 ? null : 100 * numerator / denominator;
}

function formatRate(rate) {
  return rate === null ? "—" : `${rate.toFixed(2)}%`;
}

function hasReadySources(region) {
  return Array.isArray(region.freshness)
    && region.freshness.length > 0
    && region.freshness.every(source => source.state.toLowerCase() === "ready");
}

function summarizeRegion(region) {
  region.paymentDetails.forEach(row => {
    calculateRate(row.success, row.attempts, "successful payments", "attempts");
  });
  region.account.modules.forEach(row => {
    calculateRate(row.rejected, row.checked, "rejected accounts", "checked accounts");
  });

  const attempts = sum(region.paymentDetails, "attempts");
  const successful = sum(region.paymentDetails, "success");
  const checkedAccounts = sum(region.account.modules, "checked");
  const rejectedAccounts = sum(region.account.modules, "rejected");
  const openIncidents = region.incidents.filter(
    incident => ["P0", "P1"].includes(incident.severity.toUpperCase())
      && incident.state.toUpperCase() !== "RECOVERED"
  ).length;

  return {
    paymentSuccessRate: calculateRate(
      successful,
      attempts,
      "successful payments",
      "attempts"
    ),
    paymentAmount: sum(region.paymentDetails, "attemptAmountUsd"),
    pendingOver2h: sum(region.paymentDetails, "pendingOver2h"),
    accountRejectRate: calculateRate(
      rejectedAccounts,
      checkedAccounts,
      "rejected accounts",
      "checked accounts"
    ),
    openIncidents,
    readiness: hasReadySources(region) ? "READY" : "DELAYED"
  };
}

function summarizeReadiness(regions) {
  const values = Object.values(regions);
  const readyCount = values.filter(hasReadySources).length;
  const total = values.length;
  const state = total > 0 && readyCount === total ? "ready" : "delayed";

  return {
    label: `DATA ${state.toUpperCase()} · ${readyCount}/${total}`,
    readyCount,
    state,
    total
  };
}

function metricLine(label, value) {
  return `<div class="metric-line"><span>${label}</span><strong>${value}</strong></div>`;
}

function regionCard(code, region) {
  const metrics = summarizeRegion(region);
  const status = region.health.status.toLowerCase();
  const accessibleName = `View ${region.name} (${code}) operations dashboard, ${status}, health score ${region.health.score}`;

  return `
    <a class="card region ${escapeHtml(status)}" href="regions/${code.toLowerCase()}.html" aria-label="${escapeHtml(accessibleName)}">
      <div class="region-head">
        <span class="region-name">${escapeHtml(code)} · ${escapeHtml(region.name)}</span>
        <span class="health">${escapeHtml(status.toUpperCase())}</span>
      </div>
      <div class="score"><span class="sr-only">Health score </span>${countFormatter.format(region.health.score)}</div>
      ${metricLine("Payment Success Rate", formatRate(metrics.paymentSuccessRate))}
      ${metricLine("Payment Amount", currencyFormatter.format(metrics.paymentAmount))}
      ${metricLine("Pending &gt;2h", countFormatter.format(metrics.pendingOver2h))}
      ${metricLine("Account Reject Rate", formatRate(metrics.accountRejectRate))}
      ${metricLine("Open P0/P1", countFormatter.format(metrics.openIncidents))}
      ${metricLine("Readiness", metrics.readiness)}
    </a>`;
}

function updateReadiness(element, state, label) {
  element.classList.remove("ready", "delayed");
  element.classList.add(state);
  element.innerHTML = `<span class="dot"></span>${label}`;
}

function createOverviewApp(elements, fetchData) {
  function render(data) {
    const regions = Object.entries(data.regions);
    if (!regions.length) {
      throw new Error("No regional data available");
    }

    elements.cards.innerHTML = regions
      .map(([code, region]) => regionCard(code, region))
      .join("");
    elements.cards.setAttribute("aria-busy", "false");
    elements.loadingState.hidden = true;
    elements.errorState.hidden = true;

    const readiness = summarizeReadiness(data.regions);
    updateReadiness(elements.readinessSummary, readiness.state, readiness.label);
    elements.reportMetadata.textContent = `Business Date: ${data.metadata.businessDate} · Generated: ${new Date(data.metadata.generatedAt).toLocaleString("en-US", { timeZone: data.metadata.timezone })}`;
  }

  function showLoadError() {
    elements.loadingState.hidden = true;
    elements.errorState.hidden = false;
    elements.cards.replaceChildren();
    elements.cards.setAttribute("aria-busy", "false");
    updateReadiness(elements.readinessSummary, "delayed", "DATA UNAVAILABLE");
  }

  async function load() {
    try {
      const response = await fetchData("assets/mock-data.json");
      if (!response.ok) {
        throw new Error(`Data request failed with status ${response.status}`);
      }
      render(await response.json());
      return true;
    } catch (_error) {
      showLoadError();
      return false;
    }
  }

  return { load };
}

const publicApi = {
  createOverviewApp,
  formatRate,
  summarizeReadiness,
  summarizeRegion
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = publicApi;
}

if (typeof document !== "undefined") {
  createOverviewApp({
    cards: document.querySelector("#regionCards"),
    loadingState: document.querySelector("#loadingState"),
    errorState: document.querySelector("#errorState"),
    reportMetadata: document.querySelector("#reportMetadata"),
    readinessSummary: document.querySelector("#readinessSummary")
  }, window.fetch.bind(window)).load();
}
