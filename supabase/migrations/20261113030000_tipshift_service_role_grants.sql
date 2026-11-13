-- A fresh project needs these explicit grants: the Edge Function calls the RPCs as service_role.
grant usage on schema tipshift_private to service_role;
grant select, insert, update, delete on tipshift_private.admin_authorizations to service_role;
grant select, insert, update, delete on tipshift_private.claim_capabilities to service_role;
grant select, insert, update, delete on tipshift_private.turn_groups to service_role;
grant select, insert, update, delete on tipshift_private.turns to service_role;
