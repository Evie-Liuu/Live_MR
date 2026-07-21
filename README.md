# Live MR

**Live MR** 是一套即時混合實境（MR）英語會話教學平台：老師與學生各自用攝影機驅動自己的 VRM 虛擬角色，即時合成到教室「大屏」共享場景，並由 AI（Gemini）即時生成教學提示、支援整堂課錄製。

- 技術架構、模組職責與資料流：見 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- 使用說明（老師 / 學生操作流程）：見 [`docs/USER_GUIDE.md`](./docs/USER_GUIDE.md)

## 老師端啟動

解壓縮 `LiveMR` 資料夾，雙擊其中的 `LiveMR.bat` 即可啟動，免安裝 Docker / Git / OpenSSL 等其他軟體。啟動後終端機會顯示區網網址（例如 `https://192.168.0.145`）並自動開啟瀏覽器，學生與大屏可用同一個網址、於同一個 Wi-Fi 下加入。

開發環境設定（前後端本機啟動、跨裝置測試）見 [`docs/dev-setup.md`](./docs/dev-setup.md)。
