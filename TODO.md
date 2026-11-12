# TODO — 社區版（無後端）上線前

> 工作筆記，對應 PR「On-chain community edition」。全部完成後請刪除這個檔案。
> 相關 PR：mobile-app 與 BackendServer 的同名分支 `claude/awesome-ritchie-i1bwnp`。

已通過：`npm test`（45 個）、`npm run typecheck`、無後端且無 Privy 設定的 `npm run build`、Chromium 自動化流程。
`npm run lint` 有 39 個既有錯誤（改動前就存在，沒有新增）。安裝要用 `npm ci --legacy-peer-deps`。
**沒驗過**：真實 Base RPC、送交易、真實 Privy 登入、Chromium 以外的瀏覽器。

## 1. 瀏覽器驗證（`NEXT_PUBLIC_BACKEND_URL` 留空）

- [ ] 建立錢包 → 顯示 12 字 → 設密碼 → 進 dashboard，**Safe 地址有算出來**（需要能連 Base RPC）
- [ ] 匯入助記詞／私鑰；重新整理後要求密碼解鎖；錯誤密碼被拒
- [ ] 送一筆小額 USDC、做一次 Swap（需要 `NEXT_PUBLIC_PIMLICO_API_KEY`）
- [ ] Morpho Earn、Borrow 各走一次
- [ ] Treasury：建立、送出提案、Approvals 簽核與執行、Team 新增／移除 owner
- [ ] 設定 → 顯示助記詞／私鑰（需再輸入密碼）；移除錢包（需密碼）
- [ ] 解鎖畫面「忘記密碼」→ 移除 → 用助記詞重新匯入，Treasury 清單還在
- [ ] 15 分鐘無操作自動上鎖；另一個分頁移除錢包時本分頁同步上鎖
- [ ] Safari、Firefox 各跑一次建立與解鎖
- [ ] DevTools Network：沒有任何請求送往 Privy、後端或 Plaid

## 2. 地址一致性

- [ ] 同一組助記詞在手機與網頁顯示同一個 Safe 地址
- [ ] 比對腳本在 mobile-app：`node scripts/safe-address-parity.cjs ../WebClients https://mainnet.base.org`
- [ ] 舊用戶：從 home.privy.io 匯出私鑰 → 匯入 → Safe 地址與原本相同

## 3. 有後端的模式（自架者會用到）

- [ ] 設定後端 URL 與 Privy app id 後，用真實 Privy 帳號登入，各頁行為和改動前一樣（目前只用模擬資料比對過 20 個路由）

## 4. 發佈

- [ ] 合併時 squash：分支上有三個標成 WIP 的中間 commit
- [ ] `deploy.yml` 仍會帶入 `NEXT_PUBLIC_BACKEND_URL`、`LIFI_INTEGRATOR=kura`、`LIFI_FEE=0.25` 與 Stripe price id：清空後端 URL 再部署，並決定是否保留 Li.Fi 抽成
- [ ] `proxy.ts` 的 CSP 仍寫死 `app.kura-finance.com`／`api.kura-finance.com` 並允許 Privy、Plaid 網域；社區版可以收緊

## 5. 之後再做

- [ ] 有後端時 Treasury 的伺服器同步沒有在跑：`useOrgStore` 的 `onRehydrateStorage` 在 store 建立期間引用自己而丟錯，載入旗標永遠不會完成
- [ ] 加值頁的 QR code 由 `api.qrserver.com` 產生，會把錢包地址送給第三方；改成本地產生
- [ ] 沒有 Pimlico key 就不能送交易（`lib/smartAccountSend.ts`）；手機有公用 bundler + ETH gas 備援，可以補齊
- [ ] Privy SDK 在無後端時仍被打包（不載入）
- [ ] Safe 地址每次載入都重新計算且失敗不重試，RPC 失敗時會停在「Setting up your Smart Wallet…」
- [ ] 未使用的元件目錄：`app/components/settings/`、`app/components/marketing/`
