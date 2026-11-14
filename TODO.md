# TODO — 社區版（無後端）上線前

> 工作筆記，對應 PR「On-chain community edition」。全部完成後請刪除這個檔案。
> 相關 PR：mobile-app 與 BackendServer 的同名分支 `claude/awesome-ritchie-i1bwnp`。

已通過：`npm test`（45 個）、`npm run typecheck`、`npm run lint`（0 錯誤）、有後端與無後端兩種 `npm run build`、Chromium 自動化流程。
安裝要用 `npm ci --legacy-peer-deps`。
**沒驗過**：送交易、真實 Privy 登入、Chromium 以外的瀏覽器。

2026-11-13 在本機 `npm run dev`（無後端、無任何金鑰）用真實 Base RPC 走過一輪，用的是比對腳本的參考助記詞（`abandon … about`）。下面標「已驗」的項目就是這一輪；沒標的部分還沒人做過。

## 1. 瀏覽器驗證（`NEXT_PUBLIC_BACKEND_URL` 留空）

- [x] 建立錢包 → 顯示 12 字 → 設密碼 → 進 dashboard，**Safe 地址有算出來**（需要能連 Base RPC）
      沒勾「已備份」不能繼續；建立與匯入兩條路徑都算得出 Safe 地址
- [x] 匯入助記詞／私鑰；重新整理後要求密碼解鎖；錯誤密碼被拒
      參考助記詞與它推導出的私鑰匯入後是同一個地址（EOA `0x9858…da94`、Safe `0xf78B…984B`，與比對腳本相同）
- [ ] 送一筆小額 USDC、做一次 Swap（需要 `NEXT_PUBLIC_PIMLICO_API_KEY`）
- [ ] Morpho Earn、Borrow 各走一次
- [ ] Treasury：建立、送出提案、Approvals 簽核與執行、Team 新增／移除 owner
      已驗：建立（取得 counterfactual 地址）、重新整理後清單還在。其餘需要鏈上交易，未驗
- [x] 設定 → 顯示助記詞／私鑰（需再輸入密碼）；移除錢包（需密碼）
      輸入密碼後顯示 12 字，「Hide」會收起；移除後回到歡迎畫面。「Show private key」按鈕沒有點過
- [x] 解鎖畫面「忘記密碼」→ 移除 → 用助記詞重新匯入，Treasury 清單還在
      要先勾選「我有備份」才能移除；同一個錢包重新匯入（換新密碼）後清單還在。匯入另一個錢包時清單會清空，這是原本的設計
- [ ] 15 分鐘無操作自動上鎖；另一個分頁移除錢包時本分頁同步上鎖
      已驗：另一個分頁移除錢包後，已解鎖的分頁立刻回到歡迎畫面。15 分鐘自動上鎖未驗
- [ ] Safari、Firefox 各跑一次建立與解鎖
      2026-11-13 另外在真的 Chrome（157，透過 Claude 擴充功能）跑過一輪 smoke test：建立錢包、重新整理後解鎖、錯誤密碼被拒、選單上鎖、忘記密碼移除；Earn／Borrow／Markets 列表與詳情、Treasury、Approvals、Team、Report、加值（QR 解碼與顯示地址相符）、轉帳各頁都載入；沒有請求送往 Privy、後端或 Plaid，也沒有 console 錯誤。Safari、Firefox 仍未跑
- [x] DevTools Network：沒有任何請求送往 Privy、後端或 Plaid
      走過 Home、Add Money、Treasury、Approvals、Team、Markets、Borrow、Security；只連到 Base RPC、Blockscout、Morpho、CoinGecko、Safe Transaction Service

## 2. 地址一致性

- [ ] 同一組助記詞在手機與網頁顯示同一個 Safe 地址
- [x] 比對腳本在 mobile-app：`node scripts/safe-address-parity.cjs ../WebClients https://mainnet.base.org`
      2026-11-13 對 Base 主網跑過，兩個 repo 的三種推導都是 `0xf78B124D0f676153b37b7852658B5000b390984B`；網頁實際顯示的也是這個地址
- [ ] 舊用戶：從 home.privy.io 匯出私鑰 → 匯入 → Safe 地址與原本相同

## 3. 有後端的模式（自架者會用到）

- [ ] 設定後端 URL 與 Privy app id 後，用真實 Privy 帳號登入，各頁行為和改動前一樣（目前只用模擬資料比對過 20 個路由）

## 4. 發佈

- [ ] 合併時 squash：分支上有三個標成 WIP 的中間 commit
- [ ] `deploy.yml` 仍會帶入 `NEXT_PUBLIC_BACKEND_URL`、`LIFI_INTEGRATOR=kura`、`LIFI_FEE=0.25` 與 Stripe price id：清空後端 URL 再部署，並決定是否保留 Li.Fi 抽成
- [x] `proxy.ts` 的 CSP 仍寫死 `app.kura-finance.com`／`api.kura-finance.com` 並允許 Privy、Plaid 網域；社區版可以收緊
      無後端時不再放行 Privy、Plaid、Reown／WalletConnect、Coinbase SDK、Cloudflare 與 Kura API；寫死的 kura-finance 網域已拿掉（有後端時改用 `NEXT_PUBLIC_APP_URL`／`NEXT_PUBLIC_API_URL` 與後端 URL 的 origin）。有後端的 CSP 沒有實測

## 5. 之後再做

- [x] `react-hooks/set-state-in-effect` 已在 `eslint.config.mjs` 降為警告：38 處「掛載時在 effect 裡載入資料」的寫法仍待改寫（專案已有 `@tanstack/react-query`），改完後把規則調回 error
      規則已調回 error。資料載入統一走 `app/hooks/useLoad.ts`（包 react-query）；兌換與跨鏈報價走 `useSwapQuote`／`useBridgeQuote`，只回傳與目前輸入完全相符的報價。無後端用得到的頁面都在瀏覽器看過會載入；**報價本身沒有實測**（測試錢包沒有餘額，觸發不了），有後端才有的頁面（TrackFi、股票、Plaid、候補名單）只過了型別檢查與 build
- [x] 開發模式每頁都跳 hydration 警告（「1 Issue」）：主題腳本在 hydrate 前替 `<html>` 加上 `dark`，class 與伺服器輸出不同
      `app/layout.tsx` 的 `<html>` 加上 `suppressHydrationWarning`；Chrome 重新載入後警告消失，深色主題照常套用
- [x] 歷史紀錄其實一直是空的：`base.blockscout.com/api` 對所有 API 請求回 Cloudflare 驗證頁（瀏覽器直接開也一樣），而原本的程式把非 200 當成「沒有交易」，所以首頁、Treasury、Report、歷史頁都顯示「No transactions yet」而不報錯（做 mobile-app 的模擬器測試時發現的）
      改用 `app/lib/chain/walletTransfers.ts`：Safe Transaction Service 的索引紀錄，加上 Base RPC 的 Transfer 事件補「還沒部署的錢包」與索引延遲。細節與限制見 mobile-app 的 TODO.md；這個檔案與 mobile-app 的 `src/lib/chain/walletTransfers.ts` 完全相同，改一邊要同步另一邊。已在瀏覽器驗過：一個有 5 筆轉帳的公開 Safe 能正確列出收付款，console 沒有錯誤
      順帶：Safe Transaction Service 的網址改成它現在的位置 `api.safe.global/tx-service/base`（舊網址會轉址過去），CSP 拿掉不再使用的 Blockscout。Treasury 的 Approvals／提案也走這個網址，**送出提案沒有實測**
- [ ] 銀行出入金（Bridge）還有 4 處 effect 保留原樣，就地加了 `eslint-disable` 與說明：`AddMoneyView` 2 處、`MakePaymentView` 的銀行付款 2 處。它們會在伺服器端建立虛擬帳戶／付款地址，沒有後端沙盒無法驗證，所以沒有改寫

- [x] 有後端時 Treasury 的伺服器同步沒有在跑：`useOrgStore` 的 `onRehydrateStorage` 在 store 建立期間引用自己而丟錯，載入旗標永遠不會完成
      改用 persist 的 `merge`，不再引用 store 本身；舊版 `kura-org-banking-v7` 的搬遷在瀏覽器驗過。**有後端時同步是否真的恢復沒有實測**（需要後端）
- [x] 加值頁的 QR code 由 `api.qrserver.com` 產生，會把錢包地址送給第三方；改成本地產生
      新增 `uqr` 依賴，在瀏覽器畫成 SVG（`app/components/ui/QrCode.tsx`）；已確認掃得出正確地址
- [x] 沒有 Pimlico key 就不能送交易（`lib/smartAccountSend.ts`）；手機有公用 bundler + ETH gas 備援，可以補齊
      沒有 key 時走 `public.pimlico.io`、Safe 自己用 ETH 付 gas；Safe 沒有 ETH 時先擋下並顯示說明。**沒有用真實交易驗過**，上面「送一筆小額 USDC」那一項請在沒有 key 的情況下也跑一次
- [x] Privy SDK 在無後端時仍被打包（不載入）
      `next.config.ts` 在沒有 `NEXT_PUBLIC_BACKEND_URL` 時把 `@privy-io/react-auth` 換成 `app/lib/stubs/privyReactAuth.tsx`；前端 chunk 從 19 MB 降到 13 MB，bundle 裡找不到 Privy。有後端的 build 不受影響（仍含 Privy）
- [x] Safe 地址每次載入都重新計算且失敗不重試，RPC 失敗時會停在「Setting up your Smart Wallet…」
      無後端時把上次算出的地址存在 localStorage（`kura-personal-safe-v1`，移除錢包時一併清掉），先顯示再背景重算；重算失敗會持續重試
- [x] 未使用的元件目錄：`app/components/settings/`、`app/components/marketing/`
      `settings/` 整個刪除；`marketing/` 只留下載頁還在用的 `MarketingNav`、`MarketingFooter`
- [x] 備援 Base RPC 在瀏覽器裡都不能用（2026-11-13）：`base.llamarpc.com` 回 525，`1rpc.io/base` 回「usage limit」且被 CORS 擋
      `app/lib/baseChain.ts` 與 `proxy.ts` 改成 `base-rpc.publicnode.com`、`base.drpc.org`，`mainnet.base.org` 墊後；換完後瀏覽器裡沒有 RPC 的 CORS 錯誤。公用端點隨時可能變動，正式部署還是建議設 Alchemy key
