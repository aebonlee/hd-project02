// 결품 응답 웹페이지 순수 로직 테스트
// 실행: node taskD_shortage_web/test/logic.test.js
'use strict';

const assert = require('assert');
const path = require('path');
const L = require(path.join(__dirname, '..', 'js', 'logic.js'));
const SAMPLE = require(path.join(__dirname, '..', 'js', 'sample_data.js'));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

console.log('# logic.js 테스트 시작');

test('vendorPassword: 업체코드 뒤 3자리 + 00', () => {
  assert.strictEqual(L.vendorPassword('V001'), '00100');
  assert.strictEqual(L.vendorPassword('V023'), '02300');
});

test('toNumber: 콤마/공백 처리', () => {
  assert.strictEqual(L.toNumber('1,200'), 1200);
  assert.strictEqual(L.toNumber(' 30 '), 30);
  assert.strictEqual(L.toNumber(''), 0);
  assert.strictEqual(L.toNumber('abc'), 0);
  assert.strictEqual(L.toNumber(45), 45);
});

test('parseSheetRows: 정상 시트 파싱', () => {
  const aoa = [
    L.REQUIRED_COLUMNS.slice(),
    ['2026-08-21', 'V001', '대한정밀', '김철수', '010-1111-2222',
     'HD-001-A', '브라켓', '100', '60', '40', 'D+2', '1라인'],
    ['2026-08-21', 'V002', '한빛금속', '이영희', '010-3333-4444',
     'HD-002-B', '빔', 200, 100, 100, 'D+4', '2라인'],
  ];
  const result = L.parseSheetRows(aoa);
  assert.strictEqual(result.rows.length, 2);
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(result.rows[0]['필요수량'], 100);
  assert.strictEqual(result.rows[0]['결품수량'], 40);
  assert.ok(result.rows[0].id.indexOf('V001|HD-001-A') === 0);
});

test('parseSheetRows: 필수 컬럼 누락 감지', () => {
  const result = L.parseSheetRows([['일자', '업체코드'], ['2026-08-21', 'V001']]);
  assert.strictEqual(result.rows.length, 0);
  assert.ok(result.errors[0].indexOf('필수 컬럼 누락') === 0);
});

test('parseSheetRows: 업체코드 없는 행 건너뜀', () => {
  const aoa = [
    L.REQUIRED_COLUMNS.slice(),
    ['2026-08-21', '', '대한정밀', '김철수', '010', 'HD-1', '부품', 1, 0, 1, 'D+1', '1라인'],
    ['2026-08-21', 'V001', '대한정밀', '김철수', '010', 'HD-2', '부품', 1, 0, 1, 'D+1', '1라인'],
  ];
  const result = L.parseSheetRows(aoa);
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.errors.length, 1);
});

test('normalizeRecords + groupByVendor: 샘플 데이터 5개 업체', () => {
  const rows = L.normalizeRecords(SAMPLE);
  assert.ok(rows.length >= 40, '샘플은 40행 이상이어야 함 (실제: ' + rows.length + ')');
  const vendors = L.groupByVendor(rows);
  assert.strictEqual(vendors.length, 5);
  vendors.forEach(v => {
    assert.ok(v.parts.length > 0);
    assert.ok(v.code && v.name && v.manager);
  });
});

test('validateResponse: 있음이면 사유+예상입고일 필수', () => {
  assert.strictEqual(L.validateResponse('없음').ok, true);
  assert.strictEqual(L.validateResponse('있음', '', '2026-08-25').ok, false);
  assert.strictEqual(L.validateResponse('있음', '금형 수리 지연', '').ok, false);
  assert.strictEqual(L.validateResponse('있음', '금형 수리 지연', '2026-08-25').ok, true);
  assert.strictEqual(L.validateResponse('보류').ok, false);
});

test('vendorStatus: 미응답/이슈 있음/이상 없음 판정', () => {
  const vendor = {
    code: 'V001', name: '대한정밀', manager: '김철수', phone: '010',
    parts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  };
  assert.strictEqual(L.vendorStatus(vendor, {}).status, '미응답');
  // 일부만 응답 → 아직 미완료(미응답)
  assert.strictEqual(
    L.vendorStatus(vendor, { a: { status: '없음' } }).status, '미응답');
  // 전체 응답 + 이슈 없음 → 이상 없음
  assert.strictEqual(
    L.vendorStatus(vendor, {
      a: { status: '없음' }, b: { status: '없음' }, c: { status: '없음' }
    }).status, '이상 없음');
  // 하나라도 '있음' → 이슈 있음 (전체 응답 전이라도)
  const s = L.vendorStatus(vendor, { a: { status: '있음', reason: 'r', eta: 'd' } });
  assert.strictEqual(s.status, '이슈 있음');
  assert.strictEqual(s.issues, 1);
});

test('summarize: 업체별 상태 집계', () => {
  const rows = L.normalizeRecords(SAMPLE);
  const vendors = L.groupByVendor(rows);
  const responses = {};
  // 첫 업체는 전부 '없음' 응답
  vendors[0].parts.forEach(p => { responses[p.id] = { status: '없음' }; });
  // 둘째 업체는 1건 '있음'
  responses[vendors[1].parts[0].id] = { status: '있음', reason: '설비 고장', eta: '2026-08-28' };
  const sum = L.summarize(vendors, responses);
  assert.strictEqual(sum.counts['이상 없음'], 1);
  assert.strictEqual(sum.counts['이슈 있음'], 1);
  assert.strictEqual(sum.counts['미응답'], 3);
  assert.strictEqual(sum.perVendor.length, 5);
});

test('issueRows + toCsv: 이슈 목록 내보내기', () => {
  const rows = L.normalizeRecords(SAMPLE);
  const target = rows[0];
  const responses = {};
  responses[target.id] = {
    status: '있음', reason: '원자재 수급, 지연', eta: '2026-08-29',
    respondedAt: '2026-08-21 09:12'
  };
  const issues = L.issueRows(rows, responses);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0]['품번'], target['품번']);
  assert.strictEqual(issues[0]['사유'], '원자재 수급, 지연');
  const csv = L.toCsv(issues);
  const lines = csv.split('\r\n');
  assert.strictEqual(lines.length, 2);
  assert.ok(lines[0].indexOf('업체코드') === 0);
  // 콤마 포함 값은 따옴표 처리
  assert.ok(csv.indexOf('"원자재 수급, 지연"') !== -1);
});

test('overdueVendors: 10시 이전에는 알림 없음, 이후에는 미응답 업체만', () => {
  const rows = L.normalizeRecords(SAMPLE);
  const vendors = L.groupByVendor(rows);
  const responses = {};
  vendors[0].parts.forEach(p => { responses[p.id] = { status: '없음' }; });

  const before = L.overdueVendors(vendors, responses, new Date(2026, 7, 21, 9, 59), 10);
  assert.strictEqual(before.past, false);
  assert.strictEqual(before.vendors.length, 0);

  const after = L.overdueVendors(vendors, responses, new Date(2026, 7, 21, 10, 0), 10);
  assert.strictEqual(after.past, true);
  assert.strictEqual(after.vendors.length, 4); // 응답 완료한 1개 업체 제외
});

test('buildNotifyMessage: 알림 문구 생성', () => {
  const vendor = { name: '대한정밀', manager: '김철수', parts: [1, 2, 3] };
  const msg = L.buildNotifyMessage(vendor, '2026-08-21');
  assert.ok(msg.indexOf('대한정밀') !== -1);
  assert.ok(msg.indexOf('김철수') !== -1);
  assert.ok(msg.indexOf('3건') !== -1);
  assert.ok(msg.indexOf('10시') !== -1);
});

console.log('# 전체 ' + passed + '개 테스트 통과');
