import { EdcApiError } from "@entertainment-design-catalog/design-tags";

/**
 * ツールの呼び出しのやり直しと、エラーの文(docs/edc-account/design.md 7 節)。
 * - 401: トークンを取り直して一度だけ
 * - 500 internal(retryable。EDC Web API が EDC アカウントの鍵を取れない): 2 秒待って一度だけ
 * - 403・429 などはやり直さない
 */
export type RetryDeps = {
  /** 今のトークンが受け付けられなかったので、取り直す(getAccessToken({ force: true })) */
  refresh: () => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
};

const LOGIN_HINT = "node mcp/launcher.mjs login";
const INTERNAL_RETRY_DELAY_MS = 2000;

/** 資格情報を取れなかった(ログインしていない・切れた)。EdcClient は理由を cause に入れる */
const credentialFailure = (error: EdcApiError): Error | undefined => {
  const cause = (error as { cause?: unknown }).cause;
  return cause instanceof Error && cause.name === "AuthError" ? cause : undefined;
};

export async function callWithRetry<T>(run: () => Promise<T>, deps: RetryDeps): Promise<T> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof EdcApiError)) throw error;
    if (error.status === 401) {
      await deps.refresh();
      return run();
    }
    if (error.code === "internal" && error.retryable) {
      await sleep(INTERNAL_RETRY_DELAY_MS);
      return run();
    }
    throw error;
  }
}

/** 利用者に見せる文。サーバーの文はそのまま出す(秘密を含まない)。トークンは入れない */
export function describeError(error: unknown): string {
  if (error instanceof EdcApiError) {
    const cause = credentialFailure(error);
    if (cause) return `[EDC] ${cause.message}`;
    const head = `[EDC API Error] Code: ${error.code} (Status: ${error.status ?? "N/A"})\nMessage: ${error.message}`;
    switch (error.code) {
      case "unauthenticated":
        return `${head}\nEDC アカウントのトークンが受け付けられませんでした。${LOGIN_HINT} をやり直してください。`;
      case "permission_denied":
        return `${head}\nこの操作の許可が足りません。${LOGIN_HINT} をやり直し、許可の画面で許可してください。`;
      case "budget_exhausted":
        return `${head}\n1 日の利用枠を使い切りました。${error.retryAt ? `${error.retryAt} 以降に` : "時間をおいて"}試してください(自動ではやり直しません)。`;
      case "rate_limited":
        return `${head}\n呼び出しが多すぎます。少し待てば使えます。`;
      case "internal":
        return `${head}${error.retryable ? "\n一度やり直しましたが失敗しました。時間をおいて試してください。" : ""}`;
      default:
        return `${head}${error.retryAt ? `\nRetry available at: ${error.retryAt}` : ""}${error.retryable ? "\nThis error is retryable." : ""}`;
    }
  }
  if (error instanceof Error && error.name === "AuthError") return `[EDC] ${error.message}`;
  return error instanceof Error ? `Error: ${error.message}` : `Error: ${String(error)}`;
}
