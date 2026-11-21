# 家庭點點樂

家庭任務與獎勵 App（iPhone 加入主畫面使用）。前端是 React + Vite，放在 GitHub Pages；資料、登入、推播排程在 Supabase。

- `src/`：網頁 App
- `supabase/migrations/`：資料庫表格、點數規則、推播排程
- `supabase/functions/`：`admin`（建立家庭與成員帳號）、`send-push`（送 Web Push）
- 推送到 `main` 後，GitHub Actions 會自動建置並發布到 Pages
