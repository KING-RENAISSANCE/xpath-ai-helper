(() => {
  const HELPER_GLOBAL = "__xiaoyouXPathHelper";
  const HOST_TAG = "xiaoyou-xpath-helper-root";
  const POSITION_KEY = "xiaoyouXPathHelperPosition";
  const MAX_VISIBLE_RESULTS = 200;
  const SCROLL_DEBOUNCE_MS = 60;
  const INPUT_DEBOUNCE_MS = 120;
  const DOM_MUTATION_DEBOUNCE_MS = 160;
  const RECT_JOIN_GAP = 12;
  const MAX_SOURCE_DESCENDANTS = 24;
  const EMPTY_HINT = "输入 XPath 表达式开始定位";
  const MAX_SOURCE_PREVIEW_CHARS = 4_000_000;
  const SOURCE_COPY_LABEL = "复制源码";
  const COPY_SINK_ATTR = "data-xyh-copy-sink";
  const MAX_REFINE_ATTRIBUTES = 6;
  const AI_SETTINGS_KEY = "xyhAiSettings";
  const AI_PORT_NAME = "xyh-ai";
  const AI_HISTORY_LIMIT = 12;
  const AI_TARGET_TEXT_LIMIT = 400;

  const DEFAULT_AI_SETTINGS = {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    temperature: "0.2"
  };

  const AI_PRESETS = [
    { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    { id: "siliconflow", label: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-72B-Instruct" },
    { id: "moonshot", label: "Moonshot", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" }
  ];

  const AI_SYSTEM_PROMPT = [
    "你是网页元素 XPath 定位专家，服务于 RPA 元素捕获场景。",
    "用户会给你「目标元素的结构信息（JSON）」，包含标签、属性、祖先链和一个已验证唯一的 structuralXPath。",
    "请生成一条简短、可读、稳定的 XPath。严格遵守：",
    "1. 只能用 JSON 里出现过的信息，不要臆造属性或层级；",
    "2. 表达式必须短，最好一眼能读完。宁可用简单写法，也不要为了“看起来更健壮”而堆砌条件；",
    "3. 定位优先级：唯一 id > data-* / name / aria-label 等稳定属性 > class > 文本内容 > 位置下标；",
    "4. class 直接用 contains(@class, 'xxx') 或 @class='xxx'。绝对不要写 contains(concat(' ', normalize-space(@class), ' '), ' xxx ') —— XPath 1.0 没有 class 概念，这个写法只会让表达式变得又长又难调试，收益极小；",
    "5. 不要使用 following-sibling:: / preceding-sibling:: 这类依赖兄弟顺序的关系，页面稍改就会失效；",
    "6. 按文本定位用 [normalize-space(.)='文案'] 或 [normalize-space(text())='文案']。中英文文案不确定时可以 or 二选一，但最多列两个；",
    "7. 不要在一条表达式里同时叠加多个层级的复杂条件。如果一次定位不到，就给出当前最合理的一条，让用户补充信息后再调整；",
    "8. 优先保证唯一性；确实做不到唯一时给出最精确的短表达式，并在 reason 里说明；",
    "9. 如果找不到比 structuralXPath 更好、更短的写法，就直接返回 structuralXPath；",
    "10. 只输出一个 JSON 对象，不要有任何额外文字或 Markdown 代码块：",
    "{\"xpath\": \"生成的表达式\", \"reason\": \"一句话说明定位思路\"}"
  ].join("\n");

  if (window[HELPER_GLOBAL]) {
    window[HELPER_GLOBAL].toggle();
    return;
  }

  const state = {
    host: null,
    shadow: null,
    panel: null,
    input: null,
    status: null,
    resultsList: null,
    highlightLayer: null,
    results: [],
    activeIndex: -1,
    previewIndex: -1,
    visible: false,
    inputTimer: 0,
    drawTimer: 0,
    mutationTimer: 0,
    lastExpression: "",
    lastEvaluateMs: 0,
    resultCount: 0,
    resultStatusSuffix: "",
    idCountCache: null,
    mutationObserver: null,
    panelResizeObserver: null,
    panelMoveTimer: 0,
    sourceButton: null,
    sourcePanel: null,
    sourceMeta: null,
    sourceOutput: null,
    sourceCopyButton: null,
    sourceStale: false,
    sourceContent: "",
    sourceCopyTimer: 0,
    pickerButton: null,
    pickerLayer: null,
    pickerCrossX: null,
    pickerCrossY: null,
    pickerBox: null,
    pickerLabel: null,
    pickerTitle: null,
    pickerPath: null,
    pickerNode: null,
    pickerPoint: { x: 0, y: 0 },
    pickerPinned: false,
    picking: false,
    view: "results",
    aiButton: null,
    aiPanel: null,
    aiTarget: null,
    aiThread: null,
    aiInput: null,
    aiSendButton: null,
    aiStatus: null,
    aiSettingsButton: null,
    aiTargetButton: null,
    aiClearButton: null,
    aiRegenerateButton: null,
    settingsPanel: null,
    settingsStatus: null,
    settingsTestButton: null,
    settingsSaveButton: null,
    settingsPresets: null,
    aiSettings: null,
    aiMessages: [],
    aiPort: null,
    aiStreaming: false,
    aiStreamText: "",
    aiStreamMessage: null,
    aiCapturedNode: null,
    aiCapturedInfo: null
  };

  const css = `
    :host {
      all: initial;
      color-scheme: light;
      --xyh-primary: #f08a6a;
      --xyh-primary-active: #d97858;
      --xyh-ink: #15131e;
      --xyh-body: #2a2735;
      --xyh-muted: rgba(15, 12, 30, 0.62);
      --xyh-muted-soft: rgba(15, 12, 30, 0.45);
      --xyh-hairline: rgba(15, 12, 30, 0.08);
      --xyh-hairline-soft: rgba(15, 12, 30, 0.06);
      --xyh-canvas: #ffffff;
      --xyh-surface-soft: #fbfaf6;
      --xyh-surface-card: #f3f1ea;
      --xyh-surface-dark: #15131e;
      --xyh-surface-dark-elevated: #1f1d2b;
      --xyh-surface-dark-soft: #211f2c;
      --xyh-on-primary: #ffffff;
      --xyh-on-dark: #f4ecdd;
      --xyh-on-dark-soft: rgba(244, 236, 221, 0.58);
      --xyh-accent-teal: #4ed1b0;
      --xyh-accent-teal-strong: #0e8466;
      --xyh-warning: #d4a017;
      font-family: StyreneB, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    .xyh-highlight-layer {
      inset: 0;
      pointer-events: none;
      position: fixed;
      z-index: 2147483646;
    }

    .xyh-highlight-box {
      background: rgba(240, 138, 106, 0.08);
      border: 1.5px dashed rgba(240, 138, 106, 0.72);
      box-shadow: none;
      box-sizing: border-box;
      position: fixed;
    }

    .xyh-highlight-box.is-active {
      background: rgba(78, 209, 176, 0.1);
      border: 1.5px solid var(--xyh-accent-teal);
      box-shadow: 0 0 0 3px rgba(78, 209, 176, 0.18);
    }

    /* 拾取层不接收指针事件：拾取期间页面仍可正常点击、滚动、展开菜单，
       只在按住 Ctrl 点右键时才接管。视觉反馈靠下面的十字线和选框。 */
    .xyh-picker-layer {
      inset: 0;
      outline: none;
      pointer-events: none;
      position: fixed;
      z-index: 2147483645;
    }

    .xyh-picker-layer.is-hidden {
      display: none;
    }

    .xyh-picker-line {
      background: var(--xyh-primary);
      box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.65);
      pointer-events: none;
      position: fixed;
    }

    .xyh-picker-line.is-x {
      height: 1px;
      left: 0;
      right: 0;
    }

    .xyh-picker-line.is-y {
      bottom: 0;
      top: 0;
      width: 1px;
    }

    .xyh-picker-box {
      background: rgba(240, 138, 106, 0.12);
      border: 2px solid var(--xyh-primary);
      box-sizing: border-box;
      pointer-events: none;
      position: fixed;
    }

    .xyh-picker-label {
      background: var(--xyh-surface-dark);
      border-radius: 8px;
      box-shadow: 0 14px 32px -14px rgba(15, 12, 30, 0.55);
      color: var(--xyh-on-dark);
      display: grid;
      gap: 3px;
      max-width: 380px;
      padding: 8px 10px;
      pointer-events: none;
      position: fixed;
    }

    .xyh-picker-title {
      color: var(--xyh-primary);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .xyh-picker-path {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .xyh-picker-hint {
      color: var(--xyh-on-dark-soft);
      font-size: 10px;
    }

    .xyh-ai,
    .xyh-settings {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 10px;
      min-height: 0;
      padding: 4px 16px 12px;
    }

    .xyh-settings {
      gap: 12px;
      overflow: auto;
      scrollbar-width: thin;
    }

    .xyh-ai.is-hidden,
    .xyh-settings.is-hidden {
      display: none;
    }

    .xyh-ai-bar {
      align-items: center;
      display: flex;
      flex: 0 0 auto;
      gap: 8px;
      justify-content: space-between;
    }

    .xyh-ai-target {
      background: rgba(78, 209, 176, 0.12);
      border: 1px solid rgba(78, 209, 176, 0.28);
      border-radius: 6px;
      color: var(--xyh-accent-teal-strong);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      min-width: 0;
      overflow: hidden;
      padding: 4px 8px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .xyh-ai-target.is-empty {
      background: rgba(15, 12, 30, 0.05);
      border-color: rgba(15, 12, 30, 0.12);
      color: var(--xyh-muted);
      font-family: inherit;
    }

    .xyh-ai-thread {
      align-content: start;
      display: grid;
      flex: 1;
      gap: 10px;
      min-height: 0;
      overflow: auto;
      padding-right: 2px;
      scrollbar-color: rgba(15, 12, 30, 0.18) transparent;
      scrollbar-width: thin;
    }

    .xyh-ai-empty {
      color: var(--xyh-muted-soft);
      font-size: 12px;
      line-height: 1.9;
    }

    .xyh-ai-empty ol {
      margin: 6px 0 0;
      padding-left: 18px;
    }

    .xyh-ai-msg {
      border-radius: 10px;
      font-size: 12px;
      line-height: 1.6;
      padding: 9px 11px;
      word-break: break-word;
    }

    .xyh-ai-msg.is-user {
      background: rgba(240, 138, 106, 0.12);
      justify-self: end;
      max-width: 88%;
    }

    .xyh-ai-msg.is-assistant {
      background: #ffffff;
      border: 1px solid var(--xyh-hairline);
    }

    .xyh-ai-msg.is-error {
      background: rgba(212, 160, 23, 0.14);
      border: 1px solid rgba(212, 160, 23, 0.32);
      color: #8a5a06;
    }

    .xyh-ai-text {
      white-space: pre-wrap;
    }

    .xyh-ai-text:empty {
      display: none;
    }

    .xyh-ai-detail {
      color: var(--xyh-muted);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10px;
      line-height: 1.6;
      margin-top: 6px;
      max-height: 90px;
      overflow: auto;
      scrollbar-width: thin;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .xyh-ai-code {
      background: var(--xyh-surface-dark);
      border-radius: 8px;
      color: var(--xyh-on-dark);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.6;
      margin-top: 8px;
      padding: 8px 10px;
      word-break: break-all;
    }

    .xyh-ai-check {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .xyh-ai-check-meta {
      color: var(--xyh-muted);
      font-size: 11px;
    }

    .xyh-ai-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .xyh-ai-composer {
      align-items: flex-end;
      display: flex;
      flex: 0 0 auto;
      gap: 8px;
    }

    .xyh-ai-input {
      background: #ffffff;
      border: 1px solid rgba(15, 12, 30, 0.12);
      border-radius: 10px;
      box-sizing: border-box;
      color: var(--xyh-ink);
      flex: 1;
      font: 12px/1.5 inherit;
      max-height: 96px;
      min-height: 36px;
      min-width: 0;
      outline: none;
      overflow: hidden auto;
      padding: 8px 10px;
      resize: none;
      scrollbar-width: thin;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .xyh-ai-input:focus {
      border-color: var(--xyh-primary);
      box-shadow: 0 0 0 3px rgba(240, 138, 106, 0.18);
    }

    .xyh-ai-input:disabled {
      background: #f6f5f2;
      color: var(--xyh-muted-soft);
    }

    .xyh-ai-foot {
      align-items: center;
      color: var(--xyh-muted-soft);
      display: flex;
      flex: 0 0 auto;
      font-size: 11px;
      gap: 8px;
      justify-content: space-between;
      min-height: 20px;
    }

    .xyh-ai-status {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .xyh-primary-button {
      align-items: center;
      background: var(--xyh-primary);
      border: 1px solid var(--xyh-primary);
      border-radius: 6px;
      color: var(--xyh-on-primary);
      cursor: pointer;
      display: inline-flex;
      flex: 0 0 auto;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      height: 30px;
      justify-content: center;
      padding: 0 12px;
      white-space: nowrap;
    }

    .xyh-primary-button:hover {
      background: var(--xyh-primary-active);
      border-color: var(--xyh-primary-active);
    }

    .xyh-primary-button:disabled {
      background: rgba(240, 138, 106, 0.35);
      border-color: transparent;
      cursor: not-allowed;
    }

    .xyh-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .xyh-field {
      display: grid;
      gap: 5px;
    }

    .xyh-field-label {
      color: var(--xyh-muted);
      font-size: 11px;
      line-height: 1.5;
    }

    .xyh-field-input {
      background: #ffffff;
      border: 1px solid rgba(15, 12, 30, 0.14);
      border-radius: 8px;
      box-sizing: border-box;
      color: var(--xyh-ink);
      font: 11px/1.4 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      outline: none;
      padding: 8px 10px;
      width: 100%;
    }

    .xyh-field-input:focus {
      border-color: var(--xyh-primary);
      box-shadow: 0 0 0 3px rgba(240, 138, 106, 0.18);
    }

    .xyh-field-row {
      align-items: center;
      display: flex;
      gap: 8px;
    }

    .xyh-field-row .xyh-field-input {
      flex: 1;
      min-width: 0;
      width: auto;
    }

    .xyh-settings-actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .xyh-settings-status {
      color: var(--xyh-muted);
      font-size: 11px;
      line-height: 1.5;
    }

    .xyh-settings-status.is-ok {
      color: var(--xyh-accent-teal-strong);
    }

    .xyh-settings-status.is-bad {
      color: #a8632a;
    }

    .xyh-panel {
      background: var(--xyh-canvas);
      border: 1px solid var(--xyh-hairline);
      border-radius: 14px;
      box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.6) inset,
        0 18px 48px -16px rgba(15, 12, 30, 0.28),
        0 4px 14px -6px rgba(15, 12, 30, 0.18);
      box-sizing: border-box;
      color: var(--xyh-ink);
      display: flex;
      flex-direction: column;
      font-size: 13px;
      height: 580px;
      left: 24px;
      max-height: calc(100vh - 16px);
      max-width: calc(100vw - 16px);
      min-height: min(260px, calc(100vh - 16px));
      min-width: min(380px, calc(100vw - 16px));
      overflow: hidden;
      pointer-events: auto;
      position: fixed;
      resize: both;
      top: 24px;
      width: 520px;
      z-index: 2147483647;
    }

    .xyh-panel.is-hidden {
      display: none;
    }

    .xyh-panel.is-auto-moving {
      transition: left 180ms linear, top 180ms linear;
    }

    .xyh-header {
      align-items: center;
      background: linear-gradient(180deg, var(--xyh-surface-dark-elevated) 0%, var(--xyh-surface-dark) 100%);
      border-bottom: 1px solid rgba(244, 236, 221, 0.08);
      color: var(--xyh-on-dark);
      cursor: move;
      display: flex;
      gap: 14px;
      justify-content: space-between;
      padding: 12px 16px;
      user-select: none;
    }

    .xyh-brand {
      align-items: center;
      display: flex;
      gap: 11px;
      min-width: 0;
    }

    .xyh-brand-mark {
      align-items: center;
      border: 0;
      border-radius: 8px;
      display: inline-flex;
      flex: 0 0 auto;
      height: 28px;
      justify-content: center;
      overflow: hidden;
      width: 28px;
    }

    .xyh-brand-mark svg {
      display: block;
      height: 28px;
      width: 28px;
    }

    .xyh-title-group {
      min-width: 0;
    }

    .xyh-title {
      color: var(--xyh-on-dark);
      font-family: StyreneB, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.1px;
      line-height: 1.1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .xyh-header-actions {
      align-items: center;
      display: flex;
      gap: 6px;
    }

    .xyh-icon-button {
      align-items: center;
      background: rgba(244, 236, 221, 0.08);
      border: 1px solid rgba(244, 236, 221, 0.1);
      border-radius: 9999px;
      box-sizing: border-box;
      color: var(--xyh-on-dark);
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      height: 26px;
      justify-content: center;
      width: 26px;
    }

    .xyh-icon-button:hover {
      background: rgba(240, 138, 106, 0.18);
      border-color: rgba(240, 138, 106, 0.32);
      color: var(--xyh-primary);
    }

    .xyh-icon-button.is-active {
      background: rgba(240, 138, 106, 0.24);
      border-color: rgba(240, 138, 106, 0.45);
      color: var(--xyh-primary);
    }

    .xyh-body {
      background: linear-gradient(180deg, var(--xyh-surface-soft) 0%, #f5f3ec 100%);
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 0;
      min-height: 0;
      padding: 0;
    }

    .xyh-input-row {
      padding: 12px 16px 8px;
    }

    .xyh-input-shell {
      align-items: flex-start;
      background: #ffffff;
      border: 1px solid rgba(15, 12, 30, 0.12);
      border-radius: 10px;
      box-sizing: border-box;
      display: flex;
      gap: 8px;
      min-height: 38px;
      padding: 9px 10px;
      transition: border-color 0.16s ease, box-shadow 0.16s ease;
    }

    .xyh-input-shell:focus-within {
      border-color: var(--xyh-primary);
      box-shadow: 0 0 0 3px rgba(240, 138, 106, 0.18);
    }

    .xyh-input-icon {
      color: rgba(15, 12, 30, 0.4);
      display: block;
      flex: 0 0 auto;
      height: 14px;
      margin-top: 2px;
      width: 14px;
    }

    .xyh-input {
      background: transparent;
      border: 0;
      box-sizing: border-box;
      color: var(--xyh-ink);
      font: 13px/1.4 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: 0;
      line-height: 18px;
      max-height: 92px;
      min-height: 18px;
      min-width: 0;
      outline: none;
      overflow: hidden auto;
      padding: 0;
      resize: none;
      scrollbar-color: rgba(15, 12, 30, 0.18) transparent;
      scrollbar-width: thin;
      white-space: pre-wrap;
      word-break: break-all;
      width: 100%;
    }

    .xyh-input:focus {
      box-shadow: none;
    }

    .xyh-status {
      align-items: center;
      box-sizing: border-box;
      color: rgba(15, 12, 30, 0.65);
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 12px;
      font-weight: 400;
      line-height: 1.5;
      min-height: 24px;
      padding: 0 16px 8px;
      row-gap: 6px;
    }

    .xyh-verdict {
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
      line-height: 1;
      padding: 4px 8px;
      white-space: nowrap;
    }

    .xyh-verdict.is-unique {
      background: rgba(78, 209, 176, 0.14);
      border: 1px solid rgba(78, 209, 176, 0.32);
      color: var(--xyh-accent-teal-strong);
    }

    .xyh-verdict.is-ambiguous {
      background: rgba(212, 160, 23, 0.16);
      border: 1px solid rgba(212, 160, 23, 0.36);
      color: #8a6a06;
    }

    .xyh-verdict.is-missing {
      background: rgba(15, 12, 30, 0.06);
      border: 1px solid rgba(15, 12, 30, 0.12);
      color: rgba(15, 12, 30, 0.58);
    }

    .xyh-tighten {
      align-items: center;
      background: rgba(212, 160, 23, 0.18);
      border: 1px solid rgba(212, 160, 23, 0.4);
      border-radius: 6px;
      color: #8a6a06;
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      font-weight: 500;
      height: 24px;
      padding: 0 9px;
      white-space: nowrap;
    }

    .xyh-tighten:hover {
      background: rgba(212, 160, 23, 0.28);
    }

    .xyh-status-main strong {
      align-items: center;
      background: rgba(78, 209, 176, 0.14);
      border: 1px solid rgba(78, 209, 176, 0.32);
      border-radius: 9999px;
      color: var(--xyh-accent-teal-strong);
      display: inline-flex;
      font-weight: 700;
      justify-content: center;
      line-height: 1;
      margin: 0 3px;
      min-width: 0;
      padding: 3px 6px;
    }

    .xyh-status-main strong.is-zero {
      background: rgba(15, 12, 30, 0.06);
      border-color: rgba(15, 12, 30, 0.12);
      color: rgba(15, 12, 30, 0.58);
    }

    .xyh-status-separator {
      color: rgba(15, 12, 30, 0.3);
    }

    .xyh-status-actions {
      align-items: center;
      display: flex;
      flex: 0 0 auto;
      gap: 6px;
      margin-left: auto;
    }

    .xyh-cancel-location {
      align-items: center;
      background: rgba(78, 209, 176, 0.12);
      border: 1px solid rgba(78, 209, 176, 0.28);
      border-radius: 6px;
      color: var(--xyh-accent-teal-strong);
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      font-weight: 500;
      height: 24px;
      padding: 0 9px;
      white-space: nowrap;
    }

    .xyh-cancel-location:hover {
      background: rgba(78, 209, 176, 0.2);
    }

    .xyh-results {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 4px 16px 12px;
      scrollbar-color: rgba(15, 12, 30, 0.18) transparent;
      scrollbar-width: thin;
    }

    .xyh-results.is-hidden {
      display: none;
    }

    .xyh-source {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 8px;
      min-height: 0;
      padding: 4px 16px 12px;
    }

    .xyh-source.is-hidden {
      display: none;
    }

    .xyh-source-bar {
      align-items: center;
      display: flex;
      flex: 0 0 auto;
      gap: 8px;
      justify-content: space-between;
    }

    .xyh-source-meta {
      color: rgba(15, 12, 30, 0.58);
      font-size: 11px;
      line-height: 1.5;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .xyh-source-actions {
      display: flex;
      flex: 0 0 auto;
      gap: 6px;
    }

    .xyh-ghost-button {
      align-items: center;
      background: rgba(78, 209, 176, 0.12);
      border: 1px solid rgba(78, 209, 176, 0.28);
      border-radius: 6px;
      color: var(--xyh-accent-teal-strong);
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      font-size: 11px;
      height: 24px;
      padding: 0 10px;
      white-space: nowrap;
    }

    .xyh-ghost-button:hover {
      background: rgba(78, 209, 176, 0.2);
    }

    .xyh-ghost-button.is-busy {
      opacity: 0.65;
      pointer-events: none;
    }

    .xyh-source-text {
      background: #ffffff;
      border: 1px solid var(--xyh-hairline);
      border-radius: 10px;
      box-sizing: border-box;
      color: var(--xyh-body);
      flex: 1;
      font: 11px/1.6 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      min-height: 0;
      outline: none;
      padding: 10px 12px;
      resize: none;
      scrollbar-color: rgba(15, 12, 30, 0.18) transparent;
      scrollbar-width: thin;
      tab-size: 2;
      white-space: pre;
    }

    .xyh-empty {
      align-items: center;
      color: rgba(15, 12, 30, 0.55);
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 10px;
      justify-content: center;
      min-height: 180px;
      padding: 20px 24px;
      text-align: center;
    }

    .xyh-empty.is-simple {
      align-items: center;
      color: rgba(15, 12, 30, 0.46);
      font-size: 13px;
      justify-content: center;
      min-height: 260px;
      padding: 24px;
      text-align: center;
    }

    .xyh-card {
      background: #ffffff;
      border: 1px solid var(--xyh-hairline);
      border-radius: 12px;
      cursor: pointer;
      margin-bottom: 12px;
      overflow: hidden;
      transition: background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
    }

    .xyh-card:hover {
      background: #fffdfa;
      border-color: rgba(15, 12, 30, 0.18);
      box-shadow: 0 10px 24px -18px rgba(15, 12, 30, 0.32);
      transform: translateY(-1px);
    }

    .xyh-card.is-active {
      border-color: var(--xyh-accent-teal);
      box-shadow: 0 0 0 3px rgba(78, 209, 176, 0.18);
    }

    .xyh-card.is-active:hover {
      background: #ffffff;
      border-color: var(--xyh-accent-teal);
      box-shadow: 0 0 0 3px rgba(78, 209, 176, 0.2), 0 10px 24px -18px rgba(15, 12, 30, 0.28);
    }

    .xyh-card-header {
      align-items: center;
      background: transparent;
      display: flex;
      gap: 8px;
      justify-content: space-between;
      padding: 10px 12px 6px;
    }

    .xyh-card-title-row {
      align-items: center;
      display: flex;
      flex: 1;
      gap: 8px;
      min-width: 0;
    }

    .xyh-card-title {
      color: var(--xyh-ink);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      font-weight: 600;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .xyh-card.is-active .xyh-card-title {
      color: var(--xyh-accent-teal-strong);
    }

    .xyh-card-type {
      background: rgba(78, 209, 176, 0.14);
      border-radius: 9999px;
      color: var(--xyh-accent-teal-strong);
      display: inline-flex;
      font-size: 10px;
      font-weight: 500;
      line-height: 1.45;
      padding: 2px 7px;
      white-space: nowrap;
    }

    .xyh-card-type.is-text {
      background: rgba(240, 138, 106, 0.14);
      color: #b5532e;
    }

    .xyh-card-type.is-attribute {
      background: rgba(99, 102, 241, 0.12);
      color: #4f46e5;
    }

    .xyh-card-body {
      display: grid;
      gap: 7px;
      padding: 0 12px 12px;
    }

    .xyh-card-meta {
      display: grid;
      gap: 6px 8px;
      grid-template-columns: max-content minmax(0, 1fr);
    }

    .xyh-meta-label {
      color: var(--xyh-muted-soft);
      font-size: 11px;
      line-height: 1.6;
      padding-top: 1px;
      white-space: nowrap;
    }

    .xyh-meta-value {
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      color: var(--xyh-body);
      display: -webkit-box;
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.6;
      min-width: 0;
      overflow: hidden;
      word-break: break-word;
    }

    .xyh-meta-value.is-source {
      -webkit-line-clamp: 3;
      color: rgba(15, 12, 30, 0.7);
    }

    .xyh-meta-value.is-empty {
      -webkit-line-clamp: 1;
      color: var(--xyh-muted-soft);
      font-family: inherit;
      font-size: 12px;
    }

    .xyh-text-preview {
      background: transparent;
      border: 0;
      border-radius: 0;
      color: var(--xyh-body);
      display: -webkit-box;
      font-size: 12px;
      line-height: 1.5;
      max-height: 38px;
      overflow: hidden;
      padding: 0;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      white-space: normal;
      word-break: break-word;
    }

    .xyh-text-preview::-webkit-scrollbar,
    .xyh-results::-webkit-scrollbar {
      height: 10px;
      width: 10px;
    }

    .xyh-text-preview::-webkit-scrollbar-thumb,
    .xyh-results::-webkit-scrollbar-thumb {
      background: rgba(15, 12, 30, 0.16);
      border: 3px solid var(--xyh-surface-soft);
      border-radius: 9999px;
    }

    .xyh-text-preview:hover::-webkit-scrollbar-thumb,
    .xyh-results:hover::-webkit-scrollbar-thumb {
      background: rgba(15, 12, 30, 0.28);
    }

    .xyh-text-preview::-webkit-scrollbar-track,
    .xyh-results::-webkit-scrollbar-track {
      background: transparent;
      border-radius: 9999px;
    }
  `;

  function createHelper() {
    const host = document.createElement(HOST_TAG);
    host.style.cssText = [
      "position: fixed",
      "inset: 0",
      "pointer-events: none",
      "z-index: 2147483647"
    ].join(";");

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = css;

    const highlightLayer = document.createElement("div");
    highlightLayer.className = "xyh-highlight-layer";

    const pickerLayer = document.createElement("div");
    pickerLayer.className = "xyh-picker-layer is-hidden";
    pickerLayer.tabIndex = -1;
    pickerLayer.innerHTML = `
      <div class="xyh-picker-line is-x"></div>
      <div class="xyh-picker-line is-y"></div>
      <div class="xyh-picker-box"></div>
      <div class="xyh-picker-label">
        <div class="xyh-picker-title"></div>
        <div class="xyh-picker-path"></div>
        <div class="xyh-picker-hint">按住 Ctrl 点右键拾取 · ↑↓ 换层级 · Esc 退出</div>
      </div>
    `;

    const panel = document.createElement("section");
    panel.className = "xyh-panel is-hidden";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "XPath AI 助手");

    panel.innerHTML = `
      <header class="xyh-header">
        <div class="xyh-brand">
          <div class="xyh-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 128 128" focusable="false">
              <defs>
                <linearGradient id="xyh-icon-bg" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#1f1d2b"></stop>
                  <stop offset="100%" stop-color="#15131e"></stop>
                </linearGradient>
              </defs>
              <rect x="0" y="0" width="128" height="128" rx="28" fill="url(#xyh-icon-bg)"></rect>
              <path d="M28 36L60 36L60 70L92 70L92 96" fill="none" stroke="#f08a6a" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"></path>
              <circle cx="28" cy="36" r="7" fill="#f4ecdd" stroke="#1f1d2b" stroke-width="2"></circle>
              <circle cx="60" cy="36" r="5.5" fill="#f4ecdd"></circle>
              <circle cx="60" cy="70" r="5.5" fill="#f4ecdd"></circle>
              <circle cx="92" cy="96" r="9" fill="#4ed1b0" stroke="#1f1d2b" stroke-width="2"></circle>
              <circle cx="92" cy="96" r="3" fill="#0e2a24"></circle>
            </svg>
          </div>
          <div class="xyh-title-group">
            <div class="xyh-title">XPath AI 助手</div>
          </div>
        </div>
        <div class="xyh-header-actions">
          <button class="xyh-icon-button" type="button" data-action="ai" title="AI 对话生成 XPath" aria-label="AI 对话">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M11 3L12.9 8.1L18 10L12.9 11.9L11 17L9.1 11.9L4 10L9.1 8.1L11 3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
              <path d="M18 15L18.9 17.1L21 18L18.9 18.9L18 21L17.1 18.9L15 18L17.1 17.1L18 15Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
            </svg>
          </button>
          <button class="xyh-icon-button" type="button" data-action="pick" title="获取元素（在页面上拾取）" aria-label="获取元素">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2"></circle>
              <path d="M12 2V5.5M12 18.5V22M2 12H5.5M18.5 12H22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
          <button class="xyh-icon-button" type="button" data-action="source" title="抓取整页源代码" aria-label="抓取整页源代码">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M9 7L4 12L9 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
              <path d="M15 7L20 12L15 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
              <path d="M13.5 4.5L10.5 19.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
          <button class="xyh-icon-button" type="button" data-action="clear" title="清空结果" aria-label="清空结果">
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path d="M4 20H14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
              <path d="M15 4L21 10L11 20H5V14L15 4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
            </svg>
          </button>
          <button class="xyh-icon-button" type="button" data-action="close" title="关闭面板" aria-label="关闭面板">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M6 6L18 18M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
      </header>
      <div class="xyh-body">
        <div class="xyh-input-row">
          <div class="xyh-input-shell">
            <svg class="xyh-input-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"></circle>
              <path d="M16.5 16.5L21 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
            <textarea class="xyh-input" rows="1" spellcheck="false" placeholder="请输入 XPath 表达式"></textarea>
          </div>
        </div>
        <div class="xyh-status"></div>
        <div class="xyh-results"></div>
        <div class="xyh-source is-hidden">
          <div class="xyh-source-bar">
            <span class="xyh-source-meta"></span>
            <div class="xyh-source-actions">
              <button class="xyh-ghost-button" type="button" data-action="source-copy">复制源码</button>
              <button class="xyh-ghost-button" type="button" data-action="source-refresh">重新抓取</button>
            </div>
          </div>
          <textarea class="xyh-source-text" readonly spellcheck="false" wrap="off"></textarea>
        </div>
        <div class="xyh-ai is-hidden">
          <div class="xyh-ai-bar">
            <span class="xyh-ai-target is-empty">未选择目标元素</span>
            <div class="xyh-settings-actions">
              <button class="xyh-ghost-button" type="button" data-action="ai-target">选择目标</button>
              <button class="xyh-ghost-button" type="button" data-action="ai-settings">AI 设置</button>
            </div>
          </div>
          <div class="xyh-ai-thread"></div>
          <div class="xyh-ai-composer">
            <textarea class="xyh-ai-input" rows="1" spellcheck="false" placeholder="先点「选择目标」在页面上拾取元素"></textarea>
            <button class="xyh-primary-button" type="button" data-action="ai-send">发送</button>
          </div>
          <div class="xyh-ai-foot">
            <span class="xyh-ai-status"></span>
            <div class="xyh-settings-actions">
              <button class="xyh-ghost-button" type="button" data-action="ai-regenerate">重新生成</button>
              <button class="xyh-ghost-button" type="button" data-action="ai-clear">清空对话</button>
            </div>
          </div>
        </div>
        <div class="xyh-settings is-hidden">
          <div class="xyh-presets"></div>
          <label class="xyh-field">
            <span class="xyh-field-label">接口地址（Base URL，需兼容 OpenAI 的 /chat/completions）</span>
            <input class="xyh-field-input" type="text" data-setting="baseUrl" spellcheck="false" placeholder="https://api.openai.com/v1">
          </label>
          <label class="xyh-field">
            <span class="xyh-field-label">API Key</span>
            <div class="xyh-field-row">
              <input class="xyh-field-input" type="password" data-setting="apiKey" spellcheck="false" placeholder="sk-...">
              <button class="xyh-ghost-button" type="button" data-action="settings-reveal">显示</button>
            </div>
          </label>
          <label class="xyh-field">
            <span class="xyh-field-label">模型</span>
            <input class="xyh-field-input" type="text" data-setting="model" spellcheck="false" placeholder="gpt-4o-mini">
          </label>
          <label class="xyh-field">
            <span class="xyh-field-label">温度（0 ~ 2，越低越稳定，建议 0.2）</span>
            <input class="xyh-field-input" type="text" data-setting="temperature" spellcheck="false" placeholder="0.2">
          </label>
          <div class="xyh-settings-actions">
            <button class="xyh-primary-button" type="button" data-action="settings-save">保存</button>
            <button class="xyh-ghost-button" type="button" data-action="settings-test">测试连接</button>
            <button class="xyh-ghost-button" type="button" data-action="settings-back">返回</button>
          </div>
          <div class="xyh-settings-status"></div>
          <div class="xyh-settings-note">
            API Key 以明文保存在本机浏览器的扩展存储中，只会用于你填写的接口地址，不会发往别处。
          </div>
        </div>
      </div>
    `;

    shadow.append(style, highlightLayer, pickerLayer, panel);
    document.documentElement.appendChild(host);

    state.host = host;
    state.shadow = shadow;
    state.panel = panel;
    state.input = panel.querySelector(".xyh-input");
    state.status = panel.querySelector(".xyh-status");
    state.resultsList = panel.querySelector(".xyh-results");
    state.sourceButton = panel.querySelector('[data-action="source"]');
    state.sourcePanel = panel.querySelector(".xyh-source");
    state.sourceMeta = panel.querySelector(".xyh-source-meta");
    state.sourceOutput = panel.querySelector(".xyh-source-text");
    state.sourceCopyButton = panel.querySelector('[data-action="source-copy"]');
    state.highlightLayer = highlightLayer;
    state.pickerButton = panel.querySelector('[data-action="pick"]');
    state.pickerLayer = pickerLayer;
    state.pickerCrossX = pickerLayer.querySelector(".xyh-picker-line.is-x");
    state.pickerCrossY = pickerLayer.querySelector(".xyh-picker-line.is-y");
    state.pickerBox = pickerLayer.querySelector(".xyh-picker-box");
    state.pickerLabel = pickerLayer.querySelector(".xyh-picker-label");
    state.pickerTitle = pickerLayer.querySelector(".xyh-picker-title");
    state.pickerPath = pickerLayer.querySelector(".xyh-picker-path");

    state.aiButton = panel.querySelector('[data-action="ai"]');
    state.aiPanel = panel.querySelector(".xyh-ai");
    state.aiTarget = panel.querySelector(".xyh-ai-target");
    state.aiThread = panel.querySelector(".xyh-ai-thread");
    state.aiInput = panel.querySelector(".xyh-ai-input");
    state.aiSendButton = panel.querySelector('[data-action="ai-send"]');
    state.aiStatus = panel.querySelector(".xyh-ai-status");
    state.aiSettingsButton = panel.querySelector('[data-action="ai-settings"]');
    state.aiTargetButton = panel.querySelector('[data-action="ai-target"]');
    state.aiClearButton = panel.querySelector('[data-action="ai-clear"]');
    state.aiRegenerateButton = panel.querySelector('[data-action="ai-regenerate"]');
    state.settingsPanel = panel.querySelector(".xyh-settings");
    state.settingsStatus = panel.querySelector(".xyh-settings-status");
    state.settingsTestButton = panel.querySelector('[data-action="settings-test"]');
    state.settingsPresets = panel.querySelector(".xyh-presets");

    bindEvents();
    restorePanelPosition();
    setAiTarget(null);
    renderAiPresets();
    loadAiSettings();
  }

  function bindEvents() {
    const header = state.panel.querySelector(".xyh-header");
    const clearButton = state.panel.querySelector('[data-action="clear"]');
    const closeButton = state.panel.querySelector('[data-action="close"]');
    const sourceRefreshButton = state.panel.querySelector('[data-action="source-refresh"]');

    clearButton.addEventListener("click", clearAll);
    closeButton.addEventListener("click", hide);
    state.pickerButton.addEventListener("click", startPicking);
    state.sourceButton.addEventListener("click", toggleSourceView);
    state.sourceCopyButton.addEventListener("click", copySourceContent);
    sourceRefreshButton.addEventListener("click", refreshSourceContent);

    state.aiButton.addEventListener("click", toggleAiView);
    state.aiSendButton.addEventListener("click", handleAiSendClick);
    state.aiClearButton.addEventListener("click", clearAiConversation);
    state.aiRegenerateButton.addEventListener("click", regenerateAi);
    state.aiTargetButton.addEventListener("click", startPicking);
    state.aiSettingsButton.addEventListener("click", openSettings);
    state.settingsTestButton.addEventListener("click", testAiSettings);
    state.aiInput.addEventListener("input", resizeAiInputBox);
    state.aiInput.addEventListener("keydown", handleAiInputKey);

    state.settingsPanel.querySelector('[data-action="settings-save"]')
      .addEventListener("click", handleSettingsSave);
    state.settingsPanel.querySelector('[data-action="settings-back"]')
      .addEventListener("click", () => setPanelView("ai"));
    state.settingsPanel.querySelector('[data-action="settings-reveal"]')
      .addEventListener("click", toggleApiKeyVisibility);
    state.settingsPanel.querySelectorAll("[data-setting]").forEach((field) => {
      field.addEventListener("input", () => setSettingsStatus(""));
    });

    state.input.addEventListener("input", () => {
      if (state.view !== "results") {
        setPanelView("results");
      }
      state.restoreExpression = "";
      resizeInputBox();
      window.clearTimeout(state.inputTimer);
      state.inputTimer = window.setTimeout(evaluateCurrentXPath, INPUT_DEBOUNCE_MS);
    });

    state.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        window.clearTimeout(state.inputTimer);
        evaluateCurrentXPath();
      }
      if (event.key === "Escape") {
        hide();
      }
    });

    header.addEventListener("pointerdown", startDragging);
    window.addEventListener("scroll", scheduleHighlightDraw, true);
    window.addEventListener("resize", handleViewportResize);

    if (window.ResizeObserver) {
      state.panelResizeObserver = new ResizeObserver(handlePanelResize);
      state.panelResizeObserver.observe(state.panel);
    }

    observeDocumentChanges();
  }

  function observeDocumentChanges() {
    if (!window.MutationObserver || state.mutationObserver || !document.documentElement) {
      return;
    }

    state.mutationObserver = new MutationObserver((mutations) => {
      if (!mutations.some(isRelevantDocumentMutation)) {
        return;
      }

      if (state.view === "source") {
        markSourceStale();
      }

      scheduleMutationEvaluate();
    });

    state.mutationObserver.observe(document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });
  }

  function isRelevantDocumentMutation(mutation) {
    if (isHelperNode(mutation.target) || isCopySink(mutation.target)) {
      return false;
    }

    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    if (!changedNodes.length) {
      return true;
    }

    return changedNodes.some((node) => !isHelperNode(node) && !isCopySink(node));
  }

  function scheduleMutationEvaluate() {
    if (!state.visible || !state.input || !state.input.value.trim()) {
      return;
    }

    window.clearTimeout(state.mutationTimer);
    state.mutationTimer = window.setTimeout(evaluateCurrentXPath, DOM_MUTATION_DEBOUNCE_MS);
  }

  function startDragging(event) {
    if (event.button !== 0 || closestElement(event.target, "button")) {
      return;
    }

    const rect = state.panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;

    state.panel.setPointerCapture(event.pointerId);

    function onPointerMove(moveEvent) {
      const nextLeft = startLeft + moveEvent.clientX - startX;
      const nextTop = startTop + moveEvent.clientY - startY;
      movePanel(nextLeft, nextTop);
    }

    function onPointerUp(upEvent) {
      state.panel.releasePointerCapture(upEvent.pointerId);
      state.panel.removeEventListener("pointermove", onPointerMove);
      state.panel.removeEventListener("pointerup", onPointerUp);
      savePanelPosition();
    }

    state.panel.addEventListener("pointermove", onPointerMove);
    state.panel.addEventListener("pointerup", onPointerUp);
  }

  function movePanel(left, top, animate = false) {
    const rect = state.panel.getBoundingClientRect();
    const position = clampPanelPosition(left, top, rect.width, rect.height, 8);

    setPanelPosition(position.left, position.top, animate);
  }

  function setPanelPosition(left, top, animate = false) {
    state.panel.classList.toggle("is-auto-moving", animate);
    state.panel.style.left = `${left}px`;
    state.panel.style.top = `${top}px`;

    if (animate) {
      window.clearTimeout(state.panelMoveTimer);
      state.panelMoveTimer = window.setTimeout(() => {
        state.panel.classList.remove("is-auto-moving");
      }, 220);
    }
  }

  function restorePanelPosition() {
    chrome.storage.local.get(POSITION_KEY, (data) => {
      const position = data[POSITION_KEY];
      if (!position || typeof position.left !== "number" || typeof position.top !== "number") {
        return;
      }
      movePanel(position.left, position.top);
    });
  }

  function savePanelPosition() {
    const rect = state.panel.getBoundingClientRect();
    chrome.storage.local.set({
      [POSITION_KEY]: {
        left: Math.round(rect.left),
        top: Math.round(rect.top)
      }
    });
  }

  function handleViewportResize() {
    keepPanelInViewport();
    scheduleHighlightDraw();
  }

  function handlePanelResize() {
    keepPanelInViewport();
    scheduleHighlightDraw();
  }

  function keepPanelInViewport() {
    if (!state.panel || state.panel.classList.contains("is-hidden")) {
      return;
    }
    const rect = state.panel.getBoundingClientRect();
    const position = clampPanelPosition(rect.left, rect.top, rect.width, rect.height, 8);
    if (Math.abs(position.left - rect.left) > 0.5 || Math.abs(position.top - rect.top) > 0.5) {
      setPanelPosition(position.left, position.top, true);
      savePanelPosition();
    }
  }

  function show() {
    state.visible = true;
    state.panel.classList.remove("is-hidden");
    state.input.focus();
    if (state.lastExpression) {
      evaluateCurrentXPath();
    }
  }

  function hide() {
    state.visible = false;
    state.panel.classList.add("is-hidden");
    stopPicking();
    clearHighlights();
  }

  function toggle() {
    if (!state.host || !document.documentElement.contains(state.host)) {
      createHelper();
    }

    if (state.visible) {
      hide();
    } else {
      show();
    }
  }

  function capturePageSource() {
    const root = document.documentElement;
    if (!root) {
      return "";
    }

    // 以当前 DOM 为准而不是服务端返回的原始 HTML：XPath 是在实时 DOM 上求值的，
    // 同时剔除本插件注入的宿主节点，避免污染源码。
    const clone = root.cloneNode(true);
    const helperHost = clone.querySelector(HOST_TAG);
    if (helperHost) {
      helperHost.remove();
    }

    return clone.outerHTML || "";
  }

  function setPanelView(view) {
    state.view = view;

    state.resultsList.classList.toggle("is-hidden", view !== "results");
    state.sourcePanel.classList.toggle("is-hidden", view !== "source");
    state.aiPanel.classList.toggle("is-hidden", view !== "ai");
    state.settingsPanel.classList.toggle("is-hidden", view !== "settings");

    state.sourceButton.classList.toggle("is-active", view === "source");
    state.aiButton.classList.toggle("is-active", view === "ai");

    if (view === "results") {
      drawHighlights();
    } else {
      clearHighlights();
    }
  }

  function toggleSourceView() {
    if (state.view === "source") {
      setPanelView("results");
      return;
    }

    refreshSourceContent();
    setPanelView("source");
  }

  function toggleAiView() {
    if (state.view === "ai") {
      setPanelView("results");
      return;
    }

    setPanelView("ai");
    renderAiEmptyState();
    syncAiTarget();
    state.aiInput.focus();
  }

  function refreshSourceContent() {
    const startedAt = performance.now();
    state.sourceContent = capturePageSource();
    state.sourceStale = false;

    const characterCount = state.sourceContent.length;
    const byteCount = new Blob([state.sourceContent]).size;
    const elapsed = Math.max(1, Math.round(performance.now() - startedAt));

    if (characterCount > MAX_SOURCE_PREVIEW_CHARS) {
      state.sourceOutput.value = "";
      state.sourceOutput.placeholder = "源码过大，已跳过预览，请直接复制。";
    } else {
      state.sourceOutput.value = state.sourceContent;
      state.sourceOutput.placeholder = "";
    }

    state.sourceOutput.scrollTop = 0;
    setSourceMeta(
      `整页源码 · ${characterCount.toLocaleString()} 字符 · ${formatBytes(byteCount)} · 抓取耗时 ${elapsed}ms`
    );
  }

  function markSourceStale() {
    if (state.sourceStale) {
      return;
    }

    state.sourceStale = true;
    setSourceMeta(`${state.sourceMeta.textContent} · 页面已变化，可点“重新抓取”`);
  }

  function setSourceMeta(message) {
    state.sourceMeta.textContent = message;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  async function copySourceContent() {
    if (!state.sourceContent) {
      setSourceMeta("暂无可复制的源码，请先抓取");
      return;
    }

    const button = state.sourceCopyButton;
    window.clearTimeout(state.sourceCopyTimer);
    button.classList.add("is-busy");
    button.textContent = "复制中…";

    const copied = await copyText(state.sourceContent);

    button.classList.remove("is-busy");
    button.textContent = copied ? "已复制" : "复制失败";
    state.sourceCopyTimer = window.setTimeout(() => {
      button.textContent = SOURCE_COPY_LABEL;
    }, 1800);
  }

  async function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // 剪贴板 API 不可用时回退到 execCommand
      }
    }

    return copyTextFallback(text);
  }

  function copyTextFallback(text) {
    // navigator.clipboard 只在安全上下文可用，HTTP 页面必须走这条兜底路径。
    // execCommand("copy") 要求目标元素已聚焦且位于文档树中，因此写入 body 并打标记，
    // 让 MutationObserver 忽略这个临时节点。
    const sink = document.createElement("textarea");
    sink.value = text;
    sink.setAttribute("readonly", "");
    sink.setAttribute(COPY_SINK_ATTR, "");
    sink.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";

    const container = document.body || document.documentElement;
    container.appendChild(sink);

    let copied = false;
    try {
      sink.focus({ preventScroll: true });
      sink.select();
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }

    sink.remove();
    return copied;
  }

  function isCopySink(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(element && typeof element.hasAttribute === "function" && element.hasAttribute(COPY_SINK_ATTR));
  }

  function isPanelEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path.includes(state.panel);
  }

  function isTextEntry(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const target = path[0] || event.target;

    if (!target || target.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const tag = target.localName;
    return tag === "input" || tag === "textarea" || target.isContentEditable === true;
  }

  function startPicking() {
    if (state.picking) {
      stopPicking();
      return;
    }

    state.picking = true;
    state.pickerNode = null;
    state.pickerPinned = false;
    state.pickerButton.classList.add("is-active");
    state.pickerLayer.classList.remove("is-hidden");

    // 从源码/设置视图进入拾取时回到结果视图；从 AI 视图进入则保留，
    // 因为拾取完通常要接着描述需求。
    if (state.view === "source" || state.view === "settings") {
      setPanelView("results");
    } else if (state.view === "results") {
      clearHighlights();
    }

    // 焦点必须从面板移到拾取层：否则按键事件的目标仍在面板内，
    // 会被 isPanelEvent 放行判断挡掉，↑↓ 调层级就会失效。
    state.pickerLayer.focus({ preventScroll: true });

    // 挂在 window 的捕获阶段：比页面自己在 document 上的捕获监听更早，能确保拦得住。
    window.addEventListener("pointermove", handlePickerMove, true);
    window.addEventListener("contextmenu", handlePickerContextMenu, true);
    window.addEventListener("keydown", handlePickerKey, true);
  }

  function stopPicking() {
    if (!state.picking) {
      return;
    }

    state.picking = false;
    state.pickerNode = null;
    state.pickerPinned = false;
    state.pickerButton.classList.remove("is-active");
    state.pickerLayer.classList.add("is-hidden");

    window.removeEventListener("pointermove", handlePickerMove, true);
    window.removeEventListener("contextmenu", handlePickerContextMenu, true);
    window.removeEventListener("keydown", handlePickerKey, true);
  }

  function handlePickerMove(event) {
    if (isPanelEvent(event)) {
      return;
    }

    state.pickerPoint.x = event.clientX;
    state.pickerPoint.y = event.clientY;

    if (!state.pickerPinned) {
      const element = getElementAtPoint(event);
      if (element) {
        state.pickerNode = element;
      }
    }

    renderPicker();
  }

  function handlePickerContextMenu(event) {
    // 左键和普通右键都放行给页面，只有 Ctrl + 右键才视为拾取
    if (isPanelEvent(event) || !event.ctrlKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // 直接用事件坐标重新取一次，避免刚进入拾取模式还没移动过鼠标时用到旧节点
    const node = getElementAtPoint(event) || state.pickerNode;
    if (!node) {
      return;
    }

    suppressFollowUpAuxClick();
    stopPicking();
    applyPickedNode(node);
  }

  function suppressFollowUpAuxClick() {
    // Ctrl + 右键后浏览器还会给页面补一个 auxclick，拾取本身不该被页面当成右键操作
    const blocker = (event) => {
      window.removeEventListener("auxclick", blocker, true);

      if (isPanelEvent(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("auxclick", blocker, true);

    window.setTimeout(() => {
      window.removeEventListener("auxclick", blocker, true);
    }, 400);
  }

  function handlePickerKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      stopPicking();
      return;
    }

    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }
    // 左键放行后用户可能点到页面输入框，这时方向键该归输入框
    if (isPanelEvent(event) || isTextEntry(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    stepPickerNode(event.key === "ArrowUp" ? -1 : 1);
  }

  function getElementAtPoint(event) {
    const stack = typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(event.clientX, event.clientY)
      : [document.elementFromPoint(event.clientX, event.clientY)];

    // 拾取层本身有 pointer-events，会作为最顶层命中外加宿主的影子边界，
    // 所以必须用 elementsFromPoint 拿到栈，再过滤掉插件自己的节点。
    return stack.find((node) => (
      node && node.nodeType === Node.ELEMENT_NODE && !isHelperNode(node)
    )) || null;
  }

  function stepPickerNode(direction) {
    if (direction < 0) {
      const parent = state.pickerNode ? state.pickerNode.parentElement : null;
      if (parent && parent.nodeType === Node.ELEMENT_NODE && !isHelperNode(parent)) {
        state.pickerNode = parent;
        state.pickerPinned = true;
        renderPicker();
      }
      return;
    }

    const child = state.pickerNode
      ? getChildAtPoint(state.pickerNode, state.pickerPoint)
      : null;

    if (child) {
      state.pickerNode = child;
    } else {
      state.pickerPinned = false;
    }

    renderPicker();
  }

  function getChildAtPoint(parent, point) {
    const stack = typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(point.x, point.y)
      : [];

    const innermost = stack.find((node) => (
      node && node !== parent && !isHelperNode(node) && parent.contains(node)
    ));

    if (!innermost) {
      return null;
    }

    // 回到 parent 的直接子元素，保证每次只下钻一层
    let current = innermost;
    while (current.parentElement && current.parentElement !== parent) {
      current = current.parentElement;
    }

    return current.parentElement === parent ? current : null;
  }

  function renderPicker() {
    const node = state.pickerNode;
    if (!node) {
      state.pickerBox.style.display = "none";
      state.pickerLabel.style.display = "none";
      return;
    }

    state.pickerCrossX.style.top = `${state.pickerPoint.y}px`;
    state.pickerCrossY.style.left = `${state.pickerPoint.x}px`;

    const rect = node.getBoundingClientRect();

    state.pickerBox.style.display = "";
    state.pickerBox.style.left = `${rect.left}px`;
    state.pickerBox.style.top = `${rect.top}px`;
    state.pickerBox.style.width = `${Math.max(rect.width, 0)}px`;
    state.pickerBox.style.height = `${Math.max(rect.height, 0)}px`;

    state.pickerLabel.style.display = "";
    state.pickerTitle.textContent =
      `${describeElement(node)}  ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    state.pickerPath.textContent = getNodeXPath(node);

    positionPickerLabel(rect);
  }

  function describeElement(element) {
    const name = element.localName || "*";
    const id = element.getAttribute("id") || "";
    const rawClass = typeof element.className === "string" ? element.className : "";
    const classes = rawClass.trim().split(/\s+/).filter(Boolean).slice(0, 2);

    return `<${name}${id ? `#${id}` : ""}${classes.map((item) => `.${item}`).join("")}>`;
  }

  function positionPickerLabel(rect) {
    const offset = 12;
    const labelRect = state.pickerLabel.getBoundingClientRect();

    let left = state.pickerPoint.x + offset;
    let top = rect.bottom + offset;

    if (left + labelRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - labelRect.width - 8);
    }
    if (top + labelRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - labelRect.height - offset);
    }

    state.pickerLabel.style.left = `${left}px`;
    state.pickerLabel.style.top = `${top}px`;
  }

  function applyPickedNode(node) {
    // 拾取的元素同时也是 AI 对话的目标：意图由点击确定，比让模型猜可靠得多。
    setAiTarget(node);

    const expression = getElementXPath(node);
    if (expression) {
      state.restoreExpression = "";
      state.input.value = expression;
      resizeInputBox();
    }

    if (state.view === "ai") {
      evaluateCurrentXPath();
      setAiStatus(`已选择目标 ${describeElement(node)}，可以描述需求了`);
      state.aiInput.focus();
      return;
    }

    setPanelView("results");
    evaluateCurrentXPath();

    const index = state.results.indexOf(node);
    if (index >= 0) {
      activateResult(index);
    }
  }

  // ---------- AI 设置 ----------

  function getAiSettings() {
    return Object.assign({}, DEFAULT_AI_SETTINGS, state.aiSettings || {});
  }

  function loadAiSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(AI_SETTINGS_KEY, (data) => {
          state.aiSettings = Object.assign({}, DEFAULT_AI_SETTINGS, (data && data[AI_SETTINGS_KEY]) || {});
          resolve(state.aiSettings);
        });
      } catch {
        state.aiSettings = Object.assign({}, DEFAULT_AI_SETTINGS);
        resolve(state.aiSettings);
      }
    });
  }

  function saveAiSettings(next) {
    state.aiSettings = Object.assign({}, DEFAULT_AI_SETTINGS, next || {});
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [AI_SETTINGS_KEY]: state.aiSettings }, () => resolve(state.aiSettings));
      } catch {
        resolve(state.aiSettings);
      }
    });
  }

  function renderAiPresets() {
    state.settingsPresets.replaceChildren();

    const label = document.createElement("span");
    label.className = "xyh-field-label";
    label.textContent = "快速填充：";
    state.settingsPresets.append(label);

    AI_PRESETS.forEach((preset) => {
      state.settingsPresets.append(createMiniButton({
        action: `preset-${preset.id}`,
        className: "xyh-ghost-button",
        label: preset.label,
        title: `填入 ${preset.baseUrl} 与 ${preset.model}（模型名可自行修改）`,
        onClick: () => {
          fillSettingsForm(Object.assign(getAiSettings(), {
            baseUrl: preset.baseUrl,
            model: preset.model
          }));
          setSettingsStatus(`已填入 ${preset.label} 的地址和模型，别忘了保存`);
        }
      }));
    });
  }

  function fillSettingsForm(settings) {
    state.settingsPanel.querySelectorAll("[data-setting]").forEach((field) => {
      const value = settings[field.dataset.setting];
      field.value = value === undefined || value === null ? "" : String(value);
    });
  }

  function readSettingsForm() {
    const next = {};
    state.settingsPanel.querySelectorAll("[data-setting]").forEach((field) => {
      next[field.dataset.setting] = field.value.trim();
    });
    return next;
  }

  function setSettingsStatus(message, tone = "") {
    state.settingsStatus.textContent = message || "";
    state.settingsStatus.classList.toggle("is-ok", tone === "ok");
    state.settingsStatus.classList.toggle("is-bad", tone === "bad");
  }

  function toggleApiKeyVisibility() {
    const field = state.settingsPanel.querySelector('[data-setting="apiKey"]');
    const button = state.settingsPanel.querySelector('[data-action="settings-reveal"]');
    const hidden = field.type === "password";
    field.type = hidden ? "text" : "password";
    button.textContent = hidden ? "隐藏" : "显示";
  }

  function openSettings() {
    if (state.view === "settings") {
      setPanelView("ai");
      return;
    }

    fillSettingsForm(getAiSettings());
    setSettingsStatus("");
    setPanelView("settings");
  }

  function handleSettingsSave() {
    const next = readSettingsForm();

    if (next.temperature && !isValidTemperature(next.temperature)) {
      setSettingsStatus("温度需要是 0 ~ 2 之间的数字", "bad");
      return;
    }

    saveAiSettings(next).then(() => {
      setSettingsStatus("已保存", "ok");
      window.clearTimeout(state.settingsStatusTimer);
      state.settingsStatusTimer = window.setTimeout(() => setSettingsStatus(""), 2000);
    });
  }

  function isValidTemperature(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2;
  }

  async function testAiSettings() {
    const next = readSettingsForm();

    if (!next.baseUrl || !next.model) {
      setSettingsStatus("请先填写接口地址和模型", "bad");
      return;
    }

    state.settingsTestButton.classList.add("is-busy");
    state.settingsTestButton.textContent = "测试中…";
    setSettingsStatus("正在请求接口…");

    try {
      const reply = await requestAi({
        settings: next,
        messages: [
          { role: "system", content: "这是一个连通性测试。" },
          { role: "user", content: "只回复两个字：连接成功" }
        ]
      });

      const text = String(reply || "").trim();
      if (text) {
        setSettingsStatus(`连接正常，模型回复：${text.slice(0, 40)}`, "ok");
      } else {
        setSettingsStatus("接口有响应但没有返回内容", "bad");
      }
    } catch (error) {
      setSettingsStatus(`连接失败：${(error && error.message) || error}`, "bad");
    } finally {
      state.settingsTestButton.classList.remove("is-busy");
      state.settingsTestButton.textContent = "测试连接";
    }
  }

  // ---------- AI 对话 ----------

  function syncAiTarget() {
    const node = state.aiCapturedNode;

    if (!node) {
      state.aiTarget.textContent = "未选择目标元素";
      state.aiTarget.title = "";
      state.aiTarget.classList.add("is-empty");
      state.aiInput.disabled = true;
      state.aiInput.placeholder = "先点「选择目标」在页面上拾取元素";
      state.aiSendButton.disabled = true;
      return;
    }

    const description = describeElement(node);
    const info = state.aiCapturedInfo || {};
    state.aiTarget.textContent = description;
    state.aiTarget.title = info.structuralXPath || description;
    state.aiTarget.classList.remove("is-empty");
    state.aiInput.disabled = false;
    state.aiInput.placeholder = "描述要定位的内容，例如：这个卡片里的数值";
    state.aiSendButton.disabled = state.aiStreaming;
  }

  function setAiTarget(element) {
    state.aiCapturedNode = element;
    state.aiCapturedInfo = element ? buildCapturedInfo(element) : null;
    syncAiTarget();
  }

  function buildCapturedInfo(element) {
    const info = {
      tag: element.localName || "",
      id: element.getAttribute("id") || "",
      classes: Array.from(element.classList || []).slice(0, 10),
      attributes: {},
      text: normalizeWhitespace(getNodeText(element) || "").slice(0, AI_TARGET_TEXT_LIMIT),
      pageUrl: location.href,
      pageTitle: document.title,
      ancestors: [],
      structuralXPath: getElementXPath(element),
      matchCount: 0
    };

    Array.from(element.attributes).forEach((attribute) => {
      if (attribute.name === "style") {
        return;
      }
      info.attributes[attribute.name] = String(attribute.value).slice(0, 200);
    });

    // 祖先链带上文本片段：像「Expense 指标卡里的数值」这种需求，
    // 模型必须知道祖先上写了什么才可能定位对。
    let current = element.parentElement;
    let depth = 0;
    while (current && current.nodeType === Node.ELEMENT_NODE && !isHelperNode(current) && depth < 6) {
      info.ancestors.push({
        tag: current.localName || "",
        id: current.getAttribute("id") || "",
        classes: Array.from(current.classList || []).slice(0, 6),
        text: normalizeWhitespace(getNodeText(current) || "").slice(0, 80)
      });
      current = current.parentElement;
      depth += 1;
    }

    info.matchCount = matchNodes(info.structuralXPath).length;
    return info;
  }

  function setAiStatus(message) {
    state.aiStatus.textContent = message || "";
  }

  function resizeAiInputBox() {
    state.aiInput.style.height = "auto";
    state.aiInput.style.height = `${Math.min(state.aiInput.scrollHeight, 96)}px`;
  }

  function handleAiInputKey(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleAiSendClick();
    }
  }

  function handleAiSendClick() {
    if (state.aiStreaming) {
      stopAiRequest();
      return;
    }
    sendAiMessage();
  }

  function scrollAiThread() {
    state.aiThread.scrollTop = state.aiThread.scrollHeight;
  }

  function clearAiEmptyState() {
    const empty = state.aiThread.querySelector(".xyh-ai-empty");
    if (empty) {
      empty.remove();
    }
  }

  function renderAiEmptyState() {
    if (!state.aiThread.childElementCount) {
      const empty = document.createElement("div");
      empty.className = "xyh-ai-empty";

      const intro = document.createElement("div");
      intro.textContent = "用一句话描述你要定位的内容，AI 会基于捕获到的元素结构生成 XPath，并当场校验唯一性。";
      empty.append(intro);

      const steps = document.createElement("ol");
      ["点「选择目标」在页面上拾取元素", "描述需求，例如：这个卡片里的数值", "生成后自动校验，不唯一可一键收紧"].forEach((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        steps.append(item);
      });
      empty.append(steps);

      state.aiThread.append(empty);
    }
  }

  function appendAiMessage(role, text) {
    clearAiEmptyState();

    const message = document.createElement("div");
    message.className = `xyh-ai-msg is-${role}`;

    const body = document.createElement("div");
    body.className = "xyh-ai-text";
    body.textContent = String(text || "");
    message.append(body);

    state.aiThread.append(message);
    scrollAiThread();
    return message;
  }

  function startAiPending() {
    clearAiEmptyState();

    const message = document.createElement("div");
    message.className = "xyh-ai-msg is-assistant";

    const body = document.createElement("div");
    body.className = "xyh-ai-text";
    body.textContent = "正在生成…";
    message.append(body);

    state.aiThread.append(message);
    scrollAiThread();

    state.aiStreamMessage = message;
    state.aiStreamBody = body;
    state.aiStartedAt = performance.now();

    window.clearInterval(state.aiPendingTimer);
    state.aiPendingTimer = window.setInterval(() => {
      const seconds = (performance.now() - state.aiStartedAt) / 1000;
      body.textContent = `正在生成… ${seconds.toFixed(1)}s`;
    }, 200);
  }

  function stopAiPending() {
    window.clearInterval(state.aiPendingTimer);
    state.aiPendingTimer = 0;
  }

  function setAiStreaming(streaming) {
    state.aiStreaming = streaming;
    state.aiSendButton.textContent = streaming ? "停止" : "发送";
    state.aiSendButton.disabled = streaming ? false : !state.aiCapturedNode;
  }

  function stopAiRequest() {
    if (!state.aiPort) {
      return;
    }
    try {
      state.aiPort.postMessage({ type: "abort" });
    } catch {
      // 连接已断开，忽略
    }
  }

  function requestAi(options) {
    return new Promise((resolve, reject) => {
      let port;

      try {
        port = chrome.runtime.connect({ name: AI_PORT_NAME });
      } catch {
        reject(new Error("无法连接扩展后台，请在扩展管理页重新加载扩展"));
        return;
      }

      state.aiPort = port;
      let text = "";
      let settled = false;

      const finish = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        state.aiPort = null;
        try {
          port.disconnect();
        } catch {
          // 已断开，忽略
        }

        if (error) {
          reject(error);
        } else {
          resolve(text);
        }
      };

      port.onMessage.addListener((message) => {
        if (!message || typeof message !== "object") {
          return;
        }

        if (message.type === "delta") {
          text += message.text;
          if (options.onDelta) {
            options.onDelta(message.text, text);
          }
          return;
        }

        if (message.type === "done") {
          finish(null);
          return;
        }

        if (message.type === "aborted") {
          // 主动停止时保留已经收到的内容，交给上层判断能否解析
          finish(text ? null : new Error("已停止生成"));
          return;
        }

        if (message.type === "error") {
          finish(new Error(message.message || "AI 请求失败"));
        }
      });

      port.onDisconnect.addListener(() => {
        finish(text ? null : new Error("与扩展后台的连接中断，可以点「重新生成」重试"));
      });

      port.postMessage({
        type: "chat",
        payload: { settings: options.settings, messages: options.messages }
      });
    });
  }

  async function sendAiMessage() {
    if (state.aiStreaming) {
      return;
    }

    if (!state.aiCapturedInfo) {
      setAiStatus("请先点「选择目标」在页面上拾取元素");
      return;
    }

    const instruction = state.aiInput.value.trim();
    if (!instruction) {
      setAiStatus("请先描述你要定位的内容");
      state.aiInput.focus();
      return;
    }

    const settings = getAiSettings();
    if (!settings.baseUrl || !settings.model) {
      setAiStatus("请先完成 AI 配置");
      openSettings();
      return;
    }

    appendAiMessage("user", instruction);
    state.aiMessages.push({ role: "user", content: instruction });

    state.aiInput.value = "";
    resizeAiInputBox();
    setAiStatus("");
    setAiStreaming(true);
    startAiPending();

    try {
      const reply = await requestAi({
        settings,
        messages: buildAiMessages(),
        onDelta: (_delta, full) => {
          // 响应体是 JSON，直接流式渲染可读性很差，
          // 所以只把增量当作进度信号，完成后再渲染成结构化卡片。
          if (state.aiStreamBody) {
            const seconds = (performance.now() - state.aiStartedAt) / 1000;
            state.aiStreamBody.textContent = `正在生成… ${seconds.toFixed(1)}s`;
          }
          return full;
        }
      });

      const parsed = parseAiReply(reply);

      if (parsed.xpath) {
        const note = renderAiReply(parsed);
        state.aiMessages.push({ role: "assistant", content: reply, note });
        setAiStatus("");
      } else {
        renderAiFailure("AI 返回的内容里没有可用的 XPath。", parsed.raw || reply);
        state.aiMessages.pop();
        setAiStatus("没有识别出可用的 XPath，试试把需求描述得更具体");
      }
    } catch (error) {
      const message = (error && error.message) || String(error);
      renderAiFailure(`请求失败：${message}`);
      state.aiMessages.pop();
      setAiStatus("AI 请求失败，可展开设置检查配置");
    } finally {
      stopAiPending();
      setAiStreaming(false);
    }
  }

  function renderAiFailure(text) {
    const bubble = state.aiStreamMessage;
    if (!bubble) {
      appendAiMessage("error", text);
      return;
    }

    bubble.className = "xyh-ai-msg is-error";
    bubble.replaceChildren();
    const body = document.createElement("div");
    body.className = "xyh-ai-text";
    body.textContent = String(text);
    bubble.append(body);
    scrollAiThread();
  }

  function renderAiReply(parsed) {
    const bubble = state.aiStreamMessage || appendAiMessage("assistant", "");
    bubble.className = "xyh-ai-msg is-assistant";
    bubble.replaceChildren();

    const reason = document.createElement("div");
    reason.className = "xyh-ai-text";
    reason.textContent = parsed.reason || "已生成 XPath";
    bubble.append(reason);

    const code = document.createElement("div");
    code.className = "xyh-ai-code";
    code.textContent = parsed.xpath;
    bubble.append(code);

    // 关键一步：立即在真实页面上执行，把校验结果直接摆在对话里。
    // 模型自己无法判断唯一性，只有 document.evaluate 能。
    const nodes = matchNodes(parsed.xpath);
    const check = document.createElement("div");
    check.className = "xyh-ai-check";

    const verdict = document.createElement("span");
    verdict.className = `xyh-verdict ${getVerdictClass(nodes.length)}`;
    verdict.textContent = getVerdictLabel(nodes.length);
    check.append(verdict);

    const meta = document.createElement("span");
    meta.className = "xyh-ai-check-meta";
    meta.textContent = nodes.length ? `在当前页面上匹配 ${nodes.length} 个节点` : "在当前页面上没有匹配到节点";
    check.append(meta);
    bubble.append(check);

    const actions = document.createElement("div");
    actions.className = "xyh-ai-actions";

    if (nodes.length) {
      actions.append(createMiniButton({
        action: "ai-apply",
        className: "xyh-primary-button",
        label: "填入输入框",
        title: "填入顶部输入框并查看匹配结果",
        onClick: () => applyAiXPath(parsed.xpath)
      }));
    }

    if (nodes.length > 1 && state.aiCapturedNode && nodes.includes(state.aiCapturedNode)) {
      actions.append(createMiniButton({
        action: "ai-tighten",
        className: "xyh-tighten",
        label: "收紧到捕获的元素",
        title: "在这个表达式的基础上收紧，使其只匹配你捕获的那个元素",
        onClick: () => tightenAiXPath(parsed.xpath, nodes)
      }));
    }

    actions.append(createMiniButton({
      action: "ai-copy",
      className: "xyh-ghost-button",
      label: "复制",
      title: "复制表达式到剪贴板",
      onClick: async (event) => {
        const button = event.currentTarget;
        const copied = await copyText(parsed.xpath);
        button.textContent = copied ? "已复制" : "复制失败";
        window.setTimeout(() => {
          button.textContent = "复制";
        }, 1600);
      }
    }));

    bubble.append(actions);
    scrollAiThread();

    // 返回给上层的「执行结果备注」，会在下一轮作为系统提示回传给模型。
    // 模型自己看不到页面，不告诉它上一次的结果，它只会在同一个错思路上反复试。
    if (!nodes.length) {
      return "注意：上一条表达式在当前页面上匹配到 0 个节点，它是无效的。请换一种完全不同的定位思路，不要在原表达式上继续叠加条件。";
    }
    if (nodes.length === 1) {
      return "上一条表达式在当前页面上唯一匹配 1 个节点，是有效的。";
    }
    return `注意：上一条表达式在当前页面上匹配到 ${nodes.length} 个节点，不满足唯一性，请收窄条件。`;
  }

  function applyAiXPath(xpath) {
    state.restoreExpression = "";
    state.input.value = xpath;
    resizeInputBox();
    setPanelView("results");
    evaluateCurrentXPath();
  }

  function tightenAiXPath(xpath, nodes) {
    const target = state.aiCapturedNode;
    const index = nodes.indexOf(target);

    if (index < 0) {
      setAiStatus("该表达式没有匹配到你捕获的元素，无法收紧");
      return;
    }

    const tightened = findUniqueExpression(target, xpath, index);

    if (!tightened || tightened === xpath) {
      setAiStatus("无法自动收紧，试试在对话里补充更具体的描述");
      return;
    }

    state.aiMessages.push({ role: "assistant", content: tightened });
    applyAiXPath(tightened);
    setAiStatus("已收紧为唯一表达式");
  }

  function clearAiConversation() {
    state.aiMessages = [];
    state.aiThread.replaceChildren();
    renderAiEmptyState();
    setAiStatus("");
  }

  function regenerateAi() {
    if (state.aiStreaming) {
      return;
    }

    let index = -1;
    for (let cursor = state.aiMessages.length - 1; cursor >= 0; cursor -= 1) {
      if (state.aiMessages[cursor].role === "user") {
        index = cursor;
        break;
      }
    }

    if (index < 0) {
      setAiStatus("还没有可以重新生成的内容");
      return;
    }

    const instruction = state.aiMessages[index].content;
    state.aiMessages.splice(index, 1);

    // 把最后一条用户气泡及其后面的失败气泡一并移除，重发后会重新创建，
    // 避免对话里堆积一串失败记录。
    const userBubbles = state.aiThread.querySelectorAll(".xyh-ai-msg.is-user");
    const lastUserBubble = userBubbles[userBubbles.length - 1];
    if (lastUserBubble) {
      let node = lastUserBubble.nextElementSibling;
      while (node) {
        const next = node.nextElementSibling;
        node.remove();
        node = next;
      }
      lastUserBubble.remove();
    }

    state.aiInput.value = instruction;
    resizeAiInputBox();
    sendAiMessage();
  }

  function buildAiMessages() {
    const messages = [
      { role: "system", content: AI_SYSTEM_PROMPT },
      {
        role: "system",
        content: `目标元素的结构信息（JSON）：\n${JSON.stringify(state.aiCapturedInfo, null, 2)}`
      }
    ];

    state.aiMessages.slice(-AI_HISTORY_LIMIT).forEach((message) => {
      messages.push({ role: message.role, content: message.content });
      if (message.note) {
        messages.push({ role: "system", content: message.note });
      }
    });

    return messages;
  }

  function parseAiReply(content) {
    const raw = String(content || "").trim();
    let xpath = "";
    let reason = "";

    const jsonText = extractJsonObject(raw);
    if (jsonText) {
      const parsed = parseJsonSafe(jsonText);
      if (parsed && typeof parsed === "object") {
        const candidate = parsed.xpath ? stripCodeMarks(String(parsed.xpath)) : "";
        // 必须能在当前页面上真的求值通过才采信，否则宁可当作没解析出结果
        if (candidate && looksLikeXPath(candidate)) {
          xpath = candidate;
        }
        if (parsed.reason) {
          reason = String(parsed.reason).trim();
        }
      }
    }

    if (!xpath) {
      const fence = raw.match(/```(?:xpath|xml|html|javascript|js|text)?\s*([\s\S]*?)```/i);
      if (fence && looksLikeXPath(fence[1].trim())) {
        xpath = stripCodeMarks(fence[1]);
      }
    }

    if (!xpath) {
      const line = raw.split(/\r?\n/).map((item) => item.trim()).find((item) => looksLikeXPath(item));
      if (line) {
        xpath = stripCodeMarks(line);
      }
    }

    if (!xpath) {
      xpath = extractInlineXPath(raw);
    }

    return { xpath, reason, raw };
  }

  function extractInlineXPath(raw) {
    const startMatch = raw.match(/\/\/|\(/);
    if (!startMatch) {
      return "";
    }

    // 不能用「排除引号」的正则去截：//*[@id='x'] 里的引号是表达式的一部分，
    // 那样截出来永远是不完整的。改成从尾部按自然断点（空白 / 中文 / 中文标点）
    // 逐个回退，取第一个能真正求值通过的子串。
    const boundary = /[\s\u4e00-\u9fff，。；、？！：；“”‘’]/;
    const cutPoints = [raw.length];

    for (let index = raw.length - 1; index > startMatch.index && cutPoints.length < 20; index -= 1) {
      if (boundary.test(raw[index])) {
        cutPoints.push(index);
      }
    }

    for (const end of cutPoints) {
      const candidate = raw.slice(startMatch.index, end).trim();
      if (candidate && candidate.length <= 600 && looksLikeXPath(candidate)) {
        return candidate;
      }
    }

    return "";
  }

  function extractJsonObject(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return start >= 0 && end > start ? text.slice(start, end + 1) : "";
  }

  function parseJsonSafe(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function stripCodeMarks(value) {
    return String(value || "")
      .replace(/```[a-z]*/gi, "")
      .replace(/`/g, "")
      .trim();
  }

  function looksLikeXPath(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 600) {
      return false;
    }
    if (!/^[/(]|^\.\.?\//.test(text)) {
      return false;
    }

    // 用真实求值代替正则猜测：语法不合法或求值报错的一律不认
    try {
      document.evaluate(text, document, null, XPathResult.ANY_TYPE, null);
      return true;
    } catch {
      return false;
    }
  }

  function clearAll() {
    window.clearTimeout(state.inputTimer);
    state.results = [];
    state.activeIndex = -1;
    state.previewIndex = -1;
    state.resultCount = 0;
    state.resultStatusSuffix = "";
    state.lastExpression = "";
    state.restoreExpression = "";
    state.input.value = "";
    resizeInputBox();
    setStatus("");
    renderEmpty(EMPTY_HINT);
    setPanelView("results");
    clearHighlights();
    state.input.focus();
  }

  function resizeInputBox() {
    if (!state.input) {
      return;
    }

    state.input.style.height = "auto";
    state.input.style.height = `${Math.min(state.input.scrollHeight, 92)}px`;
  }

  function evaluateCurrentXPath() {
    const startedAt = performance.now();
    const expression = state.input.value.trim();
    state.lastExpression = expression;

    clearHighlights();
    state.results = [];
    state.activeIndex = -1;
    state.previewIndex = -1;
    state.resultCount = 0;
    state.resultStatusSuffix = "";

    if (!expression) {
      setStatus("");
      renderEmpty(EMPTY_HINT);
      return;
    }

    let normalized;
    try {
      normalized = evaluateXPath(expression);
    } catch {
      state.lastEvaluateMs = Math.max(1, Math.round(performance.now() - startedAt));
      setStatus("");
      renderEmpty("XPath 表达式无法解析，请检查语法");
      return;
    }

    state.lastEvaluateMs = Math.max(1, Math.round(performance.now() - startedAt));

    if (normalized.kind === "value") {
      setStatus(`表达式返回 ${normalized.valueType} · ${state.lastEvaluateMs}ms`);
      renderScalarResult(normalized);
      return;
    }

    state.results = normalized.nodes.slice(0, MAX_VISIBLE_RESULTS);
    state.resultCount = normalized.nodes.length;

    if (!normalized.nodes.length) {
      setResultStatus(0);
      renderEmpty("没有定位到节点");
      return;
    }

    const suffix = normalized.nodes.length > MAX_VISIBLE_RESULTS
      ? `，当前展示前 ${MAX_VISIBLE_RESULTS} 个`
      : "";
    state.resultStatusSuffix = suffix;
    setResultStatus(normalized.nodes.length, suffix);
    renderNodeResults();
    drawHighlights();
  }

  function evaluateXPath(expression) {
    try {
      const snapshot = document.evaluate(
        expression,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      const nodes = [];
      for (let index = 0; index < snapshot.snapshotLength; index += 1) {
        const node = snapshot.snapshotItem(index);
        if (node && !isHelperNode(node)) {
          nodes.push(node);
        }
      }
      return { kind: "nodes", nodes };
    } catch (snapshotError) {
      const result = document.evaluate(expression, document, null, XPathResult.ANY_TYPE, null);
      if (result.resultType === XPathResult.STRING_TYPE) {
        return { kind: "value", valueType: "字符串", value: result.stringValue };
      }
      if (result.resultType === XPathResult.NUMBER_TYPE) {
        return { kind: "value", valueType: "数字", value: String(result.numberValue) };
      }
      if (result.resultType === XPathResult.BOOLEAN_TYPE) {
        return { kind: "value", valueType: "布尔值", value: String(result.booleanValue) };
      }
      throw snapshotError;
    }
  }

  function isHelperNode(node) {
    if (!state.host) {
      return false;
    }
    if (node === state.host) {
      return true;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement || node.ownerElement;
    return element === state.host || Boolean(element && state.host.contains(element));
  }

  function setStatus(message) {
    state.status.replaceChildren();
    const text = document.createElement("span");
    text.textContent = message;
    state.status.append(text);
  }

  function setResultStatus(count, suffix = "") {
    state.status.replaceChildren();

    const main = document.createElement("span");
    main.className = "xyh-status-main";
    main.append("匹配 ");
    const strong = document.createElement("strong");
    if (count === 0) {
      strong.className = "is-zero";
    }
    strong.textContent = String(count);
    main.append(strong, ` 个节点${suffix}`);

    const separator = document.createElement("span");
    separator.className = "xyh-status-separator";
    separator.textContent = "·";

    const ms = document.createElement("span");
    ms.textContent = `${state.lastEvaluateMs}ms`;

    const verdict = document.createElement("span");
    verdict.className = `xyh-verdict ${getVerdictClass(count)}`;
    verdict.textContent = getVerdictLabel(count);
    verdict.title = getVerdictTitle(count);

    const actions = document.createElement("div");
    actions.className = "xyh-status-actions";

    if (count > 1 && state.activeIndex >= 0) {
      actions.append(createMiniButton({
        action: "tighten",
        className: "xyh-tighten",
        label: "收紧为唯一",
        title: "根据当前选中的结果，自动生成只匹配该节点的表达式",
        onClick: tightenToUnique
      }));
    }

    if (state.restoreExpression) {
      actions.append(createMiniButton({
        action: "restore",
        className: "xyh-cancel-location",
        label: "还原原表达式",
        title: `还原为 ${state.restoreExpression}`,
        onClick: restorePreviousExpression
      }));
    }

    if (state.activeIndex >= 0) {
      actions.append(createMiniButton({
        action: "cancel-location",
        className: "xyh-cancel-location",
        label: "取消定位",
        title: "取消当前选中的结果",
        onClick: cancelLocation
      }));
    }

    state.status.append(main, separator, ms, verdict);
    if (actions.childElementCount) {
      state.status.append(actions);
    }
  }

  function createMiniButton(options) {
    const button = document.createElement("button");
    button.className = options.className;
    button.type = "button";
    button.textContent = options.label;
    button.title = options.title;
    button.dataset.action = options.action;
    button.addEventListener("click", options.onClick);
    return button;
  }

  function getVerdictClass(count) {
    if (count === 0) {
      return "is-missing";
    }
    return count === 1 ? "is-unique" : "is-ambiguous";
  }

  function getVerdictLabel(count) {
    if (count === 0) {
      return "无匹配";
    }
    return count === 1 ? "唯一" : "不唯一";
  }

  function getVerdictTitle(count) {
    if (count === 0) {
      return "当前表达式没有匹配到任何节点";
    }
    if (count === 1) {
      return "当前表达式唯一匹配 1 个节点，可以直接使用";
    }
    return `当前表达式匹配 ${count} 个节点，不满足唯一性。点选一个结果后可一键收紧`;
  }

  function tightenToUnique() {
    const target = state.results[state.activeIndex];
    if (!target) {
      return;
    }

    const expression = state.lastExpression;
    const tightened = findUniqueExpression(target, expression, state.activeIndex);

    if (!tightened || tightened === expression) {
      setStatus("无法自动收紧，请手动补充条件");
      return;
    }

    state.restoreExpression = expression;
    state.input.value = tightened;
    resizeInputBox();
    evaluateCurrentXPath();

    if (state.results.length === 1) {
      activateResult(0);
    }
  }

  function restorePreviousExpression() {
    if (!state.restoreExpression) {
      return;
    }

    state.input.value = state.restoreExpression;
    state.restoreExpression = "";
    resizeInputBox();
    evaluateCurrentXPath();
  }

  function findUniqueExpression(target, expression, targetIndex) {
    const element = getRenderableNode(target);
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    // 依次尝试三种收紧方式，每一种都必须通过实际求值验证，验证不通过就降级。
    const byAttribute = findAttributeRefinement(expression, element, target);
    if (byAttribute) {
      return byAttribute;
    }

    const anchored = getElementXPath(element);
    if (anchored && matchesExactly(anchored, target)) {
      return anchored;
    }

    const byIndex = `(${expression})[${targetIndex + 1}]`;
    return matchesExactly(byIndex, target) ? byIndex : "";
  }

  function findAttributeRefinement(expression, element, target) {
    const attributes = Array.from(element.attributes)
      .filter((attribute) => attribute.value && attribute.name !== "style")
      .sort((a, b) => getAttributePriority(a.name) - getAttributePriority(b.name))
      .slice(0, MAX_REFINE_ATTRIBUTES);

    for (const attribute of attributes) {
      const candidate = `${expression}${formatAttributePredicate(attribute)}`;
      if (matchesExactly(candidate, target)) {
        return candidate;
      }
    }

    for (let first = 0; first < attributes.length; first += 1) {
      for (let second = first + 1; second < attributes.length; second += 1) {
        const candidate = `${expression}`
          + `${formatAttributePredicate(attributes[first])}`
          + `${formatAttributePredicate(attributes[second])}`;
        if (matchesExactly(candidate, target)) {
          return candidate;
        }
      }
    }

    return "";
  }

  function formatAttributePredicate(attribute) {
    return `[@${attribute.name}=${escapeXPathLiteral(attribute.value)}]`;
  }

  function getAttributePriority(name) {
    if (name === "id") {
      return 0;
    }
    if (name === "name") {
      return 1;
    }
    if (name.startsWith("data-")) {
      return 2;
    }
    if (name === "class") {
      return 5;
    }
    return 3;
  }

  function matchNodes(expression) {
    try {
      const result = evaluateXPath(expression);
      return result.kind === "nodes" ? result.nodes : [];
    } catch {
      return [];
    }
  }

  function matchesExactly(expression, node) {
    const nodes = matchNodes(expression);
    return nodes.length === 1 && nodes[0] === node;
  }

  function renderEmpty(message) {
    state.resultsList.replaceChildren();

    if (!message) {
      return;
    }

    const empty = document.createElement("div");
    empty.className = "xyh-empty is-simple";
    empty.textContent = message;
    state.resultsList.append(empty);
  }

  function renderScalarResult(result) {
    state.resultsList.replaceChildren();
    const card = document.createElement("article");
    card.className = "xyh-card";

    const header = document.createElement("div");
    header.className = "xyh-card-header";

    const title = document.createElement("div");
    title.className = "xyh-card-title";
    title.textContent = result.valueType;

    header.append(title);

    const body = document.createElement("div");
    body.className = "xyh-card-body";
    body.append(createTextPreview(result.value || "(空字符串)"));

    card.append(header, body);
    state.resultsList.append(card);
  }

  function renderNodeResults() {
    state.resultsList.replaceChildren();
    state.idCountCache = null;
    state.results.forEach((node, index) => {
      const card = document.createElement("article");
      card.className = "xyh-card";
      if (index === state.activeIndex) {
        card.classList.add("is-active");
      }

      const header = document.createElement("div");
      header.className = "xyh-card-header";

      const titleRow = document.createElement("div");
      titleRow.className = "xyh-card-title-row";

      const title = document.createElement("div");
      title.className = "xyh-card-title";
      title.textContent = `${index + 1}. ${getNodeTitle(node)}`;

      titleRow.append(title);

      if (node.nodeType !== Node.ELEMENT_NODE) {
        const type = document.createElement("div");
        type.className = `xyh-card-type ${getNodeTypeClass(node)}`;
        type.textContent = getNodeTypeLabel(node);
        titleRow.append(type);
      }

      header.append(titleRow);

      const body = document.createElement("div");
      body.className = "xyh-card-body";

      const meta = document.createElement("div");
      meta.className = "xyh-card-meta";
      appendMetaRow(meta, "路径", getNodeXPath(node), { limit: 300 });
      appendMetaRow(meta, "源码", getNodeSource(node), { source: true, limit: 600 });
      body.append(meta);

      body.append(
        createTextPreview(normalizeWhitespace(getNodeText(node)) || "(无文本内容)")
      );

      card.addEventListener("click", (event) => {
        if (!closestElement(event.target, "button")) {
          activateResult(index);
        }
      });
      card.addEventListener("pointerenter", () => previewResult(index));
      card.addEventListener("pointerleave", () => clearPreview(index));

      card.append(header, body);
      state.resultsList.append(card);
    });
  }

  function appendMetaRow(parent, labelText, value, options = {}) {
    const label = document.createElement("span");
    label.className = "xyh-meta-label";
    label.textContent = labelText;

    const content = document.createElement("div");
    content.className = "xyh-meta-value";
    if (options.source) {
      content.classList.add("is-source");
    }

    const raw = cleanPreviewText(value);
    const preview = truncate(raw, options.limit || 600);

    if (preview) {
      content.textContent = preview;
      if (preview !== raw && raw.length <= 400) {
        content.title = raw;
      }
    } else {
      content.classList.add("is-empty");
      content.textContent = "（无）";
    }

    parent.append(label, content);
  }

  function createTextPreview(text) {
    const block = document.createElement("div");
    block.className = "xyh-text-preview";
    block.textContent = truncate(cleanPreviewText(text), 800);
    return block;
  }

  function activateResult(index) {
    const node = state.results[index];
    if (!node) {
      return;
    }

    state.activeIndex = index;
    state.previewIndex = -1;
    renderNodeResults();
    setResultStatus(state.resultCount, state.resultStatusSuffix);
    drawHighlights();
    scrollNodeIntoView(node);
    avoidPanelCoveringNode(node);
  }

  function previewResult(index) {
    if (!state.results[index]) {
      return;
    }

    state.previewIndex = index;
    drawHighlights();
  }

  function clearPreview(index) {
    if (state.previewIndex !== index) {
      return;
    }

    state.previewIndex = -1;
    drawHighlights();
  }

  function cancelLocation() {
    state.activeIndex = -1;
    state.previewIndex = -1;
    renderNodeResults();
    setResultStatus(state.resultCount, state.resultStatusSuffix);
    drawHighlights();
  }

  function scrollNodeIntoView(node) {
    const target = getScrollTarget(node);
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    }
  }

  function getScrollTarget(node) {
    const target = getRenderableNode(node);
    if (!target || target.nodeType !== Node.ELEMENT_NODE) {
      return target;
    }

    if (isRenderableRect(target.getBoundingClientRect())) {
      return target;
    }

    return findFirstRenderableDescendant(target) || target;
  }

  function avoidPanelCoveringNode(node) {
    window.setTimeout(() => {
      const targetRect = getBestVisibleRect(node);
      if (!targetRect) {
        return;
      }

      const panelRect = state.panel.getBoundingClientRect();
      if (!rectsOverlap(panelRect, targetRect, 12)) {
        drawHighlights();
        return;
      }

      const nextPosition = findPanelPositionAwayFromRect(panelRect, targetRect);
      if (!nextPosition) {
        drawHighlights();
        return;
      }

      movePanel(nextPosition.left, nextPosition.top, true);
      savePanelPosition();
      drawHighlights();
    }, 260);
  }

  function getBestVisibleRect(node) {
    const rects = getNodeRects(node)
      .map((rect) => ({
        left: Math.max(rect.left, 0),
        top: Math.max(rect.top, 0),
        right: Math.min(rect.right, window.innerWidth),
        bottom: Math.min(rect.bottom, window.innerHeight)
      }))
      .map((rect) => ({
        ...rect,
        width: Math.max(0, rect.right - rect.left),
        height: Math.max(0, rect.bottom - rect.top)
      }))
      .filter((rect) => rect.width >= 1 && rect.height >= 1);

    if (!rects.length) {
      return null;
    }

    return rects.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  }

  function findPanelPositionAwayFromRect(panelRect, targetRect) {
    const margin = 16;
    const bounds = getPanelBounds(panelRect.width, panelRect.height, margin);
    const current = { left: panelRect.left, top: panelRect.top };
    const candidates = [
      {
        left: targetRect.right + margin,
        top: targetRect.top
      },
      {
        left: targetRect.left - panelRect.width - margin,
        top: targetRect.top
      },
      {
        left: targetRect.left,
        top: targetRect.bottom + margin
      },
      {
        left: targetRect.left,
        top: targetRect.top - panelRect.height - margin
      },
      { left: bounds.minLeft, top: bounds.minTop },
      { left: bounds.maxLeft, top: bounds.minTop },
      { left: bounds.minLeft, top: bounds.maxTop },
      { left: bounds.maxLeft, top: bounds.maxTop }
    ]
      .map((candidate) => clampPanelPosition(candidate.left, candidate.top, panelRect.width, panelRect.height, margin))
      .filter((candidate, index, list) => (
        list.findIndex((item) => item.left === candidate.left && item.top === candidate.top) === index
      ));

    const ranked = candidates
      .map((candidate) => ({
        ...candidate,
        rect: {
          left: candidate.left,
          top: candidate.top,
          right: candidate.left + panelRect.width,
          bottom: candidate.top + panelRect.height
        },
        distance: Math.hypot(candidate.left - current.left, candidate.top - current.top)
      }))
      .filter((candidate) => !rectsOverlap(candidate.rect, targetRect, 12))
      .sort((a, b) => a.distance - b.distance);

    if (ranked.length) {
      return ranked[0];
    }

    return null;
  }

  function rectsOverlap(a, b, padding = 0) {
    return !(
      a.right + padding <= b.left ||
      a.left - padding >= b.right ||
      a.bottom + padding <= b.top ||
      a.top - padding >= b.bottom
    );
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function clampPanelPosition(left, top, width, height, preferredMargin) {
    const bounds = getPanelBounds(width, height, preferredMargin);
    return {
      left: clamp(left, bounds.minLeft, bounds.maxLeft),
      top: clamp(top, bounds.minTop, bounds.maxTop)
    };
  }

  function getPanelBounds(width, height, preferredMargin) {
    const horizontalSpace = Math.max(0, window.innerWidth - width);
    const verticalSpace = Math.max(0, window.innerHeight - height);
    const horizontalMargin = Math.min(preferredMargin, horizontalSpace / 2);
    const verticalMargin = Math.min(preferredMargin, verticalSpace / 2);

    return {
      minLeft: horizontalMargin,
      maxLeft: Math.max(horizontalMargin, window.innerWidth - width - horizontalMargin),
      minTop: verticalMargin,
      maxTop: Math.max(verticalMargin, window.innerHeight - height - verticalMargin)
    };
  }

  function getRenderableNode(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      return node;
    }
    if (node.nodeType === Node.ATTRIBUTE_NODE) {
      return node.ownerElement;
    }
    return node.parentElement || null;
  }

  function scheduleHighlightDraw() {
    if (!state.visible || !state.results.length) {
      return;
    }
    window.clearTimeout(state.drawTimer);
    state.drawTimer = window.setTimeout(drawHighlights, SCROLL_DEBOUNCE_MS);
  }

  function drawHighlights() {
    clearHighlights();

    if (state.view !== "results") {
      return;
    }

    const highlightedIndex = getHighlightedIndex();

    state.results.forEach((node, index) => {
      const isHighlighted = index === highlightedIndex;
      getNodeRects(node).forEach((rect) => {
        const box = createHighlightBox(rect, isHighlighted);
        if (box) {
          state.highlightLayer.append(box);
        }
      });
    });
  }

  function createHighlightBox(rect, isHighlighted) {
    const left = clamp(rect.left, 0, window.innerWidth);
    const top = clamp(rect.top, 0, window.innerHeight);
    const right = clamp(rect.right, 0, window.innerWidth);
    const bottom = clamp(rect.bottom, 0, window.innerHeight);

    if (right - left < 1 || bottom - top < 1) {
      return null;
    }

    const box = document.createElement("div");
    box.className = `xyh-highlight-box${isHighlighted ? " is-active" : ""}`;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${right - left}px`;
    box.style.height = `${bottom - top}px`;
    return box;
  }

  function getHighlightedIndex() {
    return state.previewIndex >= 0 ? state.previewIndex : state.activeIndex;
  }

  function clearHighlights() {
    if (state.highlightLayer) {
      state.highlightLayer.replaceChildren();
    }
  }

  function getNodeRects(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      return getElementRects(node);
    }

    if (node.nodeType === Node.ATTRIBUTE_NODE && node.ownerElement) {
      return getElementRects(node.ownerElement);
    }

    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) {
      const range = document.createRange();
      range.selectNode(node);
      const rects = Array.from(range.getClientRects());
      range.detach();
      return rects;
    }

    const target = getRenderableNode(node);
    return target ? getElementRects(target) : [];
  }

  function getElementRects(element) {
    const ownRect = element.getBoundingClientRect();
    if (isRenderableRect(ownRect)) {
      return [ownRect];
    }

    const descendantRects = getRenderableDescendantRects(element);
    if (!descendantRects.length) {
      return [ownRect];
    }

    return [mergeNearbyRects(descendantRects)];
  }

  function mergeNearbyRects(rects) {
    const pending = [...rects].sort((a, b) => b.width * b.height - a.width * a.height);
    let cluster = pending.shift();

    let extended = true;
    while (extended && pending.length) {
      extended = false;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        if (isNearRect(pending[index], cluster, RECT_JOIN_GAP)) {
          cluster = mergeRects([cluster, pending[index]]);
          pending.splice(index, 1);
          extended = true;
        }
      }
    }

    return cluster;
  }

  function isNearRect(rect, target, gap) {
    return !(
      rect.right + gap < target.left ||
      rect.left - gap > target.right ||
      rect.bottom + gap < target.top ||
      rect.top - gap > target.bottom
    );
  }

  function getRenderableDescendantRects(element) {
    const rects = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode();

    while (current && rects.length < 80) {
      if (!isHelperNode(current)) {
        const rect = current.getBoundingClientRect();
        if (isRenderableRect(rect)) {
          rects.push(rect);
        }
      }
      current = walker.nextNode();
    }

    return rects;
  }

  function findFirstRenderableDescendant(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode();

    while (current) {
      if (!isHelperNode(current) && isRenderableRect(current.getBoundingClientRect())) {
        return current;
      }
      current = walker.nextNode();
    }

    return null;
  }

  function isRenderableRect(rect) {
    return rect.width >= 1 && rect.height >= 1;
  }

  function mergeRects(rects) {
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));

    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top
    };
  }

  function getNodeTitle(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      return node.tagName.toLowerCase();
    }

    if (node.nodeType === Node.ATTRIBUTE_NODE) {
      return `@${node.name}`;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return "text()";
    }

    if (node.nodeType === Node.COMMENT_NODE) {
      return "comment()";
    }

    return node.nodeName;
  }

  function getNodeXPath(node) {
    if (!node) {
      return "";
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      return getElementXPath(node);
    }

    if (node.nodeType === Node.ATTRIBUTE_NODE) {
      return node.ownerElement
        ? `${getElementXPath(node.ownerElement)}/@${node.name}`
        : `@${node.name}`;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return appendChildStep(node, `text()[${getTextNodeIndex(node)}]`);
    }

    if (node.nodeType === Node.COMMENT_NODE) {
      return appendChildStep(node, `comment()[${getCommentNodeIndex(node)}]`);
    }

    return "";
  }

  function appendChildStep(node, step) {
    const parent = node.parentNode;
    if (!parent || parent.nodeType !== Node.ELEMENT_NODE) {
      return `/${step}`;
    }
    return `${getElementXPath(parent)}/${step}`;
  }

  function getElementXPath(element) {
    const segments = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const anchor = getIdAnchor(current);
      if (anchor) {
        return segments.length ? `${anchor}/${segments.join("/")}` : anchor;
      }
      segments.unshift(formatElementStep(current));
      current = current.parentElement;
    }

    return segments.length ? `/${segments.join("/")}` : "";
  }

  function getIdAnchor(element) {
    const id = element.getAttribute("id");
    if (id && getElementIdCount(id) === 1) {
      return `//*[@id=${escapeXPathLiteral(id)}]`;
    }
    return "";
  }

  function getElementIdCount(id) {
    if (!state.idCountCache) {
      state.idCountCache = new Map();
    }
    if (state.idCountCache.has(id)) {
      return state.idCountCache.get(id);
    }

    let count = 0;
    try {
      count = document.querySelectorAll(`[id="${escapeCssString(id)}"]`).length;
    } catch {
      count = 0;
    }

    state.idCountCache.set(id, count);
    return count;
  }

  function formatElementStep(element) {
    const name = element.localName || "*";
    const siblings = getSameNameSiblings(element);
    if (siblings.length <= 1) {
      return name;
    }
    return `${name}[${siblings.indexOf(element) + 1}]`;
  }

  function getSameNameSiblings(element) {
    const parent = element.parentElement;
    if (!parent) {
      return [element];
    }
    const name = element.localName;
    return Array.from(parent.children).filter((child) => child.localName === name);
  }

  function getTextNodeIndex(node) {
    const parent = node.parentNode;
    if (!parent) {
      return 1;
    }

    let index = 0;
    let inTextRun = false;

    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!inTextRun) {
          index += 1;
          inTextRun = true;
        }
        if (child === node) {
          return index;
        }
      } else {
        inTextRun = false;
      }
    }

    return index || 1;
  }

  function getCommentNodeIndex(node) {
    let index = 1;
    let sibling = node.previousSibling;

    while (sibling) {
      if (sibling.nodeType === Node.COMMENT_NODE) {
        index += 1;
      }
      sibling = sibling.previousSibling;
    }

    return index;
  }

  function escapeXPathLiteral(value) {
    const text = String(value == null ? "" : value);
    if (!text.includes("'")) {
      return `'${text}'`;
    }
    if (!text.includes('"')) {
      return `"${text}"`;
    }

    const parts = text.split("'").map((part) => `'${part}'`);
    return `concat(${parts.join(", \"'\", ")})`;
  }

  function escapeCssString(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function getNodeTypeLabel(node) {
    const labels = {
      [Node.ELEMENT_NODE]: "元素节点",
      [Node.ATTRIBUTE_NODE]: "属性节点",
      [Node.TEXT_NODE]: "文本节点",
      [Node.CDATA_SECTION_NODE]: "CDATA 节点",
      [Node.COMMENT_NODE]: "注释节点",
      [Node.DOCUMENT_NODE]: "文档节点"
    };
    return labels[node.nodeType] || `节点类型 ${node.nodeType}`;
  }

  function getNodeTypeClass(node) {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) {
      return "is-text";
    }
    if (node.nodeType === Node.ATTRIBUTE_NODE) {
      return "is-attribute";
    }
    return "";
  }

  function getNodeText(node) {
    if (node.nodeType === Node.ATTRIBUTE_NODE) {
      return node.value;
    }
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) {
      const value = node.nodeValue || "";
      return value.includes(HELPER_GLOBAL) ? "" : value;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.localName ? node.localName.toLowerCase() : "";
      if (tag === "script" || tag === "style" || tag === "noscript") {
        return "";
      }
      const value = node.textContent || "";
      return value.includes(HELPER_GLOBAL) ? "" : value;
    }
    return node.textContent || "";
  }

  function getNodeSource(node) {
    if (node.nodeType === Node.ATTRIBUTE_NODE) {
      return `${node.name}="${node.value}"`;
    }

    if (node.nodeType === Node.COMMENT_NODE) {
      return `<!--${node.nodeValue || ""}-->`;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      return getElementSource(node);
    }

    const parent = node.parentElement;
    if (parent) {
      return getElementSource(parent);
    }

    return node.nodeValue || "";
  }

  function getElementSource(element) {
    if (element.getElementsByTagName("*").length <= MAX_SOURCE_DESCENDANTS) {
      return element.outerHTML || getElementStartTag(element);
    }

    return `${getElementStartTag(element)}…`;
  }

  function getElementStartTag(element) {
    const name = element.localName || element.tagName.toLowerCase();
    const attributes = Array.from(element.attributes)
      .map((attribute) => `${attribute.name}="${attribute.value}"`)
      .join(" ");

    return attributes ? `<${name} ${attributes}>` : `<${name}>`;
  }

  function normalizeWhitespace(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function cleanPreviewText(text) {
    return String(text || "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uE000-\uF8FF\uFEFF\uFFFC\uFFFD]/g, "")
      .replace(/^[\s□▢▯■▪▫]+/, "")
      .trim();
  }

  function truncate(text, maxLength) {
    const value = String(text || "");
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)} …（已截断，原文共 ${value.length} 字符）`;
  }

  function closestElement(target, selector) {
    if (target instanceof Element) {
      return target.closest(selector);
    }
    return target && target.parentElement ? target.parentElement.closest(selector) : null;
  }

  window[HELPER_GLOBAL] = { toggle };
  createHelper();
  show();
})();
