import datetime
import unittest

from audit_python_locks import parse_ignores

TODAY = datetime.date(2026, 10, 28)


class ParseIgnoresTests(unittest.TestCase):
    def test_active_entry_is_ignored_for_its_lock_only(self):
        ignored, problems = parse_ignores("CVE-1 transcription 2026-12-01 not reachable\n", TODAY)
        self.assertEqual(ignored["transcription"], ["CVE-1"])
        self.assertEqual(ignored["backend"], [])
        self.assertEqual(problems, [])

    def test_expiry_day_is_still_valid_and_the_next_day_is_not(self):
        _, problems = parse_ignores("CVE-1 poller 2026-10-28 ok\n", TODAY)
        self.assertEqual(problems, [])
        ignored, problems = parse_ignores("CVE-1 poller 2026-10-27 ok\n", TODAY)
        self.assertEqual(ignored["poller"], [])
        self.assertIn("re-check", problems[0])

    def test_comments_and_blank_lines_are_skipped(self):
        ignored, problems = parse_ignores("# note\n\n  # indented note\n", TODAY)
        self.assertEqual((sum(map(len, ignored.values())), problems), (0, []))

    def test_reason_is_required(self):
        _, problems = parse_ignores("CVE-1 backend 2026-12-01\n", TODAY)
        self.assertIn("reason is required", problems[0])

    def test_unknown_lock_and_bad_date_are_reported(self):
        _, problems = parse_ignores("CVE-1 frontend 2026-12-01 x\nCVE-2 backend soon x\n", TODAY)
        self.assertEqual(len(problems), 2)

    def test_shipped_file_parses_cleanly(self):
        from audit_python_locks import IGNORES
        _, problems = parse_ignores(IGNORES.read_text(), datetime.date(2026, 10, 28))
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
