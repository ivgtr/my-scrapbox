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

比較条件は同じモデル・設定・依頼・利用可能時点です。共通規約は入力全文に含めます。noneは個人原文なし、rawは同じ原文だけ、raw-and-understandingは原文と理解です。入力情報量の差もあるため、理解の有効性と検索品質の因果をこの比較だけで断定しません。「理解あり」が勝つことは合格条件にしません。

## 実行環境の成立確認と試行記録

`trials.mjs`は親が利用する小さな記録APIです。モデル別ランナーや評価用Skillはありません。モデル呼び出しとランタイムイベントの取得は、成立確認済みの実行環境側が担当します。

実行前に親が次の6項目を確認します。各項目はランタイムの仕様・実効設定・可視イベントを根拠にし、子の自己申告を使いません。

| checks項目 | 必要な成立根拠 |
| --- | --- |
| conversation | 親・他条件・過去段階の会話を継承しないこと |
| automaticContext | 自動投入する指示・記憶・環境情報の全範囲。固定比較では共通規約以外の情報混入がないこと |
| tools | 固定比較はツールなし。実経路は許可操作だけを利用できること |
| referenceScope | 他条件の入力・回答、親の判定、個人データへアクセスできないこと |
| modelSettings | 実効モデルと設定。同一比較内で一致すること |
| rawOutput | 未加工の最終出力を取得できる経路。返却時の要約・切り詰めがないこと |

指示、別ディレクトリ、アクセスログだけでは隔離を保証できません。根拠がない項目はverifiedにしません。補助コードは根拠ファイルの保存と契約検査を行いますが、任意の文書の正しさや隔離を証明するものではありません。親による成立確認が必要です。不成立・確認不能なら比較を停止し、別モデル・別CLIへ自動切り替えしません。

試行は同時に1つ。実行順は親が決めて記録します。各条件・各段階は新しい子を使い、孫Agentは起動しません。すべての試行を同じ記録ディレクトリへ置くことで、子の識別子と実行順の重複を拒否します。

以下はAPIの利用形です。`checks`の各値は `{ status: 'verified', value: '確認した実効値', evidencePath: '仕様・設定・イベントのファイル' }`。6項目すべてが必要です。

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
bindLaunch(path, { childId, runtime, order: 1, sentInput, checks });
captureFixed(path, {
  sourcePath: rawFinalOutputFile, sourceKind: 'runtime-final', eventPath: outputEventFile
});
// 未完了ならcaptureの代わりにfailTrial(path, '実際の失敗理由')。
```

`startTrial`は試行ID・方式・条件・対象HEAD・入力全文とSHA-256を保存します。`bindLaunch`は送信全文の一致を検査し、起動条件の根拠、子ID、実行順、記録時刻を保存します。根拠ファイルはbytesとハッシュを保持します。親の会話、他条件、rubricは入力へ含めません。`input.txt`の全文だけを子に渡します。

固定比較の子は次のJSONだけを返します。answerは回答全文であり、回答についての説明や要約ではありません。

```json
{"trialId":"attribution-none-01","status":"completed","answer":"利用者への回答全文","usedEvidenceIds":[],"error":null}
```

`captureFixed`は未加工JSONのbytesを`final-output.json`へ、answerを`answer.txt`へ保存します。余分な項目、ID不一致、不明根拠ID、未完了、原本欠落、要約による代用はinvalidとして記録します。起動根拠が未取得の試行も正常終了にしません。失敗試行や取得できた途中成果を保持します。

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

- 対象HEADは`f481e60c48ba36bd152e59fcb5da7a9a5f8a04ac`。合成8例・24条件。適用外の理解を採用しない例、不要な個人化を避ける例を追加しました。個人データは収録していません。
- `npm test`: 93件成功、失敗・skipなし。`git diff --check`も成功。モデルなしのテストで入力全文・条件分離、送信不一致、回答の改行・引用符・日本語、原本のbytes、要約拒否、ID・契約違反、原本・成果物欠落、中断、別IDによる再試行、既存成果物の保持、fixtureのCLIと記憶転送・順序・イベント照合を検証しています。MOCK起動情報とCLIのテストはモデルの挙動評価へ数えません。
- 合成入力を`.local/evaluation/explicit-io-20260926/`へ生成済みです。入力・規約・対象HEADのsnapshotと親専用rubricを保持しています。モデルへの送信は行っていません。
- Codexの固定比較：未実施。会話継承、自動投入情報、ツール・参照範囲、実効モデル・設定、未加工の最終出力とイベント取得について、利用可能なサブAgent経路の成立根拠を確認できません。未加工の原本取得を確認できないため、実行前に停止しました。
- Codexの別コンテキストをまたぐ記憶循環：未実施。先行する3条件の成立確認が未達です。
- Claudeの固定比較・自然な依頼からの実経路：未実施。実行環境の成立根拠は未確認です。Claude/CodexのCLIはPATHにありますが、自動切り替えやモデル呼び出しは行っていません。
- 本人による有用性評価、提案後の結果、実例の訂正後再利用：未収集。改善効果は未確認です。以前の個人例はこのテンプレートに収録せず、今回参照・変更していません。

次の操作は、6項目の成立根拠と原本・CLIイベント取得経路を確認し、合成一例の3条件を実行することです。成立後に同一モデル・設定で記憶循環を通し、その後に残りの例を比較します。完了は回答原本と別コンテキスト間の記憶循環の実行証拠で判断します。現在は補助コードとモデルなしの検証までで、挙動評価の完了条件は未達です。
