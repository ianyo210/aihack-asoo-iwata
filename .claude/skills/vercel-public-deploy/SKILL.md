---
name: vercel-public-deploy
description: Node 製の小さなアプリ（静的ファイル＋api/ の関数）を、Vercel に公開デプロイし、環境変数を反映させる。「デプロイして」「スマホで使えるように」「環境変数が反映されない」と言われたら使う。マイクは HTTPS 必須なので、スマホで録音するアプリは必須。
---

# Vercel に、公開デプロイする

## 前提
- ブラウザのマイクは、**HTTPS 必須**（`localhost` のみ例外）。スマホで録音するなら、Vercel 等への公開が要る。
- 鍵（API キー）は、**ユーザーが Vercel の画面で直接入力**する。チャットに貼らせない・コードやログに書かない。`.env` は gitignore のまま。Vercel は、リポジトリの `.env` を読まない。

## 詰まりどころと対処
| 症状 | 原因 | 対処 |
| --- | --- | --- |
| 公開 URL が、Vercel のログイン画面に飛ぶ | Deployment Protection（SSO）が有効 | 公開したいなら、保護をオフにする（ユーザーに確認） |
| 静的ファイルが 404 | フレームワークが `node` と、自動判定された | プロジェクトの framework / buildCommand / outputDirectory を `null` にして、再デプロイ |
| 環境変数を入れたのに反映されない | 再デプロイするまで、反映されない。**デプロイ ID からの再デプロイは、古い環境変数を引き継ぐ** | `main`（git ソース）から、新しくデプロイする |
| `Environment Variables` が見当たらない | 画面の場所 | Settings の中の、左メニュー（Environments の近く） |

## 環境変数の名前（このリポジトリの場合）
- `AQUA_API_KEY`（必須・文字起こし）／`GEMINI_API_KEY`（任意）／`OPENROUTER_API_KEY`・`OPENROUTER_MODEL`（任意。あれば Gemini より優先）。
- 判定は、どれか1つだけ選ぶ作り。失敗したら辞書ルールに落ちる（他の AI には戻らない）。

## 確認
1. 公開 URL の主要ページが 200 か。
2. 設定状態を返す API（例: `/api/transcribe` が `aquaConfigured: true`）。
3. 録音 → 文字起こし → 登録を、一度通す。
4. `main` に push すると、自動で再デプロイされる。**本番直前は、動いている状態を崩さない**（キーの差し替えは、リスクがある）。

## 公開後の注意
- 誰でも使えると、API の利用量・料金がかかる。記事に、「利用量に限りがある」と書く。
