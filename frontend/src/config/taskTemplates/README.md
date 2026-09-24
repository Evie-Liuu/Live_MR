# 內建任務模板

老師在備課頁選「從任務庫中選擇模板」時看到的模板都在這個資料夾。
模板的 `task` 與任務編輯器的 `DialogueTask` 格式完全相同；套用時 `applyTemplate()` 會複製一份、換上新 id，
並記錄 `sourceTemplate: { id, version }`，老師儲存後才寫入資料庫，原模板不會被改動。

## 新增模板

1. `npm run dev` 啟動前端（DEV 模式），在備課頁用「自己新增任務」或套用既有模板，把任務編好。
2. 按任務編輯器頂列的「匯出為模板」（只在 DEV 模式出現），輸入模板 id（例如 `clothingStore_greeting`）。
   模板原始碼會複製到剪貼簿，步驟與台詞 id 已換成 `step1`、`step1_1` 這類可讀名稱。
3. 新增 `<模板 id>.ts`，貼上內容，補上 `description` 與 `tags`。
4. 在 `index.ts` 的 `TASK_TEMPLATES` 加入新模板（陣列順序就是任務庫的顯示順序）。
5. `npx vitest run src/config/taskTemplates` 通過後再 commit。

## 規則（由 taskTemplates.test.ts 檢查）

- 模板 `id` 上線後不可更改；內容大改時把 `version` +1。
- `sceneId` 必須存在於 `config/scenes.ts`，每句台詞的 `speakerSlotId` 必須是該場景的角色 slot。
- 每個步驟要有標題與至少一句台詞；每句台詞要有英文與中文。
- 長度與數量不可超過後端 `backend/src/dialogueTaskRoutes.ts` 的上限，否則老師套用後會存不進去。
- `description` 不可留 `TODO`。
