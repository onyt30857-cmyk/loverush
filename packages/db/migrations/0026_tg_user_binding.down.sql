-- rollback 0026
BEGIN;
DROP TABLE IF EXISTS tg_user_binding;
COMMIT;
