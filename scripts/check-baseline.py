#!/usr/bin/env python3
"""Fail when docs/baseline.json no longer describes the code it was generated from.

The baseline is only useful if it stays honest. This script enforces the two
parts of it that can drift silently and cheaply, without needing a database or
a running server:

1. Effective template routes. Direct named-method PocketBase registrations in
   apps/server/internal/app, Huma operations registered there, and the GET-only
   SPA fallback in go/httpapi must appear in ``baseline.json`` -> ``routes``.
   The check runs both ways. PocketBase ``Any`` adapter bridges are excluded:
   their supported methods come from the Huma operations they dispatch to.

2. Toolchain. The versions pinned in .github/workflows/ci.yml must be the ones
   recorded in ``baseline.json`` -> ``tool_versions``. A workflow bumped to a new
   Node without the baseline being updated means the recorded baseline describes
   a build nobody runs any more.

   PNPM_VERSION is compared against the pnpm version package.json *declares*
   (``tool_versions.pnpm_declared_in_package_json``), not the pnpm that happened
   to be installed on the audit machine (``pnpm_installed``). CI has to match
   the declaration; the local install may differ and is recorded separately so
   the difference stays visible instead of being quietly reconciled.

Exits 0 and prints a one-line summary when there is no drift. On drift it
prints a readable report and exits 1, so CI fails loudly instead of the baseline
quietly becoming fiction.

Regenerate after an intentional change: update docs/baseline.json in the same
commit as the code, then run this script locally and confirm it exits 0.

Standard library only, Python 3.9+. No database, no network, no subprocess.
"""

from __future__ import annotations

import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE_PATH = os.path.join(REPO, "docs", "baseline.json")
WORKFLOW_PATH = os.path.join(REPO, ".github", "workflows", "ci.yml")
SERVER_DIR = os.path.join(REPO, "apps", "server", "internal", "app")
STATIC_SOURCE = os.path.join(REPO, "go", "httpapi", "static.go")

# Direct named-method registrations only. Any routes in app.go are adapter
# bridges; Huma declares the effective methods for those paths below.
ROUTE_RE = re.compile(r"\be\.Router\.(GET|POST|PUT|PATCH|DELETE|OPTIONS)\(\s*\"([^\"]+)\"")
HUMA_OPERATION_RE = re.compile(
    r"huma\.Operation\s*\{[^}]*?\bMethod:\s*\"([^\"]+)\"[^}]*?\bPath:\s*\"([^\"]+)\"",
    re.DOTALL,
)
STATIC_ROUTE_RE = re.compile(r"\be\.Router\.Any\(\s*\"([^\"]+)\"")

# Keys inside baseline.json["tool_versions"] and the .github/workflows/ci.yml
# env var each one is compared against. PNPM_VERSION is compared against the
# pnpm version package.json declares, not the one that happened to be
# installed on the audit machine, because CI must match the declaration.
TOOL_KEYS = (
    ("go", "GO_VERSION"),
    ("node", "NODE_VERSION"),
    ("pnpm_declared_in_package_json", "PNPM_VERSION"),
)


def read_text(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def source_routes() -> set:
    """Effective template (METHOD, path) pairs from direct routes and Huma."""
    found = set()
    app_sources = []
    for name in sorted(os.listdir(SERVER_DIR)):
        if not name.endswith(".go") or name.endswith("_test.go"):
            continue
        source = read_text(os.path.join(SERVER_DIR, name))
        app_sources.append(source)
        for method, path in ROUTE_RE.findall(source):
            found.add((method.upper(), path))
        for method, path in HUMA_OPERATION_RE.findall(source):
            found.add((method.upper(), path))

    # The shared SPA helper registers Any so it can coexist with PocketBase
    # routes, but explicitly serves files only for GET. Count its effective
    # public route only when the app wires the helper into the server.
    app_source = "\n".join(app_sources)
    static_source = read_text(STATIC_SOURCE)
    if "RegisterStaticDirectory(e," in app_source and "event.Request.Method != http.MethodGet" in static_source:
        for path in STATIC_ROUTE_RE.findall(static_source):
            found.add(("GET", path))

    # OpenAPI documentation is mounted by a shared helper now. Count its
    # routes only when the application wires that helper into its serve hook.
    openapi_source = read_text(os.path.join(REPO, "go", "httpapi", "openapi.go"))
    if "RegisterOpenAPIDocs(e, api)" in app_source:
        for method, path in re.findall(r"event\.Router\.(GET|POST|PUT|PATCH|DELETE|OPTIONS)\(\s*\"([^\"]+)\"", openapi_source):
            found.add((method.upper(), path))
    return found


def workflow_versions(text: str) -> dict:
    """Pull GO_VERSION / NODE_VERSION / PNPM_VERSION out of the CI workflow env block."""
    versions = {}
    for key in ("GO_VERSION", "NODE_VERSION", "PNPM_VERSION"):
        match = re.search(r"^\s*%s:\s*[\"']?([^\s\"'#]+)" % key, text, re.MULTILINE)
        versions[key] = match.group(1) if match else ""
    return versions


def normalize_go(value: str) -> str:
    """go1.27.1, v1.27.1 and 1.27.1 all describe the same toolchain."""
    return value.strip().lstrip("v").removeprefix("go")


def main() -> int:
    for path in (BASELINE_PATH, WORKFLOW_PATH, SERVER_DIR, STATIC_SOURCE):
        if not os.path.exists(path):
            print("check-baseline: missing %s" % os.path.relpath(path, REPO), file=sys.stderr)
            return 2

    try:
        with open(BASELINE_PATH, encoding="utf-8") as handle:
            baseline = json.load(handle)
    except json.JSONDecodeError as error:
        print("check-baseline: docs/baseline.json is not valid JSON: %s" % error, file=sys.stderr)
        return 2

    failures = []

    # ---- 1. route table -------------------------------------------------
    actual = source_routes()
    try:
        recorded = {(r["method"].upper(), r["path"]) for r in baseline["routes"]}
    except (KeyError, TypeError) as error:
        print("check-baseline: baseline.json has no usable 'routes' array: %s" % error, file=sys.stderr)
        return 2

    for missing in sorted(actual - recorded):
        failures.append("route %s %s is registered in source but not recorded in baseline.json" % missing)
    for stale in sorted(recorded - actual):
        failures.append("route %s %s is recorded in baseline.json but not registered in source" % stale)

    # ---- 2. pinned toolchain --------------------------------------------
    pins = workflow_versions(read_text(WORKFLOW_PATH))
    tools = baseline.get("tool_versions", {})

    for tool_key, env_key in TOOL_KEYS:
        pinned = pins.get(env_key, "")
        recorded_version = str(tools.get(tool_key, ""))

        if not pinned:
            failures.append(".github/workflows/ci.yml does not set %s; the toolchain is not pinned" % env_key)
            continue
        if not recorded_version:
            failures.append("baseline.json tool_versions.%s is missing" % tool_key)
            continue

        left, right = normalize_go(recorded_version), normalize_go(pinned)
        if left != right:
            failures.append(
                "toolchain drift: ci.yml %s is %s but baseline.json tool_versions.%s is %s"
                % (env_key, pinned, tool_key, recorded_version)
            )

    # ---- report ---------------------------------------------------------
    if failures:
        print("baseline drift detected (%d problem%s):" % (len(failures), "" if len(failures) == 1 else "s"))
        for line in failures:
            print("  - %s" % line)
        print("")
        print("Either update docs/baseline.json in this same commit, or fix the code.")
        print("See docs/COMPATIBILITY.md for what may not change without a decision.")
        return 1

    print(
        "baseline.json matches source: %d routes, toolchain pinned "
        "(go %s, node %s, pnpm %s)"
        % (
            len(actual),
            pins.get("GO_VERSION", "?"),
            pins.get("NODE_VERSION", "?"),
            pins.get("PNPM_VERSION", "?"),
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
