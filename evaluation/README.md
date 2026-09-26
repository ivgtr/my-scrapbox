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

親は次の6項目について確認できた値・根拠と未確認事項を記録します。各項目はランタイムの仕様・実効設定・可視イベントを根拠にし、子の自己申告を使いません。固定比較・実経路とも、全項目verifiedを記録APIの起動条件にはしません。今回の固定比較は、入力ファイルへの参照を通常のサブAgentへ委任します。他条件・親の判定・個人データを参照しない指示を渡しますが、ファイル環境の共有を許容し、アクセス不能の保証は実施しません。この限界と未加工原本の取得経路を記録します。モデル・設定の指定は実施段階で決め、未確認の実効値は補いません。同一条件を確認できない比較は、その限界を明示します。

| checks項目 | 必要な成立根拠 |
| --- | --- |
| conversation | 親・他条件・過去段階の会話を継承しないこと |
| automaticContext | 自動投入する指示・記憶・環境情報の範囲と比較への影響 |
| tools | 利用可能なツールと権限。ツール禁止を前提にしない。実際の利用はイベントで別確認する |
| referenceScope | 指定した参照範囲と強制の有無。今回の固定比較は指示による委任であり、共有ファイルへのアクセス不能は未確認 |
| modelSettings | 実効モデルと設定。同一比較内で一致すること |
| rawOutput | ランタイム最終出力または指定先の回答原本を直接取得。返却報告・要約から復元しないこと |

指示、別ディレクトリ、アクセスログだけでは隔離を保証できません。今回の固定比較に隔離保証は要求せず、参照範囲の指示と保証を区別します。根拠がない項目はverifiedにしません。補助コードは根拠ファイルの保存と契約検査を行いますが、任意の文書の正しさや隔離を証明するものではありません。原本保存、モデル実行の完了、比較条件の成立は別に判断します。別モデル・別CLIへ自動切り替えしません。

試行は同時に1つ。実行順は親が決めて記録します。各条件・各段階は新しい子を使い、孫Agentは起動しません。すべての試行を同じ記録ディレクトリへ置くことで、子の識別子と実行順の重複を拒否します。

以下はAPIの利用形です。`checks`は6項目すべてを明示します。各値の現行契約は次のどちらかです。未知項目・不正値・旧形式は拒否します。

- 確認済み: `{ status: 'verified', value: '確認した値', evidencePath: '仕様・設定・イベントのファイル', reason: null }`
- 未確認: `{ status: 'unconfirmed', value: null, evidencePath: null, reason: '確認できない理由' }`

実経路（cycle）でも未確認事項をそのまま保存し、inlineとfileを受け付けます。未確認事項をverifiedへ変換せず、原本の回収・実行終了・観測の十分さを分けて扱います。

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
// 未完了でも取得可能な成果物はcaptureで保持する。回収を行えない場合はfailTrialへ理由を残す。
```

`startTrial`は試行ID・方式・条件・対象HEAD・入力全文とSHA-256を保存します。`bindLaunch`は送信後に全文一致を検査し、確認状況、子ID、実行順、記録時刻を保存します。起動前の成立確認を代行せず、記録時刻は実際の起動時刻とは限りません。確認済み根拠ファイルはbytesとハッシュを保持し、未確認項目はnullと理由を保持します。親の会話、他条件、rubricは入力へ含めません。`delivery`は必須で、`inline`（入力全文を送る）か`file`（パスを送る）です。送信要求・子ID・イベント・最終出力の対応付けは実施側が確認します。

固定比較のfileでは実際の送信全文をJSON `{ inputPath, outputPath, instructions }`にし、inputPathは試行の`input.txt`の絶対パス、outputPathは試行の`runtime/final-output.json`の絶対パスに限ります。instructionsは指定入力を読み回答原本を保存する依頼であり、rubricや他条件を含めません。入力ファイルのハッシュを再確認し、`inputHash`と`sentInputHash`を別保存します。パス指定は子が読んだことや参照先の隔離を証明しません。

固定比較の回答原本は次のJSONです。inlineでは最終出力として返し、fileでは子自身が指定されたoutputPathへ保存します。answerは回答全文であり、回答についての説明や要約ではありません。子の返却報告から原本を復元しません。

```json
{"trialId":"attribution-none-01","status":"completed","answer":"利用者への回答全文","usedEvidenceIds":[],"error":null}
```

`captureFixed`のsourceKindは`runtime-final`か`designated-artifact`です。後者は指定された`runtime/final-output.json`のみから直接取得します。指定ファイルの回答本文を原本とし、返却報告や参照情報の自己申告とは区別します。`captureFixed`は未加工JSONのbytesを`final-output.json`へ、契約に適合したanswerを`answer.txt`へ保存します。起動証跡・原本・イベントのいずれかが不足しても、取得できた原本とイベントを独立に保持します。余分な項目、ID不一致、不明根拠ID、未完了、原本欠落、要約による代用はinvalidとして記録します。失敗試行や取得できた途中成果を保持します。

`executionStatus`は必須で、`completed` / `failed` / `interrupted` / `unconfirmed`のみ受け付けます。子のJSON内のstatusから推測せず、親がイベント・プロセス終了状態から指定します。resultには`outputStatus`（原本契約）、`executionStatus`（実行）、`launchStatus`（送信証跡）、`unconfirmedChecks`を分けて保存します。原本・イベント・起動証跡が揃い、実行がcompletedなら試行のstatusをcompletedにしますが、これは比較成立を意味しません。`comparison: 'parent-unassessed'`を保存し、比較の成立と限界は親がREADMEへ記録します。

通常判定は`judgeTrial(path, { trialId, kind: 'assessment', findings, unconfirmed, eventVerification })`でcompletedの試行に別保存します。findingsは `{ criterion, verdict: 'met'|'violated'|'unconfirmed', quote }`。quoteは回答原本の実在する箇所を必須とします。根拠箇所を取得できない判断はunconfirmedへ残します。判定は親による暫定的な規約適合評価であり、本人評価とは分けます。

診断は`judgeTrial(path, { trialId, kind: 'diagnostic', observations, unconfirmed })`でcompleted・invalid・failedの試行へ保存できます。observationsは空でない配列で、各項目は `{ observation: '観察内容', artifact: 'result.json', reason: 'その観察の理由' }`です。artifactは試行内で取得済みの入力・起動情報・結果・回答原本・実行記録・イベント・記憶と環境の前後snapshotに限ります。根拠成果物がない場合はnullにし、reasonへ取得できない理由と判断の限界を明示します。存在しないファイルや任意パスへの参照は拒否します。回答引用と操作ごとのイベント照合は診断には要求しません。unconfirmedは通常判定・診断とも空でない文字列の配列です（事項がなければ空配列）。

診断は`assessment: 'diagnostic-only'`としてjudgment.jsonへ保存し、試行状態と成果物を変更しません。成功判定・比較成立・次段階の開始には使いません。通常判定と診断は同じ試行に重ねて保存せず、保存済み判定を上書きしません。kindの省略・未知の形式は拒否します。過去の記録は変換・再判定しません。

完了回答は再生成しません。固定比較の未完了条件だけ、同じbundleのrunから新しい試行ID・新しい子で開始します。試行ID以外の入力は保持します。既存ディレクトリ・終了済み試行・判定は上書きできません。失敗理由を直すと条件が変わる場合は、別bundleとし比較を混ぜません。

## 記憶循環の実経路

合成一例の3条件の回答原本を取得した次の段階として、既存構成で記憶循環一例を通します。`fixture.mjs`の`createFixture`と`cycleInput`を利用します。OS隔離や実効設定の完全取得は先行条件に戻さず、参照範囲を指定して子へ委任し、観測不足は記録と結論の強さへ反映します。

```js
import { createFixture, cycleInput } from './evaluation/fixture.mjs';
const fixture = createFixture(repositoryPath, '/tmp/cycle-form-fixture', {
  targetHead, stage: 'form'
});
const path = startTrial(trialsDirectory, {
  trialId: 'cycle-one-form', method: 'cycle',
  input: cycleInput(fixture, 'cycle-one-form'), fixture: fixture.fixture
});
// 新しい子へinlineまたはfileで入力を渡し、bindLaunchで起動・送信証跡を保存する。
// 子の最終返却は識別情報・状態・成果物参照・失敗理由だけとして扱う。
// captureCycle(path, { eventPath: runtimeEventsFile, executionStatus: 'completed' })で直接回収する。
// executionStatusは子の自己申告ではなく、親が確認したランタイムの終了状態。
```

fixtureは指定HEADから通常のnpm scripts・README・規約・Skill・CLIを抽出し、独立したworkspaceブランチ、合成記事、空の記憶入口、syncMode=noneを作ります。gitの本人設定やフックは変更せず、commit・認証・依存導入・ネットワーク操作はしません。親の既存workspaceを変更しません。ローカルCLIに外部依存の導入は不要です。

段階は `form → reuse → correct → reuse-corrected`。各段階の子自身が、理解の形成・保存、別問題への適用、本人の訂正による更新、訂正後の適用を担います。親は記憶を代筆しません。reuse段階は記憶参照のみです。指示には自然言語の依頼と許可操作・指定成果物を含め、理解の要約や操作の模範解答は渡しません。

子がfixture内の`artifacts/answer.txt`に回答全文、`artifacts/execution.json`に実行記録を保存します。

```json
{"trialId":"cycle-one-form","stage":"form","status":"completed","usedRecords":[{"id":"記録ID","revision":1}],"operations":[{"command":"実行したコマンド","eventRef":null}],"error":null}
```

cycleのfile委任では送信全文をJSON `{ inputPath, output: { answer, execution }, instructions }`にします。inputPathは試行のinput.txtの絶対パス、answerとexecutionは入力契約で指定したfixture内のartifacts/answer.txtとartifacts/execution.jsonの絶対パスです。固定比較のoutputPathやfinal-output.jsonは受け付けません。入力ハッシュと送信全文のハッシュを別保存します。パスの一致は参照範囲の隔離や実際の読み取りを証明しません。

eventRefは取得できたCLI入出力への参照です。取得できないならnullとし創作しません。親はruntimeイベントを別取得し、`captureCycle`で回答・実行記録・memoryの保存前後を直接回収します。操作の記述は、照合するまでは自己申告です。子の返却から回答や記憶を復元しません。

captureCycleにもexecutionStatusは必須で、固定比較と同じ4値を受け付けます。回答・実行記録・イベント・記憶・環境情報を独立して回収し、取得済みbytesは契約違反があっても保持します。不足と検査失敗をreasonへ集約します。resultはoutputStatus（回答と実行記録の契約）、executionStatus（親が確認した実行終了）、launchStatus、unconfirmedChecksを分けて保持します。全回収・契約検査が成功し、実行がcompletedの場合だけstatusをcompletedにします。比較成立は別判断で、comparisonはparent-unassessedです。failTrialでも記憶回収の失敗で環境回収を止めません。

実経路のjudgeTrialには操作ごとの `{ command, status: 'verified'|'unconfirmed', eventQuote }` をeventVerificationへ渡します。順番とcommandを実行記録に対応させ、verifiedにはランタイムイベントの実在箇所が必要です。CLIの入力・出力・終了状態まで対応することを親が確認します。引用文字列の存在だけで操作の実行を保証しません。記憶形成・再利用・訂正の意味やrevisionの変化も、回答・前後snapshot・CLI証跡から親が判断します。

次のfixtureは`createFixture(..., { targetHead, stage: 'reuse', previousTrial: path })`で作ります。前段階のcompletedと親が確認した実行終了、通常判定の存在と試行ID、順番、同じHEAD、memory snapshotのハッシュ整合性を検査し、回収済みmemory snapshotだけを転送します。全操作verifiedは要求せず、空の操作一覧やunconfirmedだけで段階移行を止めません。操作の照合結果と未確認事項は前段階の判定に残します。過去の回答・実行記録・入力・親の判定はfixtureへ含めません。これは同一試行内の段階移行であり、途中再開機能ではありません。中断・失敗時はformの初期fixtureから新しい試行としてやり直します。途中成果は残します。

訂正後再利用の判定では、最終依頼で訂正内容を再提示せず、回答と引き継いだ記憶から、通知試行の訂正後に何が分かったかを扱えていることを確認します。別チームで同じ原因があるとは断定せず、過去の確認事項と今回への推測・最初に確かめる条件を分けることを評価します。元の「処理の成功と仕事の成果は別」という理解が引き続き妥当な場合もあるため、旧理解の一律撤回や特定記録の更新を合格条件にはしません。適切な回答だけで記憶経由の再利用を断定せず、記憶・参照記録・取得できたイベントも確認し、観測できない点は未確認として残します。

Claudeは特別な評価用Skillを使わず、自然な依頼からCLAUDE.md → AGENTS.md → 必要な通常Skill・CLIへ到達する経路を確認します。CodexとClaudeはbundle・試行記録・成立根拠・結果を分け、比較結果を混ぜません。

## 実施状態（2026-09-27）

- 前回生成した入力の対象HEADは`f481e60c48ba36bd152e59fcb5da7a9a5f8a04ac`。合成8例・24条件。適用外の理解を採用しない例、不要な個人化を避ける例を追加しました。個人データは収録していません。
- `npm test`: 93件成功、失敗・skipなし。`git diff --check`も成功。モデルなしのテストで入力全文・条件分離、送信不一致、回答の改行・引用符・日本語、原本のbytes、要約拒否、ID・契約違反、原本・成果物欠落、中断、別IDによる再試行、既存成果物の保持、fixtureのCLIと記憶転送・順序・イベント照合を検証しています。MOCK起動情報とCLIのテストはモデルの挙動評価へ数えません。
- 合成入力を`.local/evaluation/explicit-io-20260926/`へ生成済みです。入力・規約・対象HEADのsnapshotと親専用rubricを保持しています。モデルへの送信は行っていません。
- 前回のCodex固定比較は未実施です。当時のサブAgent経路で成立根拠を確認できず停止したもので、環境の不可能性を証明したものではありません。
- 今回はツール禁止を撤回し、記録層と実施側の成立判断を分離しました。評価テスト9件成功（既存6件と追加3件）、`git diff --check`成功。モデルなしの検証です。OS隔離とCLI接続は調査までで停止しました。利用者の指示により通常のサブAgentへ入力ファイルの参照を委任し、以下の一例3条件を実施しました。
- Codexの別コンテキストをまたぐ記憶循環：合成一例の4段階を実施済み。回答原本・前後snapshot・公開完了状態・親の暫定判定を取得しました。詳細は末尾「記憶循環一例の実施」。本人評価とは区別します。
- Claudeの固定比較・自然な依頼からの実経路：未実施。実行環境の成立根拠は未確認です。Claude/CodexのCLIはPATHにありますが、自動切り替えやモデル呼び出しは行っていません。
- 本人による有用性評価、提案後の結果、実例の訂正後再利用：未収集。改善効果は未確認です。以前の個人例はこのテンプレートに収録せず、今回参照・変更していません。

今回の範囲は実行環境の確認とanswer-attribution一例の3条件です。指定入力への参照を委任し、指定ファイルから回答原本を直接回収します。新規bundle・新規子を使い直列実行します。回答原本・対応する証跡・親の暫定判定を取得できれば今回の完了です。成立しなければ根拠・未達条件・次に必要な操作を記録します。記憶循環、全例比較、Claude比較は次のセッションに残します。

### 今回の一例3条件

入力の対象HEADは`7e96043dd42161bdf7a9a3cb0c83de61a1d78b51`です。開始時の`5005e91`から記録層を整理した後に固定しました。利用可能時点は`2026-09-26T14:56:00.182Z`、合成例は`answer-attribution`。旧`f481e60`の24条件は使用していません。実施後のcycle入力経路の範囲制限は固定比較の入力・原本へ影響しないため、完了回答は再生成していません。

通常の`collaboration.spawn_agent`へ、一条件のinputPath・outputPathと共通の読み取り・保存依頼をJSONで送信しました。各条件はfork_turns=none、新しい子、モデル・推論設定の上書きなし。none → raw → raw-and-understandingの順に、前の子の完了と原本回収後に次を起動しました。返却報告は回答原本に使っていません。

| 条件 / 試行ID末尾 | 子の識別子 | 取得・暫定判定 |
| --- | --- | --- |
| none / none-01 | /root/eval_none_01 | 原本・送信証跡・完了イベント・親判定を取得。保存と賛同を区別し、意向を断定しない。具体的な発言者の識別は原文がないため未確認 |
| raw / raw-01 | /root/eval_raw_01 | 同じ成果物を取得。2024年の外部著者の主張と保存者のコメント不在を識別し、賛同を断定しない |
| raw-and-understanding / raw-and-understanding-01 | /root/eval_understanding_01 | 同じ成果物を取得。外部著者を識別し、保存と賛同を区別。既存の理解も本人未確認と明示 |

試行IDの接頭辞は`answer-attribution-`です。3試行とも原本契約・実行・回収はcompleted、失敗・再生成なし。判断は親による暫定的な規約適合評価です。理解ありの優位性、本人の有用性評価、提案後の結果は確認していません。

原本の引用例：noneは「記事を保存したことだけでは、内容への賛同とは言えません。」、rawは「2024年の外部著者の「全ての判断を自動化すべきだ」という主張」、raw-and-understandingは「保存だけでは賛同の証拠にならないという既存の理解も、あなたによる確認はありません。」。must・avoidごとの引用と判定は各`judgment.json`に保持しています。情報を渡していないnoneの識別不足を、他条件に対する点数差として扱いません。

### 成果物と確認の限界

成果物はGit管理外の`.local/evaluation/delegated-one-20260926/`です。別環境での存在は前提にしません。

- `bundle/`: 一例3条件のruns・snapshot・親専用rubric。
- `trials/<trialId>/`: 入力全文、入力ハッシュ、実際に送ったパス指定全文と別ハッシュ、子ID、実行順、確認状況、原本bytes、answer、状態、親判定。
- `trials/<trialId>/runtime/`: 子が保存した原本、取得したspawn_agent応答とlist_agents完了応答。`output-event.bin`は完了応答の保存です。公開ツール応答を親が保存したもので、内部イベントストリームやツール呼び出し全履歴ではありません。
- `summary.json`: 3条件の取得状態、原本ハッシュ、未確認事項。指定原本と回収原本のbytes一致、入力と送信全文のハッシュ一致を確認しました。
- `evidence/`: セッションのサブAgent仕様・実施方針、および中止したCLI・OS隔離の調査証跡。CLI経路でモデルは呼び出していません。

会話はfork_turns=noneの仕様と実際の起動指定を確認しました。ツールは利用可能なままです。参照範囲は利用者の指示に従って子へ委任し、共有ファイルにアクセスできないという保証は要求・検証していません。自動投入情報の全体、実効モデル・設定、実際に読んだ全ファイル、内部ツール実行履歴は未取得です。モデル・設定は同じ親から継承する要求までを確認し、厳密な同一設定の証明とは区別します。`usedEvidenceIds`は子の自己申告です。これらを未確認のまま残した探索的な3条件比較であり、統制条件が全て成立した比較とは報告しません。

### 再生成・再実行

同じ例のbundleは現行コードで次のように生成できます。新規出力先を指定し、使ったHEADと時点を明示してください。モデル呼び出しは含みません。

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { writeBundle } from './evaluation/prepare.mjs';
const cases = JSON.parse(readFileSync('evaluation/cases.json', 'utf8'));
writeBundle(cases.filter(c => c.id === 'answer-attribution'),
  '.local/evaluation/answer-attribution-new-bundle', {
    availableAt: new Date().toISOString(),
    targetHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  });
JS
```

実行は各runを`startTrial`で新しい試行IDへ保存し、runtimeディレクトリを作成します。実際に送るJSONは`{ inputPath, outputPath, instructions }`です。指定入力だけを参照し、入力のoutput.formatに従う回答全文をoutputPathへ保存するよう依頼します。通常のサブAgentをfork_turns=none、モデル指定なしで1つずつ起動し、公開起動・完了応答を保存します。`bindLaunch(..., { delivery: 'file', sentInput, childId, runtime, order, checks })`、`captureFixed(..., { sourcePath: outputPath, sourceKind: 'designated-artifact', eventPath, executionStatus })`、`judgeTrial`の順で回収・判定します。原本がない場合は返却報告で補わず`failTrial`へ理由を残します。

今回の3条件は完了済みなので再実行しません。未完了条件を再開する場合だけ、同じbundleのrun・新しい試行ID・新しい子を使います。失敗試行は保持します。参照指示やモデル・設定を変える場合は別bundleへ分けます。次のセッションは記憶循環一例へ進み、モデル・設定は取得できた範囲を記録します。全例比較とClaude比較も今回未実施です。

### 実装レビュー対応（2026-09-27）

`db9bd41`への4件の指摘を確認し、利用者の承認に基づき、cycleの実行終了確認・独立回収、失敗時の診断保存、訂正後再利用の設問を修正しました。計画済みの制約緩和として、cycleの未確認checksとfile委任を許容し、補足的なイベント照合不足による段階移行停止を外しました。実行終了・段階順・同じHEAD・記憶引継ぎの検査は維持しています。本体CLI・Skill・新しいランナーは変更していません。モデル評価と本人評価は未実施です。

検証はモデルなしの評価関連15件と全体102件が成功しました（失敗・skipなし）。`git diff --check`も成功しています。次の操作は変更差分の確認と、必要な場合のモデル評価です。今回の承認範囲にはモデル評価を含めていません。

### 次の実施方針（2026-09-27）

設計レビュー後の合意は、`91168de`の構成を維持し、記憶循環一例 → 操作手順を指定しない本人の実相談 → 観測した失敗だけの改修 → 残りの合成例・Claudeへの展開、の順に進めることです。新しい記憶形式、評価専用Skill、モデル別ランナー、自動整理、詳細な監視基盤の追加は先行しません。CLIは構造と参照の整合性、Agentは意味・訂正・適用を扱います。

次の作業依頼は記憶循環一例に限定します。まず現行コードと実行環境から実施計画を提示して利用者の確認を待ち、確認後は必要な最小修正・検証・実施・記録更新・commitまで続けます。変更不要なら既存APIで実施します。対象HEAD・合成fixture・子へ渡す入力・原本と取得イベントの回収方法・保存先・判定と停止条件を計画へ明示します。通常のサブAgentを段階ごとに新しく使い、同時起動は1つ、孫Agentなし。親は記憶を代筆せず、回答原本と保存内容から判断します。

完了は、4段階の回答原本・実行終了と回収状態・記憶の前後snapshot・取得できた証跡・親の暫定判定を残し、形成・再利用・訂正・訂正後の適用が実経路でどうなったか説明できることです。取得できない内部イベントや実効値を推測で埋めません。妥当な一般則を残すことも認め、旧理解の一律撤回・特定記録の更新・好ましい回答だけを成功条件にしません。記憶を経由した再利用は、回答だけから断定しません。支障があれば診断を残し、今回の範囲で原因に対応する最小修正を行います。範囲外の権限が必要なら、その理由と次の操作を残して停止します。

cycleの成功は通常利用の成功とは区別します。その後の実相談では通常の規約を有効にしたまま内部工程を指定せず、必要な過去を選べるか、保存・更新・保留を選べるか、説明の手間が減り判断が進むかを本人の基準で見ます。今回限りの条件を恒久的な人物像にせず、提案への納得・採用・実施・効果を分けます。実相談への移行は本人の相談と許可範囲が揃ってから行い、合成相談を本人評価の代わりにはしません。

詳細な合成成果物は新規のGit管理外ディレクトリへ保存し、対象HEAD・生成方法・参照先・未達条件・次の操作をこのREADMEへ更新します。旧3条件の成果物は上書き・再生成しません。既存の個人workspace・認証・同期・記事編集・公開・pushは対象外です。合成fixture内の設定・記事・記憶の準備は既存fixture生成APIで行います。検証は変更と失敗に必要な範囲に限定し、102件の既存成功証拠が有効なら再利用します。

### 記憶循環一例の実施（2026-09-27）

利用者の計画確認（OK）後、機能変更を追加せず既存APIで4段階を実施しました。開始時のHEAD・fixture対象HEADは`dc4ed2eb8472ee902d54d5f0872fed3e5649afed`、ブランチはmain、作業ツリーはクリーンでした。レビュー基準`91168de`との差分はこのREADMEだけで、CLI・規約・Skill・評価実装・テストは同一です。評価15件・全体102件のモデルなし成功証拠を再利用し、理由のない全件再実行はしません。Node v26.3.1、npm 11.16.0、Git 2.53.0、tar 1.35を確認しました。親の`session:start`は個人設定未作成でexit 1となり、個人セットアップは行っていません。

承認された計画は、既存の`createFixture`・`cycleInput`・`startTrial`で合成fixtureと試行を生成し、通常の子へfile契約`{ inputPath, output: { answer, execution }, instructions }`で委任するものです。4段階で新しい子を`fork_turns=none`、モデル・推論設定の上書きなしで1つずつ起動し、孫Agentは起動しません。親は記憶を代筆せず、次段階へは`createFixture(..., { previousTrial })`で回収済みmemory snapshotだけを引き継ぎます。参照範囲は指示で委任し、OS隔離や全実効設定の取得は先行条件にしません。

生成・回収方法は次の既存APIです。新規ディレクトリを使い、trialId・fixture先・stage・previousTrialを段階に合わせます。対象HEADは全段階で同じです。

`createFixture(repositoryPath, fixturePath, { targetHead, stage, previousTrial })` → `startTrial(trialsPath, { trialId, method: 'cycle', input: cycleInput(fixture, trialId), fixture: fixture.fixture })` → file委任で子を起動 → `bindLaunch` → 公開完了状態を取得 → `captureCycle` → `judgeTrial`。親の一時的な接続処理だけを使い、新しいランナー・記憶形式・評価Skill・監視基盤は追加していません。合成記事はfixture実装内の`synthetic-notification` / `synthetic-v1`、取得時点は2026-09-26T12:00:00.000Zです。

成果物はGit管理外の`.local/evaluation/cycle-one-20260927-01/`です。別環境での存在は前提にしません。

- `fixtures/<stage>-01/`: 指定HEADから抽出した通常CLI・規約・Skill、合成記事・設定、子自身が保存した記憶と指定成果物。
- `trials/cycle-one-<stage>-01/`: 入力全文とハッシュ、起動・送信証跡、回答原本、実行記録、記憶と記事・設定の前後snapshot、回収状態、親の暫定判定。
- `runtime/`（各試行内）: 送信JSON、実際の起動指定と公開起動応答、公開完了状態。`runtime-events.bin`はその完了状態の直接保存で、内部イベントストリームやCLIの全履歴ではありません。
- `evidence/`: 開始環境とサブAgentの公開仕様。`summary.json`には最終の回収・照合結果と限界を保存します。

起動時のrawOutputは指定先への直接保存を要求した段階なので未確認として記録し、回収後の原本実在・bytes一致とは分けます。会話非継承の指定と公開仕様は確認済みです。自動投入情報の全体、実効モデル・設定・権限、実際の全参照先、操作ごとのCLI入出力・終了状態は未取得です。execution.jsonの操作・参照記録は自己申告であり、公開完了イベントをCLI操作の証拠へ読み替えません。判定では対応する操作をunconfirmedとして残します。

4段階とも実行終了・原本契約・起動証跡・回収はcompletedで、親の暫定判定を保存しました。失敗試行・再生成・再試行・実装修正はありません。欠落・契約違反・終了未確認では回収済み成果物と診断を保持し、次段階へ進みません。原因に対応する最小修正だけを扱い、再試行は新しいID・子でformから開始します。完了回答・既存試行・旧3条件は上書きしません。範囲外の権限が必要なら未達条件・根拠・必要操作を残して停止します。

#### 回収結果と暫定判定

試行IDは`cycle-one-<stage>-01`。全段階で記録`ccd6882e-c99c-4cc5-a2c9-85d5e6259c4f`を観測しました。子の識別子と実行順はlaunch.jsonとsummary.jsonに保存しています。

| 段階 / 順番 | 子 | 回答と保存内容からの観察 | 記憶の前後差分 |
| --- | --- | --- | --- |
| form / 1 | /root/cycle_form_01 | 「根拠付きの仮説として記憶に保存しました」。通知未読を断定せず、処理成功と成果を分ける理解、適用条件・例外・競合説明を保存 | 空の入口からunderstanding / inference / unconfirmedのrevision 1を作成。記事observation行を根拠とし、入口リンクも追加 |
| reuse / 2 | /root/cycle_reuse_01 | 記録IDとrevision 1を回答・usedRecordsで指定。適用条件を分け、対象1つ・確認3回の小さな在庫確認試行を第一候補として提案 | formの回収snapshotと一致し、参照前後は不変 |
| correct / 3 | /root/cycle_correct_01 | 原因を「読んだ後の対応担当が決まっていなかったこと」へ訂正。妥当な一般則は維持し、推論と訂正の明言を区別 | 同一記録をrevision 2へ更新。訂正の対話根拠・適用除外・変更理由・次に確かめる箇所を更新。正確な発言時刻はnull。入口リンクは同じ |
| reuse-corrected / 4 | /root/cycle_reuse_corrected_01 | 「通知は必要な人に読まれていたが、その後の対応担当が決まっていなかった」と回答。revision 2を指定し、別チームでは「同じ原因だとはまだ判断できません」と、担当決定・引受け等を最初の確認対象に提案 | correctの回収snapshotと一致し、参照前後は不変 |

前後差分は各試行の`memory-diff.json`へ保存しました。formの保存後ハッシュは`4a3e4ad4654a0f4b648e1d6a8ec11f67c0d2927653f4e15bc5982bc4e4fa27d3`、correctの保存後は`4d1e12060f2183c604eb677876210d6730d6f27a58c36f11d4aa216a895a5fe4`です。revision 2でも一般則のbasis=inference / confirmation=unconfirmedは保持され、旧理解の一律撤回はしていません。親はこの意味判断を妥当と暫定評価しました。記憶と回答内の「本人」は合成利用者役であり、実利用者の本人確認・評価を意味しません。

最終設問と送信依頼には訂正内容を再提示していません。合成記事は原因未確認という当時の内容のままです。新しい子への会話非継承指定、訂正後snapshotの引継ぎ、回答・参照申告のrevision 2との対応は、記憶を経由した訂正後の適用を支持します。ただし内部のmemory:read/evidence等の入力・出力・終了状態と実際の全参照先は独立確認できず、回答だけから因果的な再利用を証明したとは報告しません。4段階の操作申告は11 / 10 / 12 / 12件で、全45件のイベント照合はunconfirmedです。訂正段階には空検索が拒否されたとの申告もありますが、必要成果物は回収でき、実施を妨げる失敗は観測していないため修正・再試行は行いませんでした。

#### 検証・未達条件・次の操作

今回の成果物照合では、4段階の入力と送信全文のハッシュ、送信指定・子ID・順番、公開completed状態、指定回答・実行記録と回収原本のbytes一致、完了イベント保存とのbytes一致、snapshotハッシュ整合性と段階間一致、reuse段階の記憶不変、記事・設定不変、通常判定の試行対応がすべて成功しました。最終設問に訂正内容がないことも確認しました。`git diff --check`は成功。実装・テスト・規約が`91168de`と同一であることを確認し、評価15件・全体102件のモデルなし成功証拠を再利用しました。全件テストを今回再実行したとは扱いません。

今回の到達点である4段階の原本・前後snapshot・状態・取得証跡・親の暫定判定は取得済みです。未達・未確認は、内部CLIイベントによる操作の独立確認、全実効設定・自動投入情報・参照先の確認、本人による有用性評価、提案の採用・実施・効果です。今回のcycleの取得完了を通常利用の成功へ読み替えません。個人記憶はmainへ作成せず、このREADMEへ実施記録を集約しています。Git管理外の合成成果物はcommitに含めません。

次は合意済みの「内部工程を指定しない本人の実相談」です。本人の相談と許可範囲が揃ってから実施し、観測した失敗だけを改修します。残りの合成例・Claudeへの展開はその後です。今回そこまで広げていません。成果物を別環境へ移す場合はGitでは取得できないため、この保存先を別途保持・移送する必要があります。完了済み4段階と旧3条件は再生成しません。

### 本人の実相談の完了（2026-09-27）

利用者が通常の個人workspaceで実相談を実施し、追加依頼後の出力に満足したと評価しました。今回の実相談はここで完了とします。対象HEADは `91168de36db5f83ea294c58577716c16cf811157`。内部工程を指定しない初回依頼から通常Skill・記事参照・構造化記憶の形成へ進み、同一セッションの追加依頼で考察文書へ改稿しました。

指定された個人環境のCodexセッション記録から、初回・追加回答の原本、可視CLI入出力・終了状態、記憶のrevision 1での保存とrevision 2への更新成功を確認しました。本人評価は「初回は的確だが引用のまとめに寄り、追加依頼後は満足」です。出力への満足を個々の解釈への本人確認とはみなしません。相談・回答・個人記憶・セッション識別子は個人環境に保持し、mainへ収録しません。

別セッションでの因果的な記憶再利用、説明負担の軽減、提案の採用・実施・効果は未確認です。効率化は今回扱わず、残りの合成例・Claudeへの展開も実施しません。本人評価の根拠は完了を指示した対話、相談・操作の原本は個人環境のセッション記録、保存結果は個人workspaceの記憶です。評価資産をテンプレートに含める方針は未決で、別途判断します。

今回の整理はREADMEの短縮と記憶スキーマ資料・参照先の移動だけです。スキーマ全文の保持、変更文書のローカルリンク、`git diff --check`を確認しました。CLI・評価実装・テストは未変更で、既存のモデルなし検証結果を再利用し、全件テストは再実行していません。個人データは今回のcommit対象外です。
