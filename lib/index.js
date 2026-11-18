// src/index.ts
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
function readFocusPid(source, warn2) {
  const value = source.focusPid;
  if (value === void 0) return void 0;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return Math.min(value, 2147483647);
  warn2("config.focusPid must be a non-negative integer; using the default");
  return void 0;
}
function resolveHostConfig(raw, environment, token, warn2) {
  const base = normalizeNotifyConfig(raw, warn2);
  let transport;
  if (base.transport === "browser") {
    transport = "browser";
  } else if (base.transport === "popup") {
    transport = environment.platform === "win32" ? "popup" : "browser";
    if (transport !== "popup") warn2("config.transport popup requires Windows; using browser notifications");
  } else {
    transport = environment.underElectron && environment.platform === "win32" ? "popup" : "browser";
  }
  const configuredFocusPid = readFocusPid(isRecord(raw) ? raw : {}, warn2);
  const focusPid = configuredFocusPid !== void 0 ? configuredFocusPid : environment.underElectron ? environment.ppid : 0;
  return {
    version: 1,
    ...base,
    transport,
    token,
    focusPid
  };
}

// src/index.ts
var name = "dsh-notify";
var LOG_PREFIX = "[dsh-notify]";
var MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
var POPUP_SCRIPT = join(MODULE_DIRECTORY, "popup.ps1");
var NOTIFY_PATH = "/dsh-notify/notify";
var ACTIVATION_PATH = "/dsh-notify/activation";
var TOKEN_HEADER = "x-dsh-notify-token";
var MAX_BODY_BYTES = 16 * 1024;
var ACTIVATION_TTL_MS = 3e4;
var MAX_SLOTS = 3;
var KINDS = ["ask", "done", "error", "self-test"];
function warn(message) {
  console.warn(`${LOG_PREFIX} ${message}`);
}
function log(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}
function clampInt(value, min, max) {
  return Math.min(Math.max(Math.trunc(value), min), max);
}
function textField(value, max) {
  return typeof value === "string" ? value.slice(0, max) : void 0;
}
function parseNotifyRequest(value, config) {
  if (!isRecord(value)) return void 0;
  const id = textField(value.id, 120);
  const kind = value.kind;
  if (id === void 0 || id === "") return void 0;
  if (typeof kind !== "string" || !KINDS.includes(kind)) return void 0;
  const title = textField(value.title, 300);
  if (title === void 0 || title === "") return void 0;
  const body = textField(value.body, 2e3) ?? "";
  const sessionId = textField(value.sessionId, 300) ?? "";
  const defaultClose = kind === "ask" ? config.askAutoCloseMs : config.doneAutoCloseMs;
  const requestedClose = typeof value.autoCloseMs === "number" && Number.isFinite(value.autoCloseMs) ? value.autoCloseMs : defaultClose;
  return {
    id,
    kind,
    title,
    body,
    sessionId,
    autoCloseMs: clampInt(requestedClose, 0, 6e5),
    sound: typeof value.sound === "boolean" ? value.sound : config.sound,
    openLabel: textField(value.openLabel, 60) ?? "Open DSH",
    ignoreLabel: textField(value.ignoreLabel, 60) ?? "Dismiss"
  };
}
async function readRequestBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) return void 0;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function respondJson(res, status, value) {
  const text = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
    "cache-control": "no-store"
  });
  res.end(text);
}
function authorized(req, token) {
  const header = req.headers[TOKEN_HEADER];
  return typeof header === "string" && header === token;
}
function encodeArg(text) {
  return Buffer.from(text, "utf8").toString("base64");
}
function apply(ctx, rawConfig) {
  try {
    setup(ctx, rawConfig);
  } catch (error) {
    warn(`host plugin failed: ${String(error)}`);
  }
}
function setup(ctx, rawConfig) {
  const token = randomUUID();
  const underElectron = process.versions.electron !== void 0;
  const config = resolveHostConfig(
    rawConfig,
    { underElectron, platform: process.platform, ppid: process.ppid },
    token,
    warn
  );
  const runtimes = /* @__PURE__ */ new Set();
  let slots = 0;
  let latestActivation;
  ctx.effect(() => () => {
    for (const child of runtimes) {
      try {
        child.kill();
      } catch (error) {
        warn(`popup kill failed: ${String(error)}`);
      }
    }
    runtimes.clear();
  }, "dsh-notify: popups");
  ctx.effect(() => ctx.on("webserver/index-inject", (table) => {
    table.push({ kind: "global", name: "__DSH_NOTIFY_CONFIG__", value: config });
  }), "dsh-notify: page config");
  const spawnPopup = (request) => {
    const slot = slots % MAX_SLOTS;
    slots += 1;
    const args = [
      "-NoProfile",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      POPUP_SCRIPT,
      "-Id",
      request.id,
      "-Kind",
      request.kind,
      "-TitleB64",
      encodeArg(request.title),
      "-BodyB64",
      encodeArg(request.body),
      "-OpenLabelB64",
      encodeArg(request.openLabel),
      "-IgnoreLabelB64",
      encodeArg(request.ignoreLabel),
      "-FocusPid",
      String(config.focusPid),
      "-AutoCloseMs",
      String(request.autoCloseMs),
      "-Sound",
      request.sound ? "1" : "0",
      "-Slot",
      String(slot)
    ];
    let child;
    try {
      child = spawn("powershell.exe", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      warn(`popup spawn failed: ${String(error)}`);
      return;
    }
    runtimes.add(child);
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", () => {
    });
    child.on("error", (error) => {
      warn(`popup process error: ${String(error)}`);
    });
    child.on("close", (code) => {
      runtimes.delete(child);
      for (const line of stdout.split(/\r?\n/u)) {
        if (line.startsWith("activate ")) {
          if (request.sessionId !== "") {
            latestActivation = { sessionId: request.sessionId, at: Date.now() };
            log(`popup activated for session ${request.sessionId.slice(0, 8)}\u2026`);
          }
          return;
        }
      }
      if (code !== 0 && code !== null) warn(`popup exited with code ${String(code)}`);
    });
  };
  const handleNotify = async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" });
      res.end();
      return;
    }
    if (!authorized(req, token)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const raw = await readRequestBody(req, MAX_BODY_BYTES);
    if (raw === void 0) {
      res.writeHead(413);
      res.end();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const request = parseNotifyRequest(parsed, config);
    if (request === void 0) {
      res.writeHead(400);
      res.end();
      return;
    }
    if (config.transport !== "popup") {
      res.writeHead(503);
      res.end();
      return;
    }
    spawnPopup(request);
    res.writeHead(204);
    res.end();
  };
  const handleActivation = (req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405, { allow: "GET" });
      res.end();
      return;
    }
    if (!authorized(req, token)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const activation = latestActivation;
    if (activation !== void 0 && Date.now() - activation.at <= ACTIVATION_TTL_MS) {
      latestActivation = void 0;
      respondJson(res, 200, { sessionId: activation.sessionId });
      return;
    }
    latestActivation = void 0;
    respondJson(res, 200, { sessionId: null });
  };
  ctx.inject(["webServer"], (scope) => {
    const server = scope.webServer;
    if (server === void 0) return;
    try {
      const disposeNotify = server.register({
        kind: "exact",
        path: NOTIFY_PATH,
        handler: (req, res) => {
          void handleNotify(req, res).catch((error) => {
            warn(`notify handler failed: ${String(error)}`);
            if (!res.headersSent) {
              res.writeHead(400);
              res.end();
            } else {
              res.destroy();
            }
          });
        }
      });
      const disposeActivation = server.register({
        kind: "exact",
        path: ACTIVATION_PATH,
        handler: handleActivation
      });
      scope.effect(() => () => {
        disposeNotify();
        disposeActivation();
      }, "dsh-notify: routes");
      log(`host ready (transport=${config.transport}, focusPid=${String(config.focusPid)})`);
    } catch (error) {
      warn(`route registration failed: ${String(error)}`);
    }
  });
}
export {
  apply,
  name
};
//# sourceMappingURL=index.js.map
