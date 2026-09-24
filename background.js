const DEFAULT_TITLE = "打开 XPath AI 助手";
const NOTICE_COLOR = "#d97858";
const BLOCKED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "devtools://"
];

const AI_PORT_NAME = "xyh-ai";
const AI_REQUEST_TIMEOUT_MS = 90000;
// MV3 的 Service Worker 空闲 30 秒就会被回收，心跳必须明显小于这个值
const KEEPALIVE_INTERVAL_MS = 15000;

chrome.action.onClicked.addListener(async (tab) => {
  if (typeof tab.id !== "number") {
    return;
  }

  if (!tab.url || BLOCKED_URL_PREFIXES.some((prefix) => tab.url.startsWith(prefix))) {
    await showNotice(tab.id, "XPath AI 助手无法在浏览器内置页面运行，请在普通网页上使用。");
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    await clearNotice(tab.id);
  } catch (error) {
    console.warn("XPath AI 助手无法在当前页面打开。", error);
    await showNotice(
      tab.id,
      "XPath AI 助手无法在当前页面打开。若是本地文件页面，请在扩展详情中开启“允许访问文件网址”。"
    );
  }
});

async function showNotice(tabId, message) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: NOTICE_COLOR });
    await chrome.action.setBadgeText({ tabId, text: "!" });
    await chrome.action.setTitle({ tabId, title: message });
  } catch (error) {
    console.warn("XPath AI 助手无法更新扩展提示。", error);
  }
}

async function clearNotice(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: "" });
    await chrome.action.setTitle({ tabId, title: DEFAULT_TITLE });
  } catch (error) {
    console.warn("XPath AI 助手无法重置扩展提示。", error);
  }
}

// AI 请求必须在 Service Worker 里发：内容脚本受目标页面的 CSP 限制，
// 在页面上直接 fetch 第三方接口绝大多数站点会被拦掉。
// 这里用长连接（port）而不是一次性消息，是为了支持流式增量回传。
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== AI_PORT_NAME) {
    return;
  }

  // 这里必须持有 AbortController 本身，不能持有 runChat 返回的 Promise，
  // 否则 abort() 会抛 TypeError。
  let abortCurrent = null;

  port.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "abort") {
      if (abortCurrent) {
        abortCurrent();
      }
      return;
    }

    if (message.type === "chat") {
      if (abortCurrent) {
        abortCurrent();
      }

      const controller = new AbortController();
      abortCurrent = () => controller.abort();

      runChat(port, controller, message.payload).finally(() => {
        abortCurrent = null;
      });
    }
  });

  port.onDisconnect.addListener(() => {
    if (abortCurrent) {
      abortCurrent();
    }
  });
});

async function runChat(port, controller, payload) {
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  // 模型首字节可能要等十几秒甚至更久，这段时间没有任何消息往来，
  // Service Worker 会因空闲被回收，导致端口断开、请求半路失败。
  // 定期调一次扩展 API 可以重置空闲计时器。
  const keepAlive = setInterval(() => {
    try {
      chrome.runtime.getPlatformInfo(() => {});
    } catch {
      // 忽略
    }
  }, KEEPALIVE_INTERVAL_MS);

  try {
    const settings = (payload && payload.settings) || {};
    const messages = (payload && payload.messages) || [];

    const baseUrl = String(settings.baseUrl || "").trim();
    if (!baseUrl) {
      post(port, { type: "error", message: "未配置接口地址（Base URL）" });
      return;
    }
    if (!settings.model) {
      post(port, { type: "error", message: "未配置模型名称" });
      return;
    }
    if (!messages.length) {
      post(port, { type: "error", message: "没有可发送的对话内容" });
      return;
    }

    const headers = { "Content-Type": "application/json" };
    if (settings.apiKey) {
      headers.Authorization = `Bearer ${settings.apiKey}`;
    }

    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: String(settings.model),
        messages,
        temperature: toNumber(settings.temperature, 0.2),
        stream: true
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      post(port, { type: "error", message: describeHttpError(response.status, await readText(response)) });
      return;
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/event-stream") || !response.body) {
      // 部分网关会忽略 stream 参数直接返回完整 JSON，这里做兼容
      const content = extractMessageContent(parseJson(await readText(response)));
      if (!content) {
        post(port, { type: "error", message: "接口未返回可用内容" });
        return;
      }
      post(port, { type: "delta", text: content });
      post(port, { type: "done" });
      return;
    }

    await pipeStream(response.body, port);
    post(port, { type: "done" });
  } catch (error) {
    if (error && error.name === "AbortError") {
      post(port, { type: "aborted" });
    } else {
      post(port, { type: "error", message: String((error && error.message) || error) });
    }
  } finally {
    clearTimeout(timer);
    clearInterval(keepAlive);
  }
}

async function pipeStream(body, port) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let received = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      const payload = parseSseData(line);
      if (payload === null) {
        continue;
      }
      if (payload === "[DONE]") {
        return;
      }

      const parsed = parseJson(payload);
      if (parsed && parsed.error) {
        post(port, { type: "error", message: describeApiError(parsed.error) });
        return;
      }

      const delta = extractMessageContent(parsed, true);
      if (delta) {
        received = true;
        post(port, { type: "delta", text: delta });
      }
    }
  }

  // 兜底：流已结束但一个增量都没解析出来，尝试把残留内容当整块结果处理
  if (!received && buffer.trim()) {
    const delta = extractMessageContent(parseJson(buffer.trim()), true);
    if (delta) {
      post(port, { type: "delta", text: delta });
    }
  }
}

function parseSseData(line) {
  const trimmed = String(line).trim();
  if (!trimmed || trimmed.startsWith(":")) {
    return null;
  }
  if (!trimmed.startsWith("data:")) {
    return null;
  }
  return trimmed.slice(5).trim();
}

function extractMessageContent(data, isDelta = false) {
  if (!data || !data.choices || !data.choices.length) {
    return "";
  }

  const choice = data.choices[0];
  if (isDelta && choice.delta && typeof choice.delta.content === "string") {
    return choice.delta.content;
  }
  if (choice.message && typeof choice.message.content === "string") {
    return choice.message.content;
  }
  if (choice.delta && typeof choice.delta.content === "string") {
    return choice.delta.content;
  }
  if (typeof choice.text === "string") {
    return choice.text;
  }
  return "";
}

function describeHttpError(status, body) {
  const hint = status === 401 || status === 403
    ? "API Key 无效或没有权限"
    : status === 404
      ? "接口地址不对，应填到 /v1 这一层，不要带 /chat/completions"
      : status === 429
        ? "请求过于频繁或额度不足"
        : "";

  const detail = String(body || "").replace(/\s+/g, " ").slice(0, 300);
  return [`接口返回 ${status}`, hint, detail].filter(Boolean).join(" · ");
}

function describeApiError(error) {
  if (typeof error === "string") {
    return error;
  }
  if (error && error.message) {
    return String(error.message);
  }
  return "接口返回错误";
}

async function readText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function post(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // port 已断开，忽略
  }
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
