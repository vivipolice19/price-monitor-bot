# eBay最安値プライスチェッカー

## Overview

eBayセドリ向けの価格監視・在庫管理連携ツール。

## Features

1. **価格リサーチ** — eBay商品URLを入力し、同一商品のコンディション別（新品/良品など）最安値を取得
2. **価格監視リスト** — 監視したいURLと自分の出品価格を登録し、自動で定期チェック（15分ごと）
3. **プライスアラート** — 競合価格が自分より安くなったらアラートを生成
4. **Googleスプレッドシート連携** — 在庫管理シートの指定列に自動でアラート書き込み・価格変更フラグ
5. **eBay API & スクレイピング** — eBay App IDがあればAPI経由、なければHTMLスクレイピングで取得

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + TailwindCSS
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Scheduler**: node-cron (15分間隔の自動価格チェック)
- **Scraping**: axios + cheerio (eBay)
- **Sheets**: googleapis (Google Sheets API v4)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## API Setup (設定ページ)

### eBay API
- 設定ページからeBay App ID / Cert IDを入力して保存
- APIキーなしの場合はHTMLスクレイピングで動作（制限あり）

### Google Sheets
1. GoogleスプレッドシートのSpreadsheet IDを入力
2. シート名（在庫管理シートのシート名）を入力
3. アラート書き込み列・価格変更列のインデックスを設定
4. Google Cloud ConsoleでService AccountのJSONキーを作成し貼り付け
5. 「接続テスト」で確認後、「今すぐ同期」で手動同期可能

## DB Tables

- `monitors` — 監視中のeBay商品リスト
- `price_history` — 価格履歴
- `alerts` — 価格アラート
- `spreadsheet_config` — スプレッドシート設定

## Artifacts

- `ebay-price-checker` — React+Vite フロントエンド (previewPath: /)
- `api-server` — Express APIサーバー (previewPath: /api)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
