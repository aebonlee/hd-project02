# 과제 C. SAP 다운로드 → 엑셀 가공 → 팀 메일 송부

SAP 자료 다운로드 → 엑셀 쿼리(팀즈 마스터 파일, VLOOKUP·피벗) 가공 단계는
이미 자동화되어 있으므로, 이 과제는 **가공 완료된 엑셀 이후 단계**를 자동화한다.

1. 가공 완료 엑셀의 **특정 범위를 메일 본문에 삽입**
   — 개인 환경에서는 이미지 캡처 대신 **셀 서식(배경색/글자색/굵기/병합)을 살린 HTML 표**로 대체
2. 엑셀을 **날짜가 붙은 다른 이름으로 저장** 후 첨부
3. 팀원 수신/참조 목록으로 **메일 초안(.eml)** 생성 — 회사 PC에서는 Outlook 발송으로 교체

## 실행 방법

```bash
python3 taskC_sap_excel_mail/make_sample.py   # 가공 완료 형태의 샘플 엑셀 생성
python3 taskC_sap_excel_mail/sap_mail.py
# → output/자재수급현황_YYYYMMDD.xlsx      (다른 이름 저장본, 첨부용)
# → output/sap_mail_preview_YYYYMMDD.html  (본문 미리보기)
# → output/sap_mail_YYYYMMDD.eml           (본문 표 + 엑셀 첨부 메일 초안)
```

캡처 범위는 `sap_mail.py` 상단의 `CAPTURE_SHEET` / `CAPTURE_RANGE` 상수로 지정한다.

```bash
python3 taskC_sap_excel_mail/test_sap_mail.py   # 표 생성/색 변환 로직 테스트
```

> **Mock 안내**: 이 스크립트는 **실제 메일을 발송하지 않으며**,
> `sap_mail.py` 상단의 수신인/참조인(`MAIL_TO`/`MAIL_CC`/`MAIL_FROM`)은
> `@example.com` 자리표시자입니다. 회사 PC에서는 실제 팀원 주소로 바꾸고
> 아래 "회사 PC 실제 연동 방법"의 Outlook COM 발송으로 교체하세요.

## 회사 PC 실제 연동 방법

### 1. 입력 파일 교체

`SRC_XLSX` 를 팀즈 마스터 쿼리 파일로 가공된 실제 결과 파일 경로로 변경한다.
(팀즈 동기화 폴더 예: `C:\Users\사번\회사명\팀명 - 문서\마스터\자재수급현황.xlsx`)
쿼리 새로고침까지 자동화하려면 xlwings로 파일을 열어 `wb.api.RefreshAll()` 후 저장한다.

### 2. 범위를 '진짜 이미지'로 캡처하려면 (xlwings + Excel 필요)

```bash
pip install xlwings pillow
```

```python
import xlwings as xw
app = xw.App(visible=False)
wb = app.books.open(r"C:\경로\자재수급현황.xlsx")
rng = wb.sheets["요약"].range("A1:G10")
rng.to_png(r"C:\경로\capture.png")        # 범위 → PNG 이미지
wb.close(); app.quit()
```

캡처한 PNG는 Outlook `HTMLBody` 에 `<img src="cid:capture">` 로 넣고
`mail.Attachments.Add(경로).PropertyAccessor.SetProperty(..., "capture")` 로 CID를 지정하거나,
본 데모처럼 HTML 표 방식을 그대로 써도 수신 화면은 동일한 정보를 전달한다.

### 3. Outlook 발송 교체 (.eml 저장 → 실제 발송)

```python
import win32com.client
outlook = win32com.client.Dispatch("Outlook.Application")
mail = outlook.CreateItem(0)
mail.To = "team_member1@회사도메인; team_member2@회사도메인"
mail.CC = "team_leader@회사도메인"
mail.Subject = f"[자재] 일일 자재 수급 현황 공유 ({today_str})"
mail.HTMLBody = body_html
mail.Attachments.Add(attach_path)   # 날짜 붙은 다른 이름 저장본 첨부
mail.Send()                          # 초안 확인 후 보내려면 mail.Display()
```

### 4. 스케줄 실행

매일 정해진 시간에 자동 실행하려면 과제 B README의
**Windows 작업 스케줄러 등록 안내**를 동일하게 적용한다.
