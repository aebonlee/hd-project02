-- 로컬 검증 전용 — hd-project02 (운영 실행 금지)
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin','authenticator'))
     or exists (select 1 from pg_namespace where nspname='graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다.';
  end if;
end;
$guard$;

do $t$ begin raise notice '[프로젝트] 부족수량 · 응답 제약 · 업체 격리'; end $t$;

-- 준비
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@v.example'),
  ('22222222-2222-2222-2222-222222222222', 'b@v.example')
on conflict (id) do nothing;

insert into public.vendor (code, name, auth_user_id) values
  ('V-A', '가업체', '11111111-1111-1111-1111-111111111111'),
  ('V-B', '나업체', '22222222-2222-2222-2222-222222222222')
on conflict (code) do nothing;

do $t$
declare v_b bigint; v_sa bigint; v_sb bigint;
begin
  insert into public.batch (base_date, due_date) values ('2026-08-24','2026-08-28')
  on conflict (base_date) do update set due_date = excluded.due_date returning id into v_b;

  insert into public.shortage (batch_id, vendor_code, part_no, required_qty, stock_qty)
  values (v_b,'V-A','P-1',100,30) on conflict (batch_id,vendor_code,part_no) do nothing;
  insert into public.shortage (batch_id, vendor_code, part_no, required_qty, stock_qty)
  values (v_b,'V-B','P-2',50,80)  on conflict (batch_id,vendor_code,part_no) do nothing;

  select id into v_sa from public.shortage where batch_id=v_b and vendor_code='V-A';
  select id into v_sb from public.shortage where batch_id=v_b and vendor_code='V-B';

  -- 부족수량은 저장값이 아니라 계산값이다
  perform public._assert_eq(
    (select shortage_qty from public.shortage where id=v_sa), 70::numeric,
    '부족수량 = 소요량 - 재고 (100-30=70)');
  perform public._assert_eq(
    (select shortage_qty from public.shortage where id=v_sb), 0::numeric,
    '재고가 소요량보다 많으면 부족수량 0 (음수가 되지 않는다)');

  -- 소요량을 고치면 부족수량이 따라온다 — 따로 저장했다면 여기서 어긋난다
  update public.shortage set required_qty = 200 where id = v_sa;
  perform public._assert_eq(
    (select shortage_qty from public.shortage where id=v_sa), 170::numeric,
    '소요량을 고치면 부족수량이 자동으로 따라온다');
  update public.shortage set required_qty = 100 where id = v_sa;

  -- 특이사항 "유"인데 사유가 비면 막힌다
  declare v_r boolean := false;
  begin
    begin
      insert into public.response (shortage_id, vendor_code, has_issue)
      values (v_sa, 'V-A', true);
    exception when check_violation then v_r := true;
    end;
    perform public._assert(v_r, '특이사항 있음인데 사유가 비면 check 제약이 막는다');
  end;

  declare v_r2 boolean := false;
  begin
    begin
      insert into public.response (shortage_id, vendor_code, has_issue, reason)
      values (v_sa, 'V-A', true, '   ');
    exception when check_violation then v_r2 := true;
    end;
    perform public._assert(v_r2, '공백만 있는 사유도 막는다');
  end;

  -- 정상 응답
  insert into public.response (shortage_id, vendor_code, has_issue, reason, eta_date)
  values (v_sa, 'V-A', true, '원자재 입고 지연', '2026-08-30')
  on conflict (shortage_id) do update set reason = excluded.reason;

  -- 트리거가 업체 코드를 서버에서 채운다 (클라이언트 값을 믿지 않는다)
  insert into public.response (shortage_id, vendor_code, has_issue)
  values (v_sb, 'V-A', false)          -- 일부러 남의 코드를 실어 보낸다
  on conflict (shortage_id) do nothing;
  perform public._assert_eq(
    (select vendor_code from public.response where shortage_id = v_sb), 'V-B',
    '응답의 업체 코드는 클라이언트 값이 아니라 결품 행에서 채워진다');

  -- 한 결품 행에 응답은 하나
  declare v_r3 boolean := false;
  begin
    begin
      insert into public.response (shortage_id, vendor_code, has_issue)
      values (v_sa, 'V-A', false);
    exception when unique_violation then v_r3 := true;
    end;
    perform public._assert(v_r3, '한 결품 행에 응답은 하나만 (UNIQUE)');
  end;

  -- 현황 뷰
  perform public._assert_eq(
    (select response_status from public.status where shortage_id = v_sa),
    '특이사항 있음', '응답 상태가 뷰에 반영된다');
  perform public._assert_eq(
    (select issues from public.vendor_summary where vendor_code='V-A' and batch_id=v_b),
    1::bigint, '업체 요약에 특이사항 건수가 잡힌다');
end $t$;

-- 업체 격리 — 응답 삭제 정책이 없어야 한다(없던 일로 만들 수 없게)
do $t$
declare v_cnt int;
begin
  select count(*) into v_cnt from pg_policy p join pg_class c on c.oid=p.polrelid
   where c.relname='response' and p.polcmd='d';
  perform public._assert_eq(v_cnt, 0, '응답에는 DELETE 정책이 없다');
end $t$;

do $t$
declare v_bad text;
begin
  -- 업체별 자료 테이블에는 반드시 업체 격리 조건이 들어간 SELECT 정책이 있어야 한다
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('shortage','response')
     and not exists (
       select 1 from pg_policy p
        where p.polrelid=c.oid and p.polcmd='r'
          and pg_get_expr(p.polqual, p.polrelid) like '%current_vendor%');
  perform public._assert(v_bad is null,
    '업체별 자료의 조회 정책에 업체 격리 조건이 들어 있다' || coalesce(' (누락: '||v_bad||')',''));
end $t$;

delete from public.batch where base_date = '2026-08-24';
delete from public.vendor where code in ('V-A','V-B');
delete from auth.users where email in ('a@v.example','b@v.example');

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
