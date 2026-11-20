#!/usr/bin/env python3
"""Run the real model against labeled prompts and score scope accuracy.

Usage (from repo root, with server/.env configured):
  server/.venv/bin/python scripts/eval_guardrails.py
  server/.venv/bin/python scripts/eval_guardrails.py --limit 10
  server/.venv/bin/python scripts/eval_guardrails.py --prompts scripts/eval_guardrails_prompts.json

Mixed prompts (diagram + off-topic) are scored as correct if in_scope=true
(diagram part may be done; extra chit-chat ignored) OR if the model refuses
entirely — either is acceptable. Default scoring: expected out_scope for pure
off-topic; for tag=mixed*, accept either outcome.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server"
sys.path.insert(0, str(SERVER))

from guardrails.blocklist import matches_blocklist  # noqa: E402
from guardrails.pipeline import call_tool_once  # noqa: E402
from guardrails.prompts import DIAGRAM_STYLE_GUIDE, DIAGRAM_SYSTEM  # noqa: E402
from models import tool_input_schema  # noqa: E402


def load_prompts(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return list(data.get("prompts") or [])


def classify_with_model(prompt: str) -> tuple[bool, str]:
    """Return (in_scope, refusal_reason_or_empty)."""
    if matches_blocklist(prompt):
        return False, "blocklist"
    user = (
        "Create a clear architecture/flowchart diagram for this request.\n"
        f"Request: {prompt}\n\n"
        f"{DIAGRAM_STYLE_GUIDE}"
    )
    args, _, _ = call_tool_once(
        system=DIAGRAM_SYSTEM,
        messages=[{"role": "user", "content": user}],
        tool_name="draw_diagram",
        tool_description="Emit a structured diagram graph for DrawAI, or refuse if out of scope.",
        parameters=tool_input_schema(),
        max_tokens=1024,
    )
    in_scope = bool(args.get("in_scope", True))
    nodes = args.get("nodes") or []
    if in_scope and not nodes:
        in_scope = False
    reason = str(args.get("refusal_reason") or "")
    return in_scope, reason


def score_row(expected: str, tag: str, predicted_in_scope: bool) -> bool:
    if tag.startswith("mixed"):
        # Diagram part may proceed; off-topic ignored. Either accept or refuse is OK.
        return True
    if expected == "in_scope":
        return predicted_in_scope
    return not predicted_in_scope


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate DrawAI diagram-scope guardrails")
    parser.add_argument(
        "--prompts",
        type=Path,
        default=ROOT / "scripts" / "eval_guardrails_prompts.json",
    )
    parser.add_argument("--limit", type=int, default=0, help="Only run first N prompts")
    parser.add_argument("--sleep", type=float, default=0.3, help="Pause between calls")
    args = parser.parse_args()

    prompts = load_prompts(args.prompts)
    if args.limit > 0:
        prompts = prompts[: args.limit]

    results = []
    false_refusals = []
    false_accepts = []
    errors = []

    for i, row in enumerate(prompts, 1):
        pid = row.get("id", str(i))
        prompt = row["prompt"]
        expected = row["expected"]
        tag = row.get("tag", "")
        print(f"[{i}/{len(prompts)}] {pid}: {prompt[:60]!r} …", flush=True)
        try:
            predicted, reason = classify_with_model(prompt)
            ok = score_row(expected, tag, predicted)
            results.append({"id": pid, "ok": ok, "expected": expected, "predicted": predicted, "tag": tag})
            if not ok:
                if expected == "in_scope" and not predicted:
                    false_refusals.append({"id": pid, "prompt": prompt, "reason": reason})
                elif expected == "out_scope" and predicted:
                    false_accepts.append({"id": pid, "prompt": prompt})
            status = "OK" if ok else "MISS"
            print(f"  → {status} expected={expected} predicted_in_scope={predicted} {reason}")
        except Exception as exc:  # noqa: BLE001
            errors.append({"id": pid, "prompt": prompt, "error": str(exc)})
            print(f"  → ERROR {exc}")
        if args.sleep:
            time.sleep(args.sleep)

    scored = [r for r in results]
    correct = sum(1 for r in scored if r["ok"])
    total = len(scored)
    accuracy = (correct / total * 100) if total else 0.0

    print("\n======== Guardrail eval ========")
    print(f"Total scored: {total}")
    print(f"Accuracy:     {correct}/{total} ({accuracy:.1f}%)")
    print(f"False refusals (in-scope refused): {len(false_refusals)}")
    for fr in false_refusals:
        print(f"  - {fr['id']}: {fr['prompt']!r} ({fr.get('reason')})")
    print(f"False accepts (out-of-scope accepted): {len(false_accepts)}")
    for fa in false_accepts:
        print(f"  - {fa['id']}: {fa['prompt']!r}")
    print(f"Errors: {len(errors)}")
    for er in errors:
        print(f"  - {er['id']}: {er['error']}")

    out_path = ROOT / "scripts" / "eval_guardrails_last.json"
    out_path.write_text(
        json.dumps(
            {
                "accuracy": accuracy,
                "correct": correct,
                "total": total,
                "false_refusals": false_refusals,
                "false_accepts": false_accepts,
                "errors": errors,
                "results": results,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {out_path}")
    return 0 if not false_accepts and not false_refusals and not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
