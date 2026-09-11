import type { DatabaseSync } from 'node:sqlite'
import type { LessonPlan, LessonPlanModule, LessonPlanRecord, LessonPlanSummary, CefrLevel } from '../lessonPlanTypes.js'

interface PlanRow {
  id: string
  teacher_uid: string
  institution_id: string | null
  scene_id: string
  topic: string
  level: string
  title: string
  plan_json: string
  created_at: string
  updated_at: string
}

function rowToRecord(row: PlanRow): LessonPlanRecord {
  return {
    id: row.id,
    teacherUid: row.teacher_uid,
    institutionId: row.institution_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    plan: JSON.parse(row.plan_json) as LessonPlan,
  }
}

export class LessonPlanRepo {
  constructor(private readonly db: DatabaseSync) {}

  create(input: { id: string; teacherUid: string; institutionId?: string | null; plan: LessonPlan }): LessonPlanRecord {
    const now = new Date().toISOString()
    const { id, teacherUid, plan } = input
    this.db.exec('BEGIN')
    try {
      this.db.prepare(
        `INSERT INTO lesson_plans (id, teacher_uid, institution_id, scene_id, topic, level, title, plan_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, teacherUid, input.institutionId ?? null, plan.sceneId, plan.topic, plan.level, plan.title, JSON.stringify(plan), now, now)
      this.replaceTasks(id, plan.modules)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return this.get(id)!
  }

  list(teacherUid: string): LessonPlanSummary[] {
    const rows = this.db.prepare(
      `SELECT id, title, scene_id, topic, level, created_at, updated_at
       FROM lesson_plans WHERE teacher_uid = ? ORDER BY updated_at DESC, created_at DESC`,
    ).all(teacherUid) as Omit<PlanRow, 'teacher_uid' | 'institution_id' | 'plan_json'>[]
    return rows.map(r => ({
      id: r.id, title: r.title, sceneId: r.scene_id, topic: r.topic,
      level: r.level as CefrLevel, createdAt: r.created_at, updatedAt: r.updated_at,
    }))
  }

  get(id: string): LessonPlanRecord | null {
    const row = this.db.prepare('SELECT * FROM lesson_plans WHERE id = ?').get(id) as PlanRow | undefined
    return row ? rowToRecord(row) : null
  }

  update(id: string, patch: { title?: string; modules?: LessonPlanModule[] }): LessonPlanRecord | null {
    const existing = this.get(id)
    if (!existing) return null
    const plan: LessonPlan = {
      ...existing.plan,
      title: patch.title ?? existing.plan.title,
      modules: patch.modules ?? existing.plan.modules,
    }
    const now = new Date().toISOString()
    this.db.exec('BEGIN')
    try {
      this.db.prepare('UPDATE lesson_plans SET title = ?, plan_json = ?, updated_at = ? WHERE id = ?')
        .run(plan.title, JSON.stringify(plan), now, id)
      if (patch.modules) this.replaceTasks(id, plan.modules)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return this.get(id)
  }

  remove(id: string): boolean {
    const res = this.db.prepare('DELETE FROM lesson_plans WHERE id = ?').run(id)
    return Number(res.changes) > 0
  }

  countTasks(planId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM lesson_tasks WHERE plan_id = ?').get(planId) as { c: number }
    return Number(row.c)
  }

  /** 先清掉再整批寫入；呼叫端負責交易。 */
  private replaceTasks(planId: string, modules: LessonPlanModule[]): void {
    this.db.prepare('DELETE FROM lesson_tasks WHERE plan_id = ?').run(planId)
    const insert = this.db.prepare(
      `INSERT INTO lesson_tasks (id, plan_id, module_id, module_label, sort_order, label, hint_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    let order = 0
    for (const mod of modules) {
      for (const task of mod.tasks) {
        insert.run(task.id, planId, mod.id, mod.label, order++, task.label, JSON.stringify(task.hint))
      }
    }
  }
}
