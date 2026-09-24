import type { DatabaseSync } from 'node:sqlite'
import type { DialogueTask, DialogueTaskRecord, DialogueTaskSummary } from '../dialogueTaskTypes.js'

interface TaskRow {
  id: string
  teacher_uid: string
  institution_id: string | null
  scene_id: string
  title: string
  task_json: string
  created_at: string
  updated_at: string
}

function rowToRecord(row: TaskRow): DialogueTaskRecord {
  return {
    id: row.id,
    teacherUid: row.teacher_uid,
    institutionId: row.institution_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    task: JSON.parse(row.task_json) as DialogueTask,
  }
}

export class DialogueTaskRepo {
  constructor(private readonly db: DatabaseSync) {}

  create(input: { id: string; teacherUid: string; institutionId?: string | null; task: DialogueTask }): DialogueTaskRecord {
    const now = new Date().toISOString()
    const { id, teacherUid, task } = input
    this.db.prepare(
      `INSERT INTO dialogue_tasks (id, teacher_uid, institution_id, scene_id, title, task_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, teacherUid, input.institutionId ?? null, task.sceneId, task.title, JSON.stringify(task), now, now)
    return this.get(id)!
  }

  list(teacherUid: string): DialogueTaskSummary[] {
    const rows = this.db.prepare(
      'SELECT * FROM dialogue_tasks WHERE teacher_uid = ? ORDER BY updated_at DESC, created_at DESC',
    ).all(teacherUid) as unknown as TaskRow[]
    return rows.map(r => {
      const task = JSON.parse(r.task_json) as DialogueTask
      return {
        id: r.id, title: r.title, sceneId: r.scene_id, level: task.level, stepCount: task.steps.length,
        createdAt: r.created_at, updatedAt: r.updated_at,
      }
    })
  }

  get(id: string): DialogueTaskRecord | null {
    const row = this.db.prepare('SELECT * FROM dialogue_tasks WHERE id = ?').get(id) as TaskRow | undefined
    return row ? rowToRecord(row) : null
  }

  /** 整份覆寫（編輯器一次送出完整內容） */
  update(id: string, task: DialogueTask): DialogueTaskRecord | null {
    const now = new Date().toISOString()
    const res = this.db.prepare('UPDATE dialogue_tasks SET scene_id = ?, title = ?, task_json = ?, updated_at = ? WHERE id = ?')
      .run(task.sceneId, task.title, JSON.stringify(task), now, id)
    return Number(res.changes) > 0 ? this.get(id) : null
  }

  remove(id: string): boolean {
    const res = this.db.prepare('DELETE FROM dialogue_tasks WHERE id = ?').run(id)
    return Number(res.changes) > 0
  }
}
