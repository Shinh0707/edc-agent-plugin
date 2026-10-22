// EDC アカウントのトークンの保存先と、プロセスをまたぐ錠(docs/edc-account/design.md 4 節)。
// 保存先: macOS のキーチェーン > Linux の Secret Service > Windows の DPAPI > 権限 600 のファイル。
// 値は子プロセスの標準入力で渡し、引数(ほかのプロセスから見える)に出さない。子プロセスはシェルを通さない。
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SERVICE = "edc-agent-plugin";
export const ACCOUNT = "edc-cli";
export const CONFIG_DIR = join(homedir(), ".config", "edc");

const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
const decode = (text) => {
  try {
    const value = JSON.parse(Buffer.from(text.trim(), "base64url").toString("utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
};

/** 子プロセスを動かし、終わりのコードと標準出力を返す。stderr は秘密が混ざらないよう、probe のときだけ読む */
export function defaultExec(cmd, args, { input, stderr = false, timeoutMs = 15000, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", stderr ? "pipe" : "ignore"], windowsHide: true, timeout: timeoutMs, ...(env ? { env } : {}) });
    const out = [];
    const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr?.on("data", (c) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch {}
}

/** 一時ファイルに 600 で書いてから名前を変える(途中で落ちても半端な中身を残さない) */
function writePrivate(file, text) {
  ensureDir(dirname(file));
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch {}
  renameSync(tmp, file);
}
const readOrNull = (file) => { try { return readFileSync(file, "utf8"); } catch { return null; } };
const unlinkQuiet = (file) => { try { unlinkSync(file); } catch (e) { if (e.code !== "ENOENT") throw e; } };

export function keychainStore({ exec = defaultExec, service = SERVICE } = {}) {
  return {
    kind: "keychain",
    async read() {
      const r = await exec("security", ["find-generic-password", "-s", service, "-a", ACCOUNT, "-w"]);
      return r.code === 0 ? decode(r.stdout) : null;
    },
    async write(value) {
      // security -i は標準入力から命令を読む。値は base64url なので、空白・引用符を含まない
      const r = await exec("security", ["-i"], { input: `add-generic-password -U -s ${service} -a ${ACCOUNT} -w ${encode(value)}\n` });
      if (r.code !== 0) throw new Error("キーチェーンに保存できませんでした");
    },
    async remove() {
      await exec("security", ["delete-generic-password", "-s", service, "-a", ACCOUNT]);
    },
  };
}

export function secretServiceStore({ exec = defaultExec, service = SERVICE } = {}) {
  const attrs = ["service", service, "account", ACCOUNT];
  return {
    kind: "secret-service",
    async read() {
      const r = await exec("secret-tool", ["lookup", ...attrs]);
      return r.code === 0 && r.stdout ? decode(r.stdout) : null;
    },
    async write(value) {
      const r = await exec("secret-tool", ["store", "--label=EDC Agent Plugin", ...attrs], { input: encode(value) });
      if (r.code !== 0) throw new Error("Secret Service に保存できませんでした");
    },
    async remove() {
      await exec("secret-tool", ["clear", ...attrs]);
    },
  };
}

export const PS_ARGS = ["-NoProfile", "-NonInteractive", "-Command"];
// 利用者に結びつく DPAPI(ProtectedData、CurrentUser)。値は標準入力から読む。
// - -Command のとき、PowerShell は渡された標準入力を自分で読んで $input に入れる([Console]::In は空になる)
// - ConvertTo-SecureString などのコマンドレットは使わない。PowerShell 7 から起動されると PSModulePath を引き継ぎ、
//   Windows PowerShell 5.1 がそのモジュールを読めないため。.NET の型を直に使う
const PS_STDIN = "$v=(@($input) -join '').Trim(); if (-not $v) { $v=[Console]::In.ReadToEnd().Trim() }; Add-Type -AssemblyName System.Security";
export const PS_PROTECT = `${PS_STDIN}; $e=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v), $null, 'CurrentUser'); [Console]::Out.Write([Convert]::ToBase64String($e))`;
export const PS_UNPROTECT = `${PS_STDIN}; $d=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v), $null, 'CurrentUser'); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($d))`;
const stripBom = (text) => text.replace(/^\uFEFF/, "").trim();
/** PowerShell 7 の PSModulePath を Windows PowerShell 5.1 に渡さない */
const psEnv = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.toLowerCase() === "psmodulepath") delete env[k];
  return env;
};

export function dpapiStore({ exec = defaultExec, file = join(CONFIG_DIR, "token.dpapi") } = {}) {
  return {
    kind: "dpapi",
    async read() {
      const blob = readOrNull(file);
      if (!blob) return null;
      const r = await exec("powershell.exe", [...PS_ARGS, PS_UNPROTECT], { input: blob, env: psEnv() });
      return r.code === 0 ? decode(stripBom(r.stdout)) : null;
    },
    async write(value) {
      const r = await exec("powershell.exe", [...PS_ARGS, PS_PROTECT], { input: encode(value), env: psEnv() });
      const blob = stripBom(r.stdout);
      // 中身は出さない(暗号文でも)。終わりのコードだけ
      if (r.code !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(blob)) throw new Error(`DPAPI で保存できませんでした(PowerShell の終わりのコード ${r.code})`);
      writePrivate(file, blob);
    },
    async remove() {
      unlinkQuiet(file);
    },
  };
}

export function fileStore({ file = join(CONFIG_DIR, "token.json") } = {}) {
  return {
    kind: "file",
    async read() {
      const text = readOrNull(file);
      if (text === null) return null;
      try {
        const value = JSON.parse(text);
        return value && typeof value === "object" ? value : null;
      } catch {
        return null;
      }
    },
    async write(value) {
      writePrivate(file, JSON.stringify(value));
    },
    async remove() {
      unlinkQuiet(file);
    },
  };
}

/** OS に合う保存先を選ぶ。Linux は secret-tool があり、D-Bus に届くときだけ Secret Service */
export async function openStore({ platform = process.platform, dir = CONFIG_DIR, exec = defaultExec, service = SERVICE } = {}) {
  if (platform === "darwin") return keychainStore({ exec, service });
  if (platform === "win32") return dpapiStore({ exec, file: join(dir, service === SERVICE ? "token.dpapi" : `${service}.dpapi`) });
  if (platform === "linux") {
    try {
      const probe = await exec("secret-tool", ["lookup", "service", service, "account", ACCOUNT], { stderr: true });
      // 見つからなければ 1 で何も出さない。D-Bus に届かなければ 1 で stderr に理由が出る
      if (probe.code === 0 || (probe.code === 1 && !probe.stderr?.trim())) return secretServiceStore({ exec, service });
    } catch {}
  }
  return fileStore({ file: join(dir, service === SERVICE ? "token.json" : `${service}.json`) });
}

/**
 * プロセスをまたぐ錠。ファイルを "wx"(なければ作る)で開けたら持っている。
 * staleMs より古い錠は、持ち主が落ちたとみなして消す。待つ時間は、持ち主の更新(最長 20 秒)より長くする
 */
export function createLock({ file = join(CONFIG_DIR, "token.lock"), staleMs = 30000, timeoutMs = 25000, intervalMs = 100 } = {}) {
  const tryAcquire = () => {
    try {
      closeSync(openSync(file, "wx", 0o600));
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - statSync(file).mtimeMs > staleMs) unlinkQuiet(file);
      } catch {}
      return false;
    }
  };
  return {
    async withLock(fn) {
      ensureDir(dirname(file));
      const deadline = Date.now() + timeoutMs;
      while (!tryAcquire()) {
        if (Date.now() > deadline) throw new Error(`トークンの錠を取れませんでした(${file})。ほかの EDC のプロセスが止まっていれば、このファイルを消してください`);
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      try {
        return await fn();
      } finally {
        unlinkQuiet(file);
      }
    },
  };
}
