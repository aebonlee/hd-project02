/**
 * Supabase 저장소 — 협력업체가 각자 접속해 응답할 수 있게 한다.
 *
 * 이 화면의 목적은 "여러 업체가 같은 표를 보고 각자 응답하는 것"이다.
 * 브라우저에만 저장하면 담당자 화면과 업체 화면이 서로 다른 데이터를 보게 되어
 * 목적 자체가 성립하지 않는다.
 *
 * app.js 가 쓰던 세 뭉치를 그대로 흉내 낸다.
 *   data      : { date, uploadedAt, rows: [...] }   ← 한글 키를 쓰는 엑셀 행
 *   responses : { [rowId]: {status, reason, eta, respondedAt} }
 *   log       : [ {time, channel, to, message} ]
 *
 * 표의 컬럼은 영문이고 화면은 한글 키를 쓰므로, 그 변환을 여기서만 한다.
 * 화면 코드는 저장 위치가 바뀐 것을 모른다.
 */
(function (root) {
  'use strict';

  var HD = root.HD;
  var mem = { data: null, responses: {}, log: [], vendors: [], batchId: null };

  /* ------------------------------------------------------------ 열 변환 */

  // 표(영문 컬럼) → 화면(한글 키)
  function toRow(r) {
    return {
      id: String(r.id),
      '일자': r.base_date,
      '업체코드': r.vendor_code,
      '업체명': r.vendor_name,
      '담당자명': r.manager || '',
      '담당자 연락처': r.phone || '',
      '품번': r.part_no,
      '품명': r.part_name || '',
      '필요수량': Number(r.required_qty) || 0,
      '확보수량': Number(r.stock_qty) || 0,
      '결품수량': Number(r.shortage_qty) || 0,
      '확정구간': r.confirm_span || '',
      '라인': r.line || ''
    };
  }

  // 화면(한글 키) → 표(영문 컬럼)
  function toShortage(row, batchId) {
    return {
      batch_id: batchId,
      vendor_code: row['업체코드'],
      part_no: row['품번'],
      part_name: row['품명'] || null,
      // ⚠ 결품수량은 보내지 않는다. 표에서 `필요수량 - 확보수량` 으로 계산되는 열이라
      //    보내면 "generated column 에는 쓸 수 없다"며 저장이 통째로 실패한다.
      required_qty: Number(row['필요수량']) || 0,
      stock_qty: Number(row['확보수량']) || 0,
      confirm_span: row['확정구간'] || null,
      line: row['라인'] || null
    };
  }

  /* ---------------------------------------------------------------- 조회 */

  function hydrate(fetched) {
    var board = fetched['shortage_board'] || [];
    var logs = fetched['log'] || [];

    mem.vendors = [];
    var seen = {};
    board.forEach(function (r) {
      if (!seen[r.vendor_code]) {
        seen[r.vendor_code] = true;
        mem.vendors.push({ code: r.vendor_code, name: r.vendor_name });
      }
    });

    mem.data = board.length
      ? {
          date: board[0].base_date,
          uploadedAt: board[0].base_date,
          rows: board.map(toRow)
        }
      : null;

    mem.responses = {};
    board.forEach(function (r) {
      if (r.response_status === '미응답') return;
      mem.responses[String(r.id)] = {
        status: r.response_status,
        reason: r.reason || '',
        eta: r.eta_date || '',
        respondedAt: r.responded_at ? String(r.responded_at).slice(0, 16).replace('T', ' ') : ''
      };
    });

    mem.log = logs.map(function (l) {
      return {
        time: String(l.ran_at || '').slice(0, 16).replace('T', ' '),
        channel: l.kind || '',
        to: '',
        message: l.detail || ''
      };
    });

    return mem;
  }

  /* ---------------------------------------------------------------- 저장 */

  /** 담당자가 엑셀을 올렸을 때 — 회차 하나와 그 아래 행들을 통째로 넣는다. */
  function saveBatch(data) {
    var rows = (data && data.rows) || [];
    if (!rows.length) return Promise.resolve(0);

    var baseDate = data.date;
    // 회차는 기준일 하나당 하나. 다시 올리면 덮어쓴다.
    return HD.upsert('batch', {
      base_date: baseDate,
      due_date: baseDate,
      row_count: rows.length
    }, 'base_date')
      .then(function () {
        return HD.client().from('batch').select('id').eq('base_date', baseDate).limit(1);
      })
      .then(function (r) {
        if (r.error) throw r.error;
        var batchId = r.data && r.data[0] && r.data[0].id;
        if (!batchId) throw new Error('회차를 만들지 못했습니다.');
        mem.batchId = batchId;

        // 업체 마스터가 없으면 결품 행이 외래키에 걸린다. 먼저 채운다.
        var vendors = {};
        rows.forEach(function (row) {
          vendors[row['업체코드']] = {
            code: row['업체코드'],
            name: row['업체명'] || row['업체코드'],
            manager: row['담당자명'] || null,
            phone: row['담당자 연락처'] || null
          };
        });
        return HD.upsert('vendor', Object.keys(vendors).map(function (k) { return vendors[k]; }), 'code')
          .then(function () {
            return HD.upsert('shortage',
              rows.map(function (row) { return toShortage(row, batchId); }),
              'batch_id,vendor_code,part_no');
          });
      })
      .then(function () { return rows.length; });
  }

  /** 업체가 한 건 응답했을 때 */
  function saveResponse(rowId, resp) {
    return HD.upsert('response', {
      shortage_id: Number(rowId),
      // vendor_code 는 보내지 않아도 트리거가 결품 행에서 채운다.
      // 클라이언트가 보낸 값을 믿으면 남의 업체 코드를 실어 보낼 수 있다.
      vendor_code: null,
      has_issue: resp.status === '있음',
      reason: resp.status === '있음' ? resp.reason : null,
      eta_date: resp.status === '있음' && resp.eta ? resp.eta : null
    }, 'shortage_id');
  }

  function saveLog(entry) {
    return HD.insert('log', {
      kind: entry.channel || '알림',
      detail: (entry.to ? '[' + entry.to + '] ' : '') + (entry.message || '')
    });
  }

  function clearAll() {
    // 회차를 지우면 결품·응답도 함께 사라진다(on delete cascade).
    return HD.client().from('batch').delete().neq('id', -1).then(function (r) {
      if (r.error) throw r.error;
    });
  }

  root.ShortageSupabase = {
    tables: [
      { name: 'shortage_board', order: { column: 'vendor_code', ascending: true } },
      { name: 'log', order: { column: 'ran_at', ascending: false }, limit: 200 }
    ],
    hydrate: hydrate,
    mem: function () { return mem; },
    saveBatch: saveBatch,
    saveResponse: saveResponse,
    saveLog: saveLog,
    clearAll: clearAll
  };
})(typeof self !== 'undefined' ? self : this);
