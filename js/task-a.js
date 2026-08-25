/**
 * 과제 A — 업체별 PDF 에서 항목 추출 → 엑셀
 *
 * 판정 규칙의 정본은 `taskA_pdf_extract/vendors.json` 이다.
 * 이 파일은 그 규칙을 **브라우저에서 그대로** 돌린다 —
 * 파이썬(extract.py)과 같은 정규식, 같은 순서, 같은 실패 처리를 쓴다.
 * (규칙이 두 곳으로 갈리면 "파이썬은 되는데 웹은 안 된다" 가 된다)
 *
 * 파일은 **서버로 보내지 않는다.** PDF 해석도 엑셀 생성도 전부 이 브라우저 안에서 끝난다.
 * 사내 자료를 다루는 화면이라 이 점이 중요하다.
 */
import * as pdfjs from '../lib/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = '../lib/pdf.worker.min.mjs';

const CFG = window.VENDOR_RULES;
const COLUMNS = ['파일명', '업체명', '품번', '무게', '수량', '금액', '인코텀즈', '검토필요'];

const $ = (s) => document.querySelector(s);
let picked = [];

/* ─────────────────────────────── 추출 ─────────────────────────────── */

/** PDF 전체 페이지의 텍스트를 하나로 합친다 (pdfplumber 의 extract_text 자리) */
async function readPdfText(file) {
  const buf = await file.arrayBuffer();
  // ⚠ cMapUrl 을 주지 않으면 **한글 라벨이 빈 문자열로 나온다.**
  //   샘플 PDF 의 라벨은 내장되지 않은 CID 폰트(HYSMyeongJo-Medium)로 그려져 있어서,
  //   pdf.js 가 글자를 되찾으려면 Adobe 표준 CMap 이 필요하다.
  //   (pdfplumber 는 이 CMap 을 안에 들고 있어 파이썬 쪽에서는 그냥 됐다 —
  //    그래서 "파이썬은 되는데 웹은 인코텀즈를 못 찾는" 상태였다)
  const doc = await pdfjs.getDocument({
    data: buf,
    cMapUrl: new URL('../lib/cmaps/', import.meta.url).href,
    cMapPacked: true
  }).promise;
  const chunks = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // 조각을 그냥 이어 붙이면 단어가 붙어 정규식이 어긋난다.
    // pdf.js 가 주는 `hasEOL` 로 줄을 끊고, 조각 사이는 공백으로 벌린다.
    let line = [];
    for (const it of tc.items) {
      if (typeof it.str === 'string' && it.str !== '') line.push(it.str);
      if (it.hasEOL) { chunks.push(line.join(' ')); line = []; }
    }
    if (line.length) chunks.push(line.join(' '));
  }
  await doc.destroy();
  return chunks.join('\n');
}

function detectVendor(text, filename) {
  for (const [name, rule] of Object.entries(CFG.vendors)) {
    for (const kw of rule['키워드']) {
      if (text.includes(kw) || filename.includes(kw)) return name;
    }
  }
  return null;
}

/** 공통 패턴 → 실패하면 값 형식 단독 패턴 (파이썬과 같은 순서) */
function extractField(text, primary, fallback) {
  let m = new RegExp(primary).exec(text);
  if (m) return m[1];
  if (fallback) {
    m = new RegExp(fallback).exec(text);
    if (m) return m[1];
  }
  return '';
}

function extractOne(filename, text) {
  const vendor = detectVendor(text, filename);
  const row = { '파일명': filename, '업체명': vendor || '', '검토필요': '' };
  const missing = [];

  for (const [field, rule] of Object.entries(CFG.common_fields)) {
    const fb = (CFG.fallback_fields || {})[field];
    const v = extractField(text, rule['패턴'], fb);
    row[field] = v;
    if (!v) missing.push(field);
  }

  let inco = '';
  if (vendor) inco = extractField(text, CFG.vendors[vendor]['인코텀즈_패턴']);
  row['인코텀즈'] = inco;
  if (!inco) missing.push('인코텀즈');
  if (!vendor) missing.unshift('업체판별');

  // ⚠ 못 찾은 항목은 **추측해서 채우지 않는다.**
  //    틀린 값이 조용히 들어가는 것이 빈칸보다 나쁘다 — 사람이 볼 기회를 없앤다.
  row['검토필요'] = missing.length ? ('Y (' + missing.join(', ') + ')') : 'N';
  return row;
}

/* ─────────────────────────────── 화면 ─────────────────────────────── */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderFiles() {
  $('#files').innerHTML = picked.map(f =>
    '<li>' + esc(f.name) + ' · ' + Math.round(f.size / 1024).toLocaleString() + ' KB</li>').join('');
  $('#run').disabled = picked.length === 0;
}

function renderResult(rows) {
  const need = rows.filter(r => r['검토필요'] !== 'N').length;
  const head = COLUMNS.map(c => '<th>' + esc(c) + '</th>').join('');
  const body = rows.map(r => '<tr>' + COLUMNS.map(c => {
    const v = r[c] == null ? '' : r[c];
    const num = ['무게', '수량', '금액'].indexOf(c) !== -1;
    const flag = c === '검토필요' && v !== 'N';
    return '<td class="' + (num ? 'num' : '') + (flag ? ' flag' : '') + '">' + esc(v) + '</td>';
  }).join('') + '</tr>').join('');

  $('#out').innerHTML =
    '<h2>추출 결과</h2>' +
    (need
      ? '<div class="warn"><b>' + need + '건은 사람이 확인해야 합니다.</b> ' +
        '못 찾은 항목은 빈칸으로 두고 「검토필요」에 무엇이 빠졌는지 적어 두었습니다. ' +
        '추측해서 채우지 않습니다.</div>'
      : '<div class="ok">모든 항목을 찾았습니다. 검토가 필요한 건이 없습니다.</div>') +
    '<div class="tablewrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + body +
    '</tbody></table></div>' +
    '<div class="btnrow"><button class="btn green" id="dl">엑셀로 내려받기</button></div>';

  $('#dl').addEventListener('click', () => downloadExcel(rows));
}

function downloadExcel(rows) {
  const aoa = [COLUMNS].concat(rows.map(r => COLUMNS.map(c => {
    const v = r[c];
    // 수량·금액·무게는 **숫자로** 넣는다. 문자열로 넣으면 엑셀에서 합계가 안 잡힌다.
    if (['무게', '수량', '금액'].indexOf(c) !== -1 && v) {
      const n = Number(String(v).replace(/,/g, ''));
      if (isFinite(n)) return n;
    }
    return v == null ? '' : v;
  })));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 34 }, { wch: 12 }, { wch: 16 }, { wch: 12 },
                 { wch: 9 }, { wch: 13 }, { wch: 12 }, { wch: 26 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '추출결과');
  XLSX.writeFile(wb, '추출결과.xlsx');
}

/* ─────────────────────────────── 동작 ─────────────────────────────── */

async function run() {
  const btn = $('#run');
  btn.disabled = true; btn.textContent = '읽는 중…';
  $('#out').innerHTML = '';
  const rows = [];
  try {
    for (const f of picked) {
      btn.textContent = '읽는 중… ' + f.name;
      let text = '';
      try { text = await readPdfText(f); }
      catch (e) {
        rows.push({ '파일명': f.name, '업체명': '', '검토필요': 'Y (PDF 읽기 실패: ' + e.message + ')' });
        continue;
      }
      rows.push(extractOne(f.name, text));
    }
    renderResult(rows);
  } finally {
    btn.disabled = false; btn.textContent = '추출하기';
  }
}

function wire() {
  const drop = $('#drop'), input = $('#file');
  input.addEventListener('change', () => {
    picked = [...input.files].filter(f => /\.pdf$/i.test(f.name));
    renderFiles();
  });
  ['dragenter', 'dragover'].forEach(t =>
    drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t =>
    drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => {
    picked = [...(e.dataTransfer.files || [])].filter(f => /\.pdf$/i.test(f.name));
    renderFiles();
  });
  $('#run').addEventListener('click', run);

  $('#sample').addEventListener('click', async () => {
    const names = ['대한정밀_invoice_20260821.pdf', '세종산업_shipping_20260821.pdf',
                   '한빛금속_delivery_20260821.pdf'];
    const btn = $('#sample');
    btn.disabled = true; btn.textContent = '예제 받는 중…';
    try {
      picked = [];
      for (const n of names) {
        const r = await fetch('taskA_pdf_extract/sample_pdfs/' + encodeURIComponent(n));
        if (!r.ok) throw new Error(n + ' (' + r.status + ')');
        picked.push(new File([await r.blob()], n, { type: 'application/pdf' }));
      }
      renderFiles();
      await run();
    } catch (e) {
      $('#out').innerHTML = '<div class="warn">예제를 불러오지 못했습니다 — ' + esc(e.message) + '</div>';
    } finally {
      btn.disabled = false; btn.textContent = '예제 PDF 로 해보기';
    }
  });
}

wire();
