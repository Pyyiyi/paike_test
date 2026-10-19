-- =============================================================================
-- P0-01 · updated_at 触发器
-- 所有共享表都必须自动维护 updated_at。
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sys_migration_updated_at ON sys_migration;
CREATE TRIGGER trg_sys_migration_updated_at
  BEFORE UPDATE ON sys_migration
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_user_updated_at ON sys_user;
CREATE TRIGGER trg_sys_user_updated_at
  BEFORE UPDATE ON sys_user
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_session_updated_at ON sys_session;
CREATE TRIGGER trg_sys_session_updated_at
  BEFORE UPDATE ON sys_session
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_login_attempt_updated_at ON sys_login_attempt;
CREATE TRIGGER trg_sys_login_attempt_updated_at
  BEFORE UPDATE ON sys_login_attempt
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_config_updated_at ON sys_config;
CREATE TRIGGER trg_sys_config_updated_at
  BEFORE UPDATE ON sys_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_vocab_updated_at ON sys_controlled_vocabulary;
CREATE TRIGGER trg_sys_vocab_updated_at
  BEFORE UPDATE ON sys_controlled_vocabulary
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_outbox_event_updated_at ON sys_outbox_event;
CREATE TRIGGER trg_sys_outbox_event_updated_at
  BEFORE UPDATE ON sys_outbox_event
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_audit_log_updated_at ON sys_audit_log;
CREATE TRIGGER trg_sys_audit_log_updated_at
  BEFORE UPDATE ON sys_audit_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
