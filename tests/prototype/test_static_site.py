import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
PROTOTYPE = ROOT / "prototype"
PROHIBITED_KEYS = {
    "accountnumber",
    "payee",
    "phone",
    "userid",
    "paymentid",
    "idnumber",
}
DETAIL_STRING_FIELDS = {"module", "channel", "destinationBank", "topError", "status"}
DETAIL_NUMERIC_FIELDS = {
    "attempts",
    "success",
    "attemptAmountUsd",
    "successAmountUsd",
    "failed",
    "pending",
    "pendingOver2h",
    "avgProcessingSec",
    "previousSr",
}


def normalize_key(key):
    return re.sub(r"[^a-z0-9]", "", key.lower())


def iter_json_keys(value):
    if isinstance(value, dict):
        for key, child in value.items():
            yield key
            yield from iter_json_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_json_keys(child)


class StaticSiteDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data_path = PROTOTYPE / "assets/mock-data.json"
        cls.data = json.loads(cls.data_path.read_text())

    def test_four_regions_have_payment_detail(self):
        self.assertEqual(set(self.data["regions"]), {"ID", "MY", "TH", "VN"})
        for code, region in self.data["regions"].items():
            self.assertGreaterEqual(len(region["paymentDetails"]), 4, code)
            for index, row in enumerate(region["paymentDetails"]):
                label = f"{code} paymentDetails[{index}]"
                with self.subTest(row=label):
                    self.assertEqual(
                        set(row),
                        DETAIL_STRING_FIELDS | DETAIL_NUMERIC_FIELDS,
                        f"{label} must contain exactly the required detail fields",
                    )
                    for field in DETAIL_STRING_FIELDS:
                        self.assertIsInstance(
                            row[field], str, f"{label}.{field} must be a string"
                        )
                        self.assertTrue(row[field], f"{label}.{field} must not be empty")
                    for field in DETAIL_NUMERIC_FIELDS:
                        self.assertIsInstance(
                            row[field],
                            (int, float),
                            f"{label}.{field} must be numeric",
                        )
                        self.assertNotIsInstance(
                            row[field], bool, f"{label}.{field} must not be boolean"
                        )
                    self.assertIn(row["module"], {"SPM", "APM"}, label)
                    self.assertEqual(
                        row["attempts"],
                        row["success"] + row["failed"] + row["pending"],
                        f"{label} attempts must reconcile to terminal and pending counts",
                    )
                    self.assertLessEqual(
                        row["successAmountUsd"],
                        row["attemptAmountUsd"],
                        f"{label} success amount cannot exceed attempt amount",
                    )
                    self.assertLessEqual(
                        row["pendingOver2h"],
                        row["pending"],
                        f"{label} pending over two hours cannot exceed pending",
                    )

    def test_pending_aging_reconciles_with_payment_detail(self):
        for code, region in self.data["regions"].items():
            with self.subTest(region=code):
                pending = sum(row["pending"] for row in region["paymentDetails"])
                pending_over_2h = sum(
                    row["pendingOver2h"] for row in region["paymentDetails"]
                )
                self.assertEqual(
                    sum(region["pendingAging"].values()),
                    pending,
                    f"{code} pending-aging buckets must equal aggregate pending",
                )
                self.assertEqual(
                    region["pendingAging"]["over2h"],
                    pending_over_2h,
                    f"{code} over2h bucket must equal aggregate pendingOver2h",
                )

    def test_account_status_distribution_reconciles_with_module_totals(self):
        for code, region in self.data["regions"].items():
            modules = {row["module"]: row for row in region["account"]["modules"]}
            distribution = region["account"]["statusDistribution"]
            self.assertEqual({row["module"] for row in distribution}, set(modules))
            for row in distribution:
                with self.subTest(region=code, module=row["module"]):
                    self.assertEqual(
                        row["total"],
                        row["active"] + row["inactive"] + row["banned"],
                    )
                    self.assertEqual(row["active"], modules[row["module"]]["active"])
                    self.assertEqual(row["banned"], modules[row["module"]]["banned"])

    def test_trends_are_seven_days_and_match_latest_module_rates(self):
        for code, region in self.data["regions"].items():
            trends = region["trends"]
            with self.subTest(region=code, series="dates"):
                self.assertEqual(len(trends["dates"]), 7, f"{code} needs seven dates")
            for module in ("SPM", "APM"):
                with self.subTest(region=code, series=module):
                    self.assertEqual(
                        len(trends[module]),
                        len(trends["dates"]),
                        f"{code} {module} trend must align with trend dates",
                    )
                    rows = [
                        row
                        for row in region["paymentDetails"]
                        if row["module"] == module
                    ]
                    expected_rate = round(
                        100
                        * sum(row["success"] for row in rows)
                        / sum(row["attempts"] for row in rows),
                        2,
                    )
                    self.assertEqual(
                        trends[module][-1],
                        expected_rate,
                        f"{code} {module} final trend point must match detail aggregate",
                    )

    def test_no_prohibited_pii_keys(self):
        for key in iter_json_keys(self.data):
            self.assertNotIn(
                normalize_key(key),
                PROHIBITED_KEYS,
                f"prohibited PII key in mock data: {key}",
            )

        patterns = {
            key: re.compile(r"[\W_]*".join(map(re.escape, key)), re.IGNORECASE)
            for key in PROHIBITED_KEYS
        }
        files = sorted(
            path
            for path in PROTOTYPE.rglob("*")
            if path.is_file() and path.suffix.lower() in {".html", ".js", ".json"}
        )
        for path in files:
            text = path.read_text()
            for key, pattern in patterns.items():
                self.assertIsNone(
                    pattern.search(text),
                    f"prohibited PII key variant for {key} in {path.relative_to(ROOT)}",
                )

    def test_global_page_links_every_region(self):
        html = (PROTOTYPE / "index.html").read_text()
        for code in ("id", "my", "th", "vn"):
            self.assertIn(f'href="regions/{code}.html"', html)
        for label in (
            "Payment Success Rate",
            "Payment Amount",
            "Pending >2h",
            "Account Reject Rate",
            "Open P0/P1",
        ):
            self.assertIn(label, html)

    def test_global_page_uses_existing_local_assets(self):
        page = PROTOTYPE / "index.html"
        html = page.read_text()
        local_assets = re.findall(
            r'<(?:link|script)\b[^>]+(?:href|src)="([^"#:?]+)"', html
        )
        self.assertTrue(local_assets, "global page must reference local assets")
        for asset in local_assets:
            with self.subTest(asset=asset):
                self.assertTrue(
                    (page.parent / asset).is_file(),
                    f"missing local asset referenced by index.html: {asset}",
                )
        self.assertRegex(html, r'<script\b[^>]*\bsrc="assets/global\.js"[^>]*\bdefer\b')
        self.assertRegex(
            html,
            r'<[^>]+id="readinessSummary"[^>]+role="status"[^>]+aria-live="polite"',
        )
        self.assertIn("Demo data only", html)

    def test_region_pages_use_shared_renderer_and_required_sections(self):
        for code in ("id", "my", "th", "vn"):
            page = PROTOTYPE / f"regions/{code}.html"
            html = page.read_text()
            self.assertIn(f'data-region="{code.upper()}"', html)
            self.assertIn('../assets/region.js', html)
            for element_id in (
                "paymentSummary",
                "trend",
                "pendingAging",
                "exceptions",
                "paymentDetails",
                "accountHealth",
                "incidents",
                "freshness",
            ):
                self.assertIn(f'id="{element_id}"', html)

    def test_region_pages_reference_existing_assets_and_accessible_table(self):
        for page in sorted((PROTOTYPE / "regions").glob("*.html")):
            html = page.read_text()
            local_assets = re.findall(
                r'<(?:link|script)\b[^>]+(?:href|src)="([^"#:?]+)"', html
            )
            for asset in local_assets:
                with self.subTest(page=page.name, asset=asset):
                    self.assertTrue((page.parent / asset).is_file())
            self.assertIn("Demo data only", html)
            self.assertIn("<caption", html)
            self.assertIn('scope="col"', html)

    def test_tablet_region_card_grids_use_two_columns(self):
        css = (PROTOTYPE / "assets/styles.css").read_text()
        tablet = re.search(r"@media \(max-width: 960px\) \{(.*?)\n\}", css, re.S)
        self.assertIsNotNone(tablet)
        rules = tablet.group(1)
        self.assertRegex(
            rules,
            r"\.region-kpis\s*\{[^}]*grid-template-columns:\s*repeat\(2,",
        )
        self.assertRegex(
            rules,
            r"\.account-modules\s*\{[^}]*grid-template-columns:\s*repeat\(2,",
        )


if __name__ == "__main__":
    unittest.main()
