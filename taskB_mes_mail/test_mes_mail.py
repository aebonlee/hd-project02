# -*- coding: utf-8 -*-
"""과제 B 순수 로직 테스트 (07시 기준 앞당김/지연 판정 · 색상 표기)

실행:
    python3 taskB_mes_mail/test_mes_mail.py

표준 라이브러리만 사용하므로 추가 설치 없이 동작한다.
"""
import os
import sys
import unittest
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mes_mail  # noqa: E402


def row(line, plan_dt, start_dt, plan_qty, actual_qty=0):
    return {
        "라인": line,
        "투입계획일시": plan_dt,
        "시작일시": start_dt,
        "계획수량": str(plan_qty),
        "실적수량": str(actual_qty),
    }


class TestParseDt(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(mes_mail.parse_dt("2026-08-21 06:30"),
                         datetime(2026, 8, 21, 6, 30))

    def test_empty(self):
        self.assertIsNone(mes_mail.parse_dt(""))
        self.assertIsNone(mes_mail.parse_dt(None))
        self.assertIsNone(mes_mail.parse_dt("  "))


class TestAnalyze(unittest.TestCase):
    """차이 = 07:00까지 시작된 지시의 계획수량 합 − 07:00까지 투입 예정 계획수량 합
    > 0 앞당김(빨간색) / < 0 지연(검은색) / = 0 정상"""

    def setUp(self):
        self.rows = [
            # 1라인: 계획은 08시인데 06시에 이미 시작 → 앞당김(+100, 빨강)
            row("1라인", "2026-08-21 08:00", "2026-08-21 06:00", 100),
            # 2라인: 06시 투입 계획인데 미시작 → 지연(-80, 검정)
            row("2라인", "2026-08-21 06:00", "", 80),
            # 3라인: 06시 계획, 06시 시작 → 정상(0, 검정)
            row("3라인", "2026-08-21 06:00", "2026-08-21 06:05", 50, 30),
        ]

    def test_baseline_is_report_date_7am(self):
        baseline, _ = mes_mail.analyze(self.rows)
        self.assertEqual(baseline, datetime(2026, 8, 21, 7, 0))

    def test_ahead_line_is_red(self):
        _, stats = mes_mail.analyze(self.rows)
        s = {r["라인"]: r for r in stats}
        self.assertEqual(s["1라인"]["차이수량"], 100)
        self.assertEqual(s["1라인"]["상태"], "앞당김")
        self.assertEqual(s["1라인"]["색상"], "red")

    def test_behind_line_is_black(self):
        _, stats = mes_mail.analyze(self.rows)
        s = {r["라인"]: r for r in stats}
        self.assertEqual(s["2라인"]["차이수량"], -80)
        self.assertEqual(s["2라인"]["상태"], "지연")
        self.assertEqual(s["2라인"]["색상"], "black")
        self.assertEqual(s["2라인"]["미시작건수"], 1)

    def test_on_plan_line(self):
        _, stats = mes_mail.analyze(self.rows)
        s = {r["라인"]: r for r in stats}
        self.assertEqual(s["3라인"]["차이수량"], 0)
        self.assertEqual(s["3라인"]["상태"], "정상")
        self.assertEqual(s["3라인"]["색상"], "black")
        self.assertEqual(s["3라인"]["실적수량"], 30)

    def test_boundary_inclusive(self):
        # 07:00 정각 시작/계획은 기준에 포함된다
        rows = [row("A", "2026-08-21 07:00", "2026-08-21 07:00", 10)]
        _, stats = mes_mail.analyze(rows)
        self.assertEqual(stats[0]["계획기준수량"], 10)
        self.assertEqual(stats[0]["시작기준수량"], 10)
        self.assertEqual(stats[0]["차이수량"], 0)

    def test_sample_csv(self):
        # 저장소 Mock CSV 로도 전체 파이프라인 계산이 동작해야 한다
        rows = mes_mail.fetch_mes_rows()
        baseline, stats = mes_mail.analyze(rows)
        self.assertEqual(baseline.hour, 7)
        self.assertGreater(len(stats), 0)
        for rec in stats:
            self.assertIn(rec["상태"], ("앞당김", "지연", "정상"))


class TestRenderHtml(unittest.TestCase):
    def test_colors_in_html(self):
        rows = [
            row("1라인", "2026-08-21 08:00", "2026-08-21 06:00", 100),  # 앞당김
            row("2라인", "2026-08-21 06:00", "", 80),                    # 지연
        ]
        baseline, stats = mes_mail.analyze(rows)
        html = mes_mail.render_html(baseline, stats)
        self.assertIn("#d64545", html)      # 앞당김 → 빨간색
        self.assertIn("#000000", html)      # 지연 → 검은색
        self.assertIn("앞당김: 1라인", html)
        self.assertIn("지연: 2라인", html)
        self.assertIn("07:00 기준", html)


if __name__ == "__main__":
    unittest.main(verbosity=2)
