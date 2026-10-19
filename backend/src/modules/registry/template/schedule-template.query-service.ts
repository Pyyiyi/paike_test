import type { Pool } from 'pg';
import { getPool } from '../../../shared/db/pool';
import { withTransactionOn } from '../../../shared/db/transaction';
import { isVersionReferencedBySemester } from '../semester/semester.repository';
import { findTemplateById, findVersionById, findVersionByNo, listTemplateRows, listVersionRows } from './schedule-template.repository';
import { toTemplateDto, toVersionDto, type ScheduleTemplateDto, type ScheduleTemplateVersionDto } from './schedule-template.mapper';

export interface ScheduleTemplateVersionSnapshot extends ScheduleTemplateVersionDto {
  templateName: string;
}

export interface TemplateQueryService {
  listTemplates(): Promise<ScheduleTemplateDto[]>;
  listVersions(templateId: string): Promise<ScheduleTemplateVersionDto[]>;
  getVersion(versionId: string): Promise<ScheduleTemplateVersionSnapshot | null>;
  getLatestVersion(templateId: string): Promise<ScheduleTemplateVersionSnapshot | null>;
  getPinnedVersionForSemester(semesterId: string): Promise<ScheduleTemplateVersionSnapshot | null>;
  isVersionReferenced(versionId: string): Promise<boolean>;
}

export function createTemplateQueryService(pool: Pool): TemplateQueryService {
  return {
    async listTemplates() {
      return withTransactionOn(pool, async (tx) => {
        const rows = await listTemplateRows(tx);
        return rows.map((row) =>
          toTemplateDto(
            {
              templateId: row.template_id,
              name: row.name,
              status: row.status,
              latestVersionNo: row.latest_version_no,
              version: row.version,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            },
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
              : undefined,
          ),
        );
      });
    },

    async listVersions(templateId) {
      return withTransactionOn(pool, async (tx) => {
        const rows = await listVersionRows(tx, templateId);
        return rows.map((row) =>
          toVersionDto({
            versionId: row.version_id,
            templateId: row.template_id,
            versionNo: row.version_no,
            openWeekdays: row.open_weekdays.map((weekday) => Number(weekday)),
            periods: row.periods,
            status: row.status,
            createdAt: row.created_at,
          }),
        );
      });
    },

    async getVersion(versionId) {
      return withTransactionOn(pool, async (tx) => {
        const version = await findVersionById(tx, versionId);
        if (!version) {
          return null;
        }
        const template = await findTemplateById(tx, version.templateId);
        return { ...toVersionDto(version), templateName: template?.name ?? '' };
      });
    },

    async getLatestVersion(templateId) {
      return withTransactionOn(pool, async (tx) => {
        const template = await findTemplateById(tx, templateId);
        if (!template) {
          return null;
        }
        const version = await findVersionByNo(tx, templateId, template.latestVersionNo);
        return version ? { ...toVersionDto(version), templateName: template.name } : null;
      });
    },

    async getPinnedVersionForSemester(semesterId) {
      return withTransactionOn(pool, async (tx) => {
        const rows = await tx.query<{ schedule_template_version_id: string }>(
          'SELECT schedule_template_version_id FROM semester WHERE semester_id = $1 AND deleted_at IS NULL',
          [semesterId],
        );
        const versionId = rows[0]?.schedule_template_version_id;
        if (!versionId) {
          return null;
        }
        const version = await findVersionById(tx, versionId);
        if (!version) {
          return null;
        }
        const template = await findTemplateById(tx, version.templateId);
        return { ...toVersionDto(version), templateName: template?.name ?? '' };
      });
    },

    async isVersionReferenced(versionId) {
      return withTransactionOn(pool, (tx) => isVersionReferencedBySemester(tx, versionId));
    },
  };
}

export const templateQueryService: TemplateQueryService = {
  listTemplates: () => createTemplateQueryService(getPool()).listTemplates(),
  listVersions: (templateId) => createTemplateQueryService(getPool()).listVersions(templateId),
  getVersion: (versionId) => createTemplateQueryService(getPool()).getVersion(versionId),
  getLatestVersion: (templateId) => createTemplateQueryService(getPool()).getLatestVersion(templateId),
  getPinnedVersionForSemester: (semesterId) => createTemplateQueryService(getPool()).getPinnedVersionForSemester(semesterId),
  isVersionReferenced: (versionId) => createTemplateQueryService(getPool()).isVersionReferenced(versionId),
};
