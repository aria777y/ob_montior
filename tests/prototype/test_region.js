"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const {
  createRegionApp,
  describePaymentRate,
  summarizeAccountStatusDistribution,
  deriveTotals,
  filterRows,
  sortExceptions,
  safeStateClass,
  transitionIncident
} = require("../../prototype/assets/region.js");

const fixture = JSON.parse(readFileSync(
  join(__dirname, "../../prototype/assets/mock-data.json"),
  "utf8"
));

function element({ hidden = false, value = "all" } = {}) {
  const listeners = {};
  return {
    className: "",
    disabled: false,
    hidden,
    innerHTML: "",
    textContent: "",
    value,
    addEventListener(type, handler) { listeners[type] = handler; },
    emit(type, event = { target: this }) {
      if (listeners[type]) listeners[type](event);
    },
    insertAdjacentHTML(_position, html) { this.innerHTML += html; }
  };
}

function appElements(code = "ID") {
  return {
    code,
    title: element(), subtitle: element(), health: element(), metadata: element(),
    readiness: element(), loading: element(), error: element({ hidden: true }),
    paymentSummary: element(), trend: element(), pendingAging: element(), exceptions: element(),
    moduleFilter: element(), channelFilter: element(), bankFilter: element(), statusFilter: element(),
    tableBody: element(), tableTotals: element(), reconciliation: element(),
    accountHealth: element(), incidents: element(), freshness: element()
  };
}

function incidentClick(elements, action) {
  elements.incidents.emit("click", {
    target: {
      closest: () => ({ dataset: { incident: "0", action } })
    }
  });
}

test("deriveTotals reconciles ID detail rows", () => {
  const totals = deriveTotals(fixture.regions.ID.paymentDetails);
  assert.equal(totals.attempts, 190000);
  assert.equal(totals.success, 187870);
  assert.equal(totals.failed, 1435);
  assert.equal(totals.pending, 695);
  assert.equal(totals.pendingOver2h, 135);
  assert.ok(Math.abs(totals.successRate - 187870 / 190000 * 100) < 1e-12);
});

test("combined filters narrow by module, channel, bank and status", () => {
  const rows = fixture.regions.ID.paymentDetails;
  assert.deepEqual(
    filterRows(rows, {
      module: "APM",
      channel: "Channel Alpha",
      destinationBank: "Bank Central",
      status: "watch"
    }).map(row => row.destinationBank),
    ["Bank Central"]
  );
  assert.equal(filterRows(rows, {
    module: "SPM",
    channel: "Channel Alpha",
    destinationBank: "Bank Central",
    status: "all"
  }).length, 0);
});

test("exceptions sort by impact then SR degradation", () => {
  const rows = [
    { attempts: 100, success: 98, failed: 1, pending: 1, previousSr: 99 },
    { attempts: 100, success: 95, failed: 3, pending: 2, previousSr: 96 },
    { attempts: 100, success: 94, failed: 3, pending: 2, previousSr: 99 }
  ];
  assert.deepEqual(sortExceptions(rows), [rows[2], rows[1], rows[0]]);
});

test("incident transitions preserve a consistent state machine", () => {
  const incident = { state: "open" };
  transitionIncident(incident, "acknowledge");
  assert.equal(incident.state, "acknowledged");
  transitionIncident(incident, "start");
  assert.equal(incident.state, "investigating");
  transitionIncident(incident, "recover");
  assert.equal(incident.state, "recovered");
  assert.throws(() => transitionIncident(incident, "start"), /Invalid incident transition/);
});

test("account status distribution reconciles and exposes shares", () => {
  const rows = summarizeAccountStatusDistribution(fixture.regions.ID.account);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].module, "SPBA");
  assert.equal(rows[0].total, rows[0].active + rows[0].inactive + rows[0].banned);
  assert.ok(Math.abs(rows[0].activeShare + rows[0].inactiveShare + rows[0].bannedShare - 100) < 1e-9);

  const invalid = structuredClone(fixture.regions.ID.account);
  invalid.statusDistribution[0].total += 1;
  assert.throws(
    () => summarizeAccountStatusDistribution(invalid),
    /status distribution does not reconcile/
  );
});

test("zero-attempt rows expose neutral empty SR and DoD labels", () => {
  assert.deepEqual(
    describePaymentRate({ attempts: 0, success: 0, previousSr: 99 }),
    { current: null, change: null, currentLabel: "—", changeLabel: "—", changeClass: "neutral" }
  );
});

test("zero-attempt detail and exception DOM render empty neutral rates", async () => {
  const elements = appElements();
  const data = structuredClone(fixture);
  Object.assign(data.regions.ID.paymentDetails[0], {
    attempts: 0, success: 0, failed: 0, pending: 0, pendingOver2h: 0,
    attemptAmountUsd: 0, successAmountUsd: 0
  });
  const app = createRegionApp(elements, async () => ({ ok: true, json: async () => data }));
  assert.equal(await app.load(), true);
  assert.match(elements.tableBody.innerHTML, /Bank Nusantara.*<td>—<\/td>.*class="neutral">—<\/td>/);
  assert.match(elements.exceptions.innerHTML, /Bank Nusantara[\s\S]*DoD <span class="neutral">—<\/span>/);
});

test("safeStateClass only returns allow-listed CSS states", () => {
  assert.equal(safeStateClass("critical"), "critical");
  assert.equal(safeStateClass('\"><img src=x>'), "unknown");
});

test("createRegionApp disables controls until success and combines filters with visible totals", async () => {
  const elements = appElements();
  const app = createRegionApp(elements, async () => ({
    ok: true,
    json: async () => structuredClone(fixture)
  }));
  const controls = [elements.moduleFilter, elements.channelFilter, elements.bankFilter, elements.statusFilter];
  assert.equal(controls.every(control => control.disabled), true);

  assert.equal(await app.load(), true);
  assert.equal(controls.every(control => !control.disabled), true);
  elements.moduleFilter.value = "APM";
  elements.channelFilter.value = "Channel Alpha";
  elements.bankFilter.value = "Bank Central";
  elements.statusFilter.value = "watch";
  elements.statusFilter.emit("change");

  assert.match(elements.tableBody.innerHTML, /Bank Central/);
  assert.doesNotMatch(elements.tableBody.innerHTML, /Bank Nusantara/);
  assert.match(elements.tableTotals.innerHTML, /35,000/);
  assert.equal(elements.reconciliation.textContent, "Filtered view: 1 of 4 rows. Visible totals shown below.");
});

test("createRegionApp keeps failed controls disabled and pre-load events safe", async () => {
  const elements = appElements();
  const app = createRegionApp(elements, async () => { throw new Error("offline"); });

  assert.doesNotThrow(() => elements.moduleFilter.emit("change"));
  assert.doesNotThrow(() => elements.incidents.emit("click", { target: { closest: () => null } }));
  assert.equal(await app.load(), false);
  assert.equal([elements.moduleFilter, elements.channelFilter, elements.bankFilter, elements.statusFilter].every(control => control.disabled), true);
  assert.equal(elements.error.hidden, false);
});

test("incident controls keep DOM state and open count consistent through recovery", async () => {
  const elements = appElements();
  const data = structuredClone(fixture);
  const app = createRegionApp(elements, async () => ({ ok: true, json: async () => data }));
  await app.load();

  assert.match(elements.incidents.innerHTML, /1 open P0\/P1/);
  assert.match(elements.incidents.innerHTML, />ACK<\/button>/);
  incidentClick(elements, "acknowledge");
  assert.match(elements.incidents.innerHTML, /Acknowledged/);
  assert.match(elements.incidents.innerHTML, />Start<\/button>/);
  assert.match(elements.incidents.innerHTML, /1 open P0\/P1/);
  incidentClick(elements, "start");
  assert.match(elements.incidents.innerHTML, /Investigating/);
  incidentClick(elements, "recover");
  assert.match(elements.incidents.innerHTML, /Recovered/);
  assert.match(elements.incidents.innerHTML, /0 open P0\/P1/);
});

test("JSON-backed text is escaped and dynamic classes reject injected states", async () => {
  const elements = appElements();
  const data = structuredClone(fixture);
  const region = data.regions.ID;
  region.health.status = '\"><img src=x>';
  region.paymentDetails[0].channel = "<img src=x>";
  region.paymentDetails[0].status = "evil injected";
  region.incidents[0].title = "<svg onload=bad>";
  region.freshness[0].state = "ready injected";
  const app = createRegionApp(elements, async () => ({ ok: true, json: async () => data }));

  assert.equal(await app.load(), true);
  assert.equal(elements.health.className, "badge unknown");
  assert.doesNotMatch(elements.tableBody.innerHTML, /<img/);
  assert.doesNotMatch(elements.exceptions.innerHTML, /<img/);
  assert.doesNotMatch(elements.incidents.innerHTML, /<svg/);
  assert.doesNotMatch(elements.freshness.innerHTML, /class="ready injected"/);
  assert.match(elements.tableBody.innerHTML, /&lt;img src=x&gt;/);
});
