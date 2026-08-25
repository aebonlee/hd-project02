/**
 * 과제 C — 가공한 SAP 엑셀 → 표 그대로 메일
 *
 * 엑셀 화면을 캡처해 붙이면 **그림**이 된다.
 * 받는 사람이 글자를 복사할 수 없고 휴대폰에서 뭉개진다.
 * 여기서는 표를 HTML 로 옮겨 넣으므로 글자를 그대로 고를 수 있고,
 * 원본 파일은 **첨부로 함께** 나간다.
 *
 * 파일은 서버로 보내지 않는다 — 읽기도 메일 생성도 이 브라우저 안에서 끝난다.
 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var picked = null;
  var last = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ─────────────────────── 엑셀 → 표 HTML ─────────────────────── */

  var TH = "border:1px solid #b9c6d6;padding:6px 10px;background:#1f4e79;color:#ffffff;font-size:13px;font-weight:bold;";
  var TD = "border:1px solid #b9c6d6;padding:6px 10px;font-size:13px;";

  /**
   * 첫 시트를 표로 옮긴다.
   * 첫 행은 머리글로 본다 — SAP 에서 내려받은 자료는 늘 첫 줄이 열 이름이다.
   * 숫자는 **오른쪽 정렬 + 천단위 쉼표**로 낸다. 왼쪽으로 붙으면 자릿수를 눈으로 못 센다.
   */
  function sheetToHtml(ws) {
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    // 아래쪽 빈 줄은 버린다 — 엑셀은 서식만 있어도 행을 만든다
    while (aoa.length && aoa[aoa.length - 1].every(function (c) { return c === '' || c == null; })) aoa.pop();
    if (!aoa.length) throw new Error('첫 시트가 비어 있습니다.');

    var cols = aoa.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var out = ['<table style="border-collapse:collapse;">'];
    aoa.forEach(function (row, ri) {
      out.push('<tr>');
      for (var ci = 0; ci < cols; ci++) {
        var v = row[ci];
        var isNum = typeof v === 'number' && isFinite(v);
        var text = isNum ? v.toLocaleString('ko-KR') : (v == null ? '' : String(v));
        if (ri === 0) out.push('<th style="' + TH + '">' + esc(text) + '</th>');
        else out.push('<td style="' + TD + (isNum ? 'text-align:right;' : '') + '">' + esc(text) + '</td>');
      }
      out.push('</tr>');
    });
    out.push('</table>');
    return { html: out.join(''), rows: aoa.length - 1, cols: cols };
  }

  function ymdToday(d) {
    d = d || new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }
  function dateLabel(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
         + '-' + String(d.getDate()).padStart(2, '0');
  }

  function buildMailHtml(tableHtml, dateStr) {
    return '<html>\n<body style="font-family:\'Malgun Gothic\',\'맑은 고딕\',sans-serif;color:#22303f;">\n'
      + '  <h2 style="font-size:16px;">[SAP] 자재수급현황 — ' + dateStr + '</h2>\n'
      + '  <p style="font-size:13px;">안녕하세요. ' + dateStr + ' 기준 자재수급현황을 공유드립니다.<br>\n'
      + '  아래 표는 첨부한 엑셀과 같은 내용이며, 원본은 첨부 파일을 확인해 주세요.</p>\n'
      + '  ' + tableHtml + '\n'
      + '  <p style="font-size:12px;color:#6b7a8c;">* 본 메일은 자동 생성되었습니다.</p>\n'
      + '</body>\n</html>';
  }

  /* ─────────────────────── .eml (첨부 포함) ─────────────────────── */

  function b64FromString(s) {
    return btoa(String.fromCharCode.apply(null, new TextEncoder().encode(s)));
  }
  function b64FromBytes(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(s);
  }
  /** base64 는 줄을 76자로 끊어야 메일 클라이언트가 제대로 읽는다 */
  function wrap76(s) { return (s.match(/.{1,76}/g) || []).join('\r\n'); }

  function buildEmlWithAttachment(subject, html, fileName, fileBytes) {
    var bd = '=_hd_' + Math.random().toString(36).slice(2) + '_=';
    return [
      'Subject: =?UTF-8?B?' + b64FromString(subject) + '?=',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="' + bd + '"',
      '',
      '--' + bd,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(b64FromString(html)),
      '',
      '--' + bd,
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;'
        + ' name="=?UTF-8?B?' + b64FromString(fileName) + '?="',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="=?UTF-8?B?' + b64FromString(fileName) + '?="',
      '',
      wrap76(b64FromBytes(fileBytes)),
      '',
      '--' + bd + '--',
      ''
    ].join('\r\n');
  }

  function download(name, content, mime) {
    var blob = new Blob([content], { type: mime || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* ─────────────────────────── 화면 ─────────────────────────── */

  function renderFiles() {
    $('#files').innerHTML = picked
      ? '<li>' + esc(picked.name) + ' · ' + Math.round(picked.size / 1024).toLocaleString() + ' KB</li>' : '';
    $('#run').disabled = !picked;
  }

  function show(info, bytes) {
    var dateStr = dateLabel();
    var html = buildMailHtml(info.html, dateStr);
    last = { subject: '[SAP] 자재수급현황 — ' + dateStr, html: html,
             ymd: ymdToday(), fileName: picked.name, bytes: bytes };

    $('#out').innerHTML =
      '<div class="ok">첫 시트에서 <b>' + info.rows + '행 × ' + info.cols + '열</b>을 표로 옮겼습니다. '
      + '원본 파일은 메일에 <b>첨부</b>로 함께 들어갑니다.</div>'
      + '<h2>메일 미리보기</h2>'
      + '<p class="sub">아래 그대로 나갑니다. <b>발송은 사람이 확인한 뒤</b>에 합니다 — '
      + '내려받은 <code>.eml</code> 을 열어 받는 사람만 넣고 보내면 됩니다.</p>'
      + '<div class="prev">' + html.replace(/^[\s\S]*?<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '') + '</div>'
      + '<div class="btnrow">'
      + '<button class="btn green" id="dl-eml">메일(.eml · 첨부 포함) 내려받기</button>'
      + '<button class="btn" id="dl-html">본문(HTML) 내려받기</button></div>';

    $('#dl-eml').addEventListener('click', function () {
      download('sap_mail_' + last.ymd + '.eml',
        buildEmlWithAttachment(last.subject, last.html, last.fileName, last.bytes), 'message/rfc822');
    });
    $('#dl-html').addEventListener('click', function () {
      download('sap_mail_preview_' + last.ymd + '.html', last.html, 'text/html;charset=utf-8');
    });
  }

  function run() {
    if (!picked) return;
    var btn = $('#run');
    btn.disabled = true; btn.textContent = '읽는 중…';
    $('#out').innerHTML = '';
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var bytes = new Uint8Array(fr.result);
        var wb = XLSX.read(bytes, { type: 'array' });
        if (!wb.SheetNames.length) throw new Error('시트가 없습니다.');
        show(sheetToHtml(wb.Sheets[wb.SheetNames[0]]), bytes);
      } catch (e) {
        $('#out').innerHTML = '<div class="warn"><b>처리하지 못했습니다.</b><br>' + esc(e.message) + '</div>';
      } finally {
        btn.disabled = false; btn.textContent = '메일 만들기';
      }
    };
    fr.onerror = function () {
      $('#out').innerHTML = '<div class="warn">파일을 읽지 못했습니다.</div>';
      btn.disabled = false; btn.textContent = '메일 만들기';
    };
    fr.readAsArrayBuffer(picked);
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
      var name = '자재수급현황_가공완료.xlsx';
      fetch('taskC_sap_excel_mail/sample_data/' + encodeURIComponent(name))
        .then(function (r) { if (!r.ok) throw new Error('예제 파일 ' + r.status); return r.blob(); })
        .then(function (b) {
          picked = new File([b], name, { type: b.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          renderFiles(); run();
        })
        .catch(function (e) {
          $('#out').innerHTML = '<div class="warn">예제를 불러오지 못했습니다 — ' + esc(e.message) + '</div>';
        })
        .then(function () { btn.disabled = false; btn.textContent = '예제 엑셀로 해보기'; });
    });
  }

  wire();
})();
