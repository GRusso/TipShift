-- The branch registry was created without the service_role grant that every other
-- tipshift_private table has. The Edge Function reads and registers branches
-- through service_role, so tipshift_admin_scopes failed with "permission denied".
-- Least privilege: no delete. Browser roles stay revoked (see branch_scopes migration).
grant select, insert, update on tipshift_private.branches to service_role;
