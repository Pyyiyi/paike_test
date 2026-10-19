import type { Pool, QueryResultRow } from 'pg';
import { ConflictError, NotFoundError, ValidationError, VersionConflictError } from '../../shared/errors/app-error';
import { updateWithVersion } from '../../shared/db/optimistic';
import type { Tx } from '../../shared/db/transaction';
import type {
  ClassDto,
  ConsecutivePreference,
  ControlledVocabularyDto,
  GradeDto,
  Slot,
  SubjectDto,
  SubjectPeriodRuleDto,
  TimeSlotPreference,
  VocabularyType,
} from './registry.types';

export type Db = Pool | Tx;

function isTx(db: Db): db is Tx {
  return typeof (db as Tx).queryOne === 'function';
}

export async function queryRows<T extends QueryResultRow>(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (isTx(db)) {
    return db.query<T>(sql, params);
  }
  const result = await db.query<T>(sql, params);
  return result.rows;
}

export async function queryRow<T extends QueryResultRow>(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await queryRows<T>(db, sql, params);
  return rows[0] ?? null;
}

interface CountRow extends QueryResultRow {
  count: number;
}

interface GradeRow extends QueryResultRow {
  grade_id: string;
  name: string;
  sort_order: number;
  class_count: number;
  version: number;
}

interface ClassRow extends QueryResultRow {
  class_id: string;
  grade_id: string;
  name: string;
  serial_no: number;
  head_teacher_id: string | null;
  student_count: number;
  version: number;
}

interface SubjectRow extends QueryResultRow {
  subject_id: string;
  name: string;
  version: number;
  rule_id: string | null;
  weekly_periods: number | null;
  consecutive_preference: ConsecutivePreference | null;
  forbidden_slots: Slot[] | null;
  time_slot_preference: TimeSlotPreference | null;
  period_balance_enabled: boolean | null;
  am_pm_balance_enabled: boolean | null;
  fixed_slot_rule_enabled: boolean | null;
  rule_version: number | null;
}

interface RuleRow extends QueryResultRow {
  rule_id: string;
  subject_id: string;
  weekly_periods: number;
  consecutive_preference: ConsecutivePreference;
  forbidden_slots: Slot[];
  time_slot_preference: TimeSlotPreference;
  period_balance_enabled: boolean;
  am_pm_balance_enabled: boolean;
  fixed_slot_rule_enabled: boolean;
  version: number;
}

interface VocabularyRow extends QueryResultRow {
  vocabulary_id: string;
  canonical_name: string;
  synonyms: string[] | null;
  is_active: boolean;
}

function mapGrade(row: GradeRow): GradeDto {
  return {
    gradeId: row.grade_id,
    name: row.name,
    sortOrder: row.sort_order,
    classCount: row.class_count,
    version: row.version,
  };
}

function mapClass(row: ClassRow): ClassDto {
  return {
    classId: row.class_id,
    gradeId: row.grade_id,
    name: row.name,
    serialNo: row.serial_no,
    headTeacherId: row.head_teacher_id,
    studentCount: row.student_count,
    version: row.version,
  };
}

function mapRule(row: RuleRow): SubjectPeriodRuleDto {
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
    version: row.version,
  };
}

function mapSubject(row: SubjectRow): SubjectDto {
  const periodRule =
    row.rule_id === null
      ? null
      : mapRule({
          rule_id: row.rule_id,
          subject_id: row.subject_id,
          weekly_periods: row.weekly_periods ?? 0,
          consecutive_preference: row.consecutive_preference ?? 'NONE',
          forbidden_slots: row.forbidden_slots ?? [],
          time_slot_preference: row.time_slot_preference ?? 'NONE',
          period_balance_enabled: row.period_balance_enabled ?? false,
          am_pm_balance_enabled: row.am_pm_balance_enabled ?? false,
          fixed_slot_rule_enabled: row.fixed_slot_rule_enabled ?? false,
          version: row.rule_version ?? 1,
        });
  return {
    subjectId: row.subject_id,
    name: row.name,
    periodRule,
    version: row.version,
  };
}

const SUBJECT_SELECT = `
  SELECT s.subject_id, s.name, s.version,
         r.rule_id, r.weekly_periods, r.consecutive_preference, r.forbidden_slots,
         r.time_slot_preference, r.period_balance_enabled, r.am_pm_balance_enabled,
         r.fixed_slot_rule_enabled, r.version AS rule_version
    FROM subject s
    LEFT JOIN subject_period_rule r ON r.subject_id = s.subject_id
   WHERE s.deleted_at IS NULL`;

export async function listGrades(
  db: Db,
  page: number,
  pageSize: number,
): Promise<{ items: GradeDto[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const rows = await queryRows<GradeRow>(
    db,
    `SELECT g.grade_id, g.name, g.sort_order, g.version,
            COALESCE(c.class_count, 0)::int AS class_count
       FROM grade g
       LEFT JOIN (
         SELECT grade_id, count(*)::int AS class_count
           FROM class
          WHERE deleted_at IS NULL
          GROUP BY grade_id
       ) c ON c.grade_id = g.grade_id
      WHERE g.deleted_at IS NULL
      ORDER BY g.sort_order, g.name
      LIMIT $1 OFFSET $2`,
    [pageSize, offset],
  );
  const totalRow = await queryRow<CountRow>(
    db,
    'SELECT count(*)::int AS count FROM grade WHERE deleted_at IS NULL',
  );
  return { items: rows.map(mapGrade), total: totalRow?.count ?? 0 };
}

export async function findGrade(db: Db, gradeId: string): Promise<GradeDto | null> {
  const row = await queryRow<GradeRow>(
    db,
    `SELECT g.grade_id, g.name, g.sort_order, g.version,
            COALESCE(c.class_count, 0)::int AS class_count
       FROM grade g
       LEFT JOIN (
         SELECT grade_id, count(*)::int AS class_count
           FROM class
          WHERE deleted_at IS NULL
          GROUP BY grade_id
       ) c ON c.grade_id = g.grade_id
      WHERE g.grade_id = $1 AND g.deleted_at IS NULL`,
    [gradeId],
  );
  return row ? mapGrade(row) : null;
}

export async function insertGrade(
  tx: Tx,
  input: { name: string; sortOrder: number },
): Promise<GradeDto> {
  const row = await queryRow<GradeRow>(
    tx,
    `INSERT INTO grade (name, sort_order)
     VALUES ($1, $2)
     RETURNING grade_id, name, sort_order, version, 0 AS class_count`,
    [input.name, input.sortOrder],
  );
  if (!row) {
    throw new Error('新增年级未返回记录');
  }
  return mapGrade(row);
}

export async function updateGrade(
  tx: Tx,
  gradeId: string,
  expectedVersion: number,
  values: Record<string, unknown>,
): Promise<GradeDto> {
  const row = await updateWithVersion<GradeRow>(tx, {
    table: 'grade',
    idColumn: 'grade_id',
    id: gradeId,
    expectedVersion,
    values,
    returning: 'grade_id, name, sort_order, version, 0 AS class_count',
  });
  return mapGrade(row);
}

export async function softDeleteGrade(tx: Tx, gradeId: string): Promise<void> {
  await tx.query('UPDATE grade SET deleted_at = now() WHERE grade_id = $1 AND deleted_at IS NULL', [
    gradeId,
  ]);
}

export async function countClassesForGrade(tx: Tx, gradeId: string): Promise<number> {
  const row = await queryRow<CountRow>(
    tx,
    'SELECT count(*)::int AS count FROM class WHERE grade_id = $1 AND deleted_at IS NULL',
    [gradeId],
  );
  return row?.count ?? 0;
}

export async function renameClassesForGrade(
  tx: Tx,
  gradeId: string,
  gradeName: string,
): Promise<void> {
  await tx.query(
    `UPDATE class
        SET name = $2 || '（' || serial_no || '）班',
            version = version + 1
      WHERE grade_id = $1 AND deleted_at IS NULL`,
    [gradeId, gradeName],
  );
}

export async function listClasses(
  db: Db,
  page: number,
  pageSize: number,
  gradeId?: string,
): Promise<{ items: ClassDto[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const filterParams: unknown[] = [];
  const conditions = ['c.deleted_at IS NULL'];
  if (gradeId) {
    filterParams.push(gradeId);
    conditions.push(`c.grade_id = $${filterParams.length}`);
  }
  const where = conditions.join(' AND ');
  const limitParam = filterParams.length + 1;
  const offsetParam = filterParams.length + 2;
  const rows = await queryRows<ClassRow>(
    db,
    `SELECT c.class_id, c.grade_id, c.name, c.serial_no, c.head_teacher_id,
            c.student_count, c.version
       FROM class c
      WHERE ${where}
      ORDER BY c.grade_id, c.serial_no
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    [...filterParams, pageSize, offset],
  );
  const totalRow = await queryRow<CountRow>(
    db,
    `SELECT count(*)::int AS count FROM class c WHERE ${where}`,
    filterParams,
  );
  return { items: rows.map(mapClass), total: totalRow?.count ?? 0 };
}

export async function findClass(db: Db, classId: string): Promise<ClassDto | null> {
  const row = await queryRow<ClassRow>(
    db,
    `SELECT class_id, grade_id, name, serial_no, head_teacher_id, student_count, version
       FROM class
      WHERE class_id = $1 AND deleted_at IS NULL`,
    [classId],
  );
  return row ? mapClass(row) : null;
}

export async function insertClass(
  tx: Tx,
  input: {
    classId: string;
    gradeId: string;
    name: string;
    serialNo: number;
    headTeacherId: string | null;
    studentCount: number;
  },
): Promise<ClassDto> {
  const row = await queryRow<ClassRow>(
    tx,
    `INSERT INTO class (class_id, grade_id, name, serial_no, head_teacher_id, student_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING class_id, grade_id, name, serial_no, head_teacher_id, student_count, version`,
    [input.classId, input.gradeId, input.name, input.serialNo, input.headTeacherId, input.studentCount],
  );
  if (!row) {
    throw new Error('新增班级未返回记录');
  }
  return mapClass(row);
}

export async function updateClass(
  tx: Tx,
  classId: string,
  expectedVersion: number,
  values: Record<string, unknown>,
): Promise<ClassDto> {
  const row = await updateWithVersion<ClassRow>(tx, {
    table: 'class',
    idColumn: 'class_id',
    id: classId,
    expectedVersion,
    values,
    returning:
      'class_id, grade_id, name, serial_no, head_teacher_id, student_count, version',
  });
  return mapClass(row);
}

export async function softDeleteClass(tx: Tx, classId: string): Promise<void> {
  await tx.query('UPDATE class SET deleted_at = now() WHERE class_id = $1 AND deleted_at IS NULL', [
    classId,
  ]);
}

export async function gradeName(tx: Tx, gradeId: string): Promise<string | null> {
  const row = await queryRow<{ name: string } & QueryResultRow>(
    tx,
    'SELECT name FROM grade WHERE grade_id = $1 AND deleted_at IS NULL',
    [gradeId],
  );
  return row?.name ?? null;
}

export interface ReferenceCheck {
  table: string;
  label: string;
  count: number;
}

async function tableExists(tx: Tx, table: string): Promise<boolean> {
  const row = await queryRow<{ exists: boolean } & QueryResultRow>(
    tx,
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [table],
  );
  return row?.exists ?? false;
}

async function countReference(
  tx: Tx,
  table: string,
  label: string,
  sql: string,
  params: unknown[],
): Promise<ReferenceCheck> {
  if (!(await tableExists(tx, table))) {
    return { table, label, count: 0 };
  }
  const row = await queryRow<CountRow>(tx, sql, params);
  return { table, label, count: row?.count ?? 0 };
}

export async function classReferences(tx: Tx, classId: string): Promise<ReferenceCheck[]> {
  return Promise.all([
    countReference(
      tx,
      'teaching_assignment',
      '任课',
      'SELECT count(*)::int AS count FROM teaching_assignment WHERE class_id = $1 AND deleted_at IS NULL',
      [classId],
    ),
    countReference(
      tx,
      'combined_class_member',
      '合班课',
      'SELECT count(*)::int AS count FROM combined_class_member WHERE class_id = $1',
      [classId],
    ),
    countReference(
      tx,
      'walking_group_member',
      '走班',
      'SELECT count(*)::int AS count FROM walking_group_member WHERE class_id = $1',
      [classId],
    ),
    countReference(
      tx,
      'lesson_class',
      '课次',
      'SELECT count(*)::int AS count FROM lesson_class WHERE class_id = $1',
      [classId],
    ),
  ]);
}

export async function subjectReferences(tx: Tx, subjectId: string): Promise<ReferenceCheck[]> {
  return Promise.all([
    countReference(
      tx,
      'teaching_assignment',
      '任课',
      'SELECT count(*)::int AS count FROM teaching_assignment WHERE subject_id = $1 AND deleted_at IS NULL',
      [subjectId],
    ),
    countReference(
      tx,
      'walking_group',
      '走班',
      'SELECT count(*)::int AS count FROM walking_group WHERE subject_id = $1 AND deleted_at IS NULL',
      [subjectId],
    ),
    countReference(
      tx,
      'lesson',
      '课次',
      'SELECT count(*)::int AS count FROM lesson WHERE subject_id = $1',
      [subjectId],
    ),
  ]);
}

export async function listSubjects(
  db: Db,
  page: number,
  pageSize: number,
): Promise<{ items: SubjectDto[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const rows = await queryRows<SubjectRow>(
    db,
    `${SUBJECT_SELECT}
      ORDER BY s.name
      LIMIT $1 OFFSET $2`,
    [pageSize, offset],
  );
  const totalRow = await queryRow<CountRow>(
    db,
    'SELECT count(*)::int AS count FROM subject WHERE deleted_at IS NULL',
  );
  return { items: rows.map(mapSubject), total: totalRow?.count ?? 0 };
}

export async function findSubject(db: Db, subjectId: string): Promise<SubjectDto | null> {
  const row = await queryRow<SubjectRow>(db, `${SUBJECT_SELECT} AND s.subject_id = $1`, [subjectId]);
  return row ? mapSubject(row) : null;
}

export async function findSubjectByName(db: Db, name: string): Promise<SubjectDto | null> {
  const row = await queryRow<SubjectRow>(db, `${SUBJECT_SELECT} AND lower(s.name) = lower($1)`, [name]);
  return row ? mapSubject(row) : null;
}

export async function insertSubject(tx: Tx, name: string): Promise<SubjectDto> {
  const row = await queryRow<SubjectRow>(
    tx,
    `WITH inserted AS (
       INSERT INTO subject (name) VALUES ($1)
       RETURNING subject_id, name, version
     )
     SELECT inserted.subject_id, inserted.name, inserted.version,
            NULL::uuid AS rule_id, NULL::int AS weekly_periods,
            NULL::consecutive_preference AS consecutive_preference,
            NULL::jsonb AS forbidden_slots, NULL::time_slot_preference AS time_slot_preference,
            NULL::boolean AS period_balance_enabled, NULL::boolean AS am_pm_balance_enabled,
            NULL::boolean AS fixed_slot_rule_enabled, NULL::int AS rule_version
       FROM inserted`,
    [name],
  );
  if (!row) {
    throw new Error('新增科目未返回记录');
  }
  return mapSubject(row);
}

export async function updateSubject(
  tx: Tx,
  subjectId: string,
  expectedVersion: number,
  name: string,
): Promise<SubjectDto> {
  await updateWithVersion(tx, {
    table: 'subject',
    idColumn: 'subject_id',
    id: subjectId,
    expectedVersion,
    values: { name },
    returning: 'subject_id',
  });
  const subject = await findSubject(tx, subjectId);
  if (!subject) {
    throw new NotFoundError();
  }
  return subject;
}

export async function softDeleteSubject(tx: Tx, subjectId: string): Promise<void> {
  await tx.query('UPDATE subject SET deleted_at = now() WHERE subject_id = $1 AND deleted_at IS NULL', [
    subjectId,
  ]);
  await tx.query('DELETE FROM subject_period_rule WHERE subject_id = $1', [subjectId]);
}

export async function findSubjectRule(db: Db, subjectId: string): Promise<SubjectPeriodRuleDto | null> {
  const row = await queryRow<RuleRow>(
    db,
    `SELECT rule_id, subject_id, weekly_periods, consecutive_preference, forbidden_slots,
            time_slot_preference, period_balance_enabled, am_pm_balance_enabled,
            fixed_slot_rule_enabled, version
       FROM subject_period_rule WHERE subject_id = $1`,
    [subjectId],
  );
  return row ? mapRule(row) : null;
}

export interface SaveRuleInput {
  weeklyPeriods: number;
  consecutivePreference: ConsecutivePreference;
  forbiddenSlots: Slot[];
  timeSlotPreference: TimeSlotPreference;
  periodBalanceEnabled: boolean;
  amPmBalanceEnabled: boolean;
  fixedSlotRuleEnabled: boolean;
  version?: number;
}

export async function saveSubjectRule(
  tx: Tx,
  subjectId: string,
  input: SaveRuleInput,
): Promise<SubjectPeriodRuleDto> {
  const existing = await queryRow<RuleRow>(
    tx,
    'SELECT * FROM subject_period_rule WHERE subject_id = $1 FOR UPDATE',
    [subjectId],
  );

  if (existing) {
    if (input.version !== undefined && input.version !== existing.version) {
      throw new VersionConflictError();
    }
    const row = await queryRow<RuleRow>(
      tx,
      `UPDATE subject_period_rule
          SET weekly_periods = $2,
              consecutive_preference = $3,
              forbidden_slots = $4::jsonb,
              time_slot_preference = $5,
              period_balance_enabled = $6,
              am_pm_balance_enabled = $7,
              fixed_slot_rule_enabled = $8,
              version = version + 1
        WHERE rule_id = $1
        RETURNING *`,
      [
        existing.rule_id,
        input.weeklyPeriods,
        input.consecutivePreference,
        JSON.stringify(input.forbiddenSlots),
        input.timeSlotPreference,
        input.periodBalanceEnabled,
        input.amPmBalanceEnabled,
        input.fixedSlotRuleEnabled,
      ],
    );
    if (!row) {
      throw new VersionConflictError();
    }
    return mapRule(row);
  }

  const row = await queryRow<RuleRow>(
    tx,
    `INSERT INTO subject_period_rule
       (subject_id, weekly_periods, consecutive_preference, forbidden_slots,
        time_slot_preference, period_balance_enabled, am_pm_balance_enabled,
        fixed_slot_rule_enabled)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
     RETURNING *`,
    [
      subjectId,
      input.weeklyPeriods,
      input.consecutivePreference,
      JSON.stringify(input.forbiddenSlots),
      input.timeSlotPreference,
      input.periodBalanceEnabled,
      input.amPmBalanceEnabled,
      input.fixedSlotRuleEnabled,
    ],
  );
  if (!row) {
    throw new Error('保存课时规则未返回记录');
  }
  return mapRule(row);
}

export async function findVocabulary(
  db: Db,
  type: VocabularyType,
  name: string,
): Promise<{ canonicalName: string } | null> {
  const row = await queryRow<{ canonical_name: string } & QueryResultRow>(
    db,
    `SELECT canonical_name FROM sys_controlled_vocabulary
      WHERE vocab_type = $1 AND is_active = true AND lower(canonical_name) = lower($2)`,
    [type, name],
  );
  return row ? { canonicalName: row.canonical_name } : null;
}

export async function findSynonym(
  db: Db,
  name: string,
): Promise<{ canonicalName: string; synonymOf: string } | null> {
  const row = await queryRow<{ canonical_name: string; synonym_of: string } & QueryResultRow>(
    db,
    `SELECT canonical_name, synonym_of FROM sys_controlled_vocabulary
      WHERE vocab_type = 'SUBJECT_SYNONYM' AND is_active = true
        AND lower(canonical_name) = lower($1)`,
    [name],
  );
  return row ? { canonicalName: row.canonical_name, synonymOf: row.synonym_of } : null;
}

export async function registerSubjectVocabulary(tx: Tx, name: string): Promise<void> {
  const sortRow = await queryRow<{ next_sort: number } & QueryResultRow>(
    tx,
    `SELECT COALESCE(max(sort_order), 0) + 10 AS next_sort
       FROM sys_controlled_vocabulary WHERE vocab_type = 'SUBJECT'`,
  );
  await tx.query(
    `INSERT INTO sys_controlled_vocabulary (vocab_type, canonical_name, sort_order, is_active)
     VALUES ('SUBJECT', $1, $2, true)
     ON CONFLICT (vocab_type, canonical_name) DO NOTHING`,
    [name, sortRow?.next_sort ?? 10],
  );
}

export async function listVocabulary(
  db: Db,
  type: VocabularyType,
  page: number,
  pageSize: number,
): Promise<{ items: ControlledVocabularyDto[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const rows = await queryRows<VocabularyRow>(
    db,
    `SELECT v.vocabulary_id, v.canonical_name, v.is_active,
            CASE WHEN v.vocab_type = 'SUBJECT' THEN (
              SELECT array_agg(s.canonical_name ORDER BY s.canonical_name)
                FROM sys_controlled_vocabulary s
               WHERE s.vocab_type = 'SUBJECT_SYNONYM' AND s.is_active = true
                 AND s.synonym_of = v.canonical_name
            ) ELSE NULL END AS synonyms
       FROM sys_controlled_vocabulary v
      WHERE v.vocab_type = $1 AND v.is_active = true
      ORDER BY v.sort_order, v.canonical_name
      LIMIT $2 OFFSET $3`,
    [type, pageSize, offset],
  );
  const totalRow = await queryRow<CountRow>(
    db,
    `SELECT count(*)::int AS count FROM sys_controlled_vocabulary
      WHERE vocab_type = $1 AND is_active = true`,
    [type],
  );
  return {
    items: rows.map((row) => ({
      vocabId: row.vocabulary_id,
      type,
      name: row.canonical_name,
      synonyms: row.synonyms ?? [],
      isActive: row.is_active,
    })),
    total: totalRow?.count ?? 0,
  };
}

export async function assertGradeNameControlled(
  db: Db,
  name: string,
): Promise<string> {
  const vocabulary = await findVocabulary(db, 'GRADE', name);
  if (!vocabulary) {
    throw new ValidationError('年级名称必须从受控词表选择', [
      { field: 'name', message: '请从受控词表选择年级名称，不得输入自由文本' },
    ]);
  }
  return vocabulary.canonicalName;
}

export async function resolveSubjectName(db: Db, name: string): Promise<string> {
  const synonym = await findSynonym(db, name);
  if (synonym) {
    throw new ConflictError(
      'DUPLICATE',
      `科目名称与已有科目同义，请使用规范名称「${synonym.synonymOf}」`,
      [{ field: 'name', message: `「${name}」是「${synonym.synonymOf}」的同义词` }],
    );
  }
  const vocabulary = await findVocabulary(db, 'SUBJECT', name);
  return vocabulary?.canonicalName ?? name;
}

export async function findGradeByName(db: Db, name: string): Promise<GradeDto | null> {
  const row = await queryRow<GradeRow>(
    db,
    `SELECT g.grade_id, g.name, g.sort_order, g.version, 0::int AS class_count
       FROM grade g
      WHERE lower(g.name) = lower($1) AND g.deleted_at IS NULL`,
    [name],
  );
  return row ? mapGrade(row) : null;
}

export async function findClassBySerial(
  db: Db,
  gradeId: string,
  serialNo: number,
  excludeClassId?: string,
): Promise<ClassDto | null> {
  const params: unknown[] = [gradeId, serialNo];
  let extra = '';
  if (excludeClassId) {
    params.push(excludeClassId);
    extra = ` AND class_id <> $${params.length}`;
  }
  const row = await queryRow<ClassRow>(
    db,
    `SELECT class_id, grade_id, name, serial_no, head_teacher_id, student_count, version
       FROM class
      WHERE grade_id = $1 AND serial_no = $2 AND deleted_at IS NULL${extra}`,
    params,
  );
  return row ? mapClass(row) : null;
}

export async function teacherExists(db: Db, teacherId: string): Promise<boolean> {
  const table = await queryRow<{ exists: boolean } & QueryResultRow>(
    db,
    "SELECT to_regclass('teacher') IS NOT NULL AS exists",
  );
  if (!table?.exists) {
    return false;
  }
  const row = await queryRow<{ teacher_id: string } & QueryResultRow>(
    db,
    'SELECT teacher_id FROM teacher WHERE teacher_id = $1 AND deleted_at IS NULL',
    [teacherId],
  );
  return Boolean(row);
}

export async function nextGradeSortOrder(db: Db): Promise<number> {
  const row = await queryRow<{ next_sort: number } & QueryResultRow>(
    db,
    'SELECT COALESCE(max(sort_order), 0) + 10 AS next_sort FROM grade WHERE deleted_at IS NULL',
  );
  return row?.next_sort ?? 10;
}
