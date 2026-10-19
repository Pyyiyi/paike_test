import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const screenDir = join(process.cwd(), 'docs/trace/runs/v1/screens/P0-04');

const admin = {
  userId: 'admin-1',
  username: 'admin',
  displayName: '教务管理员',
  role: 'ADMIN',
  teacherId: null,
  mustChangePassword: false,
};

const teacher = {
  userId: 'teacher-1',
  username: 'T1001',
  displayName: '张老师',
  role: 'TEACHER',
  teacherId: 'teacher-record-1',
  mustChangePassword: false,
};

const semesters = [
  {
    semesterId: 'semester-autumn',
    name: '2026 秋季学期',
    status: 'IN_PROGRESS',
    startDate: '2026-09-01',
    endDate: '2027-01-20',
    version: 1,
  },
  {
    semesterId: 'semester-spring',
    name: '2026 春季学期',
    status: 'ENDED',
    startDate: '2026-02-20',
    endDate: '2026-07-10',
    version: 3,
  },
];

async function mockSession(page: Page, user: typeof admin | typeof teacher): Promise<void> {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { user } }) }),
  );
  await page.route('**/api/v1/auth/csrf', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { csrfToken: 'e2e-csrf-token' } }),
    }),
  );
  await page.route('**/api/v1/semesters', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: semesters }) }),
  );
}

test.beforeAll(() => {
  mkdirSync(screenDir, { recursive: true });
});

test('unauthenticated deep link redirects to login and preserves redirect', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAUTHENTICATED', message: '登录已失效，请重新登录', details: [] },
      }),
    }),
  );

  await page.goto('/semesters');
  await expect(page).toHaveURL(/\/login\?redirect=\/semesters$/);
  await expect(page.getByRole('heading', { name: '登录工作台' })).toBeVisible();
  await page.screenshot({ path: join(screenDir, 'login-redirect.png'), fullPage: true });
});

test('Admin navigation shows all management entries', async ({ page }) => {
  await mockSession(page, admin);
  await page.goto('/semesters');
  await expect(page.getByRole('heading', { name: '学期管理' })).toBeVisible();

  const navText = (await page.locator('nav').first().textContent()) || '';
  for (const label of ['系统概览', '学期管理', '作息模板', '一键排课', '多维度课表', '批量导入', '工作量统计', '操作日志', '用户与角色']) {
    expect(navText).toContain(label);
  }
  await page.screenshot({ path: join(screenDir, 'admin-navigation.png'), fullPage: true });
});

test('Teacher navigation excludes every management entry', async ({ page }) => {
  await mockSession(page, teacher);
  await page.goto('/me/timetable');
  await expect(page.getByRole('heading', { name: '我的课表' })).toBeVisible();

  const navText = (await page.locator('nav').first().textContent()) || '';
  expect(navText).toContain('我的课表');
  expect(navText).toContain('我的空闲时段');
  expect(navText).toContain('退出登录');
  expect(navText).not.toContain('学期');
  expect(navText).not.toContain('排课');
  expect(navText).not.toContain('统计');
  expect(navText).not.toContain('用户');
  await page.screenshot({ path: join(screenDir, 'teacher-navigation.png'), fullPage: true });
});

test('version conflict shows localized refresh guidance and traps focus in confirmation', async ({ page }) => {
  await mockSession(page, admin);
  await page.route('**/api/v1/test-conflict', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'VERSION_CONFLICT', message: '数据已被他人修改，请刷新页面后重试', details: [] },
      }),
    }),
  );

  await page.goto('/semesters');
  await expect(page.getByRole('heading', { name: '学期管理' })).toBeVisible();

  await page.evaluate(async () => {
    const module = await import('/src/shared/api/http.ts');
    try {
      await module.http.post('/test-conflict', { version: 1 });
    } catch {
      // The UI notice is the observable result under test.
    }
  });
  const conflict = page.locator('.version-conflict');
  await expect(conflict).toContainText('数据已被他人修改，请刷新页面后重试');
  await expect(conflict).not.toContainText('VERSION_CONFLICT');
  await page.screenshot({ path: join(screenDir, 'version-conflict.png'), fullPage: true });

  await page.locator('.semester-select .el-select__wrapper').click();
  await page.getByText('2026 春季学期（已结束）').click();
  const dialog = page.locator('.confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('切换学期');
  await expect(dialog).toContainText('影响范围');
  await expect(dialog).toContainText('2026 春季学期');
  await expect(page.locator('[data-confirm-cancel]')).toBeVisible();
  await expect(page.locator('[data-confirm-submit]')).toBeVisible();

  await page.locator('[data-confirm-submit]').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-confirm-cancel]')).toBeFocused();
  await page.screenshot({ path: join(screenDir, 'confirm-dialog-focus.png'), fullPage: true });
});
