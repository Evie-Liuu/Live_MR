/**
 * AI 口說判斷（ai/speechJudge.ts）實測評估：用 Windows 內建語音（SAPI）合成學生說話的各種情況，
 * 送真的 Gemini，比較判斷是否符合預期，並記錄延遲、token 與費用。
 *
 * 執行：  cd backend && NODE_OPTIONS=--use-system-ca npx tsx scripts/speech-judge-eval.mts [模型,模型...]
 * 需求：  .env 內 GEMINI_API_KEY；Windows 內建 en-US（Zira）與 zh-TW（Hanhan）語音
 * 輸出：  recordings/_speech_eval/（合成的 WAV 與 results.json，已在 .gitignore）
 *
 * 限制：合成語音發音清楚、沒有教室噪音，結果是「理想情況」的上限；真實學生錄音要另外驗證。
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })
const { judgeTurn } = await import('../src/ai/speechJudge.js')
const { estimateCostUsd } = await import('../src/ai/pricing.js')

const OUT = path.resolve(__dirname, '../../recordings/_speech_eval')
const MODELS = (process.argv[2] || 'gemini-2.5-flash-lite,gemini-2.5-flash').split(',').map(s => s.trim()).filter(Boolean)
const RATE = 16000

type Part = { en: string } | { zh: string } | { silence: number }
interface Case {
  id: string
  note: string
  line: { en: string; zh: string }
  prevLine?: string
  level: string
  said: Part[]
  /** 預期嚴重程度（可接受多個） */
  expect: ('ok' | 'minor' | 'severe')[]
  /** 預期一定要出現的問題 */
  issue?: 'chinese' | 'incomplete' | 'wrongWord' | 'noResponse'
}

const ALL_CASES: Case[] = [
  { id: 'ok-exact', note: '完全正確', level: 'A1-A2', line: { en: "I'm from Los Angeles.", zh: '我來自洛杉磯。' }, prevLine: 'Where are you from, Mia?', said: [{ en: "I'm from Los Angeles." }], expect: ['ok'] },
  { id: 'ok-hat', note: '完全正確（短句）', level: 'A1', line: { en: 'How about this hat?', zh: '這頂帽子怎麼樣？' }, said: [{ en: 'How about this hat?' }], expect: ['ok'] },
  { id: 'minor-grammar', note: '文法小錯（this jeans）', level: 'A1', line: { en: 'Can I try these jeans on?', zh: '我可以試穿這條牛仔褲嗎？' }, said: [{ en: 'Can I try this jeans on?' }], expect: ['ok', 'minor'] },
  { id: 'minor-drop', note: '漏掉小字（Nice meet you）', level: 'A1-A2', line: { en: "Hi, I'm Mia. Nice to meet you!", zh: '嗨，我是 Mia。很高興認識你！' }, said: [{ en: 'Hi, I am Mia. Nice meet you.' }], expect: ['ok', 'minor'] },
  { id: 'half', note: '只說前半句', level: 'A1-A2', line: { en: "They're pineapple cakes. They're popular in Taiwan.", zh: '這些是鳳梨酥。它們在台灣很受歡迎。' }, said: [{ en: "They're pineapple cakes." }], expect: ['minor', 'severe'], issue: 'incomplete' },
  { id: 'cut', note: '說兩個字就停', level: 'A1-A2', line: { en: 'Would you like to try one?', zh: '你想試吃一個嗎？' }, said: [{ en: 'Would you' }], expect: ['severe'], issue: 'incomplete' },
  { id: 'wrong-key', note: '關鍵字說錯（city → cat）', level: 'A1-A2', line: { en: 'Is Toronto a big city?', zh: '多倫多是個大城市嗎？' }, said: [{ en: 'Is Toronto a big cat?' }], expect: ['severe'], issue: 'wrongWord' },
  { id: 'wrong-color', note: '顏色說錯（red → blue）', level: 'A1', line: { en: 'Can I try this red dress on, too?', zh: '我也可以試穿這件紅色洋裝嗎？' }, said: [{ en: 'Can I try this blue dress on, too?' }], expect: ['severe', 'minor'], issue: 'wrongWord' },
  { id: 'zh-all', note: '整句說中文', level: 'A1-A2', line: { en: "What's your favorite Taiwanese food, Alex?", zh: 'Alex，你最喜歡的台灣食物是什麼？' }, said: [{ zh: 'Alex，你最喜歡的台灣食物是什麼？' }], expect: ['severe'], issue: 'chinese' },
  { id: 'zh-mixed', note: '中英混用（關鍵字說中文）', level: 'A1-A2', line: { en: "I love beef noodles! They're really good.", zh: '我很喜歡牛肉麵！真的很好吃。' }, said: [{ en: 'I love' }, { zh: '牛肉麵' }, { en: "They're really good." }], expect: ['severe'], issue: 'chinese' },
  { id: 'silent', note: '完全沒有聲音', level: 'A1-A2', line: { en: 'Sure! Thank you!', zh: '好啊！謝謝你！' }, said: [{ silence: 3 }], expect: ['severe'], issue: 'noResponse' },
]
/** EVAL_CASES=id,id 只跑指定案例；EVAL_GAP_MS 每次呼叫之間的間隔（免費層每分鐘次數有限） */
const only = process.env.EVAL_CASES?.split(',').map(s => s.trim()).filter(Boolean)
const CASES = only ? ALL_CASES.filter(c => only.includes(c.id)) : ALL_CASES
const GAP_MS = Number(process.env.EVAL_GAP_MS ?? 0)

/** 用 SAPI 合成 16 kHz 單聲道 WAV，回傳 PCM（不含標頭） */
function synth(text: string, culture: 'en-US' | 'zh-TW', file: string): Buffer {
  const script = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq '${culture}' } | Select-Object -First 1
if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }
$s.Rate = -1
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${RATE}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($env:EVAL_WAV, $fmt)
$s.Speak($env:EVAL_TEXT)
$s.Dispose()`
  execFileSync('powershell', ['-NoProfile', '-Command', script], { env: { ...process.env, EVAL_WAV: file, EVAL_TEXT: text } })
  const wav = fs.readFileSync(file)
  const dataAt = wav.indexOf('data')
  return wav.subarray(dataAt + 8, dataAt + 8 + wav.readUInt32LE(dataAt + 4))
}

function wavFile(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** 加一點白噪音，避免完全數位靜音（比較接近真實麥克風） */
function noise(seconds: number): Buffer {
  const buf = Buffer.alloc(Math.round(seconds * RATE) * 2)
  for (let i = 0; i < buf.length; i += 2) buf.writeInt16LE(Math.round((Math.random() - 0.5) * 120), i)
  return buf
}

fs.mkdirSync(OUT, { recursive: true })
const clips = new Map<string, { data: string; seconds: number }>()
for (const c of CASES) {
  const parts = c.said.map((p, i) => {
    if ('silence' in p) return noise(p.silence)
    const tmp = path.join(OUT, `${c.id}_${i}.wav`)
    return 'en' in p ? synth(p.en, 'en-US', tmp) : synth(p.zh, 'zh-TW', tmp)
  })
  const pcm = Buffer.concat([noise(0.4), ...parts, noise(0.6)])
  const wav = wavFile(pcm)
  fs.writeFileSync(path.join(OUT, `${c.id}.wav`), wav)
  clips.set(c.id, { data: wav.toString('base64'), seconds: pcm.length / 2 / RATE })
}

const results: unknown[] = []
for (const model of MODELS) {
  console.log(`\n=== ${model} ===`)
  let pass = 0
  let cost = 0
  let latency = 0
  for (const c of CASES) {
    const clip = clips.get(c.id)!
    if (GAP_MS > 0) await new Promise(r => setTimeout(r, GAP_MS))
    const t0 = Date.now()
    try {
      const { judgment, usage, model: used } = await judgeTurn({
        line: c.line, prevLine: c.prevLine, level: c.level, audio: { data: clip.data, mimeType: 'audio/wav' }, models: [model],
      })
      const ms = Date.now() - t0
      const usd = usage ? estimateCostUsd(used, usage) : 0
      const ok = c.expect.includes(judgment.severity) && (!c.issue || judgment.issues.includes(c.issue))
      if (ok) pass++
      cost += usd
      latency += ms
      console.log(`${ok ? '✓' : '✗'} ${c.id.padEnd(14)} ${judgment.severity.padEnd(6)} [${judgment.issues.join(',')}] ${ms}ms ` +
        `in=${usage?.prompt}(audio ${usage?.audioPrompt ?? '?'}) out=${usage?.output} $${usd.toFixed(6)} "${judgment.transcript}"`)
      results.push({ model, case: c.id, note: c.note, ok, ms, clipSeconds: clip.seconds, usage, usd, judgment })
    } catch (err) {
      console.log(`✗ ${c.id.padEnd(14)} ERROR ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`)
      results.push({ model, case: c.id, note: c.note, ok: false, error: String(err) })
    }
  }
  console.log(`--- ${model}: ${pass}/${CASES.length} 符合預期，平均 ${Math.round(latency / CASES.length)}ms，共 $${cost.toFixed(5)}（平均每次 $${(cost / CASES.length).toFixed(6)}）`)
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
console.log(`\n結果已存到 ${path.join(OUT, 'results.json')}`)
