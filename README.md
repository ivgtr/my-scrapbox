# Cosense Local Knowledge Template

Scrapbox（Cosense）に蓄積した記事から、関連する記録を発見し、考えを深め、計画や判断を見直すためのテンプレートです。自然な依頼に応じてAgentが記事を探索し、原文を根拠に理解・評価を進めます。記事の正本はScrapbox、Agent記憶の正本はローカルのMarkdownです。経験・理解・意向を現在の目的へつなぎ、回答・発想・計画・自己理解・レビューを支えます。固定した人物像や用途は組み込みません。

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

## 経験から判断へつなぐ共通循環

以下は依頼に応じて担う責務です。毎回すべてを実行する手順ではありません。個人固有の目的・判断基準・理解・評価例は、記事と対話から形成します。

| 責務 | 扱う内容 |
| --- | --- |
| 取り込み | 原文、発言者、対象時期、文脈を識別します。記事の保存や引用を、本人の賛同や客観的な正しさと混同しません。 |
| 理解の形成 | 経験と既存知識を関係付け、説明・学び・意向・判断基準を形成します。根拠、適用条件、例外、競合する説明を残します。 |
| 現在への利用 | 現在の目的に必要な理解と原文を選びます。一般知識と個人の優先事項を区別し、条件が十分なら第一候補と理由を提案します。 |
| 不足の認識 | 未発見、探索範囲不足、適用未確認、矛盾、結果待ちを区別します。結論が変わる材料を優先して補い、判断できる部分は進めます。 |
| 更新 | 訂正、時間による変化、一時的な例外を区別します。生成した提案やその再引用は新しい独立した証拠にしません。 |

取得時は原文と検索情報を整備し、理解は相談時に形成します。再利用価値のある理解・根拠付き仮説を保存し、本人の明言と区別して育てます。未回答の問い、一時的な仮定、大量の検討候補を自動で長期記憶にしません。必要な未解決事項は保存目的と範囲を明示します。

探索・深掘り・レビューの専門的な責務は各Skillが担います。発想・計画では必要なSkillを組み合わせます。補完方法には追加探索、本人への質問、結果の観察、Scrapboxへの記載提案があります。補完案・対話で得た回答・記事への反映・実行結果を区別し、記事反映は明示された権限と既存Cosense手順に従います。

## ローカルの操作

以下の操作はネットワークを使いません。未取得の記事や未同期の変更は表示されず、取得時点からScrapboxとの差分を推測することはできません。操作の詳細は探索Skillの [ツール資料](.agents/skills/article-explore/references/local-tools.md) にあります。

| コマンド | 用途 |
| --- | --- |
| `npm run search -- "検索語" [--limit N] [--offset N]` | タイトル・本文の部分一致、空白区切りAND検索です。 |
| `npm run read -- "タイトル" [--json]` | 原文・URL・取得時点を表示します。JSONでは行ID・版情報も返します。 |
| `npm run links -- "タイトル"` | リンク先・被リンク元を表示します。本文のないタイトルも対象です。 |
| `npm run memory` | 記憶の入口を表示します。 |
| `npm run status` | 件数・取得日時・差分確認日時・索引状態を表示します。 |

検索は配列ではなく `{ items, total, limit, offset, nextOffset }` のJSONを返します。`items` の各候補は `id`・`title`・`url`・`snippet` を持ちます。`limit` は既定20（1〜100）、`offset` は既定0（非負の安全な整数）です。末尾の `nextOffset` は `null` です。抜粋は最大160 Unicodeコードポイントで候補選びに使い、解釈には `read` で本文を確認します。ページ取得の途中で同期すると結果が変わり得ます。保存形式・設定・認証の移行は不要です。

## 構造化した記憶の操作

自由形式の `memory/index.md` と詳細Markdownは保持します。新形式へ暗黙に変換しません。原文を確認して記録し直す場合のみ、`memory/records/<id>.md` に一記録一ファイルを保存します。先頭のJSONコードブロックはメタデータ、その後のMarkdownは本文です。`records/` 内は現行形式専用です。

| コマンド | 動作 |
| --- | --- |
| `npm run memory:search -- "検索語" [--limit N] [--offset N] [--all]` | 本文・タイトル・適用条件・例外のAND部分一致。既定は現行記録、allで置換済み・撤回も含めます。 |
| `npm run memory:read -- <id>` | 本文・メタデータ・根拠の確認状態をJSONで返します。 |
| `npm run memory:evidence -- <id>` | 記憶参照をたどり、記事の該当行と対話の抜粋をJSONで返します。 |
| `npm run memory:create -- --file <JSONファイル>` | 入力を検証して新規保存します。 |
| `npm run memory:update -- <id> --file <JSONファイル> --expect-revision <N>` | 全入力を指定して更新します。競合時は上書きしません。 |
| `npm run memory:index` | 入口の管理対象リンク部分を再生成します。 |

読み取りは通信しません。検索は記事検索と同じ `{ items, total, limit, offset, nextOffset }`、limit既定20（1〜100）、offset既定0です。タイトル・ID順で、重要度や意味検索はありません。記憶のsnippetは本文先頭の最大160 Unicodeコードポイントで、適用判断にはreadを使います。既存の `npm run memory` は入口表示のままです。

入力は `{ "metadata": { ... }, "body": "Markdown本文" }` のJSONです。metadataの全入力項目を指定し、CLI付与項目は渡しません。未知項目、不正型、不明な参照先、記憶参照・replacesの循環は拒否します。

| metadata項目 | 現行形式 |
| --- | --- |
| `schemaVersion`, `id`, `revision` | CLIが1、UUID、正の整数を付与します。IDは安定し、revisionは更新ごとに増えます。 |
| `kind` | `experience` / `understanding` / `intention` / `unresolved` / `decision` / `result` |
| `title` | 空でない1行の検索名 |
| `basis` | `user-statement`（本人明言）/ `observation`（記録観察）/ `inference`（Agent推論） |
| `confirmation` | `unconfirmed` / `confirmed` / `rejected`。意向や解釈の本人確認で、外部事実の保証ではありません。 |
| `scope` | `{ "conditions": "適用条件", "exceptions": "例外" }`。不明も文字で明示します。 |
| `targetTime` | 対象時期の文字列。不明は `null`。記憶の作成日時とは別です。 |
| `sources` | 以下の根拠オブジェクトの配列。根拠なしは `[]`、仮説の根拠を創作しません。 |
| `state` | `current` / `replaced` / `withdrawn` |
| `replaces` | 訂正前の記録IDの配列。置換先の作成と旧記録の状態更新は別操作です。 |
| `changeReason` | 新規形成・訂正・時期変化・例外・撤回等の理由 |
| `createdAt`, `updatedAt` | CLIがUTCのISO日時を付与します。 |

根拠の形式（省略・未知項目は不可）：

- 記事: `{ "type": "article", "projectUrl": "設定済みURL", "pageId": "...", "commitId": "...", "lineIds": ["..."] }`。行IDは `read --json` で確認します。
- 対話: `{ "type": "dialogue", "confirmedAt": "2026-09-26T00:00:00.000Z", "speaker": "user", "excerpt": "発言の抜粋", "context": "相談の文脈" }`。確認日時不明は `null`。日時はUTC・ミリ秒付きのISO形式で、別の日付で補いません。
- 記憶: `{ "type": "memory", "id": "...", "revision": 1 }`。参照時のrevisionを指定します。

例えば根拠付きの理解は、kindをunderstanding、basisをinference、confirmationをunconfirmedとして、本文に説明と競合する説明、scopeに適用条件と例外を記録します。本人の明言を引用したことだけでAgentの解釈をconfirmedへ変更しません。

保存には設定済みのworkspaceと既存の記憶入口が必要です。未設定環境を初期化しません。書き込みは `memory/.write.lock` で排他制御し、一時ファイルから置換します。入口の `<!-- memory:records:start -->` と `<!-- memory:records:end -->` 間だけを管理し、自由記述を保持します。マーカーがなければ末尾へ追加します。記録保存後の入口失敗は `recordSaved: true, indexUpdated: false` と非ゼロ終了で知らせます。原因を直し `memory:index` で復旧してください。残存ロックは実行中でないことを確認して削除します。

新しく指定する根拠はローカルの現行記事版・記憶revision・状態と一致する必要があります。更新時に変更せず明示した既存根拠は保持でき、古くなった根拠付き記録も訂正・撤回できます。記事の更新・削除、行の欠落、アーカイブ未取得、記憶revisionや状態の変化は `needsRecheck` と個別statusで通知し、推移的に伝えます。証拠なしはsourcesが空、対話日時不明はunknown-timeとして区別します。再確認不要という表示は理解の正しさや十分な根拠の保証ではありません。

過去の版本文は保存しません。evidenceの `current` は取得済みの現行原文・版で、参照時の原文を復元したものではありません。意味の変更、訂正の伝播、関連記憶の更新はAgentが判断し、CLIは自動変更しません。対話由来の唯一の記録と、記事から再形成できる理解を区別します。公開情報から形成した個人向け理解も公開前提にはしません。

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

コマンド入口は `src/cli/`、機能本体は `src/lib/`、公式CLI連携は `src/integrations/cosense/` です。`npm test` で実アカウントを使わず検証できます。CLIの正確性とAgentの挙動は分けて検証します。[挙動評価](evaluation/README.md)に比較条件・評価例・実施状態を記録します。本人による有用性評価と提案後の結果を機械テストで代替しません。Agentの作業規約は [AGENTS.md](AGENTS.md) を参照してください。

CLIは `@helpfeel/cosense-cli` 1.15.0、公式Skillは上流commit `c94c481d29ae7cc51db64bd42fadcd7292f6b7cd` に固定しています。インストール時のパッチで認証保存先を `.local/cosense/settings.json` に限定し、ホームの認証設定や親シェルのPATは使いません。更新時はパッチの互換性を確認してください。

`npm ci --ignore-scripts` を使った場合は `npm rebuild` が必要です。古いパッチが適用済みなら `npm ci` で入れ直してください。旧設定の `memoryTitle` と `@memory` は受け付けません。
