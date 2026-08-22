# 과제 B. MES 라인별 진행현황 → 매일 07:00~07:30 Outlook 메일

MES(웹 시스템)의 **투입 계획 / 시작 일시** 컬럼을 당일 07시 기준으로 비교해
라인별 진행현황을 계산하고, **앞당겨진 라인은 빨간색·밀린 라인은 검은색**으로 표기한
HTML 메일을 지정 수신인/참조인에게 매일 1회(07:00~07:30) 발송한다.

개인 노트북 환경에서는 MES 접속과 Outlook 발송이 불가하므로
**Mock CSV → HTML 리포트 + .eml 초안 저장**으로 대체되어 있다.

## 실행 방법

```bash
python3 taskB_mes_mail/mes_mail.py
# → output/mes_report_YYYYMMDD.html (본문 미리보기)
# → output/mes_report_YYYYMMDD.eml  (메일 초안 — 더블클릭 시 메일 앱으로 열림)
python3 taskB_mes_mail/test_mes_mail.py    # 07시 기준 판정 로직 테스트
```

> **Mock 안내**: 이 스크립트는 **실제 메일을 발송하지 않으며**,
> `mes_mail.py` 상단의 수신인/참조인(`MAIL_TO`/`MAIL_CC`/`MAIL_FROM`)은
> `@example.com` 자리표시자입니다. 회사 PC에서는 실제 주소로 바꾸고
> 아래 "회사 PC 실제 연동 방법"의 Outlook COM 발송으로 교체하세요.

## 계산 로직 (당일 07:00 기준)

- **계획 기준수량**: 투입계획일시가 07:00 이전(포함)인 작업지시의 계획수량 합
- **시작 기준수량**: 시작일시가 07:00 이전(포함)인 작업지시의 계획수량 합
- **차이수량 = 시작 기준수량 − 계획 기준수량**
  - `> 0` : 라인이 **앞당겨지고 있음 → 빨간색**
  - `< 0` : 라인이 **밀리고 있음 → 검은색**
  - `= 0` : 계획대로 진행

## Mock CSV 스키마 (`sample_data/mes_status.csv`)

라인, 작업지시번호, 품번, 투입계획일시, 시작일시, 계획수량, 실적수량
(시작일시가 빈칸이면 미시작 지시)

## 회사 PC 실제 연동 방법 (어댑터 교체)

### 1. MES 데이터 가져오기 — `fetch_mes_rows()` 교체

**방법 A. MES 엑셀 다운로드 파일 읽기 (권장, 단순)**
MES에서 현황을 엑셀로 내려받을 수 있다면 다운로드 폴더의 최신 파일을 읽는다.

```python
import openpyxl, glob, os
def fetch_mes_rows():
    latest = max(glob.glob(r"C:\Users\사번\Downloads\MES현황*.xlsx"), key=os.path.getmtime)
    ws = openpyxl.load_workbook(latest).active
    headers = [c.value for c in ws[1]]
    return [dict(zip(headers, (c.value for c in row))) for row in ws.iter_rows(min_row=2)]
```

**방법 B. Playwright 브라우저 자동화 (화면 조회만 가능한 경우)**

```bash
pip install playwright && playwright install chromium
```

```python
from playwright.sync_api import sync_playwright
def fetch_mes_rows():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://mes.회사주소/line-status")     # MES URL
        page.fill("#userId", "사번"); page.fill("#password", "비밀번호")
        page.click("#loginBtn")
        page.wait_for_selector("table.line-status")
        rows = page.eval_on_selector_all(
            "table.line-status tbody tr",
            "trs => trs.map(tr => [...tr.cells].map(td => td.innerText.trim()))")
        browser.close()
    headers = ["라인", "작업지시번호", "품번", "투입계획일시", "시작일시", "계획수량", "실적수량"]
    return [dict(zip(headers, r)) for r in rows]
```

셀렉터(`#userId`, `table.line-status` 등)는 실제 MES 화면에 맞게 수정한다.
사내 SSO가 있으면 `p.chromium.launch_persistent_context()` 로 로그인 세션을 재사용한다.

### 2. Outlook 발송 — `save_outputs()` 의 .eml 저장 부분 교체

```bash
pip install pywin32
```

```python
import win32com.client
def send_outlook(subject, html_body):
    outlook = win32com.client.Dispatch("Outlook.Application")
    mail = outlook.CreateItem(0)                 # 0 = MailItem
    mail.To = "production_manager@회사도메인; line_leader@회사도메인"
    mail.CC = "plan_team@회사도메인"
    mail.Subject = subject
    mail.HTMLBody = html_body
    mail.Send()                                  # 초안만 만들려면 mail.Display() 또는 mail.Save()
```

Outlook이 로그인된 상태로 실행 중이어야 하며, 회사 보안 정책에 따라
프로그래밍 방식 발송 시 보안 경고가 뜰 수 있다(IT팀에 신뢰 프로그램 등록 요청).

### 3. Windows 작업 스케줄러 등록 (매일 07:00 실행)

1. `작업 스케줄러(taskschd.msc)` 실행 → **기본 작업 만들기**
2. 이름: `MES 라인현황 메일` / 트리거: **매일 07:00**
3. 동작: **프로그램 시작**
   - 프로그램: `C:\Python311\python.exe` (또는 `py.exe`)
   - 인수: `C:\작업경로\taskB_mes_mail\mes_mail.py`
   - 시작 위치: `C:\작업경로\taskB_mes_mail`
4. 조건 탭에서 "AC 전원인 경우에만 시작" 해제, 설정 탭에서
   "예약 시작을 놓친 경우 가능한 빨리 작업 시작" 체크 (07:00~07:30 창 보장)
5. PC가 켜져 있어야 하므로 절전 설정 확인 (또는 "작업 실행을 위해 절전 모드 종료" 체크)

명령줄 등록 예:

```bat
schtasks /create /tn "MES라인현황메일" /tr "py C:\작업경로\taskB_mes_mail\mes_mail.py" /sc daily /st 07:00
```
