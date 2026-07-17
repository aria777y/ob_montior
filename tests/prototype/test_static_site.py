import json
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
PROTOTYPE = ROOT / "prototype"


class StaticSiteDataTests(unittest.TestCase):
    def test_four_regions_have_payment_detail(self):
        data = json.loads((PROTOTYPE / "assets/mock-data.json").read_text())

        self.assertEqual(set(data["regions"]), {"ID", "MY", "TH", "VN"})
        for code, region in data["regions"].items():
            self.assertGreaterEqual(len(region["paymentDetails"]), 4, code)
            for row in region["paymentDetails"]:
                self.assertIn(row["module"], {"SPM", "APM"})
                self.assertTrue(row["channel"])
                self.assertTrue(row["destinationBank"])

    def test_no_prohibited_pii_keys(self):
        text = (PROTOTYPE / "assets/mock-data.json").read_text().lower()

        for key in (
            "accountnumber",
            "payee",
            "phone",
            "userid",
            "paymentid",
            "idnumber",
        ):
            self.assertNotIn(key, text)


if __name__ == "__main__":
    unittest.main()
