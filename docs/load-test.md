# 多人連線壓力測試

上課前確認「一整班學生同時進教室」撐得住。分三層，由快到慢、由模擬到真實：

| 層 | 測什麼 | 工具 | 時間 |
|---|---|---|---|
| A | LiveKit 媒體伺服器能不能轉發 29 路影音 | `lk load-test` | 5 分鐘 |
| B | 完整產品流程：登入 → 加入 → 核准 → 進課堂、老師端接收、姿勢、麥克風 | `scripts/load-test/`（無頭 Chrome） | 10 分鐘 |
| C | 教室 Wi-Fi、真實 iPad、老師電腦與大屏 | 人工分批 | 1 節課 |

A、B 都在電腦上模擬，**量不到教室 Wi-Fi 與 iPad 本身的效能**，最後一定要做 C。

---

## 準備

1. **測試帳號**（B、C 都要）：見 [dev-setup.md › 本地測試帳號](dev-setup.md#本地測試帳號壓測演練用)。打包版要有 `LiveMR/data/test-accounts.json`，`launcher.env` 加 `ENABLE_TEST_ACCOUNTS=1`。
2. **安裝腳本依賴**（B）：在 repo 根目錄 `npm install`（會裝 `playwright-core`，用電腦上已安裝的 Chrome／Edge，不另外下載瀏覽器；找不到時用 `CHROME_PATH` 指定）。
3. **啟動伺服器**：開發版照 [dev-setup.md](dev-setup.md) 起 LiveKit、backend、frontend；或打包版雙擊 `LiveMR.bat`（重新打包才會包含最新程式）。

> 開發版的 LiveKit 與打包版都用 7880 埠，**同一台電腦一次只能跑一個**。另外 `node scripts/build-launcher.mjs` 開始時會強制關掉所有 `livekit-server.exe`（包含開發版的），重新打包後開發版要重新 `npx tsx scripts/dev-livekit.ts`。

---

## A 層：LiveKit 轉發能力

`lk` CLI 放在 `.build-cache/lk/lk.exe`（[GitHub release](https://github.com/livekit/livekit-cli/releases) 下載）。先由老師端開一間課堂取得房號，然後：

```bash
.build-cache/lk/lk.exe load-test --url ws://<電腦區網 IP>:7880 \
  --api-key devkey --api-secret devsecret1234567890devsecret1234567890 \
  --room <房號> --video-publishers 29 --audio-publishers 29 \
  --video-resolution medium --subscribers 1 --layout 5x5 --duration 2m
```

- 金鑰：打包版沒在 `launcher.env` 設 `LIVEKIT_API_KEY/SECRET` 時就是上面的預設值。
- 預設 `speaker` 版面只訂閱約 12 路，要量老師端收全部要加 `--layout 5x5`。
- 看結尾表格的掉包率（目標 < 1%）與接收路數。

---

## B 層：完整產品流程（腳本）

```bash
# 開發版（預設 --base http://127.0.0.1:5173）
npm run load-test -- --count 29

# 打包版：--base 用 LiveMR 啟動時印出的網址
npm run load-test -- --base https://192.168.1.20 --count 29

# 麥克風失敗的重試與提示
npm run load-test:mic -- --base https://192.168.1.20
```

### 腳本做什麼

1. 以老師身分用 API 建房間，自動核准所有加入申請（像按「全部允許」）。
2. 另開一頁以老師身分連進房間、訂閱全部學生，**每 5 秒**印出：收到幾人、影像／聲音軌數、接收 kbps、掉包率、fps、後端 API 回應時間、本機 CPU 與可用記憶體。
3. `stu01`～`stuNN` **同時**各開一個獨立瀏覽器，用假鏡頭／麥克風走「QR 連結 → 登入 → 等待核准 → 課堂已連線」。
4. 維持 `--hold` 秒，再檢查有幾人畫面出現「麥克風未啟動」提示。
5. 指定前 `--pose` 位發布姿勢資料，量「演出中」出現與姿勢模型就緒的時間（假鏡頭裡沒有人，量不到骨架）。
6. 結果寫到 `load-test-<時間>.json`，結尾印出摘要。

### 參數

| 參數 | 預設 | 說明 |
|---|---|---|
| `--base` | `http://127.0.0.1:5173` | 伺服器網址。開發版請用 `127.0.0.1` 而非 `localhost` |
| `--count` | 29 | 學生人數 |
| `--password` | `EngTest123!` | 測試帳號密碼 |
| `--prefix` | `stu` | 帳號前綴（`stu01`…） |
| `--hold` | 60 | 全部連上後維持幾秒 |
| `--pose` | 4 | 發布姿勢的人數，0＝跳過 |
| `--min-free-mb` | 700 | 本機可用記憶體低於此值就中止，保護這台電腦 |
| `--ca` | `dist-launcher/LiveMR/data/certs/ca-cert.pem` | 打包版 HTTPS 用來驗證憑證的 CA |
| `--out` | `load-test-<時間>.json` | 結果檔 |

### 怎麼判讀

| 項目 | 合格參考 | 2026-10-30 開發版 29 人實測 |
|---|---|---|
| `connected` | 全部 | 29/29 |
| `loginToConnectedMs` 中位數 | < 5 秒 | 3.8 秒（最慢 21 秒，第一次連線失敗後自動重試） |
| 穩定期 `lossPct` | < 1% | 0% |
| 穩定期影像軌數 | = 人數 | 29 |
| `micAlerts` | 0 | 修正前 13 人麥克風啟動失敗且無提示（同機模擬的假麥克風搶資源） |
| `consoleErrors` | 無或可解釋 | 3 次 `could not establish pc connection`（重試後成功） |

### 注意

- **模擬端很吃資源**：每位學生是一個完整瀏覽器分頁，29 人約需 3～4 GB 記憶體、burst 時 CPU 70%。記憶體不夠時先用 `--count 10`、`20` 逐步加。
- **模擬端與伺服器最好不同台**：同一台跑時，模擬端的負擔會算到伺服器頭上，數字會比真實情況差。用另一台電腦跑腳本、`--base` 指向老師電腦的區網 IP，結果最接近真實。
- 打包版 HTTPS：腳本以 `--ca`（打包版自己的 CA）加上系統憑證庫驗證，不關閉憑證檢查；防毒軟體（如 Avast）攔截 HTTPS 時改用系統庫裡它的根憑證，也能通過。
- 腳本建立的是獨立房間，不影響正在上的課；但會用掉 LiveKit 頻寬，**不要在上課中對正式伺服器跑**。

---

## C 層：真機分批測試（人工）

用測試帳號讓真實 iPad 分批進教室，最接近實際上課。建議兩人執行：一人操作老師電腦，一人巡 iPad。

### 事前

- [ ] 老師電腦啟動 `LiveMR.bat`，記下網址；大屏用 `?screen=bigscreen` 開在投影機。
- [ ] iPad 連上**上課要用的同一個 Wi-Fi**，第一次開網址要接受憑證警告（見 dev-setup.md）。
- [ ] 每台 iPad 貼上帳號標籤（`stu01`～`stu29`），密碼統一。
- [ ] 老師電腦開工作管理員（效能分頁），記錄起始 CPU／記憶體。

### 分批進場

依 **5 → 15 → 29 台**分三批，每批：

1. 老師建立課堂，投影 QR Code。
2. 該批 iPad **同時**掃 QR、輸入帳號密碼登入。
3. 老師按「全部允許」。
4. 計時：從按允許到全部 iPad 顯示「已連線」。
5. 每批停 3 分鐘，記錄下表。

| 批 | 台數 | 全部連上秒數 | 有幾台連線重試／失敗 | 有幾台出現麥克風提示 | 老師電腦 CPU／記憶體 | 大屏流暢度 | 備註 |
|---|---|---|---|---|---|---|---|
| 1 | 5 | | | | | | |
| 2 | 15 | | | | | | |
| 3 | 29 | | | | | | |

### 29 台到齊後的課堂操作

- [ ] **指定角色**：選任務、指派 4 位演出者 → 大屏 4 個角色跟著動、名牌正確；其他 25 台顯示「等待老師指定角色」。
- [ ] **登台展演**：逐句進行，只有發言者的 iPad 收音、大屏只有發言者名牌亮；暫停／步驟講完時全部靜音。
- [ ] **分級提示**：讓發言者故意不開口，iPad 依序出現意思 → 開頭 → 重組 → 完整；老師手動加一級有效。
- [ ] **台下互動點**：發布一題，29 台都跳出選項、作答後大屏統計人數正確。
- [ ] **麥克風提示**：找一台 iPad 先讓別的 App 佔用麥克風再進課堂，應出現紅色提示，關掉該 App 後按「重試」恢復。
- [ ] **斷線重連**：隨機 2 台 iPad 關 Wi-Fi 10 秒再開，應自動重連回課堂。
- [ ] **老師重新整理**：老師端按 F5，學生不應被踢出（10 秒寬限）。
- [ ] 全程 15 分鐘後再記一次老師電腦 CPU／記憶體，看有沒有持續上升（記憶體洩漏）。

### 收尾

- [ ] 結果表與觀察貼回議題／會議紀錄。
- [ ] 正式上課前把 `launcher.env` 的 `ENABLE_TEST_ACCOUNTS=1` 刪掉。
