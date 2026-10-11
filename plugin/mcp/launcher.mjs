// EDC MCP launcher (no rebuild needed).
//   node mcp/launcher.mjs            start the MCP server (stdio)
//   node mcp/launcher.mjs register   open the registration page (sign in with Google there once; no administrator step)
//   node mcp/launcher.mjs login      one-time Google login in the browser (no API key needed)
//   node mcp/launcher.mjs logout     forget the Google login
//   node mcp/launcher.mjs setup      alternative: save an API key (edc_sk_...) to ~/.config/edc/.env
//   node mcp/launcher.mjs check      verify endpoint + credentials with a free read-only request (uses no quota)
//   node mcp/launcher.mjs status     show auth mode / endpoint / signed-in account (never prints secrets)
// Auth priority: EDC_API_KEY > service account (EDC_SERVICE_ACCOUNT_KEY / _JSON / GOOGLE_APPLICATION_CREDENTIALS) > Google login.
// Config sources, first wins: real env vars > $EDC_ENV_FILE > <plugin>/.env > ~/.config/edc/.env > mcp/defaults.json.
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const configDir = join(homedir(), ".config", "edc");
const userEnv = join(configDir, ".env");
const authFile = join(configDir, "auth.json");
const unset = (v) => v === undefined || v.trim() === "" || /^\$\{.*\}$/.test(v.trim());
const log = (...a) => console.error("[edc]", ...a); // stdout is reserved for the MCP protocol
const b64url = (buf) => Buffer.from(buf).toString("base64url");

// Hosts that fail to expand "${VAR}" pass the literal through; treat as unset.
for (const k of Object.keys(process.env)) {
  if ((k.startsWith("EDC_") || k === "GOOGLE_APPLICATION_CREDENTIALS") && unset(process.env[k])) delete process.env[k];
}
function loadEnvFile(file) {
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);
    else val = val.replace(/\s+#.*$/, "");
    if (val.startsWith("~/")) val = join(homedir(), val.slice(2));
    if (!unset(val) && unset(process.env[m[1]])) process.env[m[1]] = val;
  }
}
for (const f of [process.env.EDC_ENV_FILE, join(here, "..", ".env"), userEnv].filter(Boolean)) if (existsSync(f)) loadEnvFile(f);
let defaults = {};
try { defaults = JSON.parse(readFileSync(join(here, "defaults.json"), "utf8")); } catch {}
if (!process.env.EDC_BASE_URL && defaults.baseUrl) process.env.EDC_BASE_URL = defaults.baseUrl;
// Desktop-app OAuth client: Google documents that an installed app's client secret is not confidential.
const oauthClientId = process.env.EDC_OAUTH_CLIENT_ID || defaults.oauthClientId || "";
const oauthClientSecret = process.env.EDC_OAUTH_CLIENT_SECRET || defaults.oauthClientSecret || "";
const registerUrl = () => `${(process.env.EDC_BASE_URL || "").replace(/\/+$/, "")}${defaults.registerPath || "/register"}`;

// ---- Google login (OAuth 2.0 authorization code + PKCE, loopback redirect) ----
const readAuth = () => { try { return JSON.parse(readFileSync(authFile, "utf8")); } catch { return null; } };
function writeAuth(data) {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(authFile, JSON.stringify(data), { mode: 0o600 });
  try { chmodSync(authFile, 0o600); } catch {}
}
const jwtPayload = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")); } catch { return {}; } };

async function tokenRequest(params) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: oauthClientId, ...(oauthClientSecret ? { client_secret: oauthClientSecret } : {}), ...params }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error_description || body.error || `HTTP ${res.status}`), { oauthError: body.error });
  return body;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch {}
}

async function login() {
  if (!oauthClientId) {
    log("OAuth client ID is not configured (mcp/defaults.json: oauthClientId). Ask the plugin distributor, or use an API key: node mcp/launcher.mjs setup");
    return 1;
  }
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const { code, redirectUri } = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname !== "/") { res.writeHead(404).end(); return; }
      const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(ok ? "<h3>ログインできました。このタブは閉じて構いません。</h3>" : "<h3>ログインに失敗しました。ターミナルを確認してください。</h3>");
      server.close();
      ok ? resolve({ code: u.searchParams.get("code"), redirectUri: `http://127.0.0.1:${server.address()?.port ?? port}` }) : reject(new Error(u.searchParams.get("error") || "state mismatch"));
    });
    let port = 0;
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
        client_id: oauthClientId, redirect_uri: `http://127.0.0.1:${port}`, response_type: "code", scope: "openid email",
        code_challenge: challenge, code_challenge_method: "S256", state, access_type: "offline", prompt: "consent select_account",
      });
      log("Opening the browser to sign in with Google. If it does not open, visit:\n" + url);
      openBrowser(url);
      setTimeout(() => { server.close(); reject(new Error("timed out waiting for login (3 min)")); }, 180000).unref();
    });
  });
  const tok = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri });
  if (!tok.id_token || !tok.refresh_token) throw new Error("Google did not return a refresh token. Remove the app at https://myaccount.google.com/permissions and retry.");
  const p = jwtPayload(tok.id_token);
  writeAuth({ refresh_token: tok.refresh_token, id_token: tok.id_token, exp: p.exp ?? 0, email: p.email ?? "" });
  log(`Signed in as ${p.email}. Saved to ${authFile} (permissions 600).`);
  return 0;
}

let idTokenCache = null;
async function getGoogleIdToken() {
  const now = Math.floor(Date.now() / 1000);
  const a = idTokenCache ?? readAuth();
  if (!a) throw new Error("Not signed in. Run: node mcp/launcher.mjs login");
  if (a.id_token && a.exp - 300 > now) { idTokenCache = a; return a.id_token; }
  try {
    const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: a.refresh_token });
    const p = jwtPayload(tok.id_token);
    idTokenCache = { ...a, id_token: tok.id_token, exp: p.exp ?? now + 3000 };
    writeAuth(idTokenCache);
    return idTokenCache.id_token;
  } catch (e) {
    if (e.oauthError === "invalid_grant") throw new Error("Google login expired or was revoked. Run: node mcp/launcher.mjs login");
    throw e;
  }
}

// ---- API key setup ----
async function readHidden(prompt) {
  process.stderr.write(prompt);
  if (!process.stdin.isTTY) { const c = []; for await (const x of process.stdin) c.push(x); return Buffer.concat(c).toString("utf8").trim(); }
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
    const onData = (ch) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off("data", onData); process.stderr.write("\n"); return resolve(buf.trim()); }
        if (c === "\u0003") { process.stderr.write("\n"); process.exit(130); }
        if (c === "\u007f" || c === "\b") buf = buf.slice(0, -1); else buf += c;
      }
    };
    process.stdin.on("data", onData);
  });
}

const authMode = () => process.env.EDC_API_KEY ? "api-key"
  : (process.env.EDC_SERVICE_ACCOUNT_KEY || process.env.EDC_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS) ? "service-account"
  : readAuth() ? "google-login" : "none";

async function check() {
  const base = process.env.EDC_BASE_URL;
  if (!base) { log("EDC_BASE_URL is not set."); return 1; }
  const mode = authMode();
  if (mode === "none") { log(`No credentials. First time? Register at ${registerUrl()} , then run: node mcp/launcher.mjs login   (or: setup)`); return 1; }
  if (mode === "service-account") { log("check supports API key / Google login only; start the server to test a service account."); return 1; }
  let credential;
  try { credential = mode === "api-key" ? process.env.EDC_API_KEY : await getGoogleIdToken(); } catch (e) { log(e.message); return 1; }
  // Read-only probe of a nonexistent id: 404 not_found => endpoint reachable AND credential accepted. Consumes no analysis quota.
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/v1/analyses/00000000-0000-4000-8000-000000000000`, { headers: { Authorization: `Bearer ${credential}`, Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(20000) });
    const body = await res.text().catch(() => "");
    const code = (() => { try { const j = JSON.parse(body); return j.error?.code ?? j.code; } catch { return undefined; } })();
    const who = mode === "google-login" ? readAuth()?.email : "";
    if (res.status === 404 && (!code || code === "not_found")) { log(`OK: ${base} reachable, ${mode === "api-key" ? "API key" : `Google account ${who}`} accepted.`); return 0; }
    if (res.status === 401) log(mode === "api-key" ? "401 unauthenticated: the API key is wrong or revoked. Re-run: node mcp/launcher.mjs setup" : "401 unauthenticated: the server does not accept this Google login (OAuth client not allowed on the server, or token invalid). Tell the administrator.");
    else if (res.status === 403) log(mode === "google-login" ? `403 permission_denied: ${who} is not registered (or suspended). Register with this same Google account at ${registerUrl()}  (or: node mcp/launcher.mjs register), then run check again.` : "403 permission_denied: the client is suspended or not registered. Ask the administrator.");
    else if (res.status >= 300 && res.status < 400) log(`Redirected (${res.status}); EDC_BASE_URL is probably wrong.`);
    else log(`Unexpected response ${res.status}${code ? ` (${code})` : ""}. Check EDC_BASE_URL (${base}).`);
    return 1;
  } catch (e) { log(`Cannot reach ${base}: ${e.cause?.code || e.message}`); return 1; }
}

const cmd = process.argv[2];
if (cmd === "register") {
  if (!process.env.EDC_BASE_URL) { log("EDC_BASE_URL is not set."); process.exit(1); }
  log(`Opening the registration page. Sign in with Google there, then run: node mcp/launcher.mjs login\n${registerUrl()}`);
  openBrowser(registerUrl());
  process.exit(0);
}
if (cmd === "login") { try { const rc = await login(); process.exit(rc || await check()); } catch (e) { log(e.message); process.exit(1); } }
if (cmd === "logout") {
  const a = readAuth();
  if (a?.refresh_token) { try { await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: a.refresh_token }), signal: AbortSignal.timeout(10000) }); } catch {} }
  try { unlinkSync(authFile); log("Signed out."); } catch { log("Not signed in."); }
  process.exit(0);
}
if (cmd === "setup") {
  const key = process.env.EDC_API_KEY_INPUT || await readHidden("EDC API key (edc_sk_...; input hidden): ");
  if (!/^edc_sk_[A-Za-z0-9_\-]{20,}$/.test(key)) { log("That does not look like an EDC API key (expected edc_sk_...). Nothing saved."); process.exit(1); }
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const keep = existsSync(userEnv) ? readFileSync(userEnv, "utf8").split(/\r?\n/).filter((l) => !/^\s*(export\s+)?EDC_API_KEY\s*=/.test(l)) : [];
  writeFileSync(userEnv, [...keep.filter((l, i, a) => l || i < a.length - 1), `EDC_API_KEY=${key}`, ""].join("\n"), { mode: 0o600 });
  try { chmodSync(userEnv, 0o600); } catch {}
  log(`Saved to ${userEnv} (permissions 600).`);
  process.env.EDC_API_KEY = key;
  process.exit(await check());
}
if (cmd === "check") process.exit(await check());
if (cmd === "status") {
  console.log(JSON.stringify({ authMode: authMode(), baseUrl: process.env.EDC_BASE_URL || "(not set)", registerUrl: registerUrl(), googleAccount: readAuth()?.email || "(not signed in)", oauthClientConfigured: Boolean(oauthClientId) }, null, 2));
  process.exit(0);
}

// ---- start the MCP server ----
const mode = authMode();
if (mode === "google-login") globalThis.__edcCredential = getGoogleIdToken; // picked up by the server's credential getter
if (!process.env.EDC_BASE_URL) log("EDC_BASE_URL is not set (see mcp/defaults.json or .env).");
if (mode === "none") log(`Not signed in. Register at ${registerUrl()} , then run once: node mcp/launcher.mjs login   (or: setup)`);
else log(`auth mode: ${mode}`);
await import(pathToFileURL(join(here, "dist", "index.mjs")).href);
