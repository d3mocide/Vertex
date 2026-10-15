#!/usr/bin/env python3
"""Keep `.env` honest: check it against the code, trim it to what matters, keep `.env.example` complete.

    scripts/envtool.py check     [--env .env] [--example .env.example] [--strict]
    scripts/envtool.py minimize  [--env .env] [--write]
    scripts/envtool.py example   [--example .env.example] [--write | --check]
    scripts/envtool.py verify    --env ORIGINAL --other CANDIDATE    (needs docker; proves two files configure the same)

The source of truth is the code: the `Settings` classes of the poller, backend and transcription services
(read with `ast`, so nothing needs installing) and the `${VAR}` references in docker-compose.yml. Never prints a
value from `.env`, only key names, so its output is safe to paste.

`minimize` only drops a line when it can PROVE nothing changes: the value equals the code default for every
service that reads it, and the key is not one whose mere presence the code looks at (`model_fields_set`, e.g.
REGION_LAT pinning the region over the setup wizard). Anything it cannot parse or does not recognise is kept.
Without --write it only reports; with --write it saves a timestamped backup first.
"""
from __future__ import annotations

import argparse
import ast
import difflib
import json
import re
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVICES = {"poller": "poller/config.py", "backend": "backend/config.py", "transcription": "transcription/config.py"}
COMPOSE = "docker-compose.yml"

# Variables that exist for reasons the three config files and compose do not show: the compose project itself,
# or something read straight from the environment. Known, so they are never flagged as typos.
# Names built at run time from a source's name in config/sources.yml: MQTT_{SOURCE}_USERNAME / _PASSWORD.
KNOWN_PATTERNS = (re.compile(r"MQTT_[A-Z0-9_]+_(USERNAME|PASSWORD)"),)

EXTRA_KNOWN = {"COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "COMPOSE_PROFILES", "VERTEX_ENV_FILE", "PYTHONPATH", "TZ"}

# Keys whose value is a secret: even key-name-only output is fine, but never echo anything beside them.
_BOOL_TRUE = {"1", "true", "t", "yes", "y", "on"}
_BOOL_FALSE = {"0", "false", "f", "no", "n", "off"}
_UNSET = object()


# ── schema (from the code) ──────────────────────────────────────────────────────────────────────────

@dataclass
class SettingsField:
    service: str
    name: str
    annotation: str
    default: object            # a Python value, or _UNSET when the default is not a plain literal
    comment: str = ""

    @property
    def env(self) -> str:
        return self.name.upper()


@dataclass
class ComposeVar:
    name: str
    defaults: set[str] = field(default_factory=set)   # every ${VAR:-default} seen (they may disagree)
    required: bool = False         # ${VAR:?message}
    overridden: bool = False       # also assigned a value under an `environment:` block


@dataclass
class Schema:
    fields: dict[str, list[SettingsField]] = field(default_factory=dict)    # ENV NAME -> declarations
    compose: dict[str, ComposeVar] = field(default_factory=dict)
    presence: set[str] = field(default_factory=set)                         # ENV NAMES whose presence matters
    frontend: set[str] = field(default_factory=set)                         # VITE_* names the frontend source reads

    def known(self) -> set[str]:
        return set(self.fields) | set(self.compose) | self.frontend | EXTRA_KNOWN


def _literal(node: ast.AST | None):
    if node is None:
        return _UNSET
    try:
        return ast.literal_eval(node)
    except (ValueError, SyntaxError):
        return _UNSET


def parse_settings(path: Path, service: str) -> list[SettingsField]:
    source = path.read_text()
    lines = source.splitlines()
    out: list[SettingsField] = []
    for cls in (n for n in ast.parse(source).body if isinstance(n, ast.ClassDef) and n.name == "Settings"):
        for node in cls.body:
            if not (isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)):
                continue
            comment = _comment_for(lines, node.lineno)
            out.append(SettingsField(service, node.target.id, ast.unparse(node.annotation),
                                     _literal(node.value), comment))
    return out


def _comment_for(lines: list[str], lineno: int) -> str:
    """The trailing `# ...` on the field's line, else the comment block directly above it."""
    line = lines[lineno - 1]
    trailing = re.search(r"\s#\s*(.+)$", line)
    if trailing and "=" in line:
        return trailing.group(1).strip()
    block: list[str] = []
    i = lineno - 2
    while i >= 0 and lines[i].strip().startswith("#"):
        block.insert(0, lines[i].strip().lstrip("#").strip())
        i -= 1
    return " ".join(b for b in block if b)


# `$${VAR}` is compose's escape for a literal `${VAR}` the container's shell expands -- not ours to read.
_VAR = re.compile(r"(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:-|-|:\?|\?)([^}]*))?\}")


def parse_compose(path: Path, out: dict[str, ComposeVar] | None = None) -> dict[str, ComposeVar]:
    out = {} if out is None else out
    text = path.read_text()
    for name, op, arg in _VAR.findall(text):
        var = out.setdefault(name, ComposeVar(name))
        if op in (":-", "-"):
            var.defaults.add(arg)
        elif op in (":?", "?"):
            var.required = True
    # Names assigned under an `environment:` block override the same name from env_file inside that container.
    in_env, indent = False, 0
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        depth = len(raw) - len(raw.lstrip())
        if stripped == "environment:":
            in_env, indent = True, depth
            continue
        if in_env:
            if depth <= indent:
                in_env = False
                continue
            m = re.match(r"([A-Z][A-Z0-9_]*)\s*:(.*)$", stripped)
            # `POSTGRES_DB: ${POSTGRES_DB:-vertex}` reads the .env value; only a different value overrides it.
            if m and f"${{{m.group(1)}" not in m.group(2):
                out.setdefault(m.group(1), ComposeVar(m.group(1))).overridden = True
    return out


def _strings(node: ast.AST | None, consts: dict[str, set[str]]) -> set[str]:
    """String constants a literal (or a module-level constant name) stands for."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return {node.value}
    if isinstance(node, ast.Name):
        return set(consts.get(node.id, ()))
    if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
        return set().union(*[_strings(e, consts) for e in node.elts]) if node.elts else set()
    return set()


def _checked_names(tree: ast.AST) -> set[str]:
    """Strings the code tests with `x in <something called ...fields...>` (a `model_fields_set` membership check).

    Handles the three shapes the code uses: a literal (`"region_lat" in fields_set`), a name bound by a loop or
    comprehension over literal tuples (`for key, attr in (...)` / `for f in _LOCK_FIELDS`), and nothing else --
    a string merely appearing near such a check does not count (the bbox fields are copied from the stored
    region unconditionally, so they are not presence-sensitive)."""
    consts: dict[str, set[str]] = {}
    for node in tree.body if isinstance(tree, ast.Module) else []:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            consts[node.targets[0].id] = _strings(node.value, consts)

    def membership_names(scope: ast.AST) -> list[ast.AST]:
        return [c.left for c in ast.walk(scope) if isinstance(c, ast.Compare)
                and any(isinstance(op, (ast.In, ast.NotIn)) for op in c.ops)
                and "fields" in ast.unparse(c.comparators[0])]

    found: set[str] = set()
    for left in membership_names(tree):
        found |= _strings(left, consts)
    loops = [n for n in ast.walk(tree) if isinstance(n, ast.For)]
    loops += [g for n in ast.walk(tree) if isinstance(n, (ast.ListComp, ast.SetComp, ast.GeneratorExp)) for g in n.generators]
    for loop in loops:
        scope = loop if isinstance(loop, ast.For) else tree
        checked = {n.id for n in membership_names(scope) if isinstance(n, ast.Name)}
        targets = loop.target.elts if isinstance(loop.target, ast.Tuple) else [loop.target]
        for pos, target in enumerate(targets):
            if not (isinstance(target, ast.Name) and target.id in checked):
                continue
            source = loop.iter if not isinstance(loop.iter, ast.Name) else None
            elements = source.elts if isinstance(source, (ast.Tuple, ast.List)) else [loop.iter]
            for el in elements:
                if isinstance(el, (ast.Tuple, ast.List)) and len(targets) > 1 and pos < len(el.elts):
                    found |= _strings(el.elts[pos], consts)
                elif len(targets) == 1:
                    found |= _strings(el, consts)
    return found


def presence_sensitive(root: Path, all_fields: set[str]) -> set[str]:
    """Settings fields whose mere presence in the environment changes behaviour (see `_checked_names`)."""
    found: set[str] = set()
    for service in SERVICES:
        for path in (root / service).rglob("*.py"):
            if "tests" in path.parts or "__pycache__" in path.parts:
                continue
            text = path.read_text(errors="ignore")
            if "fields_set" not in text:
                continue
            try:
                tree = ast.parse(text)
            except SyntaxError:
                continue
            found |= {s.upper() for s in _checked_names(tree) if s in all_fields}
    return found


def load_schema(root: Path = ROOT) -> Schema:
    schema = Schema()
    for service, rel in SERVICES.items():
        path = root / rel
        if not path.exists():
            continue
        for f in parse_settings(path, service):
            schema.fields.setdefault(f.env, []).append(f)
    for compose in sorted(root.glob("docker-compose*.yml")):        # overrides (tls, dev, ...) read variables too
        parse_compose(compose, schema.compose)
    schema.presence = presence_sensitive(root, {e.lower() for e in schema.fields})
    schema.frontend = frontend_vars(root)
    return schema


def frontend_vars(root: Path) -> set[str]:
    """VITE_* names the frontend reads (baked in at build time, so they only reach a Docker build as build args)."""
    found: set[str] = set()
    base = root / "frontend"
    for pattern in ("src/**/*.ts", "src/**/*.tsx", "*.ts"):
        for path in base.glob(pattern):
            if "node_modules" not in path.parts:
                found |= set(re.findall(r"import\.meta\.env\.(VITE_[A-Z0-9_]+)", path.read_text(errors="ignore")))
    return found


# ── .env parsing ───────────────────────────────────────────────────────────────────────────────

@dataclass
class Entry:
    key: str
    raw: str                    # the value text exactly as written (for rewriting)
    comments: list[str]         # the comment lines directly above, kept with the key
    line: int

    @property
    def value(self) -> str:
        return dotenv_value(self.raw)


def dotenv_value(raw: str) -> str:
    """The value as python-dotenv (what pydantic-settings and compose both use) reads it."""
    v = raw.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return re.split(r"\s+#", v, maxsplit=1)[0].strip()


def parse_env(text: str) -> tuple[list[Entry], list[str]]:
    """(entries, header) where header is the leading comment block that is not attached to any key."""
    entries: list[Entry] = []
    pending: list[str] = []
    header: list[str] = []
    for n, line in enumerate(text.splitlines(), 1):
        s = line.strip()
        if not s:
            if not entries and pending:
                header.extend(pending)
            pending = []
            continue
        if s.startswith("#"):
            if not s.startswith("# ──"):          # section banners are regenerated by `minimize`, never kept as comments
                pending.append(line.rstrip())
            continue
        m = re.match(r"(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$", line)
        if not m:
            pending = []
            continue
        entries.append(Entry(m.group(1), m.group(2), pending, n))
        pending = []
    return entries, header


# ── comparing a value with a default ────────────────────────────────────────────────────────────

def _strip_optional(annotation: str) -> str:
    a = annotation.replace("Optional[", "").replace("typing.", "")
    a = re.sub(r"\s*\|\s*None", "", a).rstrip("]") if "Optional[" in annotation else re.sub(r"\s*\|\s*None", "", a)
    return a.strip()


def provably_equal(value: str, annotation: str, default: object) -> bool:
    """True only when the env text parses, the way pydantic-settings would, to exactly `default`."""
    if default is _UNSET:
        return False
    base = _strip_optional(annotation)
    try:
        if base == "bool":
            low = value.strip().lower()
            if low in _BOOL_TRUE:
                return default is True
            if low in _BOOL_FALSE:
                return default is False
            return False
        if base == "int":
            return isinstance(default, int) and not isinstance(default, bool) and int(value.strip()) == default
        if base == "float":
            return isinstance(default, (int, float)) and not isinstance(default, bool) and float(value.strip()) == float(default)
        if base == "str":
            return isinstance(default, str) and value == default
        if base.startswith(("list", "List", "dict", "Dict", "set", "tuple")):
            return json.loads(value) == default       # complex values are JSON in the environment
    except (ValueError, TypeError):
        return False
    return False


def classify(entry: Entry, schema: Schema) -> tuple[str, str]:
    """(status, reason). status: unknown | required | pinned | redundant | keep."""
    env = entry.key.upper()
    declared = schema.fields.get(env, [])
    cvar = schema.compose.get(env)
    if env not in schema.known() and not any(p.fullmatch(env) for p in KNOWN_PATTERNS):
        return "unknown", "no Settings field or docker-compose.yml reference by this name"
    if cvar and cvar.required:
        return "required", "docker-compose.yml requires it (${%s:?...})" % env
    if env in schema.presence:
        return "pinned", "the code checks whether it is set at all (model_fields_set), so even its default value matters"
    if env in EXTRA_KNOWN:
        return "keep", "compose project setting"
    # Redundant only when EVERY place that reads it would get the same answer from its own default.
    if declared and all(provably_equal(entry.value, f.annotation, f.default) for f in declared):
        if cvar is None or cvar.defaults == {entry.value}:
            return "redundant", "equals the default in the code"
        return "keep", "value matches the Settings default but compose reads it too, with a different default"
    if not declared and cvar and cvar.defaults == {entry.value} and not cvar.required:
        return "redundant", "equals the default in docker-compose.yml"
    return "keep", "differs from the default"


# ── commands ───────────────────────────────────────────────────────────────────────────────────

SECRETISH = re.compile(r"(KEY|SECRET|PASSWORD|PASSCODE|TOKEN|CLIENT_ID|APP_ID)", re.I)

SECTIONS = [
    ("Core infrastructure", ("POSTGRES_", "REDIS_", "DATABASE_URL", "LOG_LEVEL", "COMPOSE_", "VERTEX_", "FRONTEND_",
                             "MQTT_", "TLS_", "ALLOWED_HOSTS", "TRUSTED_PROXIES", "PRIVATE_HOST", "ALLOW_PRIVATE")),
    ("Auth and security", ("AUTH_", "JWT", "SECRET", "CORS", "COOKIE", "ADMIN_")),
    ("Region (a key set here PINS it over the setup wizard)", ("REGION_", "BBOX_", "NWS_", "GEOCODER_", "TIMEZONE")),
    ("Aircraft", ("ADSB_", "OPENSKY")),
    ("Vessels", ("AIS",)),
    ("Radio (P25 / OP25 / Weather Radio)", ("P25_", "TOCSIN_", "WHISPER_", "TRANSCRIPTION", "RADIO_")),
    ("AI briefing", ("SUMMARY_",)),
    ("Traffic and transit", ("ODOT", "WSDOT", "TRIMET", "TRAFFIC", "AMTRAK")),
    ("Weather, fire and hazards", ("AIRNOW", "FIRE_", "FIRMS", "NIFC", "LIGHTNING", "STREAMGAUGE", "FLASHALERT", "TVFR")),
    ("Mesh, APRS and TAK", ("MESH", "APRS", "COT_", "ACARS")),
]


def section_for(key: str) -> str:
    up = key.upper()
    for title, prefixes in SECTIONS:
        if up.startswith(prefixes):
            return title
    return "Other"


def read_env(path: Path) -> tuple[list[Entry], list[str]]:
    return parse_env(path.read_text())


def cmd_check(args, schema: Schema) -> int:
    entries, _ = read_env(Path(args.env))
    example_keys = documented_keys(Path(args.example))
    problems = warnings = 0
    keys_seen: dict[str, int] = {}
    print(f"{args.env}: {len(entries)} keys, {len(open(args.env).read().splitlines())} lines")

    for e in entries:
        keys_seen[e.key.upper()] = keys_seen.get(e.key.upper(), 0) + 1
    dup = sorted(k for k, n in keys_seen.items() if n > 1)
    if dup:
        problems += len(dup)
        print(f"\nDUPLICATE keys (the last one wins): {', '.join(dup)}")

    groups: dict[str, list[tuple[str, str]]] = {"unknown": [], "redundant": [], "pinned": [], "required": []}
    for e in entries:
        status, reason = classify(e, schema)
        if status in groups:
            groups[status].append((e.key, reason))

    if groups["unknown"]:
        problems += len(groups["unknown"])
        print("\nUNKNOWN keys (typo, or a setting that no longer exists):")
        for key, _ in groups["unknown"]:
            near = difflib.get_close_matches(key.upper(), schema.known(), n=1, cutoff=0.75)
            print(f"  {key}" + (f"   did you mean {near[0]}?" if near else ""))
    unwired = sorted({k for k in [e.key.upper() for e in entries] + sorted(example_keys)
                      if k in schema.frontend and k not in schema.compose})
    if unwired:
        warnings += len(unwired)
        print("\nNOT WIRED: the frontend reads these at build time but docker-compose.yml never passes them to the "
              "build, so setting them in .env changes nothing for Docker deployments:")
        print("  " + ", ".join(unwired))
    set_keys = {e.key.upper() for e in entries}
    missing = sorted(k for k, v in schema.compose.items() if v.required and k not in set_keys)
    if missing:
        problems += len(missing)
        print(f"\nREQUIRED by docker-compose.yml but not set: {', '.join(missing)}")
    overridden = sorted(e.key for e in entries if schema.compose.get(e.key.upper(), ComposeVar("")).overridden)
    if overridden:
        warnings += len(overridden)
        print("\nOVERRIDDEN: docker-compose.yml assigns these itself, so the value here is ignored by those services:")
        print("  " + ", ".join(overridden))
    if groups["redundant"]:
        warnings += len(groups["redundant"])
        print(f"\nREDUNDANT ({len(groups['redundant'])}): the value equals the code default, so the line can go "
              "(`minimize` removes them):")
        print("  " + ", ".join(k for k, _ in groups["redundant"]))
    if groups["pinned"]:
        print(f"\nPRESENCE MATTERS ({len(groups['pinned'])}) -- kept even at their default, because setting them "
              "pins the value over the setup wizard / stored region:")
        print("  " + ", ".join(k for k, _ in groups["pinned"]))

    undocumented = sorted(k for k in schema.fields if k not in example_keys)
    stale = sorted(k for k in example_keys if k not in schema.known() and not any(p.fullmatch(k) for p in KNOWN_PATTERNS))
    if undocumented:
        warnings += len(undocumented)
        print(f"\nUNDOCUMENTED in {args.example} ({len(undocumented)}): {', '.join(undocumented)}")
        print("  (`example --write` lists them)")
    if stale:
        warnings += len(stale)
        print(f"\nSTALE in {args.example}: {', '.join(stale)}")

    print(f"\n{problems} problem(s), {warnings} warning(s)")
    return 1 if problems or (args.strict and warnings) else 0


def render_minimized(entries: list[Entry], header: list[str], schema: Schema) -> tuple[str, list[str], list[str]]:
    kept: list[Entry] = []
    dropped: list[str] = []
    notes: list[str] = []
    for e in entries:
        status, _ = classify(e, schema)
        if status == "redundant":
            dropped.append(e.key)
        else:
            kept.append(e)
            if status == "unknown":
                notes.append(e.key)
    by_section: dict[str, list[Entry]] = {}
    for e in kept:
        by_section.setdefault("Unrecognised (kept untouched; check the spelling)" if e.key.upper() in
                              {k.upper() for k in notes} else section_for(e.key), []).append(e)
    order = [t for t, _ in SECTIONS] + ["Other", "Unrecognised (kept untouched; check the spelling)"]
    out: list[str] = []
    out += header or ["# Vertex environment -- only what differs from the defaults. See .env.example for every setting."]
    for title in order:
        group = by_section.get(title)
        if not group:
            continue
        out += ["", f"# ── {title} " + "─" * max(4, 60 - len(title))]
        for e in group:
            out += e.comments + [f"{e.key}={e.raw}"]
    return "\n".join(out) + "\n", dropped, notes


def cmd_minimize(args, schema: Schema) -> int:
    path = Path(args.env)
    entries, header = read_env(path)
    text, dropped, unknown = render_minimized(entries, header, schema)
    if getattr(args, "out", None):           # write the result elsewhere, leaving the original alone
        Path(args.out).write_text(text)
        os.chmod(args.out, 0o600)
        print(f"{path}: {len(entries)} keys -> {len(entries) - len(dropped)} kept, {len(dropped)} redundant dropped")
        print(f"wrote {args.out}")
        return 0
    print(f"{path}: {len(entries)} keys -> {len(entries) - len(dropped)} kept, {len(dropped)} redundant dropped")
    if dropped:
        print("  dropping: " + ", ".join(dropped))
    if unknown:
        print("  kept but unrecognised: " + ", ".join(unknown))
    if not args.write:
        print("\n(dry run -- add --write to save; the original is backed up first)")
        return 0
    backup = path.with_name(f"{path.name}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(path, backup)
    mode = path.stat().st_mode
    path.write_text(text)
    path.chmod(mode)
    print(f"\nwrote {path} (backup: {backup.name} -- it holds your secrets, delete it once you have checked the result)")
    return 0


_BLOCK_START = "# >>> envtool: settings not described above (generated; edit the code's Settings, not this block)"
_BLOCK_END = "# <<< envtool"


def documented_keys(path: Path) -> set[str]:
    if not path.exists():
        return set()
    keys = set()
    for line in path.read_text().splitlines():
        m = re.match(r"\s*#?\s*([A-Z][A-Z0-9_]+)=", line)
        if m:
            keys.add(m.group(1))
    return keys


def _example_value(default: object) -> str:
    if default is _UNSET:
        return ""
    if isinstance(default, bool):
        return "true" if default else "false"
    if isinstance(default, (list, dict)):
        return json.dumps(default, separators=(",", ":"))
    return "" if default is None else str(default)


def generated_block(schema: Schema, already: set[str]) -> list[str]:
    lines = [_BLOCK_START]
    for env in sorted(schema.fields):
        if env in already:
            continue
        f = schema.fields[env][0]
        note = f"  # {f.comment}" if f.comment else ""
        lines.append(f"# {env}={_example_value(f.default)}{note}")
    lines.append(_BLOCK_END)
    return lines


def regenerate_example(current: str, schema: Schema) -> tuple[str, int]:
    """(`.env.example` with its generated block brought up to date, number of settings in that block)."""
    text = re.sub(re.escape(_BLOCK_START) + r".*?" + re.escape(_BLOCK_END) + r"\n?", "", current, flags=re.S).rstrip("\n")
    block = generated_block(schema, documented_keys_from_text(text))
    missing = len(block) - 2
    return text + ("\n\n" + "\n".join(block) + "\n" if missing else "\n"), missing


def cmd_example(args, schema: Schema) -> int:
    path = Path(args.example)
    current = path.read_text() if path.exists() else ""
    if getattr(args, "check", False):                       # CI: is the committed file what the tool would write?
        wanted, _ = regenerate_example(current, schema)
        if wanted == current:
            print(f"{path.name} is up to date")
            return 0
        print(f"{path.name} is out of date: a setting was added, removed or changed in a Settings class or compose file.\n"
              "Run `scripts/envtool.py example --write` and commit the result.")
        return 1
    text = re.sub(re.escape(_BLOCK_START) + r".*?" + re.escape(_BLOCK_END) + r"\n?", "", current, flags=re.S).rstrip("\n")
    already = documented_keys_from_text(text)
    block = generated_block(schema, already)
    missing = len(block) - 2
    print(f"{path}: {missing} setting(s) not described")
    if not args.write:
        print("\n".join(block[:12]) + ("\n..." if len(block) > 12 else ""))
        print("\n(dry run -- add --write to save)")
        return 1 if missing else 0
    path.write_text(text + ("\n\n" + "\n".join(block) + "\n" if missing else "\n"))
    print(f"wrote {path}")
    return 0


def documented_keys_from_text(text: str) -> set[str]:
    return {m.group(1) for m in re.finditer(r"^\s*#?\s*([A-Z][A-Z0-9_]+)=", text, flags=re.M)}


# ── verify: do two env files configure the stack identically? ────────────────────────────────────

# Mirrors production: compose injects the file as environment variables (extra, non-setting keys are fine there),
# and the Settings class reads them. Loading it through pydantic's own dotenv path would reject those extras.
_PROBE = (
    "import json,os,sys\nsys.path.insert(0,'/app')\nfrom dotenv import dotenv_values\n"
    "os.environ.update({k:v for k,v in dotenv_values(sys.argv[1]).items() if v is not None})\n"
    "import config\ns=config.Settings(_env_file=None)\n"
    "print(json.dumps({'values':{k:repr(v) for k,v in s.model_dump().items()},'set':sorted(s.model_fields_set)}))"
)


def _run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def settings_in_container(root: Path, service: str, env_file: Path) -> dict:
    """The service's real Settings object loaded from `env_file` in a clean environment (nothing but that file)."""
    cmd = ["docker", "compose", "run", "--rm", "--no-deps", "-T", "-v", f"{env_file.resolve()}:/tmp/probe.env:ro",
           "--entrypoint", "sh", service, "-c", 'cd /app && env -i PATH="$PATH" python -c "$0" /tmp/probe.env', _PROBE]
    done = _run(cmd, root)
    lines = [l for l in done.stdout.splitlines() if l.startswith("{")]
    if done.returncode or not lines:
        raise RuntimeError(f"could not load {service} settings: {done.stderr.strip().splitlines()[-1:] or done.stdout[-200:]}")
    return json.loads(lines[-1])


def compose_resolved(root: Path, env_file: Path) -> str:
    done = _run(["docker", "compose", "--env-file", str(env_file.resolve()), "config"], root)
    if done.returncode:
        raise RuntimeError(f"docker compose config failed: {done.stderr.strip().splitlines()[-1:]}")
    return done.stdout


def cmd_verify(args, schema: Schema, root: Path) -> int:
    a, b = Path(args.env), Path(args.other)
    bad = 0
    resolved_a, resolved_b = compose_resolved(root, a), compose_resolved(root, b)
    same_compose = resolved_a == resolved_b
    print(f"docker compose config (interpolated values): {'identical' if same_compose else 'DIFFERENT'}")
    bad += not same_compose
    for service in SERVICES:
        sa, sb = settings_in_container(root, service, a), settings_in_container(root, service, b)
        diff = sorted(k for k in sa["values"] if sa["values"][k] != sb["values"].get(k))
        # Which keys count as "set" is allowed to shrink (that is the point); only presence-sensitive ones must not.
        lost = sorted(k for k in set(sa["set"]) - set(sb["set"]) if k.upper() in schema.presence)
        print(f"{service:14s} {len(sa['values'])} settings: " + ("identical" if not diff and not lost else "DIFFERENT"))
        if diff:
            print(f"  values differ: {', '.join(diff)}")
        if lost:
            print(f"  presence lost (changes behaviour): {', '.join(lost)}")
        bad += bool(diff or lost)
    print("\nEQUIVALENT" if not bad else "\nNOT EQUIVALENT")
    return 1 if bad else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default=str(ROOT), help="repository root (default: this checkout)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("check", "minimize", "example", "verify"):
        p = sub.add_parser(name)
        p.add_argument("--env", default=".env")
        p.add_argument("--other", help="verify: the file to compare --env against")
        p.add_argument("--out", help="minimize: write the result here instead of in place")
        p.add_argument("--example", default=".env.example")
        p.add_argument("--write", action="store_true")
        p.add_argument("--strict", action="store_true", help="check: warnings fail too")
        p.add_argument("--check", action="store_true", help="example: exit 1 if the file is not what --write would produce")
    args = parser.parse_args(argv)
    root = Path(args.root)
    for attr in ("env", "example", "other", "out"):
        if getattr(args, attr, None) is None:
            continue
        p = Path(getattr(args, attr))
        setattr(args, attr, str(p if p.is_absolute() else root / p))
    schema = load_schema(root)
    if args.cmd == "verify":
        if not args.other:
            parser.error("verify needs --other")
        return cmd_verify(args, schema, root)
    return {"check": cmd_check, "minimize": cmd_minimize, "example": cmd_example}[args.cmd](args, schema)


if __name__ == "__main__":
    sys.exit(main())
