# Cosense Local Knowledge Template

Scrapbox（Cosense）の記事とローカル記憶を使い、自然な相談から探索・理解・判断を進めるテンプレートです。記事の正本はScrapbox、Agent記憶の正本はローカルのMarkdownです。

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

「何が書かれているか確かめたい」「要点を短くまとめて」「記録を横断して自分の傾向を考察して」「今後を予測して」「今の目的に合う案を提案して」など、欲しい成果を自然な言葉で伝えてください。複数を組み合わせても構いません。

| 依頼例 | 使うSkill |
| --- | --- |
| 「集中について書いた記事と関連記録を探して」 | [article-explore](.agents/skills/article-explore/SKILL.md)：記事と文脈を集めます。 |
| 「この記録から、自分が大切にしていることを考えたい」「このテーマの矛盾を掘り下げたい」 | [knowledge-deepen](.agents/skills/knowledge-deepen/SKILL.md)：意味・関係・説明の候補を検討します。 |
| 「これまでの学びと今の目的に照らして、この計画を見直して」 | [knowledge-review](.agents/skills/knowledge-review/SKILL.md)：目的や基準に照らして判断を評価します。 |

提示された文章だけでも相談できます。回答は求める成果に合わせ、記録内容とAgentの解釈・予測・提案を区別し、根拠を辿れるように示します。「まとめて」など、文脈を含めても欲しい成果が曖昧な場合は質問して確認します。

Agentは最初に `npm run session:start` で記憶入口・記事取得時点・同期状態を確認し、必要な記録を選びます。同期モードの既定値は `none` で、構造化記憶の本文は自動投入しません。

「同期して」「同期を再開して」で[同期Skill](.agents/skills/workspace-sync/SKILL.md)を使います。状態確認だけなら取得・復旧は行いません。

記事の作成・編集には公式 [Cosense Skill & CLI](https://github.com/helpfeel/cosense-cli) を使い、反映後に同期します。入口は `npm run cosense -- ...`、対象プロジェクトは `@project` です。ローカルの記事は直接編集しません。別プロジェクトや画像本体は自動取得しません。

Agentは決定・理由・未完了事項・次の操作を、確認日と根拠を添えて記憶へ保存します。読み取りだけ・記憶更新禁止の指示を優先し、秘密情報は保存しません。

## 経験から判断へつなぐ共通循環

現在の目的に必要な原文と理解を選び、経験から判断へつなぎます。原文の発言者・時期・文脈、本人の明言、Agentの推論を区別し、記事の保存を本人の賛同とはみなしません。条件が十分なら第一候補と理由を示します。

理解には根拠・適用条件・例外・競合する説明を残し、本人の訂正と現在の意向を優先します。不足は未発見・探索範囲不足・適用未確認・矛盾・結果待ちに分け、判断を変える材料を補います。訂正・時間変化・一時的例外を区別し、提案の再引用を独立証拠にしません。

再利用価値のある理解を保存し、未回答の問いや一時的な仮定を自動で長期記憶にしません。補完案、対話の回答、記事反映、実行結果は別に扱います。探索・深掘り・レビューは必要な責務だけを選び、毎回すべてを実行する固定手順にはしません。

## ローカルの操作

以下の操作はネットワークを使いません。未取得の記事や未同期の変更は表示されず、取得時点からScrapboxとの差分を推測することはできません。操作の詳細は探索Skillの [ツール資料](.agents/skills/article-explore/references/local-tools.md) にあります。

| コマンド | 用途 |
| --- | --- |
| `npm run search -- "検索語" [--limit N] [--offset N]` | タイトル・本文の部分一致、空白区切りAND検索です。 |
| `npm run read -- "タイトル" [--json]` | 原文・URL・取得時点を表示します。JSONでは行ID・版情報も返します。 |
| `npm run links -- "タイトル"` | リンク先・被リンク元を表示します。本文のないタイトルも対象です。 |
| `npm run memory` | 記憶の入口を表示します。 |
| `npm run status` | 件数・取得日時・差分確認日時・索引状態を表示します。 |

## 構造化した記憶の操作

記憶は `memory/index.md` を入口に、必要な記録だけ検索・参照します。新しい理解は `memory/records/<id>.md` に根拠・適用条件・本人確認の状態を添えて保存します。既存の自由形式Markdownは保持し、自動変換しません。

参照には `memory:search` / `memory:read` / `memory:evidence`、保存には `memory:create` / `memory:update --expect-revision` を使います。保存前に[現行スキーマと保存条件](.agents/skills/article-explore/references/memory.md)を確認してください。設定済みの `workspace` と記憶入口が必要で、競合は上書きしません。

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

コマンド入口は `src/cli/`、機能本体は `src/lib/`、公式CLI連携は `src/integrations/cosense/` です。`npm test` で実アカウントを使わずCLIの正確性を検証します。回答の有用性や提案後の効果は、本人の評価と実際の結果で確認します。Agentの規約は [AGENTS.md](AGENTS.md) を参照してください。

CLIは `@helpfeel/cosense-cli` 1.15.0、公式Skillは上流commit `c94c481d29ae7cc51db64bd42fadcd7292f6b7cd` に固定しています。インストール時のパッチで認証保存先を `.local/cosense/settings.json` に限定し、ホームの認証設定や親シェルのPATは使いません。更新時はパッチの互換性を確認してください。

`npm ci --ignore-scripts` を使った場合は `npm rebuild` が必要です。古いパッチが適用済みなら `npm ci` で入れ直してください。旧設定の `memoryTitle` と `@memory` は受け付けません。
