# Talknote Request Management

社内のリクエスト運用（依頼・回答・期日変更・完了）を管理し、Talknoteノートへの通知を自動化する実装です。

## 構成

- `apps-script/Code.js`: API本体（Google Apps Script）
- `apps-script/README.md`: Apps Scriptセットアップ
- `frontend/index.html`: GitHub Pages向け最小UI
- `frontend/app.js`: UIからApps Script APIを呼び出すスクリプト

## 今回の実装ポイント

- 全機能フロー（作成/回答/延長申請/承認/完了報告/完了確定/取り下げ/管理者削除）
- Talknote投稿先をノート一覧から選択して紐付け
- 以降のイベント通知は同一ノートへ投稿
- KPI（個別/部署別/全社）で期日内完了率を評価
- Talknote通知のリトライ実装（運用安定性を優先）

## GitHub Pages運用

1. `frontend/` を GitHub Pages で配信
2. 画面上部で Apps Script Web App URL を入力
3. 「Talknoteノート一覧を取得」で投稿先ノートを選択
4. 各フォームからAPIを実行

## 注意

- Talknoteトークンや管理者IDは Script Properties に設定してください。
- OAuthのクライアント情報はコードに直書きせず、運用環境側の安全な設定で管理してください。
