/**
 * 과제 B — MES 라인별 진행현황 아침 메일
 *
 * 판정 규칙의 정본은 `taskB_mes_mail/mes_mail.py` 다.
 * 이 파일은 같은 기준·같은 색·같은 문구로 브라우저에서 돌린다.
 * 규칙이 갈리면 "파이썬 보고서와 웹 보고서가 다르다" 가 된다.
 *
 * 파일은 서버로 보내지 않는다 — 읽기도 메일 생성도 이 브라우저 안에서 끝난다.
 */
(function () {
  'use strict';

  var BASELINE_HOUR = 7;
  var TH = "border:1px solid #b9c6d6;padding:6px 10px;background:#1f4e79;color:#ffffff;font-size:13px;";
  var TD = "border:1px solid #b9c6d6;padding:6px 10px;font-size:13px;";

  var $ = function (s) { return document.querySelector(s); };
  var picked = null;
  var lastMail = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function comma(n) { return Number(n || 0).toLocaleString('ko-KR'); }

  /* ───────────────────────────── CSV 읽기 ───────────────────────────── */

  /**
   * 아주 단순한 CSV 파서. 따옴표로 감싼 값과 그 안의 쉼표까지 처리한다.
   * (엑셀에서 내보낸 CSV 는 품명에 쉼표가 들어가는 일이 흔하다)
   */
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // BOM
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1)
      .filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); })
      .map(function (r) {
        var o = {};
        head.forEach(function (h, i) { o[h] = (r[i] == null ? '' : String(r[i]).trim()); });
        return o;
      });
  }

  /** 'YYYY-MM-DD HH:MM' — 시간대에 휘둘리지 않게 직접 뜯는다 */
  function parseDt(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v || '').trim());
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  }

  /* ───────────────────────────── 판정 ───────────────────────────── */

  function analyze(rows) {
    var planDates = rows.map(function (r) { return parseDt(r['투입계획일시']); })
                        .filter(Boolean);
    if (!planDates.length) throw new Error('투입계획일시를 읽지 못했습니다. 열 이름과 날짜 형식을 확인하세요.');
    var latest = new Date(Math.max.apply(null, planDates.map(function (d) { return d.getTime(); })));
    var baseline = new Date(latest.getFullYear(), latest.getMonth(), latest.getDate(), BASELINE_HOUR, 0);

    var lines = {}, order = [];
    rows.forEach(function (r) {
      var line = r['라인'];
      if (!line) return;
      if (!lines[line]) {
        lines[line] = { '라인': line, '계획기준수량': 0, '시작기준수량': 0,
                        '실적수량': 0, '지시건수': 0, '미시작건수': 0 };
        order.push(line);
      }
      var rec = lines[line];
      var planDt = parseDt(r['투입계획일시']);
      var startDt = parseDt(r['시작일시']);
      var planQty = parseInt(r['계획수량'] || 0, 10) || 0;
      rec['지시건수'] += 1;
      rec['실적수량'] += parseInt(r['실적수량'] || 0, 10) || 0;
      if (planDt && planDt <= baseline) rec['계획기준수량'] += planQty;
      if (startDt && startDt <= baseline) rec['시작기준수량'] += planQty;
      // ⚠ 시작일시가 비어 있으면 **미시작**으로 따로 센다.
      //    0으로 치면 지연이 눈에 안 띈다.
      if (!startDt) rec['미시작건수'] += 1;
    });

    return { baseline: baseline, stats: order.map(function (l) {
      var rec = lines[l];
      var diff = rec['시작기준수량'] - rec['계획기준수량'];
      rec['차이수량'] = diff;
      if (diff > 0) { rec['상태'] = '앞당김'; rec['색상'] = 'red'; }
      else if (diff < 0) { rec['상태'] = '지연'; rec['색상'] = 'black'; }
      else { rec['상태'] = '정상'; rec['색상'] = 'black'; }
      return rec;
    })};
  }

  /* ───────────────────────────── 메일 본문 ───────────────────────────── */

  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
         + '-' + String(d.getDate()).padStart(2, '0');
  }

  function renderHtml(baseline, stats) {
    var dateStr = ymd(baseline);
    var rowsHtml = stats.map(function (r) {
      var color = r['색상'] === 'red' ? '#d64545' : '#000000';
      var bold = r['상태'] !== '정상' ? 'font-weight:bold;' : '';
      var sign = r['차이수량'] > 0 ? '+' : '';
      return '<tr style="color:' + color + ';' + bold + '">'
        + '<td style="' + TD + '">' + esc(r['라인']) + '</td>'
        + '<td style="' + TD + 'text-align:center;">' + esc(r['상태']) + '</td>'
        + '<td style="' + TD + 'text-align:right;">' + comma(r['계획기준수량']) + '</td>'
        + '<td style="' + TD + 'text-align:right;">' + comma(r['시작기준수량']) + '</td>'
        + '<td style="' + TD + 'text-align:right;">' + sign + comma(r['차이수량']) + '</td>'
        + '<td style="' + TD + 'text-align:right;">' + comma(r['실적수량']) + '</td>'
        + '<td style="' + TD + 'text-align:center;">' + r['미시작건수'] + ' / ' + r['지시건수'] + '</td>'
        + '</tr>';
    }).join('\n');

    var ahead = stats.filter(function (r) { return r['상태'] === '앞당김'; }).map(function (r) { return r['라인']; });
    var behind = stats.filter(function (r) { return r['상태'] === '지연'; }).map(function (r) { return r['라인']; });
    var parts = [];
    if (ahead.length) parts.push('<span style="color:#d64545;font-weight:bold;">앞당김: ' + ahead.join(', ') + '</span>');
    if (behind.length) parts.push('<span style="color:#000000;font-weight:bold;">지연: ' + behind.join(', ') + '</span>');
    var summary = parts.length ? parts.join(' · ') : '전 라인 계획대로 진행 중';

    return '<html>\n<body style="font-family:\'Malgun Gothic\',\'맑은 고딕\',sans-serif;color:#22303f;">\n'
      + '  <h2 style="font-size:16px;">[MES] 라인별 진행현황 보고 — ' + dateStr + ' 07:00 기준</h2>\n'
      + '  <p style="font-size:13px;">안녕하세요. ' + dateStr + ' 07시 기준 라인별 투입 진행현황을 보고드립니다.<br>\n'
      + '  ' + summary + '</p>\n'
      + '  <table style="border-collapse:collapse;">\n    <tr>\n'
      + '      <th style="' + TH + '">라인</th><th style="' + TH + '">상태</th>\n'
      + '      <th style="' + TH + '">계획 기준수량</th><th style="' + TH + '">시작 기준수량</th>\n'
      + '      <th style="' + TH + '">차이수량</th><th style="' + TH + '">누적 실적</th>\n'
      + '      <th style="' + TH + '">미시작/전체 지시</th>\n    </tr>\n'
      + rowsHtml + '\n  </table>\n'
      + '  <p style="font-size:12px;color:#6b7a8c;">\n'
      + '    * 차이수량 = 07:00까지 시작된 지시의 계획수량 합 − 07:00까지 투입 예정이던 계획수량 합<br>\n'
      + '    * <span style="color:#d64545;">빨간색 = 라인이 앞당겨지고 있음</span>, 검은색 = 밀리거나 계획대로 진행<br>\n'
      + '    * 본 메일은 자동 발송되었습니다.\n  </p>\n</body>\n</html>';
  }

  /** Outlook·Apple Mail 에서 그냥 열리는 .eml. 제목·본문의 한글은 base64 로 싼다. */
  function buildEml(subject, html) {
    var b64 = function (s) {
      return btoa(String.fromCharCode.apply(null, new TextEncoder().encode(s)));
    };
    return [
      'Subject: =?UTF-8?B?' + b64(subject) + '?=',
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '', b64(html)
    ].join('\r\n');
  }

  function download(name, content, mime) {
    var blob = new Blob([content], { type: mime || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* ───────────────────────────── 화면 ───────────────────────────── */

  function renderFiles() {
    $('#files').innerHTML = picked
      ? '<li>' + esc(picked.name) + ' · ' + Math.round(picked.size / 1024).toLocaleString() + ' KB</li>' : '';
    $('#run').disabled = !picked;
  }

  function show(res) {
    var dateStr = ymd(res.baseline);
    var head = ['라인','상태','계획 기준수량','시작 기준수량','차이수량','누적 실적','미시작/전체']
      .map(function (h) { return '<th>' + h + '</th>'; }).join('');
    var body = res.stats.map(function (r) {
      var sign = r['차이수량'] > 0 ? '+' : '';
      var color = r['색상'] === 'red' ? 'color:#d64545;font-weight:700;'
                : (r['상태'] === '지연' ? 'font-weight:700;' : '');
      return '<tr style="' + color + '">'
        + '<td>' + esc(r['라인']) + '</td><td>' + esc(r['상태']) + '</td>'
        + '<td class="num">' + comma(r['계획기준수량']) + '</td>'
        + '<td class="num">' + comma(r['시작기준수량']) + '</td>'
        + '<td class="num">' + sign + comma(r['차이수량']) + '</td>'
        + '<td class="num">' + comma(r['실적수량']) + '</td>'
        + '<td>' + r['미시작건수'] + ' / ' + r['지시건수'] + '</td></tr>';
    }).join('');

    var behind = res.stats.filter(function (r) { return r['상태'] === '지연'; });
    var notStarted = res.stats.reduce(function (n, r) { return n + r['미시작건수']; }, 0);
    var html = renderHtml(res.baseline, res.stats);
    lastMail = { subject: '[MES] 라인별 진행현황 보고 — ' + dateStr + ' 07:00 기준', html: html, ymd: dateStr.replace(/-/g, '') };

    $('#out').innerHTML =
      '<h2>분석 결과 <span class="muted" style="font-size:14px;font-weight:400;">'
        + esc(dateStr) + ' 07:00 기준</span></h2>'
      + (behind.length
          ? '<div class="warn"><b>지연 ' + behind.length + '개 라인</b> — '
            + esc(behind.map(function (r) { return r['라인']; }).join(', '))
            + (notStarted ? ' · 아직 시작하지 않은 지시 ' + notStarted + '건' : '') + '</div>'
          : '<div class="ok">전 라인이 계획대로 진행 중입니다.'
            + (notStarted ? ' (미시작 지시 ' + notStarted + '건)' : '') + '</div>')
      + '<div class="tablewrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>'
      + '<h2>메일 미리보기</h2>'
      + '<p class="sub">아래 그대로 나갑니다. <b>발송은 사람이 확인한 뒤</b>에 합니다 — '
        + '내려받은 <code>.eml</code> 을 열어 받는 사람만 넣고 보내면 됩니다.</p>'
      + '<div class="prev">' + html.replace(/^[\s\S]*?<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '') + '</div>'
      + '<div class="btnrow">'
      + '<button class="btn green" id="dl-eml">메일(.eml) 내려받기</button>'
      + '<button class="btn" id="dl-html">본문(HTML) 내려받기</button></div>';

    $('#dl-eml').addEventListener('click', function () {
      download('mes_report_' + lastMail.ymd + '.eml', buildEml(lastMail.subject, lastMail.html), 'message/rfc822');
    });
    $('#dl-html').addEventListener('click', function () {
      download('mes_report_' + lastMail.ymd + '.html', lastMail.html, 'text/html;charset=utf-8');
    });
  }

  function run() {
    if (!picked) return;
    var btn = $('#run');
    btn.disabled = true; btn.textContent = '분석 중…';
    $('#out').innerHTML = '';
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var rows = parseCsv(String(fr.result));
        if (!rows.length) throw new Error('내용이 없습니다.');
        show(analyze(rows));
      } catch (e) {
        $('#out').innerHTML = '<div class="warn"><b>처리하지 못했습니다.</b><br>' + esc(e.message) + '</div>';
      } finally {
        btn.disabled = false; btn.textContent = '분석하고 메일 만들기';
      }
    };
    fr.onerror = function () {
      $('#out').innerHTML = '<div class="warn">파일을 읽지 못했습니다.</div>';
      btn.disabled = false; btn.textContent = '분석하고 메일 만들기';
    };
    fr.readAsText(picked, 'utf-8');
  }

  function wire() {
    var drop = $('#drop'), input = $('#file');
    input.addEventListener('change', function () { picked = input.files[0] || null; renderFiles(); });
    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      picked = (e.dataTransfer.files || [])[0] || null; renderFiles();
    });
    $('#run').addEventListener('click', run);
    $('#sample').addEventListener('click', function () {
      var btn = $('#sample');
      btn.disabled = true; btn.textContent = '예제 받는 중…';
      fetch('taskB_mes_mail/sample_data/mes_status.csv')
        .then(function (r) { if (!r.ok) throw new Error('예제 파일 ' + r.status); return r.blob(); })
        .then(function (b) {
          picked = new File([b], 'mes_status.csv', { type: 'text/csv' });
          renderFiles(); run();
        })
        .catch(function (e) {
          $('#out').innerHTML = '<div class="warn">예제를 불러오지 못했습니다 — ' + esc(e.message) + '</div>';
        })
        .then(function () { btn.disabled = false; btn.textContent = '예제 CSV 로 해보기'; });
    });
  }

  wire();
})();
