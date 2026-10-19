-- =============================================================================
-- D08 · 用户、角色与教师账号开通
-- 设计态交付：在 P0-01 已建的 sys_user 上补齐用户名大小写不敏感唯一索引
-- 与 teacher_id 一对一唯一索引。本卡不新建表，不改密码/会话实现。
-- =============================================================================

-- 登录名大小写不敏感唯一：admin 与 ADMIN 视为同一登录名。
-- 保留原 username 值用于展示；比较与登录一律使用 lower(username)。
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_user_username_lower
  ON sys_user (lower(username));

-- 教师账号与教师主数据一对一；管理员 teacher_id 为空，不参与索引。
CREATE UNIQUE INDEX IF NOT EXISTS uq_sys_user_teacher
  ON sys_user (teacher_id)
  WHERE teacher_id IS NOT NULL;

COMMENT ON INDEX uq_sys_user_username_lower IS
  '登录名大小写不敏感唯一；写入前先做 lower(username) 查重';
COMMENT ON INDEX uq_sys_user_teacher IS
  '一个教师至多一个账号；重复开通必须返回既有账号而不是新增';
