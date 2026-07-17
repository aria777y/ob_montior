# OB Region Dashboard HTML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-screen prototype with a Global Overview and four detailed region dashboards, including complete `Channel × Destination Bank` payment analysis.

**Architecture:** Static HTML pages share one stylesheet, one mock-data JSON file and focused JavaScript renderers. `index.html` renders global health; four small region wrappers identify the region and load the same region renderer. All totals, exceptions and filters derive from the same detail rows so the prototype remains internally consistent.

**Tech Stack:** Semantic HTML5, CSS, vanilla JavaScript, inline SVG, JSON mock data, Python stdlib tests, in-app browser verification.

---

## File map

```text
prototype/
├── index.html
├── regions/id.html
├── regions/my.html
├── regions/th.html
├── regions/vn.html
└── assets/
    ├── styles.css
    ├── mock-data.json
    ├── global.js
    └── region.js
tests/prototype/test_static_site.py
```

### Task 1: Create shared data, styles and structural tests

**Files:**
- Create: `prototype/assets/mock-data.json`
- Create: `prototype/assets/styles.css`
- Create: `tests/prototype/test_static_site.py`
- Modify: `prototype/index.html`

- [ ] **Step 1: Write failing structure/data tests**

```python
import json
from pathlib import Path

ROOT = Path(__file__).parents[2]
PROTOTYPE = ROOT / "prototype"


def test_four_regions_have_payment_detail():
    data = json.loads((PROTOTYPE / "assets/mock-data.json").read_text())
    assert set(data["regions"]) == {"ID", "MY", "TH", "VN"}
    for code, region in data["regions"].items():
        assert len(region["paymentDetails"]) >= 4, code
        for row in region["paymentDetails"]:
            assert row["module"] in {"SPM", "APM"}
            assert row["channel"] and row["destinationBank"]


def test_no_prohibited_pii_keys():
    text = (PROTOTYPE / "assets/mock-data.json").read_text().lower()
    for key in ("accountnumber", "payee", "phone", "userid", "paymentid", "idnumber"):
        assert key not in text
```

- [ ] **Step 2: Run tests and verify failure**

Run: `python3 -m unittest discover -s tests/prototype -p 'test_*.py' -v`  
Expected: failure because `prototype/assets/mock-data.json` does not exist.

- [ ] **Step 3: Add the shared data contract and stylesheet**

`mock-data.json` contains global metadata plus ID/MY/TH/VN objects. Every region includes `health`, `paymentDetails`, seven-day `trends`, pending-aging buckets, `account`, `incidents` and `freshness`. Every payment-detail row contains:

```json
{
  "module": "SPM",
  "channel": "Channel Alpha",
  "destinationBank": "Bank A",
  "attempts": 1000,
  "success": 990,
  "attemptAmountUsd": 250000,
  "successAmountUsd": 247500,
  "failed": 6,
  "pending": 4,
  "pendingOver2h": 1,
  "avgProcessingSec": 42,
  "topError": "timeout",
  "previousSr": 99.4,
  "status": "watch"
}
```

The stylesheet moves all reusable styles out of the current inline page and defines responsive region cards, KPI cards, exception cards, filters, tables, trend SVG, focus states and mobile breakpoints.

- [ ] **Step 4: Run tests**

Run: `python3 -m unittest discover -s tests/prototype -p 'test_*.py' -v`  
Expected: data-contract and PII tests pass.

- [ ] **Step 5: Commit**

```bash
git add prototype tests/prototype
git commit -m "feat: add shared regional dashboard data"
```

### Task 2: Build the Global Overview

**Files:**
- Modify: `prototype/index.html`
- Create: `prototype/assets/global.js`
- Modify: `tests/prototype/test_static_site.py`

- [ ] **Step 1: Add failing navigation assertions**

```python
def test_global_page_links_every_region():
    html = (PROTOTYPE / "index.html").read_text()
    for code in ("id", "my", "th", "vn"):
        assert f'href="regions/{code}.html"' in html
    for label in ("Payment Success Rate", "Payment Amount", "Pending >2h", "Account Reject Rate", "Open P0/P1"):
        assert label in html
```

- [ ] **Step 2: Run the targeted test and verify failure**

Run: `python3 -m unittest tests.prototype.test_static_site.test_global_page_links_every_region -v`  
Expected: failure because independent region links do not exist.

- [ ] **Step 3: Implement the overview**

`index.html` contains the shell, loading/error state and a `#regionCards` container. `global.js` fetches `assets/mock-data.json` and renders one link-card per region with health, payment SR/amount, pending over two hours, account reject rate, open P0/P1 and readiness. It derives totals from payment detail instead of storing duplicate overview totals.

- [ ] **Step 4: Run tests and serve the page**

Run: `python3 -m unittest discover -s tests/prototype -p 'test_*.py' -v`  
Expected: all structure tests pass.

- [ ] **Step 5: Commit**

```bash
git add prototype/index.html prototype/assets/global.js tests/prototype/test_static_site.py
git commit -m "feat: add global OB operations overview"
```

### Task 3: Build four detailed region dashboards

**Files:**
- Create: `prototype/regions/id.html`
- Create: `prototype/regions/my.html`
- Create: `prototype/regions/th.html`
- Create: `prototype/regions/vn.html`
- Create: `prototype/assets/region.js`
- Modify: `tests/prototype/test_static_site.py`

- [ ] **Step 1: Add failing region-page assertions**

```python
def test_region_pages_use_shared_renderer_and_required_sections():
    for code in ("id", "my", "th", "vn"):
        html = (PROTOTYPE / f"regions/{code}.html").read_text()
        assert f'data-region="{code.upper()}"' in html
        assert '../assets/region.js' in html
        for element_id in ("paymentSummary", "trend", "pendingAging", "exceptions", "paymentDetails", "accountHealth", "incidents", "freshness"):
            assert f'id="{element_id}"' in html
```

- [ ] **Step 2: Run the targeted test and verify failure**

Run: `python3 -m unittest tests.prototype.test_static_site.test_region_pages_use_shared_renderer_and_required_sections -v`  
Expected: failure because region pages do not exist.

- [ ] **Step 3: Implement shared region rendering**

Each region wrapper sets `<body data-region="ID|MY|TH|VN">`, supplies semantic containers and loads `../assets/region.js`. `region.js`:

- Fetches shared data and selects the body region.
- Derives payment summary from complete payment-detail rows.
- Draws SPM/APM seven-day SVG trends and pending-aging bars.
- Sorts Top 5 exceptions by affected count, then SR degradation.
- Renders the complete detail table with all required columns.
- Applies Module, Channel, Destination Bank and Status filters together.
- Shows visible-row totals and a reconciliation message.
- Renders account health, P0/P1 incidents and freshness.
- Mutates incident state in memory and re-renders counts consistently.

- [ ] **Step 4: Run static tests**

Run: `python3 -m unittest discover -s tests/prototype -p 'test_*.py' -v`  
Expected: all data, page, link, PII and semantic-structure tests pass.

- [ ] **Step 5: Commit**

```bash
git add prototype/regions prototype/assets/region.js tests/prototype/test_static_site.py
git commit -m "feat: add detailed regional operations dashboards"
```

### Task 4: Browser verification and final cleanup

**Files:**
- Modify: `prototype/assets/styles.css`
- Modify: `prototype/assets/global.js`
- Modify: `prototype/assets/region.js`
- Modify: `tests/prototype/test_static_site.py`

- [ ] **Step 1: Add reconciliation and asset-link tests**

```python
def test_pages_reference_existing_local_assets():
    pages = [PROTOTYPE / "index.html", *(PROTOTYPE / "regions").glob("*.html")]
    for page in pages:
        html = page.read_text()
        assert "Demo data only" in html
        assert "<caption" in html
        assert 'scope="col"' in html
```

- [ ] **Step 2: Run full tests before browser verification**

Run: `python3 -m unittest discover -s tests/prototype -p 'test_*.py' -v && git diff --check`  
Expected: all tests pass and diff check is clean.

- [ ] **Step 3: Verify browser behavior**

Serve with `python3 -m http.server 8765 --bind 127.0.0.1 -d prototype`. Verify Global → each Region navigation, combined filters, Top 5/detail consistency, totals reconciliation, ACK/Start/Recovered state, direct SPM/APM/APBA/Grafana links and zero console errors. Check desktop and a narrow viewport.

- [ ] **Step 4: Run final verification**

Run: `python3 -m unittest discover -s tests/prototype -p 'test_*.py' -v && git diff --check`  
Expected: all tests pass with no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add prototype tests/prototype
git commit -m "test: verify regional dashboard prototype"
```

