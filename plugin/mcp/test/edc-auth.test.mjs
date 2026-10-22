// edc-auth.mjs のテスト(design.md 10 節の TEST-P01〜P08、P13)
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuth, EDC, AuthError } from "../edc-auth.mjs";
import { createLock } from "../token-store.mjs";
import { startFakeIssuer, memoryStore } from "./fakeIssuer.mjs";

const SECRET = /\b(at|rt|code|dc)-[A-Za-z0-9_-]{12,}/;

let issuer, dir, logs, googleRevokes;
beforeEach(async () => {
  issuer = await startFakeIssuer();
  dir = mkdtempSync(join(tmpdir(), "edc-auth-"));
  logs = [];
  googleRevokes = [];
});
afterEach(async () => {
  await issuer.close();
  rmSync(dir, { recursive: true, force: true });
});

const fetchSpy = (url, init) => {
  if (String(url).startsWith("https://oauth2.googleapis.com/revoke")) {
    googleRevokes.push(new URLSearchParams(init.body).get("token"));
    return Promise.resolve(new Response("", { status: 200 }));
  }
  return globalThis.fetch(url, init);
};

function make(overrides = {}) {
  return createAuth({
    config: issuer.config,
    store: overrides.store ?? memoryStore(),
    lock: createLock({ file: join(dir, "token.lock") }),
    fetch: fetchSpy,
    // ブラウザの代わり: 認可の URL を開き、リダイレクトをたどってループバックのコールバックへ届ける
    openBrowser: async (url) => { await fetch(url); },
    log: (...a) => logs.push(a.join(" ")),
    sleep: async () => {},
    legacyAuthFile: join(dir, "auth.json"),
    ...overrides,
  });
}

const signedIn = (now = Date.now()) => ({ v: 1, refreshToken: "rt-initial000000000", accessToken: "at-initial000000000", expiresAt: now - 1000, scope: EDC.scope, savedAt: now });

test("定数は約束の値(信頼の起点)", () => {
  assert.equal(EDC.issuer, "https://edc-account-366057354766.asia-east1.run.app");
  assert.equal(EDC.authorizationEndpoint, `${EDC.issuer}/auth`);
  assert.equal(EDC.tokenEndpoint, `${EDC.issuer}/token`);
  assert.equal(EDC.deviceAuthorizationEndpoint, `${EDC.issuer}/device/auth`);
  assert.equal(EDC.revocationEndpoint, `${EDC.issuer}/token/revocation`);
  assert.equal(EDC.clientId, "edc-cli");
  assert.equal(EDC.resource, "https://entertainment-design-catalog.web.app/v1");
  assert.equal(EDC.scope, "analyses:read analyses:write cases:read");
  assert.equal(EDC.apiBase, "https://entertainment-design-catalog.web.app");
  assert.ok(Object.isFrozen(EDC));
});

test("TEST-P01 ブラウザのログイン: 認可の引数・コードの引き換え・保存", async () => {
  const store = memoryStore();
  const auth = make({ store });
  await auth.login();

  const authz = issuer.calls.find((c) => c.path === "/auth").query;
  assert.equal(authz.get("response_type"), "code");
  assert.equal(authz.get("client_id"), "edc-cli");
  assert.equal(authz.get("resource"), issuer.config.resource);
  assert.equal(authz.get("scope"), issuer.config.scope);
  assert.equal(authz.get("code_challenge_method"), "S256");
  assert.match(authz.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.match(authz.get("state"), /^[A-Za-z0-9_-]{16,}$/);
  assert.match(authz.get("redirect_uri"), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);

  const exchange = issuer.calls.find((c) => c.path === "/token").form;
  assert.equal(exchange.get("grant_type"), "authorization_code");
  assert.equal(exchange.get("client_id"), "edc-cli");
  assert.equal(exchange.get("resource"), issuer.config.resource);
  assert.equal(exchange.get("redirect_uri"), authz.get("redirect_uri"));
  assert.equal(exchange.get("client_secret"), null);

  const saved = store.peek();
  assert.equal(saved.v, 1);
  assert.match(saved.refreshToken, /^rt-/);
  assert.match(saved.accessToken, /^at-/);
  assert.ok(saved.expiresAt > Date.now() + 800_000);
  assert.equal(saved.scope, issuer.config.scope);
  assert.equal(await auth.getAccessToken(), saved.accessToken);
  assert.equal(issuer.refreshCalls().length, 0);
  assert.ok(!logs.some((l) => SECRET.test(l)), "ログに秘密が出ている");
});

for (const [name, authorize, expected] of [
  ["state が違う", (q) => ({ code: true, state: "other", iss: issuer.config.issuer }), /state/],
  ["iss が違う", (q) => ({ code: true, state: q.get("state"), iss: "https://evil.example" }), /iss/],
  ["iss がない", (q) => ({ code: true, state: q.get("state") }), /iss/],
  ["error が返る", (q) => ({ error: "access_denied", state: q.get("state"), iss: issuer.config.issuer }), /access_denied/],
]) {
  test(`TEST-P02 コールバックの ${name} なら失敗し、保存しない`, async () => {
    issuer.state.authorize = (q) => authorize(q);
    const store = memoryStore();
    const auth = make({ store });
    await assert.rejects(auth.login(), (e) => e instanceof AuthError && expected.test(e.message) && !SECRET.test(e.message));
    assert.equal(store.peek(), null);
    assert.equal(issuer.calls.filter((c) => c.path === "/token").length, 0, "コードを引き換えてはいけない");
  });
}

test("TEST-P02 /callback 以外のパスは無視して待ち続ける", async () => {
  const auth = make({
    openBrowser: async (url) => {
      const redirect = new URL(new URL(url).searchParams.get("redirect_uri"));
      const stray = await fetch(new URL("/favicon.ico", redirect));
      assert.equal(stray.status, 404);
      await fetch(url);
    },
  });
  await auth.login();
  assert.ok(await auth.getAccessToken());
});

test("TEST-P02 時間内にコールバックがなければ失敗", async () => {
  const auth = make({ openBrowser: async () => {} });
  await assert.rejects(auth.login({ timeoutMs: 50 }), (e) => e instanceof AuthError && /時間/.test(e.message));
});

test("TEST-P03 端末のフロー: pending → slow_down → 成功", async () => {
  issuer.state.deviceScript = ["authorization_pending", "slow_down", "ok"];
  const waits = [];
  const store = memoryStore();
  const auth = make({ store, sleep: async (ms) => { waits.push(ms); } });
  await auth.login({ device: true });

  const start = issuer.calls.find((c) => c.path === "/device/auth").form;
  assert.equal(start.get("client_id"), "edc-cli");
  assert.equal(start.get("scope"), issuer.config.scope);
  assert.equal(start.get("resource"), issuer.config.resource);
  const polls = issuer.calls.filter((c) => c.path === "/token");
  assert.equal(polls.length, 3);
  for (const p of polls) {
    assert.equal(p.form.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
    assert.equal(p.form.get("resource"), issuer.config.resource);
  }
  assert.deepEqual(waits, [1000, 1000, 6000]);
  assert.match(store.peek().refreshToken, /^rt-/);
  assert.ok(logs.some((l) => l.includes("ABCD-EFGH")), "利用者のコードを見せる");
  assert.ok(!logs.some((l) => SECRET.test(l)));
});

for (const step of ["expired_token", "access_denied"]) {
  test(`TEST-P03 端末のフロー: ${step} で失敗`, async () => {
    issuer.state.deviceScript = ["authorization_pending", step];
    const store = memoryStore();
    await assert.rejects(make({ store }).login({ device: true }), (e) => e instanceof AuthError && e.message.includes(step));
    assert.equal(store.peek(), null);
  });
}

test("TEST-P04 取り直し: 期限切れなら更新し、入れ替わったリフレッシュトークンを保存する", async () => {
  const store = memoryStore();
  await make({ store }).login();
  const first = store.peek();
  // 期限切れにする
  await store.write({ ...first, expiresAt: Date.now() - 1 });
  const auth = make({ store });
  const token = await auth.getAccessToken();
  const after = store.peek();
  assert.notEqual(token, first.accessToken);
  assert.equal(after.accessToken, token);
  assert.notEqual(after.refreshToken, first.refreshToken);
  const call = issuer.refreshCalls()[0].form;
  assert.equal(call.get("client_id"), "edc-cli");
  assert.equal(call.get("resource"), issuer.config.resource);
  assert.equal(call.get("scope"), issuer.config.scope);
  assert.equal(call.get("refresh_token"), first.refreshToken);
  // メモリにあるうちは、更新も保存の読み直しもしない
  assert.equal(await auth.getAccessToken(), token);
  assert.equal(issuer.refreshCalls().length, 1);
});

test("TEST-P04 残りが 60 秒以下なら更新する。force でも更新する", async () => {
  const store = memoryStore();
  await make({ store }).login();
  await store.write({ ...store.peek(), expiresAt: Date.now() + 59_000 });
  const auth = make({ store });
  await auth.getAccessToken();
  assert.equal(issuer.refreshCalls().length, 1);
  await auth.getAccessToken({ force: true });
  assert.equal(issuer.refreshCalls().length, 2);
});

test("TEST-P04 応答に refresh_token がなければ、今のものを使い続ける", async () => {
  const store = memoryStore();
  await make({ store }).login();
  const rt = store.peek().refreshToken;
  await store.write({ ...store.peek(), expiresAt: 0 });
  issuer.state.rotate = false;
  await make({ store }).getAccessToken();
  assert.equal(store.peek().refreshToken, rt);
});

test("TEST-P05 2 つのプロセスが同時に取り直しても、更新は 1 回だけ(許可を失効させない)", async () => {
  await issuer.close();
  issuer = await startFakeIssuer({ refreshDelayMs: 150 });
  const store = memoryStore();
  await make({ store }).login();
  await store.write({ ...store.peek(), expiresAt: 0 });
  const a = make({ store });
  const b = make({ store });
  const [ta, tb] = await Promise.all([a.getAccessToken(), b.getAccessToken()]);
  assert.equal(ta, tb);
  assert.equal(issuer.refreshCalls().length, 1);
  assert.equal(issuer.revokedGrants.size, 0);
});

test("TEST-P05 force は、ほかのプロセスが錠の間に更新したトークンをそのまま使う", async () => {
  const store = memoryStore();
  await make({ store }).login();
  const a = make({ store });
  const b = make({ store });
  const old = await a.getAccessToken();
  const fresh = await b.getAccessToken({ force: true });
  assert.notEqual(fresh, old);
  assert.equal(await a.getAccessToken({ force: true }), fresh);
  assert.equal(issuer.refreshCalls().length, 1);
});

test("TEST-P04 更新の後の保存に失敗しても、新しいトークンで続け、そのことを知らせる", async () => {
  const store = memoryStore(signedIn());
  await make({ store }).login();
  await store.write({ ...store.peek(), expiresAt: 0 });
  store.write = async () => { throw new Error("keychain locked"); };
  const auth = make({ store });
  const token = await auth.getAccessToken();
  assert.match(token, /^at-/);
  assert.equal(await auth.getAccessToken(), token);
  assert.ok(logs.some((l) => l.includes("保存できませんでした")));
  assert.ok(!logs.some((l) => SECRET.test(l)));
});

test("TEST-P06 invalid_grant なら保存を消し、login を案内する", async () => {
  const store = memoryStore(signedIn());
  issuer.state.tokenFailure = { status: 400, body: { error: "invalid_grant", error_description: "grant request is invalid" } };
  await assert.rejects(make({ store }).getAccessToken(), (e) => e instanceof AuthError && e.code === "signed_out" && /login/.test(e.message));
  assert.equal(store.peek(), null);
});

test("TEST-P06 通信の失敗・サーバーの誤りでは保存を消さない", async () => {
  const store = memoryStore(signedIn());
  issuer.state.tokenFailure = { status: 500, body: { error: "server_error" } };
  await assert.rejects(make({ store }).getAccessToken(), (e) => e instanceof AuthError && e.code === "oauth_error");
  assert.ok(store.peek());
  await assert.rejects(
    make({ store, fetch: () => Promise.reject(new TypeError("fetch failed")) }).getAccessToken(),
    (e) => e instanceof AuthError && e.code === "network",
  );
  assert.ok(store.peek());
});

test("TEST-P06 保存がなければ not_signed_in", async () => {
  await assert.rejects(make().getAccessToken(), (e) => e instanceof AuthError && e.code === "not_signed_in" && /login/.test(e.message));
});

test("TEST-P07 誤りの文に、応答の本文やトークンを入れない", async () => {
  const store = memoryStore(signedIn());
  issuer.state.tokenFailure = { status: 400, body: { error: "invalid_request", error_description: "rt-leakedleaked0000 at-leakedleaked0000" } };
  await assert.rejects(make({ store }).getAccessToken(), (e) => !SECRET.test(e.message) && !SECRET.test(String(e.stack)) && e.message.includes("invalid_request"));
  // 応答が JSON でなくても
  issuer.state.tokenFailure = { status: 200, body: { access_token: 42 } };
  await assert.rejects(make({ store }).getAccessToken(), (e) => e instanceof AuthError && e.code === "invalid_response");
});

test("TEST-P07 token_type が Bearer でない応答は受け取らない", async () => {
  const store = memoryStore(signedIn());
  issuer.state.tokenFailure = { status: 200, body: { access_token: "at-xxxxxxxxxxxxxxxx", token_type: "DPoP", expires_in: 900 } };
  await assert.rejects(make({ store }).getAccessToken(), (e) => e.code === "invalid_response");
});

test("TEST-P08 ログアウト: リフレッシュトークンを失効させ、保存を消す", async () => {
  const store = memoryStore();
  const auth = make({ store });
  await auth.login();
  const rt = store.peek().refreshToken;
  await auth.logout();
  const call = issuer.calls.find((c) => c.path === "/token/revocation").form;
  assert.equal(call.get("token"), rt);
  assert.equal(call.get("token_type_hint"), "refresh_token");
  assert.equal(call.get("client_id"), "edc-cli");
  assert.equal(store.peek(), null);
  assert.equal(issuer.revokedGrants.size, 1);
  await assert.rejects(auth.getAccessToken(), (e) => e.code === "not_signed_in");
});

test("TEST-P08 失効に失敗しても、保存は消す", async () => {
  const store = memoryStore(signedIn());
  await make({ store, fetch: () => Promise.reject(new TypeError("fetch failed")) }).logout();
  assert.equal(store.peek(), null);
});

test("TEST-P13 古い Google ログインを片づける(失効させて消す)", async () => {
  const legacy = join(dir, "auth.json");
  writeFileSync(legacy, JSON.stringify({ refresh_token: "g-rt-legacy", id_token: "x", exp: 0, email: "a@example.com" }));
  await make().login();
  assert.deepEqual(googleRevokes, ["g-rt-legacy"]);
  assert.equal(existsSync(legacy), false);
  assert.ok(!logs.some((l) => l.includes("a@example.com")), "メールアドレスを出さない");
});

test("TEST-P13 ログインが失敗したら、古い Google ログインは残す", async () => {
  const legacy = join(dir, "auth.json");
  writeFileSync(legacy, JSON.stringify({ refresh_token: "g-rt-legacy" }));
  issuer.state.authorize = (q) => ({ error: "access_denied", state: q.get("state"), iss: issuer.config.issuer });
  await assert.rejects(make().login());
  assert.equal(existsSync(legacy), true);
  assert.deepEqual(googleRevokes, []);
});

test("status は秘密を出さない", async () => {
  const store = memoryStore();
  const auth = make({ store });
  assert.deepEqual(await auth.status(), { signedIn: false });
  await auth.login();
  const s = await auth.status();
  assert.equal(s.signedIn, true);
  assert.equal(s.scope, issuer.config.scope);
  assert.ok(!SECRET.test(JSON.stringify(s)));
});
