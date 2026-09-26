import { credentialHeaders } from './settings.mjs';

export class HttpError extends Error {
  constructor(status, retryAfter = null) {
    const guidance = status === 429 ? 'リクエスト数が制限されています。' :
      status === 401 ? '認証が必要です。本人が別ターミナルで npm run auth:login を実行し、npm run sync で再開してください。' :
      status === 403 ? 'アクセスが拒否されました。本人が対象プロジェクトのアクセス権を確認してから npm run sync で再開してください。' :
      status === 404 ? '取得先が見つかりません。cosense.config.json の projectUrl と対象プロジェクトへのアクセスを確認してください。' :
      status >= 500 ? 'サーバー側でエラーが発生しました。時間を置いて npm run sync で再開してください。' :
      '取得が拒否されました。設定とAPIの対応状況を確認してください。';
    super(`HTTP ${status}。${guidance}`);
    this.status = status;
    this.retryAfter = retryAfter;
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
    } catch { throw new Error('通信に失敗しました。接続を確認して npm run sync で再開してください。'); }
    if (!response.ok) {
      const retryAfter = response.status === 429 ? response.headers.get('retry-after') : null;
      await response.body?.cancel();
      throw new HttpError(response.status, retryAfter);
    }
    try { return await response.json(); }
    catch { throw new Error('JSON応答が不正です。時間を置いて npm run sync で再開し、繰り返す場合はAPIの対応状況を確認してください。'); }
  };
}
