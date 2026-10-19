import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const screenDir = join(process.cwd(), 'docs/trace/runs/v1/screens/P0-08');

const admin = {
  userId: 'admin-1',
  username: 'admin',
  displayName: '教务管理员',
  role: 'ADMIN',
  teacherId: null,
  mustChangePassword: false,
};

const forcedAdmin = { ...admin, mustChangePassword: true };

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
];

async function fulfillJson(route: Route, body: unknown, status = 200, headers: Record<string, string> = {}): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  });
}

async function mockCsrf(page: Page): Promise<void> {
  await page.route('**/api/v1/auth/csrf', (route) =>
    fulfillJson(route, { data: { csrfToken: 'e2e-csrf-token' } }),
  );
}

async function mockSession(page: Page, user: typeof admin | typeof teacher): Promise<void> {
  await mockCsrf(page);
  await page.route('**/api/v1/auth/me', (route) => fulfillJson(route, { data: { user } }));
  await page.route('**/api/v1/semesters*', (route) => fulfillJson(route, { data: semesters }));
}

async function fillLogin(page: Page, username = 'admin', password = 'WrongPass1!'): Promise<void> {
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
}

test.beforeAll(() => {
  mkdirSync(screenDir, { recursive: true });
});

test('login failure is unified and password visibility can be toggled', async ({ page }) => {
  await mockCsrf(page);
  await page.route('**/api/v1/auth/me', (route) =>
    fulfillJson(route, {
      error: { code: 'UNAUTHENTICATED', message: '登录已失效，请重新登录', details: [] },
    }, 401),
  );
  await page.route('**/api/v1/auth/login', (route) =>
    fulfillJson(route, {
      error: { code: 'UNAUTHENTICATED', message: '用户名或密码错误', details: [] },
    }, 401),
  );

  await page.goto('/login');
  const pageText = await page.locator('body').innerText();
  expect(pageText).not.toContain('演示账号');
  expect(pageText).not.toContain('默认密码');
  expect(pageText).not.toContain('一键填充');

  const password = page.locator('#password');
  await fillLogin(page);
  await expect(password).toHaveAttribute('type', 'password');
  await page.locator('.el-input__password').click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.locator('.el-input__password').click();
  await expect(password).toHaveAttribute('type', 'password');

  await page.getByRole('button', { name: '登录系统' }).click();

  await expect(page.locator('[data-login-error]')).toContainText('用户名或密码错误');
  await expect(page.locator('body')).not.toContainText('账号不存在');
  await expect(page.locator('body')).not.toContainText('UNAUTHENTICATED');
  await page.screenshot({ path: join(screenDir, 'login-error.png'), fullPage: true });
});

test('lockout shows remaining minutes and disables submission', async ({ page }) => {
  await mockCsrf(page);
  await page.route('**/api/v1/auth/me', (route) =>
    fulfillJson(route, {
      error: { code: 'UNAUTHENTICATED', message: '登录已失效，请重新登录', details: [] },
    }, 401),
  );
  await page.route('**/api/v1/auth/login', (route) =>
    fulfillJson(
      route,
      {
        error: {
          code: 'ACCOUNT_LOCKED',
          message: '登录失败次数过多，请 15 分钟后再试',
          details: [],
        },
      },
      423,
      { 'retry-after': '900' },
    ),
  );

  await page.goto('/login');
  await fillLogin(page);
  const submit = page.getByRole('button', { name: '登录系统' });
  await submit.click();

  await expect(page.locator('[data-lockout]')).toContainText('请 15 分钟后再试');
  await expect(submit).toBeDisabled();
  await page.screenshot({ path: join(screenDir, 'login-lockout.png'), fullPage: true });
});

test('forced password change blocks other protected routes and requires a fresh login after success', async ({ page }) => {
  let loggedIn = false;
  let changed = false;
  await mockCsrf(page);
  await page.route('**/api/v1/auth/me', (route) => {
    if (!loggedIn) {
      return fulfillJson(route, {
        error: { code: 'UNAUTHENTICATED', message: '登录已失效，请重新登录', details: [] },
      }, 401);
    }
    return fulfillJson(route, { data: { user: changed ? admin : forcedAdmin } });
  });
  await page.route('**/api/v1/auth/login', async (route) => {
    loggedIn = true;
    await fulfillJson(route, { data: { user: forcedAdmin } });
  });
  await page.route('**/api/v1/auth/change-password', async (route) => {
    changed = true;
    await fulfillJson(route, { data: { ok: true } });
  });

  await page.goto('/login');
  await fillLogin(page, 'admin', 'Initial1!');
  await page.getByRole('button', { name: '登录系统' }).click();

  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByRole('heading', { name: '请先修改初始密码' })).toBeVisible();

  await page.goto('/semesters');
  await expect(page).toHaveURL(/\/change-password$/);

  await page.locator('#current-password').fill('Initial1!');
  await page.locator('#new-password').fill('Abcdefg1!');
  await expect(page.locator('[data-policy="length"]')).toHaveClass(/passed/);
  await expect(page.locator('[data-policy="classes"]')).toHaveClass(/passed/);
  await page.locator('#confirm-password').fill('Abcdefg1!');
  await page.screenshot({ path: join(screenDir, 'change-password-forced.png'), fullPage: true });

  await page.getByRole('button', { name: '保存并重新登录' }).click();
  await expect(page).toHaveURL(/\/login\?reason=password-changed$/);
  await expect(page.locator('[data-auth-notice]')).toContainText('密码修改成功，请重新登录');
});

test('protected-page session expiry redirects to login with the original path and notice', async ({ page }) => {
  await mockSession(page, admin);
  await page.route('**/api/v1/session-expire', (route) =>
    fulfillJson(route, {
      error: { code: 'UNAUTHENTICATED', message: '登录已失效，请重新登录', details: [] },
    }, 401),
  );

  await page.goto('/semesters');
  await expect(page.getByRole('heading', { name: '学期管理' })).toBeVisible();

  await page.evaluate(async () => {
    const module = await import('/src/shared/api/http.ts');
    try {
      await module.http.post('/session-expire');
    } catch {
      // The redirect and notice are the observable result under test.
    }
  });

  await expect(page).toHaveURL(/\/login\?redirect=\/semesters&reason=session-expired$/);
  await expect(page.locator('[data-auth-notice]')).toContainText('登录已失效，请重新登录');
  await page.screenshot({ path: join(screenDir, 'session-expired.png'), fullPage: true });
});

test('Teacher role mismatch reaches the 403 explanation page', async ({ page }) => {
  await mockSession(page, teacher);

  await page.goto('/semesters');
  await expect(page).toHaveURL(/\/403$/);
  await expect(page.locator('[data-result="403"]')).toContainText('您没有权限访问此页面');
  await expect(page.getByRole('button', { name: '返回工作台' })).toBeVisible();
  await page.screenshot({ path: join(screenDir, 'forbidden-403.png'), fullPage: true });
});

test('unknown protected route reaches the 404 explanation page', async ({ page }) => {
  await mockSession(page, admin);

  await page.goto('/missing-page');
  await expect(page.locator('[data-result="404"]')).toContainText('页面不存在');
  await expect(page.getByRole('button', { name: '返回工作台' })).toBeVisible();
  await page.screenshot({ path: join(screenDir, 'not-found-404.png'), fullPage: true });
});
