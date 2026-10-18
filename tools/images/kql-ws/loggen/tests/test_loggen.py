"""ct-loggen tests (stdlib unittest; run: python3 -m unittest discover -s tests -t .)."""
import datetime as dt
import ipaddress
import json
import os
import tempfile
import unittest

from ctloggen.cli import build, main
from ctloggen.tables import SCHEMAS

END = dt.datetime(2026, 10, 18, 12, tzinfo=dt.timezone.utc)


def gen(seed="t1", **kw):
    args = dict(scenario="identity-compromise", end=END, days=7, users=40, scale=0.5)
    args.update(kw)
    return build(seed, **args)


class Determinism(unittest.TestCase):
    def test_same_seed_same_data_and_answers(self):
        _, a, ans_a = gen("same")
        _, b, ans_b = gen("same")
        self.assertEqual(ans_a, ans_b)
        for t in SCHEMAS:
            self.assertEqual(a.rows[t], b.rows[t], t)

    def test_different_seeds_differ(self):
        _, _, a = gen("seed-a")
        _, _, b = gen("seed-b")
        self.assertNotEqual((a["victim_upn"], a["spray_ip"], a["c2_host"]),
                            (b["victim_upn"], b["spray_ip"], b["c2_host"]))

    def test_files_byte_identical(self):
        with tempfile.TemporaryDirectory() as d:
            for sub in ("x", "y"):
                main(["generate", "--seed", "files", "--end", "2026-10-18T12:00:00Z", "--users", "20",
                      "--scale", "0.3", "--out", os.path.join(d, sub)])
            for f in os.listdir(os.path.join(d, "x")):
                with open(os.path.join(d, "x", f), "rb") as fx, open(os.path.join(d, "y", f), "rb") as fy:
                    self.assertEqual(fx.read(), fy.read(), f)


class Shape(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world, cls.ds, cls.ans = gen("shape")

    def test_every_row_matches_its_schema(self):
        for t, rows in self.ds.rows.items():
            cols = {c for c, _ in SCHEMAS[t]}
            self.assertTrue(rows, f"{t} is empty")
            for r in rows:
                self.assertLessEqual(set(r), cols, t)

    def test_window(self):
        start = dt.datetime.fromisoformat(self.ans["start"].replace("Z", "+00:00"))
        for t, rows in self.ds.rows.items():
            for r in rows:
                if "TimeGenerated" in r and t != "IdentityInfo":
                    self.assertTrue(start <= r["TimeGenerated"] <= END, (t, r["TimeGenerated"]))

    def test_no_real_public_addresses(self):
        allowed = [ipaddress.ip_network(n) for n in
                   ("10.0.0.0/8", "198.18.0.0/15", "198.51.100.0/24", "192.0.2.0/24", "203.0.113.0/24")]
        for t, col in (("SigninLogs", "IPAddress"), ("CommonSecurityLog", "SourceIP"),
                       ("CommonSecurityLog", "DestinationIP"), ("DeviceNetworkEvents", "RemoteIP")):
            for r in self.ds.rows[t]:
                ip = ipaddress.ip_address(r[col])
                self.assertTrue(any(ip in n for n in allowed), (t, col, r[col]))

    def test_write_jsonl_and_csv(self):
        with tempfile.TemporaryDirectory() as d:
            for fmt in ("jsonl", "csv"):
                doc = self.ds.write(os.path.join(d, fmt), fmt)
                self.assertEqual(set(doc["tables"]), set(SCHEMAS))
            with open(os.path.join(d, "jsonl", "SigninLogs.jsonl"), encoding="utf-8") as f:
                row = json.loads(f.readline())
            self.assertIsInstance(row["LocationDetails"], dict)
            self.assertIsInstance(row["ResultType"], str)


class Story(unittest.TestCase):
    """The answers must be what a correct query over the data returns."""

    @classmethod
    def setUpClass(cls):
        cls.world, cls.ds, cls.ans = gen("story")
        cls.signins = cls.ds.rows["SigninLogs"]

    def test_mfa_fatigue(self):
        denials = [r for r in self.signins if r["ResultType"] == "500121"]
        self.assertEqual(len(denials), self.ans["mfa_denials"])
        self.assertEqual({r["UserPrincipalName"] for r in denials}, {self.ans["victim_upn"]})

    def test_spray(self):
        failed = {r["UserPrincipalName"] for r in self.signins
                  if r["IPAddress"] == self.ans["spray_ip"] and r["ResultType"] in ("50126", "50053")}
        self.assertEqual(len(failed), self.ans["spray_failed_accounts"])
        self.assertNotIn(self.ans["victim_upn"], failed)

    def test_backdoor_role(self):
        rows = [r for r in self.ds.rows["AuditLogs"] if r["OperationName"] == "Add member to role"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["TargetResources"][0]["userPrincipalName"], self.ans["backdoor_upn"])

    def test_inbox_rule_and_downloads(self):
        rule = [r for r in self.ds.rows["OfficeActivity"] if r["Operation"] == "New-InboxRule"]
        params = {p["Name"]: p["Value"] for p in json.loads(rule[0]["Parameters"])}
        self.assertEqual(params["ForwardTo"], self.ans["forward_to"])
        dl = [r for r in self.ds.rows["OfficeActivity"]
              if r["Operation"] == "FileDownloaded" and r["ClientIP"] == self.ans["attacker_login_ip"]]
        self.assertEqual(len(dl), self.ans["files_downloaded"])

    def test_rare_process_and_beacon(self):
        procs = [r for r in self.ds.rows["DeviceProcessEvents"] if r["FileName"] == self.ans["implant_file"]]
        self.assertEqual({r["DeviceName"] for r in procs}, {self.ans["victim_device"]})
        beacons = sorted(r["Timestamp"] for r in self.ds.rows["DeviceNetworkEvents"]
                         if r["RemoteUrl"] == self.ans["c2_host"])
        self.assertEqual(len(beacons), self.ans["beacon_count"])
        gaps = [(b - a).total_seconds() for a, b in zip(beacons, beacons[1:])]
        self.assertAlmostEqual(sum(gaps) / len(gaps), self.ans["beacon_interval_s"],
                               delta=self.ans["beacon_interval_s"] * 0.05)

    def test_bruteforce(self):
        fails = [r for r in self.ds.rows["SecurityEvent"] if r["EventID"] == 4625
                 and r.get("TargetUserName") == self.ans["bruteforce_account"]]
        self.assertEqual(len(fails), self.ans["bruteforce_failures"])

    def test_no_scenario(self):
        _, ds, ans = gen("quiet", scenario="none")
        self.assertFalse([r for r in ds.rows["SigninLogs"] if r["ResultType"] == "500121"])
        self.assertNotIn("victim_upn", ans)


if __name__ == "__main__":
    unittest.main()
