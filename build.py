# -*- coding: utf-8 -*-
"""
페이지 생성기 — 상단 메뉴를 **한 곳에서만** 정의한다.

페이지가 5장이라 메뉴를 손으로 복사하면 한 장을 빠뜨린다.
내용은 _parts/ 와 아래 BODY 를 고치고 `python3 build.py` 로 다시 굽는다.
생성된 .html 을 직접 고치면 다음에 구울 때 날아간다.
"""
import os, io, json

HERE = os.path.dirname(os.path.abspath(__file__))
HEAD = io.open(os.path.join(HERE, '_parts', 'head.html'), encoding='utf-8').read()

MENU = [
    ('home', '개요',            'index.html'),
    ('a',    'A. PDF 추출',     'task-a.html'),
    ('b',    'B. MES 아침메일', 'task-b.html'),
    ('c',    'C. SAP 가공메일', 'task-c.html'),
    ('d',    'D. 결품 응답',    'taskD_shortage_web/index.html'),
]

def nav(active):
    items = []
    for key, label, href in MENU:
        cls = ' class="active" aria-current="page"' if key == active else ''
        items.append('      <li><a href="%s"%s>%s</a></li>' % (href, cls, label))
    return ('<nav class="topnav" aria-label="주요 메뉴">\n'
            '  <div class="topnav-inner">\n'
            '    <a class="topnav-brand" href="index.html">반복 업무 자동화'
            ' <small>4종 · 기획 권도연</small></a>\n'
            '    <ul class="topnav-links">\n' + '\n'.join(items) + '\n'
            '    </ul>\n'
            '  </div>\n'
            '</nav>')

FOOT = ('<footer><div class="wrap">'
        '반복 업무 자동화 4종 · 생성형 AI 업무자동화 전문가과정 1차수 — 기획: 권도연'
        '</div></footer>')

def hero(eyebrow, title, lede):
    return ('<header class="hero"><div class="wrap">'
            '<div class="eyebrow">%s</div><h1>%s</h1><p>%s</p>'
            '</div></header>' % (eyebrow, title, lede))

def page(path, title, desc, active, hero_html, body, scripts=''):
    html = '%s<title>%s</title>\n<meta name="description" content="%s">\n</head>\n<body>\n\n%s\n\n%s\n\n<main><div class="wrap">\n%s\n</div></main>\n\n%s\n%s\n</body>\n</html>\n' % (
        HEAD, title, desc, nav(active), hero_html, body, FOOT, scripts)
    io.open(os.path.join(HERE, path), 'w', encoding='utf-8').write(html)
    print('  %-16s %6d자' % (path, len(html)))

# ── 개요 ──────────────────────────────────────────────────────────────
HOME = '''
<h2>네 가지 과제</h2>
<p class="sub">SAP·MES 자료를 내려받아 엑셀로 가공하고 메일로 보내던 일을 자동화합니다.
  A·B·C 는 <b>파일을 올리면 브라우저에서 바로 처리</b>하고, D 는 협력업체가 직접 접속해 응답하는 웹입니다.</p>

<div class="cards">
  <div class="card">
    <h3>A. 업체별 PDF → 엑셀</h3>
    <p class="sub">업체마다 양식이 다른 PDF 에서 <b>품번·무게·수량·금액·인코텀즈</b> 를 뽑아
      한 장의 엑셀로 모읍니다. 공통 4개 항목은 같은 정규식으로, <b>인코텀즈만 업체별 패턴</b>으로
      나눠 찾습니다. 못 뽑은 항목은 빈칸으로 두고 <b>검토필요</b> 로 표시합니다 —
      추측해서 채우지 않습니다.</p>
    <div class="io">
      <span class="tag">PDF 여러 장</span><span class="arrow">→</span>
      <span><b>추출결과.xlsx</b></span>
    </div>
    <div class="btnrow"><a class="btn primary" href="task-a.html">열기</a></div>
  </div>

  <div class="card">
    <h3>B. MES 진행현황 아침 메일</h3>
    <p class="sub">라인별로 <b>07:00 기준</b> 투입 계획 대비 시작 수량을 비교해
      앞당김·지연을 판정하고 메일 본문을 만듭니다. 아직 시작하지 않은 지시는
      <b>미시작</b> 으로 따로 셉니다 — 0으로 치면 지연이 눈에 안 띕니다.</p>
    <div class="io">
      <span class="tag">MES 현황 CSV</span><span class="arrow">→</span>
      <span><b>메일(.eml)</b> · 미리보기</span>
    </div>
    <div class="btnrow"><a class="btn primary" href="task-b.html">열기</a></div>
  </div>

  <div class="card">
    <h3>C. SAP 엑셀 가공 → 메일</h3>
    <p class="sub">가공한 엑셀의 표를 <b>서식 그대로</b> 메일 본문에 넣고,
      원본 파일을 첨부한 메일을 만듭니다. 캡처해 붙이면 그림이 되어 글자를 복사할 수 없고
      휴대폰에서 뭉개집니다 — 그래서 <b>표를 HTML 로 옮깁니다.</b></p>
    <div class="io">
      <span class="tag">가공 엑셀(.xlsx)</span><span class="arrow">→</span>
      <span><b>메일(.eml)</b> · 원본 첨부</span>
    </div>
    <div class="btnrow"><a class="btn primary" href="task-c.html">열기</a></div>
  </div>

  <div class="card">
    <h3>D. 협력업체 결품 응답</h3>
    <p class="sub">매일 엑셀로 보내던 D+4 결품 현황을,
      <b>업체가 직접 접속해 특이사항 유/무를 응답</b>하는 웹으로 바꿉니다.
      담당자가 엑셀을 올리면 업체별로 나뉘고, 응답은 담당자 화면에 바로 나타납니다.
      <b>업체는 자기 것만 봅니다.</b></p>
    <div class="io">
      <span class="tag">결품 엑셀 업로드</span><span class="arrow">→</span>
      <span><b>업체 응답</b> · 현황 집계</span>
    </div>
    <div class="btnrow"><a class="btn primary" href="taskD_shortage_web/index.html">열기</a></div>
  </div>
</div>

<h2>파이썬으로도 돌릴 수 있습니다</h2>
<p class="sub">A·B·C 는 저장소에 파이썬 스크립트가 함께 들어 있습니다.
  사내에서 일괄 처리하거나 스케줄러에 걸 때는 그쪽을 씁니다.
  <b>판정 규칙은 같습니다</b> — 웹은 같은 규칙을 브라우저에서 돌린 것입니다.</p>
<div class="note">
  브라우저에서 처리하므로 <b>파일이 서버로 올라가지 않습니다.</b>
  사내 자료를 다룰 때 이 점이 중요합니다 — 이 페이지는 네트워크로 아무것도 보내지 않습니다.
</div>
'''

# ── A ────────────────────────────────────────────────────────────────
A_BODY = '''
<div class="card">
  <h3>1. PDF 를 올리세요</h3>
  <p class="sub">여러 장을 한 번에 올릴 수 있습니다. 업체는 파일 안의 키워드로 자동 판별합니다.</p>
  <label class="drop" id="drop">
    <input type="file" id="file" accept="application/pdf" multiple>
    <b>PDF 를 끌어다 놓거나 눌러서 고르세요</b>
    <span>업체별 양식이 달라도 됩니다 · 여러 개 동시 선택 가능</span>
  </label>
  <ul class="filelist" id="files"></ul>
  <div class="btnrow">
    <button class="btn primary" id="run" disabled>추출하기</button>
    <button class="btn" id="sample">예제 PDF 로 해보기</button>
  </div>
</div>

<div id="out"></div>

<h2>어떻게 뽑나</h2>
<ol class="steps">
  <li>PDF 에서 <b>텍스트를 통째로</b> 꺼냅니다.</li>
  <li><code>vendors.json</code> 의 키워드로 <b>어느 업체 양식인지</b> 판별합니다.</li>
  <li>공통 4개 항목(품번·무게·수량·금액)은 공통 정규식으로,
      <b>인코텀즈만 업체별 패턴</b>으로 나눠 찾습니다.</li>
  <li>공통 정규식이 실패하면 <b>값 형식만으로</b> 한 번 더 시도합니다(fallback).</li>
  <li>그래도 못 찾은 항목은 빈칸으로 두고 <b>검토필요</b> 로 표시합니다 —
      <b>추측해서 채우지 않습니다.</b> 틀린 값이 조용히 들어가는 것이 빈칸보다 나쁩니다.</li>
</ol>
<div class="note">
  새 업체가 늘면 <code>taskA_pdf_extract/vendors.json</code> 에 키워드와 인코텀즈 패턴만 추가하면 됩니다.
  코드는 고치지 않습니다.
</div>
'''

# ── B ────────────────────────────────────────────────────────────────
B_BODY = '''
<div class="card">
  <h3>1. MES 현황 CSV 를 올리세요</h3>
  <p class="sub">필요한 열: <code>라인, 작업지시번호, 품번, 투입계획일시, 시작일시, 계획수량, 실적수량</code></p>
  <label class="drop" id="drop">
    <input type="file" id="file" accept=".csv,text/csv">
    <b>CSV 를 끌어다 놓거나 눌러서 고르세요</b>
    <span>MES 에서 내려받은 그대로</span>
  </label>
  <ul class="filelist" id="files"></ul>
  <div class="btnrow">
    <button class="btn primary" id="run" disabled>분석하고 메일 만들기</button>
    <button class="btn" id="sample">예제 CSV 로 해보기</button>
  </div>
</div>

<div id="out"></div>

<h2>판정 기준</h2>
<ol class="steps">
  <li>기준 시각은 <b>그날 07:00</b> 입니다.</li>
  <li><b>계획기준수량</b> = 투입계획일시가 07:00 이전인 지시의 계획수량 합</li>
  <li><b>시작기준수량</b> = 시작일시가 07:00 이전인 지시의 계획수량 합</li>
  <li>차이 = 시작기준 − 계획기준 →
      <b>양수면 앞당김</b>(빨강), <b>음수면 지연</b>, 0이면 정상</li>
</ol>
<div class="note">
  아직 시작하지 않은 지시는 <b>미시작</b> 으로 따로 셉니다.
  시작일시가 비어 있는 것을 0으로 치면 지연이 눈에 안 띕니다.
</div>
'''

# ── C ────────────────────────────────────────────────────────────────
C_BODY = '''
<div class="card">
  <h3>1. 가공한 엑셀을 올리세요</h3>
  <p class="sub">첫 시트의 표를 <b>서식(배경색·굵기)까지 살려</b> 메일 본문에 넣습니다.</p>
  <label class="drop" id="drop">
    <input type="file" id="file" accept=".xlsx,.xls">
    <b>엑셀을 끌어다 놓거나 눌러서 고르세요</b>
    <span>.xlsx · 첫 시트를 씁니다</span>
  </label>
  <ul class="filelist" id="files"></ul>
  <div class="btnrow">
    <button class="btn primary" id="run" disabled>메일 만들기</button>
    <button class="btn" id="sample">예제 엑셀로 해보기</button>
  </div>
</div>

<div id="out"></div>

<h2>왜 캡처가 아니라 표인가</h2>
<p class="sub">엑셀 화면을 캡처해 붙이면 그림이 됩니다. 받는 사람이 글자를 복사할 수 없고,
  휴대폰에서는 글씨가 뭉개집니다. 여기서는 <b>표를 HTML 로 옮겨</b> 넣으므로
  글자를 그대로 고를 수 있고 화면 폭에 맞춰 접힙니다. 원본 파일은 <b>첨부로 함께</b> 나갑니다.</p>
<div class="note">
  만들어진 <code>.eml</code> 은 Outlook·Apple Mail 에서 그냥 열립니다.
  열어서 받는 사람만 넣고 보내면 됩니다 — <b>발송은 사람이 확인한 뒤</b>에 합니다.
</div>
'''

def main():
    page('index.html',
         '반복 업무 자동화 4종 — SAP·MES 자료 가공과 메일 자동화',
         '업체별 PDF 추출, MES 아침 메일, SAP 엑셀 가공 메일, 협력업체 결품 응답 웹 — 파일을 올리면 브라우저에서 바로 처리합니다.',
         'home',
         hero('생성형 AI 업무자동화 전문가과정 · 1차수',
              '반복 업무 자동화 4종',
              '"SAP/MES 자료 다운 → 엑셀 가공 → Outlook 메일 송부"로 반복되던 일을 자동화합니다. '
              '파일을 올리면 브라우저에서 바로 처리하고, 결과를 엑셀·메일로 내려받습니다.'),
         HOME)

    page('task-a.html',
         'A. 업체별 PDF 데이터 추출 — 반복 업무 자동화 4종',
         '양식이 다른 업체별 PDF 에서 품번·무게·수량·금액·인코텀즈를 뽑아 엑셀 한 장으로 모읍니다.',
         'a',
         hero('과제 A', '업체별 PDF 데이터 추출 → 엑셀',
              '업체마다 양식이 다른 PDF 를 올리면 필요한 항목만 뽑아 한 장의 엑셀로 모읍니다. '
              '못 뽑은 항목은 빈칸으로 두고 검토필요로 표시합니다.'),
         A_BODY,
         '<script src="lib/xlsx.full.min.js"></script>\n'
         '<script src="js/vendor-rules.js"></script>\n'
         '<script type="module" src="js/task-a.js"></script>')

    page('task-b.html',
         'B. MES 진행현황 아침 메일 — 반복 업무 자동화 4종',
         'MES 현황 CSV 를 올리면 라인별 앞당김·지연을 판정해 아침 보고 메일 본문을 만듭니다.',
         'b',
         hero('과제 B', 'MES 라인별 진행현황 아침 메일',
              '07:00 기준으로 투입 계획 대비 시작 수량을 비교해 라인별 앞당김·지연을 판정하고, '
              '그대로 보낼 수 있는 메일 본문을 만듭니다.'),
         B_BODY,
         '<script src="js/task-b.js"></script>')

    page('task-c.html',
         'C. SAP 엑셀 가공 → 메일 — 반복 업무 자동화 4종',
         '가공한 엑셀을 올리면 표를 서식 그대로 메일 본문에 넣고 원본을 첨부한 메일을 만듭니다.',
         'c',
         hero('과제 C', 'SAP 엑셀 가공 → 표 그대로 메일',
              '가공한 엑셀을 올리면 첫 시트의 표를 서식까지 살려 메일 본문에 넣고, '
              '원본 파일을 첨부한 메일(.eml)을 만듭니다.'),
         C_BODY,
         '<script src="lib/xlsx.full.min.js"></script>\n'
         '<script src="js/task-c.js"></script>')

    print('\n메뉴는 build.py 의 MENU 한 곳에서만 정의됩니다.')

main()
