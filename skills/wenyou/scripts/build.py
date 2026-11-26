#!/usr/bin/env python3
"""Compile a Wenyou story.json blueprint into a self-contained single-file HTML game."""

import argparse
import html
import json
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
RUNTIME_DIR = SKILL_DIR / "runtime"
THEMES_DIR = SKILL_DIR / "themes"


def safe_json_for_script(obj) -> str:
    """Serialize JSON safely for embedding inside an HTML <script> tag."""
    return (
        json.dumps(obj, ensure_ascii=False)
        .replace("</", "<\\/")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def load_all_themes() -> dict:
    themes = {}
    for css_file in sorted(THEMES_DIR.glob("*.css")):
        themes[css_file.stem] = css_file.read_text(encoding="utf-8").strip()
    return themes


def build_custom_css(overrides: dict | None) -> str:
    if not overrides or not isinstance(overrides, dict):
        return ""
    rules = []
    for k, v in overrides.items():
        if str(k).startswith("--wy-"):
            rules.append(f"  {k}: {v};")
    return ":root {\n" + "\n".join(rules) + "\n}" if rules else ""


def build(story_path: Path, output_path: Path, theme_override: str | None = None, lang: str = "zh-CN") -> None:
    story = json.loads(story_path.read_text(encoding="utf-8"))
    themes = load_all_themes()

    chosen_theme = theme_override or story.get("theme") or "editorial"
    if chosen_theme not in themes:
        valid = ", ".join(sorted(themes.keys()))
        raise SystemExit(f"error: unknown theme '{chosen_theme}'. Valid themes: {valid}")
    story["theme"] = chosen_theme

    shell = (RUNTIME_DIR / "shell.html").read_text(encoding="utf-8")
    engine_css = (RUNTIME_DIR / "engine.css").read_text(encoding="utf-8")
    engine_js = (RUNTIME_DIR / "engine.js").read_text(encoding="utf-8")

    ui = story.get("ui") or {}
    replacements = {
        "__LANG__": html.escape(story.get("lang") or lang),
        "__TITLE__": html.escape(story.get("title") or "Wenyou"),
        "__THEME_CSS__": themes[chosen_theme],
        "__CUSTOM_CSS__": build_custom_css(story.get("themeOverrides")),
        "__ENGINE_CSS__": engine_css,
        "__FULLSCREEN_LABEL__": html.escape(ui.get("fullscreenLabel") or "沉浸阅读"),
        "__SAVE_LABEL__": html.escape(ui.get("saveLabel") or "存档"),
        "__RETRY_LABEL__": html.escape(ui.get("retryLabel") or "重来"),
        "__DELETE_LABEL__": html.escape(ui.get("deleteLabel") or "删掉本回合"),
        "__THEMES_JSON__": safe_json_for_script(themes),
        "__STORY_JSON__": safe_json_for_script(story),
        "__ENGINE_JS__": engine_js,
    }

    out = shell
    for token, value in replacements.items():
        out = out.replace(token, value)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(out, encoding="utf-8")
    print(f"wrote {output_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a single-file Wenyou HTML interactive fiction app.")
    parser.add_argument("story", type=Path, help="Path to story.json blueprint")
    parser.add_argument("output", type=Path, help="Path to output .html file")
    parser.add_argument("--theme", default=None, help="Override theme id (ink-scroll, dossier, terminal, editorial, parchment-night)")
    parser.add_argument("--lang", default="zh-CN", help="HTML lang attribute (default: zh-CN)")
    parser.add_argument("--no-check", action="store_true", help="Skip running check.py after build")
    args = parser.parse_args()

    build(args.story, args.output, args.theme, args.lang)

    if not args.no_check:
        from check import check_html_file

        errors, warnings = check_html_file(args.output)
        for w in warnings:
            print(f"warn  {w}")
        for e in errors:
            print(f"error {e}", file=sys.stderr)
        if errors:
            print(f"fail  {args.output}  ({len(errors)} errors, {len(warnings)} warnings)", file=sys.stderr)
            return 1
        print(f"ok    {args.output}  (0 errors, {len(warnings)} warnings)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
