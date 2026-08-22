# 과제 D. 협력업체 결품(D+4) 응답 웹페이지 ★ 우선

매일 아침 업체별 결품 현황 엑셀을 메일로 보내고 전화/문자로 회신을 받던 업무를,
**업체가 직접 접속해 특이사항 유/무를 응답하는 웹페이지**로 대체하는 데모입니다.

빌드 도구 없이 `index.html` 하나로 동작하는 순수 HTML/CSS/JS 단일 페이지 앱이며,
데모 데이터베이스로 브라우저 `localStorage`를 사용합니다.

## 실행 방법

```bash
# 방법 1: 브라우저에서 바로 열기
open taskD_shortage_web/index.html        # (Windows: 파일 더블클릭)

# 방법 2: 간이 웹서버 (권장 — 드래그 업로드가 더 안정적)
cd taskD_shortage_web
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

1. **담당자 모드**에서 `sample_data/결품현황_샘플.xlsx` 를 업로드하거나
   **[샘플 데이터 불러오기]** 버튼을 누르면 즉시 데모가 시작됩니다.
2. **업체 모드**로 전환 → 업체코드 선택 + 비밀번호 입력(데모 규칙: 업체코드 뒤 3자리+00, `V001` → `00100`).
3. 부품별 **[특이사항 있음]/[없음]** 버튼으로 응답 — '있음'이면 사유·예상 입고일 입력이 필수입니다.
4. 담당자 모드에서 업체별 응답 현황(미응답/이슈 있음/이상 없음), 이슈 부품 목록 확인,
   CSV/엑셀 내보내기, **[10시 마감 시뮬레이션]** 으로 미응답 업체 알림 로그를 확인합니다.

## 파일 구성

| 경로 | 설명 |
|---|---|
| `index.html` | 단일 페이지 앱 (담당자 모드 + 업체 모드) |
| `css/style.css` | 스타일 |
| `lib/xlsx.full.min.js` | SheetJS 엑셀 파서 (로컬 동봉 — 오프라인/사내망 동작. 원본: https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js) |
| `js/logic.js` | 순수 계산 로직 (파싱·상태 판정·마감 체크 — node 테스트 대상) |
| `js/app.js` | 화면/이벤트/localStorage 제어 |
| `js/sample_data.js` | 샘플 데이터 (엑셀과 동일 내용, 버튼 데모용) |
| `sample_data/결품현황_샘플.xlsx` | 업로드 데모용 샘플 엑셀 (5개 업체, 44행) |
| `sample_data/make_sample_excel.py` | 샘플 엑셀 + sample_data.js 재생성 스크립트 |
| `test/logic.test.js` | 순수 로직 테스트 |

## 테스트

```bash
node taskD_shortage_web/test/logic.test.js
python3 taskD_shortage_web/sample_data/make_sample_excel.py   # 샘플 재생성
```

## 엑셀 스키마 (필수 컬럼)

일자, 업체코드, 업체명, 담당자명, 담당자 연락처, 품번, 품명,
필요수량, 확보수량, 결품수량, 확정구간(D+1~D+4), 라인

## 실서비스 전환(어댑터) 지점

| 데모 구현 | 실서비스 교체 대상 | 위치 |
|---|---|---|
| localStorage 저장 | Supabase(PostgreSQL) 또는 Node/Express + SQLite | `js/app.js` 의 `store` 객체 |
| 업체코드+간단 비밀번호 | Supabase Auth 계정 또는 매일 발급되는 일회용 링크 토큰 | `js/app.js` 의 `vendorLogin()` |
| 카카오톡 알림 → 로그 기록 | 카카오 알림톡(비즈메시지) API — 사업자 계약 필요. 1차는 이메일/SMS 대체 가능 | `js/app.js` 의 `notifyAdapter()` |
| [10시 마감 시뮬레이션] 버튼 | 서버 스케줄러(cron, Supabase Edge Function 스케줄) 10:00 자동 실행 | `js/app.js` 의 `runDeadline()` |
| 정적 파일 열기 | Vercel/Netlify 정적 배포 (인터넷 공개) + HTTPS | 프로젝트 루트 배포 |

보안 수준: 사외 협력업체 접속을 전제로 하며, 업체 코드+비밀번호(또는 일회용 링크 토큰) 수준의
중간 보안을 가정합니다(기획서 5번 가정). 실배포 시 HTTPS 필수, 응답 API는 서버측 검증 필요.

> **⚠️ 데모 전용 인증 경고**
> 현재 업체 비밀번호는 업체코드에서 자동 유도되는 규칙(뒤 3자리+`00`)이며
> 검증도 브라우저(클라이언트)에서만 이루어지므로 **보안 기능이 전혀 없습니다.**
> 규칙과 코드가 모두 공개되어 있어 누구나 임의 업체로 로그인할 수 있습니다.
> 실배포 전에 반드시 `js/logic.js`의 `DEMO_AUTH` 블록을 제거하고
> **서버측 인증(Supabase Auth 등의 업체 계정) 또는 매일 발급되는 일회용 링크 토큰**으로 교체해야 합니다.

로그인 세션: 업체 로그인 상태는 `sessionStorage`에 보관되어 **새로고침해도 유지**되며,
탭/브라우저를 닫거나 [로그아웃]·[데이터 초기화] 시 만료됩니다.
