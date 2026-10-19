import { ConflictError, NotFoundError, VersionConflictError } from '../../../shared/errors/app-error';
import type { Tx } from '../../../shared/db/transaction';
import { systemClock, type Clock } from '../../../shared/time/clock';
import { emitSemesterStatusChanged } from '../events/registry.events';
import { writeRegistryOperationLog } from '../operation-log';
import { actorName, type ServiceActor } from '../registry.types';
import { deriveSemesterStatus, type SemesterStatus } from './semester.domain';
import { toSemesterDto, type SemesterDto } from './semester.mapper';
import { findSemesterById, setSemesterStatus } from './semester.repository';

/**
 * D01 只提供 registry 侧生命周期原语；存档/切换端点与排课方案前置条件由 D07 编排。
 * 两个方法都要求在 D07 的事务内调用，保证学期、方案、快照、日志与事件同事务提交。
 */
export interface SemesterLifecycleService {
  archive(
    tx: Tx,
    semesterId: string,
    actor: ServiceActor,
    expectedVersion?: number,
  ): Promise<SemesterDto>;
  switchCurrent(
    tx: Tx,
    semesterId: string,
    actor: ServiceActor,
    expectedVersion?: number,
  ): Promise<SemesterDto>;
}

export function createSemesterLifecycleService(clock: Clock = systemClock): SemesterLifecycleService {
  return {
    async archive(tx, semesterId, actor, expectedVersion) {
      const existing = await findSemesterById(tx, semesterId, true);
      if (!existing) {
        throw new NotFoundError('未找到该学期，可能已被删除');
      }
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new VersionConflictError('数据已被他人修改，请刷新后重试');
      }
      const today = clock.today();
      const fromStatus: SemesterStatus = deriveSemesterStatus(
        existing.status,
        existing.startDate,
        existing.endDate,
        today,
      );
      if (fromStatus === 'ARCHIVED') {
        throw new ConflictError('STATE_CONFLICT', '该学期已存档');
      }

      const updated = await setSemesterStatus(tx, semesterId, 'ARCHIVED', false);
      if (!updated) {
        throw new NotFoundError('未找到该学期，可能已被删除');
      }

      await emitSemesterStatusChanged(
        tx,
        { semesterId, fromStatus, toStatus: 'ARCHIVED', occurredBy: actor.userId },
        clock,
      );
      await writeRegistryOperationLog(
        tx,
        {
          operatorId: actor.userId,
          operatorName: actorName(actor),
          module: 'ARCHIVE',
          action: '存档学期',
          content: `存档学期「${existing.name}」`,
          targetType: 'Semester',
          targetId: semesterId,
        },
        clock,
      );

      return toSemesterDto(updated, 'ARCHIVED');
    },

    async switchCurrent(tx, semesterId, actor, expectedVersion) {
      const existing = await findSemesterById(tx, semesterId, true);
      if (!existing) {
        throw new NotFoundError('未找到该学期，可能已被删除');
      }
      const status = deriveSemesterStatus(existing.status, existing.startDate, existing.endDate, clock.today());
      if (status === 'ARCHIVED') {
        throw new ConflictError('STATE_CONFLICT', '已存档学期不能切换为当前学期');
      }
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new VersionConflictError('数据已被他人修改，请刷新后重试');
      }

      await tx.query(
        `UPDATE semester SET is_current = false, version = version + 1
          WHERE is_current AND semester_id <> $1 AND deleted_at IS NULL`,
        [semesterId],
      );
      const updated = await setSemesterStatus(tx, semesterId, 'NOT_STARTED', true);
      if (!updated) {
        throw new NotFoundError('未找到该学期，可能已被删除');
      }

      await writeRegistryOperationLog(
        tx,
        {
          operatorId: actor.userId,
          operatorName: actorName(actor),
          module: 'SWITCH_SEMESTER',
          action: '切换学期',
          content: `切换当前学期为「${existing.name}」`,
          targetType: 'Semester',
          targetId: semesterId,
        },
        clock,
      );

      return toSemesterDto(
        updated,
        deriveSemesterStatus(updated.status, updated.startDate, updated.endDate, clock.today()),
      );
    },
  };
}

export const semesterLifecycleService = createSemesterLifecycleService();
