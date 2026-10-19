import type { Pool } from 'pg';
import type { AccountStatus, UserRole } from '../../shared/auth/rbac';

export interface UserRecord {
  userId: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  status: AccountStatus;
  mustChangePassword: boolean;
  teacherId: string | null;
}

interface UserDbRow {
  user_id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  status: AccountStatus;
  must_change_password: boolean;
  teacher_id: string | null;
}

const USER_COLUMNS = `user_id, username, display_name, password_hash, role, status, must_change_password, teacher_id`;

function mapUser(row: UserDbRow): UserRecord {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password,
    teacherId: row.teacher_id,
  };
}

export async function findUserByUsername(pool: Pool, username: string): Promise<UserRecord | null> {
  const result = await pool.query<UserDbRow>(
    `SELECT ${USER_COLUMNS} FROM sys_user WHERE username = $1`,
    [username],
  );
  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

export async function findUserById(pool: Pool, userId: string): Promise<UserRecord | null> {
  const result = await pool.query<UserDbRow>(
    `SELECT ${USER_COLUMNS} FROM sys_user WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

export async function markLoginSuccess(pool: Pool, userId: string): Promise<void> {
  await pool.query('UPDATE sys_user SET last_login_at = now() WHERE user_id = $1', [userId]);
}

export async function updateUserPassword(
  pool: Pool,
  userId: string,
  passwordHash: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE sys_user
     SET password_hash = $2,
         must_change_password = false,
         password_changed_at = now(),
         version = version + 1
     WHERE user_id = $1`,
    [userId, passwordHash],
  );
  return (result.rowCount ?? 0) > 0;
}
