import { randomUUID } from 'node:crypto';
import { executeTransaction, type Tx } from '../../shared/db/transaction';
import { appendEvent } from '../../shared/events/outbox';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors/app-error';
import { detectRuleConflict } from './rule-conflict';
import {
  assertGradeNameControlled,
  classReferences,
  countClassesForGrade,
  findClass,
  findClassBySerial,
  findGrade,
  findGradeByName,
  findSubject,
  findSubjectByName,
  findVocabulary,
  gradeName,
  insertClass,
  insertGrade,
  insertSubject,
  listClasses,
  listGrades,
  listSubjects,
  listVocabulary,
  nextGradeSortOrder,
  queryRow,
  registerSubjectVocabulary,
  renameClassesForGrade,
  resolveSubjectName,
  saveSubjectRule,
  softDeleteClass,
  softDeleteGrade,
  softDeleteSubject,
  subjectReferences,
  teacherExists,
  updateClass,
  updateGrade,
  updateSubject,
} from './registry.repository';
import type {
  ClassDto,
  ControlledVocabularyDto,
  GradeDto,
  RegistryContext,
  Slot,
  SubjectDto,
  SubjectPeriodRuleDto,
  VocabularyType,
} from './registry.types';

export interface RegistryActor {
  userId: string;
}

interface PgError {
  code?: string;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as PgError).code === '23505';
}

async function inTransaction<T>(ctx: RegistryContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await ctx.pool.connect();
  try {
    return await executeTransaction(client, fn);
  } finally {
    client.release();
  }
}

function classDisplayName(grade: string, serialNo: number): string {
  return `${grade}（${serialNo}）班`;
}

function referenceProtected(label: string, count: number): ConflictError {
  return new ConflictError('REFERENCE_PROTECTED', `该数据正被${label}使用，暂时无法删除`, [
    { field: 'references', message: `${label}引用 ${count} 条` },
  ]);
}

async function assertHeadTeacher(tx: Tx, headTeacherId: string | null | undefined): Promise<void> {
  if (!headTeacherId) {
    return;
  }
  const relation = await queryRow<{ exists: boolean } & Record<string, unknown>>(
    tx,
    "SELECT to_regclass('teacher') IS NOT NULL AS exists",
  );
  if (!relation?.exists) {
    throw new ValidationError('教师主数据尚未启用，暂不能指定班主任', [
      { field: 'headTeacherId', message: 'D03 教师主数据完成后可选择班主任' },
    ]);
  }
  if (!(await teacherExists(tx, headTeacherId))) {
    throw new ValidationError('班主任不存在或已删除', [
      { field: 'headTeacherId', message: '请选择有效的教师' },
    ]);
  }
}

export async function listGradeItems(
  ctx: RegistryContext,
  page: number,
  pageSize: number,
): Promise<{ items: GradeDto[]; total: number }> {
  return listGrades(ctx.pool, page, pageSize);
}

export async function getGradeItem(ctx: RegistryContext, gradeId: string): Promise<GradeDto> {
  const grade = await findGrade(ctx.pool, gradeId);
  if (!grade) {
    throw new NotFoundError('年级不存在，可能已被删除');
  }
  return grade;
}

export async function createGradeItem(
  ctx: RegistryContext,
  actor: RegistryActor,
  input: { name: string; sortOrder?: number },
): Promise<GradeDto> {
  return inTransaction(ctx, async (tx) => {
    const name = await assertGradeNameControlled(tx, input.name);
    if (await findGradeByName(tx, name)) {
      throw new ConflictError('DUPLICATE', '该年级已存在，请勿重复添加', [
        { field: 'name', message: '年级名称重复' },
      ]);
    }
    try {
      const sortOrder = input.sortOrder ?? (await nextGradeSortOrder(tx));
      const grade = await insertGrade(tx, { name, sortOrder });
      await appendEvent(
        tx,
        {
          eventName: 'bc.registry.grade.created',
          aggregateType: 'Grade',
          aggregateId: grade.gradeId,
          payload: { gradeId: grade.gradeId, name: grade.name },
          occurredBy: actor.userId,
        },
        ctx.clock,
      );
      return grade;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('DUPLICATE', '该年级已存在，请勿重复添加', [
          { field: 'name', message: '年级名称重复' },
        ]);
      }
      throw error;
    }
  });
}

export async function updateGradeItem(
  ctx: RegistryContext,
  gradeId: string,
  input: { name?: string; sortOrder?: number; version: number },
): Promise<GradeDto> {
  return inTransaction(ctx, async (tx) => {
    const current = await findGrade(tx, gradeId);
    if (!current) {
      throw new NotFoundError('年级不存在，可能已被删除');
    }
    const values: Record<string, unknown> = {};
    let nextName = current.name;
    if (input.name !== undefined) {
      nextName = await assertGradeNameControlled(tx, input.name);
      const duplicate = await findGradeByName(tx, nextName);
      if (duplicate && duplicate.gradeId !== gradeId) {
        throw new ConflictError('DUPLICATE', '该年级已存在，请勿重复添加', [
          { field: 'name', message: '年级名称重复' },
        ]);
      }
      values.name = nextName;
    }
    if (input.sortOrder !== undefined) {
      values.sort_order = input.sortOrder;
    }
    try {
      await updateGrade(tx, gradeId, input.version, values);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('DUPLICATE', '该年级已存在，请勿重复添加', [
          { field: 'name', message: '年级名称重复' },
        ]);
      }
      throw error;
    }
    if (input.name !== undefined && nextName !== current.name) {
      await renameClassesForGrade(tx, gradeId, nextName);
    }
    const updated = await findGrade(tx, gradeId);
    if (!updated) {
      throw new NotFoundError('年级不存在，可能已被删除');
    }
    return updated;
  });
}

export async function deleteGradeItem(ctx: RegistryContext, gradeId: string): Promise<void> {
  await inTransaction(ctx, async (tx) => {
    const current = await findGrade(tx, gradeId);
    if (!current) {
      throw new NotFoundError('年级不存在，可能已被删除');
    }
    const classCount = await countClassesForGrade(tx, gradeId);
    if (classCount > 0) {
      throw new ConflictError('REFERENCE_PROTECTED', '该年级仍被班级引用，暂时无法删除', [
        { field: 'classCount', message: `仍有 ${classCount} 个班级引用该年级` },
      ]);
    }
    await softDeleteGrade(tx, gradeId);
  });
}

export async function listClassItems(
  ctx: RegistryContext,
  page: number,
  pageSize: number,
  gradeId?: string,
): Promise<{ items: ClassDto[]; total: number }> {
  return listClasses(ctx.pool, page, pageSize, gradeId);
}

export async function getClassItem(ctx: RegistryContext, classId: string): Promise<ClassDto> {
  const item = await findClass(ctx.pool, classId);
  if (!item) {
    throw new NotFoundError('班级不存在，可能已被删除');
  }
  return item;
}

export async function createClassItem(
  ctx: RegistryContext,
  actor: RegistryActor,
  input: {
    gradeId: string;
    serialNo: number;
    headTeacherId?: string | null;
    studentCount: number;
  },
): Promise<ClassDto> {
  return inTransaction(ctx, async (tx) => {
    const grade = await findGrade(tx, input.gradeId);
    if (!grade) {
      throw new NotFoundError('年级不存在，可能已被删除');
    }
    await assertHeadTeacher(tx, input.headTeacherId);
    if (await findClassBySerial(tx, input.gradeId, input.serialNo)) {
      throw new ConflictError('DUPLICATE', '该年级下已存在相同序号的班级', [
        { field: 'serialNo', message: '序号重复' },
      ]);
    }
    const classId = randomUUID();
    try {
      const created = await insertClass(tx, {
        classId,
        gradeId: input.gradeId,
        name: classDisplayName(grade.name, input.serialNo),
        serialNo: input.serialNo,
        headTeacherId: input.headTeacherId ?? null,
        studentCount: input.studentCount,
      });
      await appendEvent(
        tx,
        {
          eventName: 'bc.registry.class.created',
          aggregateType: 'Class',
          aggregateId: created.classId,
          payload: { classId: created.classId, gradeId: created.gradeId, name: created.name },
          occurredBy: actor.userId,
        },
        ctx.clock,
      );
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('DUPLICATE', '该年级下已存在相同序号的班级', [
          { field: 'serialNo', message: '序号重复' },
        ]);
      }
      throw error;
    }
  });
}

export async function updateClassItem(
  ctx: RegistryContext,
  classId: string,
  input: {
    serialNo?: number;
    headTeacherId?: string | null;
    studentCount?: number;
    version: number;
  },
): Promise<ClassDto> {
  return inTransaction(ctx, async (tx) => {
    const current = await findClass(tx, classId);
    if (!current) {
      throw new NotFoundError('班级不存在，可能已被删除');
    }
    const grade = await gradeName(tx, current.gradeId);
    if (!grade) {
      throw new NotFoundError('班级所属年级不存在');
    }
    if (input.serialNo !== undefined) {
      const duplicate = await findClassBySerial(tx, current.gradeId, input.serialNo, classId);
      if (duplicate) {
        throw new ConflictError('DUPLICATE', '该年级下已存在相同序号的班级', [
          { field: 'serialNo', message: '序号重复' },
        ]);
      }
    }
    if (input.headTeacherId !== undefined) {
      await assertHeadTeacher(tx, input.headTeacherId);
    }
    const serialNo = input.serialNo ?? current.serialNo;
    const values: Record<string, unknown> = {
      name: classDisplayName(grade, serialNo),
      serial_no: serialNo,
    };
    if (input.headTeacherId !== undefined) {
      values.head_teacher_id = input.headTeacherId;
    }
    if (input.studentCount !== undefined) {
      values.student_count = input.studentCount;
    }
    try {
      return await updateClass(tx, classId, input.version, values);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('DUPLICATE', '该年级下已存在相同序号的班级', [
          { field: 'serialNo', message: '序号重复' },
        ]);
      }
      throw error;
    }
  });
}

export async function deleteClassItem(ctx: RegistryContext, classId: string): Promise<void> {
  await inTransaction(ctx, async (tx) => {
    const current = await findClass(tx, classId);
    if (!current) {
      throw new NotFoundError('班级不存在，可能已被删除');
    }
    const references = (await classReferences(tx, classId)).filter((item) => item.count > 0);
    if (references.length > 0) {
      const first = references[0];
      throw referenceProtected(first?.label ?? '其他数据', first?.count ?? 0);
    }
    await softDeleteClass(tx, classId);
  });
}

export async function listSubjectItems(
  ctx: RegistryContext,
  page: number,
  pageSize: number,
): Promise<{ items: SubjectDto[]; total: number }> {
  return listSubjects(ctx.pool, page, pageSize);
}

export async function getSubjectItem(ctx: RegistryContext, subjectId: string): Promise<SubjectDto> {
  const subject = await findSubject(ctx.pool, subjectId);
  if (!subject) {
    throw new NotFoundError('科目不存在，可能已被删除');
  }
  return subject;
}

export async function createSubjectItem(
  ctx: RegistryContext,
  input: { name: string },
): Promise<SubjectDto> {
  return inTransaction(ctx, async (tx) => {
    const name = await resolveSubjectName(tx, input.name);
    if (await findSubjectByName(tx, name)) {
      throw new ConflictError('DUPLICATE', '该科目已存在，请勿重复添加', [
        { field: 'name', message: '科目名称重复' },
      ]);
    }
    try {
      const subject = await insertSubject(tx, name);
      if (!(await findVocabulary(tx, 'SUBJECT', name))) {
        await registerSubjectVocabulary(tx, name);
      }
      return subject;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('DUPLICATE', '该科目已存在，请勿重复添加', [
          { field: 'name', message: '科目名称重复' },
        ]);
      }
      throw error;
    }
  });
}

export async function updateSubjectItem(
  ctx: RegistryContext,
  subjectId: string,
  input: { name?: string; version: number },
): Promise<SubjectDto> {
  return inTransaction(ctx, async (tx) => {
    const current = await findSubject(tx, subjectId);
    if (!current) {
      throw new NotFoundError('科目不存在，可能已被删除');
    }
    if (input.name === undefined) {
      return current;
    }
    const name = await resolveSubjectName(tx, input.name);
    const duplicate = await findSubjectByName(tx, name);
    if (duplicate && duplicate.subjectId !== subjectId) {
      throw new ConflictError('DUPLICATE', '该科目已存在，请勿重复添加', [
        { field: 'name', message: '科目名称重复' },
      ]);
    }
    try {
      const updated = await updateSubject(tx, subjectId, input.version, name);
      if (!(await findVocabulary(tx, 'SUBJECT', name))) {
        await registerSubjectVocabulary(tx, name);
      }
      return updated;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('DUPLICATE', '该科目已存在，请勿重复添加', [
          { field: 'name', message: '科目名称重复' },
        ]);
      }
      throw error;
    }
  });
}

export async function deleteSubjectItem(ctx: RegistryContext, subjectId: string): Promise<void> {
  await inTransaction(ctx, async (tx) => {
    const current = await findSubject(tx, subjectId);
    if (!current) {
      throw new NotFoundError('科目不存在，可能已被删除');
    }
    const references = (await subjectReferences(tx, subjectId)).filter((item) => item.count > 0);
    if (references.length > 0) {
      const first = references[0];
      throw referenceProtected(first?.label ?? '其他数据', first?.count ?? 0);
    }
    await softDeleteSubject(tx, subjectId);
  });
}

export async function saveSubjectRuleItem(
  ctx: RegistryContext,
  actor: RegistryActor,
  subjectId: string,
  input: {
    weeklyPeriods: number;
    consecutivePreference: SubjectPeriodRuleDto['consecutivePreference'];
    forbiddenSlots: Slot[];
    timeSlotPreference: SubjectPeriodRuleDto['timeSlotPreference'];
    periodBalanceEnabled: boolean;
    amPmBalanceEnabled: boolean;
    fixedSlotRuleEnabled: boolean;
    version?: number;
  },
): Promise<SubjectPeriodRuleDto> {
  return inTransaction(ctx, async (tx) => {
    const subject = await findSubject(tx, subjectId);
    if (!subject) {
      throw new NotFoundError('科目不存在，可能已被删除');
    }
    const conflict = detectRuleConflict({
      weeklyPeriods: input.weeklyPeriods,
      consecutivePreference: input.consecutivePreference,
      forbiddenSlots: input.forbiddenSlots,
      timeSlotPreference: input.timeSlotPreference,
      fixedSlotRuleEnabled: input.fixedSlotRuleEnabled,
    });
    if (conflict) {
      throw new ConflictError('STATE_CONFLICT', conflict.message, conflict.details);
    }
    const rule = await saveSubjectRule(tx, subjectId, input);
    await appendEvent(
      tx,
      {
        eventName: 'bc.registry.subject.rule-configured',
        aggregateType: 'SubjectPeriodRule',
        aggregateId: rule.ruleId,
        payload: {
          subjectId: rule.subjectId,
          ruleId: rule.ruleId,
          weeklyPeriods: rule.weeklyPeriods,
        },
        occurredBy: actor.userId,
      },
      ctx.clock,
    );
    return rule;
  });
}

export async function listVocabularyItems(
  ctx: RegistryContext,
  type: VocabularyType,
  page: number,
  pageSize: number,
): Promise<{ items: ControlledVocabularyDto[]; total: number }> {
  return listVocabulary(ctx.pool, type, page, pageSize);
}
