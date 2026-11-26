#!/usr/bin/env python3
"""Validate a compiled Wenyou HTML file (or story.json) for schema integrity and anti-AI-slop rules."""

import json
import re
import sys
from pathlib import Path

VALID_THEMES = {"ink-scroll", "dossier", "terminal", "editorial", "parchment-night"}
VALID_WIDGETS = {"meters", "stats", "tags", "entities", "timeline", "notes"}
GENERIC_TAB_SETS = [
    {"状态", "背包", "任务", "NPC"},
    {"属性", "背包", "任务", "人物"},
    {"Status", "Inventory", "Quests", "NPCs"},
]

EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001F6FF"
    "\U0001F900-\U0001F9FF"
    "\U00002600-\U000027BF"
    "]+"
)


def validate_story(story: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    for req in ("id", "title", "theme", "tabs", "opening", "prompt"):
        if not story.get(req):
            errors.append(f"story.{req} is required and non-empty")

    theme = story.get("theme")
    if theme and theme not in VALID_THEMES:
        errors.append(f"invalid theme '{theme}'; expected one of {sorted(VALID_THEMES)}")

    tabs = story.get("tabs") or []
    if not isinstance(tabs, list) or len(tabs) < 2:
        errors.append("story.tabs must contain at least 2 story-tailored tabs")
    else:
        tab_ids = set()
        sec_ids = set()
        unlocked_labels = set()
        for idx, tab in enumerate(tabs):
            tid = tab.get("id")
            label = tab.get("label", "")
            if not tid or not label:
                errors.append(f"tabs[{idx}] must have both 'id' and 'label'")
            if tid in tab_ids:
                errors.append(f"duplicate tab id '{tid}'")
            tab_ids.add(tid)
            if tab.get("unlocked", True):
                unlocked_labels.add(label.strip())
            if EMOJI_RE.search(label):
                errors.append(f"tab label '{label}' contains emoji; keep UI chrome emoji-free")
            sections = tab.get("sections") or []
            if not sections:
                warnings.append(f"tab '{tid}' has no sections")
            for sidx, sec in enumerate(sections):
                sid = sec.get("id")
                stype = sec.get("type")
                if not sid:
                    errors.append(f"tabs[{idx}].sections[{sidx}] missing 'id'")
                elif sid in sec_ids:
                    errors.append(f"duplicate section id '{sid}'")
                sec_ids.add(sid)
                if stype not in VALID_WIDGETS:
                    errors.append(f"section '{sid}' has invalid widget type '{stype}'")

        for generic in GENERIC_TAB_SETS:
            if unlocked_labels == generic:
                warnings.append(
                    "tabs match the generic RPG set (状态/背包/任务/NPC); rename and tailor tabs to the story's world"
                )

    opening = story.get("opening") or {}
    if not opening.get("prose") or len(opening.get("prose", "").strip()) < 60:
        errors.append("opening.prose must be at least 60 characters of narrative prose")
    choices = opening.get("choices") or []
    if len(choices) != 3:
        errors.append(f"opening.choices must contain exactly 3 choices (got {len(choices)})")

    ui = story.get("ui") or {}
    for k, v in ui.items():
        if isinstance(v, str) and EMOJI_RE.search(v):
            errors.append(f"ui.{k} contains emoji; keep UI labels clean")

    return errors, warnings


def extract_story_from_html(html_text: str) -> dict | None:
    m = re.search(r"window\.__WENYOU_STORY__\s*=\s*(\{.*?\});\s*</script>", html_text, re.S)
    if not m:
        return None
    raw = m.group(1).replace("<\\/", "</")
    return json.loads(raw)


def check_html_file(path: Path) -> tuple[list[str], list[str]]:
    text = path.read_text(encoding="utf-8")
    errors: list[str] = []
    warnings: list[str] = []

    if path.suffix == ".json":
        story = json.loads(text)
        return validate_story(story)

    for leftover in ("__TITLE__", "__THEME_CSS__", "__ENGINE_CSS__", "__ENGINE_JS__", "__STORY_JSON__"):
        if leftover in text:
            errors.append(f"unreplaced build token '{leftover}' found in output HTML")

    if "TODO" in text and "<<<GAME_STATE>>>" in text:
        story = extract_story_from_html(text)
        if story and "TODO" in json.dumps(story, ensure_ascii=False):
            errors.append("unresolved 'TODO' found inside story blueprint")
    else:
        story = extract_story_from_html(text)

    if not story:
        errors.append("could not locate embedded window.__WENYOU_STORY__ JSON")
        return errors, warnings

    s_err, s_warn = validate_story(story)
    errors.extend(s_err)
    warnings.extend(s_warn)

    if "backdrop-filter" in text:
        warnings.append("backdrop-filter blur detected; keep surfaces crisp and matte")

    return errors, warnings


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: check.py <game.html|story.json>", file=sys.stderr)
        return 2
    target = Path(sys.argv[1])
    errors, warnings = check_html_file(target)
    for w in warnings:
        print(f"warn  {w}")
    for e in errors:
        print(f"error {e}", file=sys.stderr)
    if errors:
        print(f"fail  {target}  ({len(errors)} errors, {len(warnings)} warnings)", file=sys.stderr)
        return 1
    print(f"ok    {target}  (0 errors, {len(warnings)} warnings)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
