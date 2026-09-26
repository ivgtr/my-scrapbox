# Cosense Agent Memory Template

Cosense（旧Scrapbox）を、Agentがセッションをまたいで参照・更新する記憶領域として使うテンプレートです。

公式の [Cosense Skill & CLI](https://github.com/helpfeel/cosense-cli) をリポジトリ内で利用します。個人設定と認証情報はfork先で登録し、Git管理から除外します。

## セットアップ

Node.js 24以上が必要です。fork・cloneしたディレクトリで実行してください。

```sh
npm ci
cp cosense.config.example.json cosense.config.json
```

`cosense.config.json` に、自分のプロジェクトURLと記憶ページのタイトルを設定します。

```json
{
  "projectUrl": "https://scrapbox.io/YOUR_PROJECT",
  "memoryTitle": "Agent Memory"
}
```

記憶ページには、既存の記事と混ざらない名前を指定してください。非公開の情報には非公開プロジェクトを使います。設定とログインは端末ごとに必要です。

別のターミナルでログインし、接続を確認します。

```sh
npm run auth:login
npm run auth:check
npm run pages -- --limit 1
```

CLIの案内に従ってPATを発行し、そのターミナルに貼り付けてください。トークンはチャットに送らないでください。

Service Accountを使う場合は `npm run cosense -- login @project` でログインし、`pages` で接続を確認します。`auth:check` はPAT専用です。

Codexはこのディレクトリで起動してください。

## 記憶の使い方

最初のセッションで、次のように依頼します。

```text
$cosense
設定したプロジェクトを私の記憶領域として使ってください。
記憶ページを初期化し、この作業では記憶を更新しながら進めてください。
合意した方針、決定の理由、未完了事項、次の操作を残してください。
```

Agentは公式Skillの編集手順で記憶ページを作成します。セットアップコマンドだけでは記事を変更しません。

新しいセッションでは、入口ページから今回の依頼に関係する記憶を参照します。手動でも確認できます。

```sh
npm run memory
```

記憶の更新を依頼した作業では、決定事項・根拠・未完了事項を保存します。読み取りだけの依頼では更新しません。

記憶の正本はCosenseです。入口には方針と進行中の作業をまとめ、詳細ページには確認日・情報源・次の操作を残します。元の記事とは分け、秘密情報は保存しません。全記事のローカル同期や常駐処理は行いません。

## 構成

| 場所 | 役割 | Git管理 |
| --- | --- | --- |
| `AGENTS.md` | 記憶を参照・更新する運用ルール | 対象 |
| `.agents/skills/cosense/` | 公式の取得・検索・編集手順 | 対象 |
| `cosense.config.example.json` | 個人設定の見本 | 対象 |
| `cosense.config.json` | 対象プロジェクトと記憶ページの設定 | 除外 |
| `.local/cosense/settings.json` | 認証情報 | 除外 |
| Cosense上の記憶ページ | セッションをまたぐ記憶 | 対象外 |

`@project` と `@memory` は、個人設定からURLに展開されます。この設定はAgentの運用範囲を指定するもので、PATのアクセス権は制限しません。

## 保守

CLIは `@helpfeel/cosense-cli` 1.15.0、Skillは上流commit `c94c481d29ae7cc51db64bd42fadcd7292f6b7cd` に固定しています。

認証情報をリポジトリ内に保存するため、インストール時に公式CLIへ保存先パッチを適用します。操作には常に `npm run cosense -- ...` を使ってください。親シェルのPATは使用しません。

`npm ci --ignore-scripts` を使った場合は、`npm rebuild` でパッチを適用してください。更新時はCLI・Skill・パッチの互換性を確認します。

テストは `npm test` で実行します。認証情報や実際の記事への書き込みは不要です。
