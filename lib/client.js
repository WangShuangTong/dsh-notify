window.__ModuleLoader__.load({ id: "dsh-notify", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/config.ts
var DEFAULT_NOTIFY_CONFIG = {
  notifyOnAsk: true,
  notifyOnDone: true,
  notifyOnError: true,
  sound: true,
  onlyWhenUnfocused: true,
  announce: true,
  askAutoCloseMs: 6e4,
  doneAutoCloseMs: 15e3,
  transport: "auto",
  debug: false
};
var ASK_CLOSE_MAX = 6e5;
var DONE_CLOSE_MAX = 3e5;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readBoolean(source, key, fallback, warn2) {
  const value = source[key];
  if (value === void 0) return fallback;
  if (typeof value === "boolean") return value;
  warn2(`config.${key} must be a boolean; using ${String(fallback)}`);
  return fallback;
}
function readCloseMs(source, key, fallback, max, warn2) {
  const value = source[key];
  if (value === void 0) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    warn2(`config.${key} must be a non-negative number; using ${String(fallback)}`);
    return fallback;
  }
  return Math.min(Math.trunc(value), max);
}
function readTransport(source, fallback, warn2) {
  const value = source.transport;
  if (value === void 0) return fallback;
  if (value === "auto" || value === "popup" || value === "browser") return value;
  warn2(`config.transport must be one of auto, popup, browser; using ${fallback}`);
  return fallback;
}
function normalizeNotifyConfig(raw, warn2) {
  const source = isRecord(raw) ? raw : {};
  return {
    notifyOnAsk: readBoolean(source, "notifyOnAsk", DEFAULT_NOTIFY_CONFIG.notifyOnAsk, warn2),
    notifyOnDone: readBoolean(source, "notifyOnDone", DEFAULT_NOTIFY_CONFIG.notifyOnDone, warn2),
    notifyOnError: readBoolean(source, "notifyOnError", DEFAULT_NOTIFY_CONFIG.notifyOnError, warn2),
    sound: readBoolean(source, "sound", DEFAULT_NOTIFY_CONFIG.sound, warn2),
    onlyWhenUnfocused: readBoolean(source, "onlyWhenUnfocused", DEFAULT_NOTIFY_CONFIG.onlyWhenUnfocused, warn2),
    announce: readBoolean(source, "announce", DEFAULT_NOTIFY_CONFIG.announce, warn2),
    askAutoCloseMs: readCloseMs(source, "askAutoCloseMs", DEFAULT_NOTIFY_CONFIG.askAutoCloseMs, ASK_CLOSE_MAX, warn2),
    doneAutoCloseMs: readCloseMs(source, "doneAutoCloseMs", DEFAULT_NOTIFY_CONFIG.doneAutoCloseMs, DONE_CLOSE_MAX, warn2),
    transport: readTransport(source, DEFAULT_NOTIFY_CONFIG.transport, warn2),
    debug: readBoolean(source, "debug", DEFAULT_NOTIFY_CONFIG.debug, warn2)
  };
}
function resolveClientConfig(raw, warn2) {
  if (raw === void 0) return void 0;
  if (!isRecord(raw)) {
    warn2("injected config is not an object; using browser notifications");
    return void 0;
  }
  const base = normalizeNotifyConfig(raw, warn2);
  const token = typeof raw.token === "string" ? raw.token : "";
  const requested = base.transport;
  let transport = requested === "popup" ? "popup" : "browser";
  if (transport === "popup" && token === "") {
    warn2("popup transport requires a route token; using browser notifications");
    transport = "browser";
  }
  const focusPid = typeof raw.focusPid === "number" && Number.isSafeInteger(raw.focusPid) && raw.focusPid > 0 ? raw.focusPid : 0;
  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    ...base,
    transport,
    token,
    focusPid
  };
}

// src/client/messages.ts
var APP = "DSH";
var SESSION_TITLE_MAX = 60;
var REASON_MAX = 120;
var QUESTION_MAX = 200;
var MESSAGE_MAX = 120;
var BODY_MAX = 300;
function languageOf(tag) {
  return tag !== void 0 && tag.toLowerCase().startsWith("zh") ? "zh" : "en";
}
function sessionTitleOf(summary, sessionId) {
  const title = summary?.displayTitle ?? summary?.title;
  if (title !== void 0 && title.trim() !== "") return truncateText(title.trim(), SESSION_TITLE_MAX);
  return sessionId.length > 10 ? `${sessionId.slice(0, 8)}\u2026` : sessionId;
}
function truncateText(text, max) {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 1))}\u2026`;
}
function sessionLine(title, lang) {
  return lang === "zh" ? `\u4F1A\u8BDD\uFF1A${title}` : `Session: ${title}`;
}
function toolLine(name2, lang) {
  return lang === "zh" ? `\u5DE5\u5177\uFF1A${truncateText(name2, 60)}` : `Tool: ${truncateText(name2, 60)}`;
}
function resolveDisplayReason(pending, lang) {
  const display = pending.displayReason;
  if (display !== void 0) {
    const preferred = lang === "zh" ? ["zh", "zh-CN", "zh-Hans"] : ["en"];
    for (const key of preferred) {
      const value = display[key];
      if (typeof value === "string" && value.trim() !== "") return truncateText(value, REASON_MAX);
    }
    for (const value of Object.values(display)) {
      if (typeof value === "string" && value.trim() !== "") return truncateText(value, REASON_MAX);
    }
  }
  return pending.reason !== void 0 && pending.reason.trim() !== "" ? truncateText(pending.reason, REASON_MAX) : void 0;
}
function readQuestion(pending) {
  const questions = Array.isArray(pending.questions) ? pending.questions : [];
  const first = questions.length > 0 && isRecord(questions[0]) ? questions[0] : void 0;
  const text = first !== void 0 && typeof first.question === "string" ? truncateText(first.question, QUESTION_MAX) : "";
  const rawOptions = first !== void 0 && Array.isArray(first.options) ? first.options : [];
  const options = [];
  for (const option of rawOptions) {
    if (!isRecord(option)) continue;
    const label = option.label;
    if (typeof label === "string" && label.trim() !== "") options.push(truncateText(label, 30));
  }
  return { text, options, remaining: Math.max(0, questions.length - 1) };
}
function askBody(pending, sessionTitle, lang) {
  const lines = [sessionLine(sessionTitle, lang)];
  const info = readQuestion(pending);
  if (info.text !== "") lines.push(info.text);
  if (info.options.length > 0) {
    lines.push(lang === "zh" ? `\u9009\u9879\uFF1A${info.options.slice(0, 3).join(" / ")}` : `Options: ${info.options.slice(0, 3).join(" / ")}`);
  }
  if (info.remaining > 0) lines.push(lang === "zh" ? `\u8FD8\u6709 ${String(info.remaining)} \u4E2A\u95EE\u9898` : `${String(info.remaining)} more question(s)`);
  return lines;
}
function finish(title, lines, lang) {
  const compact = lines.map((line) => truncateText(line, BODY_MAX)).filter((line) => line !== "");
  let body = compact.join("\n");
  if (body.length > BODY_MAX) body = `${body.slice(0, Math.max(0, BODY_MAX - 1))}\u2026`;
  return {
    title: `${APP} \xB7 ${truncateText(title, 60)}`,
    body,
    openLabel: lang === "zh" ? "\u6253\u5F00 DSH" : "Open DSH",
    ignoreLabel: lang === "zh" ? "\u5FFD\u7565" : "Dismiss"
  };
}
function askCopy(pending, sessionTitle, lang) {
  if (pending.kind === "approval") {
    const lines = [sessionLine(sessionTitle, lang)];
    if (pending.toolName !== void 0 && pending.toolName !== "") lines.push(toolLine(pending.toolName, lang));
    const reason = resolveDisplayReason(pending, lang);
    if (reason !== void 0) lines.push(reason);
    return finish(lang === "zh" ? "\u9700\u8981\u4F60\u7684\u6279\u51C6" : "Approval needed", lines, lang);
  }
  if (pending.kind === "plan-review") {
    return finish(lang === "zh" ? "\u8BA1\u5212\u7B49\u5F85\u786E\u8BA4" : "Plan awaiting review", askBody(pending, sessionTitle, lang), lang);
  }
  return finish(lang === "zh" ? "\u5728\u7B49\u4F60\u56DE\u7B54" : "A question is waiting", askBody(pending, sessionTitle, lang), lang);
}
function doneCopy(sessionTitles, lang) {
  const titles = sessionTitles.map((title) => truncateText(title, SESSION_TITLE_MAX));
  if (titles.length > 1) {
    const heading = lang === "zh" ? `${String(titles.length)} \u4E2A\u4F1A\u8BDD\u5DF2\u5B8C\u6210` : `${String(titles.length)} sessions finished`;
    return finish(heading, [titles.join(lang === "zh" ? "\u3001" : ", ")], lang);
  }
  return finish(lang === "zh" ? "\u4EFB\u52A1\u5B8C\u6210" : "Turn complete", [sessionLine(titles[0] ?? "", lang)], lang);
}
function errorCopy(sessionTitle, message, lang) {
  const lines = [sessionLine(sessionTitle, lang)];
  const compact = truncateText(message, MESSAGE_MAX);
  if (compact !== "") lines.push(compact);
  return finish(lang === "zh" ? "\u4EFB\u52A1\u51FA\u9519" : "Turn failed", lines, lang);
}
function selfTestCopy(lang) {
  return finish(
    lang === "zh" ? "\u901A\u77E5\u5DF2\u542F\u7528" : "Notifications are on",
    lang === "zh" ? ["\u5207\u5230\u5176\u4ED6\u7A0B\u5E8F\u65F6\uFF0CDSH \u9700\u8981\u4F60\u5904\u7406\u6216\u5B8C\u6210\u4EFB\u52A1\u65F6\u4F1A\u5728\u8FD9\u91CC\u63D0\u9192\u3002"] : ["When you switch away, DSH will remind you here when it needs you or finishes a turn."],
    lang
  );
}
function viewsOf(snapshot) {
  const views = /* @__PURE__ */ new Map();
  for (const [sessionId, status] of snapshot) {
    views.set(sessionId, { running: status.running, pending: status.pendingInteraction });
  }
  return views;
}

// src/client/model.ts
function planNotifications(input) {
  const asks = [];
  const completed = [];
  const askedSessions = /* @__PURE__ */ new Set();
  for (const [sessionId, status] of input.next) {
    if (!input.topLevel.has(sessionId)) continue;
    const previous = input.prev.get(sessionId);
    const pending = status.pending;
    const pendingKey = pending?.key;
    const previousKey = previous?.pending?.key;
    if (pending !== void 0 && pendingKey !== void 0 && pendingKey !== previousKey && input.deliveredAsks.get(sessionId) !== pendingKey) {
      asks.push({ kind: "ask", sessionId, interaction: pending });
      askedSessions.add(sessionId);
      continue;
    }
    if (status.pending === void 0 && previous?.running === true && status.running === false && !askedSessions.has(sessionId)) {
      completed.push(sessionId);
    }
  }
  const intents = [...asks];
  if (completed.length === 1) intents.push({ kind: "done", sessionIds: [completed[0]] });
  else if (completed.length > 1) intents.push({ kind: "done", sessionIds: completed });
  return intents;
}
function pendingAskIntents(next, topLevel, deliveredAsks) {
  const intents = [];
  for (const [sessionId, status] of next) {
    if (!topLevel.has(sessionId)) continue;
    const pending = status.pending;
    const pendingKey = pending?.key;
    if (pending === void 0 || pendingKey === void 0) continue;
    if (deliveredAsks.get(sessionId) === pendingKey) continue;
    intents.push({ kind: "ask", sessionId, interaction: pending });
  }
  return intents;
}
function shouldDeliver(config, focused) {
  return !config.onlyWhenUnfocused || !focused;
}

// src/client/transport.ts
var TOKEN_HEADER = "x-dsh-notify-token";
var ACTIVATION_PATH = "/dsh-notify/activation";
var NOTIFY_PATH = "/dsh-notify/notify";
var POLL_INTERVAL_MS = 1200;
var EXTRA_POLL_MS = 3e4;
function notificationId() {
  const crypto = globalThis.crypto;
  if (crypto !== void 0 && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `dshn-${String(Date.now())}-${Math.random().toString(16).slice(2)}`;
}
function createPopupTransport(config, events, fallback) {
  let disposed = false;
  let pollTimer;
  let pollDeadline = 0;
  let pollInFlight = false;
  const stopPolling = () => {
    if (pollTimer !== void 0) {
      clearInterval(pollTimer);
      pollTimer = void 0;
    }
  };
  const pollActivation = async () => {
    if (disposed || pollInFlight) return;
    pollInFlight = true;
    try {
      const response = await fetch(ACTIVATION_PATH, {
        method: "GET",
        headers: { [TOKEN_HEADER]: config.token },
        cache: "no-store"
      });
      if (!response.ok) return;
      const body = await response.json();
      if (!isRecord(body)) return;
      const sessionId = body.sessionId;
      if (typeof sessionId === "string" && sessionId !== "") {
        stopPolling();
        events.onOpenSession(sessionId);
      }
    } catch (error) {
      events.log(`activation poll failed: ${String(error)}`);
    } finally {
      pollInFlight = false;
    }
  };
  const ensurePolling = (durationMs) => {
    pollDeadline = Math.max(pollDeadline, Date.now() + durationMs + EXTRA_POLL_MS);
    if (pollTimer !== void 0) return;
    pollTimer = setInterval(() => {
      if (Date.now() > pollDeadline) {
        stopPolling();
        return;
      }
      void pollActivation();
    }, POLL_INTERVAL_MS);
    void pollActivation();
  };
  const onFocus = () => {
    void pollActivation();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") void pollActivation();
  };
  return {
    start() {
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisibility);
    },
    async send(payload) {
      if (disposed) return false;
      try {
        const response = await fetch(NOTIFY_PATH, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [TOKEN_HEADER]: config.token
          },
          body: JSON.stringify({ id: notificationId(), ...payload })
        });
        if (!response.ok) {
          events.log(`host notify rejected with status ${String(response.status)}`);
          return await fallback.send(payload);
        }
        ensurePolling(payload.autoCloseMs);
        return true;
      } catch (error) {
        events.log(`host notify failed: ${String(error)}`);
        return await fallback.send(payload);
      }
    },
    dispose() {
      disposed = true;
      stopPolling();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}
function createBrowserTransport(events) {
  const active = /* @__PURE__ */ new Set();
  let permissionAsked = false;
  let disposed = false;
  const requestPermission = () => {
    if (permissionAsked || disposed) return;
    permissionAsked = true;
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    try {
      const request = Notification.requestPermission();
      if (request !== void 0 && typeof request.then === "function") {
        void request.then((state) => {
          if (state !== "granted") events.log("notification permission was not granted");
        });
      }
    } catch (error) {
      events.log(`notification permission request failed: ${String(error)}`);
    }
  };
  const onClickGesture = () => {
    requestPermission();
  };
  return {
    start() {
      document.addEventListener("click", onClickGesture, { capture: true, once: true });
      if (typeof Notification !== "undefined" && Notification.permission === "granted") return;
      events.log("browser notifications awaiting permission (first click asks)");
    },
    async send(payload) {
      if (disposed) return false;
      if (typeof Notification === "undefined") {
        events.log("this browser has no Notification API");
        return false;
      }
      if (Notification.permission !== "granted") {
        events.log("browser notification skipped: permission is not granted");
        return false;
      }
      try {
        const notification = new Notification(payload.title, {
          body: payload.body,
          tag: notificationId(),
          lang: document.documentElement.lang || void 0,
          silent: !payload.sound
        });
        active.add(notification);
        notification.onclose = () => {
          active.delete(notification);
        };
        notification.onclick = () => {
          active.delete(notification);
          try {
            window.focus();
          } catch (error) {
            events.log(`window.focus failed: ${String(error)}`);
          }
          if (payload.sessionId !== "") events.onOpenSession(payload.sessionId);
          notification.close();
        };
        return true;
      } catch (error) {
        events.log(`browser notification failed: ${String(error)}`);
        return false;
      }
    },
    dispose() {
      disposed = true;
      document.removeEventListener("click", onClickGesture, { capture: true });
      for (const notification of active) notification.close();
      active.clear();
    }
  };
}
function createTransport(config, events) {
  const browser = createBrowserTransport(events);
  if (config.transport !== "popup") return browser;
  return createPopupTransport(config, events, browser);
}

// src/client/index.ts
var name = "dsh-notify-client";
var VERSION = "0.1.0";
var LOG_PREFIX = "[dsh-notify]";
var ANNOUNCE_KEY = `dsh-notify:announced:${VERSION}`;
var STARTUP_SWEEP_MS = 3e3;
var ANNOUNCE_DELAY_MS = 2500;
function warn(message) {
  console.warn(`${LOG_PREFIX} ${message}`);
}
function readInjectedConfig() {
  return globalThis.__DSH_NOTIFY_CONFIG__;
}
function markLoaded(marker) {
  ;
  globalThis.__DSH_NOTIFY_LOADED__ = marker;
}
function fallbackConfig() {
  return {
    version: 1,
    notifyOnAsk: true,
    notifyOnDone: true,
    notifyOnError: true,
    sound: true,
    onlyWhenUnfocused: true,
    announce: false,
    askAutoCloseMs: 6e4,
    doneAutoCloseMs: 15e3,
    transport: "browser",
    debug: false,
    token: "",
    focusPid: 0
  };
}
function isFocused() {
  try {
    return document.hasFocus();
  } catch {
    return true;
  }
}
function install(scope, config) {
  const sessions = scope.sessions;
  const uiSession = scope.uiSession;
  const uiWorkspace = scope.uiWorkspace;
  if (sessions === void 0 || uiSession === void 0 || uiWorkspace === void 0) {
    warn("required client services are unavailable; notifications disabled");
    return;
  }
  const lang = languageOf(document.documentElement.lang);
  let debugSurface;
  let last = /* @__PURE__ */ new Map();
  let baselineReady = false;
  const deliveredAsks = /* @__PURE__ */ new Map();
  const transport = createTransport(config, {
    onOpenSession: (sessionId) => {
      if (debugSurface !== void 0) debugSurface.lastOpenSession = sessionId;
      try {
        uiWorkspace.openSession(sessionId);
      } catch (error) {
        warn(`openSession failed: ${String(error)}`);
      }
    },
    log: warn
  });
  transport.start();
  scope.effect(() => () => {
    transport.dispose();
  }, "dsh-notify: transport");
  const listSnapshot = () => sessions.list.getSnapshot();
  const titleOf = (sessionId) => sessionTitleOf(listSnapshot().byId[sessionId], sessionId);
  const topLevel = () => {
    const snapshot = listSnapshot();
    const ids = /* @__PURE__ */ new Set();
    for (const id of snapshot.ids) {
      if (snapshot.byId[id]?.origin !== "subagent") ids.add(id);
    }
    return ids;
  };
  const payloadOf = (copy, kind, sessionId, autoCloseMs) => ({
    kind,
    title: copy.title,
    body: copy.body,
    sessionId,
    autoCloseMs,
    sound: config.sound,
    openLabel: copy.openLabel,
    ignoreLabel: copy.ignoreLabel
  });
  const sendIntent = async (intent) => {
    if (!shouldDeliver(config, isFocused())) return;
    if (intent.kind === "ask") {
      if (!config.notifyOnAsk) return;
      const key = intent.interaction.key;
      if (deliveredAsks.get(intent.sessionId) === key) return;
      const copy2 = askCopy(intent.interaction, titleOf(intent.sessionId), lang);
      const accepted = await transport.send(payloadOf(copy2, "ask", intent.sessionId, config.askAutoCloseMs));
      if (accepted) deliveredAsks.set(intent.sessionId, key);
      return;
    }
    if (!config.notifyOnDone) return;
    const copy = doneCopy(intent.sessionIds.map(titleOf), lang);
    const target = intent.sessionIds.length === 1 ? intent.sessionIds[0] : "";
    await transport.send(payloadOf(copy, "done", target, config.doneAutoCloseMs));
  };
  const deliver = (intent) => {
    void sendIntent(intent).catch((error) => {
      warn(`delivery failed: ${String(error)}`);
    });
  };
  const cleanupDelivered = (next) => {
    for (const [sessionId, key] of deliveredAsks) {
      if (next.get(sessionId)?.pending?.key !== key) deliveredAsks.delete(sessionId);
    }
  };
  const tick = () => {
    const snapshot = uiSession.sessionStatus.getSnapshot();
    const next = viewsOf(snapshot);
    if (!baselineReady) {
      baselineReady = true;
      last = next;
      return;
    }
    const intents = planNotifications({
      prev: last,
      next,
      topLevel: topLevel(),
      deliveredAsks
    });
    last = next;
    cleanupDelivered(next);
    for (const intent of intents) deliver(intent);
  };
  const sweepAsks = () => {
    if (!shouldDeliver(config, isFocused())) return;
    if (!config.notifyOnAsk) return;
    const snapshot = uiSession.sessionStatus.getSnapshot();
    for (const intent of pendingAskIntents(viewsOf(snapshot), topLevel(), deliveredAsks)) deliver(intent);
  };
  const stopStatus = uiSession.sessionStatus.subscribe(() => {
    try {
      tick();
    } catch (error) {
      warn(`status update failed: ${String(error)}`);
    }
  });
  scope.effect(() => stopStatus, "dsh-notify: status subscription");
  scope.inject(["remote"], (remoteScope) => {
    const remote = remoteScope.remote;
    if (remote === void 0) return;
    const stopError = remote.$on("api-session/error", (sessionId, message) => {
      try {
        if (!config.notifyOnError) return;
        if (!shouldDeliver(config, isFocused())) return;
        if (!topLevel().has(sessionId)) return;
        const copy = errorCopy(titleOf(sessionId), message, lang);
        void transport.send(payloadOf(copy, "error", sessionId, config.doneAutoCloseMs)).catch((error) => {
          warn(`error notification failed: ${String(error)}`);
        });
      } catch (error) {
        warn(`error handling failed: ${String(error)}`);
      }
    });
    remoteScope.effect(() => stopError, "dsh-notify: session error subscription");
  });
  const onBlur = () => {
    window.setTimeout(() => {
      try {
        sweepAsks();
      } catch (error) {
        warn(`blur sweep failed: ${String(error)}`);
      }
    }, 50);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      try {
        sweepAsks();
      } catch (error) {
        warn(`visibility sweep failed: ${String(error)}`);
      }
    }
  };
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  scope.effect(() => () => {
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
  }, "dsh-notify: focus listeners");
  const startupTimer = window.setTimeout(() => {
    try {
      sweepAsks();
    } catch (error) {
      warn(`startup sweep failed: ${String(error)}`);
    }
  }, STARTUP_SWEEP_MS);
  scope.effect(() => () => {
    window.clearTimeout(startupTimer);
  }, "dsh-notify: startup sweep");
  const announceTimer = config.announce ? window.setTimeout(() => {
    try {
      let announced = false;
      try {
        announced = window.localStorage.getItem(ANNOUNCE_KEY) !== null;
      } catch {
        announced = true;
      }
      if (announced) return;
      const copy = selfTestCopy(lang);
      void transport.send(payloadOf(copy, "self-test", "", config.doneAutoCloseMs)).then((accepted) => {
        if (!accepted) return;
        try {
          window.localStorage.setItem(ANNOUNCE_KEY, (/* @__PURE__ */ new Date()).toISOString());
        } catch {
        }
      }).catch((error) => {
        warn(`self-test failed: ${String(error)}`);
      });
    } catch (error) {
      warn(`announcement failed: ${String(error)}`);
    }
  }, ANNOUNCE_DELAY_MS) : void 0;
  if (announceTimer !== void 0) {
    scope.effect(() => () => {
      window.clearTimeout(announceTimer);
    }, "dsh-notify: self test");
  }
  if (config.debug) {
    const surface = {
      ready: true,
      version: VERSION,
      services: { sessions: true, uiSession: true, uiWorkspace: true },
      lastOpenSession: void 0,
      async simulate(kind, options = {}) {
        const sessionId = typeof options.sessionId === "string" ? options.sessionId : `debug-${String(Date.now())}`;
        const title = typeof options.title === "string" ? options.title : "Debug session";
        if (kind === "ask") {
          const interactionKind = typeof options.interactionKind === "string" ? options.interactionKind : "question";
          const pending = {
            key: `debug-${String(Date.now())}`,
            kind: interactionKind,
            sessionId,
            toolName: "debug_tool",
            reason: "debug reason",
            questions: [{ question: typeof options.question === "string" ? options.question : "Debug question?", options: [{ label: "A" }, { label: "B" }] }]
          };
          const copy2 = askCopy(pending, title, lang);
          return transport.send(payloadOf(copy2, "ask", sessionId, Math.min(config.askAutoCloseMs, 3e4)));
        }
        if (kind === "done") {
          const copy2 = doneCopy([title], lang);
          return transport.send(payloadOf(copy2, "done", sessionId, config.doneAutoCloseMs));
        }
        if (kind === "error") {
          const copy2 = errorCopy(title, typeof options.message === "string" ? options.message : "debug failure", lang);
          return transport.send(payloadOf(copy2, "error", sessionId, config.doneAutoCloseMs));
        }
        const copy = selfTestCopy(lang);
        return transport.send(payloadOf(copy, "self-test", "", config.doneAutoCloseMs));
      },
      state() {
        return {
          baselineReady,
          sessions: [...last.entries()].map(([id, view]) => ({ id, running: view.running, pending: view.pending?.key })),
          deliveredAsks: [...deliveredAsks.entries()],
          focused: isFocused()
        };
      }
    };
    debugSurface = surface;
    globalThis.__DSH_NOTIFY_DEBUG__ = surface;
    scope.effect(() => () => {
      if (globalThis.__DSH_NOTIFY_DEBUG__ === surface) {
        delete globalThis.__DSH_NOTIFY_DEBUG__;
      }
    }, "dsh-notify: debug surface");
  }
  markLoaded({ version: VERSION, ready: true, services: { sessions: true, uiSession: true, uiWorkspace: true } });
}
function apply(ctx) {
  try {
    const injected = readInjectedConfig();
    const config = resolveClientConfig(injected, warn) ?? fallbackConfig();
    if (injected === void 0) warn("no injected configuration; desktop popup transport unavailable");
    markLoaded({ version: VERSION, ready: false, services: {} });
    ctx.inject(["sessions", "uiSession", "uiWorkspace"], (scope) => {
      try {
        install(scope, config);
      } catch (error) {
        warn(`install failed: ${String(error)}`);
      }
    });
  } catch (error) {
    warn(`client plugin failed: ${String(error)}`);
  }
}
return module.exports;
} });
//# sourceMappingURL=client.js.map
