"""Shared helpers for parsing Gemini API responses."""
import json
import re


def parse_gemini_json(text: str) -> dict | list:
    """Strip markdown code fences then parse JSON from a Gemini response."""
    text = text.strip()
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        text = match.group(1)
    return json.loads(text)
