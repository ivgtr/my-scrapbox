# Cosense Local Knowledge Template

Scrapbox（Cosense）を記事の正本とし、参照用の記事アーカイブとAgent記憶をローカルに保存するテンプレートです。同期後の検索・参照・記憶更新には、認証情報もネットワーク接続も不要です。

## はじめる

Node.js 24以上が必要です。fork・clone後、変更のない `main` から実行します。

```sh
npm ci
npm run workspace:init -- https://scrapbox.io/YOUR_ACTUAL_PROJECT
```

個人用の `workspace` ブランチ、対象プロジェクトの設定、空の記憶の入口を作成します。既存ブランチやファイルは上書きしません。

本人が別ターミナルでログインし、初回同期を行います。

```sh
npm run auth:login
npm run auth:check
npm run sync
```

PATはCLIの案内に従ってターミナルへ入力してください。チャットやコマンド引数には入力しません。Service Accountを使う場合は `npm run cosense -- login @project` でログインします。`auth:check` はPAT専用です。

## 普段の流れ

セッションの最初に、Agentは `session:start` で記憶と同期状態を確認します。`cosense.config.json` の `syncMode` に応じ、この入口だけで同期・記事のcommitを実行します。

```sh
npm run session:start
```

設定項目は `projectUrl`（必須）と `syncMode`（省略可能）のみです。`syncMode` は未指定なら `none` です。不正な値・未知の項目は実行前に拒否します。

| 値 | セッション開始時の動作 |
| --- | --- |
| `none` | オフラインで記憶・同期状態を表示し、同期を案内する |
| `fetch` | 差分を確認して記事・索引を更新する |
| `commit` | fetchに加えて `archive/articles.json` だけをcommitする |

例: `cosense.config.json` に `"syncMode": "fetch"` を設定します。`session:start` は記憶の入口、各段階の結果、記事の取得日時（`syncedAt`）と最後の差分確認日時（`checkedAt`）を表示します。検索・参照はどのモードでもオフラインです。常駐処理・定期実行・自動pushはありません。

手動の `npm run sync` は設定に関係なく取得・更新だけを行います。`npm run memory` と `npm run status` も個別に実行できます。

`status` はローカルの件数・同期日時・索引状態を表示します。Scrapboxとの差分確認と反映は `sync` が行います。初回は全件を取得し、以降は追加・更新・タイトル変更・削除を反映します。差分の確認にはネットワーク接続と認証が必要です。

同期状態ファイルがない場合の `checkedAt` は `null`（不明）です。不正な状態はエラーとして報告し、記事の取得日時を差分確認日時の代わりには使いません。

同期済みの記事はローカルで検索・参照できます。同期していない変更は表示されません。

| コマンド | 用途 |
| --- | --- |
| `npm run search -- "検索語"` | タイトル・本文の部分一致検索。空白区切りはAND検索 |
| `npm run read -- "ページタイトル"` | 原文・参照URL・取得時点を表示 |
| `npm run links -- "ページタイトル"` | リンク先・被リンク元を表示。本文のないタイトルも対象 |
| `npm run memory` | Agent記憶の入口を表示 |

記事の作成・編集は公式 [Cosense Skill & CLI](https://github.com/helpfeel/cosense-cli) でScrapboxへ反映し、その後に同期します。操作は `npm run cosense -- ...` を使い、`@project` は設定したプロジェクトURLへ展開されます。ローカルの記事は直接編集しません。別プロジェクトや画像本体は自動取得しません。

Agentは作業完了時に、合意した方針・決定と理由・未完了事項・次の操作をローカル記憶へ保存します。長い記録は別のMarkdownへ分け、入口からリンクします。確認日と根拠URLを付け、事実・推測・利用者の意向を区別してください。「読み取りだけ」「記憶を更新しない」という指示を優先し、秘密情報は保存しません。

## 保存とテンプレート更新

| 保存先 | 内容 | workspaceでのGit管理 |
| --- | --- | --- |
| `cosense.config.json` | 対象の `projectUrl` と `syncMode` | 対象 |
| `archive/articles.json` | Scrapboxから取得した記事 | 対象 |
| `memory/index.md` と詳細Markdown | Agent記憶の正本 | 対象 |
| `.local/` | 認証情報・索引・同期状態・ログ | 除外 |

`commit` モード選択時だけ、同期成功後の記事アーカイブを自動commitします。Scrapbox側に変更がなくても、前回取得分が未コミットなら保存します。HEADと一致していればcommitしません。workspaceブランチをcommit直前にも確認し、アーカイブをステージして `git commit --only` で対象を限定します。他のステージ内容は保持します。Gitの本人設定やフックは変更・迂回しません。pushは自動実行しません。

設定・記憶などは内容を確認して手動で保存します。

```sh
git add cosense.config.json archive/articles.json memory
git commit -m "Save local knowledge and memory"
```

**公開先へworkspaceをpushすると、記事・記憶・設定も公開されます。** 個人データに適した保存先を選んでください。

`main` はテンプレート専用です。更新は `workspace` 上で `git merge main` などにより取り込みます。個人データを含むworkspaceをmainへマージしません。

## 困ったとき

- アーカイブがない場合は、ログイン後に `npm run sync` を実行します。同期はworkspaceでのみ実行できます。
- 通信・認証エラーでは既存の記事を保持し、取得時点を表示して参照を続けられます。初回取得前なら同期を案内します。記事の編集が成功して同期だけ失敗した場合は、同期だけを再実行します。
- アーカイブが破損した場合は `npm run sync -- --rebuild` で全件を再取得します。記事ファイルは読み取り専用とし、内容ハッシュで変更を検出します。Gitのcheckout後は、次の同期成功時に読み取り専用へ戻します。
- 索引生成やcommitだけの失敗は、記事取得の成功と区別して表示します。記事は巻き戻さず、commit失敗時はGit状態も表示します。失敗時の `session:start` は終了コード1を返します。
- 索引は検索時に必要に応じて再生成します。手動で作り直す場合は `npm run index:rebuild` を使います。
- 異常終了で同期ロックが残った場合は、同期が実行中でないことを確認して `.local/sync.lock` を削除します。

## 開発・保守

`src/cli/` はコマンド入口、`src/lib/` は機能本体、`src/integrations/cosense/` は公式CLI連携、`src/test/` は検証です。`npm test` で、実アカウントを使わず同期・障害時の保持・オフライン参照・Git運用を確認できます。

CLIは `@helpfeel/cosense-cli` 1.15.0、公式Skillは上流commit `c94c481d29ae7cc51db64bd42fadcd7292f6b7cd` に固定しています。認証情報を `.local/cosense/settings.json` に保存するため、インストール時に保存先パッチを適用します。保存先指定は必須で、ホームの認証設定へのフォールバックはありません。親シェルのPATは使用しません。`npm ci --ignore-scripts` を使った場合は `npm rebuild` が必要です。古いパッチが適用済みの場合は `npm ci` で入れ直してください。CLI・Skill更新時はパッチの互換性を確認し、上流が保存先指定に対応したら廃止します。

`memoryTitle` を含む設定と `@memory` はエラーになります。記憶の入口は `npm run memory` で読みます。
