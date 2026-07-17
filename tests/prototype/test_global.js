"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const {
  createOverviewApp,
  formatRate,
  summarizeReadiness,
  summarizeRegion
} = require("../../prototype/assets/global.js");

const fixture = JSON.parse(readFileSync(
  join(__dirname, "../../prototype/assets/mock-data.json"),
  "utf8"
));

function classList(...initial) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    contains: name => values.has(name),
    remove: (...names) => names.forEach(name => values.delete(name))
  };
}

function element({ hidden = false, classes = [] } = {}) {
  return {
    hidden,
    innerHTML: "",
    textContent: "",
    classList: classList(...classes),
    attributes: {},
    replaceChildren() { this.innerHTML = ""; },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

function elements() {
  return {
    cards: element(),
    loadingState: element(),
    errorState: element({ hidden: true }),
    reportMetadata: element(),
    readinessSummary: element({ classes: ["badge", "ready"] })
  };
}

test("summarizeRegion derives current fixture totals from detail rows", () => {
  const summary = summarizeRegion(fixture.regions.ID);

  assert.ok(Math.abs(summary.paymentSuccessRate - 187870 / 190000 * 100) < 1e-12);
  assert.equal(summary.paymentAmount, 8420000);
  assert.equal(summary.pendingOver2h, 135);
  assert.ok(Math.abs(summary.accountRejectRate - 271 / 16100 * 100) < 1e-12);
  assert.equal(summary.openIncidents, 1);
  assert.equal(summary.readiness, "READY");
});

test("summarizeReadiness labels partial readiness as delayed", () => {
  const summary = summarizeReadiness({
    ID: fixture.regions.ID,
    VN: fixture.regions.VN
  });

  assert.deepEqual(summary, {
    label: "DATA DELAYED · 1/2",
    readyCount: 1,
    state: "delayed",
    total: 2
  });
});

test("zero denominators display an em dash and inconsistent data is rejected", async () => {
  const empty = structuredClone(fixture.regions.MY);
  empty.paymentDetails = empty.paymentDetails.map(row => ({
    ...row,
    attempts: 0,
    success: 0,
    attemptAmountUsd: 0,
    failed: 0,
    pending: 0,
    pendingOver2h: 0
  }));
  empty.account.modules = empty.account.modules.map(row => ({
    ...row,
    checked: 0,
    rejected: 0
  }));

  const summary = summarizeRegion(empty);
  assert.equal(summary.paymentSuccessRate, null);
  assert.equal(summary.accountRejectRate, null);
  assert.equal(formatRate(summary.paymentSuccessRate), "—");
  assert.equal(formatRate(summary.accountRejectRate), "—");

  const ui = elements();
  const emptyFixture = structuredClone(fixture);
  emptyFixture.regions = { MY: empty };
  const app = createOverviewApp(ui, async () => ({
    ok: true,
    json: async () => emptyFixture
  }));
  assert.equal(await app.load(), true);
  assert.match(
    ui.cards.innerHTML,
    /Payment Success Rate<\/span><strong>—<\/strong>/
  );
  assert.match(
    ui.cards.innerHTML,
    /Account Reject Rate<\/span><strong>—<\/strong>/
  );

  empty.account.modules[0].rejected = 1;
  assert.throws(() => summarizeRegion(empty), /rejected accounts cannot exceed checked accounts/);
});

test("successful load renders cards and delayed readiness state", async () => {
  const ui = elements();
  const app = createOverviewApp(ui, async () => ({
    ok: true,
    json: async () => fixture
  }));

  assert.equal(await app.load(), true);
  assert.equal(ui.loadingState.hidden, true);
  assert.equal(ui.errorState.hidden, true);
  assert.equal(ui.cards.attributes["aria-busy"], "false");
  assert.match(ui.cards.innerHTML, /ID · Indonesia/);
  assert.match(ui.cards.innerHTML, /98\.88%/);
  assert.match(ui.readinessSummary.innerHTML, /DATA DELAYED · 3\/4/);
  assert.equal(ui.readinessSummary.classList.contains("delayed"), true);
  assert.equal(ui.readinessSummary.classList.contains("ready"), false);
});

test("failed fetch exposes the error state without rejecting", async () => {
  const ui = elements();
  const app = createOverviewApp(ui, async () => {
    throw new Error("offline");
  });

  assert.equal(await app.load(), false);
  assert.equal(ui.loadingState.hidden, true);
  assert.equal(ui.errorState.hidden, false);
  assert.equal(ui.cards.innerHTML, "");
  assert.equal(ui.cards.attributes["aria-busy"], "false");
  assert.match(ui.readinessSummary.innerHTML, /DATA UNAVAILABLE/);
});
