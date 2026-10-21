// src/apiCall.ts のテスト(design.md 10 節の TEST-P11)
import { test } from "node:test";
import assert from "node:assert/strict";
import { EdcApiError } from "@entertainment-design-catalog/design-tags";
import { callWithRetry, describeError } from "../src/apiCall.ts";
import { AuthError } from "../edc-auth.mjs";

const apiError = (code, status, extra = {}) => new EdcApiError({ code, status, message: `server says ${code}`, retryable: false, ...extra });

function harness(failures) {
  const state = { runs: 0, refreshes: 0, sleeps: [] };
  const run = async () => {
    const f = failures[state.runs++];
    if (f) throw f;
    return "ok";
  };
  const deps = { refresh: async () => { state.refreshes++; }, sleep: async (ms) => { state.sleeps.push(ms); } };
  return { state, run, deps };
}

test("TEST-P11 401 なら取り直して一度だけやり直す", async () => {
  const { state, run, deps } = harness([apiError("unauthenticated", 401)]);
  assert.equal(await callWithRetry(run, deps), "ok");
  assert.deepEqual([state.runs, state.refreshes], [2, 1]);
});

test("TEST-P11 2 回続けて 401 なら login を案内する", async () => {
  const { state, run, deps } = harness([apiError("unauthenticated", 401), apiError("unauthenticated", 401)]);
  await assert.rejects(callWithRetry(run, deps), (e) => e instanceof EdcApiError && e.status === 401);
  assert.deepEqual([state.runs, state.refreshes], [2, 1]);
  assert.match(describeError(apiError("unauthenticated", 401)), /node mcp\/launcher\.mjs login/);
});

test("TEST-P11 取り直しが失敗したら、その理由を返す(やり直さない)", async () => {
  const { state, run } = harness([apiError("unauthenticated", 401)]);
  const signedOut = new AuthError("signed_out", "サインインが切れました。node mcp/launcher.mjs login を実行してください。");
  await assert.rejects(callWithRetry(run, { refresh: async () => { throw signedOut; }, sleep: async () => {} }), (e) => e === signedOut);
  assert.equal(state.runs, 1);
});

test("TEST-P11 資格情報を取れない(ログインしていない)ときは、やり直さずに理由を出す", async () => {
  const cause = new AuthError("not_signed_in", "サインインしていません。node mcp/launcher.mjs login を実行してください(未登録なら、その中で登録できます)。");
  const wrapped = new EdcApiError({ code: "unauthenticated", message: "資格情報を取得できませんでした", retryable: false, cause });
  const { state, run, deps } = harness([wrapped]);
  await assert.rejects(callWithRetry(run, deps));
  assert.deepEqual([state.runs, state.refreshes], [1, 0]);
  assert.match(describeError(wrapped), /未登録なら、その中で登録できます/);
});

test("TEST-P11 500 internal(retryable)は 2 秒待って一度だけやり直す", async () => {
  const { state, run, deps } = harness([apiError("internal", 500, { retryable: true })]);
  assert.equal(await callWithRetry(run, deps), "ok");
  assert.deepEqual(state.sleeps, [2000]);
  const twice = harness([apiError("internal", 500, { retryable: true }), apiError("internal", 500, { retryable: true })]);
  await assert.rejects(callWithRetry(twice.run, twice.deps));
  assert.equal(twice.state.runs, 2);
  assert.match(describeError(apiError("internal", 500, { retryable: true })), /時間をおいて/);
});

test("TEST-P11 500 internal でも retryable でなければやり直さない", async () => {
  const { state, run, deps } = harness([apiError("internal", 500)]);
  await assert.rejects(callWithRetry(run, deps));
  assert.equal(state.runs, 1);
});

for (const [code, status, pattern] of [
  ["permission_denied", 403, /login.*許可/s],
  ["budget_exhausted", 429, /2026-10-22T00:00:00\+09:00/],
  ["rate_limited", 429, /少し待/],
]) {
  test(`TEST-P11 ${code} はやり直さず、サーバーの文と案内を出す`, async () => {
    const err = apiError(code, status, code === "budget_exhausted" ? { retryAt: "2026-10-22T00:00:00+09:00" } : code === "rate_limited" ? { retryable: true } : {});
    const { state, run, deps } = harness([err]);
    await assert.rejects(callWithRetry(run, deps));
    assert.deepEqual([state.runs, state.refreshes, state.sleeps.length], [1, 0, 0]);
    const text = describeError(err);
    assert.match(text, new RegExp(`server says ${code}`));
    assert.match(text, pattern);
  });
}

test("TEST-P11 EdcApiError でない誤りは、その文だけを出す", () => {
  assert.equal(describeError(new Error("boom")), "Error: boom");
});
