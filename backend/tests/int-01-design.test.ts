import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const design = readFileSync(
  path.join(root, 'docs/knowledge/designs/INT-01-integration-acceptance.md'),
  'utf8',
);
const result = readFileSync(
  path.join(root, 'docs/trace/runs/v1/test-results/INT-01.md'),
  'utf8',
);
const p3 = readFileSync(
  path.join(root, 'docs/knowledge/phase-contracts/p3-contracts.md'),
  'utf8',
);
const roles = readFileSync(path.join(root, 'roles.md'), 'utf8');
const d15 = JSON.parse(
  readFileSync(path.join(root, 'docs/knowledge/designs/D15-annex-a.fixture.json'), 'utf8'),
);

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  expect(start, `missing heading ${heading}`).toBeGreaterThanOrEqual(0);
  const next = markdown.indexOf('\n## ', start + heading.length);
  return markdown.slice(start, next === -1 ? undefined : next);
}

describe('INT-01 integration acceptance design contract', () => {
  it('freezes all seven independently runnable acceptance scripts', () => {
    for (const id of [
      'INT01-CONFIRM',
      'INT01-REF',
      'INT01-CONC',
      'INT01-PERM',
      'INT01-D15',
      'INT01-ISO',
      'INT01-LOG',
    ]) {
      expect(design).toContain(id);
    }
    expect(section(design, '## 2. 验收脚本套件')).toContain('npm run test:int-01');
    expect(result).toContain('验收脚本 | 7 组');
    expect(result).toContain('已执行脚本 | 0 组');
  });

  it('uses one fixed clock and only fixed D15 anchors', () => {
    expect(design).toContain('2026-09-08T00:00:00.000Z');
    for (const suffix of ['100', '101', '102', '103', '104', '105', '106', '107', '108', '109', '10a', '10b', '10c', '10d', '10e', '10f', '110']) {
      expect(design).toContain(`00000000-0000-4000-8000-000000000${suffix}`);
    }
    expect(design).toContain('不得使用自增 ID、真实学校数据或当前时间');
  });

  it('defines cancel and confirm twice for every critical operation', () => {
    const confirmations = section(design, '## 4. `INT01-CONFIRM`');
    for (const id of ['CF-01', 'CF-02', 'CF-03', 'CF-04', 'CF-05', 'CF-06', 'CF-07']) {
      expect(confirmations).toContain(id);
    }
    for (const module of ['DELETE', 'PUBLISH', 'OVERWRITE', 'SWITCH_SEMESTER', 'IMPORT', 'ARCHIVE', 'ADJUST']) {
      expect(confirmations).toContain(module);
    }
    expect(confirmations).toContain('各执行「取消→确认」两遍');
    expect(confirmations).toContain('零请求、零变更');
  });

  it('covers every cross-domain reference relation required by p3 section 7', () => {
    expect(p3).toContain('模板被学期钉扎');
    expect(p3).toContain('教师有任课/班主任/账号');
    expect(p3).toContain('科目有任课');
    expect(p3).toContain('场地被课次占用');
    expect(p3).toContain('年级有班级');
    const references = section(design, '## 5. `INT01-REF`');
    for (const id of ['REF-01', 'REF-02', 'REF-03', 'REF-04', 'REF-05', 'REF-06', 'REF-07']) {
      expect(references).toContain(id);
    }
    expect(references).toContain('409 REFERENCE_PROTECTED');
    expect(references).toContain('数据库快照完全不变');
  });

  it('defines optimistic concurrency as one success, one conflict and zero loser writes', () => {
    const concurrency = section(design, '## 6. `INT01-CONC`');
    expect(concurrency).toContain('{200, 409 VERSION_CONFLICT}');
    expect(concurrency).toContain('最终方案字段等于先者请求');
    expect(concurrency).toContain('失败者内容零写入');
    expect(concurrency).toContain('CONC-01');
    expect(concurrency).toContain('CONC-02');
    expect(concurrency).toContain('TC-CM-006');
    expect(concurrency).toContain('不计覆盖');
  });

  it('keeps Teacher outside management APIs and scopes the five views and idle queries', () => {
    const permissions = section(design, '## 7. `INT01-PERM`');
    for (const group of ['学期', '作息模板', '年级班级', '科目', '教师任课', '场地合班', '排课方案', '调课锁定', '统计', '治理', '用户角色', '导入', '导出打印']) {
      expect(permissions).toContain(group);
    }
    expect(permissions).toContain('所有请求必须为 `403 FORBIDDEN`');
    expect(permissions).toContain('PERM-T01');
    expect(permissions).toContain('PERM-T10');
    expect(permissions).toContain('角色变更下一请求生效');
    expect(roles).toContain('下一请求生效');
  });

  it('freezes the 30-cell D15 oracle and the five-view chain', () => {
    const cells = d15.rows.flatMap((row: { cells: Record<string, unknown> }) => Object.values(row.cells));
    expect(d15.headerTitles).toHaveLength(6);
    expect(cells).toHaveLength(24);
    expect(d15.headerTitles.length + cells.length).toBe(30);
    const chain = section(design, '## 8. `INT01-D15`');
    expect(chain).toContain('6 个表头格 + 24 个数据格');
    expect(chain).toContain('D15-annex-a.fixture.json');
    expect(chain).toContain('30 格逐格一致');
    for (const dimension of ['CLASS', 'TEACHER', 'SCHOOL', 'VENUE', 'ASSIGNMENT']) {
      expect(chain).toContain(dimension);
    }
  });

  it('defines semester isolation and the full archive read-only write set', () => {
    const isolation = section(design, '## 9. `INT01-ISO`');
    for (const item of ['列表', '课表', '统计', '空闲', '日志']) {
      expect(isolation).toContain(item);
    }
    for (const action of ['再次 `POST /semesters/{id}/archive`', '校历新增/删除', '生成、另存、发布/覆盖', '课次预排', '撤销/重做', '导入提交']) {
      expect(isolation).toContain(action);
    }
    expect(isolation).toContain('409 STATE_CONFLICT');
    expect(isolation).toContain('Excel 导出、打印预览/渲染');
  });

  it('makes seven successful operations produce exactly 21 non-deleted log rows', () => {
    const logs = section(design, '## 10. `INT01-LOG`');
    expect(logs).toContain('N=3');
    expect(logs).toContain('恰好新增 21 条');
    for (const module of ['DELETE', 'PUBLISH', 'OVERWRITE', 'SWITCH_SEMESTER', 'IMPORT', 'ARCHIVE', 'ADJUST']) {
      expect(logs).toContain(module);
    }
    expect(logs).toContain('取消/冲突');
    expect(logs).toContain('| 0 |');
    expect(logs).toContain('无更新/删除 API');
  });

  it('records each static cross-contract defect with an owning domain card', () => {
    const defects = section(design, '## 11. 缺陷与回派矩阵');
    for (const [id, owner] of [
      ['DEF-INT-01', 'D02'],
      ['DEF-INT-02', 'D03'],
      ['DEF-INT-03', 'D07'],
      ['DEF-INT-04', 'P0-06'],
    ]) {
      expect(defects).toContain(id);
      expect(defects).toContain(owner);
    }
    expect(defects).toContain('INT-01 不直接修改业务实现');
    expect(result).toContain('DEF-INT-01');
    expect(result).toContain('DEF-INT-04');
  });

  it('does not claim execution in the design round', () => {
    expect(result).toContain('**未执行。**');
    expect(result).toContain('| 执行状态 | 未执行 |');
    expect(result).not.toContain('执行状态 | 通过');
    expect(design).toContain('设计态，未执行');
  });
});
