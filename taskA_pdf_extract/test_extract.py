# -*- coding: utf-8 -*-
"""과제 A 순수 로직 테스트 (업체 판별 · 공통/인코텀즈 정규식 · 오류 처리)

실행:
    python3 taskA_pdf_extract/test_extract.py

pdfplumber/openpyxl 없이도 순수 로직 테스트는 동작한다.
(손상 PDF 배치 계속 처리 테스트만 pdfplumber 가 있을 때 실행)
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract  # noqa: E402

try:
    import pdfplumber  # noqa: F401
    HAS_PDFPLUMBER = True
except Exception:
    HAS_PDFPLUMBER = False


class TestVendorDetect(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = extract.load_config()

    def test_detect_vendor_by_text(self):
        self.assertEqual(
            extract.detect_vendor("발신: 대한정밀 주식회사", "a.pdf", self.config["vendors"]),
            "대한정밀")
        self.assertEqual(
            extract.detect_vendor("HANBIT METAL CO., LTD", "b.pdf", self.config["vendors"]),
            "한빛금속")

    def test_detect_vendor_by_filename(self):
        self.assertEqual(
            extract.detect_vendor("본문에 키워드 없음", "세종산업_shipping.pdf", self.config["vendors"]),
            "세종산업")

    def test_detect_vendor_unknown(self):
        self.assertIsNone(
            extract.detect_vendor("알 수 없는 문서", "x.pdf", self.config["vendors"]))


class TestCommonFields(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = extract.load_config()

    def _extract(self, field, text):
        rule = self.config["common_fields"][field]
        fallback = self.config.get("fallback_fields", {}).get(field)
        return extract.extract_field(text, rule["패턴"], fallback)

    def test_common_patterns(self):
        text = "품번 : HD-48213-AB\n무게 : 1,250.50 kg\n수량 : 320 EA\n금액 : USD 15,300.00"
        self.assertEqual(self._extract("품번", text), "HD-48213-AB")
        self.assertEqual(self._extract("무게", text), "1,250.50")
        self.assertEqual(self._extract("수량", text), "320")
        self.assertEqual(self._extract("금액", text), "15,300.00")

    def test_fallback_patterns(self):
        # 표 형식 문서 등 라벨과 값이 떨어진 경우 → 값 형식 단독 패턴으로 추출
        text = "HD-11111-ZZ  850 kg  40 EA  USD 9,000"
        self.assertEqual(self._extract("품번", text), "HD-11111-ZZ")
        self.assertEqual(self._extract("무게", text), "850")
        self.assertEqual(self._extract("수량", text), "40")
        self.assertEqual(self._extract("금액", text), "9,000")

    def test_missing_field_returns_empty(self):
        self.assertEqual(self._extract("품번", "품번 정보 없음"), "")


class TestIncotermsPerVendor(unittest.TestCase):
    """인코텀즈 번호는 업체마다 표기 형식이 다르다 — vendors.json 의 예시로 검증."""

    @classmethod
    def setUpClass(cls):
        cls.vendors = extract.load_config()["vendors"]

    def test_daehan(self):
        rule = self.vendors["대한정밀"]
        self.assertEqual(
            extract.extract_field(rule["인코텀즈_예시"], rule["인코텀즈_패턴"]),
            "FOB-2020-1184")

    def test_hanbit(self):
        rule = self.vendors["한빛금속"]
        self.assertEqual(
            extract.extract_field(rule["인코텀즈_예시"], rule["인코텀즈_패턴"]),
            "CIF/2024/0087")

    def test_sejong(self):
        rule = self.vendors["세종산업"]
        self.assertEqual(
            extract.extract_field(rule["인코텀즈_예시"], rule["인코텀즈_패턴"]),
            "EXW-88-0771")

    def test_cross_vendor_mismatch(self):
        # 다른 업체의 표기 형식에는 매칭되지 않아야 한다 (업체별 분기의 근거)
        daehan = self.vendors["대한정밀"]
        hanbit_text = self.vendors["한빛금속"]["인코텀즈_예시"]
        self.assertEqual(
            extract.extract_field(hanbit_text, daehan["인코텀즈_패턴"]), "")


@unittest.skipUnless(HAS_PDFPLUMBER, "pdfplumber 미설치 — 손상 PDF 처리 테스트 생략")
class TestProcessContinuesOnError(unittest.TestCase):
    def test_corrupt_pdf_marks_review_and_continues(self):
        config = extract.load_config()
        with tempfile.TemporaryDirectory() as tmp:
            bad_path = os.path.join(tmp, "손상파일.pdf")
            with open(bad_path, "wb") as f:
                f.write(b"this is not a pdf")
            good = sorted(
                os.path.join(extract.SAMPLE_DIR, f)
                for f in os.listdir(extract.SAMPLE_DIR)
                if f.lower().endswith(".pdf")
            )
            rows = extract.process_pdfs([bad_path] + good[:1], config)
            # 손상 파일도 행으로 남고(검토필요 Y), 뒤 파일은 정상 처리된다
            self.assertEqual(len(rows), 2)
            self.assertTrue(rows[0]["검토필요"].startswith("Y (처리오류"))
            self.assertEqual(rows[0]["파일명"], "손상파일.pdf")
            self.assertEqual(rows[1]["검토필요"], "N")


if __name__ == "__main__":
    unittest.main(verbosity=2)
