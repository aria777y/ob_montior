"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const {
  summarizeAccountStatusDistribution,
  deriveTotals,
  filterRows,
  sortExceptions,
  transitionIncident
} = require("../../prototype/assets/region.js");

const fixture = JSON.parse(readFileSync(
  join(__dirname, "../../prototype/assets/mock-data.json"),
  "utf8"
));

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
