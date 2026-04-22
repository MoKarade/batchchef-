"""Shared helpers for parsing Claude API responses."""
import json
import re


def parse_json_response(text: str) -> dict | list:
    """Strip markdown code fences then parse JSON from a Claude response."""
    text = text.strip()
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        text = match.group(1)
    return json.loads(text)


# Back-compat alias for older call sites
parse_gemini_json = parse_json_response
