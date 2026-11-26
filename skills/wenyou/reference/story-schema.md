# Story Blueprint Schema (`story.json`)

Every Wenyou game is defined by one JSON file and compiled with `scripts/build.py`.

## Top-level Fields

```json
{
  "id": "jianghu-fengyue",
  "lang": "zh-CN",
  "title": "江湖风月",
  "genreLabel": "武侠 · 暗流",
  "subtitle": "一句话引子，说明主角处境与开局悬念。",
  "theme": "ink-scroll",
  "themeOverrides": {
    "--wy-accent": "#9B2C2C"
  },
  "ui": {
    "drawerTitle": "随身卷宗",
    "interactLabel": "抉择",
    "inputPlaceholder": "写下你的应对… (Enter 发送，Shift+Enter 换行)",
    "retryLabel": "重来",
    "deleteLabel": "删掉本回合",
    "autoSettleLabel": "自动结算",
    "fullscreenLabel": "沉浸阅读",
    "saveLabel": "存档",
    "sendLabel": "落笔",
    "turnPrefix": "第 {n} 回",
    "defaultLength": "rich"
  },
  "opening": {
    "scene": "偏巷杂货摊前",
    "time": "戌时初刻 · 细雨",
    "prose": "开局叙事正文，支持双换行分段。",
    "choices": ["选项一", "选项二", "选项三"]
  },
  "tabs": [],
  "initialMemories": [
    { "turn": 1, "text": "初始核心记忆" }
  ],
  "prompt": {
    "worldview": "世界观与核心矛盾",
    "protagonist": "主角身份、能力与秘密",
    "style": "文风、叙事视角与禁止项",
    "customRules": "特殊结算规则或节奏控制"
  },
  "demoScript": {
    "branches": {
      "0": [
        { "scene": "...", "time": "...", "prose": "...", "summary": "...", "updates": [], "choices": ["...", "...", "..."] }
      ]
    }
  }
}
```

## Dynamic Tabs & 6 Widget Types

Each entry in `tabs`:

```json
{
  "id": "bag",
  "label": "行囊",
  "unlocked": true,
  "sections": [
    {
      "id": "vitals",
      "title": "身手与气血",
      "type": "meters",
      "items": [
        { "name": "气血", "value": 86, "max": 100, "dangerBelow": 30 },
        { "name": "内息", "value": 64, "max": 100, "unit": "%" }
      ]
    }
  ]
}
```

### Widget item shapes

| `type` | `items[]` shape |
|---|---|
| `meters` | `{ "name": "氧气储备", "value": 42, "max": 100, "unit": "%", "dangerBelow": 25 }` |
| `stats` | `{ "label": "银两", "value": "14 两" }` |
| `tags` | `{ "name": "旧铜钱", "qty": 1, "badge": "关键", "meta": "背面刻有极细的断江暗纹" }` |
| `entities` | `{ "name": "老摊主", "role": "偏巷杂货商", "status": "戒备", "note": "曾提及东边来的断江剑" }` |
| `timeline` | `{ "tag": "戌时", "title": "六扇门戒严", "detail": "东面聚宝门盘查骤紧", "status": "待查" }` |
| `notes` | `{ "title": "烂柯巷密笺", "body": "子时三刻，只见旧钱不见人。" }` |

## Runtime `updates[]` Operations (used in `<<<GAME_STATE>>>` and `demoScript`)

Every operation references a unique `section` id (or `tabId` for tab-level operations):

| `op` | Fields | Effect |
|---|---|---|
| `delta` | `section`, `key`, `value` | Adds signed number to matching meter item (clamped `0..max`) |
| `set_meter` | `section`, `key`, `value` | Sets exact value on matching meter item |
| `set_stat` | `section`, `key`, `value` | Updates or inserts a key-value stat cell |
| `add_tag` | `section`, `item: {name, qty?, badge?, meta?}` | Adds item or increments `qty` if present |
| `remove_tag` | `section`, `name` | Removes matching item by name |
| `upsert_entity` | `section`, `entity: {name, role?, status?, note?}` | Updates existing entity or adds a new one at top |
| `add_log` | `section`, `entry: {tag, title, detail, status?}` | Prepends or updates a timeline/clue entry |
| `add_note` | `section`, `note: {title, body}` | Prepends a note block |
| `unlock_tab` | `tabId`, `label?` | Reveals a hidden `"unlocked": false` tab and highlights it |
| `add_tab` | `tab: {id, label, sections: [...]}` | Dynamically creates a brand-new tab mid-story |
