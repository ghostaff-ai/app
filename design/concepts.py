#!/usr/bin/env python3
"""Draw character concept pictures with a Gemini image model (Nano Banana).

    python3 design/concepts.py design/concepts/finanzas-round1.json

Reads GEMINI_API_KEY from design/.env (written by `secret env`), sends each prompt in
the JSON file, and saves the pictures next to it as <round>/<id>.png. A picture that
already exists is skipped, so a re-run only draws what is new or deleted.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    env = Path(__file__).with_name(".env")
    if not key and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("GEMINI_API_KEY="):
                key = line.split("=", 1)[1].strip().strip("\"'")
    # A key stored from `gcloud ... > file` keeps its trailing newline, which may
    # reach the env file as a literal "\n".
    if key:
        key = key.replace("\\n", "").strip()
    if not key:
        raise SystemExit("No GEMINI_API_KEY: run `secret env ghostaff-ai/app` (design/.env).")
    return key


def draw(model: str, prompt: str, key: str) -> bytes:
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "1:1"}},
    }
    req = urllib.request.Request(
        API.format(model=model),
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            data = json.load(res)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{model}: HTTP {error.code}: {error.read().decode()[:600]}")
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline:
                return base64.b64decode(inline["data"])
    raise SystemExit(f"{model}: no picture in the answer: {json.dumps(data)[:600]}")


def main() -> None:
    spec_path = Path(sys.argv[1])
    spec = json.loads(spec_path.read_text())
    out = spec_path.with_suffix("")
    out.mkdir(exist_ok=True)
    key = api_key()
    for idea in spec["ideas"]:
        target = out / f"{idea['id']}.png"
        if target.exists():
            print(f"skip {target}")
            continue
        prompt = f"{spec['style']}\n\nCharacter: {idea['prompt']}"
        target.write_bytes(draw(spec["model"], prompt, key))
        print(f"drew {target}")


if __name__ == "__main__":
    main()
