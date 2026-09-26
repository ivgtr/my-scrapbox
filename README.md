# Cosense Local Knowledge Template

Scrapbox（Cosense）を記事の正本とし、ローカルの記事アーカイブとAgent記憶をGitで保存するテンプレートです。同期後の検索・参照・記憶更新には、認証情報もネットワーク接続も不要です。

## セットアップ

Node.js 24以上が必要です。fork・clone後、変更のない `main` から実行します。

```sh
npm ci
npm run workspace:init -- https://scrapbox.io/YOUR_ACTUAL_PROJECT
```

`workspace` ブランチ、`cosense.config.json`、空の記憶の入口 `memory/index.md` を作成します。既存ブランチ・個人ファイルは上書きしません。個人設定は `projectUrl` のみが必須です。以前の `memoryTitle` は残っていても使用しません。`@memory` は廃止しました。

本人が別ターミナルでログインしてください。Agentはログインを実行しません。

```sh
npm run auth:login
npm run auth:check
npm run sync
```

CLIの案内に従ってPATをターミナルに貼り付けます。トークンをチャットやコマンド引数に入力しないでください。Service Accountの場合は `npm run cosense -- login @project` を使います。`auth:check` はPAT専用です。認証情報は端末ごとに設定します。

## ローカルでの利用

```sh
npm run search -- "日本語 検索語"
npm run read -- "ページタイトル"
npm run links -- "ページタイトル"
npm run status
npm run memory
npm run index:rebuild
```

検索対象はタイトルと原文です。空白で区切った複数語はANDの部分一致で検索します。SQLやFTSの演算子として解釈しません。Node.js組み込みSQLiteの [FTS5 trigram](https://www.sqlite.org/fts5.html#the_trigram_tokenizer) を使い、1～2文字は文字列検索で補います。英字の大小は区別しません。リンク先に本文がなくてもタイトルと被リンクを探索できます。別プロジェクトへのリンクは参照情報として表示し、取得しません。

`read` は原文・参照URL・取得時点・更新日時・pageId・commitIdを表示します。画像本体は保存しません。索引が欠損・破損・古い場合、検索とリンク探索時にアーカイブから再生成します。`status` は索引の状態を変更せず表示します。

## 同期と復旧

```sh
npm run sync
npm run sync -- --rebuild
```

同期は `workspace` のみで実行できます。GET専用で全件の一覧を取得し、ページID・タイトル・変換前の更新日時で差分を判定します。初回と `--rebuild` は全本文を取得します。以降は追加・更新・タイトル変更のある本文だけを取得します。

取得前後の全件一覧と取得本文を検証し、一覧が変わった場合は最大3回やり直します。安定した取得が完了するまで既存アーカイブを置き換えず、削除も反映しません。完全な同時点スナップショットは保証しません。通信・認証・不正応答の失敗時は既存アーカイブを維持します。変更のない同期は記事ファイルを書き換えません。成功した確認時刻は `.local/sync.json` に保存します。

`archive/articles.json` はページID順に保存し、読み取り専用にします。Agentや利用者は直接編集せず、同期で更新してください。内容ハッシュが一致しない場合は停止します。破損やプロジェクト変更後は `--rebuild` で全件を再取得してください。Gitは書き込み権限を保存しないため、checkout後の読み取り専用設定は次の同期成功時に戻します。これはOS所有者の変更を完全に防ぐ仕組みではありません。異常終了で同期ロックが残った場合、実行中の同期がないことを確認して `.local/sync.lock` を削除します。

記事の作成・編集は、変更してよい範囲を明示して公式 [Cosense Skill & CLI](https://github.com/helpfeel/cosense-cli) に依頼します。公式Skillの編集手順でプレビュー・競合確認を行い、リモートへ反映後、対象プロジェクトを同期します。編集成功後に同期だけ失敗した場合は、編集を重ねず同期を再実行します。ローカルの記事から書き戻す機能はありません。

`npm run cosense -- ...`、`@project` と明示URLによるオンライン操作は維持します。ページ一覧は `npm run pages` です。設定は運用範囲でありPATのアクセス権を制限しません。公式Skillはオンライン操作用で、通常のローカル参照には適用しません。

## Agent記憶とGit運用

セッション開始時は `npm run memory` でローカルの入口を読み、依頼に関係する詳細だけ参照します。同期は自動実行しません。作業完了時は合意した方針、決定と理由、未完了事項、次の操作を記憶へ保存します。「読み取りだけ」「記憶を更新しない」という指示を優先します。長い記録は個別のMarkdownへ分けて入口からリンクし、確認日と根拠URLを付けます。記事の事実・Agentの推測・利用者の意向を区別し、秘密情報は保存しません。

| 場所 | 役割 | workspaceでのGit管理 |
| --- | --- | --- |
| `cosense.config.json` | 対象プロジェクト | 対象 |
| `archive/articles.json` | 参照用の記事原文・行ID・リンク情報 | 対象 |
| `memory/index.md` と詳細Markdown | Agent記憶の正本 | 対象 |
| `.local/cosense/settings.json` | 認証情報 | 除外 |
| `.local/search.sqlite` | 再生成可能な索引 | 除外 |
| `.local/` の同期状態・ロック・実行ログ | ローカルの実行情報 | 除外 |

自動commit・pushはしません。内容と保存先を確認して、通常のGit操作で保存します。

```sh
git add cosense.config.json archive/articles.json memory
git commit -m "Save local knowledge and memory"
```

**公開リポジトリへworkspaceをpushすると、記事・記憶・設定も公開されます。** 個人データに適した非公開の保存先を選んでください。

`main` はテンプレート専用です。テンプレート更新は `workspace` 上で `git merge main` などにより取り込みます。個人データを含む `workspace` を `main` へマージしません。初期化後の個人ファイルはworkspaceでのみ追加し、テンプレート更新側には追加しないでください。

## 保守・検証

実装は責務ごとに分けています。

| 場所 | 責務 |
| --- | --- |
| `src/cli/` | npmコマンドの入口、引数検証、表示 |
| `src/lib/` | 設定・記事保存・同期・検索・workspace初期化 |
| `src/integrations/cosense/` | 公式CLI連携、認証設定の形式、GET通信、固定版への保存先パッチ |
| `src/paths.mjs` | 呼出元の作業ディレクトリに依存しない保存先の基準 |
| `src/test/` | 単体テストと取得モック・一時リポジトリによる統合テスト |

CLIの入口は本体の処理を呼び出します。同期の再試行は一覧・本文の変更と、一覧にあったページの取得時の404に限ります。不正応答・認証失敗・一覧取得の404はそのまま停止し、別の認証・取得経路へ切り替えません。索引の再生成と全件再取得は、再生成可能な索引と破損したアーカイブそれぞれの復旧経路です。

CLIは `@helpfeel/cosense-cli` 1.15.0、公式Skillは上流commit `c94c481d29ae7cc51db64bd42fadcd7292f6b7cd` に固定しています。固定版CLIには認証設定の保存先指定がないため、インストール時に保存先パッチを適用します。これは上流依存の互換処理です。バージョンと全対象のソースを確認してから適用し、不一致なら停止します。更新時には再評価し、上流が保存先指定を提供した場合はパッチを廃止します。常に `npm run cosense -- ...` を使用し、親シェルのPATは使用しません。同期も同じローカル設定を使い、継承したPATや設定パスは使用しません。

`npm ci --ignore-scripts` を使った場合は `npm rebuild` でパッチを適用してください。CLI・Skill更新時は互換性とパッチを確認します。

`npm test` は実アカウントを使用しない取得モックと一時Gitリポジトリで、同期・障害時の保持・検索・初期化・テンプレート更新を検証します。ベクトル検索、自動分類、画像本体の保存、定期実行は含めません。
