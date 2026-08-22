// 결품 응답 웹페이지 — 순수 로직 모듈
// 브라우저(window.ShortageLogic)와 Node(require) 양쪽에서 사용 가능.
// DOM/localStorage 접근이 없는 순수 함수만 담아 node 테스트로 검증한다.
(function (global) {
  'use strict';

  // 결품현황 엑셀 필수 컬럼 (기획서 데이터 스키마)
  var REQUIRED_COLUMNS = [
    '일자', '업체코드', '업체명', '담당자명', '담당자 연락처',
    '품번', '품명', '필요수량', '확보수량', '결품수량', '확정구간', '라인'
  ];

  // ==================================================================
  // ★★★ [데모 전용 인증 설정] — 실배포 전 반드시 교체할 것 ★★★
  // 비밀번호가 업체코드에서 그대로 유도되고(뒤 3자리 + 접미사) 검증도
  // 클라이언트(브라우저)에서만 이루어지므로 보안 기능이 전혀 없다.
  // 실서비스에서는 이 블록을 삭제하고 서버측 인증(Supabase Auth 등의
  // 업체 계정 또는 매일 발급되는 일회용 링크 토큰)으로 교체한다. (README 참조)
  // ==================================================================
  var DEMO_AUTH = {
    passwordSuffix: '00', // 데모 규칙: 업체코드 뒤 3자리 + "00" (예: V001 → 00100)
    passwordOf: function (vendorCode) {
      var digits = String(vendorCode || '').replace(/\D/g, '');
      return digits.slice(-3) + DEMO_AUTH.passwordSuffix;
    }
  };

  function vendorPassword(vendorCode) {
    return DEMO_AUTH.passwordOf(vendorCode);
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value;
    var n = Number(String(value).replace(/[,\s]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  // SheetJS sheet_to_json(header:1) 결과(2차원 배열)를 레코드 배열로 정규화
  // 반환: { rows: [...], errors: [...] }
  function parseSheetRows(aoa) {
    var errors = [];
    if (!aoa || aoa.length < 2) {
      return { rows: [], errors: ['데이터가 없습니다. (헤더 + 1행 이상 필요)'] };
    }
    var header = (aoa[0] || []).map(function (h) {
      return String(h === undefined || h === null ? '' : h).trim();
    });
    var missing = REQUIRED_COLUMNS.filter(function (col) {
      return header.indexOf(col) === -1;
    });
    if (missing.length > 0) {
      return { rows: [], errors: ['필수 컬럼 누락: ' + missing.join(', ')] };
    }
    var idx = {};
    REQUIRED_COLUMNS.forEach(function (col) { idx[col] = header.indexOf(col); });

    var rows = [];
    for (var r = 1; r < aoa.length; r++) {
      var line = aoa[r];
      if (!line || line.length === 0) continue;
      var rec = {};
      REQUIRED_COLUMNS.forEach(function (col) {
        var v = line[idx[col]];
        rec[col] = v === undefined || v === null ? '' : v;
      });
      if (String(rec['업체코드']).trim() === '' || String(rec['품번']).trim() === '') {
        errors.push((r + 1) + '행: 업체코드/품번 누락 → 건너뜀');
        continue;
      }
      ['필요수량', '확보수량', '결품수량'].forEach(function (col) {
        rec[col] = toNumber(rec[col]);
      });
      rec['업체코드'] = String(rec['업체코드']).trim();
      rec.id = rec['업체코드'] + '|' + String(rec['품번']).trim() + '|' + r;
      rows.push(rec);
    }
    if (rows.length === 0) {
      errors.push('유효한 데이터 행이 없습니다.');
    }
    return { rows: rows, errors: errors };
  }

  // 레코드 배열(객체 형태, sample_data.js 용)을 id 부여하여 정규화
  function normalizeRecords(records) {
    var rows = [];
    (records || []).forEach(function (rec, i) {
      var copy = {};
      REQUIRED_COLUMNS.forEach(function (col) {
        copy[col] = rec[col] === undefined || rec[col] === null ? '' : rec[col];
      });
      ['필요수량', '확보수량', '결품수량'].forEach(function (col) {
        copy[col] = toNumber(copy[col]);
      });
      copy['업체코드'] = String(copy['업체코드']).trim();
      copy.id = copy['업체코드'] + '|' + String(copy['품번']).trim() + '|' + (i + 1);
      rows.push(copy);
    });
    return rows;
  }

  // 업체코드별로 그룹화 → [{ code, name, manager, phone, parts: [...] }]
  function groupByVendor(rows) {
    var map = {};
    var order = [];
    (rows || []).forEach(function (rec) {
      var code = rec['업체코드'];
      if (!map[code]) {
        map[code] = {
          code: code,
          name: rec['업체명'],
          manager: rec['담당자명'],
          phone: rec['담당자 연락처'],
          parts: []
        };
        order.push(code);
      }
      map[code].parts.push(rec);
    });
    return order.map(function (code) { return map[code]; });
  }

  // 응답 유효성: '있음'이면 사유 + 예상 입고일 필수
  function validateResponse(status, reason, eta) {
    if (status === '없음') return { ok: true };
    if (status === '있음') {
      if (!reason || String(reason).trim() === '') {
        return { ok: false, message: '특이사항 있음 선택 시 사유를 입력해야 합니다.' };
      }
      if (!eta || String(eta).trim() === '') {
        return { ok: false, message: '특이사항 있음 선택 시 예상 입고일을 입력해야 합니다.' };
      }
      return { ok: true };
    }
    return { ok: false, message: '상태는 있음/없음 중 하나여야 합니다.' };
  }

  // 업체 하나의 응답 상태: 미응답 / 이슈 있음 / 이상 없음
  // responses: { [rowId]: { status: '있음'|'없음', reason, eta, respondedAt } }
  function vendorStatus(vendor, responses) {
    responses = responses || {};
    var answered = 0;
    var issues = 0;
    vendor.parts.forEach(function (part) {
      var resp = responses[part.id];
      if (resp && (resp.status === '있음' || resp.status === '없음')) {
        answered++;
        if (resp.status === '있음') issues++;
      }
    });
    var status;
    if (answered === 0) status = '미응답';
    else if (issues > 0) status = '이슈 있음';
    else if (answered === vendor.parts.length) status = '이상 없음';
    else status = '미응답'; // 일부만 응답 → 아직 마감 전 미완료로 취급
    return {
      status: status,
      answered: answered,
      total: vendor.parts.length,
      issues: issues
    };
  }

  // 담당자 모니터링 요약
  function summarize(vendors, responses) {
    var perVendor = vendors.map(function (v) {
      var s = vendorStatus(v, responses);
      return {
        code: v.code, name: v.name, manager: v.manager, phone: v.phone,
        status: s.status, answered: s.answered, total: s.total, issues: s.issues
      };
    });
    var counts = { '미응답': 0, '이슈 있음': 0, '이상 없음': 0 };
    perVendor.forEach(function (v) { counts[v.status]++; });
    return { perVendor: perVendor, counts: counts };
  }

  // 이슈('있음' 응답) 부품 목록 — 생산계획 변경 검토용
  function issueRows(rows, responses) {
    responses = responses || {};
    var out = [];
    (rows || []).forEach(function (rec) {
      var resp = responses[rec.id];
      if (resp && resp.status === '있음') {
        out.push({
          '업체코드': rec['업체코드'],
          '업체명': rec['업체명'],
          '품번': rec['품번'],
          '품명': rec['품명'],
          '결품수량': rec['결품수량'],
          '확정구간': rec['확정구간'],
          '라인': rec['라인'],
          '사유': resp.reason || '',
          '예상 입고일': resp.eta || '',
          '응답시각': resp.respondedAt || ''
        });
      }
    });
    return out;
  }

  // CSV 문자열 생성 (엑셀 호환을 위해 호출측에서 BOM을 붙인다)
  function toCsv(records) {
    if (!records || records.length === 0) return '';
    var headers = Object.keys(records[0]);
    var esc = function (v) {
      var s = String(v === undefined || v === null ? '' : v);
      if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    var lines = [headers.map(esc).join(',')];
    records.forEach(function (rec) {
      lines.push(headers.map(function (h) { return esc(rec[h]); }).join(','));
    });
    return lines.join('\r\n');
  }

  // 10시 마감 체크: 마감 시각이 지났고 미응답/미완료인 업체 목록 반환
  // now: Date, deadlineHour: 기본 10시
  function overdueVendors(vendors, responses, now, deadlineHour) {
    deadlineHour = deadlineHour === undefined ? 10 : deadlineHour;
    var past = now.getHours() >= deadlineHour;
    if (!past) return { past: false, vendors: [] };
    var list = vendors.filter(function (v) {
      return vendorStatus(v, responses).status === '미응답';
    });
    return { past: true, vendors: list };
  }

  // 카카오톡 알림 메시지 본문 생성 (실서비스에서는 알림톡 어댑터로 전달)
  function buildNotifyMessage(vendor, dateStr) {
    return '[결품 응답 요청] ' + vendor.name + ' ' + vendor.manager + '님, ' +
      dateStr + ' 결품현황(' + vendor.parts.length + '건)에 대한 특이사항 응답이 ' +
      '마감시간(10시)까지 접수되지 않았습니다. 응답 페이지에 접속하여 회신 바랍니다.';
  }

  var api = {
    REQUIRED_COLUMNS: REQUIRED_COLUMNS,
    vendorPassword: vendorPassword,
    toNumber: toNumber,
    parseSheetRows: parseSheetRows,
    normalizeRecords: normalizeRecords,
    groupByVendor: groupByVendor,
    validateResponse: validateResponse,
    vendorStatus: vendorStatus,
    summarize: summarize,
    issueRows: issueRows,
    toCsv: toCsv,
    overdueVendors: overdueVendors,
    buildNotifyMessage: buildNotifyMessage
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ShortageLogic = api;
  }
})(typeof window !== 'undefined' ? window : this);
