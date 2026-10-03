"""Aircraft category normalisation and class: feeds disagree on the category format, and half send none."""
import unittest

from enrichment.aircraft_class import classify, classify_type, normalize_category


class NormalizeCategory(unittest.TestCase):
    def test_formats_collapse_to_one(self):
        self.assertEqual(normalize_category("A3"), "A3")
        self.assertEqual(normalize_category(" a7 "), "A7")
        self.assertEqual(normalize_category("3"), "A3")          # the old Beast decoder sent a bare digit
        self.assertEqual(normalize_category(3), "A3")
        self.assertEqual(normalize_category("B1"), "B1")

    def test_no_information_is_none(self):
        for raw in (None, "", "0", "A0", "B0", "C0", "8", "A9", "Z1", "12", "x"):
            self.assertIsNone(normalize_category(raw), raw)


class ClassifyType(unittest.TestCase):
    def test_common_types(self):
        for t, cls in {"B738": "airliner", "B39M": "airliner", "A21N": "airliner", "A320": "airliner", "E75L": "airliner",
                       "CRJ9": "airliner", "B772": "airliner", "B744": "airliner",
                       "C172": "light", "C152": "light", "P28A": "light", "SR22": "light", "RV6": "light", "BE36": "light",
                       "GLF4": "business", "C56X": "business", "PC12": "business", "B350": "business", "DH8D": "business",
                       "EC35": "helicopter", "R44": "helicopter", "B06": "helicopter", "S76": "helicopter"}.items():
            self.assertEqual(classify_type(t), cls, t)

    def test_unknown_and_empty(self):
        for t in (None, "", "ZZZZ", "C130", "C17"):
            self.assertIsNone(classify_type(t), t)

    def test_king_air_is_not_a_737(self):
        self.assertEqual(classify_type("B350"), "business")
        self.assertEqual(classify_type("BE20"), "business")


class Classify(unittest.TestCase):
    def test_category_decides(self):
        self.assertEqual(classify({"category": "A3", "icao_type": "B738"}), ("airliner", "category+type"))
        self.assertEqual(classify({"category": "A1"}), ("light", "category"))
        self.assertEqual(classify({"category": "A2"}), ("business", "category"))
        self.assertEqual(classify({"category": "A5"}), ("airliner", "category"))
        self.assertEqual(classify({"category": "B6"}), ("uav", "category"))
        self.assertEqual(classify({"category": "C1"}), ("ground", "category"))

    def test_bare_digit_category_from_beast_still_works(self):
        self.assertEqual(classify({"category": "3"})[0], "airliner")
        self.assertEqual(classify({"category": "7"})[0], "helicopter")

    def test_type_fills_the_gap(self):
        self.assertEqual(classify({"icao_type": "C172"}), ("light", "type"))
        self.assertEqual(classify({"category": "A0", "icao_type": "B738"}), ("airliner", "type"))

    def test_a_specific_helicopter_type_beats_a_default_category(self):
        self.assertEqual(classify({"category": "A1", "icao_type": "EC35"}), ("helicopter", "type"))

    def test_nothing_known(self):
        self.assertEqual(classify({}), ("unknown", "none"))
        self.assertEqual(classify({"icao_type": "ZZZZ"}), ("unknown", "none"))


if __name__ == "__main__":
    unittest.main()
