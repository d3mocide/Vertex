import unittest

from enrichment.aircraft_roles import ROLES, alert_for, classify_aircraft


def role(**identity):
    got = classify_aircraft(identity)
    return got[0] if got else None


class AircraftRoleTests(unittest.TestCase):
    def test_local_operators_seen_in_the_flight_log(self):
        self.assertEqual(role(operator="Life Flight Network"), "medical")
        self.assertEqual(role(operator="REACH Air Medical Services"), "medical")
        self.assertEqual(role(operator="Mercy Flights"), "medical")
        self.assertEqual(role(operator="Metro Aviation"), "medical")
        self.assertEqual(role(operator="United States Coast Guard", icao24="ae4dfe"), "rescue")
        self.assertEqual(role(operator="United States Army"), "military")
        self.assertEqual(role(operator="Bonneville Power Administration"), "government")

    def test_life_safety_beats_military_for_the_coast_guard(self):
        # AE.... is inside the military block, but a Coast Guard helicopter is a rescue asset.
        self.assertEqual(role(operator="United States Coast Guard", icao24="ae269b"), "rescue")

    def test_ordinary_owners_are_not_classified(self):
        for op in ("Private", "Hillsboro Aero Academy LLC", "Columbia Helicopters", "Red Bull North America Inc"):
            self.assertIsNone(role(operator=op), op)

    def test_word_boundaries(self):
        self.assertIsNone(role(operator="Firefly Aerospace"))
        self.assertEqual(role(operator="Portland Police Bureau"), "law_enforcement")
        self.assertEqual(role(operator="Multnomah County Sheriff's Office"), "law_enforcement")
        self.assertEqual(role(operator="Oregon Department of Forestry"), "fire")

    def test_registration_marking_works_before_owner_lookup_finishes_but_only_on_a_helicopter(self):
        self.assertEqual(role(registration="N406LF", icao_type="B407"), "medical")
        self.assertEqual(role(registration="N816LF", category="A7"), "medical")
        self.assertIsNone(role(registration="N13LF", icao_type="RV7"))        # a private Van's RV-7
        self.assertIsNone(role(registration="N406LF"))                          # nothing says it is a helicopter
        self.assertIsNone(role(registration="N406LX", icao_type="B407"))

    def test_ameriflight_is_cargo_not_an_air_ambulance(self):
        # AMF is Ameriflight's designator; UAS Transervices is its parent/owner.
        self.assertIsNone(role(callsign="AMF1984", operator="Ameriflight"))
        self.assertIsNone(role(callsign="AMF1968", operator="UAS TRANSERVICES INC"))
        self.assertIsNone(role(callsign="AMF1994"))

    def test_lenders_and_insurers_in_an_owner_list_are_ignored(self):
        owners = "DATAVANT LLC, ARMBRESTER BRADFORD K, FLYING FAITH LLC, HARTFORD FIRE INSURANCE CO, DEGRIECK JEFFREY"
        self.assertIsNone(role(operator=owners))
        self.assertEqual(role(operator="WELLS FARGO TRUST CO, LIFE FLIGHT NETWORK LLC"), "medical")
        self.assertEqual(role(operator="CO FIRE AVIATION LEASING INC"), "fire")
        self.assertEqual(role(operator="Sacramento Fire Department"), "fire")

    def test_callsign_prefix_needs_a_number(self):
        self.assertEqual(role(callsign="REH8"), "medical")
        self.assertIsNone(role(callsign="LIFE"))
        self.assertIsNone(role(callsign="REHAB"))
        self.assertEqual(role(callsign="RCH123"), "military")

    def test_military_hex_block_and_firefighting_squawk(self):
        self.assertEqual(role(icao24="AE56AC"), "military")
        self.assertIsNone(role(icao24="a31e86"))
        self.assertEqual(role(squawk="1255"), "fire")

    def test_reason_is_explained(self):
        self.assertIn("Life Flight", classify_aircraft({"operator": "Life Flight Network"})[1])

    def test_alert_squawks(self):
        self.assertEqual(alert_for("7700"), "emergency")
        self.assertEqual(alert_for("7500"), "hijack")
        self.assertIsNone(alert_for("1200"))
        self.assertIsNone(alert_for(None))

    def test_every_rule_role_has_a_label(self):
        for r in ("rescue", "medical", "fire", "law_enforcement", "military", "news", "government"):
            self.assertIn(r, ROLES)


if __name__ == "__main__":
    unittest.main()
