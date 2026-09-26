# Cosense Local Knowledge Template

Scrapbox（Cosense）に蓄積した記事から、関連する記録を発見し、考えを深め、計画や判断を見直すためのテンプレートです。自然な依頼に応じてAgentが記事を探索し、原文を根拠に理解・評価を進めます。記事の正本はScrapbox、Agent記憶の正本はローカルのMarkdownです。

## はじめる

Node.js 24以上と質問ツールを使えるエージェントが必要です。fork・clone後、変更のない `main` でSkillを明示呼び出しします。プロジェクトURLは呼び出し後の質問に回答します。

Codex:

```text
$workspace-setup
```

Claude:

```text
/workspace-setup
```

[セットアップSkill](.agents/skills/workspace-setup/SKILL.md)が同期モードの選択、依存関係・`workspace`・設定・記憶の準備を行います。本人が別ターミナルでログインし、完了を回答すると初回同期・確認へ進みます。既存データは上書きせず、READMEの参照だけでは開始しません。

PATは本人のターミナルで入力し、チャットやコマンド引数に渡さないでください。Service Accountを使う場合はエージェントに伝えてください。

## 普段の使い方

操作名を覚えず、目的を伝えてください。依頼に合うSkillだけを使います。

| 依頼例 | 使うSkill |
| --- | --- |
| 「集中について書いた記事と関連記録を探して」 | [article-explore](.agents/skills/article-explore/SKILL.md)：記事と文脈を集めます。 |
| 「この記録から、自分が大切にしていることを考えたい」「このテーマの矛盾を掘り下げたい」 | [knowledge-deepen](.agents/skills/knowledge-deepen/SKILL.md)：意味・関係・説明の候補を検討します。 |
| 「これまでの学びと今の目的に照らして、この計画を見直して」 | [knowledge-review](.agents/skills/knowledge-review/SKILL.md)：目的や基準に照らして判断を評価します。 |

提示された文章で足りる場合は、そのまま深掘り・レビューできます。過去の記事が必要な場合だけ探索し、根拠の記述とAgentの仮説を分けて扱います。

Agentはセッションの最初に `npm run session:start` で記憶・同期結果・取得時点・Skillの入口を確認します。同期モードの既定値は `none` です。自然な依頼を受けても常に最新の記事を自動取得するわけではありません。

「同期して」「同期を再開して」と依頼すると、[同期Skill](.agents/skills/workspace-sync/SKILL.md)が状態に応じて取得・再開・復旧します。Codexの `$workspace-sync`、Claudeの `/workspace-sync` でも呼び出せます。「同期状態を確認して」だけならオフラインで表示します。

記事の作成・編集には公式 [Cosense Skill & CLI](https://github.com/helpfeel/cosense-cli) を使い、反映後に同期します。入口は `npm run cosense -- ...`、対象プロジェクトは `@project` です。ローカルの記事は直接編集しません。別プロジェクトや画像本体は自動取得しません。

Agentは決定・理由・未完了事項・次の操作を、確認日と根拠を添えて記憶へ保存します。読み取りだけ・記憶更新禁止の指示を優先し、秘密情報は保存しません。

## ローカルの操作

以下の操作はネットワークを使いません。未取得の記事や未同期の変更は表示されず、取得時点からScrapboxとの差分を推測することはできません。操作の詳細は探索Skillの [ツール資料](.agents/skills/article-explore/references/local-tools.md) にあります。

| コマンド | 用途 |
| --- | --- |
| `npm run search -- "検索語" [--limit N] [--offset N]` | タイトル・本文の部分一致、空白区切りAND検索です。 |
| `npm run read -- "タイトル"` | 原文・URL・取得時点を表示します。 |
| `npm run links -- "タイトル"` | リンク先・被リンク元を表示します。本文のないタイトルも対象です。 |
| `npm run memory` | 記憶の入口を表示します。 |
| `npm run status` | 件数・取得日時・差分確認日時・索引状態を表示します。 |

検索は配列ではなく `{ items, total, limit, offset, nextOffset }` のJSONを返します。`items` の各候補は `id`・`title`・`url`・`snippet` を持ちます。`limit` は既定20（1〜100）、`offset` は既定0（非負の安全な整数）です。末尾の `nextOffset` は `null` です。抜粋は最大160 Unicodeコードポイントで候補選びに使い、解釈には `read` で本文を確認します。ページ取得の途中で同期すると結果が変わり得ます。保存形式・設定・認証の移行は不要です。

## 同期の設定

`cosense.config.json` は `projectUrl`（必須）と `syncMode`（省略可能）を設定します。未知の項目や不正な値は拒否します。

| syncMode | セッション開始時の動作 |
| --- | --- |
| `none`（既定） | オフラインで状態を表示し、同期を案内します。 |
| `fetch` | 記事の差分を取得し、索引を更新します。 |
| `commit` | fetchに加え、記事アーカイブだけをcommitします。 |

同期は `workspace` で行い、認証とネットワーク接続が必要です。初回は全件、以降は追加・更新・タイトル変更・削除を反映します。手動の `npm run sync` はモードに関係なく取得・更新だけを行います。常駐処理・定期実行・自動pushはありません。

途中停止は `npm run sync` で再開でき、取得済み本文を再利用します。記事は全件確認後に更新します。送信間隔とHTTP 429の待機・再試行にはCLIが対応します。

## データの保存

| 保存先 | 内容 |
| --- | --- |
| `cosense.config.json` | プロジェクトと同期モードです。 |
| `archive/articles.json` | 参照用の記事アーカイブです。 |
| `memory/index.md` と詳細Markdown | Agent記憶です。 |
| `.local/` | 認証情報・索引・同期状態です。Git管理から除外します。 |

`commit` モードは同期成功後、前回取得分を含めHEADと異なるアーカイブだけをcommitします。他のステージ内容・Gitの本人設定・フックは保持します。設定・記憶のcommitは手動です。

**公開先へworkspaceをpushすると、記事・記憶・設定も公開されます。**

## テンプレートの更新

`main` はテンプレート専用です。独立clone・共有worktreeとも、`workspace` で更新します。

```sh
npm run workspace:update
```

登録済み `origin` の `main` を取得し、workspaceをrebaseします。fork元に追従する場合は `git config --local cosense.templateRemote upstream` で登録済みリモートを指定します。未登録なら停止し、ローカルmainは変更しません。Cosense設定・認証・記事は不要です。

作業中の変更は更新用stashで退避・復元し、Git管理外の `.local/` と既存stashは保持します。rebaseで個人コミットのIDは変わります。個人データをmainへマージしないでください。

競合時はCLIに表示するrebase続行・中止と、ID付きstash復元の案内に従ってください。stash復元の競合ではrebaseは完了済みです。復元確認・stash削除まで次の更新は停止し、同期・Git操作中も更新できません。

依存定義が変わった場合だけ `npm ci` を案内します。インストール・記事同期・pushは自動実行しません。

## 困ったとき

エラー通知に原因と次の操作を表示します。主な対処は次のとおりです。

| 状況 | 次の操作 |
| --- | --- |
| 通信失敗・サーバーエラー | 接続を確認するか時間を置き、`npm run sync` で再開します。 |
| HTTP 401・403 | 本人が認証・アクセス権を確認します。 |
| HTTP 429 | 表示された試行の目安以降に `npm run sync` で再開します。制限解除を保証する時刻ではありません。 |
| 記事・途中成果の破損 | `npm run sync -- --rebuild` で全件再取得します。送信待機時刻は保持します。 |
| 索引生成失敗 | `npm run index:rebuild` を実行します。 |
| 同期ロックが残った | 同期が実行中でないことを確認して `.local/sync.lock` を削除します。 |

その他のエラーはCLIの原因・次の操作を確認してください。索引生成やcommitが失敗しても、取得済み記事は保持します。

## 開発・保守

コマンド入口は `src/cli/`、機能本体は `src/lib/`、公式CLI連携は `src/integrations/cosense/` です。`npm test` で実アカウントを使わず検証できます。Agentの作業規約は [AGENTS.md](AGENTS.md) を参照してください。

CLIは `@helpfeel/cosense-cli` 1.15.0、公式Skillは上流commit `c94c481d29ae7cc51db64bd42fadcd7292f6b7cd` に固定しています。インストール時のパッチで認証保存先を `.local/cosense/settings.json` に限定し、ホームの認証設定や親シェルのPATは使いません。更新時はパッチの互換性を確認してください。

`npm ci --ignore-scripts` を使った場合は `npm rebuild` が必要です。古いパッチが適用済みなら `npm ci` で入れ直してください。旧設定の `memoryTitle` と `@memory` は受け付けません。
