// テスト用の偽の認可サーバー(127.0.0.1)。EDC アカウント(oidc-provider)のふるまいのうち、プラグインが頼るところだけをまねる:
// 認可コード + PKCE、端末のフロー、リフレッシュトークンの入れ替えと使い回しの検知(許可ごと失効)、失効の入口
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";

const rand = () => randomBytes(12).toString("base64url");

export async function startFakeIssuer(options = {}) {
  const calls = [];
  const codes = new Map(); // code -> { challenge, redirectUri, resource, scope }
  const refresh = new Map(); // token -> { grant, consumed }
  const revokedGrants = new Set();
  const devices = new Map(); // device_code -> { polls }
  const state = {
    // 認可の画面の代わり: 既定は許可してコールバックへ戻す。テストで差し替える
    authorize: (q) => ({ code: true, state: q.get("state"), iss: base }),
    deviceScript: ["authorization_pending", "ok"],
    tokenFailure: null, // { status, body } を入れると /token がそれを返す
    expiresIn: 900,
    rotate: true,
  };
  let base;

  const issue = (grant, scope) => {
    const rt = `rt-${rand()}`;
    refresh.set(rt, { grant, consumed: false });
    return { access_token: `at-${rand()}`, token_type: "Bearer", expires_in: state.expiresIn, refresh_token: rt, scope };
  };

  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, base);
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    calls.push({ method: req.method, path: url.pathname, query: url.searchParams, form });

    if (url.pathname === "/auth") {
      const q = url.searchParams;
      const out = state.authorize(q);
      const redirect = new URL(q.get("redirect_uri"));
      if (out.code) {
        const code = `code-${rand()}`;
        codes.set(code, { challenge: q.get("code_challenge"), redirectUri: q.get("redirect_uri"), resource: q.get("resource"), scope: q.get("scope") });
        redirect.searchParams.set("code", code);
      }
      if (out.error) redirect.searchParams.set("error", out.error);
      if (out.state !== undefined) redirect.searchParams.set("state", out.state);
      if (out.iss !== undefined) redirect.searchParams.set("iss", out.iss);
      res.writeHead(302, { Location: redirect.href }).end();
      return;
    }
    if (url.pathname === "/device/auth") {
      const dc = `dc-${rand()}`;
      devices.set(dc, { polls: 0, scope: form.get("scope") });
      send(res, 200, { device_code: dc, user_code: "ABCD-EFGH", verification_uri: `${base}/device`, verification_uri_complete: `${base}/device?user_code=ABCD-EFGH`, expires_in: 600, interval: 1 });
      return;
    }
    if (url.pathname === "/token/revocation") {
      const entry = refresh.get(form.get("token"));
      if (entry) revokedGrants.add(entry.grant);
      res.writeHead(200).end();
      return;
    }
    if (url.pathname === "/token") {
      if (state.tokenFailure) return send(res, state.tokenFailure.status, state.tokenFailure.body);
      const grantType = form.get("grant_type");
      if (grantType === "authorization_code") {
        const c = codes.get(form.get("code"));
        codes.delete(form.get("code"));
        const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        if (!c || c.challenge !== challenge || c.redirectUri !== form.get("redirect_uri") || form.get("resource") !== c.resource) {
          return send(res, 400, { error: "invalid_grant", error_description: "grant request is invalid" });
        }
        return send(res, 200, issue(rand(), c.scope));
      }
      if (grantType === "urn:ietf:params:oauth:grant-type:device_code") {
        const d = devices.get(form.get("device_code"));
        if (!d) return send(res, 400, { error: "invalid_grant" });
        const step = state.deviceScript[Math.min(d.polls++, state.deviceScript.length - 1)];
        if (step !== "ok") return send(res, 400, { error: step });
        return send(res, 200, issue(rand(), d.scope));
      }
      if (grantType === "refresh_token") {
        const entry = refresh.get(form.get("refresh_token"));
        if (!entry || revokedGrants.has(entry.grant)) return send(res, 400, { error: "invalid_grant", error_description: "grant request is invalid" });
        if (entry.consumed) {
          // oidc-provider: 使い回しを見たら、許可ごと失効させる
          revokedGrants.add(entry.grant);
          return send(res, 400, { error: "invalid_grant", error_description: "refresh token already used" });
        }
        if (options.refreshDelayMs) await new Promise((r) => setTimeout(r, options.refreshDelayMs));
        if (!state.rotate) return send(res, 200, { access_token: `at-${rand()}`, token_type: "Bearer", expires_in: state.expiresIn, scope: form.get("scope") });
        entry.consumed = true;
        return send(res, 200, issue(entry.grant, form.get("scope")));
      }
      return send(res, 400, { error: "unsupported_grant_type" });
    }
    res.writeHead(404).end();
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const config = {
    issuer: base,
    authorizationEndpoint: `${base}/auth`,
    tokenEndpoint: `${base}/token`,
    deviceAuthorizationEndpoint: `${base}/device/auth`,
    revocationEndpoint: `${base}/token/revocation`,
    clientId: "edc-cli",
    resource: "https://entertainment-design-catalog.web.app/v1",
    scope: "analyses:read analyses:write cases:read",
    apiBase: "https://entertainment-design-catalog.web.app",
  };
  return {
    config,
    calls,
    state,
    revokedGrants,
    refreshCalls: () => calls.filter((c) => c.path === "/token" && c.form.get("grant_type") === "refresh_token"),
    close: () => new Promise((r) => server.close(r)),
  };
}

/** メモリの保存先(テスト用。token-store.mjs と同じ形) */
export function memoryStore(initial = null) {
  let value = initial;
  return {
    kind: "memory",
    writes: 0,
    async read() { return value === null ? null : structuredClone(value); },
    async write(v) { this.writes++; value = structuredClone(v); },
    async remove() { value = null; },
    peek: () => value,
  };
}
