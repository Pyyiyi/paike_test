import type { Pool, QueryResultRow } from 'pg';

interface TeacherNameRow extends QueryResultRow {
  teacher_id: string;
  name: string;
}

export interface TeacherNameSource {
  getNames(teacherIds: string[]): Promise<Map<string, string>>;
}

/** D03 read boundary: statistics only needs stable teacher display names. */
export class TeacherQueryService implements TeacherNameSource {
  constructor(private readonly pool: Pool) {}

  async getNames(teacherIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(teacherIds)];
    if (ids.length === 0) {
      return new Map();
    }

    const result = await this.pool.query<TeacherNameRow>(
      `SELECT teacher_id, name
         FROM teacher
        WHERE teacher_id = ANY($1::uuid[])
          AND deleted_at IS NULL`,
      [ids],
    );
    return new Map(result.rows.map((row) => [row.teacher_id, row.name]));
  }
}
