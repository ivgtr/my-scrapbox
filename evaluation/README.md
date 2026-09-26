# Agentの挙動評価

CLIの正確性とAgentの挙動を分けて検証します。入力、回答原本、実行証跡、親の判定は別ファイルに保存します。返却要約を回答原本として採用せず、取得できない情報を推測で補いません。本人の有用性評価と提案後の結果は未収集なら未収集のままにします。

## 固定入力の準備

```sh
node evaluation/prepare.mjs evaluation/cases.json /tmp/evaluation-bundle 2026-09-26T12:00:00.000Z
```

出力先は新規ディレクトリに限ります。ネットワーク・モデル呼び出しは行いません。

- `runs.json`: none、raw、raw-and-understandingの条件別入力情報。原文・理解には条件内で安定した根拠IDを付けます。
- `snapshot.json`: 入力全文、原文・理解、共通規約、利用可能時点、対象HEADと内容ハッシュ。
- `rubric.json`: must・avoid。親だけが参照し、子へ送信しません。

比較条件は同じモデル・設定・依頼・利用可能時点です。共通規約は入力全文に含めます。noneは個人原文なし、rawは同じ原文だけ、raw-and-understandingは原文と理解です。ツールは利用できますが、根拠情報は一条件の合成入力に限ります。記憶保存・孫Agentは禁止です。入力情報量の差もあるため、理解の有効性と検索品質の因果をこの比較だけで断定しません。「理解あり」が勝つことは合格条件にしません。

## 実行環境の成立確認と試行記録

`trials.mjs`は親が利用する小さな記録APIです。入力・送信証跡・原本・イベントの保存と契約検査を担当します。モデル指定、モデル呼び出し、ランタイムイベントの取得、参照範囲の指定と比較の成立判断は実施側の責務です。モデル別ランナーや評価用Skillはありません。

親は次の6項目について確認できた値・根拠と未確認事項を記録します。各項目はランタイムの仕様・実効設定・可視イベントを根拠にし、子の自己申告を使いません。固定比較では全項目verifiedを記録APIの起動条件にはしません。今回の固定比較は、入力ファイルへの参照を通常のサブAgentへ委任します。他条件・親の判定・個人データを参照しない指示を渡しますが、ファイル環境の共有を許容し、アクセス不能の保証は実施しません。この限界と未加工原本の取得経路を記録します。モデル・設定の指定は実施段階で決め、未確認の実効値は補いません。同一条件を確認できない比較は、その限界を明示します。

| checks項目 | 必要な成立根拠 |
| --- | --- |
| conversation | 親・他条件・過去段階の会話を継承しないこと |
| automaticContext | 自動投入する指示・記憶・環境情報の範囲と比較への影響 |
| tools | 利用可能なツールと権限。ツール禁止を前提にしない。実際の利用はイベントで別確認する |
| referenceScope | 指定した参照範囲と強制の有無。今回の固定比較は指示による委任であり、共有ファイルへのアクセス不能は未確認 |
| modelSettings | 実効モデルと設定。同一比較内で一致すること |
| rawOutput | 未加工の最終出力を取得できる経路。返却時の要約・切り詰めがないこと |

指示、別ディレクトリ、アクセスログだけでは隔離を保証できません。今回の固定比較に隔離保証は要求せず、参照範囲の指示と保証を区別します。根拠がない項目はverifiedにしません。補助コードは根拠ファイルの保存と契約検査を行いますが、任意の文書の正しさや隔離を証明するものではありません。原本保存、モデル実行の完了、比較条件の成立は別に判断します。別モデル・別CLIへ自動切り替えしません。

試行は同時に1つ。実行順は親が決めて記録します。各条件・各段階は新しい子を使い、孫Agentは起動しません。すべての試行を同じ記録ディレクトリへ置くことで、子の識別子と実行順の重複を拒否します。

以下はAPIの利用形です。`checks`は6項目すべてを明示します。各値の現行契約は次のどちらかです。未知項目・不正値・旧形式は拒否します。

- 確認済み: `{ status: 'verified', value: '確認した値', evidencePath: '仕様・設定・イベントのファイル', reason: null }`
- 未確認: `{ status: 'unconfirmed', value: null, evidencePath: null, reason: '確認できない理由' }`

実経路（cycle）は引き続き全項目verifiedを要求します。今回の整理で記憶循環の成立条件は変更しません。

```js
import { readFileSync, mkdirSync } from 'node:fs';
import { startTrial, bindLaunch, captureFixed, failTrial, judgeTrial } from './evaluation/trials.mjs';
const runs = JSON.parse(readFileSync('/tmp/evaluation-bundle/runs.json', 'utf8'));
mkdirSync('/tmp/evaluation-trials');
const path = startTrial('/tmp/evaluation-trials', {
  trialId: 'attribution-none-01', method: 'fixed', run: runs[0]
});
const input = readFileSync(`${path}/input.txt`, 'utf8');
// 成立確認済みの環境へinputをそのまま送る。ここにはモデル呼び出しは含めない。
// ランタイムで確認した実際の送信全文をsentInputへ渡す。
bindLaunch(path, { childId, runtime, order: 1, sentInput, checks, delivery: 'inline' });
captureFixed(path, {
  sourcePath: rawFinalOutputFile, sourceKind: 'runtime-final', eventPath: outputEventFile,
  executionStatus: 'completed' // 親がランタイムの終了イベント・終了状態を確認した値
});
// 未完了ならcaptureの代わりにfailTrial(path, '実際の失敗理由')。
```

`startTrial`は試行ID・方式・条件・対象HEAD・入力全文とSHA-256を保存します。`bindLaunch`は送信後に全文一致を検査し、確認状況、子ID、実行順、記録時刻を保存します。起動前の成立確認を代行せず、記録時刻は実際の起動時刻とは限りません。確認済み根拠ファイルはbytesとハッシュを保持し、未確認項目はnullと理由を保持します。親の会話、他条件、rubricは入力へ含めません。`delivery`は必須で、`inline`（入力全文を送る）か`file`（パスを送る）です。送信要求・子ID・イベント・最終出力の対応付けは実施側が確認します。

fileでは実際の送信全文をJSON `{ inputPath, outputPath, instructions }`にし、inputPathは試行の`input.txt`の絶対パス、outputPathは試行の`runtime/final-output.json`の絶対パスに限ります。instructionsは指定入力を読み回答原本を保存する依頼であり、rubricや他条件を含めません。入力ファイルのハッシュを再確認し、`inputHash`と`sentInputHash`を別保存します。パス指定は子が読んだことや参照先の隔離を証明しません。

固定比較の回答原本は次のJSONです。inlineでは最終出力として返し、fileでは子自身が指定されたoutputPathへ保存します。answerは回答全文であり、回答についての説明や要約ではありません。子の返却報告から原本を復元しません。

```json
{"trialId":"attribution-none-01","status":"completed","answer":"利用者への回答全文","usedEvidenceIds":[],"error":null}
```

`captureFixed`のsourceKindは`runtime-final`か`designated-artifact`です。後者は指定された`runtime/final-output.json`のみから直接取得します。指定ファイルの回答本文を原本とし、返却報告や参照情報の自己申告とは区別します。`captureFixed`は未加工JSONのbytesを`final-output.json`へ、契約に適合したanswerを`answer.txt`へ保存します。起動証跡・原本・イベントのいずれかが不足しても、取得できた原本とイベントを独立に保持します。余分な項目、ID不一致、不明根拠ID、未完了、原本欠落、要約による代用はinvalidとして記録します。失敗試行や取得できた途中成果を保持します。

`executionStatus`は必須で、`completed` / `failed` / `interrupted` / `unconfirmed`のみ受け付けます。子のJSON内のstatusから推測せず、親がイベント・プロセス終了状態から指定します。resultには`outputStatus`（原本契約）、`executionStatus`（実行）、`launchStatus`（送信証跡）、`unconfirmedChecks`を分けて保存します。原本・イベント・起動証跡が揃い、実行がcompletedなら試行のstatusをcompletedにしますが、これは比較成立を意味しません。`comparison: 'parent-unassessed'`を保存し、比較の成立と限界は親がREADMEへ記録します。

判定は`judgeTrial(path, { trialId, findings, unconfirmed, eventVerification })`で別保存します。findingsは `{ criterion, verdict: 'met'|'violated'|'unconfirmed', quote }`。quoteは回答原本の実在する箇所を必須とします。根拠箇所を取得できない判断はunconfirmedへ残します。判定は親による暫定的な規約適合評価であり、本人評価とは分けます。

完了回答は再生成しません。固定比較の未完了条件だけ、同じbundleのrunから新しい試行ID・新しい子で開始します。試行ID以外の入力は保持します。既存ディレクトリ・終了済み試行・判定は上書きできません。失敗理由を直すと条件が変わる場合は、別bundleとし比較を混ぜません。

## 記憶循環の実経路

合成一例の3条件で情報分離・送信全文・原本取得・設定を確認した後、全例比較より先に記憶循環一例を通します。`fixture.mjs`の`createFixture`と`cycleInput`を利用します。

```js
import { createFixture, cycleInput } from './evaluation/fixture.mjs';
const fixture = createFixture(repositoryPath, '/tmp/cycle-form-fixture', {
  targetHead, stage: 'form'
});
const path = startTrial(trialsDirectory, {
  trialId: 'cycle-one-form', method: 'cycle',
  input: cycleInput(fixture, 'cycle-one-form'), fixture: fixture.fixture
});
// 新しい子にinput.txt全文を送信し、bindLaunchで起動・送信証跡を保存する。
// 子の最終返却は識別情報・状態・成果物参照・失敗理由だけとして扱う。
// captureCycle(path, { eventPath: runtimeEventsFile })で成果物を直接回収する。
```

fixtureは指定HEADから通常のnpm scripts・README・規約・Skill・CLIを抽出し、独立したworkspaceブランチ、合成記事、空の記憶入口、syncMode=noneを作ります。gitの本人設定やフックは変更せず、commit・認証・依存導入・ネットワーク操作はしません。親の既存workspaceを変更しません。ローカルCLIに外部依存の導入は不要です。

段階は `form → reuse → correct → reuse-corrected`。各段階の子自身が、理解の形成・保存、別問題への適用、本人の訂正による更新、訂正後の適用を担います。親は記憶を代筆しません。reuse段階は記憶参照のみです。指示には自然言語の依頼と許可操作・指定成果物を含め、理解の要約や操作の模範解答は渡しません。

子がfixture内の`artifacts/answer.txt`に回答全文、`artifacts/execution.json`に実行記録を保存します。

```json
{"trialId":"cycle-one-form","stage":"form","status":"completed","usedRecords":[{"id":"記録ID","revision":1}],"operations":[{"command":"実行したコマンド","eventRef":null}],"error":null}
```

eventRefは取得できたCLI入出力への参照です。取得できないならnullとし創作しません。親はruntimeイベントを別取得し、`captureCycle`で回答・実行記録・memoryの保存前後を直接回収します。操作の記述は、照合するまでは自己申告です。子の返却から回答や記憶を復元しません。

実経路のjudgeTrialには操作ごとの `{ command, status: 'verified'|'unconfirmed', eventQuote }` をeventVerificationへ渡します。順番とcommandを実行記録に対応させ、verifiedにはランタイムイベントの実在箇所が必要です。CLIの入力・出力・終了状態まで対応することを親が確認します。引用文字列の存在だけで操作の実行を保証しません。記憶形成・再利用・訂正の意味やrevisionの変化も、回答・前後snapshot・CLI証跡から親が判断します。

次のfixtureは`createFixture(..., { targetHead, stage: 'reuse', previousTrial: path })`で作ります。前段階の完了、順番、同じHEAD、全操作のイベント照合を検査し、回収済みmemory snapshotだけを転送します。過去の回答・実行記録・入力・親の判定はfixtureへ含めません。これは同一試行内の段階移行であり、途中再開機能ではありません。中断・失敗時はformの初期fixtureから新しい試行としてやり直します。途中成果は残します。

Claudeは特別な評価用Skillを使わず、自然な依頼からCLAUDE.md → AGENTS.md → 必要な通常Skill・CLIへ到達する経路を確認します。CodexとClaudeはbundle・試行記録・成立根拠・結果を分け、比較結果を混ぜません。

## 実施状態（2026-09-26）

- 前回生成した入力の対象HEADは`f481e60c48ba36bd152e59fcb5da7a9a5f8a04ac`。合成8例・24条件。適用外の理解を採用しない例、不要な個人化を避ける例を追加しました。個人データは収録していません。
- `npm test`: 93件成功、失敗・skipなし。`git diff --check`も成功。モデルなしのテストで入力全文・条件分離、送信不一致、回答の改行・引用符・日本語、原本のbytes、要約拒否、ID・契約違反、原本・成果物欠落、中断、別IDによる再試行、既存成果物の保持、fixtureのCLIと記憶転送・順序・イベント照合を検証しています。MOCK起動情報とCLIのテストはモデルの挙動評価へ数えません。
- 合成入力を`.local/evaluation/explicit-io-20260926/`へ生成済みです。入力・規約・対象HEADのsnapshotと親専用rubricを保持しています。モデルへの送信は行っていません。
- 前回のCodex固定比較は未実施です。当時のサブAgent経路で成立根拠を確認できず停止したもので、環境の不可能性を証明したものではありません。
- 今回はツール禁止を撤回し、記録層と実施側の成立判断を分離しました。評価テスト9件成功（既存6件と追加3件）、git diff --check成功。モデルなしの検証です。OS隔離とCLI接続は調査までで停止しました。利用者の指示により通常のサブAgentへ入力ファイルの参照を委任する経路を採用します。モデル送信はまだ行っていません。
- Codexの別コンテキストをまたぐ記憶循環：未実施。先行する3条件の成立確認が未達です。
- Claudeの固定比較・自然な依頼からの実経路：未実施。実行環境の成立根拠は未確認です。Claude/CodexのCLIはPATHにありますが、自動切り替えやモデル呼び出しは行っていません。
- 本人による有用性評価、提案後の結果、実例の訂正後再利用：未収集。改善効果は未確認です。以前の個人例はこのテンプレートに収録せず、今回参照・変更していません。

今回の範囲は実行環境の確認とanswer-attribution一例の3条件です。指定入力への参照を委任し、指定ファイルから回答原本を直接回収します。新規bundle・新規子を使い直列実行します。回答原本・対応する証跡・親の暫定判定を取得できれば今回の完了です。成立しなければ根拠・未達条件・次に必要な操作を記録します。記憶循環、全例比較、Claude比較は次のセッションに残します。
