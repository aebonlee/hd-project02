# 실무에 투입하기 — hd-project02 결품(D+4) 응답

이 화면의 목적은 **여러 협력업체가 같은 표를 보고 각자 응답하는 것**입니다.
브라우저에만 저장하면 담당자 화면과 업체 화면이 서로 다른 데이터를 보게 되어
목적 자체가 성립하지 않습니다. 그래서 서버(Supabase) 연결이 사실상 필수입니다.

---

## 1. 본인 Supabase 프로젝트 만들기

1. [supabase.com](https://supabase.com) 에서 무료 프로젝트를 하나 만듭니다.
2. **Settings → API** 에서 두 값을 복사합니다.
   - Project URL
   - Project API keys → **anon / public**
3. `taskD_shortage_web/js/config.js` 에 붙여 넣고 `USE_SUPABASE: true` 로 바꿉니다.

> ⚠ **service_role 키는 넣지 마세요.** 그 키는 RLS 를 통째로 우회합니다.
> anon 키는 브라우저에 그대로 노출돼도 되는 키이고, 실제 차단은 RLS 가 합니다.

## 2. 스키마 올리기

본인 프로젝트의 **SQL Editor** 에서 [`schema.sql`](schema.sql) 전체를 실행합니다.
재실행해도 안전합니다.

만들어지는 것:

| 표 | 담는 것 |
|---|---|
| `vendor` | 협력업체 (코드·업체명·담당자·연락처·Auth 연결) |
| `batch` | 일일 회차 (기준일·납기) |
| `shortage` | 결품 행. **결품수량은 저장하지 않고 `필요수량 − 재고`로 계산**됩니다 |
| `response` | 업체 응답. 특이사항 '있음'인데 사유가 비면 **DB가 저장을 막습니다** |
| `log` | 알림 이력 (INSERT·SELECT 만 가능) |
| `admin` | 담당자 |
| `shortage_board` (뷰) | 화면이 한 번에 읽는 모양 |

## 3. 계정 만들기 — 여기가 핵심입니다

**업체는 자기 것만 봐야 합니다.** 화면 필터가 아니라 RLS 가 막습니다.
RLS 가 "지금 접속한 사람이 어느 업체인지" 알려면 Auth 사용자와 업체를 이어 줘야 합니다.

### 담당자(관리자) 계정

1. Authentication → Users → **Add user** 로 본인 계정을 만듭니다.
2. 관리자로 등록합니다.

   ```sql
   insert into admin (user_id, email)
   select id, email from auth.users where email = '<본인 이메일>'
   on conflict (user_id) do nothing;
   ```

### 업체 계정

업체는 이메일이 아니라 **업체코드**로 로그인합니다.
그래서 코드를 가짜 이메일로 바꿔 Auth 계정을 만듭니다.
규칙은 `js/config.js` 의 `AUTH_EMAIL_DOMAIN` 과 **반드시 같아야** 합니다.

| 업체코드 | 만들 계정 이메일 | 비밀번호 |
|---|---|---|
| `V001` | `V001@vendor.example.com` | 업체에 따로 전달 |

계정을 만든 뒤 업체 행과 이어 줍니다.

```sql
update vendor v
   set auth_user_id = u.id
  from auth.users u
 where u.email = v.code || '@vendor.example.com';
```

이어 주지 않으면 그 업체는 **로그인은 되는데 자기 결품이 하나도 안 보입니다.**
RLS 가 소속을 몰라서 전부 걸러 내기 때문입니다.

## 4. 확인

1. 담당자로 로그인 → 엑셀(또는 샘플 데이터) 등록
2. **다른 브라우저(또는 시크릿 창)** 로 업체 계정 로그인
3. 담당자가 등록한 표가 그대로 보이고, 응답하면 담당자 화면에도 반영되는지 확인

상단 띠에 **"서버에 연결됨 — 입력한 내용이 팀 전체에 공유됩니다."** 가 떠야 합니다.
`이 브라우저에만 저장됩니다` 가 뜨면 아직 데모 모드입니다(띠에 이유가 함께 나옵니다).

## 5. 검증

```bash
./scripts/sqltest/run.sh
```

임시 PostgreSQL 을 띄워 `schema.sql` 을 **실제로 적용해** 봅니다.
부족수량 계산, 사유 필수 제약, 응답의 업체코드를 서버가 채우는지,
업체 격리 조건이 정책에 들어 있는지까지 확인합니다.

## 6. 아직 사람이 해야 하는 것

정직하게 적어 둡니다.

- **알림 발송이 모의입니다.** 지금은 로그만 남습니다.
  실제 카카오 알림톡·문자로 보내려면 `app.js` 의 `notifyAdapter()` 한 곳을
  Supabase Edge Function 호출로 바꾸면 됩니다. 그 함수에서 알리고·NHN 등 API 를 부릅니다.
- **엑셀은 사람이 올립니다.** SAP/MES 에서 자동으로 끌어오려면 별도 연동이 필요합니다.
- **비밀번호 초기화**는 Supabase 대시보드에서 합니다.
