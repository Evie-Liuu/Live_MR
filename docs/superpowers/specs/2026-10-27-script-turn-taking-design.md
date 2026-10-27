# 逐句輪流演練：台上學生 iPad 即時狀態與發言控制

> 日期：2026-10-27
> 狀態：已核可（2026-10-27），第 1 步已實作，待 iPad 實機驗證逐字稿方案
> 範圍：多人對話口說輔助規劃的第 1 步（逐句輪流）。第 2 步「規則觸發的分級提示＋每句紀錄」、第 3 步「說完後 AI 分析」不在本文件，但本文件預留它們需要的欄位。

## 1. 背景與問題

課中「任務中」階段目前只記到「第幾步完成」（`HostLessonState.doneCount`），由老師手動勾選。一個步驟裡有 4–8 句台詞、2–4 個角色，課堂上會出現：

- 台上學生不知道現在輪到誰、下一句是不是自己。
- 全班麥克風都開著（`StudentSession` 進教室就 `setMicrophoneEnabled(true)`），旁邊同學的聲音會讓大屏名牌的「說話中」亂亮，錄音也會錄進非發言者。
- 現有「輪到你說話了」卡片屬於 AI 自由問答流程（`interactionPhase` = idle/teacher/generating/student），只有老師與學生兩方，沒有「第幾句、哪個角色」的概念。

### 1.1 現況可沿用

| 現有 | 位置 | 用途 |
|------|------|------|
| 併角後的劇本 | `lessonTask(lesson)` → `applyCastMerge` 已把被併掉角色的 `speakerSlotId` 換成接手角色 | 直接決定每句由哪個角色說 |
| 角色 → 演出者 | `slotAssignments`（HostSession） | 角色 → identity |
| 角色代表色 | `ROLE_COLORS`（`utils/nameplates.ts`，依場景 slot 順序） | iPad 發言狀態的主題色，與大屏名牌一致 |
| 說話偵測 | LiveKit `ActiveSpeakersChanged`（伺服器端偵測，所有人都收得到） | 聆聽畫面的「對方說話中」動畫 |
| 老師端 STT | `useSpeechRecording`（老師本機 Web Speech） | 老師演角色時的即時逐字稿 |
| 學生端錄音 | `useLocalAudioRecorder` 直接錄 mic `MediaStreamTrack` | 靜音後錄到的是無聲，自然只留下發言者的聲音 |
| 定期重送 | 台下互動題、姿勢名單的做法 | 學生重新整理或封包遺失時補上狀態 |

## 2. 目標與非目標

**目標**

1. 老師端維護「目前第幾步、第幾句、輪到誰」的唯一狀態，並即時廣播。
2. 台上發言者的 iPad 進入「發言狀態」：角色主題色、自己的台詞、麥克風開啟、「我說完了」按鈕。
3. 其他 iPad 進入「聆聽狀態」：深灰半透明遮罩，中央顯示「Listening to [角色名]...」與對方的即時逐字稿；麥克風靜音。
4. 只收錄發言者的聲音：非發言者的麥克風在演練中靜音（保留發布，不重新協商）。
5. 學生按「我說完了」換下一句；老師可隨時下一句、上一句、跳到某句、暫停。
6. 大屏標出目前這一句與發言者。

**非目標（本步不做）**

- 沉默秒數觸發的分級提示、每句表現紀錄的儲存（第 2 步）。本步只把時間戳留在記憶體。
- AI 分析學生說了什麼（第 3 步）。
- 自動換句（偵測說完自動跳下一句）：教室串音容易誤觸發，第 2 步有每句資料後再評估。

## 3. 狀態模型

### 3.1 老師端狀態

`HostLessonState` 新增（存進現有的 `saveHostLesson`，重新整理後可接續）：

```ts
interface ScriptTurnState {
  /** 目前步驟內的台詞序號（跳過英文空白的台詞後的序號，0 起算） */
  lineIndex: number
  /** 每次換句、換發言者都 +1；學生回報「說完了」時帶回，用來丟掉過期回報 */
  seq: number
  /** running：演練中；paused：暫停（全員回到一般畫面、麥克風恢復）；stepEnd：本步最後一句說完 */
  status: 'running' | 'paused' | 'stepEnd'
}
// HostLessonState.turn?: ScriptTurnState   —— 沒有這個欄位＝沒在逐句演練
```

### 3.2 推導出的「這一輪」

純函式 `utils/scriptTurn.ts`，方便單元測試：

```ts
interface ScriptTurn {
  seq: number
  status: ScriptTurnState['status']
  stepIndex: number
  lineIndex: number
  lineCount: number
  speaker: TurnPerson          // 這一句的發言者
  next: TurnPerson | null      // 下一句的發言者（本步最後一句時為 null）
  line: { en: string; zh: string }
}
interface TurnPerson {
  slotId: string               // 併角後的角色
  label: string                // 角色名，例如「顧客A」
  color: string                // ROLE_COLORS[依場景 slot 順序]
  identity: string | null      // 未指派時為 null
  name: string                 // 演出者名字；未指派時為「未指派」；老師為老師名
}

function resolveTurn(lesson, turnState, slots, slotAssignments, names): ScriptTurn | null
function advance(lesson, turnState): ScriptTurnState   // 最後一句 → status 'stepEnd'
function back(lesson, turnState): ScriptTurnState
function jumpTo(lesson, turnState, lineIndex): ScriptTurnState
```

規則：

- 台詞來源用 `lessonTask(lesson)` 的目前步驟，併角已處理；英文空白的台詞跳過。
- 同一人連續兩句（併角後常見）：仍然一句一輪，但麥克風不關，避免開關閃爍（見 5.3）。
- `stepEnd` 後由老師按「下一步」：`doneCount + 1`、`lineIndex = 0`、`status = running`。中間的空檔讓老師發布台下互動題；有題目發布中時不自動開始下一步。
- 演出中重新指派角色、切換演出人數：重新推導發言者並 `seq + 1`。切換人數後該步台詞數會變，`lineIndex` 夾到範圍內，並跳出確認「人數改變，從本步第一句重來？」。

## 4. 訊息協定

都走 LiveKit data channel，JSON，`type` 欄位區分。與現有訊息並存。

| 訊息 | 方向 | reliable | 內容 | 時機 |
|------|------|----------|------|------|
| `script-turn` | 老師 → 全體 | 是 | `{ turn: ScriptTurn \| null }`，null＝結束演練 | 狀態改變時立即送；演練中每 3 秒重送一次 |
| `turn-done` | 發言者 → 老師 | 是 | `{ seq }` | 學生按「我說完了」 |
| `turn-transcript` | 發言者 → 全體 | 否（可遺失） | `{ seq, text, final }` | 即時逐字稿，節流 300 ms；一句結束時送一次 `final: true` |

大屏沿用 `BroadcastChannel`：老師端把 `script-turn` 與收到的 `turn-transcript` 轉發給大屏（新增 `BigScreenMsg` 型別 `script-turn`、`turn-transcript`）。

處理規則：

- 老師端收到 `turn-done`：`seq` 等於目前 seq，且送出者是目前發言者，才換下一句；否則忽略。兩台裝置同時按、重送都不會跳兩句。
- 學生端收到 `turn-transcript`：只接受「送出者 = 目前 `turn.speaker.identity`」且 `seq` 相符的。學生端目前只接受 host 訊息，這裡新增這一個例外。
- 老師自己演角色時，`turn-transcript` 由老師端用現有 `useSpeechRecording` 的 interim 產生並廣播。
- 學生按下按鈕後顯示「已送出」；3 秒內沒收到新的 seq 就再送一次（最多 2 次）。
- 學生斷線重連或重新整理：等下一次 3 秒重送即可回到正確畫面。

## 5. 學生 iPad

新元件 `ScriptTurnOverlay.tsx` + `.css`，蓋在 `student-main-card` 上。鏡頭與姿勢偵測照常在底下運作，遮罩不能卸載 video、不能停相機。

### 5.1 畫面狀態

| 自己是誰 | `turn.status` | 畫面 | 麥克風 |
|----------|---------------|------|--------|
| 本句發言者 | running | 發言狀態 | 開 |
| 台上其他角色、台下同學 | running | 聆聽狀態 | 靜音 |
| 所有人 | paused / stepEnd / 沒有 turn | 一般畫面（現況） | 恢復開啟 |

台下同學也顯示聆聽狀態：專心聽對話正好是台下互動題的前提。

### 5.2 視覺規格

**發言狀態（輪到自己）**

- 背景：角色主題色 `--turn-color` 的漸層（主題色 → 主題色加深 15%），整張卡片 300 ms 淡入；進場時中央「輪到你了」放大一次。
- 頂部：角色膠囊「顧客A · 你」（白底、主題色字）＋步驟進度「第 2 句 / 共 6 句」。
- 中央：自己的英文台詞（36 px、粗體、白字，最多 3 行），下方中文（18 px、白 80%）。
- 麥克風圈：台詞下方，依本機音量即時縮放的光圈（LiveKit `localParticipant.audioLevel`），讓學生知道有收到聲音。
- 自己的即時逐字稿（有逐字稿來源時）：白 70%，在麥克風圈下方。
- 底部：「我說完了」大按鈕（高 64 px、白底主題色字，iPad 拇指可及）。
- 預留第 2 步提示區（台詞與按鈕之間，本步不顯示）。

**聆聽狀態（非發言）**

- 遮罩：`rgba(18, 20, 26, 0.82)` 加 `backdrop-filter: blur(8px)`，底下的鏡頭畫面模糊可見。
- 中央：`Listening to 顧客B...`；角色名用對方的主題色，下一行小字顯示演出者「小華」。
- 說話動畫：對方在 LiveKit ActiveSpeakers 裡時，名字旁的聲波三條跳動；沒聲音時靜止成三個點。
- 即時逐字稿：對方的話白字 20 px，最多 2 行，舊字往上淡出；interim 部分 50% 透明，final 後變實色。
- 角落：「麥克風已靜音」小標（`mic_off` 圖示），讓學生知道不是壞掉。
- 下一句輪到自己時：底部出現主題色橫條「下一句輪到你：Can I pay by card?」，讓學生先準備（同時是第 2 步「開不了口」的預防）。

**切換**：聆聽 → 發言用 300 ms 交叉淡化；發言 → 聆聽時先把按鈕變成「已送出」再淡出，避免學生以為沒按到。

### 5.3 麥克風控制

- 用 `LocalTrackPublication.mute()` / `unmute()`，不用 `setMicrophoneEnabled(false)`。後者會取消發布，重新發布在 iPad 上慢且可能跳權限提示。
- LiveKit 預設 `stopMicTrackOnMute: false`，靜音只把 `MediaStreamTrack.enabled` 設為 false，`useLocalAudioRecorder` 繼續錄，但錄到無聲。所以錄音檔裡只剩發言者的聲音，不用改錄音流程。
- 靜音後 LiveKit 不再把該學生列入 ActiveSpeakers，大屏名牌的「說話中」也只會亮發言者，順帶解決串音誤亮。
- 同一人連續兩句：seq 改變但發言者不變，不做 mute/unmute。
- 保險：演練中超過 10 秒沒收到 `script-turn`（老師斷線），iPad 自動回到一般畫面並恢復麥克風。
- 老師的麥克風不受控制（老師需要隨時提醒學生），但老師說話不會顯示成發言者的逐字稿。

### 5.4 即時逐字稿來源（需要先實機驗證）

老師演角色時用老師電腦的 Web Speech，已驗證可行。學生發言時的來源有不確定性：

| 方案 | 做法 | 風險 |
|------|------|------|
| A. 發言者 iPad 本機辨識 | 發言狀態時在 iPad 上開 `webkitSpeechRecognition`（en-US，interim），節流後送 `turn-transcript` | iPadOS Safari 同時開 WebRTC 麥克風與語音辨識，可能搶音訊、讓 LiveKit 的聲音變無聲，或不定時中斷 |
| B. 沒有逐字稿 | 聆聽畫面改顯示對方「這一句的台詞」，標示「台詞」而不是「逐字稿」，搭配說話動畫 | 不是真的即時逐字稿，但穩定 |
| C. 伺服器串流辨識 | 老師端或後端訂閱發言者音軌，送 Gemini Live 等串流辨識 | 成本與複雜度高，放到第 3 步後再評估 |

做法：實作前用一台實機 iPad 做 spike，檢查以下四點：

1. LiveKit 麥克風發布中開辨識，老師端是否還聽得到聲音；
2. 連續辨識能維持多久不中斷；
3. interim 延遲；
4. 是否每次都跳權限提示。

通過就用 A，失敗就退回 B，並保留 `TranscriptSource` 介面，之後接 C 時不用改畫面。

## 6. 老師端

在任務中的課程卡（`hs-lesson` 區塊）新增「逐句演練」區：

- 「開始逐句演練」按鈕：建立 `turn`（lineIndex 0、running）。與 AI 互動流程互斥：演練中「開始互動」停用，互動中不能開始演練。
- 台詞清單：目前步驟每句一列（角色色點、角色名・演出者、英文台詞），目前句高亮、已說過的變淡；點任一列＝跳到那句。
- 控制列：上一句、暫停／繼續、下一句、結束演練。
- 發言者狀態：已連線且說話中（綠點跳動）、已連線、離線（紅字「小華離線」）、未指派（橘字「店員B 未指派」）。後兩種情況提示老師「代讀」（把麥克風視為老師）或「略過」。
- `stepEnd` 時顯示「本步結束」＋「發布台下互動題」捷徑＋「下一步」按鈕。

每句的時間戳 `{ seq, step, line, identity, startedAt, firstVoiceAt, endedAt, endedBy: 'student' | 'teacher' | 'skip' }` 先存在記憶體陣列，第 2 步再寫進資料庫。`firstVoiceAt` 取自 ActiveSpeakers。

## 7. 大屏

- `LessonScreenState` 新增 `turn?: { lineIndex, speakerLabel, speakerColor, transcript? }`。
- 開「顯示台詞」時，台詞清單高亮目前句；沒開時只在字幕區顯示「顧客A・小明」與即時逐字稿。
- 名牌新增「輪到」樣式：發言者名牌放大並套主題色外框；其他名牌照現有規則淡化。說話中的發光仍由 ActiveSpeakers 決定。

## 8. 異常情況

| 情況 | 處理 |
|------|------|
| `turn-done` 遺失 | 學生端 3 秒重送；老師也可以直接按下一句 |
| 學生重複按、兩台裝置同一人 | seq 與 identity 比對，只換一次 |
| 發言者斷線 | 老師端提示；10 秒保險讓其他 iPad 不會永遠靜音 |
| 老師重新整理 | `turn` 存在 `saveHostLesson`，重連後立即重送 `script-turn` |
| 演練中換角色、換人數 | 重新推導並 seq + 1；換人數要確認 |
| 有台下互動題發布中 | 互動題畫面優先於聆聽遮罩；演練自動暫停，收題後老師按繼續 |
| 非演練中 | 完全維持現況，不影響 AI 互動流程 |

## 9. 檔案異動

| 檔案 | 異動 |
|------|------|
| `frontend/src/utils/scriptTurn.ts`（新） | `resolveTurn`、`advance`、`back`、`jumpTo` 與型別；附單元測試 |
| `frontend/src/utils/lessonSession.ts` | `HostLessonState.turn` 的儲存與讀取；`toLessonScreen` 帶出 `turn` |
| `frontend/src/components/HostSession.tsx` | 演練狀態、廣播與重送、收 `turn-done` 與 `turn-transcript`、老師演角色時的逐字稿、課程卡演練區 |
| `frontend/src/components/ScriptTurnOverlay.tsx` / `.css`（新） | 發言、聆聽兩種畫面 |
| `frontend/src/components/StudentSession.tsx` | 收 `script-turn`、麥克風 mute/unmute、10 秒保險、`turn-done` 重送、接受發言者的 `turn-transcript` |
| `frontend/src/hooks/useTurnTranscript.ts`（新，依 spike 結果） | 方案 A 的辨識與節流；B 時不啟用 |
| `frontend/src/components/BigScreen.tsx`、`utils/nameplates.ts` | 目前句高亮、「輪到」名牌、逐字稿字幕 |

## 10. 驗證

- 單元測試 `scriptTurn.ts`：併角後的發言者、跳過空白台詞、最後一句變 stepEnd、同一人連續兩句、未指派角色、過期 seq。
- 用暫時頁面截圖確認 iPad 兩種畫面（直向、橫向，4 個角色色）。
- 實機：老師電腦＋大屏＋2 台 iPad 演一個 4 句步驟。確認以下四點：
  - 只有發言者的聲音出現在錄音與 ActiveSpeakers；
  - 按鈕換句不重複；
  - 拔掉一台 iPad 網路後其他人 10 秒內恢復；
  - 老師重新整理後接續。
- 逐字稿 spike（5.4）先做，結果決定方案 A 或 B。

## 11. 待決定

1. 台下同學是否也顯示聆聽遮罩。預設是，理由見 5.1。
2. 學生 iPad 是否顯示自己的完整台詞。預設顯示；若想訓練不看稿，可加「只顯示中文」選項，與大屏「顯示台詞」分開控制。
3. 轉到發言狀態時是否播提示音。預設不播：提示音可能被剛開啟的麥克風錄進去。
