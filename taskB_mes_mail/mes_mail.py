# -*- coding: utf-8 -*-
"""
과제 B. MES 라인별 진행현황 → 매일 07:00~07:30 Outlook 메일

실행:
    python3 taskB_mes_mail/mes_mail.py

동작:
    1. [어댑터] MES 데이터 가져오기 — 개인 환경에서는 sample_data/mes_status.csv (Mock)
       회사 PC에서는 Playwright 스크래핑 또는 MES 엑셀 다운로드 파일 읽기로 교체 (README)
    2. 당일 07:00 기준 라인별 계획 대비 시작 수량 차이 계산
       - 앞당겨진 라인 → 빨간색, 밀린 라인 → 검은색 (기획서 요구)
    3. HTML 메일 본문 생성 → output/mes_report_YYYYMMDD.html 저장
    4. [어댑터] 발송 — 개인 환경에서는 .eml 초안 저장, 회사 PC에서는 Outlook COM (README)
"""
import csv
import os
from datetime import datetime, time
from email.message import EmailMessage
from email.utils import formatdate

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE_DIR, "sample_data", "mes_status.csv")
OUT_DIR = os.path.join(BASE_DIR, "output")

# 수신인/참조인 고정 목록 (회사 PC에서는 실제 주소로 교체)
MAIL_TO = ["production_manager@example.com", "line_leader@example.com"]
MAIL_CC = ["plan_team@example.com"]
MAIL_FROM = "mes_report@example.com"

BASELINE_HOUR = 7  # 당일 07시 기준


# ---------- 1) 데이터 가져오기 어댑터 ----------
def fetch_mes_rows():
    """[어댑터] 개인 환경: Mock CSV.
    회사 PC: Playwright 로 MES 화면 조회 또는 다운로드 엑셀 읽기로 교체."""
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def parse_dt(value):
    value = (value or "").strip()
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d %H:%M")


# ---------- 2) 07시 기준 비교 로직 ----------
def analyze(rows):
    """라인별로 07:00 기준 '투입 계획' 대비 '시작' 수량 차이를 계산한다.

    - 계획기준수량: 투입계획일시가 07:00 이전(포함)인 지시의 계획수량 합
    - 시작기준수량: 시작일시가 07:00 이전(포함)인 지시의 계획수량 합
    - 차이 = 시작기준 - 계획기준
        > 0 → 라인이 앞당겨지고 있음 (빨간색)
        < 0 → 라인이 밀리고 있음   (검은색)
        = 0 → 계획대로 진행
    """
    # 기준일: 데이터의 투입계획일시 중 최근 날짜 (데모 재현성을 위해 CSV 기준)
    plan_dates = [parse_dt(r["투입계획일시"]) for r in rows if parse_dt(r["투입계획일시"])]
    report_date = max(plan_dates).date()
    baseline = datetime.combine(report_date, time(BASELINE_HOUR, 0))

    lines = {}
    order = []
    for r in rows:
        line = r["라인"]
        if line not in lines:
            lines[line] = {
                "라인": line, "계획기준수량": 0, "시작기준수량": 0,
                "실적수량": 0, "지시건수": 0, "미시작건수": 0,
            }
            order.append(line)
        rec = lines[line]
        plan_dt = parse_dt(r["투입계획일시"])
        start_dt = parse_dt(r["시작일시"])
        plan_qty = int(r["계획수량"] or 0)
        rec["지시건수"] += 1
        rec["실적수량"] += int(r["실적수량"] or 0)
        if plan_dt and plan_dt <= baseline:
            rec["계획기준수량"] += plan_qty
        if start_dt and start_dt <= baseline:
            rec["시작기준수량"] += plan_qty
        if start_dt is None:
            rec["미시작건수"] += 1

    result = []
    for line in order:
        rec = lines[line]
        diff = rec["시작기준수량"] - rec["계획기준수량"]
        if diff > 0:
            status, color = "앞당김", "red"
        elif diff < 0:
            status, color = "지연", "black"
        else:
            status, color = "정상", "black"
        rec.update({"차이수량": diff, "상태": status, "색상": color})
        result.append(rec)
    return baseline, result


# ---------- 3) HTML 메일 본문 ----------
TH = ("border:1px solid #b9c6d6;padding:6px 10px;background:#1f4e79;"
      "color:#ffffff;font-size:13px;")
TD = "border:1px solid #b9c6d6;padding:6px 10px;font-size:13px;"


def render_html(baseline, line_stats):
    date_str = baseline.strftime("%Y-%m-%d")

    def row_html(rec):
        # 기획서 요구: 앞당겨진 라인 빨간색, 밀린 라인 검은색
        color = "#d64545" if rec["색상"] == "red" else "#000000"
        bold = "font-weight:bold;" if rec["상태"] != "정상" else ""
        sign = "+" if rec["차이수량"] > 0 else ""
        return (
            f'<tr style="color:{color};{bold}">'
            f'<td style="{TD}">{rec["라인"]}</td>'
            f'<td style="{TD}text-align:center;">{rec["상태"]}</td>'
            f'<td style="{TD}text-align:right;">{rec["계획기준수량"]:,}</td>'
            f'<td style="{TD}text-align:right;">{rec["시작기준수량"]:,}</td>'
            f'<td style="{TD}text-align:right;">{sign}{rec["차이수량"]:,}</td>'
            f'<td style="{TD}text-align:right;">{rec["실적수량"]:,}</td>'
            f'<td style="{TD}text-align:center;">{rec["미시작건수"]} / {rec["지시건수"]}</td>'
            f"</tr>"
        )

    ahead = [r["라인"] for r in line_stats if r["상태"] == "앞당김"]
    behind = [r["라인"] for r in line_stats if r["상태"] == "지연"]
    summary = []
    if ahead:
        summary.append(f'<span style="color:#d64545;font-weight:bold;">앞당김: {", ".join(ahead)}</span>')
    if behind:
        summary.append(f'<span style="color:#000000;font-weight:bold;">지연: {", ".join(behind)}</span>')
    summary_html = " · ".join(summary) if summary else "전 라인 계획대로 진행 중"

    rows_html = "\n".join(row_html(r) for r in line_stats)
    return f"""<html>
<body style="font-family:'Malgun Gothic','맑은 고딕',sans-serif;color:#22303f;">
  <h2 style="font-size:16px;">[MES] 라인별 진행현황 보고 — {date_str} 07:00 기준</h2>
  <p style="font-size:13px;">안녕하세요. {date_str} 07시 기준 라인별 투입 진행현황을 보고드립니다.<br>
  {summary_html}</p>
  <table style="border-collapse:collapse;">
    <tr>
      <th style="{TH}">라인</th><th style="{TH}">상태</th>
      <th style="{TH}">계획 기준수량</th><th style="{TH}">시작 기준수량</th>
      <th style="{TH}">차이수량</th><th style="{TH}">누적 실적</th>
      <th style="{TH}">미시작/전체 지시</th>
    </tr>
    {rows_html}
  </table>
  <p style="font-size:12px;color:#6b7a8c;">
    * 차이수량 = 07:00까지 시작된 지시의 계획수량 합 − 07:00까지 투입 예정이던 계획수량 합<br>
    * <span style="color:#d64545;">빨간색 = 라인이 앞당겨지고 있음</span>, 검은색 = 밀리거나 계획대로 진행<br>
    * 본 메일은 자동 발송되었습니다.
  </p>
</body>
</html>"""


# ---------- 4) 저장 + 발송 어댑터 ----------
def save_outputs(baseline, html):
    os.makedirs(OUT_DIR, exist_ok=True)
    ymd = baseline.strftime("%Y%m%d")

    html_path = os.path.join(OUT_DIR, f"mes_report_{ymd}.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)

    # [어댑터] 개인 환경: .eml 초안 저장. 회사 PC: Outlook COM 발송으로 교체 (README)
    msg = EmailMessage()
    msg["Subject"] = f"[MES] 라인별 진행현황 보고 ({baseline.strftime('%Y-%m-%d')} 07:00 기준)"
    msg["From"] = MAIL_FROM
    msg["To"] = ", ".join(MAIL_TO)
    msg["Cc"] = ", ".join(MAIL_CC)
    msg["Date"] = formatdate(localtime=True)
    msg.set_content("HTML 지원 메일 클라이언트에서 확인해 주세요.")
    msg.add_alternative(html, subtype="html")

    eml_path = os.path.join(OUT_DIR, f"mes_report_{ymd}.eml")
    with open(eml_path, "wb") as f:
        f.write(msg.as_bytes())
    return html_path, eml_path


def main():
    rows = fetch_mes_rows()
    baseline, line_stats = analyze(rows)
    print(f"[기준시각] {baseline}")
    for rec in line_stats:
        sign = "+" if rec["차이수량"] > 0 else ""
        print(f"  {rec['라인']}: 계획 {rec['계획기준수량']} / 시작 {rec['시작기준수량']} "
              f"→ 차이 {sign}{rec['차이수량']} ({rec['상태']}, 표기색={rec['색상']})")
    html = render_html(baseline, line_stats)
    html_path, eml_path = save_outputs(baseline, html)
    print(f"[저장] {html_path}")
    print(f"[저장] {eml_path}")


if __name__ == "__main__":
    main()
