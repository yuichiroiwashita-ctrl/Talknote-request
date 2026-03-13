# Apps Script 実装ガイド

## 1. 事前準備

### 必須 Script Properties

- `TALKNOTE_TOKEN`: Talknote APIアクセストークン
- `MASTER_SPREADSHEET_ID`: メンバー一覧があるスプレッドシートID
- `MASTER_MEMBER_SHEET_NAME`: 例 `メンバー一覧`
- `REQUEST_SPREADSHEET_ID`: リクエスト管理データを書き込むスプレッドシートID

### 推奨 Script Properties

- `TIMEZONE`: `Asia/Tokyo`
- `ADMIN_USER_IDS`: 管理者 user_id をカンマ区切りで指定
- `TALKNOTE_RETRY_COUNT`: 通知APIの再試行回数（例: `3`）
- `TALKNOTE_RETRY_WAIT_MS`: 再試行の基本待機ms（例: `700`）

## 2. 管理スプレッドシート

`REQUEST_SPREADSHEET_ID` に次シートを用意（初回実行時にヘッダー自動作成）:

- `requests`
- `responses`
- `deadline_extensions`
- `completions`

## 3. APIアクション

`POST` JSON の `action` で切り替えます。

- `create_request`
- `respond_request`
- `request_deadline_extension`
- `respond_deadline_extension`
- `report_completion`
- `close_request`（依頼者が完了確定）
- `cancel_request`（依頼者取り下げ）
- `admin_delete_request`（管理者論理削除）
- `list_requests`（送信/受信/全体）
- `get_kpi`（overall/user/department）
- `list_talknote_groups`（投稿先ノート選択用）

## 4. 権限ルール

- 全ユーザー: 作成、送受信一覧閲覧
- 担当者: 回答、期日変更申請、完了報告
- 依頼者: 期日変更承認、取り下げ、完了確定
- 管理者: 全体閲覧・削除（`ADMIN_USER_IDS`）

## 5. KPI定義

- `completion_rate`: 完了数 / 総数
- `in_time_completion_rate`: 期限内完了数 / 総数
- `overdue_count`: 期限超過かつ未完了

## 6. 通知の安定化

Talknote通知は `callTalknoteApi_` で再試行を実施します。
HTTP 2xx 以外は `TALKNOTE_RETRY_COUNT` 回までリトライします。
