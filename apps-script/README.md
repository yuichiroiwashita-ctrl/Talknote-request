# Apps Script 実装ガイド

## 1. 事前準備

### 必須 Script Properties

- `TALKNOTE_TOKEN`: Talknote APIアクセストークン
- `MASTER_SPREADSHEET_ID`: メンバー一覧があるスプレッドシートID
- `MASTER_MEMBER_SHEET_NAME`: 例 `メンバー一覧`
- `REQUEST_SPREADSHEET_ID`: リクエスト管理データを書き込むスプレッドシートID

### 任意 Script Properties

- `TALKNOTE_POST_MODE`: `dm` or `group`（デフォルト `group`）
- `TALKNOTE_DESTINATION_ID`: 投稿先ID（dm_id または group_id）
- `TIMEZONE`: デフォルト `Asia/Tokyo`

## 2. 管理スプレッドシートに必要なシート

`REQUEST_SPREADSHEET_ID` 側に次のシートを用意してください。

- `requests`
- `responses`
- `deadline_extensions`
- `completions`

初回実行時、ヘッダーは自動作成されます。

## 3. Webアプリ公開

1. Apps Script エディタで `Code.js` を配置
2. デプロイ > 新しいデプロイ > 種類: ウェブアプリ
3. 実行ユーザー: 自分
4. アクセス権: 必要に応じて制限

## 4. API仕様

`POST` の JSON ボディで `action` を指定します。

### 4.1 リクエスト作成

```json
{
  "action": "create_request",
  "requester_user_id": "1001",
  "assignee_user_id": "2001",
  "title": "資料作成",
  "description": "4Q向け提案資料を作成してください",
  "due_at": "2026-03-20T10:00:00+09:00",
  "reason": "経営会議で必要なため"
}
```

### 4.2 回答

```json
{
  "action": "respond_request",
  "request_id": "REQ-20260301-001",
  "responder_user_id": "2001",
  "response_type": "yes",
  "message": "分かりました"
}
```

`response_type`: `yes` / `no` / `conditional_yes`

### 4.3 期限変更申請

```json
{
  "action": "request_deadline_extension",
  "request_id": "REQ-20260301-001",
  "applicant_user_id": "2001",
  "proposed_due_at": "2026-03-25T18:00:00+09:00",
  "reason": "検証に追加日程が必要なため"
}
```

### 4.4 期限変更の承認/非承認

```json
{
  "action": "respond_deadline_extension",
  "extension_id": "EXT-20260305-001",
  "request_id": "REQ-20260301-001",
  "approver_user_id": "1001",
  "approved": true,
  "message": "承認します"
}
```

### 4.5 完了報告

```json
{
  "action": "report_completion",
  "request_id": "REQ-20260301-001",
  "reporter_user_id": "2001",
  "message": "完了しました",
  "artifact_urls": ["https://example.com/doc1", "https://example.com/doc2"]
}
```

### 4.6 KPI取得

```json
{
  "action": "get_kpi",
  "from": "2026-03-01T00:00:00+09:00",
  "to": "2026-03-31T23:59:59+09:00"
}
```

## 5. KPI定義

- `total_requests`: 期間内作成リクエスト数
- `completed_requests`: 完了報告済みリクエスト数
- `completion_rate`: `completed_requests / total_requests`
- `overdue_count`: 現在時刻時点で期限切れかつ未完了
- `extension_requested_before_due_count`: 期限前に延長申請できた件数
- `extension_before_due_rate`: `extension_requested_before_due_count / extension_request_count`

## 6. Talknote通知

イベント発生時に `postTalknoteMessage_` が呼ばれ、Script Properties の設定に応じて
`/api/v1/dm/post` または `/api/v1/group/post` へ投稿されます。
