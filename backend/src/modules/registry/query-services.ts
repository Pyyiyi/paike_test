import type { Pool, QueryResultRow } from 'pg';
import { queryRow, queryRows } from './registry.repository';
import type {
  ClassSnapshot,
  ConsecutivePreference,
  Slot,
  SubjectPeriodRuleSnapshot,
  SubjectSnapshot,
  TimeSlotPreference,
} from './registry.types';

/** D05 只依赖本接口，不直接接触 registry 实体或表。 */
export interface ClassQueryService {
  listClasses(): Promise<ClassSnapshot[]>;
  listClassesByGrade(gradeId: string): Promise<ClassSnapshot[]>;
  getClass(classId: string): Promise<ClassSnapshot | null>;
}

/** D05 只依赖本接口读取科目与课时规则快照。 */
export interface SubjectQueryService {
  listSubjects(): Promise<SubjectSnapshot[]>;
  getSubject(subjectId: string): Promise<SubjectSnapshot | null>;
  listPeriodRules(): Promise<SubjectPeriodRuleSnapshot[]>;
  getPeriodRule(subjectId: string): Promise<SubjectPeriodRuleSnapshot | null>;
}

interface ClassSnapshotRow extends QueryResultRow {
  class_id: string;
  grade_id: string;
  grade_name: string;
  name: string;
  serial_no: number;
  head_teacher_id: string | null;
  student_count: number;
}

interface SubjectSnapshotRow extends QueryResultRow {
  subject_id: string;
  name: string;
}

interface RuleSnapshotRow extends QueryResultRow {
  rule_id: string;
  subject_id: string;
  weekly_periods: number;
  consecutive_preference: ConsecutivePreference;
  forbidden_slots: Slot[];
  time_slot_preference: TimeSlotPreference;
  period_balance_enabled: boolean;
  am_pm_balance_enabled: boolean;
  fixed_slot_rule_enabled: boolean;
}

function mapClass(row: ClassSnapshotRow): ClassSnapshot {
  return {
    classId: row.class_id,
    gradeId: row.grade_id,
    gradeName: row.grade_name,
    name: row.name,
    serialNo: row.serial_no,
    headTeacherId: row.head_teacher_id,
    studentCount: row.student_count,
  };
}

function mapRule(row: RuleSnapshotRow): SubjectPeriodRuleSnapshot {
  return {
    ruleId: row.rule_id,
    subjectId: row.subject_id,
    weeklyPeriods: row.weekly_periods,
    consecutivePreference: row.consecutive_preference,
    forbiddenSlots: row.forbidden_slots ?? [],
    timeSlotPreference: row.time_slot_preference,
    periodBalanceEnabled: row.period_balance_enabled,
    amPmBalanceEnabled: row.am_pm_balance_enabled,
    fixedSlotRuleEnabled: row.fixed_slot_rule_enabled,
  };
}

const CLASS_SQL = `
  SELECT c.class_id, c.grade_id, g.name AS grade_name, c.name, c.serial_no,
         c.head_teacher_id, c.student_count
    FROM class c
    JOIN grade g ON g.grade_id = c.grade_id AND g.deleted_at IS NULL
   WHERE c.deleted_at IS NULL`;

export function createClassQueryService(pool: Pool): ClassQueryService {
  return {
    async listClasses(): Promise<ClassSnapshot[]> {
      const rows = await queryRows<ClassSnapshotRow>(
        pool,
        `${CLASS_SQL} ORDER BY g.sort_order, g.name, c.serial_no`,
      );
      return rows.map(mapClass);
    },
    async listClassesByGrade(gradeId: string): Promise<ClassSnapshot[]> {
      const rows = await queryRows<ClassSnapshotRow>(
        pool,
        `${CLASS_SQL} AND c.grade_id = $1 ORDER BY c.serial_no`,
        [gradeId],
      );
      return rows.map(mapClass);
    },
    async getClass(classId: string): Promise<ClassSnapshot | null> {
      const row = await queryRow<ClassSnapshotRow>(pool, `${CLASS_SQL} AND c.class_id = $1`, [
        classId,
      ]);
      return row ? mapClass(row) : null;
    },
  };
}

export function createSubjectQueryService(pool: Pool): SubjectQueryService {
  return {
    async listSubjects(): Promise<SubjectSnapshot[]> {
      const rows = await queryRows<SubjectSnapshotRow>(
        pool,
        `SELECT subject_id, name FROM subject WHERE deleted_at IS NULL ORDER BY name`,
      );
      return rows.map((row) => ({ subjectId: row.subject_id, name: row.name }));
    },
    async getSubject(subjectId: string): Promise<SubjectSnapshot | null> {
      const row = await queryRow<SubjectSnapshotRow>(
        pool,
        `SELECT subject_id, name FROM subject WHERE subject_id = $1 AND deleted_at IS NULL`,
        [subjectId],
      );
      return row ? { subjectId: row.subject_id, name: row.name } : null;
    },
    async listPeriodRules(): Promise<SubjectPeriodRuleSnapshot[]> {
      const rows = await queryRows<RuleSnapshotRow>(
        pool,
        `SELECT rule_id, subject_id, weekly_periods, consecutive_preference, forbidden_slots,
                time_slot_preference, period_balance_enabled, am_pm_balance_enabled,
                fixed_slot_rule_enabled
           FROM subject_period_rule`,
      );
      return rows.map(mapRule);
    },
    async getPeriodRule(subjectId: string): Promise<SubjectPeriodRuleSnapshot | null> {
      const row = await queryRow<RuleSnapshotRow>(
        pool,
        `SELECT rule_id, subject_id, weekly_periods, consecutive_preference, forbidden_slots,
                time_slot_preference, period_balance_enabled, am_pm_balance_enabled,
                fixed_slot_rule_enabled
           FROM subject_period_rule WHERE subject_id = $1`,
        [subjectId],
      );
      return row ? mapRule(row) : null;
    },
  };
}
