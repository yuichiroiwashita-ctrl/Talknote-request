# Talknote Request Management (Apps Script)

社内リクエスト運用（依頼・回答・期限変更申請・承認/非承認・完了報告）を Web で管理し、Talknote へ通知投稿するための Google Apps Script 実装です。

## できること

- リクエスト作成
- 受信者の回答（Yes / No / 条件付きYes）
- 期限変更申請
- 期限変更申請への承認 / 非承認
- 完了報告（テキスト + 任意のファイルURL）
- KPI 集計（達成率、期限超過、期限前の延長申請率）
- Talknote DM / ノートへ通知投稿
- メンバー一覧を指定スプレッドシートから参照

## ディレクトリ

- `apps-script/Code.js`: Apps Script バックエンド本体
- `apps-script/README.md`: デプロイ手順・API仕様

## 想定アーキテクチャ

1. フロントエンド（任意の Web UI）から Apps Script Web アプリに JSON を POST。
2. Apps Script が Google スプレッドシートに状態を保存。
3. イベントごとに Talknote API (`dm/post` または `group/post`) へ通知。
4. KPI は Apps Script で集計可能。

> 注意: Talknote API トークンは **Script Properties** に保存し、ソースコードへ直書きしないでください。

## GitHubに反映する手順

このリポジトリは初期状態では `remote` が未設定の場合があります。以下の手順で GitHub へ反映できます。

1. リモート設定確認

```bash
git remote -v
```

2. `origin` を追加（未設定の場合のみ）

```bash
git remote add origin <GitHubリポジトリURL>
```

3. 変更をコミット

```bash
git add .
git commit -m "your message"
```

4. ブランチを push

```bash
git push -u origin work
```

5. GitHubで Pull Request 作成

- `work` ブランチから `main`（または運用ブランチ）へ PR を作成
- タイトルと説明に「目的」「変更点」「テスト結果」を記載

## Apps Scriptを動かす手順（最短）

1. `apps-script/Code.js` を Apps Script プロジェクトに貼り付け
2. Script Properties に以下を設定
   - `TALKNOTE_TOKEN`
   - `MASTER_SPREADSHEET_ID`
   - `MASTER_MEMBER_SHEET_NAME`（例: `メンバー一覧`）
   - `REQUEST_SPREADSHEET_ID`
   - （任意）`TALKNOTE_POST_MODE`、`TALKNOTE_DESTINATION_ID`、`TIMEZONE`
3. Web アプリとしてデプロイ
4. `action=create_request` などの JSON を `POST` して動作確認
