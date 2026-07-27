# AGENTS.md

このリポジトリを Codex / Claude Code 等のエージェントが保守するためのガイド。

## プロジェクトの目的
くるみ株式会社の社内向けシフト・代休管理アプリ（初期版）。LINE LIFF で社員を識別し、休日出勤・代休の申請と管理者承認、代休の自動付与を行う。給与計算・打刻・GPS・顔認証・残業計算は対象外（詳細は README「対象外機能」）。

## フォルダ構成
- `liff/` … 社員用フロント（Vanilla HTML/CSS/JS）。`js/config.js`（公開設定のみ）、`liff-client.js`（LIFF初期化）、`api.js`（GAS通信）、`state.js`（状態）、`ui.js`（描画）、`app.js`（遷移）。
- `admin/` … 管理者用フロント。`js/api.js`（LIFF認証+通信）、`js/admin.js`（UI/操作）。設定は `index.html` 内 `window.ADMIN_CONFIG`。
- `gas/` … Apps Script。`Code.gs`(doGet/doPost) / `Api.gs`(ルーター) / `Config.gs`(定数・スキーマ・プロパティ) / `Util.gs`(純粋関数) / `SheetService.gs`(シートI/O・設定) / `EmployeeService.gs` / `RequestService.gs` / `LeaveService.gs` / `ScheduleService.gs` / `LineService.gs`(通知・トークン検証) / `LogService.gs`(ログ) / `Setup.gs`(初期化・トリガー) / `Tests.gs`。マニフェストは `gas/appsscript.json`。
- `tests/` … `pure.test.js`（Nodeで実行する純粋関数テスト）。

## 使用技術
Vanilla HTML/CSS/JavaScript と Google Apps Script（V8）。TypeScript・ビルドツール・外部CSSフレームワークは導入しない。デプロイは clasp。

## 秘密情報の取り扱い
- アクセストークン・シークレット・スプレッドシートID等は **すべてスクリプトプロパティ**から取得（`gas/Config.gs` の `PROP` / `getProp` / `requireProp`）。コードへ直書きしない。
- フロントの `config.js` / `ADMIN_CONFIG` には **公開してよい値のみ**（`LIFF_ID`, `API_URL`）。
- `.clasp.json` と `.env` はコミットしない（`.gitignore` 済み）。テストデータに実在の個人情報を使わない。

## スプレッドシートの列変更ルール
- 列定義は `gas/Config.gs` の `SCHEMA` が唯一の正。**列番号をサービスにハードコードしない**（`SheetService` の `colIndex`/`rowToObject` でヘッダー名から解決）。
- 列を追加する場合: `SCHEMA` に追記 → `setupSpreadsheet()` で既存シートにヘッダーが補完されることを確認 → 参照コードを更新。既存列の順序変更・削除は互換性を壊すため避ける。
- 破壊的処理を初期化に入れない（`ensureSheetsAndHeaders` は非破壊）。

## GASサービス層の責務
- `EmployeeService`: 社員検索・登録・更新・権限/在籍判定。
- `RequestService`: 申請作成・一覧・承認・却下・重複/状態遷移検証。承認/却下はロック内で状態を再確認。
- `LeaveService`: 代休の付与・利用可能一覧・申請中/使用済み/復帰・期限判定・古い順ソート。付与は `holiday_work_request_id` で冪等。
- `ScheduleService`: 月間予定生成・通常勤務/休日算出・祝日判定（Googleの日本の祝日カレンダー、失敗時は土日フォールバック）。
- `SheetService`: シートI/O・排他制御（`LockService`）・設定アクセサ。
- `LineService`: プッシュ通知・IDトークン検証。通知失敗は本処理を止めない。
- `LogService`: 操作/エラーログ、JSONの安全な文字列化。

## UI変更ルール
- 白基調・緑アクセント。タップ領域44px以上、本文14px以上。状態は**色＋テキスト**で表現（色のみに依存しない）。スマホ幅優先・横スクロールを避ける。
- ユーザー入力を **必ずエスケープ**してから DOM へ挿入（`UI.esc` / `admin.esc`）。`innerHTML` に生値を入れない。
- 「起動中から進まない」状態を作らない。初期化・通信にはタイムアウトと再試行手段を設ける。

## 権限チェックルール
- 認証はサーバ（GAS）で IDトークンを検証して確立（`LineService.verifyIdToken`）。クライアントの `line_user_id` を無検証で信用しない。
- 社員スコープのAPIはセッションの `employee_id` のみを使い、payload の他人IDを参照しない。
- 管理APIは `requireAdmin` を必ず通す。フロントの表示制御だけに依存しない。
- 停止/退職(`status!=active`)は `assertActive` で拒否。

## 状態遷移ルール
- 申請: `pending → approved | rejected`。承認/却下は `pending` のみ許可（`_assertPending`）。再承認・二重承認は不可。
- 代休: `available → pending → used`、却下時 `pending → available`、期限超過 `available → expired`。同じ代休を複数申請に使わせない（`setLeavePending` は `available` のみ許可）。
- 休日出勤承認 → 勤務カレンダーへ `holiday_work` 登録＋代休1日付与（冪等）。代休承認 → 対象代休 `used`＋カレンダーへ `compensatory_leave` 登録。
- 状態・種別の文字列は `Config.gs` の定数、APIアクション名は `ACTIONS` を使う（直書き禁止）。

## README更新必須ルール
機能・スキーマ・プロパティ・デプロイ/設定手順・運用に影響する変更を行ったら、**同じコミットで README.md を更新**する。`Util.gs` の純粋関数ロジックを変えたら `tests/pure.test.js` の写しも更新する。

## 無関係な大規模リファクタリング禁止
指示された範囲を超える大規模な作り替え・依存追加・対象外機能の追加は行わない。既存の構成・命名・責務分担を尊重する。

## コミット前の確認項目
1. 秘密情報がソース/差分に含まれていない（`grep -RniE "access_token|secret|Bearer " -- . ` 等で確認）。
2. `node tests/pure.test.js` が pass。
3. GAS 変更時は構文確認（`.gs` を一時的に `.js` にして `node --check`、または clasp push でエラーが出ないこと）。
4. `SCHEMA` 変更時は `setupSpreadsheet()` の非破壊性を確認。
5. 影響範囲に応じて README.md を更新済み。
6. `.clasp.json` / `.env` をコミットしていない。
