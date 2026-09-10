/**
 * 教案生成品質 spike：對 A1 / A2 / B1 各生成一份教案，寫到 scripts/out/ 供人工檢視。
 * 執行：  cd backend && NODE_OPTIONS=--use-system-ca npx tsx scripts/lesson-plan-spike.mts [topic]
 * 需求：  .env 內 GEMINI_API_KEY
 * 一次性評估腳本，不進自動測試。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { generateLessonPlan } from '../src/ai/lessonPlan.js'
import type { CefrLevel, SceneContext } from '../src/lessonPlanTypes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const topic = process.argv[2] ?? '退換貨與退款'
const outDir = path.resolve(__dirname, 'out')
fs.mkdirSync(outDir, { recursive: true })

// 與 frontend/src/config/scenes.ts 的服飾店收銀台一致（手動同步，spike 用）
const sceneContext: SceneContext = {
  sceneId: 'clothingStore_cashier', themeLabel: '服飾店', sceneLabel: '收銀台', sceneLabelEn: 'Cashier',
  slots: [{ id: 'cashier', label: '收銀員' }, { id: 'customer', label: '顧客' }],
  existingModuleLabels: ['Price', 'Size', 'Color', 'Sale'],
  exampleTasks: [{
    label: 'Ask for the price of a blue T-shirt.',
    hint: {
      keyStructure: 'What + is + the price of + the + [color] + [item]?',
      partialSentence: 'What is the _____ of the _____ _____?',
      unscramble: ['What', 'the', 'T-shirt?', 'price', 'of', 'is', 'the', 'blue'],
      completeSentence: 'What is the price of the blue T-shirt?',
      extraPhrases: ['How much is the blue T-shirt?', 'How much does the blue T-shirt cost?'],
    },
  }],
}

for (const level of ['A1', 'A2', 'B1'] as CefrLevel[]) {
  const t0 = Date.now()
  try {
    const plan = await generateLessonPlan({ sceneId: sceneContext.sceneId, topic, level, sceneContext }, `spike${level}`)
    const file = path.join(outDir, `lesson-${level}.json`)
    fs.writeFileSync(file, JSON.stringify(plan, null, 2))
    const tasks = plan.modules.reduce((n, m) => n + m.tasks.length, 0)
    console.log(`${level}: ${((Date.now() - t0) / 1000).toFixed(1)}s, ${plan.timeline.length} phases, ${plan.modules.length} modules / ${tasks} tasks → ${file}`)
  } catch (err) {
    console.error(`${level}: FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, err instanceof Error ? err.message : err)
  }
}
