# 반복 업무 자동화 및 기존 업무 개선

> 🌐 **배포 페이지: [https://aebonlee.github.io/hd-project02/](https://aebonlee.github.io/hd-project02/)** · 저장소: https://github.com/aebonlee/hd-project02

생성형 AI 업무자동화 전문가과정 [1차수] 프로젝트 — 기획자: 권도연

"SAP/MES 자료 다운 → 엑셀 가공 → Outlook 메일 송부"로 반복되는 일일 업무를 자동화하고,
협력업체에 매일 보내던 D+4 결품 현황 엑셀을 **업체가 직접 접속해 특이사항 유/무를 응답하는
웹페이지**로 대체하는 4개의 독립 과제로 구성됩니다.

기획자는 회사 시스템(SAP/MES/Outlook)에 접근할 수 없는 **개인 노트북**으로 실습 중이므로,
모든 사내 시스템 연동 지점은 **교체 가능한 어댑터 + 샘플/Mock 데이터**로 구현되어 있으며
실제 연동 방법은 각 과제 README에 명시되어 있습니다.

## 폴더 구조

```
hd-project02/
├── taskD_shortage_web/     ★ 과제 D. 협력업체 결품(D+4) 응답 웹페이지 (최우선)
│   ├── index.html          단일 페이지 앱 (담당자 모드 + 업체 모드)
│   ├── css/ · js/          스타일, 순수 로직(logic.js), 화면 제어(app.js), 샘플 데이터
│   ├── sample_data/        결품현황_샘플.xlsx (5개 업체 44행) + 생성 스크립트
│   └── test/               node 순수 로직 테스트 (12건)
├── taskA_pdf_extract/      과제 A. 업체별 상이한 PDF → 엑셀 추출
│   ├── make_samples.py     레이아웃 다른 샘플 PDF 3종 생성 (reportlab)
│   ├── vendors.json        업체별 인코텀즈 추출 규칙 설정
│   ├── extract.py          pdfplumber + 정규식 추출 → output/추출결과.xlsx
│   └── sample_pdfs/ · output/
├── taskB_mes_mail/         과제 B. MES 라인별 진행현황 07시 기준 메일
│   ├── sample_data/mes_status.csv   Mock MES 데이터
│   ├── mes_mail.py         비교 로직 + HTML 메일(앞당김 빨강/지연 검정) + .eml
│   └── output/
├── taskC_sap_excel_mail/   과제 C. 가공 엑셀 범위 → 메일 본문 + 첨부 초안
│   ├── make_sample.py      가공 완료 형태 샘플 엑셀 생성
│   ├── sap_mail.py         범위 → HTML 표 본문 + 날짜 이름 저장 + .eml 첨부
│   └── sample_data/ · output/
└── CLAUDE.md               작업 지시서 (기획서 원문 포함)
```

## 각 과제 실행 방법

사전 준비: Python 3.10+ (`openpyxl`, `pdfplumber`, `reportlab`), Node.js (과제 D 테스트용)

### 과제 D. 결품 응답 웹페이지 ★

```bash
cd taskD_shortage_web
python3 -m http.server 8000        # 또는 index.html 더블클릭
# 브라우저 → http://localhost:8000
node test/logic.test.js            # 순수 로직 테스트 (12건)
python3 sample_data/make_sample_excel.py   # 샘플 엑셀/데이터 재생성
```

- 담당자 모드: 엑셀 업로드 또는 **[샘플 데이터 불러오기]** → 업체별 응답 현황
  (미응답/이슈 있음/이상 없음), 이슈 부품 CSV·엑셀 내보내기, **[10시 마감 시뮬레이션]**
- 업체 모드: 업체코드 + 비밀번호(데모: 업체코드 뒤 3자리+00, `V001` → `00100`)
  → 담당 부품만 표시 → [특이사항 있음]/[없음] 응답 ('있음'은 사유·예상 입고일 필수)
- **⚠️ 데모 전용 인증**: 비밀번호가 업체코드에서 유도되고 클라이언트에서만 검증되므로
  보안 기능이 없습니다. 실배포 전 반드시 서버측 인증(또는 일회용 링크 토큰)으로 교체
  (`js/logic.js` `DEMO_AUTH` 블록, 과제 D README 참조)

### 과제 A. PDF → 엑셀 추출

```bash
python3 taskA_pdf_extract/make_samples.py   # 샘플 PDF 3종 생성
python3 taskA_pdf_extract/extract.py        # → output/추출결과.xlsx
python3 taskA_pdf_extract/test_extract.py   # 추출 규칙/오류 처리 테스트
```

### 과제 B. MES 진행현황 메일

```bash
python3 taskB_mes_mail/mes_mail.py
# → output/mes_report_YYYYMMDD.html / .eml
python3 taskB_mes_mail/test_mes_mail.py     # 07시 기준 판정 로직 테스트
```

### 과제 C. 엑셀 범위 → 팀 메일

```bash
python3 taskC_sap_excel_mail/make_sample.py
python3 taskC_sap_excel_mail/sap_mail.py
# → output/자재수급현황_YYYYMMDD.xlsx / sap_mail_YYYYMMDD.eml
python3 taskC_sap_excel_mail/test_sap_mail.py   # 표 생성/색 변환 로직 테스트
```

## 회사 PC 실제 연동 시 수정 지점 (어댑터 표)

| 과제 | 데모(개인 노트북) 구현 | 실제(회사 PC) 교체 대상 | 수정 위치 |
|---|---|---|---|
| D | localStorage 데모 DB | Supabase(PostgreSQL) 또는 Node/Express+SQLite | `taskD_shortage_web/js/app.js` `store` |
| D | 업체코드+간단 비밀번호 | 서버측 인증 / 일회용 링크 토큰 | `app.js` `vendorLogin()` |
| D | 카카오톡 알림 → 로그 기록 | 카카오 알림톡(비즈메시지) API (사업자 계약 필요, 1차는 이메일/SMS 가능) | `app.js` `notifyAdapter()` |
| D | [10시 마감 시뮬레이션] 버튼 | 서버 스케줄러(cron 등) 10:00 자동 실행 | `app.js` `runDeadline()` |
| D | 로컬 파일 열기 | Vercel/Netlify 정적 배포 (인터넷 공개, HTTPS) | 폴더 전체 배포 |
| A | reportlab 생성 샘플 PDF | 업체 수신 실제 PDF 폴더 | `extract.py` 실행 인자/`sample_pdfs` 경로 |
| A | 정규식 추출만 | (선택) 실패 건 LLM 보조 추출 | `extract.py` `extract_from_pdf()` |
| B | Mock CSV 읽기 | Playwright MES 스크래핑 또는 MES 엑셀 다운로드 읽기 | `mes_mail.py` `fetch_mes_rows()` |
| B | .eml 초안 저장 | Outlook COM(win32com) 발송 + 작업 스케줄러 07:00 | `mes_mail.py` `save_outputs()` |
| C | 샘플 가공 엑셀 | 팀즈 마스터 쿼리 파일 결과물(+xlwings RefreshAll) | `sap_mail.py` `SRC_XLSX` |
| C | 범위 → HTML 표 본문 | (선택) xlwings `range.to_png()` 이미지 캡처 | `sap_mail.py` `range_to_html()` |
| C | .eml 초안 저장 | Outlook COM 발송 | `sap_mail.py` `main()` 하단 |

세부 코드 예시(Playwright 셀렉터, win32com, 작업 스케줄러 등록, xlwings 캡처)는
각 과제 폴더의 README에 있습니다.

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 과제 D 프론트 | HTML/CSS/Vanilla JS (빌드 도구 없음), SheetJS(로컬 동봉 `lib/xlsx.full.min.js`) 엑셀 파싱, localStorage |
| 과제 D 테스트 | Node.js 내장 `assert` (순수 로직 분리 테스트) |
| 과제 A | Python, pdfplumber(텍스트/표 추출), 정규식, openpyxl, reportlab(샘플 생성) |
| 과제 B | Python 표준 라이브러리(csv, datetime, email) — HTML 메일 + .eml |
| 과제 C | Python, openpyxl(범위 서식 → HTML 표), email(.eml 첨부) |
| 실연동(문서화) | Playwright, win32com(Outlook), xlwings, Windows 작업 스케줄러, 카카오 알림톡, Supabase |

## 산출물 확인 (커밋에 포함된 실행 결과)

- `taskA_pdf_extract/output/추출결과.xlsx` — 샘플 3건 전부 정상 추출(검토필요 N)
- `taskB_mes_mail/output/mes_report_20260821.html/.eml` — 1라인 +80 앞당김(빨강), 2·4라인 지연(검정)
- `taskC_sap_excel_mail/output/sap_mail_20260821.eml` — 서식 반영 HTML 표 본문 + 엑셀 첨부
