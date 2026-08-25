/**
 * 서버 모드 통합 테스트 — 실행: scripts/sqltest/run-server-test.sh
 *
 * 이 화면의 목적은 "여러 업체가 같은 표를 보고 각자 응답하는 것"이다.
 * 담당자가 올린 엑셀이 서버에 들어가고, 업체 응답이 담당자 화면에 나타나야
 * 목적이 성립한다. 단위 테스트(계산)도 SQL 하네스(제약)도 그 사이는 못 본다.
 *
 * 진짜 PostgreSQL 에 진짜 schema.sql 을 올리고,
 * 고치지 않은 hd-supabase.js + supabase-store.js 를 그대로 태운다.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { makeClient, query } = require("./fake-supabase.js");

const root = path.join(__dirname, "..");
const APP = path.join(root, "taskD_shortage_web");

const sandbox = { self: null, window: null, console,
  APP_CONFIG: { USE_SUPABASE: true, SUPABASE_URL: "http://local", SUPABASE_ANON_KEY: "local" },
  supabase: { createClient: makeClient } };
sandbox.self = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, "js/hd-supabase.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, "js/supabase-store.js"), "utf8"), sandbox);
const HD = sandbox.HD;
const ST = sandbox.ShortageSupabase;

const one = (q) => (query(q).data || [])[0];
const cnt = (t, cond) => Number(one("select count(*)::int as n from public." + t + (cond ? " where " + cond : "")).n);

/** 담당자가 올린 엑셀 한 장 (화면이 만드는 한글 키 그대로) */
function sheet(date) {
  const mk = (v, p, need, have, span) => ({
    "일자": date, "업체코드": v, "업체명": v + " 정밀", "담당자명": "김담당",
    "담당자 연락처": "010-0000-0000", "품번": p, "품명": p + " 브라켓",
    "필요수량": need, "확보수량": have, "결품수량": need - have,
    "확정구간": span, "라인": "A라인"
  });
  return { date: date, uploadedAt: date, rows: [
    mk("V-A", "31LM-10310", 100, 40, "D+4"),
    mk("V-A", "31LM-10311", 50, 50, "D+4"),
    mk("V-B", "31Q8-20120", 200, 120, "D+5")
  ] };
}

let passed = 0, failed = 0;
const tests = [];
const test = (n, f) => tests.push({ name: n, fn: f });

test("담당자가 엑셀을 올리면 업체·회차·결품이 한 번에 들어간다", async () => {
  const n = await ST.saveBatch(sheet("2026-08-25"));
  assert.strictEqual(n, 3, "행 수가 다르다");
  assert.strictEqual(cnt("batch"), 1);
  assert.strictEqual(cnt("vendor"), 2, "업체 마스터가 안 채워지면 결품이 외래키에 걸린다");
  assert.strictEqual(cnt("shortage"), 3);
});

test("결품수량은 표가 계산한다 — 보내지 않아도 맞는다", async () => {
  const r = one("select shortage_qty from public.shortage where part_no='31LM-10310'");
  assert.strictEqual(Number(r.shortage_qty), 60, "필요 100 - 확보 40 = 60 이어야 한다");
});

test("같은 날짜로 다시 올리면 덮어쓴다 — 회차가 늘지 않는다", async () => {
  const s = sheet("2026-08-25");
  s.rows[0]["확보수량"] = 90;
  const n = await ST.saveBatch(s);
  assert.strictEqual(n, 3);
  assert.strictEqual(cnt("batch"), 1, "회차가 중복으로 쌓였다");
  assert.strictEqual(cnt("shortage"), 3, "결품이 중복으로 쌓였다");
  assert.strictEqual(
    Number(one("select shortage_qty from public.shortage where part_no='31LM-10310'").shortage_qty), 10,
    "덮어쓴 값이 반영되지 않았다");
});

test("업체 응답이 저장되고 담당자 화면에 나타난다", async () => {
  const id = one("select id from public.shortage where part_no='31Q8-20120'").id;
  await ST.saveResponse(id, { status: "있음", reason: "원자재 입고 지연", eta: "2026-08-30" });
  const r = one("select * from public.response where shortage_id=" + id);
  assert.ok(r, "응답이 저장되지 않았다");
  assert.strictEqual(r.has_issue, true);
  // ★ 업체 코드는 클라이언트가 보낸 값을 믿지 않고 트리거가 채운다
  assert.strictEqual(r.vendor_code, "V-B", "트리거가 업체 코드를 안 채웠다");
  assert.ok(r.responded_at, "응답 시각이 없다");
});

test("응답 상태가 화면이 읽는 뷰에 반영된다", async () => {
  const rows = query("select * from public.shortage_board order by vendor_code, part_no").data;
  assert.strictEqual(rows.length, 3);
  const answered = rows.filter(r => r.part_no === "31Q8-20120")[0];
  // 뷰 두 개가 낱말이 다르다 — `status` 는 '특이사항 있음', `shortage_board` 는 '있음'.
  // 화면이 읽는 것은 shortage_board 이고, 앱의 응답 값도 '있음'/'없음' 이라 이쪽이 정본이다.
  assert.strictEqual(answered.response_status, "있음");
  const pending = rows.filter(r => r.part_no === "31LM-10310")[0];
  assert.strictEqual(pending.response_status, "미응답");
  assert.strictEqual(pending.manager, "김담당", "담당자 연락처가 뷰에 안 붙었다");
});

test("같은 행에 다시 응답하면 덮어쓴다 — 이력이 갈라지지 않는다", async () => {
  const id = one("select id from public.shortage where part_no='31Q8-20120'").id;
  await ST.saveResponse(id, { status: "없음" });
  assert.strictEqual(cnt("response", "shortage_id=" + id), 1, "응답이 중복으로 쌓였다");
  assert.strictEqual(one("select has_issue from public.response where shortage_id=" + id).has_issue, false);
});

test("화면이 쓰던 모양으로 되돌아온다 (한글 키)", async () => {
  const fetched = await HD.fetchAll(ST.tables);
  const mem = ST.hydrate(fetched);
  assert.ok(mem.data && mem.data.rows.length === 3, "행이 안 돌아왔다");
  const r = mem.data.rows[0];
  for (const k of ["업체코드", "품번", "필요수량", "확보수량", "결품수량"]) {
    assert.ok(k in r, "한글 키 " + k + " 가 없다");
  }
  assert.strictEqual(mem.vendors.length, 2, "업체 목록이 안 만들어졌다");
});

test("알림 이력이 남는다", async () => {
  const before = cnt("log");
  await ST.saveLog({ channel: "메일", to: "V-A", message: "응답 요청" });
  assert.ok(cnt("log") > before, "로그가 안 남았다");
});

test("회차를 지우면 결품·응답도 함께 사라진다", async () => {
  await ST.clearAll();
  assert.strictEqual(cnt("batch"), 0);
  assert.strictEqual(cnt("shortage"), 0, "결품이 남았다 (on delete cascade 확인)");
  assert.strictEqual(cnt("response"), 0, "응답이 남았다");
  assert.ok(cnt("vendor") > 0, "업체 마스터까지 지우면 안 된다");
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log("  ✔ " + t.name); }
    catch (e) { failed++; console.error("  ✘ " + t.name); console.error("    " + (e && e.message)); }
  }
  console.log("\n결과: " + passed + " 통과, " + failed + " 실패");
  if (failed > 0) process.exit(1);
})();
