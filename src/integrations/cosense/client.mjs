import { credentialHeaders } from './settings.mjs';

export class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}。${[401, 403].includes(status) ? '本人が認証・アクセス権を確認してください。' : '対象プロジェクトを確認して同期を再実行してください。'}`);
    this.status = status;
  }
}

export function authenticatedGet(root, projectUrl, fetchImpl = fetch) {
  const headers = credentialHeaders(root, projectUrl);
  const configured = new URL(projectUrl);
  return async url => {
    const parsed = new URL(url);
    if (parsed.origin !== configured.origin || parsed.username || parsed.password ||
      !(parsed.pathname.startsWith(`/api/pages${configured.pathname}/`) ||
        parsed.pathname.startsWith(`/api/pages/v2${configured.pathname}/`))) {
      throw new Error('対象外の取得先です。');
    }
    let response;
    try {
      response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
    } catch { throw new Error('取得に失敗しました。既存アーカイブを維持します。'); }
    if (!response.ok) throw new HttpError(response.status);
    try { return await response.json(); } catch { throw new Error('JSON応答が不正です。'); }
  };
}
