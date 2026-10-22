// EDC MCP launcher (no rebuild needed).
//   node mcp/launcher.mjs                 start the MCP server (stdio)
//   node mcp/launcher.mjs login           sign in to the EDC account in the browser (register there if new)
//   node mcp/launcher.mjs login --device  sign in from another device (no browser on this machine)
//   node mcp/launcher.mjs logout          revoke the sign-in and forget it
//   node mcp/launcher.mjs check           verify the sign-in with a free read-only request (uses no quota)
//   node mcp/launcher.mjs status          show sign-in state and where it is stored (never prints secrets)
// Credentials: EDC account access token (client edc-cli), refreshed automatically. Stored in the OS keychain
// (macOS Keychain / Linux Secret Service / Windows DPAPI), or ~/.config/edc/token.json (600) when none is available.
// The issuer and the API endpoint are constants in edc-auth.mjs (not configurable). docs/edc-account/design.md
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAuth, EDC, AuthError } from "./edc-auth.mjs";
import { openStore, createLock, CONFIG_DIR } from "./token-store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.error("[edc]", ...a); // stdout is reserved for the MCP protocol

function openBrowser(url) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch {}
}

const store = await openStore();
const auth = createAuth({
  store,
  lock: createLock(),
  openBrowser,
  log,
  legacyAuthFile: join(CONFIG_DIR, "auth.json"),
});
const storeNote = store.kind === "file" ? "file (no OS keychain found; ~/.config/edc/token.json, permissions 600)" : store.kind;

async function check() {
  let token;
  try { token = await auth.getAccessToken(); } catch (e) { log(e.message); return 1; }
  // Read-only probe of a nonexistent id: 404 not_found => endpoint reachable AND token accepted. Consumes no analysis quota.
  const probe = async (credential) => fetch(`${EDC.apiBase}/v1/analyses/00000000-0000-4000-8000-000000000000`, {
    headers: { Authorization: `Bearer ${credential}`, Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(20000),
  });
  try {
    let res = await probe(token);
    if (res.status === 401) {
      try { res = await probe(await auth.getAccessToken({ force: true })); } catch (e) { log(e.message); return 1; }
    }
    const body = await res.text().catch(() => "");
    const err = (() => { try { return JSON.parse(body).error ?? {}; } catch { return {}; } })();
    if (res.status === 404 && (!err.code || err.code === "not_found")) { log(`OK: ${EDC.apiBase} reachable, EDC account sign-in accepted.`); return 0; }
    if (res.status === 401) log("401 unauthenticated: the EDC Web API did not accept the token. Run: node mcp/launcher.mjs login");
    else if (res.status === 403) log(`403 permission_denied: ${err.message ?? ""} Run login again and allow the requested access.`);
    else if (res.status === 500 && err.code === "internal") log(`500 internal: ${err.message ?? ""} Try again later.`);
    else if (res.status >= 300 && res.status < 400) log(`Redirected (${res.status}); refusing to follow.`);
    else log(`Unexpected response ${res.status}${err.code ? ` (${err.code})` : ""}.`);
    return 1;
  } catch (e) { log(`Cannot reach ${EDC.apiBase}: ${e.cause?.code || e.message}`); return 1; }
}

const cmd = process.argv[2];
if (cmd === "login") {
  try {
    await auth.login({ device: process.argv.includes("--device") });
    process.exit(await check());
  } catch (e) {
    log(e instanceof AuthError ? e.message : `Login failed: ${e.message}`);
    process.exit(1);
  }
}
if (cmd === "logout") {
  try { await auth.logout(); log("Signed out (the sign-in was revoked and removed)."); process.exit(0); } catch (e) { log(e.message); process.exit(1); }
}
if (cmd === "check") process.exit(await check());
if (cmd === "status") {
  const s = await auth.status();
  console.log(JSON.stringify({ authMode: s.signedIn ? "edc-account" : "none", ...s, store: storeNote, issuer: EDC.issuer, apiBase: EDC.apiBase }, null, 2));
  process.exit(0);
}
if (cmd === "register" || cmd === "setup") {
  log("EDC now uses the EDC account. Run: node mcp/launcher.mjs login   (new users can register on that screen)");
  process.exit(1);
}
if (cmd !== undefined) {
  log(`Unknown command: ${cmd}. Commands: login [--device] | logout | check | status`);
  process.exit(2);
}

// ---- start the MCP server ----
globalThis.__edcAuth = { getAccessToken: (options) => auth.getAccessToken(options) }; // picked up by dist/index.mjs
const s = await auth.status();
if (!s.signedIn) log("Not signed in. Run once: node mcp/launcher.mjs login   (new users can register on that screen)");
else log(`auth: EDC account (store: ${storeNote})`);
await import(pathToFileURL(join(here, "dist", "index.mjs")).href);
