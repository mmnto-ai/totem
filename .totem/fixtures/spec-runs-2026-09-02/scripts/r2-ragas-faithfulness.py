"""R2 (mmnto-ai/totem-strategy#1193): RAGAS Faithfulness over the spec-runs fixture.

For each artifact row in artifacts.ndjson:
  user_input          = the anchor text (issue title + masked body, or the topic text)
  response            = output.content (the draft)
  retrieved_contexts  = the four delivered-context sections rendered into the prompt
                        (TOTEM KNOWLEDGE / RELATED SPECS & ADRs / RELATED CODE / SHARED HELPERS),
                        non-empty ones only
and scores Faithfulness (claim decomposition + NLI against the contexts) with the chosen judge.

Judges:
  --judge local   Ollama, OpenAI-compatible endpoint (http://localhost:11434/v1), --model e.g. qwen3-coder:30b
  --judge gemini  Google OpenAI-compatible endpoint, --model e.g. gemini-3.5-flash (GEMINI_API_KEY from the env)

Usage:
  python r2-ragas-faithfulness.py --fixture <dir> --judge local --model qwen3-coder:30b [--limit N] [--ids id1,id2] [--smoke]
Writes <fixture>/r2-faithfulness-<judge>-<model-slug>.ndjson (one row per artifact) and a .summary.json.
Dependencies (measurement-only venv, never shipped): ragas 0.4.3 (Apache-2.0), langchain-community<0.4 pin,
openai (Apache-2.0) for both arms (litellm was installed but is not used). Python 3.14.5.
"""

import argparse
import asyncio
import json
import os
import platform
import re
import sys
import time


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--fixture", required=False, default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    p.add_argument("--judge", choices=["local", "gemini"], default="local")
    p.add_argument("--model", default="qwen3-coder:30b")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--ids", default="")
    p.add_argument("--smoke", action="store_true", help="score the toy example only")
    p.add_argument("--concurrency", type=int, default=1)
    return p.parse_args()


def build_llm(judge: str, model: str):
    from ragas.llms import llm_factory

    if judge == "local":
        from openai import AsyncOpenAI

        client = AsyncOpenAI(base_url="http://localhost:11434/v1", api_key="ollama")
        return llm_factory(model, provider="openai", client=client, temperature=0, max_tokens=16384)
    if judge == "gemini":
        from openai import AsyncOpenAI

        # Google's OpenAI-compatible endpoint: the same instructor JSON-mode path as the local arm,
        # so the two judges differ only in the model behind the endpoint.
        key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        client = AsyncOpenAI(base_url="https://generativelanguage.googleapis.com/v1beta/openai/", api_key=key)
        return llm_factory(model, provider="openai", client=client, temperature=0, max_tokens=16384)
    raise ValueError(judge)


def anchor_text(row: dict) -> str:
    if row.get("issue"):
        i = row["issue"]
        return f"{i.get('title','')}\n\n{i.get('bodyMasked','')}".strip()
    return (row.get("topic") or row["anchor"]["ref"]).strip()


def contexts(row: dict) -> list:
    dc = row.get("deliveredContext") or {}
    out = []
    for key in ("knowledge", "specs", "code", "helpers"):
        text = (dc.get(key) or "").strip()
        if text:
            out.append(text)
    return out


async def score_one(metric, row: dict, sem: asyncio.Semaphore) -> dict:
    rid = row["id"]
    resp = row["output"]["content"]
    ctxs = contexts(row)
    base = {
        "artifactId": rid,
        "anchorKind": row["anchor"]["kind"],
        "responseChars": len(resp),
        "contextCount": len(ctxs),
        "contextChars": sum(len(c) for c in ctxs),
    }
    if len(resp.strip()) == 0:
        return {**base, "value": None, "status": "NOT_SCORED", "reason": "empty draft"}
    if not ctxs:
        return {**base, "value": None, "status": "NOT_SCORED", "reason": "no delivered context"}
    async with sem:
        t0 = time.time()  # inside the gate: per-row seconds exclude queue wait (the 2026-09-02 runs recorded it outside; use wall/n there)
        try:
            result = await metric.ascore(user_input=anchor_text(row), response=resp, retrieved_contexts=ctxs)
            value = getattr(result, "value", None)
            return {**base, "value": value, "status": "OK", "seconds": round(time.time() - t0, 1)}
        except Exception as e:  # noqa: BLE001 - the blocker is the finding
            return {**base, "value": None, "status": "ERROR", "reason": (type(e).__name__ + ": " + (str(e) or repr(e)) + (" | cause: " + repr(e.__cause__) if getattr(e, "__cause__", None) else ""))[:600], "seconds": round(time.time() - t0, 1)}


async def main():
    args = parse_args()
    from ragas.metrics.collections import Faithfulness

    llm = build_llm(args.judge, args.model)
    metric = Faithfulness(llm=llm)
    slug = re.sub(r"[^A-Za-z0-9]+", "-", args.model).strip("-").lower()

    if args.smoke:
        t0 = time.time()
        r = await metric.ascore(
            user_input="Where and when was Einstein born?",
            response="Einstein was born in Ulm, Germany, in 1879. He was a devoted fan of pizza.",
            retrieved_contexts=["Albert Einstein was born in Ulm, in the Kingdom of Wurttemberg in the German Empire, on 14 March 1879."],
        )
        print(json.dumps({"judge": args.judge, "model": args.model, "value": getattr(r, "value", None), "seconds": round(time.time() - t0, 1)}))
        return

    rows = []
    with open(os.path.join(args.fixture, "artifacts.ndjson"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    if args.ids:
        wanted = set(args.ids.split(","))
        rows = [r for r in rows if any(r["id"].startswith(w) for w in wanted)]
    if args.limit:
        rows = rows[: args.limit]

    sem = asyncio.Semaphore(max(1, args.concurrency))
    started = time.time()
    results = await asyncio.gather(*(score_one(metric, r, sem) for r in rows))
    wall = round(time.time() - started, 1)

    out_path = os.path.join(args.fixture, f"r2-faithfulness-{args.judge}-{slug}.ndjson")
    with open(out_path, "w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")

    scored = [r for r in results if r["status"] == "OK" and isinstance(r["value"], (int, float))]
    by_kind = {}
    for r in scored:
        by_kind.setdefault(r["anchorKind"], []).append(r["value"])
    summary = {
        "judge": args.judge,
        "model": args.model,
        "ollamaContextNote": "Ollama 0.33.2 loads qwen3-coder:30b with num_ctx 16384 (ollama ps)" if args.judge == "local" else None,
        "n": len(results),
        "scored": len(scored),
        "notScored": [{"id": r["artifactId"][:8], "status": r["status"], "reason": r.get("reason")} for r in results if r["status"] != "OK"],
        "wallSeconds": wall,
        "meanSecondsPerScored": round(sum(r.get("seconds", 0) for r in scored) / len(scored), 1) if scored else None,
        "byKind": {k: {"n": len(v), "mean": round(sum(v) / len(v), 3), "min": min(v), "max": max(v)} for k, v in by_kind.items()},
        "host": {"platform": platform.platform(), "python": sys.version.split()[0]},
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(os.path.join(args.fixture, f"r2-faithfulness-{args.judge}-{slug}.summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
