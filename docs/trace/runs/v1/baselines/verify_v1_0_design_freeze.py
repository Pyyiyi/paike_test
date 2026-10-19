#!/usr/bin/env python3
"""Recompute and assert the v1.0-design-freeze archive hashes."""
from pathlib import Path
import hashlib, json, re, sys

ROOT = Path(__file__).resolve().parents[5]
MANIFEST = Path(__file__).with_name("v1.0-design-freeze.json")

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def fail(msg: str) -> None:
    print(f"FAIL: {msg}")
    raise SystemExit(1)

m = json.loads(MANIFEST.read_text(encoding="utf-8"))
errors = []

for name, expected in m["contracts"].items():
    actual = sha256(ROOT / "contracts" / name)
    if actual != expected:
        errors.append(f"contract hash mismatch: {name}")

contract_lines = "".join(f"{name}  {m['contracts'][name]}\n" for name in sorted(m["contracts"]))
if hashlib.sha256(contract_lines.encode()).hexdigest() != m["contracts_set_sha256"]:
    errors.append("contracts set hash mismatch")

for name, item in m["design_documents"].items():
    actual = sha256(ROOT / item["path"])
    if actual != item["sha256"]:
        errors.append(f"design document hash mismatch: {name}")

input_root = ROOT / m["input_snapshot"]["root"]
files = sorted(p for p in input_root.rglob("*") if p.is_file() and p.name != ".DS_Store")
actual_hashes = {p.relative_to(input_root).as_posix(): sha256(p) for p in files}
if actual_hashes != m["input_snapshot"]["files"]:
    missing = sorted(set(m["input_snapshot"]["files"]) - set(actual_hashes))
    extra = sorted(set(actual_hashes) - set(m["input_snapshot"]["files"]))
    errors.append(f"input snapshot file set/hash mismatch (missing={missing}, extra={extra})")
canonical = "".join(f"{k}  {actual_hashes[k]}\n" for k in sorted(actual_hashes))
if hashlib.sha256(canonical.encode()).hexdigest() != m["input_snapshot"]["sha256"]:
    errors.append("input snapshot aggregate hash mismatch")

issues_text = (ROOT / "docs/trace/runs/v1/issues.yaml").read_text(encoding="utf-8")
if not re.search(r"(?m)^status:\s*design\s*$", issues_text):
    errors.append("issues.yaml global status is not design")
overrides = [v for v in re.findall(r"(?m)^    status:\s*([^#\s]+)", issues_text) if v != "design"]
if overrides:
    errors.append(f"issues.yaml has non-design card overrides: {overrides}")

if errors:
    print("FAIL")
    for e in errors:
        print("-", e)
    raise SystemExit(1)

print(json.dumps({
    "ok": True,
    "baseline": m["baseline"],
    "contract_version": m["contract_version"],
    "contracts": len(m["contracts"]),
    "design_documents": len(m["design_documents"]),
    "input_files": len(actual_hashes),
    "input_snapshot_sha256": m["input_snapshot"]["sha256"],
    "issues_status": "design",
}, ensure_ascii=False, indent=2))
