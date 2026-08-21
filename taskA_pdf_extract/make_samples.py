# -*- coding: utf-8 -*-
"""
업체별 레이아웃이 다른 샘플 PDF 3종 생성 스크립트 (reportlab)

실행:
    python3 taskA_pdf_extract/make_samples.py

- 공통 4개 항목(품번, 무게, 수량, 금액)은 모든 업체가 같은 값 형식을 사용한다.
- 인코텀즈 번호는 업체마다 표기 형식이 다르다. (기획서 과제 A 요구사항)
  * 대한정밀: Incoterms: FOB-2020-1184        (라벨:값 나열형 문서)
  * 한빛금속: INCOTERMS NO. CIF/2024/0087    (표 형식 문서)
  * 세종산업: 운송조건 EXW (No. EXW-88-0771)  (문장 서술형 문서)
- 한글 텍스트는 reportlab 내장 CID 폰트(HYSMyeongJo-Medium)를 사용한다.
"""
import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE_DIR, "sample_pdfs")

KOREAN_FONT = "HYSMyeongJo-Medium"
pdfmetrics.registerFont(UnicodeCIDFont(KOREAN_FONT))

W, H = A4


def pdf_daehan():
    """대한정밀 — 라벨:값 나열형 인보이스"""
    path = os.path.join(OUT_DIR, "대한정밀_invoice_20260821.pdf")
    c = canvas.Canvas(path, pagesize=A4)

    c.setFont("Helvetica-Bold", 18)
    c.drawString(25 * mm, H - 30 * mm, "DAEHAN PRECISION CO., LTD.")
    c.setFont(KOREAN_FONT, 11)
    c.drawString(25 * mm, H - 37 * mm, "대한정밀 주식회사 / 상업송장 (COMMERCIAL INVOICE)")
    c.line(25 * mm, H - 40 * mm, W - 25 * mm, H - 40 * mm)

    lines = [
        ("Invoice No.", "DH-2026-0821-05"),
        ("Date", "2026-08-21"),
        ("품번", "HD-48213-AB"),
        ("품명", "Bracket Assembly"),
        ("무게", "1,250.50 kg"),
        ("수량", "320 EA"),
        ("금액", "USD 15,300.00"),
        ("Incoterms", "FOB-2020-1184"),
        ("Port of Loading", "Busan, Korea"),
    ]
    y = H - 55 * mm
    for label, value in lines:
        c.setFont(KOREAN_FONT, 11)
        c.drawString(30 * mm, y, f"{label} : ")
        c.setFont("Helvetica", 11)
        c.drawString(75 * mm, y, value)
        y -= 9 * mm

    c.setFont(KOREAN_FONT, 9)
    c.drawString(25 * mm, 30 * mm, "본 서류는 자동화 실습용 샘플이며 실제 거래 문서가 아닙니다.")
    c.save()
    print(f"[생성] {path}")


def pdf_hanbit():
    """한빛금속 — 표 형식 납품서 (항목이 표의 열로 배치됨)"""
    path = os.path.join(OUT_DIR, "한빛금속_delivery_20260821.pdf")
    c = canvas.Canvas(path, pagesize=A4)

    c.setFont(KOREAN_FONT, 16)
    c.drawCentredString(W / 2, H - 30 * mm, "납 품 명 세 서")
    c.setFont("Helvetica", 10)
    c.drawCentredString(W / 2, H - 37 * mm, "HANBIT METAL IND. — DELIVERY NOTE HB-0821-77")

    data = [
        ["품번", "품명", "무게", "수량", "금액"],
        ["HD-77105-CD", "Support Beam", "890.00 kg", "150 EA", "USD 8,750.00"],
    ]
    table = Table(data, colWidths=[35 * mm, 40 * mm, 30 * mm, 25 * mm, 35 * mm])
    table.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), KOREAN_FONT, 10),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 10),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dce6f1")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    tw, th = table.wrapOn(c, W, H)
    table.drawOn(c, (W - tw) / 2, H - 65 * mm)

    c.setFont("Helvetica-Bold", 11)
    c.drawString(25 * mm, H - 85 * mm, "INCOTERMS NO. CIF/2024/0087")
    c.setFont(KOREAN_FONT, 10)
    c.drawString(25 * mm, H - 93 * mm, "인도조건은 상기 인코텀즈 번호를 따릅니다.")

    c.setFont(KOREAN_FONT, 9)
    c.drawString(25 * mm, 30 * mm, "본 서류는 자동화 실습용 샘플이며 실제 거래 문서가 아닙니다.")
    c.save()
    print(f"[생성] {path}")


def pdf_sejong():
    """세종산업 — 문장 서술형 출하 안내문"""
    path = os.path.join(OUT_DIR, "세종산업_shipping_20260821.pdf")
    c = canvas.Canvas(path, pagesize=A4)

    c.setFont(KOREAN_FONT, 15)
    c.drawString(25 * mm, H - 30 * mm, "출하 안내문 (SEJONG INDUSTRIES)")
    c.line(25 * mm, H - 34 * mm, W - 25 * mm, H - 34 * mm)

    paragraphs = [
        "수신: 자재관리팀   발신: 세종산업 영업부   문서번호: SJ-20260821-12",
        "",
        "금일 출하 내역을 아래와 같이 안내드립니다.",
        "",
        "대상 부품의 품번 : HD-91422-EF (Hydraulic Cylinder Rod) 이며,",
        "총 무게 : 2,340.75 kg, 출하 수량 : 480 EA 입니다.",
        "청구 금액 : USD 22,140.00 (부가세 별도) 로 산정되었습니다.",
        "",
        "운송조건은 EXW (No. EXW-88-0771) 조건이며, 인수 장소는",
        "세종산업 제2공장 출하장입니다. 상세 일정은 별도 협의 바랍니다.",
    ]
    y = H - 48 * mm
    for line in paragraphs:
        c.setFont(KOREAN_FONT, 11)
        c.drawString(28 * mm, y, line)
        y -= 8 * mm

    c.setFont(KOREAN_FONT, 9)
    c.drawString(25 * mm, 30 * mm, "본 서류는 자동화 실습용 샘플이며 실제 거래 문서가 아닙니다.")
    c.save()
    print(f"[생성] {path}")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    pdf_daehan()
    pdf_hanbit()
    pdf_sejong()
    print("샘플 PDF 3종 생성 완료")
