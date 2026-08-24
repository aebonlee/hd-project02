// 결품 응답 웹페이지 — 화면/저장소 제어 (DOM + localStorage)
// 순수 계산 로직은 js/logic.js 참조.
(function () {
  'use strict';

  var L = window.ShortageLogic;

  // ---------- localStorage 저장소 (데모 DB) ----------
  var KEY_DATA = 'shortage.data.v1';        // { date, uploadedAt, rows: [...] }
  var KEY_RESP = 'shortage.responses.v1';   // { [rowId]: {status, reason, eta, respondedAt} }
  var KEY_LOG = 'shortage.notifylog.v1';    // [ { time, channel, to, message } ]
  var KEY_SESSION = 'shortage.session.v1';  // 로그인한 업체코드 (sessionStorage — 탭 닫으면 만료)

  var store = {
    load: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    save: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 무시 */ }
    },
    remove: function (key) {
      try { localStorage.removeItem(key); } catch (e) { /* 무시 */ }
    }
  };

  // 업체 로그인 세션 저장소 (새로고침에도 유지, 탭을 닫으면 만료)
  var session = {
    load: function () {
      try { return sessionStorage.getItem(KEY_SESSION) || null; } catch (e) { return null; }
    },
    save: function (code) {
      try { sessionStorage.setItem(KEY_SESSION, code); } catch (e) { /* 무시 */ }
    },
    clear: function () {
      try { sessionStorage.removeItem(KEY_SESSION); } catch (e) { /* 무시 */ }
    }
  };

  var state = {
    data: store.load(KEY_DATA, null),
    responses: store.load(KEY_RESP, {}),
    log: store.load(KEY_LOG, []),
    vendorSession: session.load() // 로그인한 업체코드 (새로고침 시 복원)
  };

  // ---------- 저장 위치 ----------
  // 서버(Supabase)에 연결되면 여러 업체·담당자가 같은 자료를 본다.
  // 연결 안 되면 지금까지처럼 이 브라우저에만 저장한다(데모).
  // 화면 코드는 아래 세 함수만 부르면 되고, 어디에 저장되는지 몰라도 된다.
  var SB = null;   // 서버 모드일 때만 채워진다

  function persistBatch() {
    store.save(KEY_DATA, state.data);
    store.save(KEY_RESP, state.responses);
    if (SB) HD.guard(SB.saveBatch(state.data), '결품 현황 등록');
  }
  function persistResponse(rowId) {
    store.save(KEY_RESP, state.responses);
    if (SB) HD.guard(SB.saveResponse(rowId, state.responses[rowId]), '응답 저장');
  }
  function persistLog(entry) {
    store.save(KEY_LOG, state.log);
    if (SB && entry) HD.guard(SB.saveLog(entry), '알림 로그');
  }

  // ---------- 유틸 ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  var toastTimer = null;
  function toast(msg, isError) {
    var el = $('toast');
    el.textContent = msg;
    el.className = isError ? 'error show' : 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 2600);
  }
  function nowStr() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function vendors() {
    return state.data ? L.groupByVendor(state.data.rows) : [];
  }

  // ---------- 알림 어댑터 ----------
  // [어댑터 지점] 실서비스에서는 sendKakaoAlimtalk(vendor, message) 등으로 교체.
  // 개인 환경에서는 로그 기록으로 대체한다.
  function notifyAdapter(vendor, message) {
    var entry = {
      time: nowStr(),
      channel: 'KAKAO(모의)',
      to: vendor.manager + ' (' + vendor.phone + ')',
      message: message
    };
    state.log.push(entry);
    persistLog(entry);
    return entry;
  }

  // ---------- 담당자 모드 렌더링 ----------
  function renderManager() {
    var hasData = !!(state.data && state.data.rows.length);
    $('managerEmpty').hidden = hasData;
    $('managerDash').hidden = !hasData;
    var badge = $('dataDateBadge');
    if (hasData) {
      badge.hidden = false;
      badge.textContent = '기준일: ' + state.data.date + ' · ' + state.data.rows.length + '건';
    } else {
      badge.hidden = true;
      return;
    }

    var vs = vendors();
    var sum = L.summarize(vs, state.responses);

    // 요약 카드
    $('summaryGrid').innerHTML =
      '<div class="summary-item"><div class="label">전체 업체</div><div class="value">' + vs.length + '</div></div>' +
      '<div class="summary-item v-none"><div class="label">미응답</div><div class="value">' + sum.counts['미응답'] + '</div></div>' +
      '<div class="summary-item v-issue"><div class="label">이슈 있음</div><div class="value">' + sum.counts['이슈 있음'] + '</div></div>' +
      '<div class="summary-item v-ok"><div class="label">이상 없음</div><div class="value">' + sum.counts['이상 없음'] + '</div></div>';

    // 업체별 상태 테이블
    var chipClass = { '미응답': 'chip-none', '이슈 있음': 'chip-issue', '이상 없음': 'chip-ok' };
    $('vendorStatusBody').innerHTML = sum.perVendor.map(function (v) {
      return '<tr>' +
        '<td>' + esc(v.code) + '</td>' +
        '<td>' + esc(v.name) + '</td>' +
        '<td>' + esc(v.manager) + '</td>' +
        '<td>' + esc(v.phone) + '</td>' +
        '<td><span class="chip ' + chipClass[v.status] + '">' + v.status + '</span></td>' +
        '<td class="num">' + v.answered + ' / ' + v.total + '</td>' +
        '<td class="num">' + (v.issues > 0 ? '<span class="shortage">' + v.issues + '</span>' : '0') + '</td>' +
        '</tr>';
    }).join('');

    // 이슈 목록
    var issues = L.issueRows(state.data.rows, state.responses);
    $('issueEmptyHint').hidden = issues.length > 0;
    $('issueBody').innerHTML = issues.map(function (row) {
      return '<tr>' +
        '<td>' + esc(row['업체명']) + ' (' + esc(row['업체코드']) + ')</td>' +
        '<td>' + esc(row['품번']) + '</td>' +
        '<td>' + esc(row['품명']) + '</td>' +
        '<td class="num"><span class="shortage">' + esc(row['결품수량']) + '</span></td>' +
        '<td>' + esc(row['확정구간']) + '</td>' +
        '<td>' + esc(row['라인']) + '</td>' +
        '<td style="white-space:normal; min-width:160px;">' + esc(row['사유']) + '</td>' +
        '<td>' + esc(row['예상 입고일']) + '</td>' +
        '<td>' + esc(row['응답시각']) + '</td>' +
        '</tr>';
    }).join('');

    renderLog();
  }

  function renderLog() {
    $('notifyLog').innerHTML = state.log.map(function (e) {
      return '<div><span class="log-time">[' + esc(e.time) + '] [' + esc(e.channel) + ']</span> ' +
        esc(e.to) + ' &rarr; ' + esc(e.message) + '</div>';
    }).join('');
  }

  // ---------- 데이터 등록 ----------
  function applyRows(rows, sourceLabel) {
    state.data = {
      date: rows[0] ? String(rows[0]['일자']) : nowStr().slice(0, 10),
      uploadedAt: nowStr(),
      rows: rows
    };
    state.responses = {}; // 새 현황 등록 시 응답 초기화
    persistBatch();
    toast(sourceLabel + ' — ' + rows.length + '건 등록 완료'
      + (SB ? ' (업체 화면에도 바로 보입니다)' : ''));
    $('uploadStatus').textContent = sourceLabel + ' (' + rows.length + '건, ' + state.data.uploadedAt + ')';
    renderManager();
    renderVendorSelect();
  }

  function handleFile(file) {
    if (!file) return;
    if (typeof XLSX === 'undefined') {
      toast('엑셀 파서(SheetJS) 로드 실패 — lib/xlsx.full.min.js 파일을 확인하거나 샘플 데이터를 사용하세요.', true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        var result = L.parseSheetRows(aoa);
        if (result.rows.length === 0) {
          toast('업로드 실패: ' + (result.errors[0] || '데이터 없음'), true);
          return;
        }
        if (result.errors.length) {
          console.warn('업로드 경고:', result.errors);
        }
        applyRows(result.rows, '엑셀 업로드(' + file.name + ')');
      } catch (err) {
        toast('엑셀 파싱 오류: ' + err.message, true);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ---------- 내보내기 ----------
  function download(filename, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function exportCsv() {
    var issues = L.issueRows(state.data.rows, state.responses);
    if (issues.length === 0) { toast('내보낼 이슈 응답이 없습니다.', true); return; }
    var csv = '﻿' + L.toCsv(issues); // BOM: 엑셀에서 한글 깨짐 방지
    download('이슈부품목록_' + state.data.date + '.csv',
      new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    toast('CSV 파일을 내려받았습니다.');
  }

  function exportXlsx() {
    var issues = L.issueRows(state.data.rows, state.responses);
    if (issues.length === 0) { toast('내보낼 이슈 응답이 없습니다.', true); return; }
    if (typeof XLSX === 'undefined') { toast('엑셀 파서(SheetJS) 로드 실패 — CSV 내보내기를 이용하세요.', true); return; }
    var ws = XLSX.utils.json_to_sheet(issues);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '이슈부품');
    XLSX.writeFile(wb, '이슈부품목록_' + state.data.date + '.xlsx');
    toast('엑셀 파일을 내려받았습니다.');
  }

  // ---------- 10시 마감 시뮬레이션 ----------
  function runDeadline() {
    var vs = vendors();
    // 시뮬레이션이므로 강제로 10시가 지난 것으로 간주
    var fakeNow = new Date();
    fakeNow.setHours(10, 0, 0, 0);
    var result = L.overdueVendors(vs, state.responses, fakeNow, 10);
    if (result.vendors.length === 0) {
      toast('미응답 업체가 없습니다. 알림 발송 대상 없음.');
      return;
    }
    result.vendors.forEach(function (v) {
      notifyAdapter(v, L.buildNotifyMessage(v, state.data.date));
    });
    renderLog();
    toast('미응답 ' + result.vendors.length + '개 업체에 알림(모의) 발송 — 로그 확인');
  }

  // ---------- 업체 모드 ----------
  function renderVendorSelect() {
    var sel = $('vendorSelect');
    var vs = vendors();
    sel.innerHTML = vs.length
      ? vs.map(function (v) {
          return '<option value="' + esc(v.code) + '">' + esc(v.code) + ' — ' + esc(v.name) + '</option>';
        }).join('')
      : '<option value="">등록된 현황 없음</option>';
  }

  function vendorLogin() {
    var code = $('vendorSelect').value;
    var pw = $('vendorPw').value;
    if (!code) { toast('등록된 결품 현황이 없습니다. 담당자 모드에서 먼저 등록하세요.', true); return; }
    // [데모 전용] 클라이언트측 비밀번호 검증 — 실서비스에서는 서버측 인증으로 교체 (logic.js DEMO_AUTH 참조)
    if (pw !== L.vendorPassword(code)) {
      toast('비밀번호가 올바르지 않습니다.', true);
      return;
    }
    state.vendorSession = code;
    session.save(code);
    $('vendorPw').value = '';
    renderVendorPortal();
  }

  function renderVendorPortal() {
    var loggedIn = !!state.vendorSession;
    $('vendorLoginBox').hidden = loggedIn;
    $('vendorPortal').hidden = !loggedIn;
    $('vendorNoData').hidden = true;
    if (!loggedIn) return;

    var vendor = vendors().filter(function (v) { return v.code === state.vendorSession; })[0];
    if (!vendor) {
      $('vendorPortal').hidden = true;
      $('vendorNoData').hidden = false;
      return;
    }
    var st = L.vendorStatus(vendor, state.responses);
    $('vendorTitle').textContent = vendor.name + ' (' + vendor.code + ') — ' + vendor.manager + ' 님';
    $('vendorSubtitle').textContent = '기준일 ' + state.data.date +
      ' · 담당 부품 ' + vendor.parts.length + '건 · 응답 ' + st.answered + '건' +
      ' · 마감 10:00';

    $('vendorParts').innerHTML = vendor.parts.map(function (part) {
      var resp = state.responses[part.id];
      var cls = resp ? (resp.status === '있음' ? 'answered-issue' : 'answered-ok') : '';
      var html =
        '<div class="part-card ' + cls + '" data-id="' + esc(part.id) + '">' +
        '<div class="part-head">' +
        '<div>' +
        '<div class="pn">' + esc(part['품번']) + ' <span style="font-weight:400; color:var(--muted);">' + esc(part['품명']) + '</span></div>' +
        '<div class="part-meta">확정구간 ' + esc(part['확정구간']) + ' · ' + esc(part['라인']) +
        ' · 필요 ' + part['필요수량'] + ' / 확보 ' + part['확보수량'] +
        ' / 결품 <b>' + part['결품수량'] + '</b></div>' +
        '</div>' +
        (resp
          ? '<span class="chip ' + (resp.status === '있음' ? 'chip-issue' : 'chip-ok') + '">' +
            (resp.status === '있음' ? '특이사항 있음' : '이상 없음') + '</span>'
          : '<span class="chip chip-none">미응답</span>') +
        '</div>' +
        '<div class="answer-btns">' +
        '<button type="button" class="btn btn-answer' + (resp && resp.status === '있음' ? ' selected-issue' : '') + '" data-status="있음">특이사항 있음</button>' +
        '<button type="button" class="btn btn-answer' + (resp && resp.status === '없음' ? ' selected-ok' : '') + '" data-status="없음">특이사항 없음</button>' +
        '</div>';

      // '있음' 입력 폼 (선택 시 표시)
      html +=
        '<div class="issue-form" data-form hidden>' +
        '<div class="form-row"><label>사유 (필수)</label>' +
        '<input type="text" data-reason placeholder="예: 원자재 수급 지연" value="' + esc(resp && resp.reason || '') + '"></div>' +
        '<div class="form-row"><label>예상 입고일 (필수)</label>' +
        '<input type="date" data-eta value="' + esc(resp && resp.eta || '') + '"></div>' +
        '<button type="button" class="btn btn-primary" data-save>저장</button>' +
        '</div>';

      if (resp) {
        html += '<div class="answered-note">응답 시각: ' + esc(resp.respondedAt) +
          (resp.status === '있음'
            ? ' · 사유: ' + esc(resp.reason) + ' · 예상 입고일: ' + esc(resp.eta)
            : '') + '</div>';
      }
      html += '</div>';
      return html;
    }).join('');
  }

  function saveResponse(rowId, status, reason, eta) {
    var check = L.validateResponse(status, reason, eta);
    if (!check.ok) { toast(check.message, true); return false; }
    state.responses[rowId] = {
      status: status,
      reason: status === '있음' ? String(reason).trim() : '',
      eta: status === '있음' ? eta : '',
      respondedAt: nowStr()
    };
    persistResponse(rowId);
    return true;
  }

  // 부품 카드 이벤트 (위임)
  $('vendorParts').addEventListener('click', function (e) {
    var card = e.target.closest('.part-card');
    if (!card) return;
    var rowId = card.getAttribute('data-id');

    if (e.target.matches('.btn-answer')) {
      var status = e.target.getAttribute('data-status');
      if (status === '없음') {
        if (saveResponse(rowId, '없음')) {
          toast('저장되었습니다: 특이사항 없음');
          renderVendorPortal();
        }
      } else {
        // '있음' → 입력 폼 열기
        var form = card.querySelector('[data-form]');
        form.hidden = !form.hidden;
        if (!form.hidden) form.querySelector('[data-reason]').focus();
      }
      return;
    }

    if (e.target.matches('[data-save]')) {
      var form2 = card.querySelector('[data-form]');
      var reason = form2.querySelector('[data-reason]').value;
      var eta = form2.querySelector('[data-eta]').value;
      if (saveResponse(rowId, '있음', reason, eta)) {
        toast('저장되었습니다: 특이사항 있음');
        renderVendorPortal();
      }
    }
  });

  // ---------- 모드 전환 ----------
  function switchMode(mode) {
    var isManager = mode === 'manager';
    $('managerView').hidden = !isManager;
    $('vendorView').hidden = isManager;
    $('btnManagerMode').classList.toggle('active', isManager);
    $('btnVendorMode').classList.toggle('active', !isManager);
    if (isManager) {
      renderManager();
    } else {
      renderVendorSelect();
      renderVendorPortal();
    }
  }

  // ---------- 이벤트 바인딩 ----------
  $('btnManagerMode').addEventListener('click', function () { switchMode('manager'); });
  $('btnVendorMode').addEventListener('click', function () { switchMode('vendor'); });

  var zone = $('uploadZone');
  zone.addEventListener('click', function () { $('fileInput').click(); });
  zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', function () { zone.classList.remove('dragover'); });
  zone.addEventListener('drop', function (e) {
    e.preventDefault();
    zone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
  });
  $('fileInput').addEventListener('change', function (e) {
    handleFile(e.target.files[0]);
    e.target.value = '';
  });

  $('btnLoadSample').addEventListener('click', function () {
    var rows = L.normalizeRecords(window.SAMPLE_SHORTAGE_DATA || []);
    if (rows.length === 0) { toast('샘플 데이터를 찾을 수 없습니다.', true); return; }
    applyRows(rows, '샘플 데이터');
  });

  $('btnClearAll').addEventListener('click', function () {
    if (!confirm('등록된 현황·응답·알림 로그를 모두 삭제할까요?')) return;
    store.remove(KEY_DATA); store.remove(KEY_RESP); store.remove(KEY_LOG);
    if (SB) HD.guard(SB.clearAll(), '서버 자료 삭제');
    state.data = null; state.responses = {}; state.log = []; state.vendorSession = null;
    session.clear();
    $('uploadStatus').textContent = '';
    renderManager();
    renderVendorSelect();
    renderVendorPortal();
    toast('초기화되었습니다.');
  });

  $('btnExportCsv').addEventListener('click', exportCsv);
  $('btnExportXlsx').addEventListener('click', exportXlsx);
  $('btnDeadline').addEventListener('click', runDeadline);
  $('btnClearLog').addEventListener('click', function () {
    state.log = [];
    persistLog(null);
    renderLog();
  });

  $('btnVendorLogin').addEventListener('click', vendorLogin);
  $('vendorPw').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') vendorLogin();
  });
  $('btnVendorLogout').addEventListener('click', function () {
    state.vendorSession = null;
    session.clear();
    renderVendorPortal();
  });

  // ---------- 시작 ----------
  function paint() {
    renderManager();
    renderVendorSelect();
    renderLog();
    if (state.vendorSession) switchMode('vendor');
  }

  // 저장 실패를 토스트로 보여 준다. 조용히 넘어가면 사용자는 저장된 줄 안다.
  if (root_HD()) HD.onNotify(function (msg, isError) { toast(msg, isError); });

  function root_HD() { return typeof HD !== 'undefined' && HD; }

  if (root_HD() && HD.available() && window.ShortageSupabase) {
    HD.boot({
      tables: window.ShortageSupabase.tables,
      onReady: function (fetched) {
        var m = window.ShortageSupabase.hydrate(fetched);
        SB = window.ShortageSupabase;
        state.data = m.data;
        state.responses = m.responses;
        state.log = m.log;
        paint();
      },
      onFallback: function () {
        // 연결 실패 — 이 브라우저에 있던 것으로 계속 쓴다. 배너에 이유가 뜬다.
        SB = null;
        paint();
      }
    });
  } else {
    if (root_HD()) HD.banner('demo');
    paint();
  }
})();
