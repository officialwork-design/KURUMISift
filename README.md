# KURUMI Shift

くるみ株式会社の社員が LINE から利用できる、社内向けシフト・代休管理アプリ（初期版）。

## プロジェクト概要

### 目的
社員が LINE LIFF から、休日出勤申請・代休申請を行い、管理者が承認・却下する一連の勤怠管理を実現します。基本勤務は月〜金、土日祝は原則休日です。通常勤務時間の初期値は 10:00〜19:00（設定シートで変更可）。

### 社員向け機能
- LINE LIFF による社員識別（IDトークン検証）
- 初回の本名登録（LINE表示名ではなく社内で使う本名）
- ホーム（今月の勤務日数・代休残数・申請中件数・期限が近い代休）
- 月間勤務カレンダー（通常勤務／休日／休日出勤／代休／有給／申請中を色分け）
- 休日出勤申請
- 代休申請（利用可能な代休から選択）
- 自分の申請履歴（絞り込み）
- 自分の代休残数

### 管理者向け機能
- ダッシュボード（本日の出勤/休暇者、未承認申請、未取得・期限間近・期限切れ代休）
- 全社員一覧・社員情報編集・有効/停止/退職の切り替え
- 申請一覧・承認・却下（承認時に代休を自動付与）
- 代休台帳（全件／未取得／期限切れ）
- 設定画面
- 操作ログ閲覧

### 初期版の対象範囲
LINE 識別・本名登録・カレンダー・休日出勤/代休申請・承認/却下・代休自動付与・スプレッドシート保存・LINE通知基盤。

### 対象外機能
出退勤打刻、GPS、顔認証、給与計算、残業計算、有給残数の厳密管理、半日/時間単位代休、複数段階承認、AI自動シフト、他社勤怠連携、Googleカレンダー個人予定登録、チャット、ファイル添付、勤務交代募集。

## システム構成

```
社員 → LINE公式アカウント → LINE LIFF → HTML/CSS/JS
        → Google Apps Script Web アプリ → Google Spreadsheet
```

社員用画面（`liff/`）と管理者用画面（`admin/`）は静的ファイルとして配信します（例: GitHub Pages）。両画面とも LINE ログインで取得した IDトークンを GAS Web アプリ（JSON API）へ送信し、GAS 側で検証・権限判定を行ってからスプレッドシートを読み書きします。権限（`role=admin`）と状態遷移の最終判定は必ず GAS 側で実施します。

## 必要な外部サービス
GitHub / Google Apps Script / Google Spreadsheet / LINE Developers / LINE公式アカウント（Messaging API）/ LIFF。

## セットアップ手順

1. リポジトリをクローンする。
2. clasp をインストールする。
3. GAS プロジェクトへ接続する。
4. スクリプトプロパティを設定する。
5. GAS エディタで `setupSpreadsheet()` を実行する。
6. `createInitialAdmin()` で初期管理者を設定する（または初回登録で自動設定）。
7. Web アプリをデプロイする。
8. 取得した Web アプリ URL を `GAS_WEB_APP_URL` と、フロントの `API_URL` に設定する。
9. LINE Developers で LIFF アプリを作成する。
10. LIFF エンドポイント URL に静的配信した `liff/` の URL を設定する。
11. LINE公式アカウントのリッチメニュー等に LIFF リンクを設置する。
12. 実機で初回社員登録を確認する。

```bash
git clone https://github.com/officialwork-design/KURUMISift.git
cd KURUMISift
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json
clasp pull   # 既存GASの内容を確認（上書き前に必ず確認）
clasp push
```

`.clasp.json` は Git 管理しません（`.gitignore` 済み）。マニフェストは `gas/appsscript.json` を使用します（`rootDir` が `gas`）。

## スクリプトプロパティ

実際の値はここには記載しません。GAS の「プロジェクトの設定 → スクリプト プロパティ」で設定します。

| プロパティ名 | 用途 | 取得元 |
|---|---|---|
| `SPREADSHEET_ID` | 保存先スプレッドシートID | スプレッドシートURL |
| `LIFF_ID` | LIFF 初期化用ID | LINE Developers（LIFF） |
| `LINE_CHANNEL_ID` | IDトークン検証用（LINEログインチャネルID） | LINE Developers（LINEログイン） |
| `LINE_CHANNEL_ACCESS_TOKEN` | プッシュ通知用トークン | LINE Developers（Messaging API） |
| `GAS_WEB_APP_URL` | デプロイ後のWebアプリURL | GAS デプロイ |
| `INITIAL_ADMIN_LINE_USER_ID` | 初期管理者のLINEユーザーID | 管理者本人のLINEユーザーID |
| `APP_ENV` | 環境（development / production） | 運用者が設定 |

> `LINE_CHANNEL_ID` は IDトークンの検証（`aud`）に使う **LINEログインチャネルのID**、`LINE_CHANNEL_ACCESS_TOKEN` はプッシュ送信に使う **Messaging API チャネルのトークン** です。両者は別チャネルになることがあります。

## GAS デプロイ手順
- 実行ユーザー: 「自分（デプロイしたユーザー）」（`USER_DEPLOYING`）。
- アクセス権: 「全員（匿名を含む）」。※認証は IDトークンで別途行います。
- 新しいデプロイの作成: GASエディタ →「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」。
- Web アプリ URL の取得: デプロイ完了画面の `/exec` で終わる URL。
- コード更新後の再デプロイ: 「デプロイを管理」→ 既存デプロイを編集し「新しいバージョン」を選んで更新（URLは維持されます）。
- デプロイURL（`/exec`）はアプリ実行用、スクリプト編集URL（`script.google.com/...`）は開発用で別物です。フロントの `API_URL` には必ず `/exec` を設定します。

## LINE 設定手順
1. LINE Developers でプロバイダーを作成。
2. 「LINEログイン」チャネルを作成 → `LINE_CHANNEL_ID` を控える。
3. そのチャネルで LIFF アプリを作成 → `LIFF_ID` を控える。
4. LIFF のエンドポイント URL に、静的配信した `liff/index.html` の URL を設定。
5. LIFF の scope に `profile` と `openid` を付与（IDトークンに表示名/画像を含めるため）。
6. 「Messaging API」チャネルを作成/連携 → チャネルアクセストークン（長期）を発行し `LINE_CHANNEL_ACCESS_TOKEN` に設定。
7. 上記IDやトークンを GAS のスクリプトプロパティへ登録。

## スプレッドシート構成

`setupSpreadsheet()` が以下のシートとヘッダーを自動生成します（既存データは破壊しません）。列順は固定です。

- 社員マスター: `employee_id, line_user_id, line_display_name, line_picture_url, real_name, department, role, status, created_at, updated_at, last_login_at`
- 申請一覧: `request_id, employee_id, request_type, target_date, start_time, end_time, reason, preferred_compensatory_date, selected_leave_id, remarks, status, rejection_reason, approved_by, requested_at, approved_at, updated_at`
- 代休台帳: `leave_id, employee_id, holiday_work_request_id, work_date, granted_days, expiration_date, used_date, compensatory_request_id, status, created_at, updated_at`
- 勤務カレンダー: `schedule_id, employee_id, work_date, work_type, start_time, end_time, request_id, remarks, created_at, updated_at`
- 設定: `setting_key, setting_value, description, updated_at`
- 操作ログ: `log_id, actor_employee_id, action_type, target_type, target_id, before_data, after_data, created_at`

値の例: `role`=employee/admin、`status`(社員)=active/suspended/retired、`request_type`=holiday_work/compensatory_leave、`status`(申請)=pending/approved/rejected/cancelled、`status`(代休)=available/pending/used/expired/cancelled、`work_type`=regular_work/holiday/holiday_work/compensatory_leave/paid_leave/absence。`before_data`/`after_data` は JSON 文字列。

### 設定シート初期値
`REGULAR_WORK_DAYS=MON,TUE,WED,THU,FRI`、`REGULAR_START_TIME=10:00`、`REGULAR_END_TIME=19:00`、`COMP_LEAVE_EXPIRY_DAYS=60`、`TIMEZONE=Asia/Tokyo`、`APP_NAME=KURUMI Shift`。

## 運用手順
- 社員登録: 社員が LIFF を開き、本名を入力して登録。
- 管理者設定: `INITIAL_ADMIN_LINE_USER_ID` の社員は初回登録時に自動で管理者。既存社員は管理画面の社員編集で `role=admin` に変更。
- 休日出勤申請: 社員が対象日・時刻・理由等を入力して申請 → 管理者へ通知。
- 代休申請: 社員が利用可能な代休を選択して申請 → 管理者へ通知。
- 承認・却下: 管理者が申請一覧から処理。休日出勤承認で代休を1日付与、代休承認で対象代休を使用済みに。
- 退職者・停止ユーザー対応: 社員編集で `status` を suspended / retired に変更（以降ログイン不可）。
- 代休期限通知: `installExpiryTrigger()` を一度実行すると、毎日 `sendCompensatoryLeaveExpiryNotifications()` が動作し、期限14日前・7日前に本人へ通知（重複送信防止）。

## トラブルシュート
- LIFF起動中から進まない: `config.js` の `API_URL`/`LIFF_ID`、GASの `LIFF_ID` を確認。初期化はタイムアウト後にエラー画面と再読み込みボタンを表示します。
- LIFF ID不一致: LINEログインチャネルのLIFF IDと `LIFF_ID` が一致しているか確認。
- GAS WebアプリURLが違う: `API_URL` が `/exec` で終わっているか、最新デプロイのURLか確認。
- 権限エラー: 管理画面は `role=admin` の社員のみ。社員編集で権限を確認。
- スプレッドシートへ保存されない: `SPREADSHEET_ID` と `setupSpreadsheet()` 実行、ヘッダー不足がないか確認。
- LINE通知が届かない: `LINE_CHANNEL_ACCESS_TOKEN`（Messaging API）と、相手が公式アカウントを友だち追加済みか確認。通知失敗でも承認データは保存されます。
- 初期管理者として認識されない: `INITIAL_ADMIN_LINE_USER_ID` が本人のLINEユーザーIDか確認し、`createInitialAdmin()` を実行。
- clasp pushでエラー: `clasp login` 済みか、`.clasp.json` の `scriptId`/`rootDir` を確認。既存ファイルは `clasp pull` で確認してから統合。

## テスト

純粋関数（`gas/Util.gs`）の回帰テストを Node で実行できます。

```bash
node tests/pure.test.js
```

GAS 上では `Tests.gs` の `runAllTests()` を実行してログで結果を確認します。シートを伴う結合テストはテスト用スプレッドシートで手動確認してください（手順は `AGENTS.md` 参照）。

## ディレクトリ構成
`liff/`（社員用フロント）、`admin/`（管理者用フロント）、`gas/`（Apps Script）、`tests/`（純粋関数テスト）、`appsscript.json`/`gas/appsscript.json`（マニフェスト）、`.clasp.json.example`、`AGENTS.md`。

## セキュリティ
アクセストークン・シークレット・個人情報はソース／README／コミット履歴へ含めません。認証は IDトークン検証で行い、クライアントの LINEユーザーIDを無検証で信用しません。社員入力は数式注入対策（先頭 `= + - @` を無効化）と HTML エスケープを行います。