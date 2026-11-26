/* Wenyou Runtime Engine — dynamic story tabs, streaming SSE, state snapshots, multi-slot saves */
(function () {
  "use strict";

  const STORY = window.__WENYOU_STORY__;
  const THEMES = window.__WENYOU_THEMES__ || {};
  if (!STORY) {
    document.body.innerHTML = "<p style='padding:24px'>Missing story blueprint.</p>";
    return;
  }

  const STORAGE_PREFIX = "wenyou_v1_" + (STORY.id || "default");
  const API_STORAGE_KEY = "wenyou_v1_api_config";
  const SAVE_SLOTS_KEY = STORAGE_PREFIX + "_saves";
  const AUTOSAVE_KEY = STORAGE_PREFIX + "_autosave";

  const LENGTH_PRESETS = [
    { id: "brief", label: "精炼（约 300 字）", target: "250-350 字，节奏干脆" },
    { id: "standard", label: "标准（约 450 字）", target: "400-500 字，兼顾画面与推进" },
    { id: "rich", label: "丰富（约 650 字）", target: "600-750 字，细节饱满有临场感" },
    { id: "novel", label: "长篇（约 1000 字）", target: "900-1100 字，强氛围文学描写" }
  ];

  const API_PRESETS = [
    { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
    { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-chat-v3-0324" },
    { name: "Ollama 本地", baseUrl: "http://localhost:11434/v1", model: "qwen2.5:14b" }
  ];

  const THEME_META = [
    { id: "ink-scroll", name: "水墨笺纸", desc: "武侠 · 古风 · 志怪" },
    { id: "dossier", name: "旧档案", desc: "民国 · 探案 · 克苏鲁" },
    { id: "terminal", name: "冷光终端", desc: "硬科幻 · 赛博 · 废土" },
    { id: "editorial", name: "现代出版物", desc: "都市 · 悬疑 · 职场" },
    { id: "parchment-night", name: "暗夜书房", desc: "西幻 · 权谋 · 哥特" }
  ];

  function deepClone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatProseHtml(text) {
    const clean = String(text || "").trim();
    if (!clean) return "";
    return clean
      .split(/\n{2,}/)
      .map((para) => {
        const lines = para.split("\n").map((l) => esc(l.trim())).filter(Boolean).join("<br>");
        return lines ? `<p>${lines}</p>` : "";
      })
      .filter(Boolean)
      .join("");
  }

  function uiText(key, fallback) {
    return (STORY.ui && STORY.ui[key]) || fallback;
  }

  function loadApiConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(API_STORAGE_KEY) || "null");
      if (saved && typeof saved === "object") {
        return Object.assign(
          {
            baseUrl: "https://api.deepseek.com/v1",
            apiKey: "",
            model: "deepseek-chat",
            temperature: 0.85,
            contextTurns: 10,
            offlineMode: true
          },
          saved
        );
      }
    } catch (_) {}
    return {
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "",
      model: "deepseek-chat",
      temperature: 0.85,
      contextTurns: 10,
      offlineMode: true
    };
  }

  function saveApiConfig(cfg) {
    try {
      localStorage.setItem(API_STORAGE_KEY, JSON.stringify(cfg));
    } catch (_) {}
  }

  function createInitialState() {
    const tabs = deepClone(STORY.tabs || []).map((t) =>
      Object.assign({ unlocked: true, sections: [] }, t)
    );
    const firstUnlocked = tabs.find((t) => t.unlocked !== false);
    const opening = STORY.opening || {};
    return {
      scene: opening.scene || STORY.initialScene || "",
      time: opening.time || STORY.initialTime || "",
      tabs,
      activeTabId: firstUnlocked ? firstUnlocked.id : "",
      freshTabId: "",
      turns: [
        {
          id: "turn_0",
          index: 1,
          playerAction: "",
          prose: opening.prose || "",
          scene: opening.scene || "",
          time: opening.time || "",
          changes: [],
          choices: deepClone(opening.choices || []),
          stateBefore: null
        }
      ],
      memories: deepClone(STORY.initialMemories || []),
      storySettings: {
        worldview: (STORY.prompt && STORY.prompt.worldview) || "",
        protagonist: (STORY.prompt && STORY.prompt.protagonist) || "",
        style: (STORY.prompt && STORY.prompt.style) || "",
        customRules: (STORY.prompt && STORY.prompt.customRules) || ""
      },
      preferences: {
        lengthId: (STORY.ui && STORY.ui.defaultLength) || "rich",
        autoSettle: true,
        choicesHidden: false,
        themeId: STORY.theme || "editorial",
        proseFont: "default",
        proseSizeDelta: 0
      },
      demoStep: 0
    };
  }

  let apiConfig = loadApiConfig();
  let state = loadAutosave() || createInitialState();
  let isStreaming = false;
  let abortController = null;
  let toastTimer = null;

  function loadAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.turns) && Array.isArray(parsed.tabs)) {
        return parsed;
      }
    } catch (_) {}
    return null;
  }

  function persistAutosave() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  // DOM refs
  const $ = (id) => document.getElementById(id);
  const el = {
    menuBtn: $("wy-menu-btn"),
    storyTitle: $("wy-story-title"),
    headerScene: $("wy-header-scene"),
    immersiveBtn: $("wy-immersive-btn"),
    saveBtn: $("wy-save-btn"),
    settingsBtn: $("wy-settings-btn"),
    sidebarLabel: $("wy-sidebar-label"),
    sidebarClose: $("wy-sidebar-close"),
    tabBar: $("wy-tab-bar"),
    tabBody: $("wy-tab-body"),
    fontToggle: $("wy-font-toggle"),
    sizeDown: $("wy-size-down"),
    sizeUp: $("wy-size-up"),
    modePill: $("wy-mode-pill"),
    stream: $("wy-stream"),
    streamInner: $("wy-stream-inner"),
    dockHeading: $("wy-dock-heading"),
    retryBtn: $("wy-retry-btn"),
    deleteBtn: $("wy-delete-btn"),
    lengthSelect: $("wy-length-select"),
    autoSettle: $("wy-auto-settle"),
    autoSettleText: $("wy-auto-settle-text"),
    toggleChoices: $("wy-toggle-choices"),
    choicesBox: $("wy-choices"),
    input: $("wy-input"),
    sendBtn: $("wy-send-btn"),
    backdrop: $("wy-backdrop"),
    immersivePeek: $("wy-immersive-peek"),
    immersiveExit: $("wy-immersive-exit"),
    saveModal: $("wy-save-modal"),
    saveList: $("wy-save-list"),
    settingsModal: $("wy-settings-modal"),
    settingsBody: $("wy-settings-body"),
    settingsTabs: $("wy-settings-tabs"),
    toast: $("wy-toast"),
    themeStyle: $("wy-theme-style"),
    customStyle: $("wy-custom-style")
  };

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("is-show"), 2200);
  }

  function applyTheme(themeId) {
    const css = THEMES[themeId] || THEMES[STORY.theme] || "";
    el.themeStyle.textContent = css;
    if (STORY.themeOverrides && themeId === STORY.theme) {
      const vars = Object.entries(STORY.themeOverrides)
        .map(([k, v]) => `${k}: ${v};`)
        .join(" ");
      el.customStyle.textContent = vars ? `:root { ${vars} }` : "";
    } else {
      el.customStyle.textContent = "";
    }
    document.body.classList.remove("prose-sans", "prose-serif");
    if (state.preferences.proseFont === "sans") document.body.classList.add("prose-sans");
    if (state.preferences.proseFont === "serif") document.body.classList.add("prose-serif");
    const baseSize = 16.5 + (state.preferences.proseSizeDelta || 0);
    document.documentElement.style.setProperty("--wy-prose-size", baseSize + "px");
  }

  function formatTurnCounter(num) {
    const fmt = uiText("turnPrefix", "第 {n} 回");
    return fmt
      .replace("{00n}", String(num).padStart(3, "0"))
      .replace("{0n}", String(num).padStart(2, "0"))
      .replace("{n}", String(num));
  }

  function renderHeader() {
    el.storyTitle.textContent = STORY.title || "文游";
    const parts = [state.scene, state.time].filter(Boolean);
    el.headerScene.textContent = parts.join(" · ");
    el.sidebarLabel.textContent = uiText("drawerTitle", "故事卷宗");
    el.dockHeading.textContent = uiText("interactLabel", "互动");
    el.autoSettleText.textContent = uiText("autoSettleLabel", "自动结算");
    el.input.placeholder = uiText("inputPlaceholder", "写下你想做的事… (Enter 发送)");

    const isLive = Boolean(apiConfig.apiKey && !apiConfig.offlineMode);
    el.modePill.textContent = isLive ? apiConfig.model : "离线试玩";
    el.modePill.classList.toggle("is-live", isLive);
  }

  function renderSidebar() {
    const visibleTabs = state.tabs.filter((t) => t.unlocked !== false);
    if (!visibleTabs.some((t) => t.id === state.activeTabId) && visibleTabs.length) {
      state.activeTabId = visibleTabs[0].id;
    }

    el.tabBar.innerHTML = visibleTabs
      .map((tab) => {
        const active = tab.id === state.activeTabId ? "is-active" : "";
        const fresh = tab.id === state.freshTabId && tab.id !== state.activeTabId ? "is-fresh" : "";
        return `<button class="wy-tab-btn ${active} ${fresh}" data-tab-id="${esc(tab.id)}">${esc(tab.label)}</button>`;
      })
      .join("");

    const activeTab = visibleTabs.find((t) => t.id === state.activeTabId);
    if (!activeTab) {
      el.tabBody.innerHTML = `<div class="wy-empty">暂无面板</div>`;
      return;
    }

    el.tabBody.innerHTML = (activeTab.sections || []).map(renderSection).join("") || `<div class="wy-empty">暂无记录</div>`;
  }

  function renderSection(sec) {
    let body = "";
    if (sec.type === "meters") {
      const items = sec.items || [];
      body = items.length
        ? `<div class="wy-meter-list">${items
            .map((m) => {
              const max = Number(m.max) || 100;
              const val = Math.max(0, Math.min(max, Number(m.value) || 0));
              const pct = Math.round((val / max) * 100);
              const danger = m.dangerBelow != null && val <= Number(m.dangerBelow);
              const unit = m.unit ? m.unit : `/${max}`;
              return `<div>
                <div class="wy-meter-head">
                  <span class="wy-meter-name">${esc(m.name)}</span>
                  <span class="wy-meter-val">${esc(val)}${esc(unit)}</span>
                </div>
                <div class="wy-meter-track"><div class="wy-meter-fill ${danger ? "is-danger" : ""}" style="width:${pct}%"></div></div>
              </div>`;
            })
            .join("")}</div>`
        : `<div class="wy-empty">暂无数值</div>`;
    } else if (sec.type === "stats") {
      const items = sec.items || [];
      body = items.length
        ? `<div class="wy-stats-grid">${items
            .map(
              (s) => `<div class="wy-stat-cell">
              <div class="wy-stat-label">${esc(s.label)}</div>
              <div class="wy-stat-val">${esc(s.value)}</div>
            </div>`
            )
            .join("")}</div>`
        : `<div class="wy-empty">暂无数据</div>`;
    } else if (sec.type === "tags") {
      const items = sec.items || [];
      body = items.length
        ? `<div class="wy-tag-list">${items
            .map(
              (t) => `<div class="wy-tag-card">
              <div class="wy-tag-top">
                <span class="wy-tag-name">${esc(t.name)}</span>
                ${t.qty != null ? `<span class="wy-tag-qty">×${esc(t.qty)}</span>` : t.badge ? `<span class="wy-tag-qty">${esc(t.badge)}</span>` : ""}
              </div>
              ${t.meta ? `<div class="wy-tag-meta">${esc(t.meta)}</div>` : ""}
            </div>`
            )
            .join("")}</div>`
        : `<div class="wy-empty">空空如也</div>`;
    } else if (sec.type === "entities") {
      const items = sec.items || [];
      body = items.length
        ? `<div class="wy-entity-list">${items
            .map(
              (e) => `<div class="wy-entity-card">
              <div class="wy-entity-head">
                <span class="wy-entity-name">${esc(e.name)}</span>
                ${e.status ? `<span class="wy-entity-status">${esc(e.status)}</span>` : ""}
              </div>
              ${e.role ? `<div class="wy-entity-role">${esc(e.role)}</div>` : ""}
              ${e.note ? `<div class="wy-entity-note">${esc(e.note)}</div>` : ""}
            </div>`
            )
            .join("")}</div>`
        : `<div class="wy-empty">尚未结识</div>`;
    } else if (sec.type === "timeline") {
      const items = sec.items || [];
      body = items.length
        ? `<div class="wy-timeline">${items
            .map(
              (l) => `<div class="wy-log-item">
              <div class="wy-log-head">
                <span class="wy-log-tag">${esc(l.tag || "")}</span>
                ${l.status ? `<span class="wy-log-status">${esc(l.status)}</span>` : ""}
              </div>
              <div class="wy-log-title">${esc(l.title)}</div>
              ${l.detail ? `<div class="wy-log-detail">${esc(l.detail)}</div>` : ""}
            </div>`
            )
            .join("")}</div>`
        : `<div class="wy-empty">尚无线索</div>`;
    } else if (sec.type === "notes") {
      const items = sec.items || [];
      body = items.length
        ? `<div class="wy-note-list">${items
            .map(
              (n) => `<div class="wy-note-card">
              ${n.title ? `<div class="wy-note-title">${esc(n.title)}</div>` : ""}
              <div>${esc(n.body)}</div>
            </div>`
            )
            .join("")}</div>`
        : `<div class="wy-empty">暂无摘录</div>`;
    }

    return `<section class="wy-section">
      ${sec.title ? `<h3 class="wy-section-title"><span>${esc(sec.title)}</span></h3>` : ""}
      ${body}
    </section>`;
  }

  function renderStream(scrollToBottom) {
    const intro = `
      <div class="wy-opening-banner">
        ${STORY.genreLabel ? `<div class="wy-opening-kicker">${esc(STORY.genreLabel)}</div>` : ""}
        <h2 class="wy-opening-title">${esc(STORY.title)}</h2>
        ${STORY.subtitle ? `<p class="wy-opening-sub">${esc(STORY.subtitle)}</p>` : ""}
      </div>
    `;

    const turnsHtml = state.turns
      .map((turn, idx) => {
        const playerHtml = turn.playerAction
          ? `<div class="wy-player-row"><div class="wy-player-bubble">${esc(turn.playerAction)}</div></div>`
          : "";
        const sceneStamp = [turn.scene, turn.time].filter(Boolean).join(" · ");
        const metaText = sceneStamp ? `${formatTurnCounter(idx + 1)} · ${sceneStamp}` : formatTurnCounter(idx + 1);
        const changesHtml =
          turn.changes && turn.changes.length
            ? `<button class="wy-settle-bar" data-open-tab="${esc(turn.changedTabId || "")}">
                <span>已结算</span>
                ${turn.changes.map((c) => `<span class="wy-settle-chip">${esc(c)}</span>`).join("")}
              </button>`
            : "";
        return `<article class="wy-turn" data-turn-idx="${idx}">
          ${playerHtml}
          <div class="wy-turn-meta"><span class="wy-turn-badge">${esc(metaText)}</span></div>
          <div class="wy-prose">${formatProseHtml(turn.prose)}</div>
          ${changesHtml}
        </article>`;
      })
      .join("");

    el.streamInner.innerHTML = intro + turnsHtml;
    if (scrollToBottom) {
      el.stream.scrollTop = el.stream.scrollHeight;
    }
  }

  function renderDock() {
    const canRollback = state.turns.length > 1 && !isStreaming;
    el.retryBtn.disabled = !canRollback;
    el.deleteBtn.disabled = !canRollback;
    el.autoSettle.checked = Boolean(state.preferences.autoSettle);
    el.lengthSelect.value = state.preferences.lengthId || "rich";
    el.toggleChoices.textContent = state.preferences.choicesHidden ? "展开选项" : "收起选项";
    el.choicesBox.classList.toggle("is-hidden", Boolean(state.preferences.choicesHidden));

    const lastTurn = state.turns[state.turns.length - 1];
    const choices = (lastTurn && lastTurn.choices) || [];
    el.choicesBox.innerHTML = choices
      .slice(0, 3)
      .map(
        (c, i) => `<button class="wy-choice-card" data-choice-idx="${i}" ${isStreaming ? "disabled" : ""}>
          <span class="wy-choice-index">${i + 1}</span>
          <span class="wy-choice-text">${esc(c)}</span>
        </button>`
      )
      .join("");

    if (isStreaming) {
      el.sendBtn.textContent = "停止";
      el.sendBtn.classList.remove("wy-btn--primary");
      el.sendBtn.classList.add("wy-btn--danger");
    } else {
      el.sendBtn.textContent = uiText("sendLabel", "发送");
      el.sendBtn.classList.add("wy-btn--primary");
      el.sendBtn.classList.remove("wy-btn--danger");
    }
  }

  function renderAll(scrollToBottom) {
    applyTheme(state.preferences.themeId || STORY.theme);
    renderHeader();
    renderSidebar();
    renderStream(scrollToBottom);
    renderDock();
  }

  // Apply dynamic state operations from <<<GAME_STATE>>>
  function findSection(sectionId) {
    for (const tab of state.tabs) {
      for (const sec of tab.sections || []) {
        if (sec.id === sectionId) return { tab, sec };
      }
    }
    return null;
  }

  function applyStateUpdates(payload) {
    const changes = [];
    let firstChangedTabId = "";

    if (payload.scene && payload.scene !== state.scene) {
      state.scene = payload.scene;
      changes.push(`场景 → ${payload.scene}`);
    }
    if (payload.time) {
      state.time = payload.time;
    }
    if (payload.summary) {
      state.memories.push({
        turn: state.turns.length,
        text: String(payload.summary).trim()
      });
    }

    if (!state.preferences.autoSettle || !Array.isArray(payload.updates)) {
      return { changes, firstChangedTabId };
    }

    for (const op of payload.updates) {
      if (!op || !op.op) continue;

      if (op.op === "unlock_tab") {
        const t = state.tabs.find((x) => x.id === op.tabId);
        if (t && t.unlocked === false) {
          t.unlocked = true;
          if (op.label) t.label = op.label;
          state.freshTabId = t.id;
          if (!firstChangedTabId) firstChangedTabId = t.id;
          changes.push(`解锁页签「${t.label}」`);
        }
        continue;
      }

      if (op.op === "add_tab" && op.tab && op.tab.id && op.tab.label) {
        if (!state.tabs.some((x) => x.id === op.tab.id)) {
          const newTab = Object.assign({ unlocked: true, sections: [] }, deepClone(op.tab));
          state.tabs.push(newTab);
          state.freshTabId = newTab.id;
          if (!firstChangedTabId) firstChangedTabId = newTab.id;
          changes.push(`新增页签「${newTab.label}」`);
        }
        continue;
      }

      const target = findSection(op.section);
      if (!target) continue;
      const { tab, sec } = target;
      if (!firstChangedTabId) firstChangedTabId = tab.id;
      if (tab.id !== state.activeTabId) state.freshTabId = tab.id;

      if (op.op === "delta" && sec.type === "meters") {
        const item = (sec.items || []).find((m) => m.name === op.key);
        const delta = Number(op.value) || 0;
        if (item && delta !== 0) {
          const max = Number(item.max) || 100;
          item.value = Math.max(0, Math.min(max, (Number(item.value) || 0) + delta));
          changes.push(`${item.name} ${delta > 0 ? "+" : ""}${delta}`);
        }
      } else if (op.op === "set_meter" && sec.type === "meters") {
        const item = (sec.items || []).find((m) => m.name === op.key);
        if (item) {
          const max = Number(item.max) || 100;
          item.value = Math.max(0, Math.min(max, Number(op.value) || 0));
          changes.push(`${item.name} → ${item.value}`);
        }
      } else if (op.op === "set_stat" && sec.type === "stats") {
        sec.items = sec.items || [];
        const item = sec.items.find((s) => s.label === op.key);
        if (item) {
          item.value = String(op.value);
        } else {
          sec.items.push({ label: String(op.key), value: String(op.value) });
        }
        changes.push(`${op.key} → ${op.value}`);
      } else if (op.op === "add_tag" && sec.type === "tags" && op.item && op.item.name) {
        sec.items = sec.items || [];
        const existing = sec.items.find((x) => x.name === op.item.name);
        if (existing) {
          if (existing.qty != null) existing.qty = Number(existing.qty) + (Number(op.item.qty) || 1);
          if (op.item.meta) existing.meta = op.item.meta;
        } else {
          sec.items.unshift(deepClone(op.item));
        }
        changes.push(`获得「${op.item.name}」`);
      } else if (op.op === "remove_tag" && sec.type === "tags" && op.name) {
        sec.items = (sec.items || []).filter((x) => x.name !== op.name);
        changes.push(`失去「${op.name}」`);
      } else if (op.op === "upsert_entity" && sec.type === "entities" && op.entity && op.entity.name) {
        sec.items = sec.items || [];
        const existing = sec.items.find((x) => x.name === op.entity.name);
        if (existing) {
          Object.assign(existing, op.entity);
          changes.push(`${op.entity.name}：${op.entity.status || "已更新"}`);
        } else {
          sec.items.unshift(deepClone(op.entity));
          changes.push(`记录人物「${op.entity.name}」`);
        }
      } else if (op.op === "add_log" && sec.type === "timeline" && op.entry && op.entry.title) {
        sec.items = sec.items || [];
        const existing = sec.items.find((x) => x.title === op.entry.title);
        if (existing) {
          Object.assign(existing, op.entry);
        } else {
          sec.items.unshift(deepClone(op.entry));
        }
        changes.push(`记录「${op.entry.title}」`);
      } else if (op.op === "add_note" && sec.type === "notes" && op.note && op.note.body) {
        sec.items = sec.items || [];
        sec.items.unshift(deepClone(op.note));
        changes.push(`新增摘录「${op.note.title || "笔记"}」`);
      }
    }

    return { changes, firstChangedTabId };
  }

  function buildSystemPrompt() {
    const lenPreset = LENGTH_PRESETS.find((x) => x.id === state.preferences.lengthId) || LENGTH_PRESETS[2];
    const schemaSummary = state.tabs.map((t) => ({
      tabId: t.id,
      label: t.label,
      unlocked: t.unlocked !== false,
      sections: (t.sections || []).map((s) => ({
        sectionId: s.id,
        title: s.title,
        type: s.type,
        items: s.items
      }))
    }));
    const memoryText = state.memories.length
      ? state.memories.map((m) => `- [第${m.turn}回] ${m.text}`).join("\n")
      : "（刚开局）";

    return [
      `你是互动文字游戏《${STORY.title}》的叙事主持人（GM）。`,
      state.storySettings.worldview ? `【世界观】\n${state.storySettings.worldview}` : "",
      state.storySettings.protagonist ? `【主角设定】\n${state.storySettings.protagonist}` : "",
      state.storySettings.style ? `【文风要求】\n${state.storySettings.style}` : "",
      state.storySettings.customRules ? `【额外规则】\n${state.storySettings.customRules}` : "",
      `【当前场景】${state.scene} · ${state.time}`,
      `【已发生剧情记忆】\n${memoryText}`,
      `【当前动态页签与状态（JSON）】\n${JSON.stringify(schemaSummary)}`,
      `【本回合篇幅】${lenPreset.target}。只输出沉浸式叙事正文，不写 Markdown 标题，不跳戏。`,
      `【必须遵守的结尾协议】`,
      `正文写完后，另起一行严格输出以下结构化结算块（合法 JSON，不能有注释或尾逗号）：`,
      `<<<GAME_STATE>>>`,
      `{`,
      `  "scene": "最新地点名",`,
      `  "time": "最新时间与氛围",`,
      `  "summary": "本回合一句话剧情摘要",`,
      `  "updates": [`,
      `    {"op": "delta", "section": "对应meters的sectionId", "key": "指标名", "value": -5},`,
      `    {"op": "set_stat", "section": "对应stats的sectionId", "key": "标签", "value": "新值"},`,
      `    {"op": "add_tag", "section": "对应tags的sectionId", "item": {"name": "物品名", "meta": "简述", "qty": 1}},`,
      `    {"op": "remove_tag", "section": "对应tags的sectionId", "name": "物品名"},`,
      `    {"op": "upsert_entity", "section": "对应entities的sectionId", "entity": {"name": "名", "role": "身份", "status": "态度", "note": "备注"}},`,
      `    {"op": "add_log", "section": "对应timeline的sectionId", "entry": {"tag": "时间/编号", "title": "标题", "detail": "内容", "status": "待查"}},`,
      `    {"op": "unlock_tab", "tabId": "隐藏页签id"},`,
      `    {"op": "add_tab", "tab": {"id": "new_tab", "label": "新页签", "sections": [{"id": "s1", "title": "标题", "type": "notes", "items": [{"title": "标题", "body": "内容"}]}]}}`,
      `  ],`,
      `  "choices": ["具体行动选项1（20-45字）", "具体行动选项2", "具体行动选项3"]`,
      `}`,
      `<<<END_GAME_STATE>>>`,
      `注意：updates 只写本回合真实发生的变化；没有变化则传空数组 []。choices 必须给 3 个风格鲜明、有代价或风险差异的行动。`
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  function parseGameStateBlock(fullText) {
    const marker = "<<<GAME_STATE>>>";
    const endMarker = "<<<END_GAME_STATE>>>";
    const startIdx = fullText.indexOf(marker);
    if (startIdx === -1) {
      return { prose: fullText.trim(), payload: null };
    }
    const prose = fullText.slice(0, startIdx).trim();
    let jsonStr = fullText.slice(startIdx + marker.length);
    const endIdx = jsonStr.indexOf(endMarker);
    if (endIdx !== -1) jsonStr = jsonStr.slice(0, endIdx);
    jsonStr = jsonStr.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

    try {
      return { prose, payload: JSON.parse(jsonStr) };
    } catch (_) {
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return { prose, payload: JSON.parse(match[0]) };
        } catch (__) {}
      }
      return { prose, payload: null };
    }
  }

  function buildMessages(playerAction) {
    const maxTurns = Math.max(2, Number(apiConfig.contextTurns) || 10);
    const recent = state.turns.slice(-maxTurns);
    const msgs = [{ role: "system", content: buildSystemPrompt() }];
    for (const t of recent) {
      if (t.playerAction) msgs.push({ role: "user", content: t.playerAction });
      if (t.prose) msgs.push({ role: "assistant", content: t.prose });
    }
    msgs.push({ role: "user", content: playerAction });
    return msgs;
  }

  function pickDemoResponse(actionText, choiceIndex) {
    const demo = STORY.demoScript || {};
    const stepKey = String(state.demoStep);
    const branches = demo.branches || {};
    let picked = null;
    if (branches[stepKey] && Array.isArray(branches[stepKey])) {
      picked = branches[stepKey][choiceIndex != null ? choiceIndex : 0] || branches[stepKey][0];
    } else if (branches[stepKey]) {
      picked = branches[stepKey];
    }
    if (picked) {
      state.demoStep += 1;
      return deepClone(picked);
    }
    return {
      scene: state.scene,
      time: state.time,
      prose: `你顺着自己的判断采取了行动：「${actionText}」。\n\n四周的空气微微一滞，方才暗流涌动的局势因你这一步显出新的裂口。当前正处于「离线试玩模式」，演示剧本已告一段落。\n\n点击右上角「接口」，填入 DeepSeek 或任意 OpenAI 兼容 API Key，即可让 AI 接管当前全部动态页签、记忆与剧情，无限续写下去。`,
      summary: `玩家尝试了自定义行动：${actionText.slice(0, 24)}`,
      updates: [],
      choices: [
        "打开右上角「接口」配置 DeepSeek / OpenAI，继续真实游玩",
        "点击「重来」或「删掉本回合」，体验精确状态回滚",
        "点击「存档」，将当前进度导出为 JSON 文件"
      ]
    };
  }

  async function streamDemoTurn(demoResp, onChunk, signal) {
    const text = demoResp.prose || "";
    let i = 0;
    while (i < text.length) {
      if (signal.aborted) break;
      const step = Math.min(text.length, i + 4);
      i = step;
      onChunk(text.slice(0, i), false);
      await new Promise((r) => setTimeout(r, 16));
    }
    return {
      prose: text,
      payload: {
        scene: demoResp.scene || state.scene,
        time: demoResp.time || state.time,
        summary: demoResp.summary || "",
        updates: demoResp.updates || [],
        choices: demoResp.choices || []
      }
    };
  }

  async function streamLiveTurn(playerAction, onChunk, signal) {
    const url = apiConfig.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiConfig.apiKey
      },
      body: JSON.stringify({
        model: apiConfig.model,
        temperature: Number(apiConfig.temperature) || 0.85,
        stream: true,
        messages: buildMessages(playerAction)
      }),
      signal
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 180)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
          if (delta) {
            fullText += delta;
            const cut = fullText.indexOf("<<<GAME_STATE");
            if (cut !== -1) {
              onChunk(fullText.slice(0, cut), true);
            } else {
              onChunk(fullText, false);
            }
          }
        } catch (_) {}
      }
    }

    return parseGameStateBlock(fullText);
  }

  async function submitAction(actionText, choiceIndex) {
    const cleanAction = String(actionText || "").trim();
    if (!cleanAction || isStreaming) return;

    const snapshot = {
      scene: state.scene,
      time: state.time,
      tabs: deepClone(state.tabs),
      activeTabId: state.activeTabId,
      memories: deepClone(state.memories),
      demoStep: state.demoStep
    };

    const newTurn = {
      id: "turn_" + Date.now(),
      index: state.turns.length + 1,
      playerAction: cleanAction,
      prose: "",
      scene: state.scene,
      time: state.time,
      changes: [],
      changedTabId: "",
      choices: [],
      stateBefore: snapshot
    };

    state.turns.push(newTurn);
    el.input.value = "";
    autoResizeTextarea();
    isStreaming = true;
    abortController = new AbortController();

    renderStream(true);
    renderDock();

    const turnEl = el.streamInner.querySelector(`[data-turn-idx="${state.turns.length - 1}"]`);
    const proseEl = turnEl ? turnEl.querySelector(".wy-prose") : null;
    let settlingEl = null;

    const updateProseDom = (partial, isSettling) => {
      if (!proseEl) return;
      proseEl.innerHTML = formatProseHtml(partial) + (isSettling ? "" : '<span class="wy-cursor"></span>');
      if (isSettling && !settlingEl && turnEl) {
        settlingEl = document.createElement("div");
        settlingEl.className = "wy-settling-note";
        settlingEl.textContent = "正在结算状态与选项…";
        turnEl.appendChild(settlingEl);
      }
      if (el.stream.scrollHeight - el.stream.scrollTop - el.stream.clientHeight < 140) {
        el.stream.scrollTop = el.stream.scrollHeight;
      }
    };

    try {
      const useLive = Boolean(apiConfig.apiKey && !apiConfig.offlineMode);
      let result;
      if (useLive) {
        result = await streamLiveTurn(cleanAction, updateProseDom, abortController.signal);
      } else {
        const demoResp = pickDemoResponse(cleanAction, choiceIndex);
        result = await streamDemoTurn(demoResp, updateProseDom, abortController.signal);
      }

      newTurn.prose = result.prose || "（本回合未返回正文）";
      if (result.payload) {
        const { changes, firstChangedTabId } = applyStateUpdates(result.payload);
        newTurn.scene = state.scene;
        newTurn.time = state.time;
        newTurn.changes = changes;
        newTurn.changedTabId = firstChangedTabId;
        newTurn.choices = Array.isArray(result.payload.choices) && result.payload.choices.length
          ? result.payload.choices
          : ["继续观察四周动静", "与眼前之人深入交谈", "暂且退避，另寻良机"];
      } else {
        newTurn.choices = ["继续推进当前局势", "停下来细查周遭细节", "换个方向试探"];
      }
    } catch (err) {
      if (err.name === "AbortError") {
        newTurn.prose = newTurn.prose || "（已手动停止生成）";
        newTurn.choices = state.turns[state.turns.length - 2].choices || [];
        showToast("已停止生成");
      } else {
        state.turns.pop();
        showToast("请求失败：" + err.message);
      }
    } finally {
      isStreaming = false;
      abortController = null;
      persistAutosave();
      renderAll(true);
    }
  }

  function rollbackLastTurn() {
    if (state.turns.length <= 1 || isStreaming) return null;
    const removed = state.turns.pop();
    if (removed && removed.stateBefore) {
      state.scene = removed.stateBefore.scene;
      state.time = removed.stateBefore.time;
      state.tabs = deepClone(removed.stateBefore.tabs);
      state.activeTabId = removed.stateBefore.activeTabId;
      state.memories = deepClone(removed.stateBefore.memories);
      state.demoStep = removed.stateBefore.demoStep;
      state.freshTabId = "";
    }
    persistAutosave();
    return removed;
  }

  // Save / Load management
  function getSaveSlots() {
    try {
      return JSON.parse(localStorage.getItem(SAVE_SLOTS_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function setSaveSlots(slots) {
    try {
      localStorage.setItem(SAVE_SLOTS_KEY, JSON.stringify(slots));
    } catch (_) {}
  }

  function openSaveModal() {
    renderSaveSlots();
    el.saveModal.classList.add("is-open");
  }

  function renderSaveSlots() {
    const slots = getSaveSlots();
    const ids = ["slot_1", "slot_2", "slot_3", "slot_4", "slot_5"];
    el.saveList.innerHTML = ids
      .map((id, idx) => {
        const s = slots[id];
        const meta = s
          ? `第 ${s.turnCount} 回 · ${s.scene || "未知场景"} · ${s.savedAt}`
          : "空槽位";
        return `<div class="wy-slot-card">
          <div class="wy-slot-info">
            <div class="wy-slot-name">档案槽 ${idx + 1}</div>
            <div class="wy-slot-meta">${esc(meta)}</div>
          </div>
          <div class="wy-slot-actions">
            <button class="wy-btn wy-btn--compact" data-slot-save="${id}">${s ? "覆盖" : "存入"}</button>
            ${s ? `<button class="wy-btn wy-btn--compact wy-btn--primary" data-slot-load="${id}">读取</button>` : ""}
            ${s ? `<button class="wy-btn wy-btn--compact wy-btn--danger" data-slot-del="${id}">删</button>` : ""}
          </div>
        </div>`;
      })
      .join("");
  }

  // Settings Modal
  let activeSettingsTab = "api";

  function openSettingsModal(tab) {
    activeSettingsTab = tab || "api";
    renderSettingsModal();
    el.settingsModal.classList.add("is-open");
  }

  function renderSettingsModal() {
    const tabs = [
      { id: "api", label: "模型接口" },
      { id: "story", label: "世界与设定" },
      { id: "memory", label: "剧情记忆" },
      { id: "theme", label: "外观皮肤" }
    ];
    el.settingsTabs.innerHTML = tabs
      .map(
        (t) =>
          `<button class="wy-tab-btn ${t.id === activeSettingsTab ? "is-active" : ""}" data-settings-tab="${t.id}">${t.label}</button>`
      )
      .join("");

    if (activeSettingsTab === "api") {
      el.settingsBody.innerHTML = `
        <div class="wy-field">
          <label>快捷预设</label>
          <div class="wy-preset-row">
            ${API_PRESETS.map((p, i) => `<button class="wy-btn wy-btn--compact" data-api-preset="${i}">${esc(p.name)}</button>`).join("")}
          </div>
        </div>
        <div class="wy-field">
          <label for="cfg-url">Base URL（OpenAI 兼容接口）</label>
          <input id="cfg-url" class="wy-input" value="${esc(apiConfig.baseUrl)}" placeholder="https://api.deepseek.com/v1" />
        </div>
        <div class="wy-field">
          <label for="cfg-key">API Key（仅存本机浏览器 localStorage，不上传第三方）</label>
          <input id="cfg-key" class="wy-input" type="password" value="${esc(apiConfig.apiKey)}" placeholder="sk-..." />
        </div>
        <div class="wy-row-2">
          <div class="wy-field">
            <label for="cfg-model">模型名称</label>
            <input id="cfg-model" class="wy-input" value="${esc(apiConfig.model)}" placeholder="deepseek-chat" />
          </div>
          <div class="wy-field">
            <label for="cfg-temp">随机度 Temperature（0.2 - 1.3）</label>
            <input id="cfg-temp" class="wy-input" type="number" step="0.05" min="0.1" max="1.5" value="${esc(apiConfig.temperature)}" />
          </div>
        </div>
        <div class="wy-row-2">
          <div class="wy-field">
            <label for="cfg-ctx">上下文保留回合数</label>
            <input id="cfg-ctx" class="wy-input" type="number" min="2" max="30" value="${esc(apiConfig.contextTurns)}" />
          </div>
          <div class="wy-field" style="justify-content:flex-end;">
            <label class="wy-check" style="height:34px;">
              <input id="cfg-offline" type="checkbox" ${apiConfig.offlineMode ? "checked" : ""} />
              <span>离线试玩模式（不消耗 API）</span>
            </label>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="cfg-save-api" class="wy-btn wy-btn--primary">保存接口配置</button>
          <button id="cfg-test-api" class="wy-btn">测试连接</button>
          <span id="cfg-test-msg" style="font-size:12px;color:var(--wy-text-muted);"></span>
        </div>
      `;
    } else if (activeSettingsTab === "story") {
      el.settingsBody.innerHTML = `
        <div class="wy-field">
          <label for="st-world">世界观</label>
          <textarea id="st-world" rows="3">${esc(state.storySettings.worldview)}</textarea>
        </div>
        <div class="wy-field">
          <label for="st-protag">主角档案</label>
          <textarea id="st-protag" rows="3">${esc(state.storySettings.protagonist)}</textarea>
        </div>
        <div class="wy-field">
          <label for="st-style">文风要求</label>
          <textarea id="st-style" rows="2">${esc(state.storySettings.style)}</textarea>
        </div>
        <div class="wy-field">
          <label for="st-rules">额外规则（自定义 System Prompt）</label>
          <textarea id="st-rules" rows="2">${esc(state.storySettings.customRules)}</textarea>
        </div>
        <div><button id="st-save" class="wy-btn wy-btn--primary">保存设定（下回合生效）</button></div>
      `;
    } else if (activeSettingsTab === "memory") {
      el.settingsBody.innerHTML = `
        <div style="display:flex;gap:6px;">
          <input id="mem-new" class="wy-input" placeholder="手动补充一条关键剧情记忆…" />
          <button id="mem-add" class="wy-btn wy-btn--primary">添加</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${
            state.memories.length
              ? state.memories
                  .map(
                    (m, i) => `<div class="wy-memory-item">
                    <span><strong>[第${m.turn}回]</strong> ${esc(m.text)}</span>
                    <button class="wy-mini-btn" data-mem-del="${i}">删</button>
                  </div>`
                  )
                  .join("")
              : `<div class="wy-empty">尚无提炼记忆，游玩推进后自动记录。</div>`
          }
        </div>
      `;
    } else if (activeSettingsTab === "theme") {
      el.settingsBody.innerHTML = `
        <div class="wy-theme-grid">
          ${THEME_META.map(
            (t) => `<button class="wy-theme-opt ${state.preferences.themeId === t.id ? "is-active" : ""}" data-pick-theme="${t.id}">
              <span class="wy-theme-opt-name">${esc(t.name)}${t.id === STORY.theme ? "（本故事推荐）" : ""}</span>
              <span class="wy-theme-opt-desc">${esc(t.desc)}</span>
            </button>`
          ).join("")}
        </div>
      `;
    }
  }

  function autoResizeTextarea() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(120, Math.max(40, el.input.scrollHeight)) + "px";
  }

  function initSelect() {
    el.lengthSelect.innerHTML = LENGTH_PRESETS.map(
      (p) => `<option value="${p.id}">${esc(p.label)}</option>`
    ).join("");
  }

  function bindEvents() {
    el.menuBtn.addEventListener("click", () => {
      if (window.innerWidth <= 900) {
        document.body.classList.toggle("drawer-open");
      } else {
        document.body.classList.toggle("sidebar-collapsed");
      }
    });

    el.sidebarClose.addEventListener("click", () => {
      document.body.classList.remove("drawer-open", "immersive-peek");
      if (window.innerWidth > 900 && !document.body.classList.contains("is-immersive")) {
        document.body.classList.add("sidebar-collapsed");
      }
    });

    el.backdrop.addEventListener("click", () => {
      document.body.classList.remove("drawer-open", "immersive-peek");
    });

    el.immersiveBtn.addEventListener("click", () => {
      document.body.classList.add("is-immersive");
      document.body.classList.remove("drawer-open", "immersive-peek");
    });

    el.immersiveExit.addEventListener("click", () => {
      document.body.classList.remove("is-immersive", "immersive-peek");
    });

    el.immersivePeek.addEventListener("click", () => {
      document.body.classList.toggle("immersive-peek");
    });

    el.tabBar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab-id]");
      if (!btn) return;
      state.activeTabId = btn.dataset.tabId;
      if (state.freshTabId === state.activeTabId) state.freshTabId = "";
      persistAutosave();
      renderSidebar();
    });

    el.streamInner.addEventListener("click", (e) => {
      const settle = e.target.closest("[data-open-tab]");
      if (!settle) return;
      const tabId = settle.dataset.openTab;
      if (tabId) state.activeTabId = tabId;
      state.freshTabId = "";
      renderSidebar();
      if (document.body.classList.contains("is-immersive")) {
        document.body.classList.add("immersive-peek");
      } else if (window.innerWidth <= 900) {
        document.body.classList.add("drawer-open");
      } else {
        document.body.classList.remove("sidebar-collapsed");
      }
    });

    el.choicesBox.addEventListener("click", (e) => {
      const card = e.target.closest("[data-choice-idx]");
      if (!card || isStreaming) return;
      const idx = Number(card.dataset.choiceIdx);
      const lastTurn = state.turns[state.turns.length - 1];
      const text = lastTurn && lastTurn.choices && lastTurn.choices[idx];
      if (text) submitAction(text, idx);
    });

    el.input.addEventListener("input", autoResizeTextarea);
    el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitAction(el.input.value, null);
      }
    });

    el.sendBtn.addEventListener("click", () => {
      if (isStreaming && abortController) {
        abortController.abort();
      } else {
        submitAction(el.input.value, null);
      }
    });

    el.retryBtn.addEventListener("click", () => {
      const removed = rollbackLastTurn();
      if (removed && removed.playerAction) {
        renderAll(true);
        submitAction(removed.playerAction, null);
      }
    });

    el.deleteBtn.addEventListener("click", () => {
      const removed = rollbackLastTurn();
      if (removed) {
        renderAll(true);
        showToast("已回退本回合与状态");
      }
    });

    el.lengthSelect.addEventListener("change", () => {
      state.preferences.lengthId = el.lengthSelect.value;
      persistAutosave();
    });

    el.autoSettle.addEventListener("change", () => {
      state.preferences.autoSettle = el.autoSettle.checked;
      persistAutosave();
    });

    el.toggleChoices.addEventListener("click", () => {
      state.preferences.choicesHidden = !state.preferences.choicesHidden;
      persistAutosave();
      renderDock();
    });

    el.fontToggle.addEventListener("click", () => {
      const order = ["default", "serif", "sans"];
      const next = order[(order.indexOf(state.preferences.proseFont || "default") + 1) % order.length];
      state.preferences.proseFont = next;
      el.fontToggle.textContent = next === "serif" ? "宋体" : next === "sans" ? "黑体" : "默认体";
      persistAutosave();
      applyTheme(state.preferences.themeId);
    });

    el.sizeDown.addEventListener("click", () => {
      state.preferences.proseSizeDelta = Math.max(-2.5, (state.preferences.proseSizeDelta || 0) - 1);
      persistAutosave();
      applyTheme(state.preferences.themeId);
    });

    el.sizeUp.addEventListener("click", () => {
      state.preferences.proseSizeDelta = Math.min(4, (state.preferences.proseSizeDelta || 0) + 1);
      persistAutosave();
      applyTheme(state.preferences.themeId);
    });

    el.saveBtn.addEventListener("click", openSaveModal);
    el.settingsBtn.addEventListener("click", () => openSettingsModal("api"));
    el.modePill.addEventListener("click", () => openSettingsModal("api"));

    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.closest(".wy-modal-mask").classList.remove("is-open");
      });
    });

    [el.saveModal, el.settingsModal].forEach((mask) => {
      mask.addEventListener("click", (e) => {
        if (e.target === mask) mask.classList.remove("is-open");
      });
    });

    // Save modal actions
    el.saveList.addEventListener("click", (e) => {
      const saveId = e.target.dataset.slotSave;
      const loadId = e.target.dataset.slotLoad;
      const delId = e.target.dataset.slotDel;
      const slots = getSaveSlots();
      if (saveId) {
        slots[saveId] = {
          savedAt: new Date().toLocaleString(),
          turnCount: state.turns.length,
          scene: state.scene,
          snapshot: deepClone(state)
        };
        setSaveSlots(slots);
        renderSaveSlots();
        showToast("已保存进度");
      } else if (loadId && slots[loadId]) {
        state = deepClone(slots[loadId].snapshot);
        persistAutosave();
        renderAll(true);
        el.saveModal.classList.remove("is-open");
        showToast("已读取档案");
      } else if (delId && slots[delId]) {
        delete slots[delId];
        setSaveSlots(slots);
        renderSaveSlots();
        showToast("已删除槽位");
      }
    });

    $("wy-export-save").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${STORY.id || "wenyou"}-save.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    $("wy-import-input").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          if (!parsed || !Array.isArray(parsed.turns) || !Array.isArray(parsed.tabs)) {
            throw new Error("存档格式不匹配");
          }
          state = parsed;
          persistAutosave();
          renderAll(true);
          el.saveModal.classList.remove("is-open");
          showToast("已导入存档");
        } catch (err) {
          showToast("导入失败：" + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });

    $("wy-restart-btn").addEventListener("click", () => {
      if (!confirm("确定清空当前进度并从头开局？已存入档案槽的记录不受影响。")) return;
      state = createInitialState();
      persistAutosave();
      renderAll(false);
      el.saveModal.classList.remove("is-open");
      showToast("已重新开局");
    });

    // Settings modal delegation
    el.settingsTabs.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-settings-tab]");
      if (!btn) return;
      activeSettingsTab = btn.dataset.settingsTab;
      renderSettingsModal();
    });

    el.settingsBody.addEventListener("click", async (e) => {
      const presetBtn = e.target.closest("[data-api-preset]");
      if (presetBtn) {
        const p = API_PRESETS[Number(presetBtn.dataset.apiPreset)];
        if (p) {
          $("cfg-url").value = p.baseUrl;
          $("cfg-model").value = p.model;
          $("cfg-offline").checked = false;
        }
        return;
      }

      if (e.target.id === "cfg-save-api") {
        apiConfig = {
          baseUrl: $("cfg-url").value.trim(),
          apiKey: $("cfg-key").value.trim(),
          model: $("cfg-model").value.trim(),
          temperature: Number($("cfg-temp").value) || 0.85,
          contextTurns: Number($("cfg-ctx").value) || 10,
          offlineMode: $("cfg-offline").checked
        };
        if (apiConfig.apiKey && $("cfg-offline").checked === false) {
          apiConfig.offlineMode = false;
        }
        saveApiConfig(apiConfig);
        renderHeader();
        showToast(apiConfig.apiKey && !apiConfig.offlineMode ? "接口已启用" : "已保存配置");
        return;
      }

      if (e.target.id === "cfg-test-api") {
        const msg = $("cfg-test-msg");
        const baseUrl = $("cfg-url").value.trim().replace(/\/+$/, "");
        const key = $("cfg-key").value.trim();
        const model = $("cfg-model").value.trim();
        if (!baseUrl || !key || !model) {
          msg.textContent = "请先填写 URL、Key 和模型名";
          return;
        }
        msg.textContent = "连接中…";
        const t0 = performance.now();
        try {
          const r = await fetch(baseUrl + "/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
            body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] })
          });
          if (!r.ok) throw new Error("HTTP " + r.status);
          msg.textContent = `连接成功（${Math.round(performance.now() - t0)} ms）`;
        } catch (err) {
          msg.textContent = "失败：" + err.message;
        }
        return;
      }

      if (e.target.id === "st-save") {
        state.storySettings = {
          worldview: $("st-world").value.trim(),
          protagonist: $("st-protag").value.trim(),
          style: $("st-style").value.trim(),
          customRules: $("st-rules").value.trim()
        };
        persistAutosave();
        showToast("设定已更新");
        return;
      }

      if (e.target.id === "mem-add") {
        const val = $("mem-new").value.trim();
        if (!val) return;
        state.memories.push({ turn: state.turns.length, text: val });
        persistAutosave();
        renderSettingsModal();
        return;
      }

      const memDel = e.target.closest("[data-mem-del]");
      if (memDel) {
        state.memories.splice(Number(memDel.dataset.memDel), 1);
        persistAutosave();
        renderSettingsModal();
        return;
      }

      const themePick = e.target.closest("[data-pick-theme]");
      if (themePick) {
        state.preferences.themeId = themePick.dataset.pickTheme;
        persistAutosave();
        applyTheme(state.preferences.themeId);
        renderSettingsModal();
        showToast("已切换主题");
      }
    });

    // Keyboard shortcuts: 1/2/3 pick choice, Esc exits immersive or modal
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (el.saveModal.classList.contains("is-open")) {
          el.saveModal.classList.remove("is-open");
        } else if (el.settingsModal.classList.contains("is-open")) {
          el.settingsModal.classList.remove("is-open");
        } else if (document.body.classList.contains("is-immersive")) {
          document.body.classList.remove("is-immersive", "immersive-peek");
        }
        return;
      }
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || isStreaming) return;
      if (el.saveModal.classList.contains("is-open") || el.settingsModal.classList.contains("is-open")) return;
      if (e.key === "1" || e.key === "2" || e.key === "3") {
        const idx = Number(e.key) - 1;
        const lastTurn = state.turns[state.turns.length - 1];
        const text = lastTurn && lastTurn.choices && lastTurn.choices[idx];
        if (text) submitAction(text, idx);
      }
    });
  }

  initSelect();
  bindEvents();
  renderAll(false);
})();
