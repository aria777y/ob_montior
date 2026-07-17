"use strict";

const cards = document.querySelector("#regionCards");
const loadingState = document.querySelector("#loadingState");
const errorState = document.querySelector("#errorState");
const reportMetadata = document.querySelector("#reportMetadata");
const readinessSummary = document.querySelector("#readinessSummary");

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

function hasReadySources(region) {
  return region.freshness.length > 0
    && region.freshness.every(source => source.state.toLowerCase() === "ready");
}

function regionMetrics(region) {
  const attempts = sum(region.paymentDetails, "attempts");
  const successful = sum(region.paymentDetails, "success");
  const paymentAmount = sum(region.paymentDetails, "attemptAmountUsd");
  const pendingOver2h = sum(region.paymentDetails, "pendingOver2h");
  const checkedAccounts = sum(region.account.modules, "checked");
  const rejectedAccounts = sum(region.account.modules, "rejected");
  const openIncidents = region.incidents.filter(
    incident => ["P0", "P1"].includes(incident.severity.toUpperCase())
      && incident.state.toUpperCase() !== "RECOVERED"
  ).length;

  return {
    paymentSuccessRate: attempts ? 100 * successful / attempts : 0,
    paymentAmount,
    pendingOver2h,
    accountRejectRate: checkedAccounts ? 100 * rejectedAccounts / checkedAccounts : 0,
    openIncidents,
    readiness: hasReadySources(region) ? "READY" : "DELAYED"
  };
}

function metricLine(label, value) {
  return `<div class="metric-line"><span>${label}</span><strong>${value}</strong></div>`;
}

function regionCard(code, region) {
  const metrics = regionMetrics(region);
  const status = region.health.status.toLowerCase();
  const accessibleName = `View ${region.name} (${code}) operations dashboard, ${status}, health score ${region.health.score}`;

  return `
    <a class="card region ${escapeHtml(status)}" href="regions/${code.toLowerCase()}.html" aria-label="${escapeHtml(accessibleName)}">
      <div class="region-head">
        <span class="region-name">${escapeHtml(code)} · ${escapeHtml(region.name)}</span>
        <span class="health">${escapeHtml(status.toUpperCase())}</span>
      </div>
      <div class="score"><span class="sr-only">Health score </span>${countFormatter.format(region.health.score)}</div>
      ${metricLine("Payment Success Rate", `${metrics.paymentSuccessRate.toFixed(2)}%`)}
      ${metricLine("Payment Amount", currencyFormatter.format(metrics.paymentAmount))}
      ${metricLine("Pending &gt;2h", countFormatter.format(metrics.pendingOver2h))}
      ${metricLine("Account Reject Rate", `${metrics.accountRejectRate.toFixed(2)}%`)}
      ${metricLine("Open P0/P1", countFormatter.format(metrics.openIncidents))}
      ${metricLine("Readiness", metrics.readiness)}
    </a>`;
}

function render(data) {
  const regions = Object.entries(data.regions);
  if (!regions.length) {
    throw new Error("No regional data available");
  }

  cards.innerHTML = regions.map(([code, region]) => regionCard(code, region)).join("");
  cards.setAttribute("aria-busy", "false");
  loadingState.hidden = true;

  const readyCount = regions.filter(([, region]) => hasReadySources(region)).length;
  readinessSummary.innerHTML = `<span class="dot"></span>DATA READY · ${readyCount}/${regions.length}`;
  reportMetadata.textContent = `Business Date: ${data.metadata.businessDate} · Generated: ${new Date(data.metadata.generatedAt).toLocaleString("en-US", { timeZone: data.metadata.timezone })}`;
}

function showLoadError() {
  loadingState.hidden = true;
  errorState.hidden = false;
  cards.replaceChildren();
  cards.setAttribute("aria-busy", "false");
  readinessSummary.innerHTML = '<span class="dot"></span>DATA UNAVAILABLE';
  readinessSummary.classList.add("down");
}

fetch("assets/mock-data.json")
  .then(response => {
    if (!response.ok) {
      throw new Error(`Data request failed with status ${response.status}`);
    }
    return response.json();
  })
  .then(render)
  .catch(showLoadError);
