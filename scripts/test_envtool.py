"""Tests for scripts/envtool.py. Plain unittest, no dependencies:  python3 -m unittest scripts.test_envtool"""
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import envtool as et  # noqa: E402


def write(root: Path, rel: str, text: str) -> Path:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(textwrap.dedent(text))
    return p


CONFIG = '''
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    log_level: str = "INFO"            # DEBUG, INFO, WARNING
    # Map centre. Setting it pins the region.
    region_lat: float = 45.5
    region_lon: float = -122.6
    nws_office: str = "PQR"
    p25_audio_enabled: bool = False
    p25_audio_retention_days: int = 7
    private_host_allowlist: list[str] = []
    summary_llm_api_key: str = ""
    odd_default: str = compute()
    maybe: str | None = None

    class Config:
        env_file = ".env"
'''

REGION_SYNC = '''
def env_locked(settings):
    fields_set = getattr(settings, "model_fields_set", set())
    return "region_lat" in fields_set or "region_lon" in fields_set

def apply(settings):
    if "nws_office" not in getattr(settings, "model_fields_set", set()):
        settings.nws_office = "x"
'''

COMPOSE = """
services:
  poller:
    environment:
      REDIS_URL: redis://:${REDIS_PASSWORD:?Set REDIS_PASSWORD}@redis:6379
      MALLOC_ARENA_MAX: "2"
      VITE_WIRED: ${VITE_WIRED:-x}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}
    ports:
      - "${FRONTEND_PORT:-80}:80"
    image: x:${TAG:-latest}
    command: sh -c ': "$${MQTT_USERNAME:?Set MQTT_USERNAME}"'
  db:
    environment:
      DB_NAME: ${DB_NAME:-vertex}
"""

TLS = """
services:
  frontend:
    volumes:
      - ${TLS_CERT_PATH:-./certs/cert.pem}:/etc/nginx/certs/cert.pem:ro
"""


def make_repo(tmp: Path) -> Path:
    write(tmp, "poller/config.py", CONFIG)
    write(tmp, "poller/region_sync.py", REGION_SYNC)
    write(tmp, "backend/config.py", CONFIG.replace('nws_office: str = "PQR"', 'nws_office: str = "PQR"\n    cors_origins: list[str] = []'))
    write(tmp, "docker-compose.yml", COMPOSE)
    write(tmp, "docker-compose.tls.yml", TLS)
    write(tmp, "frontend/src/config.ts", "export const A = import.meta.env.VITE_WIRED + import.meta.env.VITE_UNWIRED\n")
    return tmp


class SchemaTests(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.root = make_repo(Path(self._t.name))
        self.schema = et.load_schema(self.root)

    def tearDown(self):
        self._t.cleanup()

    def test_fields_defaults_and_comments_come_from_the_code(self):
        f = self.schema.fields["LOG_LEVEL"][0]
        self.assertEqual((f.default, f.annotation, f.comment), ("INFO", "str", "DEBUG, INFO, WARNING"))
        self.assertEqual(self.schema.fields["REGION_LAT"][0].comment, "Map centre. Setting it pins the region.")
        self.assertEqual(self.schema.fields["P25_AUDIO_ENABLED"][0].default, False)
        self.assertEqual(self.schema.fields["PRIVATE_HOST_ALLOWLIST"][0].default, [])

    def test_a_default_that_is_not_a_literal_is_marked_unknown_not_guessed(self):
        self.assertIs(self.schema.fields["ODD_DEFAULT"][0].default, et._UNSET)

    def test_a_field_declared_by_two_services_has_both_declarations(self):
        self.assertEqual({f.service for f in self.schema.fields["NWS_OFFICE"]}, {"poller", "backend"})
        self.assertEqual({f.service for f in self.schema.fields["CORS_ORIGINS"]}, {"backend"})

    def test_compose_variables_defaults_required_and_overrides(self):
        c = self.schema.compose
        self.assertEqual(c["FRONTEND_PORT"].defaults, {"80"})
        self.assertTrue(c["REDIS_PASSWORD"].required)
        self.assertTrue(c["REDIS_URL"].overridden)          # assigned under environment:
        self.assertTrue(c["MALLOC_ARENA_MAX"].overridden)
        self.assertFalse(c["FRONTEND_PORT"].overridden)

    def test_an_escaped_dollar_is_a_shell_variable_not_a_compose_variable(self):
        self.assertNotIn("MQTT_USERNAME", self.schema.compose)

    def test_every_docker_compose_override_file_is_read(self):
        self.assertEqual(self.schema.compose["TLS_CERT_PATH"].defaults, {"./certs/cert.pem"})

    def test_an_environment_entry_that_reads_its_own_name_is_not_an_override(self):
        self.assertFalse(self.schema.compose["DB_NAME"].overridden)          # DB_NAME: ${DB_NAME:-vertex}
        self.assertTrue(self.schema.compose["REDIS_URL"].overridden)          # a different value: ignores .env

    def test_frontend_build_variables_are_found_and_wiring_is_checked(self):
        self.assertEqual(self.schema.frontend, {"VITE_WIRED", "VITE_UNWIRED"})
        self.assertIn("VITE_WIRED", self.schema.compose)
        self.assertNotIn("VITE_UNWIRED", self.schema.compose)

    def test_presence_is_only_what_the_code_actually_checks(self):
        # region_sync's apply() copies bbox values unconditionally; they only sit near a fields_set check.
        write(self.root, "poller/region_sync.py", REGION_SYNC + """
def more(settings):
    for k, attr in (("a", "bbox_min_lat"),):
        setattr(settings, attr, 1.0)
""")
        self.assertNotIn("BBOX_MIN_LAT", et.load_schema(self.root).presence)

    def test_names_checked_through_a_loop_or_a_module_constant_are_found(self):
        write(self.root, "backend/lock.py", """
_LOCK = ("summary_llm_api_key",)
def locked(settings):
    fields_set = settings.model_fields_set
    return [f for f in _LOCK if f in fields_set]
def apply(settings):
    fields = settings.model_fields_set
    for key, attr in (("p", "p25_audio_retention_days"),):
        if attr not in fields:
            pass
""")
        sens = et.load_schema(self.root).presence
        self.assertTrue({"SUMMARY_LLM_API_KEY", "P25_AUDIO_RETENTION_DAYS"} <= sens, sens)

    def test_presence_sensitive_fields_are_found_from_the_code(self):
        self.assertTrue({"REGION_LAT", "REGION_LON", "NWS_OFFICE"} <= self.schema.presence)
        self.assertNotIn("LOG_LEVEL", self.schema.presence)

    def test_the_real_repo_pins_the_region_and_nws_settings(self):
        real = et.load_schema(et.ROOT)
        must = {"REGION_LAT", "REGION_LON", "NWS_OFFICE", "NWS_ZONE", "NWS_STATION_PRIMARY",
                "NWS_STATION_SECONDARY", "NWS_CLIMATE_STATION", "NWS_NEARBY_STATIONS", "NWS_ALERT_ZONES"}
        self.assertTrue(must <= real.presence, must - real.presence)
        self.assertFalse({"BBOX_MIN_LAT", "BBOX_MAX_LAT", "REGION_NAME"} & real.presence, real.presence)
        self.assertTrue({"poller", "backend", "transcription"} <= {f.service for fs in real.fields.values() for f in fs})


class ValueTests(unittest.TestCase):
    def test_dotenv_value(self):
        for raw, want in [("abc", "abc"), ('"a b"', "a b"), ("'x'", "x"), (" 5  # note", "5"), ('"q # not a comment"', "q # not a comment"),
                          ("", "")]:
            self.assertEqual(et.dotenv_value(raw), want, raw)

    def test_provably_equal_matches_how_the_values_are_parsed(self):
        eq = et.provably_equal
        self.assertTrue(eq("true", "bool", True) and eq("FALSE", "bool", False) and eq("0", "bool", False))
        self.assertFalse(eq("true", "bool", False) and eq("maybe", "bool", False))
        self.assertTrue(eq("7", "int", 7) and eq("60", "float", 60.0) and eq("1.50", "float", 1.5))
        self.assertFalse(eq("8", "int", 7) or eq("abc", "int", 7))
        self.assertTrue(eq("INFO", "str", "INFO"))
        self.assertFalse(eq("info", "str", "INFO"))                  # strings are case-sensitive
        self.assertTrue(eq("[]", "list[str]", []) and eq('["a","b"]', "list[str]", ["a", "b"]))
        self.assertFalse(eq("a,b", "list[str]", ["a", "b"]))        # comma form goes through a validator: not provable
        self.assertTrue(eq("", "str | None", ""))                    # unparsed -> kept elsewhere; here str equality
        self.assertFalse(eq("x", "str", et._UNSET))

    def test_bool_is_not_confused_with_int(self):
        self.assertFalse(et.provably_equal("1", "int", True))


class ClassifyTests(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.schema = et.load_schema(make_repo(Path(self._t.name)))

    def tearDown(self):
        self._t.cleanup()

    def status(self, key, raw):
        return et.classify(et.Entry(key, raw, [], 1), self.schema)[0]

    def test_statuses(self):
        self.assertEqual(self.status("LOG_LEVEL", "INFO"), "redundant")
        self.assertEqual(self.status("LOG_LEVEL", "DEBUG"), "keep")
        self.assertEqual(self.status("log_level", "INFO"), "redundant")            # names are case-insensitive
        self.assertEqual(self.status("P25_AUDIO_RETENTION_DAYS", "7"), "redundant")
        self.assertEqual(self.status("P25_AUDIO_ENABLED", "true"), "keep")
        self.assertEqual(self.status("LOG_LEVL", "INFO"), "unknown")
        self.assertEqual(self.status("MQTT_REMOTE_BROKER_USERNAME", "u"), "keep")      # name built from sources.yml
        self.assertEqual(self.status("TLS_CERT_PATH", "./certs/cert.pem"), "redundant")  # from docker-compose.tls.yml
        self.assertEqual(self.status("VITE_WIRED", "x"), "redundant")
        self.assertEqual(self.status("REDIS_PASSWORD", "x"), "required")
        self.assertEqual(self.status("FRONTEND_PORT", "80"), "redundant")           # compose default
        self.assertEqual(self.status("FRONTEND_PORT", "8080"), "keep")
        self.assertEqual(self.status("SUMMARY_LLM_API_KEY", ""), "redundant")        # unset secret == empty default

    def test_a_key_the_code_checks_for_presence_is_never_redundant_even_at_its_default(self):
        self.assertEqual(self.status("REGION_LAT", "45.5"), "pinned")
        self.assertEqual(self.status("BBOX_MIN_LAT", "1"), "unknown")             # not in this fixture; real repo covered below
        self.assertEqual(self.status("NWS_OFFICE", "PQR"), "pinned")

    def test_a_non_literal_default_is_kept(self):
        self.assertEqual(self.status("ODD_DEFAULT", "anything"), "keep")

    def test_a_compose_variable_with_two_different_defaults_is_never_redundant(self):
        write(Path(self._t.name), "docker-compose.override.yml", "x: ${FRONTEND_PORT:-8080}\n")
        schema = et.load_schema(Path(self._t.name))
        self.assertEqual(et.classify(et.Entry("FRONTEND_PORT", "80", [], 1), schema)[0], "keep")

    def test_both_services_must_agree_the_value_is_the_default(self):
        write(Path(self._t.name), "backend/config.py", CONFIG.replace('log_level: str = "INFO"', 'log_level: str = "WARNING"'))
        schema = et.load_schema(Path(self._t.name))
        self.assertEqual(et.classify(et.Entry("LOG_LEVEL", "INFO", [], 1), schema)[0], "keep")


ENV = """\
# Vertex local settings
# (header, not attached to a key)

# database password
POSTGRES_PASSWORD=hunter2
REDIS_PASSWORD="quoted secret"
LOG_LEVEL=INFO
# pinned to my house
REGION_LAT=45.5
P25_AUDIO_ENABLED=true
P25_AUDIO_RETENTION_DAYS=7
SUMMARY_LLM_API_KEY=
FRONTEND_PORT=80
LOG_LEVL=INFO
"""


class MinimizeTests(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.root = make_repo(Path(self._t.name))
        self.schema = et.load_schema(self.root)
        self.entries, self.header = et.parse_env(ENV)

    def tearDown(self):
        self._t.cleanup()

    def test_drops_only_what_is_provably_redundant(self):
        text, dropped, unknown = et.render_minimized(self.entries, self.header, self.schema)
        self.assertEqual(sorted(dropped), ["FRONTEND_PORT", "LOG_LEVEL", "P25_AUDIO_RETENTION_DAYS", "SUMMARY_LLM_API_KEY"])
        self.assertNotIn("REGION_LAT", dropped)
        self.assertEqual(unknown, ["LOG_LEVL"])
        kept, _ = et.parse_env(text)
        self.assertEqual({e.key for e in kept}, {"POSTGRES_PASSWORD", "REDIS_PASSWORD", "REGION_LAT", "P25_AUDIO_ENABLED", "LOG_LEVL"})

    def test_values_are_preserved_byte_for_byte_including_quotes(self):
        text, _, _ = et.render_minimized(self.entries, self.header, self.schema)
        self.assertIn('REDIS_PASSWORD="quoted secret"', text)
        self.assertIn("POSTGRES_PASSWORD=hunter2", text)

    def test_a_keys_comment_stays_with_it_and_the_header_survives(self):
        text, _, _ = et.render_minimized(self.entries, self.header, self.schema)
        self.assertIn("# pinned to my house\nREGION_LAT=45.5", text)
        self.assertIn("# database password\nPOSTGRES_PASSWORD=hunter2", text)
        self.assertTrue(text.startswith("# Vertex local settings"))

    def test_it_is_idempotent(self):
        once, _, _ = et.render_minimized(self.entries, self.header, self.schema)
        e2, h2 = et.parse_env(once)
        twice, dropped, _ = et.render_minimized(e2, h2, self.schema)
        self.assertEqual(once, twice)
        self.assertEqual(dropped, [])

    def test_the_effective_configuration_is_unchanged(self):
        """Every setting resolves to the same value before and after: dropped keys fall back to equal defaults."""
        text, dropped, _ = et.render_minimized(self.entries, self.header, self.schema)
        after = {e.key.upper(): e.value for e in et.parse_env(text)[0]}
        for e in self.entries:
            key = e.key.upper()
            if key in after:
                self.assertEqual(after[key], e.value)
            else:
                self.assertIn(e.key, dropped)
                declared = self.schema.fields.get(key)
                if declared:
                    self.assertTrue(all(et.provably_equal(e.value, f.annotation, f.default) for f in declared))

    def test_write_makes_a_backup_and_keeps_permissions(self):
        env = self.root / ".env"
        env.write_text(ENV)
        env.chmod(0o600)
        args = type("A", (), {"env": str(env), "write": True})()
        self.assertEqual(et.cmd_minimize(args, self.schema), 0)
        backups = list(self.root.glob(".env.bak-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), ENV)
        self.assertEqual(env.stat().st_mode & 0o777, 0o600)
        self.assertNotIn("LOG_LEVEL=INFO", env.read_text())


class ExampleTests(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.root = make_repo(Path(self._t.name))
        self.schema = et.load_schema(self.root)
        self.example = self.root / ".env.example"
        self.example.write_text("# curated\nLOG_LEVEL=INFO\n# P25_AUDIO_ENABLED=false\nREGION_LAT=45.5\n")

    def tearDown(self):
        self._t.cleanup()

    def run_example(self):
        args = type("A", (), {"example": str(self.example), "write": True})()
        et.cmd_example(args, self.schema)
        return self.example.read_text()

    def test_lists_every_setting_not_already_described_and_nothing_else(self):
        text = self.run_example()
        self.assertIn("# curated\nLOG_LEVEL=INFO", text)                       # curated prose untouched
        self.assertEqual(text.count("LOG_LEVEL="), 1)
        self.assertIn("# P25_AUDIO_RETENTION_DAYS=7", text)
        self.assertIn("# NWS_OFFICE=PQR", text)
        self.assertIn("# PRIVATE_HOST_ALLOWLIST=[]", text)
        self.assertEqual(text.count("REGION_LAT="), 1)                          # curated line not repeated in the block

    def test_every_setting_ends_up_documented(self):
        self.run_example()
        self.assertTrue(set(self.schema.fields) <= et.documented_keys(self.example))

    def test_it_is_idempotent(self):
        once = self.run_example()
        self.assertEqual(once, self.run_example())

    def test_a_setting_that_is_later_documented_by_hand_leaves_the_generated_block(self):
        self.run_example()
        self.example.write_text(self.example.read_text().replace("# >>> envtool", "NWS_OFFICE=PQR\n# >>> envtool", 1))
        text = self.run_example()
        self.assertEqual(text.count("NWS_OFFICE="), 1)


class CheckTests(unittest.TestCase):
    def test_exit_code_reflects_problems_and_strict_warnings(self):
        with tempfile.TemporaryDirectory() as t:
            root = make_repo(Path(t))
            (root / ".env").write_text("REDIS_PASSWORD=x\nLOG_LEVL=INFO\n")
            (root / ".env.example").write_text("REDIS_PASSWORD=\n")
            args = type("A", (), {"env": str(root / ".env"), "example": str(root / ".env.example"), "strict": False})()
            self.assertEqual(et.cmd_check(args, et.load_schema(root)), 1)          # unknown key = problem
            (root / ".env").write_text("REDIS_PASSWORD=x\nPOSTGRES_PASSWORD=y\nLOG_LEVEL=INFO\n")
            self.assertEqual(et.cmd_check(args, et.load_schema(root)), 0)          # only warnings
            args.strict = True
            self.assertEqual(et.cmd_check(args, et.load_schema(root)), 1)
            (root / ".env").write_text("LOG_LEVEL=DEBUG\n")
            args.strict = False
            self.assertEqual(et.cmd_check(args, et.load_schema(root)), 1)          # required REDIS_PASSWORD missing


if __name__ == "__main__":
    unittest.main()


class ExampleCheckTests(unittest.TestCase):
    """`example --check` is what CI runs: fail when the committed file has drifted from the code."""

    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.root = make_repo(Path(self._t.name))
        self.schema = et.load_schema(self.root)
        self.example = self.root / ".env.example"
        self.example.write_text("# curated\nLOG_LEVEL=INFO\n")

    def tearDown(self):
        self._t.cleanup()

    def check(self):
        args = type("A", (), {"example": str(self.example), "write": False, "check": True})()
        return et.cmd_example(args, self.schema)

    def test_a_file_missing_settings_fails_and_passes_after_write(self):
        self.assertEqual(self.check(), 1)
        args = type("A", (), {"example": str(self.example), "write": True, "check": False})()
        et.cmd_example(args, self.schema)
        self.assertEqual(self.check(), 0)

    def test_it_never_modifies_the_file(self):
        before = self.example.read_text()
        self.check()
        self.assertEqual(self.example.read_text(), before)

    def test_a_new_setting_in_the_code_makes_a_current_file_stale(self):
        args = type("A", (), {"example": str(self.example), "write": True, "check": False})()
        et.cmd_example(args, self.schema)
        write(self.root, "poller/config.py", CONFIG.replace('log_level: str = "INFO"', 'log_level: str = "INFO"\n    brand_new_setting: int = 3'))
        self.schema = et.load_schema(self.root)
        self.assertEqual(self.check(), 1)

    def test_a_removed_setting_also_makes_it_stale(self):
        args = type("A", (), {"example": str(self.example), "write": True, "check": False})()
        et.cmd_example(args, self.schema)
        write(self.root, "poller/config.py", CONFIG.replace('    nws_office: str = "PQR"\n', ''))
        write(self.root, "backend/config.py", CONFIG.replace('    nws_office: str = "PQR"\n', ''))
        self.schema = et.load_schema(self.root)
        self.assertEqual(self.check(), 1)
