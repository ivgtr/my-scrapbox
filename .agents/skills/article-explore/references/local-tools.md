# ローカルの記事操作

設定済み環境ではセッション開始時の状態と取得時点を確認し、以下を使う。READMEやpackage.jsonの再読は不要。コマンドはリポジトリ内で実行する。未設定時はAGENTS.mdのセットアップ案内に従い、設定を推測しない。

## 検索

```sh
npm run search -- "検索語" --limit 20 --offset 0
```

検索語は1引数（空白を含む場合は引用符で囲む）。タイトル・本文を大文字小文字を区別せず部分一致で検索し、空白区切りの語はAND。短い日本語・引用符・記号も文字どおり検索する。検索演算子や意味検索はない。タイトル、IDの順で安定して並ぶ。

`--limit` は省略時20、1〜100。`--offset` は省略時0、非負の安全な整数。オプションは検索語の後に置き、順序は任意。未知・重複・値欠落・不正な引数は拒否する。

CLIが出力するJSON（npm自身の実行案内とは別）：

```json
{
  "items": [{"id": "page-id", "title": "集中", "url": "https://scrapbox.io/example/集中", "snippet": "集中に関する記録"}],
  "total": 1,
  "limit": 20,
  "offset": 0,
  "nextOffset": null
}
```

`total` は全該当件数。次ページは `nextOffset` を `--offset` に指定する。末尾は `null`。該当なしは `items: []`・`total: 0`、範囲外offsetも空のitems。ページ取得中に同期すると件数や順序が変わり得るため、同じ取得時点の結果として扱わない。

`snippet` は本文の最初の一致を中心に最大160 Unicodeコードポイント（省略記号を含む）を抜粋する。本文に一致がないときはタイトルを使い、切り落とした側に `…` を付ける。本文は保存された行を結合したもの（タイトル行を含む場合もある）。抜粋は候補選び専用で、意味の解釈には次のreadを使う。

## 本文とリンク

```sh
npm run read -- "タイトル"
npm run links -- "タイトル"
```

`read` は1つのタイトルを受け、URL、取得時点、更新日時、pageId、commitId、原文をテキストで表示する。タイトルは空白とアンダースコアを同一視する。本文がない場合はエラーとなる。

`links` は1つのタイトルを受け、JSONの `title`・`exists`・`outgoing`・`incoming` を返す。`outgoing` は `{ title, external }`（externalは0または1）、`incoming` は `{ title }`。本文のないタイトルの被リンクも調べられる。別プロジェクトのリンクは自動取得しない。

## 状態と記憶

`npm run status` はJSONの `projectUrl`・`syncedAt`（記事取得日時）・`checkedAt`（差分確認日時、不明ならnull）・`count`・`index` を表示する。`index` はready/missing/stale/corrupt。`npm run memory` はローカル記憶の入口を表示する。どちらも引数は不要。

これらの参照はネットワークを使わず、未取得や未同期の変更は検索できない。検索・リンク参照では必要に応じてローカル索引を再生成するが、記事は変更しない。古さや不足は報告し、同期・復旧・オンライン編集・記憶保存はAGENTS.mdと該当Skillの権限境界に従う。
