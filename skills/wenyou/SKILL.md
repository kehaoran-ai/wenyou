---
name: wenyou
description: Build immersive, single-file HTML interactive fiction (AIRP / text-adventure / 文游) platforms where tabs, state widgets, diegetic copy and visual themes adapt to each story instead of using fixed RPG templates. Ships five restrained atmospheric themes, a streaming OpenAI-compatible API engine, automatic state settlement, exact turn-snapshot rollback, multi-slot saves and offline playable demos. Use whenever the user asks to create a text adventure, AIRP frontend, interactive fiction web app, HTML 文游平台, or story-driven RPG reader.
---

# Wenyou

Build a self-contained single-file HTML interactive fiction platform tailored to the user's story. Every story gets its own **dynamic sidebar tabs**, **in-world UI voice**, and **matching atmospheric theme** — never a generic pink template with hardcoded "Status / Bag / Quests / NPC" tabs.

You write only the story blueprint (`story.json`). `build.py` compiles the battle-tested runtime engine, chosen theme and blueprint into one standalone `.html` file that opens directly in desktop or mobile browsers with zero build step.

## 1. Match the theme to the story's atmosphere

Pick the theme that gives the strongest immersion for the genre. Do not ask the user unless they want a custom aesthetic.

| Theme ID | Mood & Surface | Best For |
|---|---|---|
| `ink-scroll` | Warm xuan-paper (`#FAF8F3`), ink black, cinnabar accent (`#9B2C2C`), Song/Serif prose | 武侠江湖、古风权谋、志怪聊斋、修仙 |
| `dossier` | Aged archive paper (`#F6F3EC`), sepia ink, red-pencil accent (`#8F2D22`), mono timestamps | 民国探案、克苏鲁调查、刑侦悬疑、冷战谍战 |
| `terminal` | Obsidian dark (`#0B0D10`), crisp grid canvas, restrained amber (`#D99B26`), mono telemetry | 硬科幻生存、太空失联、赛博朋克、废土避难所 |
| `editorial` | Neutral grey shell (`#F6F6F7`), crisp white cards, cobalt accent (`#1D4ED8`), clean sans | 现代都市、职场博弈、现实悬疑、校园物语 |
| `parchment-night` | Deep charcoal (`#121110`), warm ivory serif prose, antique gold (`#C29552`) | 西幻史诗、暗黑宫廷、哥特庄园、地下城 |

If a story wants a subtle twist (for instance, phosphor green on `terminal` or indigo ink on `ink-scroll`), pass `themeOverrides` with only `--wy-accent`, `--wy-accent-soft`, and `--wy-accent-border`. Leave the neutral scale intact.

## 2. Design story-specific dynamic tabs (never fixed tabs)

Read `reference/story-schema.md` for the exact JSON shape.

Rules for tabs:
1. **Invent tabs from the fiction itself.** A wuxia story has `行囊`、`武学`、`江湖录`、`风声`. A 1930s detective case has `现场与证物`、`身心状态`、`嫌疑人`、`调查笔记`. A stranded spacecraft has `舰体遥测`、`舱室与载荷`、`乘员状态`、`黑匣日志`.
2. **Use 3 to 5 unlocked tabs at start**, and optionally **1 hidden tab (`"unlocked": false`)** that unlocks mid-story via `unlock_tab` when the player discovers a secret (e.g., `残卷`, `密档`, `隐藏频段`).
3. **Compose tabs from the 6 built-in widgets**:
   - `meters` — bounded gauges with optional `dangerBelow` threshold (气血、理智 SAN、氧气、信任度)
   - `stats` — 2-column compact key-value pairs (银两、境界、轨道高度、剩余天数)
   - `tags` — items, skills, evidence, or clearances with `qty` / `badge` and `meta` notes
   - `entities` — characters, suspects, factions, or crew with `role`, `status`, and `note`
   - `timeline` — clues, rumors, case logs, or mission events with `tag`, `title`, `detail`, `status`
   - `notes` — letters, vows, decrypted fragments, or world rules
4. **Keep system utilities out of story tabs.** Saves, API config, font controls and immersive fullscreen already live in the top chrome and modals.

## 3. Make every UI label stay in-character

Fill the `ui` object in `story.json` so buttons and headers match the world's voice:
- `drawerTitle`: `随身卷宗` / `案卷目录` / `舰载遥测` / `议席秘录`
- `interactLabel`: `抉择` / `调查行动` / `终端指令` / `举措`
- `inputPlaceholder`: `写下你的应对… (Enter 发送，Shift+Enter 换行)`
- `retryLabel` / `deleteLabel` / `autoSettleLabel` / `fullscreenLabel` / `saveLabel` / `sendLabel`
- `turnPrefix`: `第 {n} 回` / `卷宗 {0n}` / `LOG {00n}`

Never put emoji in UI labels, tab names, or buttons.

## 4. Write the opening and playable offline demo

Every generated game must be **immediately playable on double-click**, even before the user pastes an API key:
1. Write a gripping `opening.prose` (220–450 words) that drops straight into tension, sensory detail and a concrete dilemma — no encyclopedic worldbuilding lecture.
2. Provide exactly 3 `opening.choices` with distinct tactics, risks or moral directions (20–45 characters each).
3. Include a 2-to-3 step `demoScript.branches` showing:
   - Distinct prose for each opening choice
   - Real `updates` operations that mutate meters, add items/clues, update an entity, and ideally trigger an `unlock_tab` so the player sees the dynamic tab system come alive immediately.
4. Write a crisp `prompt` object (`worldview`, `protagonist`, `style`, `customRules`) so once the user connects DeepSeek / OpenAI / OpenRouter / Ollama in the API modal, the live LLM seamlessly continues the story and keeps updating the exact dynamic tabs.

## 5. Build and verify

Write `story.json` to a working path, then compile and validate:

```bash
python3 <skill-dir>/scripts/build.py story.json ./my-game.html
```

`build.py` bundles the chosen theme, all switchable themes, the runtime engine and your `story.json` into one standalone HTML file, then automatically runs `check.py`.

Fix every error reported by `check.py`. Open the generated `.html` file in a browser (or tell the user its path) to confirm both desktop and mobile widths render with zero horizontal overflow and crisp alignment.
