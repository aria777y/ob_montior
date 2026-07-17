# OB Monitoring Region Dashboard HTML — Design

**Status:** Approved for implementation planning  
**Date:** 2026-07-17  
**Parent scope:** OB Monitoring V1 Lite  

## 1. Goal

Expand the HTML prototype from one combined screen into a two-level operations view:

1. A Global Overview for locating the affected region.
2. One complete dashboard for each pilot region: ID, MY, TH and VN.

The prototype continues to use aggregated mock data and does not connect to production sources.

## 2. Navigation

```text
Global Overview
├── ID Dashboard
├── MY Dashboard
├── TH Dashboard
└── VN Dashboard
```

The global region cards are links. Every region dashboard has a clear return link and direct navigation to the other three regions.

Implementation uses shared CSS, mock data and JavaScript. Region pages must not duplicate the full dataset or rendering logic.

## 3. Global Overview

The overview displays only the signals needed to identify the affected region:

- Region health score and status.
- Payment success rate.
- Payment amount.
- Pending payments older than two hours.
- Bank-account reject rate.
- Open P0/P1 count.
- Data-readiness status.

Clicking a region opens its complete dashboard.

## 4. Region Dashboard

### 4.1 Header

- Region name and health status.
- T+1 business date and report-generation time.
- Data-readiness state.
- Navigation to Global, ID, MY, TH and VN.

### 4.2 Payment summary

- Valid attempts.
- Successful payments.
- Payment success rate.
- Attempt amount and successful amount in USD.
- Failed payments.
- Pending payments.
- Pending payments older than two hours.
- Average processing time.

### 4.3 Payment trend and aging

- Seven-day SPM/APM success-rate trend.
- Pending aging: `<5m`, `5–30m`, `30m–2h`, `>2h`.
- The trend is a lightweight inline SVG or CSS visualization with no chart dependency.

### 4.4 Top five payment exceptions

Each exception is a `Module × Channel × Destination Bank` combination and displays:

- Current success rate.
- Day-over-day success-rate change.
- Failed or pending impact count.
- Top error category.
- A short recommended investigation action.

Exceptions are ordered by affected transaction count, with success-rate degradation used as the tie-breaker.

### 4.5 Complete Channel × Destination Bank table

Grain:

```text
Region → Module (SPM/APM) → Payout Channel → Destination Bank
```

Required columns:

| Column | Definition |
|---|---|
| Module | SPM or APM |
| Payout Channel | Aggregated payout-channel name |
| Destination Bank | Aggregated receiving-bank name |
| Valid Attempts | Deduplicated valid attempts |
| Successful Payments | Successful terminal payments |
| Success Rate | Successful payments / valid attempts |
| Attempt Amount | Valid-attempt amount in USD |
| Success Amount | Successful amount in USD |
| Failed | Terminal failed payments |
| Pending | Current pending payments |
| Pending >2h | Pending for more than two hours |
| Avg Processing | Average terminal processing duration |
| Top Error | Highest-volume error category |
| DoD SR Change | Current SR minus previous-business-day SR |

The table supports filters for Module, Payout Channel, Destination Bank and status (`All`, `Healthy`, `Watch`, `Critical`). Default ordering is anomaly impact, not transaction volume.

The sum of visible complete-table rows must reconcile with the region payment summary when no filters are active.

### 4.6 Bank-account health

- SPBA/APBA new accounts.
- Active accounts.
- Verified/checked accounts.
- Rejected accounts and reject rate.
- Banned accounts.
- Default-account rate.
- Status distribution and bank-level exception ranking.

### 4.7 Operations and freshness

- Open P0/P1 incidents.
- Owner, impact, ACK deadline and current state.
- ACK, Start and Recovered mock actions.
- Grafana, SPM, APM and APBA drilldowns.
- Grafana, Payment Mart, Account Mart and DataSuite update status.

Incident actions must update the in-memory data model so state and counts remain consistent when navigating or filtering.

## 5. Data and safety

- Use aggregated mock data only.
- Destination Bank is a bank label, never an account identifier.
- Do not include account number, payee name, phone, ID number, payment ID or user ID.
- Display `Demo data only` on every page.
- External links open in a new tab with `rel="noreferrer"`.

## 6. Explicit exclusions

- Frontend funnel and TMS.
- IS Giro/Remittance/routing.
- P2/P3 queue.
- Dynamic baseline and auto-tuning.
- Production API integration.
- Automated channel switching or remediation.

## 7. Responsive and accessibility requirements

- Desktop: two-column diagnosis panels and full-width detailed table.
- Tablet: cards collapse to two columns.
- Mobile: cards collapse to one column and tables scroll horizontally.
- Use semantic headings, table captions, scoped headers and visible focus states.
- Page language matches the English UI.

## 8. Acceptance criteria

- Global Overview links to ID, MY, TH and VN dashboards.
- Every region dashboard renders all required sections.
- Every region has at least four `Channel × Destination Bank` mock combinations.
- Complete-table totals reconcile with payment-summary totals before filtering.
- Module, channel, destination-bank and status filters work together.
- Top five exceptions use the same underlying detail data.
- Incident state remains consistent after filtering/navigation within the current page.
- No browser console errors.
- No prohibited PII in HTML, JavaScript or rendered content.

