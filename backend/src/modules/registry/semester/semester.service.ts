import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ConflictError, NotFoundError, ValidationError, VersionConflictError } from '../../../shared/errors/app-error';
import { guardVersion } from '../../../shared/db/optimistic';
import { withTransactionOn, type Tx } from '../../../shared/db/transaction';
import { systemClock, type Clock } from '../../../shared/time/clock';
import type { CreateSemesterInput, UpdateSemesterInput } from '../dto/semester.schema';
import { emitSemesterCreated, emitSemesterStatusChanged } from '../events/registry.events';
import { writeRegistryOperationLog } from '../operation-log';
import { actorName, type ServiceActor } from '../registry.types';
import {
  assertDateRange,
  assertSemesterEditable,
  deriveSemesterStatus,
  type SemesterProps,
  type SemesterStatus,
} from './semester.domain';
import { toSemesterDto, type SemesterDto } from './semester.mapper';
import {
  findCurrentSemester,
  findSemesterById,
  findTemplateVersion,
  hasArchiveReference,
  hasTimetableReference,
  insertSemester,
  listSemesters as listSemesterRows,
  softDeleteSemester,
  updateSemester as updateSemesterRow,
  semesterHasTimetablePlan,
} from './semester.repository';

function currentStatus(props: SemesterProps, today: string): SemesterStatus {
  return deriveSemesterStatus(props.status, props.startDate, props.endDate, today);
}

async function assertTemplateVersionUsable(
  tx: Tx,
  versionId: string,
): Promise<void> {
  const version = await findTemplateVersion(tx, versionId);
  if (!version || version.templateDeleted) {
    throw new ValidationError('保存失败，请检查输入内容', [
      { field: 'scheduleTemplateVersionId', message: '请选择作息模板' },
    ]);
  }
}

export async function listSemesters(
  pool: Pool,
  includeArchived: boolean,
  clock: Clock = systemClock,
): Promise<SemesterDto[]> {
  return withTransactionOn(pool, async (tx) => {
    const today = clock.today();
    const semesters = await listSemesterRows(tx, includeArchived);
    return semesters.map((props) => toSemesterDto(props, currentStatus(props, today)));
  });
}

export async function getCurrentSemester(
  pool: Pool,
  clock: Clock = systemClock,
): Promise<SemesterDto | null> {
  return withTransactionOn(pool, async (tx) => {
    const props = await findCurrentSemester(tx);
    return props ? toSemesterDto(props, currentStatus(props, clock.today())) : null;
  });
}

export async function getSemester(
  pool: Pool,
  semesterId: string,
  clock: Clock = systemClock,
): Promise<SemesterDto> {
  return withTransactionOn(pool, async (tx) => {
    const props = await findSemesterById(tx, semesterId);
    if (!props) {
      throw new NotFoundError('未找到该学期，可能已被删除');
    }
    return toSemesterDto(props, currentStatus(props, clock.today()));
  });
}

export async function createSemester(
  pool: Pool,
  input: CreateSemesterInput,
  actor: ServiceActor,
  clock: Clock = systemClock,
): Promise<SemesterDto> {
  return withTransactionOn(pool, async (tx) => {
    await assertTemplateVersionUsable(tx, input.scheduleTemplateVersionId);
    assertDateRange(input.startDate, input.endDate);

    const props = await insertSemester(tx, {
      semesterId: randomUUID(),
      name: input.name,
      academicYear: input.academicYear,
      term: input.term,
      startDate: input.startDate,
      endDate: input.endDate,
      scheduleTemplateVersionId: input.scheduleTemplateVersionId,
    });

    await emitSemesterCreated(
      tx,
      {
        semesterId: props.semesterId,
        name: props.name,
        scheduleTemplateVersionId: props.scheduleTemplateVersionId,
        occurredBy: actor.userId,
      },
      clock,
    );

    return toSemesterDto(props, currentStatus(props, clock.today()));
  });
}

export async function updateSemester(
  pool: Pool,
  semesterId: string,
  input: UpdateSemesterInput,
  actor: ServiceActor,
  clock: Clock = systemClock,
): Promise<SemesterDto> {
  return withTransactionOn(pool, async (tx) => {
    const existing = await findSemesterById(tx, semesterId, true);
    if (!existing) {
      throw new NotFoundError('未找到该学期，可能已被删除');
    }
    const today = clock.today();
    const beforeStatus = currentStatus(existing, today);
    assertSemesterEditable(beforeStatus);
    guardVersion(existing, input.version, '数据已被他人修改，请刷新页面后重试');

    if (input.scheduleTemplateVersionId !== undefined
      && input.scheduleTemplateVersionId !== existing.scheduleTemplateVersionId) {
      await assertTemplateVersionUsable(tx, input.scheduleTemplateVersionId);
      if (await semesterHasTimetablePlan(tx, semesterId)) {
        throw new ConflictError('STATE_CONFLICT', '该学期已生成排课方案，不能更换作息模板');
      }
    }

    const merged = {
      name: input.name ?? existing.name,
      academicYear: input.academicYear ?? existing.academicYear,
      term: input.term ?? existing.term,
      startDate: input.startDate ?? existing.startDate,
      endDate: input.endDate ?? existing.endDate,
    };
    assertDateRange(merged.startDate, merged.endDate);

    const updated = await updateSemesterRow(tx, semesterId, input.version, {
      name: input.name,
      academicYear: input.academicYear,
      term: input.term,
      startDate: input.startDate,
      endDate: input.endDate,
      scheduleTemplateVersionId: input.scheduleTemplateVersionId,
    });
    if (!updated) {
      throw new VersionConflictError('数据已被他人修改，请刷新页面后重试');
    }

    const afterStatus = currentStatus(updated, today);
    if (afterStatus !== beforeStatus && updated.status !== 'ARCHIVED') {
      await emitSemesterStatusChanged(
        tx,
        { semesterId, fromStatus: beforeStatus, toStatus: afterStatus, occurredBy: actor.userId },
        clock,
      );
    }

    return toSemesterDto(updated, afterStatus);
  });
}

export async function deleteSemester(
  pool: Pool,
  semesterId: string,
  version: number | undefined,
  actor: ServiceActor,
  clock: Clock = systemClock,
): Promise<void> {
  await withTransactionOn(pool, async (tx) => {
    const existing = await findSemesterById(tx, semesterId, true);
    if (!existing) {
      throw new NotFoundError('未找到该学期，可能已被删除');
    }
    assertSemesterEditable(currentStatus(existing, clock.today()));
    const expectedVersion = version ?? existing.version;
    guardVersion(existing, expectedVersion, '数据已被他人修改，请刷新页面后重试');

    if (await hasTimetableReference(tx, semesterId)) {
      throw new ConflictError('REFERENCE_PROTECTED', '该学期已有排课方案，暂时无法删除');
    }
    if (await hasArchiveReference(tx, semesterId)) {
      throw new ConflictError('REFERENCE_PROTECTED', '该学期已有存档快照，暂时无法删除');
    }

    const deleted = await softDeleteSemester(tx, semesterId, expectedVersion);
    if (!deleted) {
      throw new VersionConflictError('数据已被他人修改，请刷新页面后重试');
    }

    await writeRegistryOperationLog(
      tx,
      {
        operatorId: actor.userId,
        operatorName: actorName(actor),
        module: 'DELETE',
        action: '删除学期',
        content: `删除学期「${existing.name}」`,
        targetType: 'Semester',
        targetId: semesterId,
      },
      clock,
    );
  });
}
