-- Defense in depth: any role change or deactivation must invalidate every
-- existing access/refresh session, even when an administrator edits the row
-- directly instead of using the application service. The service still bumps
-- authVersion and revokes tokens explicitly; these triggers make the same
-- guarantee for direct SQL and future code paths.

CREATE OR REPLACE FUNCTION "arkan_auth_version_on_change"()
RETURNS trigger AS $$
BEGIN
  IF NEW."role" IS DISTINCT FROM OLD."role"
     OR (OLD."isActive" IS TRUE AND NEW."isActive" IS FALSE) THEN
    NEW."authVersion" := OLD."authVersion" + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "User_auth_version_on_change" ON "User";
CREATE TRIGGER "User_auth_version_on_change"
  BEFORE UPDATE OF "role", "isActive" ON "User"
  FOR EACH ROW
  EXECUTE FUNCTION "arkan_auth_version_on_change"();

CREATE OR REPLACE FUNCTION "arkan_revoke_sessions_on_change"()
RETURNS trigger AS $$
BEGIN
  IF NEW."role" IS DISTINCT FROM OLD."role"
     OR (OLD."isActive" IS TRUE AND NEW."isActive" IS FALSE) THEN
    UPDATE "RefreshToken"
      SET "revokedAt" = NOW()
      WHERE "userId" = NEW."id"
        AND "revokedAt" IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "User_revoke_sessions_on_change" ON "User";
CREATE TRIGGER "User_revoke_sessions_on_change"
  AFTER UPDATE OF "role", "isActive" ON "User"
  FOR EACH ROW
  EXECUTE FUNCTION "arkan_revoke_sessions_on_change"();
