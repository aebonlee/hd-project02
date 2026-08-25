-- ============================================================================
-- hd-project02 — D+4 결품 현황 · 협력업체 응답 웹
-- Supabase(Postgres) 운영 스키마 + RLS
--
--  실행 위치 : Supabase Dashboard → SQL Editor
--  재실행    : 안전합니다
--
--  이 스키마는 **수강생 본인의 Supabase 프로젝트**에 올리는 것을 전제로 합니다.
--  프로젝트가 본인 것이라 테이블 이름에 접두사를 붙이지 않았습니다.
--
--  이 시스템의 핵심 요구는 **업체 간 데이터가 절대 교차 노출되지 않는 것**입니다.
--  화면 필터만으로는 부족합니다 — 아래 RLS 가 DB 차원에서 강제합니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

create table if not exists public.vendor (
  code         text primary key,                 -- 업체 코드 (로그인 ID)
  name         text not null,
  manager      text,
  email        text,
  phone        text,
  auth_user_id uuid unique,                      -- Supabase Auth 사용자와 연결
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- 일일 발송 회차 — 하루 한 벌
create table if not exists public.batch (
  id           bigint generated always as identity primary key,
  base_date    date not null,                    -- 기준일
  due_date     date not null,                    -- D+4 납기
  label        text,
  row_count    int not null default 0,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  constraint batch_base_date_key unique (base_date)
);
create index if not exists batch_base_idx on public.batch (base_date desc);

-- 결품 현황 (SAP/MES 에서 추출한 행)
create table if not exists public.shortage (
  id           bigint generated always as identity primary key,
  batch_id     bigint not null references public.batch(id) on delete cascade,
  vendor_code  text not null references public.vendor(code),
  part_no      text not null,
  part_name    text,
  required_qty numeric not null default 0,       -- 소요량
  stock_qty    numeric not null default 0,       -- 재고
  -- 부족수량은 저장하지 않고 계산한다. 따로 저장하면 소요량·재고를 고치는 순간
  -- 셋이 어긋나는데, 그 어긋남이 화면에 드러나지 않는다.
  shortage_qty numeric generated always as (greatest(required_qty - stock_qty, 0)) stored,
  due_date     date,
  constraint shortage_uniq unique (batch_id, vendor_code, part_no)
);
create index if not exists shortage_vendor_idx on public.shortage (vendor_code);
create index if not exists shortage_batch_idx  on public.shortage (batch_id);

-- 업체 응답 — "특이사항 유/무"가 이 시스템의 목적
create table if not exists public.response (
  id           bigint generated always as identity primary key,
  shortage_id  bigint not null references public.shortage(id) on delete cascade,
  vendor_code  text not null references public.vendor(code),
  has_issue    boolean not null,                 -- 특이사항 유(true) / 무(false)
  -- 특이사항이 "유"인데 사유가 비면 응답을 받는 의미가 없다. DB 에서 막는다.
  reason       text,
  eta_date     date,                             -- 대응(납기) 예정일
  responded_at timestamptz not null default now(),
  responded_by uuid default auth.uid(),
  constraint response_one_per_row unique (shortage_id),
  constraint response_reason_required
    check (has_issue = false or (reason is not null and btrim(reason) <> ''))
);
create index if not exists response_vendor_idx on public.response (vendor_code);

create table if not exists public.log (
  id        bigint generated always as identity primary key,
  ran_at    timestamptz not null default now(),
  kind      text not null,
  detail    text,
  processed int not null default 0,
  failed    int not null default 0,
  actor     uuid default auth.uid()
);
create index if not exists log_ran_at_idx on public.log (ran_at desc);

create table if not exists public.admin (
  user_id    uuid primary key,
  email      text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. 함수 — search_path 고정
-- ----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.admin a where a.user_id = auth.uid());
$fn$;

-- 지금 로그인한 사람의 업체 코드. RLS 정책이 이 값으로 행을 가른다.
create or replace function public.current_vendor()
returns text language sql stable security definer set search_path = public as $fn$
  select v.code from public.vendor v where v.auth_user_id = auth.uid() limit 1;
$fn$;

-- 응답 저장 시 업체 코드를 서버에서 채운다.
-- 클라이언트가 보내는 값을 믿으면 다른 업체 코드를 실어 보낼 수 있다.
create or replace function public.set_response_vendor()
returns trigger language plpgsql set search_path = public as $fn$
declare v_owner text;
begin
  select s.vendor_code into v_owner from public.shortage s where s.id = new.shortage_id;
  if v_owner is null then
    raise exception '결품 행을 찾을 수 없습니다 (shortage_id=%)', new.shortage_id;
  end if;
  new.vendor_code := v_owner;
  new.responded_at := now();
  return new;
end;
$fn$;

drop trigger if exists response_set_vendor on public.response;
create trigger response_set_vendor
  before insert or update on public.response
  for each row execute function public.set_response_vendor();

-- ----------------------------------------------------------------------------
-- 3. 뷰 — 응답 현황
-- ----------------------------------------------------------------------------


-- ⚠ 뷰에는 `with (security_invoker = true)` 를 붙인다.
--   붙이지 않으면 뷰는 **만든 사람(postgres)의 권한**으로 돌아, 뷰를 읽을 수 있는
--   사람이 밑에 깔린 표의 RLS 를 통째로 지나친다. 표만 잠그고 뷰를 안 잠그면 헛일이다.
--   (hd-project03 에서 실제로 남의 업체 실사 결과가 뷰로 그대로 보였다)
--   security_invoker 는 PostgreSQL 15 부터. Supabase 는 15 이상이다.
create or replace view public.status with (security_invoker = true) as
select
  b.id            as batch_id,
  b.base_date,
  b.due_date,
  s.id            as shortage_id,
  s.vendor_code,
  v.name          as vendor_name,
  s.part_no,
  s.part_name,
  s.required_qty,
  s.stock_qty,
  s.shortage_qty,
  case
    when r.id is null      then '미응답'
    when r.has_issue       then '특이사항 있음'
    else                        '특이사항 없음'
  end             as response_status,
  r.reason,
  r.eta_date,
  r.responded_at
from public.shortage s
join public.batch  b on b.id = s.batch_id
join public.vendor v on v.code = s.vendor_code
left join public.response r on r.shortage_id = s.id;

create or replace view public.vendor_summary with (security_invoker = true) as
select batch_id, base_date, vendor_code, vendor_name,
       count(*)                                              as total,
       count(*) filter (where response_status = '미응답')      as pending,
       count(*) filter (where response_status = '특이사항 있음') as issues,
       count(*) filter (where response_status = '특이사항 없음') as clear,
       sum(shortage_qty)                                     as shortage_qty
from public.status
group by batch_id, base_date, vendor_code, vendor_name;

-- ----------------------------------------------------------------------------
-- 4. RLS — 업체는 자기 것만, 담당자는 전부
--
--  이 블록이 이 시스템에서 가장 중요한 부분입니다.
--  화면 필터는 한 겹일 뿐이고, 여기서 막지 않으면 주소만 바꿔도 남의 자료가 보입니다.
-- ----------------------------------------------------------------------------

alter table public.vendor   enable row level security;
alter table public.batch    enable row level security;
alter table public.shortage enable row level security;
alter table public.response enable row level security;
alter table public.log      enable row level security;
alter table public.admin    enable row level security;

-- 업체 정보: 본인 것 또는 관리자
drop policy if exists vendor_read   on public.vendor;
drop policy if exists vendor_write  on public.vendor;
drop policy if exists vendor_update on public.vendor;
drop policy if exists vendor_delete on public.vendor;
create policy vendor_read on public.vendor for select to authenticated
  using (public.is_admin() or code = public.current_vendor());
create policy vendor_write on public.vendor for insert to authenticated
  with check (public.is_admin());
create policy vendor_update on public.vendor for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy vendor_delete on public.vendor for delete to authenticated
  using (public.is_admin());

-- 회차: 누구나 읽고, 관리자만 만든다
drop policy if exists batch_read   on public.batch;
drop policy if exists batch_write  on public.batch;
drop policy if exists batch_update on public.batch;
drop policy if exists batch_delete on public.batch;
create policy batch_read   on public.batch for select to authenticated using (true);
create policy batch_write  on public.batch for insert to authenticated with check (public.is_admin());
create policy batch_update on public.batch for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy batch_delete on public.batch for delete to authenticated using (public.is_admin());

-- 결품 행: 본인 업체 것만
drop policy if exists shortage_read   on public.shortage;
drop policy if exists shortage_write  on public.shortage;
drop policy if exists shortage_update on public.shortage;
drop policy if exists shortage_delete on public.shortage;
create policy shortage_read on public.shortage for select to authenticated
  using (public.is_admin() or vendor_code = public.current_vendor());
create policy shortage_write on public.shortage for insert to authenticated
  with check (public.is_admin());
create policy shortage_update on public.shortage for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy shortage_delete on public.shortage for delete to authenticated
  using (public.is_admin());

-- 응답: 본인 업체 행에만 쓸 수 있다.
-- INSERT 정책이 `shortage 의 주인이 나인가` 를 확인하므로,
-- 남의 shortage_id 를 실어 보내면 정책에서 걸린다.
drop policy if exists response_read   on public.response;
drop policy if exists response_write  on public.response;
drop policy if exists response_update on public.response;
drop policy if exists response_delete on public.response;
create policy response_read on public.response for select to authenticated
  using (public.is_admin() or vendor_code = public.current_vendor());
create policy response_write on public.response for insert to authenticated
  with check (
    public.is_admin() or exists (
      select 1 from public.shortage s
       where s.id = shortage_id and s.vendor_code = public.current_vendor())
  );
create policy response_update on public.response for update to authenticated
  using (public.is_admin() or vendor_code = public.current_vendor())
  with check (public.is_admin() or vendor_code = public.current_vendor());
-- DELETE 정책은 두지 않는다. 응답을 지워 없던 일로 만들 수 없어야 한다.

drop policy if exists log_read  on public.log;
drop policy if exists log_write on public.log;
create policy log_read  on public.log for select to authenticated using (public.is_admin());
create policy log_write on public.log for insert to authenticated with check (true);

drop policy if exists admin_read on public.admin;
create policy admin_read on public.admin for select to authenticated using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5. 함수 실행 권한 (§3.7 — GRANT 만으로는 제한되지 않는다)
-- ----------------------------------------------------------------------------

revoke all on function public.is_admin()             from public, anon;
revoke all on function public.current_vendor()       from public, anon;
revoke all on function public.set_response_vendor()  from public, anon;

grant execute on function public.is_admin()            to authenticated;
grant execute on function public.current_vendor()      to authenticated;
grant execute on function public.set_response_vendor() to authenticated;

-- ----------------------------------------------------------------------------
-- 끝. 업체 계정 발급:
--   ① Supabase Auth 에 사용자 생성 (업체코드 기반 가상 이메일 가능)
--   ② update public.vendor set auth_user_id = '<uuid>' where code = '<업체코드>';
-- ----------------------------------------------------------------------------

-- ===============================================================
-- 6. 화면이 실제로 쓰는 열 보강 (2026-08-25)
--    앱의 엑셀 양식에는 있는데 스키마에 빠져 있던 것들.
--    나중에 덧붙인 절이라 add column if not exists 로 쓴다.
-- ===============================================================

alter table shortage add column if not exists line         text;   -- '2라인'
alter table shortage add column if not exists confirm_span text;   -- 'D+3' 확정구간
alter table vendor   add column if not exists password_hint text;  -- 초기 비밀번호 안내용(선택)

-- 업체 담당자에게 바로 연락할 수 있어야 실무에서 쓰인다
comment on column vendor.manager is '담당자명';
comment on column vendor.phone   is '담당자 연락처';

-- 화면이 한 번에 읽는 모양 그대로 뷰로 낸다.
-- 앱이 여러 표를 조인하지 않아도 되도록 여기서 미리 붙여 둔다.
create or replace view shortage_board with (security_invoker = true) as
select
  s.id,
  b.base_date,
  b.due_date        as batch_due_date,
  s.vendor_code,
  v.name            as vendor_name,
  v.manager,
  v.phone,
  s.part_no,
  s.part_name,
  s.required_qty,
  s.stock_qty,
  s.shortage_qty,
  s.confirm_span,
  s.line,
  r.has_issue,
  r.reason,
  r.eta_date,
  r.responded_at,
  case
    when r.id is null then '미응답'
    when r.has_issue  then '있음'
    else                   '없음'
  end               as response_status
from shortage s
join batch  b on b.id = s.batch_id
join vendor v on v.code = s.vendor_code
left join response r on r.shortage_id = s.id;
