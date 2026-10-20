import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = readFileSync(
  path.join(root, 'docs/knowledge/designs/0031_identity_indexes.sql'),
  'utf8',
);
const openapi = readFileSync(path.join(root, 'contracts/openapi.yaml'), 'utf8');
const events = readFileSync(path.join(root, 'contracts/events.yaml'), 'utf8');
const graph = readFileSync(path.join(root, 'docs/knowledge/dependency-graph.yaml'), 'utf8');
const design = readFileSync(
  path.join(root, 'docs/knowledge/designs/D08-identity-user-provisioning.md'),
  'utf8',
);

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe('D08 user, role and teacher account design contract', () => {
  it('adds case-insensitive username and one-to-one teacher indexes', () => {
    expect(migration).toContain('uq_sys_user_username_lower');
    expect(migration).toContain('ON sys_user (lower(username))');
    expect(migration).toContain('uq_sys_user_teacher');
    expect(migration).toContain('WHERE teacher_id IS NOT NULL');
    expect(design).toContain('`lower(username)` 唯一索引兜底');
    expect(design).toContain('一个教师至多一个账号');
  });

  it('defines the role and teacher-link invariants', () => {
    expect(design).toContain('`role=TEACHER` 必须关联 `teacherId`');
    expect(design).toContain('`role=ADMIN` 的 `teacherId` 必须为空');
    expect(design).toContain('`username=teacher.employee_no`');
    expect(design).toContain('角色仅 `ADMIN` / `TEACHER`');
  });

  it('exposes all D08 operations in the frozen OpenAPI contract', () => {
    for (const operationId of [
      'listUsers',
      'getUser',
      'createUser',
      'updateUser',
      'updateUserRole',
      'disableUser',
      'enableUser',
      'resetUserPassword',
      'provisionTeacherAccount',
      'batchProvisionTeacherAccounts',
    ]) {
      expect(openapi).toContain(`operationId: ${operationId}`);
    }
  });

  it('returns one-time credentials and never exposes a password hash', () => {
    expect(openapi).toContain('temporaryPassword');
    expect(openapi).toContain('alreadyExists');
    expect(openapi).toContain("$ref: '#/components/schemas/ProvisioningResultEnvelope'");
    expect(openapi).not.toMatch(/password_hash\s*:/);
    expect(design).toContain('长度不少于 12 位');
    expect(design).toContain('`mustChangePassword=true`');
    expect(design).toContain('日志无明文');
  });

  it('registers the user DTO fields required by the list and optimistic lock', () => {
    const user = between(openapi, '    User:\n', '    CsrfData:\n');
    expect(user).toContain('teacherName:');
    expect(user).toContain('version:');
    expect(user).toContain('lastLoginAt:');
    expect(design).toContain('账号、姓名、角色、状态、关联教师');
  });

  it('requires versioned state changes and a batch provision request', () => {
    const disable = between(openapi, '  /users/{userId}/disable:\n', '  /users/{userId}/enable:\n');
    const enable = between(openapi, '  /users/{userId}/enable:\n', '  /users/{userId}/reset-password:\n');
    const batch = between(
      openapi,
      '  /teachers/provision-accounts/batch:\n',
      '  /import/templates/{module}:\n',
    );
    expect(disable).toContain('UserVersionRequest');
    expect(enable).toContain('UserVersionRequest');
    expect(batch).toContain('BatchProvisionRequest');
    expect(openapi).toContain('minItems: 1');
    expect(openapi).toContain('maxItems: 500');
    expect(design).toContain('工号,姓名,登录名,初始密码,状态');
    expect(design).toContain('Cache-Control: no-store');
  });

  it('guards the last enabled admin and self-disable', () => {
    expect(design).toContain('LAST_ADMIN');
    expect(design).toContain('SELF_DISABLE');
    expect(design).toContain('系统至少需要保留一个启用中的管理员');
    expect(design).toContain('不能停用当前登录的账号');
    expect(design).toContain('`409 STATE_CONFLICT`');
  });

  it('subscribes to teacher retirement and never auto-enables on restore', () => {
    expect(events).toContain('bc.resource.teacher.deactivated');
    expect(events).toContain('bc.identity.user.disabled');
    expect(graph).toContain('bc.identity.user.created');
    expect(graph).toContain('bc.identity.user.disabled');
    expect(graph).toContain('bc.identity.user.role-changed');
    expect(design).toContain('`bc.resource.teacher.deactivated`');
    expect(design).toContain('复职不自动启用');
    expect(design).toContain('管理员必须显式启用');
  });

  it('documents the Teacher permission boundary and per-request role check', () => {
    expect(design).toContain('`403 FORBIDDEN`');
    expect(design).toContain('每次请求从数据库读取当前角色与账号状态');
    expect(design).toContain('Teacher `GET /api/v1/users`');
    expect(design).toContain('Teacher `GET /api/v1/semesters`');
    expect(design).toContain('Teacher `GET /api/v1/timetable-plans`');
    expect(design).toContain('前端隐藏菜单只是体验');
  });

  it('documents the provision, disable and reset copy', () => {
    expect(design).toContain('停用后该账号将立即退出所有会话');
    expect(design).toContain('重置后旧密码立即失效');
    expect(design).toContain('请立即复制或下载，关闭后将无法再次查看');
    expect(design).toContain('该教师已有登录账号，本次未重复创建');
  });
});
