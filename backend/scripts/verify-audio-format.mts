/**
 * 一次性驗證：Gemini 收不收得下 Chrome MediaRecorder 會吐的容器（ogg/opus、webm/opus）。
 * 用 ffmpeg-static 把測試 mp3 轉檔，分別送 Gemini 轉寫，印出每種容器成功與否。
 *
 * 執行：cd backend && NODE_OPTIONS=--use-system-ca npx tsx scripts/verify-audio-format.mts
 */
import ffmpegPath from 'ffmpeg-static'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { GoogleGenAI } from '@google/genai'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const execFileP = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const SRC = path.resolve(__dirname, '../../frontend/public/voice/Teacher_chat_test.mp3')
const TMP = path.resolve(__dirname, '../../recordings/_fmt_check')
const MODEL = process.env.SPIKE_MODEL || 'gemini-2.5-flash-lite'

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) { console.error('GEMINI_API_KEY 未設定'); process.exit(1) }
const ai = new GoogleGenAI({ apiKey })

async function transcode(ext: string, args: string[]): Promise<string> {
  fs.mkdirSync(TMP, { recursive: true })
  const out = path.join(TMP, `clip.${ext}`)
  await execFileP(ffmpegPath as unknown as string, ['-y', '-i', SRC, ...args, out])
  return out
}

async function tryGemini(label: string, file: string, mimeType: string) {
  try {
    const data = fs.readFileSync(file).toString('base64')
    const res: any = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [
        { text: 'Transcribe this audio verbatim. Output only the text.' },
        { inlineData: { mimeType, data } },
      ] }],
      config: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } } as any,
    })
    console.log(`✅ ${label} (${mimeType}) OK →`, (res.text ?? '').trim().slice(0, 80))
  } catch (e: any) {
    console.log(`❌ ${label} (${mimeType}) FAIL →`, (e?.message ?? String(e)).slice(0, 120))
  }
}

async function main() {
  const ogg = await transcode('ogg', ['-c:a', 'libopus', '-b:a', '32k'])
  const webm = await transcode('webm', ['-c:a', 'libopus', '-b:a', '32k'])
  await tryGemini('OGG/opus', ogg, 'audio/ogg')
  await tryGemini('WEBM/opus', webm, 'audio/webm')
}
main()
