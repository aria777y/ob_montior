# OB Monitoring V1 Lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reduced OB monitoring service: a 10:00 BJT four-region T+1 report, Grafana P0/P1 alerts, SeaTalk incident handling and strict data-readiness/PII protection.

**Architecture:** One Python service owns scheduling, source adapters, readiness checks, metric calculation, incident state and report/message rendering. PostgreSQL persists batches, source status, rules, incidents and delivery attempts. Production source integrations remain behind narrow interfaces so fixture adapters can deliver an end-to-end MVP before internal credentials are available.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, PostgreSQL 16, APScheduler, httpx, Jinja2, pytest, Ruff, mypy, Docker Compose.

---

## Scope guard

The implementation contains no frontend funnel, TMS ingestion, IS monitoring, P2/P3 queue, dynamic baseline, auto-tuning, weekly report or rule-management UI. A pull request that adds one of those capabilities is out of scope for V1 Lite.

## Target structure

```text
ob_montior/
├── pyproject.toml
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── alembic.ini
├── alembic/versions/0001_initial.py
├── config/
│   ├── metrics.yaml
│   ├── rules.yaml
│   ├── routing.yaml
│   └── sources.yaml
├── src/ob_monitoring/
│   ├── __init__.py
│   ├── main.py
│   ├── settings.py
│   ├── domain.py
│   ├── db.py
│   ├── models.py
│   ├── adapters/base.py
│   ├── adapters/fixture.py
│   ├── adapters/grafana.py
│   ├── adapters/hive.py
│   ├── adapters/seatalk.py
│   ├── services/readiness.py
│   ├── services/metrics.py
│   ├── services/rules.py
│   ├── services/incidents.py
│   ├── services/reports.py
│   ├── services/pii.py
│   ├── jobs/daily.py
│   ├── jobs/realtime.py
│   └── templates/daily_report.html.j2
├── tests/unit/
├── tests/integration/
├── tests/fixtures/
└── scripts/acceptance.sh
```

### Task 1: Bootstrap the Python service

**Files:**
- Create: `pyproject.toml`
- Create: `.env.example`
- Create: `src/ob_monitoring/__init__.py`
- Create: `src/ob_monitoring/settings.py`
- Test: `tests/unit/test_settings.py`

- [ ] **Step 1: Write the failing settings test**

```python
from ob_monitoring.settings import Settings


def test_settings_parse_four_regions(monkeypatch):
    monkeypatch.setenv("OB_DATABASE_URL", "postgresql+psycopg://ob:ob@db/ob")
    monkeypatch.setenv("OB_REGIONS", "ID,MY,TH,VN")
    settings = Settings()
    assert settings.regions == ("ID", "MY", "TH", "VN")
    assert settings.report_timezone == "Asia/Shanghai"
    assert settings.report_hour == 10
```

- [ ] **Step 2: Run the test and verify failure**

Run: `python -m pytest tests/unit/test_settings.py -q`  
Expected: `ModuleNotFoundError: No module named 'ob_monitoring'`.

- [ ] **Step 3: Add package metadata and settings**

```python
# src/ob_monitoring/settings.py
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OB_", env_file=".env")
    database_url: str
    regions: tuple[str, ...] = ("ID", "MY", "TH", "VN")
    report_timezone: str = "Asia/Shanghai"
    report_hour: int = 10
    seatalk_webhook_url: str | None = None
    callback_signing_secret: str = "local-only-change-me"

    @field_validator("regions", mode="before")
    @classmethod
    def parse_regions(cls, value):
        if isinstance(value, str):
            return tuple(item.strip().upper() for item in value.split(",") if item.strip())
        return value
```

Configure `pyproject.toml` for a `src` package and the declared stack. `.env.example` contains variable names and local dummy values only.

- [ ] **Step 4: Install and verify**

Run: `python -m pip install -e '.[dev]' && pytest tests/unit/test_settings.py -q && ruff check src tests && mypy src`  
Expected: one passing test, zero lint errors and zero type errors.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml .env.example src tests/unit/test_settings.py
git commit -m "chore: bootstrap OB monitoring V1 Lite"
```

### Task 2: Add domain types and persistence

**Files:**
- Create: `src/ob_monitoring/domain.py`
- Create: `src/ob_monitoring/db.py`
- Create: `src/ob_monitoring/models.py`
- Create: `alembic.ini`
- Create: `alembic/versions/0001_initial.py`
- Test: `tests/unit/test_domain.py`

- [ ] **Step 1: Write the failing incident-state test**

```python
import pytest
from ob_monitoring.domain import IncidentState, transition


def test_incident_state_order_is_enforced():
    assert transition(IncidentState.OPEN, IncidentState.ACK) is IncidentState.ACK
    with pytest.raises(ValueError, match="OPEN -> RECOVERED"):
        transition(IncidentState.OPEN, IncidentState.RECOVERED)
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pytest tests/unit/test_domain.py -q`  
Expected: import failure for `ob_monitoring.domain`.

- [ ] **Step 3: Implement the domain types**

```python
# src/ob_monitoring/domain.py
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum


class Severity(StrEnum):
    P0 = "P0"
    P1 = "P1"


class IncidentState(StrEnum):
    OPEN = "OPEN"
    ACK = "ACK"
    IN_PROGRESS = "IN_PROGRESS"
    RECOVERED = "RECOVERED"


ALLOWED = {
    IncidentState.OPEN: {IncidentState.ACK},
    IncidentState.ACK: {IncidentState.IN_PROGRESS},
    IncidentState.IN_PROGRESS: {IncidentState.RECOVERED},
    IncidentState.RECOVERED: set(),
}


def transition(current: IncidentState, target: IncidentState) -> IncidentState:
    if target not in ALLOWED[current]:
        raise ValueError(f"invalid transition: {current} -> {target}")
    return target


@dataclass(frozen=True)
class MetricPoint:
    metric: str
    value: float
    sample_size: int
    observed_at: datetime
    dimensions: dict[str, str] = field(default_factory=dict)
```

Create SQLAlchemy models and the first migration for `job_runs`, `source_readiness`, `metric_observations`, `rules`, `incidents`, `incident_events` and `delivery_attempts`. Add unique constraints for job and delivery idempotency keys.

- [ ] **Step 4: Run migration and tests**

Run: `docker compose up -d db && alembic upgrade head && pytest tests/unit/test_domain.py -q`  
Expected: database reaches revision `0001` and the domain test passes.

- [ ] **Step 5: Commit**

```bash
git add src/ob_monitoring/domain.py src/ob_monitoring/db.py src/ob_monitoring/models.py alembic.ini alembic tests/unit/test_domain.py
git commit -m "feat: add monitoring domain and database schema"
```

### Task 3: Implement source contracts and the data-readiness gate

**Files:**
- Create: `src/ob_monitoring/adapters/base.py`
- Create: `src/ob_monitoring/adapters/fixture.py`
- Create: `src/ob_monitoring/services/readiness.py`
- Create: `config/sources.yaml`
- Test: `tests/unit/test_readiness.py`

- [ ] **Step 1: Write readiness tests**

```python
from datetime import date
from ob_monitoring.services.readiness import ReadinessCheck, evaluate


def test_missing_partition_blocks_business_metrics():
    result = evaluate([
        ReadinessCheck("spm_payment_id", date(2026, 7, 16), False, "missing partition")
    ])
    assert result.ready is False
    assert result.block_business_alerts is True
    assert result.reasons == ("spm_payment_id: missing partition",)


def test_all_sources_ready_allows_metrics():
    result = evaluate([
        ReadinessCheck("spm_payment_id", date(2026, 7, 16), True, "ready")
    ])
    assert result.ready is True
    assert result.reasons == ()
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest tests/unit/test_readiness.py -q`  
Expected: missing readiness module.

- [ ] **Step 3: Implement the readiness contract**

```python
# src/ob_monitoring/services/readiness.py
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class ReadinessCheck:
    source: str
    business_date: date
    ready: bool
    reason: str


@dataclass(frozen=True)
class ReadinessResult:
    ready: bool
    block_business_alerts: bool
    reasons: tuple[str, ...]


def evaluate(checks: list[ReadinessCheck]) -> ReadinessResult:
    reasons = tuple(f"{check.source}: {check.reason}" for check in checks if not check.ready)
    return ReadinessResult(ready=not reasons, block_business_alerts=bool(reasons), reasons=reasons)
```

`SourceAdapter` exposes async `readiness(business_date)` and `metric(name, business_date, dimensions)`. `FixtureAdapter` reads deterministic JSON fixtures for local end-to-end tests. `sources.yaml` lists only SPM/APM payment, SPBA/APBA account and the three approved DataSuite validation links.

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_readiness.py -q`  
Expected: two passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/ob_monitoring/adapters src/ob_monitoring/services/readiness.py config/sources.yaml tests/unit/test_readiness.py
git commit -m "feat: add source contracts and readiness gate"
```

### Task 4: Add payment/account metric registry and Hive adapter

**Files:**
- Create: `config/metrics.yaml`
- Create: `src/ob_monitoring/adapters/hive.py`
- Create: `src/ob_monitoring/services/metrics.py`
- Create: `tests/fixtures/t1_metrics.json`
- Test: `tests/unit/test_metrics.py`

- [ ] **Step 1: Write formula tests**

```python
from ob_monitoring.services.metrics import success_rate, reject_rate


def test_payment_success_rate_uses_valid_attempts():
    assert success_rate(success=90, valid_attempts=100) == 0.9


def test_zero_denominator_returns_none():
    assert success_rate(success=0, valid_attempts=0) is None
    assert reject_rate(rejected=0, resulted_accounts=0) is None
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest tests/unit/test_metrics.py -q`  
Expected: missing metric functions.

- [ ] **Step 3: Implement formulas and allowlisted tables**

```python
# src/ob_monitoring/services/metrics.py
def ratio(numerator: int | float, denominator: int | float) -> float | None:
    return None if denominator == 0 else numerator / denominator


def success_rate(success: int, valid_attempts: int) -> float | None:
    return ratio(success, valid_attempts)


def reject_rate(rejected: int, resulted_accounts: int) -> float | None:
    return ratio(rejected, resulted_accounts)
```

`metrics.yaml` defines payment attempts/success/rate/USD amount/failure/pending and account new/active/verified/rejected/banned metrics. `HiveAdapter` selects table names only from a static `(module, region, metric)` allowlist and parameterizes business dates and values; it never accepts a table identifier from an API request.

- [ ] **Step 4: Run unit and fixture-adapter tests**

Run: `pytest tests/unit/test_metrics.py tests/unit/test_readiness.py -q`  
Expected: all tests pass and a zero denominator remains `null`, never `0%`.

- [ ] **Step 5: Commit**

```bash
git add config/metrics.yaml src/ob_monitoring/adapters/hive.py src/ob_monitoring/services/metrics.py tests/fixtures/t1_metrics.json tests/unit/test_metrics.py
git commit -m "feat: add outbound payment and account metrics"
```

### Task 5: Render the five-section HTML report

**Files:**
- Create: `src/ob_monitoring/services/reports.py`
- Create: `src/ob_monitoring/templates/daily_report.html.j2`
- Test: `tests/unit/test_reports.py`

- [ ] **Step 1: Write the report test**

```python
from datetime import date
from ob_monitoring.services.reports import DailyReport, RegionSummary, render


def test_report_has_four_regions_and_five_sections():
    report = DailyReport(
        business_date=date(2026, 7, 16),
        regions=tuple(RegionSummary(code, "HEALTHY") for code in ("ID", "MY", "TH", "VN")),
        payment_rows=(), account_rows=(), incidents=(), source_status=(), data_ready=True,
    )
    html = render(report)
    for text in ("ID", "MY", "TH", "VN", "Payment", "Bank Account", "P0/P1", "Data Freshness"):
        assert text in html
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pytest tests/unit/test_reports.py -q`  
Expected: missing report module.

- [ ] **Step 3: Implement typed report rendering**

Create frozen `DailyReport` and `RegionSummary` dataclasses. Configure Jinja2 with HTML auto-escape. The template renders executive summary, payment, bank account, P0/P1 incidents and data freshness/drilldowns. A delayed report displays `DATA DELAYED`, missing source and target date and does not render a missing metric as zero.

- [ ] **Step 4: Run render and escaping tests**

Run: `pytest tests/unit/test_reports.py -q`  
Expected: report test passes and `<script>` in any label is HTML-escaped.

- [ ] **Step 5: Commit**

```bash
git add src/ob_monitoring/services/reports.py src/ob_monitoring/templates tests/unit/test_reports.py
git commit -m "feat: render V1 Lite daily report"
```

### Task 6: Add PII-safe, idempotent SeaTalk delivery

**Files:**
- Create: `src/ob_monitoring/services/pii.py`
- Create: `src/ob_monitoring/adapters/seatalk.py`
- Test: `tests/unit/test_pii.py`
- Test: `tests/unit/test_seatalk.py`

- [ ] **Step 1: Write PII and idempotency tests**

```python
import pytest
from ob_monitoring.services.pii import assert_safe


def test_bank_account_number_is_rejected():
    with pytest.raises(ValueError, match="bank_account_number"):
        assert_safe({"bank_account_number": "1234567890"})


def test_aggregate_bank_metric_is_allowed():
    assert_safe({"bank": "Bank X", "success_rate": 0.9, "payment_count": 100})
```

The SeaTalk test uses a fake async transport, calls `send` twice with `daily:2026-07-16`, and asserts one HTTP request and a `False` result for the duplicate call.

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest tests/unit/test_pii.py tests/unit/test_seatalk.py -q`  
Expected: missing PII scanner and SeaTalk client.

- [ ] **Step 3: Implement scanning and delivery**

`assert_safe` recursively rejects bank-account number, name, phone, ID-number, token, cookie, secret and webhook fields. `SeaTalkClient.send` scans before POST, records the idempotency key, retries HTTP 429/5xx twice with 1-second and 2-second backoff, and persists terminal status without logging the webhook URL.

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/test_pii.py tests/unit/test_seatalk.py -q`  
Expected: all PII, retry and duplicate-delivery cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/ob_monitoring/services/pii.py src/ob_monitoring/adapters/seatalk.py tests/unit/test_pii.py tests/unit/test_seatalk.py
git commit -m "feat: add safe SeaTalk report delivery"
```

### Task 7: Orchestrate the 09:00 readiness check and 10:00 report

**Files:**
- Create: `src/ob_monitoring/jobs/daily.py`
- Create: `src/ob_monitoring/main.py`
- Test: `tests/integration/test_daily_job.py`

- [ ] **Step 1: Write ready and delayed job tests**

```python
import pytest
from datetime import date


@pytest.mark.asyncio
async def test_late_source_sends_delayed_report(daily_job, fixture_sources, fake_seatalk):
    fixture_sources.set_ready("spm_payment_id", False)
    result = await daily_job.run(date(2026, 7, 16))
    assert result.status == "DATA_DELAYED"
    assert result.business_alerts_suppressed is True
    assert fake_seatalk.last_payload["title"].startswith("[DATA DELAYED]")
```

Add a second case with all sources ready and assert one stored HTML report and one SeaTalk summary.

- [ ] **Step 2: Run the tests and verify failure**

Run: `pytest tests/integration/test_daily_job.py -q`  
Expected: missing daily job.

- [ ] **Step 3: Implement the daily workflow**

`DailyJob.run` uses idempotency key `daily:{business_date}`, checks readiness, calculates only ready metrics, merges active P0/P1 incidents, renders HTML and sends a normal or delayed summary. APScheduler polls readiness at 09:00 and runs the report at 10:00 in `Asia/Shanghai`; a completed delayed report is resent at most once.

- [ ] **Step 4: Run the M1 suite**

Run: `pytest tests/unit tests/integration/test_daily_job.py -q`  
Expected: all tests pass with no external network call.

- [ ] **Step 5: Commit**

```bash
git add src/ob_monitoring/jobs/daily.py src/ob_monitoring/main.py tests/integration/test_daily_job.py
git commit -m "feat: schedule four-region daily report"
```

### Task 8: Implement static P0/P1 rules and incident lifecycle

**Files:**
- Create: `config/rules.yaml`
- Create: `config/routing.yaml`
- Create: `src/ob_monitoring/services/rules.py`
- Create: `src/ob_monitoring/services/incidents.py`
- Test: `tests/unit/test_rules.py`
- Test: `tests/unit/test_incidents.py`

- [ ] **Step 1: Write rule and dedupe tests**

```python
from ob_monitoring.domain import Severity
from ob_monitoring.services.rules import StaticRule, evaluate


def test_rule_requires_three_bad_windows_and_volume_floor():
    rule = StaticRule("spm_sr", Severity.P1, minimum=0.80, windows=3, volume_floor=100)
    assert evaluate(rule, [0.79, 0.78, 0.77], [500, 500, 500]).triggered is True
    assert evaluate(rule, [0.79, 0.78, 0.77], [20, 20, 20]).triggered is False
```

The incident test opens the same normalized signal twice, asserts one incident ID, records `ACK` and `IN_PROGRESS`, then supplies three healthy windows and asserts `RECOVERED`.

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest tests/unit/test_rules.py tests/unit/test_incidents.py -q`  
Expected: missing rule and incident services.

- [ ] **Step 3: Implement rule and incident services**

Rules support only `P0` and `P1`, static minimum/maximum, consecutive windows and volume floor. The incident SHA-256 key is built from metric, region, module, channel/bank and error category. Repeated signals update evidence. Automatic recovery requires three ready, healthy windows; invalid state changes raise a conflict error and preserve audit history.

- [ ] **Step 4: Run tests and historical-fixture replay**

Run: `pytest tests/unit/test_rules.py tests/unit/test_incidents.py -q`  
Expected: all threshold, volume, dedupe, transition and recovery cases pass.

- [ ] **Step 5: Commit**

```bash
git add config/rules.yaml config/routing.yaml src/ob_monitoring/services/rules.py src/ob_monitoring/services/incidents.py tests/unit/test_rules.py tests/unit/test_incidents.py
git commit -m "feat: add P0 P1 incident evaluation"
```

### Task 9: Connect Grafana and expose signed incident actions

**Files:**
- Create: `src/ob_monitoring/adapters/grafana.py`
- Create: `src/ob_monitoring/jobs/realtime.py`
- Modify: `src/ob_monitoring/main.py`
- Test: `tests/integration/test_realtime_job.py`
- Test: `tests/integration/test_incident_api.py`

- [ ] **Step 1: Write realtime and callback tests**

The realtime test makes the fake Grafana adapter time out, then asserts one data-source event and zero business incidents. A second case returns three P1 windows and asserts one SeaTalk card. The API test posts a signed `ACK`, asserts state `ACK`, and verifies a tampered signature returns HTTP 401.

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest tests/integration/test_realtime_job.py tests/integration/test_incident_api.py -q`  
Expected: missing adapter/job and 404 incident endpoints.

- [ ] **Step 3: Implement the realtime path**

`GrafanaAdapter` executes only reviewed dashboard UID/panel queries from `sources.yaml`, retries timeout twice and returns `MetricPoint`. `RealtimeJob` runs every five minutes, suppresses business rules on source failure, updates incidents and sends cards only for newly opened or recovered events. Add signed POST endpoints `/api/incidents/{id}/ack`, `/start` and `/recover`.

- [ ] **Step 4: Run realtime and API tests**

Run: `pytest tests/integration/test_realtime_job.py tests/integration/test_incident_api.py -q`  
Expected: all source-failure, dedupe, signed-action and recovery cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/ob_monitoring/adapters/grafana.py src/ob_monitoring/jobs/realtime.py src/ob_monitoring/main.py tests/integration
git commit -m "feat: deliver Grafana P0 P1 action cards"
```

### Task 10: Package and verify V1 Lite

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.github/workflows/ci.yml`
- Create: `scripts/acceptance.sh`
- Create: `README.md`
- Test: `tests/integration/test_health.py`

- [ ] **Step 1: Write health and acceptance checks**

```bash
#!/usr/bin/env bash
set -euo pipefail
curl -fsS http://localhost:8000/healthz | grep -q '"status":"ok"'
curl -fsS http://localhost:8000/readyz | grep -q '"postgres"'
python -m ob_monitoring.jobs.daily --business-date 2026-07-16 --dry-run
python -m ob_monitoring.jobs.realtime --once --shadow
```

`test_health.py` asserts `/healthz` returns 200 and `/readyz` reports PostgreSQL, scheduler, Grafana and Hive readiness without exposing connection strings.

- [ ] **Step 2: Run acceptance before packaging and verify failure**

Run: `bash scripts/acceptance.sh`  
Expected: connection failure because the service is not running.

- [ ] **Step 3: Add packaging and CI**

Use a non-root Python 3.12 slim image. Compose starts PostgreSQL and the application with health checks. CI runs Ruff, mypy, pytest with 85% minimum coverage, Alembic upgrade/downgrade/upgrade and PII fixture scanning. README documents fixture mode, internal-source configuration, shadow mode and the explicit V1 Lite exclusions.

- [ ] **Step 4: Run full verification**

Run: `docker compose up -d --build && pytest -q --cov=ob_monitoring --cov-fail-under=85 && bash scripts/acceptance.sh`  
Expected: all tests pass, fixture daily HTML is generated, shadow realtime sends no external notification and coverage is at least 85%.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .github/workflows/ci.yml scripts/acceptance.sh README.md tests/integration/test_health.py
git commit -m "build: package and verify OB monitoring V1 Lite"
```

## Activation checkpoints

1. Validate seven fixture/generated reports against agreed ID/MY/TH/VN examples.
2. Compare T+1 payment/account metrics with the three retained DataSuite dashboards.
3. Replay historical Grafana fixtures and complete a seven-day shadow run.
4. Obtain PM/Ops approval for initial P0/P1 thresholds and routing.
5. Pass PII scan, callback-signature and least-privilege access review.
6. Enable one region first, then expand to the remaining pilot regions.

## Definition of done

- The report renders the required five sections for ID/MY/TH/VN.
- Late/missing data is labelled and never converted to zero or healthy.
- P0/P1 signals deduplicate and support ACK, start and recovery.
- SeaTalk delivery is idempotent and retry-safe.
- HTML and SeaTalk contain no prohibited PII.
- No excluded feature appears in the runtime or configuration.
- CI, migration, coverage and acceptance checks pass.

