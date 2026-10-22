// EDC アカウント(OAuth 2.1)のログインとトークンの取り直し(docs/edc-account/design.md 2〜6 節)。
// 依存なし。外とのやりとり(fetch・保存・錠・時計・ブラウザ・ログ)は createAuth の引数で受ける。
// トークン・リフレッシュトークン・認可コード・PKCE の検証子は、ログ・誤りの文に出さない(REQ-P11)。
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";

const ISSUER = "https://edc-account-366057354766.asia-east1.run.app";
/** 信頼の起点。環境変数・.env では変えない(REQ-P15)。2026-10-21 のメタデータで確かめた値 */
export const EDC = Object.freeze({
  issuer: ISSUER,
  authorizationEndpoint: `${ISSUER}/auth`,
  tokenEndpoint: `${ISSUER}/token`,
  deviceAuthorizationEndpoint: `${ISSUER}/device/auth`,
  revocationEndpoint: `${ISSUER}/token/revocation`,
  clientId: "edc-cli",
  resource: "https://entertainment-design-catalog.web.app/v1",
  scope: "analyses:read analyses:write cases:read",
  /** トークンを送ってよい唯一の宛先(REQ-P12) */
  apiBase: "https://entertainment-design-catalog.web.app",
});

const LOGIN_HINT = "node mcp/launcher.mjs login";
/** 残りがこれより短いトークンは使わず、取り直す */
const REFRESH_MARGIN_MS = 60_000;
const DEVICE_CODE = "urn:ietf:params:oauth:grant-type:device_code";
const GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke";

/** code: not_signed_in / signed_out / login_failed / oauth_error / invalid_response / network */
export class AuthError extends Error {
  name = "AuthError";
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const OAUTH_ERROR = /^[\x20-\x21\x23-\x5b\x5d-\x7e]{1,64}$/; // RFC 6749 の error の文字。応答の本文はこれ以外出さない

export function createAuth({
  config = EDC,
  store,
  lock,
  fetch = globalThis.fetch,
  now = Date.now,
  openBrowser = () => {},
  log = () => {},
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  legacyAuthFile,
} = {}) {
  let memory = null; // { accessToken, expiresAt }

  async function post(url, params) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(params),
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new AuthError("network", `EDC アカウントに接続できませんでした(${new URL(url).host})`);
    }
    let body = null;
    try { body = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, body };
  }

  const oauthErrorOf = (r) => (typeof r.body?.error === "string" && OAUTH_ERROR.test(r.body.error) ? r.body.error : `HTTP ${r.status}`);

  /** トークンの応答を確かめ、保存の形にする */
  function toRecord(r, previousRefreshToken) {
    const b = r.body;
    if (!b || typeof b.access_token !== "string" || !b.access_token || typeof b.token_type !== "string" || b.token_type.toLowerCase() !== "bearer"
      || typeof b.expires_in !== "number" || !(b.expires_in > 0)) {
      throw new AuthError("invalid_response", "EDC アカウントの応答が想定と違います");
    }
    const refreshToken = typeof b.refresh_token === "string" && b.refresh_token ? b.refresh_token : previousRefreshToken;
    if (!refreshToken) throw new AuthError("invalid_response", "EDC アカウントがリフレッシュトークンを返しませんでした");
    const t = now();
    return { v: 1, refreshToken, accessToken: b.access_token, expiresAt: t + b.expires_in * 1000, scope: typeof b.scope === "string" ? b.scope : config.scope, savedAt: t };
  }

  async function exchange(params, previousRefreshToken) {
    const r = await post(config.tokenEndpoint, { client_id: config.clientId, resource: config.resource, ...params });
    if (!r.ok) return { error: oauthErrorOf(r) };
    return { record: toRecord(r, previousRefreshToken) };
  }

  async function save(record) {
    await store.write(record);
    memory = { accessToken: record.accessToken, expiresAt: record.expiresAt };
  }

  // ---- ブラウザのログイン(認可コード + PKCE、ループバック。design.md 3.1) ----
  async function loginBrowser({ timeoutMs = 300_000 } = {}) {
    const verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const state = b64url(randomBytes(16));
    let redirectUri;
    const code = await new Promise((resolve, reject) => {
      let timer;
      const finish = (fn, value) => { clearTimeout(timer); server.close(); server.closeAllConnections?.(); fn(value); };
      const server = createServer((req, res) => {
        const u = new URL(req.url, "http://127.0.0.1");
        if (req.method !== "GET" || u.pathname !== "/callback") { res.writeHead(404).end(); return; }
        const q = u.searchParams;
        let failure = null;
        if (q.get("iss") !== config.issuer) failure = "応答の iss が EDC アカウントと違います";
        else if (q.get("state") !== state) failure = "応答の state が違います";
        else if (q.get("error")) failure = `認可されませんでした(${OAUTH_ERROR.test(q.get("error")) ? q.get("error") : "error"})`;
        else if (!q.get("code")) failure = "応答に code がありません";
        res.writeHead(failure ? 400 : 200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy": "default-src 'none'",
        });
        res.end(failure ? "<h3>ログインできませんでした。ターミナルを確かめてください。</h3>" : "<h3>ログインできました。このタブは閉じて構いません。</h3>");
        failure ? finish(reject, new AuthError("login_failed", failure)) : finish(resolve, q.get("code"));
      });
      server.on("error", (e) => finish(reject, new AuthError("login_failed", `ログインの受け口を開けませんでした(${e.code ?? e.message})`)));
      server.listen(0, "127.0.0.1", () => {
        redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
        const url = `${config.authorizationEndpoint}?${new URLSearchParams({
          response_type: "code", client_id: config.clientId, redirect_uri: redirectUri, scope: config.scope, resource: config.resource,
          code_challenge: challenge, code_challenge_method: "S256", state,
        })}`;
        log(`ブラウザで EDC アカウントにログインします(未登録なら、その画面で登録できます)。開かなければ、この URL を開いてください:\n${url}`);
        Promise.resolve(openBrowser(url)).catch(() => {});
      });
      timer = setTimeout(() => finish(reject, new AuthError("login_failed", `時間内にログインが終わりませんでした(${Math.round(timeoutMs / 1000)} 秒)`)), timeoutMs);
    });
    const out = await exchange({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier });
    if (out.error) throw new AuthError("login_failed", `コードを引き換えられませんでした(${out.error})`);
    return out.record;
  }

  // ---- 端末のフロー(RFC 8628。design.md 3.2) ----
  async function loginDevice() {
    const r = await post(config.deviceAuthorizationEndpoint, { client_id: config.clientId, scope: config.scope, resource: config.resource });
    const d = r.body;
    if (!r.ok || typeof d?.device_code !== "string" || typeof d?.user_code !== "string" || typeof d?.verification_uri !== "string") {
      throw new AuthError("login_failed", `端末のフローを始められませんでした(${r.ok ? "応答が想定と違います" : oauthErrorOf(r)})`);
    }
    log(`別の端末のブラウザで次を開き、コード ${d.user_code} を確かめてログインしてください(未登録なら、その画面で登録できます):\n${typeof d.verification_uri_complete === "string" ? d.verification_uri_complete : d.verification_uri}`);
    let interval = (Number.isFinite(d.interval) && d.interval > 0 ? d.interval : 5) * 1000;
    const deadline = now() + (Number.isFinite(d.expires_in) && d.expires_in > 0 ? d.expires_in : 600) * 1000;
    for (;;) {
      await sleep(interval);
      if (now() > deadline) throw new AuthError("login_failed", "時間内にログインが終わりませんでした(expired_token)");
      const out = await exchange({ grant_type: DEVICE_CODE, device_code: d.device_code });
      if (out.record) return out.record;
      if (out.error === "authorization_pending") continue;
      if (out.error === "slow_down") { interval += 5000; continue; }
      throw new AuthError("login_failed", `ログインできませんでした(${out.error})`);
    }
  }

  /** 古い Google ログイン(~/.config/edc/auth.json)を片づける(REQ-P05)。失敗しても続ける */
  async function cleanupLegacyGoogle() {
    if (!legacyAuthFile) return;
    let legacy;
    try { legacy = JSON.parse(readFileSync(legacyAuthFile, "utf8")); } catch (e) { if (e.code === "ENOENT") return; legacy = null; }
    if (typeof legacy?.refresh_token === "string") {
      try {
        await fetch(GOOGLE_REVOKE, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: legacy.refresh_token }), redirect: "error", signal: AbortSignal.timeout(10000) });
      } catch {}
    }
    try { unlinkSync(legacyAuthFile); log("前の Google ログインを失効させ、消しました。"); } catch {}
  }

  return {
    async login({ device = false, timeoutMs } = {}) {
      const record = device ? await loginDevice() : await loginBrowser({ timeoutMs });
      await lock.withLock(() => save(record));
      log(`EDC アカウントにログインしました(許可: ${record.scope})。保存先: ${store.kind}`);
      await cleanupLegacyGoogle();
      return { scope: record.scope };
    },

    /** force: 今のトークンが受け付けられなかった(401)。ほかのプロセスが更新済みならそれを、そうでなければ更新する */
    async getAccessToken({ force = false } = {}) {
      if (!force && memory && memory.expiresAt - now() > REFRESH_MARGIN_MS) return memory.accessToken;
      const rejected = force ? memory?.accessToken : undefined;
      return lock.withLock(async () => {
        const saved = await store.read();
        if (!saved?.refreshToken) {
          memory = null;
          throw new AuthError("not_signed_in", `サインインしていません。${LOGIN_HINT} を実行してください(未登録なら、その中で登録できます)。`);
        }
        const fresh = saved.expiresAt - now() > REFRESH_MARGIN_MS;
        // force で、手元のトークンがまだない・保存と同じなら、保存のものも受け付けられないとみなす
        if (fresh && (!force || (rejected !== undefined && saved.accessToken !== rejected))) {
          memory = { accessToken: saved.accessToken, expiresAt: saved.expiresAt };
          return saved.accessToken;
        }
        const out = await exchange({ grant_type: "refresh_token", refresh_token: saved.refreshToken, scope: config.scope }, saved.refreshToken);
        if (out.error === "invalid_grant") {
          memory = null;
          await store.remove();
          throw new AuthError("signed_out", `サインインが切れました(失効・期限切れ・停止)。${LOGIN_HINT} を実行してください。`);
        }
        if (out.error) throw new AuthError("oauth_error", `トークンを取り直せませんでした(${out.error})。時間をおいて試してください。`);
        // 古いリフレッシュトークンはもう使えない。保存に失敗しても、このプロセスは新しいトークンで続ける
        memory = { accessToken: out.record.accessToken, expiresAt: out.record.expiresAt };
        try {
          await store.write(out.record);
        } catch {
          log(`更新したトークンを保存できませんでした(${store.kind})。このプロセスは続けられますが、次に起動したときは ${LOGIN_HINT} が要ります。`);
        }
        return out.record.accessToken;
      });
    },

    async logout() {
      await lock.withLock(async () => {
        const saved = await store.read().catch(() => null);
        if (saved?.refreshToken) {
          try {
            await post(config.revocationEndpoint, { token: saved.refreshToken, token_type_hint: "refresh_token", client_id: config.clientId });
          } catch {}
        }
        memory = null;
        await store.remove();
      });
    },

    async status() {
      const saved = await store.read().catch(() => null);
      if (!saved?.refreshToken) return { signedIn: false };
      return { signedIn: true, scope: saved.scope, accessTokenExpiresAt: new Date(saved.expiresAt).toISOString() };
    },
  };
}
