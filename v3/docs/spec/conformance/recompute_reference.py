"""
Independent reference implementation of the ADR-322C bootstrap recomputation.

Written ONLY from the prose of ADR-322C's "Update (2026-08-19)" amendment, with
no reference to flywheel-receipt.ts. Deliberately in a different language from
the reference implementation: an independent check written by reading the TypeScript
would be a copy, not a check (ruflo#3069).

It exists to answer one question -- is the specification sufficient to reimplement
from? -- and doubles as a runnable oracle for consumers building their own verifier.

Usage:
    python3 recompute_reference.py ../examples/receipt-bootstrap-reference.example.json

Exits 0 when the recomputed statistics match the receipt's recorded ones.
Use receipt-bootstrap-reference.example.json, not receipt-accepted.example.json:
only the former has heterogeneous per-task deltas, so only the former actually
discriminates a wrong PRNG (see witness-receipt-contract.md section 6.1).
"""
import hashlib
import json
import sys


def seed_state(corpus_hash, candidate_id, baseline_ref, evaluation_run_id):
    """Section 1: SHA-256 over the concatenation, no separator."""
    data = ("ruflo/bootstrap/v1" + corpus_hash + candidate_id
            + baseline_ref + evaluation_run_id).encode("utf-8")
    digest = hashlib.sha256(data).digest()
    seed_hex = digest.hex()
    state = int.from_bytes(digest[0:4], "big")  # FIRST FOUR BYTES ONLY
    return seed_hex, state


def make_rng(state):
    """Section 1: LCG. First draw uses the advanced state."""
    s = state

    def draw():
        nonlocal s
        s = (1664525 * s + 1013904223) % (2 ** 32)
        return s / (2 ** 32)

    return draw


def bootstrap(deltas, draw, iterations=10000):
    """Section 2: exactly n draws per iteration, consumed in sequence."""
    n = len(deltas)
    if n == 0:
        return [0.0] * iterations
    means = []
    for _ in range(iterations):
        total = 0.0
        for _ in range(n):
            total += deltas[int(draw() * n)]
        means.append(total / n)
    return means


def decimal12(value):
    """Section 4: scale 12, strip trailing zeros then trailing point, '' or '-0' -> '0'."""
    rendered = f"{value:.12f}"
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    if rendered in ("", "-0"):
        return "0"
    return rendered


def recompute(receipt_payload):
    p = receipt_payload
    deltas = [float(d) for d in p["heldOutDeltas"]]
    baseline = float(p["baselineScore"])
    candidate = float(p["candidateScore"])
    frozen_anchor = float(p["statistics"]["frozenAnchorRegression"])
    iterations = p["statistics"]["iterations"]
    metric_epsilon = 1e-12

    seed_hex, state = seed_state(
        p["corpusHash"], p["candidateId"], p["baselineRef"], p["evaluationRunId"]
    )
    means = bootstrap(deltas, make_rng(state), iterations)

    probability = sum(1 for m in means if m > 0) / iterations
    ci_low = sorted(means)[int(0.025 * iterations)]  # 0-based order statistic

    # Section 3
    relative_lift = (candidate - baseline) / max(abs(baseline), metric_epsilon)
    significant = probability >= 0.95 and ci_low > 0
    accepted = relative_lift >= 0.02 and significant and frozen_anchor <= 0
    decision = "accepted" if (accepted and all(p["gates"].values())) else "rejected"

    return {
        "seedHex": seed_hex,
        "relativeLift": decimal12(relative_lift),
        "pairedBootstrapProbability": decimal12(probability),
        "pairedBootstrapDeltaCILow95": decimal12(ci_low),
        "frozenAnchorRegression": decimal12(frozen_anchor),
        "significant": significant,
        "accepted": accepted,
        "decision": decision,
    }


if __name__ == "__main__":
    receipt = json.load(open(sys.argv[1]))
    payload = receipt["payload"]
    got = recompute(payload)
    want = {
        "seedHex": payload["statistics"]["seedHex"],
        "relativeLift": payload["statistics"]["relativeLift"],
        "pairedBootstrapProbability": payload["statistics"]["pairedBootstrapProbability"],
        "pairedBootstrapDeltaCILow95": payload["statistics"]["pairedBootstrapDeltaCILow95"],
        "frozenAnchorRegression": payload["statistics"]["frozenAnchorRegression"],
        "significant": payload["statistics"]["significant"],
        "accepted": payload["statistics"]["accepted"],
        "decision": payload["decision"],
    }
    ok = True
    for k in want:
        match = got[k] == want[k]
        ok = ok and match
        print(f"{'OK  ' if match else 'FAIL'} {k}: got={got[k]!r} want={want[k]!r}")
    print("\nRESULT:", "spec is sufficient" if ok else "SPEC INSUFFICIENT")
    sys.exit(0 if ok else 1)
