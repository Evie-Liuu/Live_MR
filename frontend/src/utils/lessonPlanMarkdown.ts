import type { LessonPlan } from '../types/lessonPlan.ts'

/** 老師「複製為 Markdown」用；sceneConstraint 是給 AI 的內部文字，不輸出。 */
export function lessonPlanToMarkdown(plan: LessonPlan): string {
  const lines: string[] = []
  lines.push(`# ${plan.title}`)
  lines.push('')
  lines.push(`主題：${plan.topic}｜程度：${plan.level}｜時長：${plan.durationMin} 分鐘`)
  lines.push('')
  lines.push('## 學習目標')
  for (const o of plan.objectives) lines.push(`- ${o}`)
  lines.push('')
  lines.push('## 教學流程與逐字腳本')
  for (const p of plan.timeline) {
    lines.push(`### ${p.phase}（${p.minutes} 分鐘）`)
    lines.push(`活動：${p.activity}`)
    lines.push('')
    lines.push(p.teacherScript)
    lines.push('')
  }
  lines.push('## 語法說明')
  for (const g of plan.grammarNotes) {
    lines.push(`- **${g.point}**：${g.explanation}`)
    for (const ex of g.examples) lines.push(`  - ${ex}`)
  }
  lines.push('')
  lines.push('## 教學注意點')
  for (const n of plan.teachingNotes) lines.push(`- ${n}`)
  lines.push('')
  lines.push('## 任務包')
  for (const m of plan.modules) {
    lines.push(`### ${m.icon} ${m.label}`)
    m.tasks.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.label}`)
      lines.push(`   - 完整句：${t.hint.completeSentence}`)
      lines.push(`   - 句型：${t.hint.keyStructure}`)
      lines.push(`   - 延伸：${t.hint.extraPhrases.join(' / ')}`)
    })
    lines.push('')
  }
  return lines.join('\n')
}
