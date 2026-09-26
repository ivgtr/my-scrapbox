# 構造化した記憶の操作

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

