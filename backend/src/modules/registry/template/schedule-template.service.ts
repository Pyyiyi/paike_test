import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ConflictError, NotFoundError, ValidationError, VersionConflictError } from '../../../shared/errors/app-error';
import { guardVersion } from '../../../shared/db/optimistic';
import { withTransactionOn, type Tx } from '../../../shared/db/transaction';
import { systemClock, type Clock } from '../../../shared/time/clock';
import type {
  CreateScheduleTemplateInput,
  CreateScheduleTemplateVersionInput,
} from '../dto/schedule-template.schema';
import { emitTemplateVersionCreated } from '../events/registry.events';
import { writeRegistryOperationLog } from '../operation-log';
import { actorName, type ServiceActor } from '../registry.types';
import {
  assertTemplateContent,
  normalizeTemplateContent,
  validateTemplateContent,
  type ScheduleTemplateProps,
  type ScheduleTemplateVersionProps,
} from './schedule-template.domain';
import {
  toTemplateDto,
  toVersionDto,
  type ScheduleTemplateDto,
  type ScheduleTemplateVersionDto,
} from './schedule-template.mapper';
import {
  findTemplateById,
  findTemplateByName,
  findVersionById,
  findVersionByNo,
  hasTimetableReferenceForTemplate,
  insertTemplate,
  insertVersion,
  listTemplateRows,
  listVersionRows,
  maxVersionNo,
  softDeleteTemplate,
  updateTemplateLatestVersion,
} from './schedule-template.repository';
import { isTemplateReferencedBySemester } from '../semester/semester.repository';

async function assertBaseVersion(tx: Tx, templateId: string, baseVersionId: string): Promise<void> {
  const base = await findVersionById(tx, baseVersionId);
  if (!base || base.templateId !== templateId) {
    throw new ValidationError('保存失败，请检查输入内容', [
      { field: 'baseVersionId', message: '基准版本不属于当前作息模板' },
    ]);
  }
}

export async function listTemplates(pool: Pool): Promise<ScheduleTemplateDto[]> {
  return withTransactionOn(pool, async (tx) => {
    const rows = await listTemplateRows(tx);
    return rows.map((row) => {
      const template: ScheduleTemplateProps = {
        templateId: row.template_id,
        name: row.name,
        status: row.status,
        latestVersionNo: row.latest_version_no,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      const latestVersion: ScheduleTemplateVersionProps | undefined =
        row.latest_version_id && row.latest_version_no_value !== null && row.latest_open_weekdays && row.latest_periods && row.latest_status && row.latest_created_at
          ? {
              versionId: row.latest_version_id,
              templateId: row.template_id,
              versionNo: row.latest_version_no_value,
              openWeekdays: row.latest_open_weekdays.map((weekday) => Number(weekday)),
              periods: row.latest_periods,
              status: row.latest_status,
              createdAt: row.latest_created_at,
            }
          : undefined;
      return toTemplateDto(template, latestVersion);
    });
  });
}

export async function createTemplate(
  pool: Pool,
  input: CreateScheduleTemplateInput,
  actor: ServiceActor,
  clock: Clock = systemClock,
): Promise<ScheduleTemplateDto> {
  return withTransactionOn(pool, async (tx) => {
    assertTemplateContent(input);
    if (await findTemplateByName(tx, input.name)) {
      throw new ConflictError('DUPLICATE', '模板名称已存在，请更换后重试');
    }

    const templateId = randomUUID();
    const template = await insertTemplate(tx, { templateId, name: input.name });
    const version = await insertVersion(tx, {
      versionId: randomUUID(),
      templateId,
      versionNo: 1,
      status: 'ACTIVE',
      content: normalizeTemplateContent(input),
    });

    await emitTemplateVersionCreated(
      tx,
      {
        templateId,
        versionId: version.versionId,
        versionNo: version.versionNo,
        occurredBy: actor.userId,
      },
      clock,
    );

    return toTemplateDto(template, version);
  });
}

export async function listVersions(
  pool: Pool,
  templateId: string,
): Promise<ScheduleTemplateVersionDto[]> {
  return withTransactionOn(pool, async (tx) => {
    const template = await findTemplateById(tx, templateId);
    if (!template) {
      throw new NotFoundError('未找到该作息模板，可能已被删除');
    }
    const rows = await listVersionRows(tx, templateId);
    return rows.map((row) => toVersionDto({
      versionId: row.version_id,
      templateId: row.template_id,
      versionNo: row.version_no,
      openWeekdays: row.open_weekdays.map((weekday) => Number(weekday)),
      periods: row.periods,
      status: row.status,
      createdAt: row.created_at,
    }));
  });
}

export async function getVersion(
  pool: Pool,
  versionId: string,
): Promise<ScheduleTemplateVersionDto> {
  return withTransactionOn(pool, async (tx) => {
    const version = await findVersionById(tx, versionId);
    if (!version) {
      throw new NotFoundError('未找到该模板版本，可能已被删除');
    }
    return toVersionDto(version);
  });
}

export async function createVersion(
  pool: Pool,
  templateId: string,
  input: CreateScheduleTemplateVersionInput,
  actor: ServiceActor,
  clock: Clock = systemClock,
): Promise<ScheduleTemplateVersionDto> {
  return withTransactionOn(pool, async (tx) => {
    const template = await findTemplateById(tx, templateId, true);
    if (!template) {
      throw new NotFoundError('未找到该作息模板，可能已被删除');
    }
    if (input.baseVersionId) {
      await assertBaseVersion(tx, templateId, input.baseVersionId);
    }
    assertTemplateContent(input);

    const nextVersionNo = (await maxVersionNo(tx, templateId)) + 1;
    const version = await insertVersion(tx, {
      versionId: randomUUID(),
      templateId,
      versionNo: nextVersionNo,
      status: 'ACTIVE',
      content: normalizeTemplateContent(input),
    });

    const updated = await updateTemplateLatestVersion(tx, templateId, template.version, nextVersionNo);
    if (!updated) {
      throw new VersionConflictError('数据已被他人修改，请刷新页面后重试');
    }

    await emitTemplateVersionCreated(
      tx,
      {
        templateId,
        versionId: version.versionId,
        versionNo: version.versionNo,
        occurredBy: actor.userId,
      },
      clock,
    );

    return toVersionDto(version);
  });
}

export interface TemplateValidationResult {
  valid: boolean;
  errors: Array<{ field?: string; message: string }>;
}

export async function validateVersion(
  pool: Pool,
  versionId: string,
): Promise<TemplateValidationResult> {
  return withTransactionOn(pool, async (tx) => {
    const version = await findVersionById(tx, versionId);
    if (!version) {
      throw new NotFoundError('未找到该模板版本，可能已被删除');
    }
    const errors = validateTemplateContent({
      openWeekdays: version.openWeekdays,
      periods: version.periods,
    });
    return { valid: errors.length === 0, errors };
  });
}

export async function deleteTemplate(
  pool: Pool,
  templateId: string,
  version: number | undefined,
  actor: ServiceActor,
  clock: Clock = systemClock,
): Promise<void> {
  await withTransactionOn(pool, async (tx) => {
    const template = await findTemplateById(tx, templateId, true);
    if (!template) {
      throw new NotFoundError('未找到该作息模板，可能已被删除');
    }
    const expectedVersion = version ?? template.version;
    guardVersion(template, expectedVersion, '数据已被他人修改，请刷新页面后重试');

    if (await isTemplateReferencedBySemester(tx, templateId)) {
      throw new ConflictError('REFERENCE_PROTECTED', '该作息模板已被学期引用，暂时无法删除');
    }
    if (await hasTimetableReferenceForTemplate(tx, templateId)) {
      throw new ConflictError('REFERENCE_PROTECTED', '该作息模板已被课表方案引用，暂时无法删除');
    }

    const deleted = await softDeleteTemplate(tx, templateId, expectedVersion);
    if (!deleted) {
      throw new VersionConflictError('数据已被他人修改，请刷新页面后重试');
    }

    await writeRegistryOperationLog(
      tx,
      {
        operatorId: actor.userId,
        operatorName: actorName(actor),
        module: 'DELETE',
        action: '删除作息模板',
        content: `删除作息模板「${template.name}」`,
        targetType: 'ScheduleTemplate',
        targetId: templateId,
      },
      clock,
    );
  });
}

export async function getLatestVersion(
  pool: Pool,
  templateId: string,
): Promise<ScheduleTemplateVersionDto | null> {
  return withTransactionOn(pool, async (tx) => {
    const template = await findTemplateById(tx, templateId);
    if (!template) {
      return null;
    }
    const version = await findVersionByNo(tx, templateId, template.latestVersionNo);
    return version ? toVersionDto(version) : null;
  });
}
