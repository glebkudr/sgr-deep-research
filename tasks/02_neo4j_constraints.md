Neo4j Constraints and Indices Migration

Outcome
- One-time migration to create unique constraints and helpful indices for ontology v2.

Tasks
1) Add migration script file
   - Path: `services/indexer/migrations/001_constraints.cypher` or `services/api/db/001_constraints.cypher`.
   - Content: use statements from `docs/indexer.md` section "Индексы и констрейнты".

2) Add simple runner
   - Small CLI (Python) or Makefile target to run cypher via `cypher-shell`.
   - Parameters read from env: NEO4J_PASSWORD, host, database.

3) Execute once in dev
   - Run the migration against local Neo4j.

Cypher (reference)
```cypher
// Unique keys
CREATE CONSTRAINT uniq_object_qn IF NOT EXISTS
FOR (o:Object) REQUIRE o.qualified_name IS UNIQUE;

CREATE CONSTRAINT uniq_module_guid IF NOT EXISTS
FOR (m:Module) REQUIRE m.guid IS UNIQUE;

CREATE CONSTRAINT uniq_routine_guid IF NOT EXISTS
FOR (r:Routine) REQUIRE r.guid IS UNIQUE;

CREATE CONSTRAINT uniq_attribute_guid IF NOT EXISTS
FOR (a:Attribute) REQUIRE a.guid IS UNIQUE;

CREATE CONSTRAINT uniq_form_guid IF NOT EXISTS
FOR (f:Form) REQUIRE f.guid IS UNIQUE;

CREATE CONSTRAINT uniq_control_guid IF NOT EXISTS
FOR (c:FormControl) REQUIRE c.guid IS UNIQUE;

CREATE CONSTRAINT uniq_command_guid IF NOT EXISTS
FOR (c:Command) REQUIRE c.guid IS UNIQUE;

CREATE CONSTRAINT uniq_layout_guid IF NOT EXISTS
FOR (l:Layout) REQUIRE l.guid IS UNIQUE;

CREATE CONSTRAINT uniq_enum_value_guid IF NOT EXISTS
FOR (e:EnumValue) REQUIRE e.guid IS UNIQUE;

// Useful indices
CREATE INDEX obj_type_idx IF NOT EXISTS FOR (o:Object) ON (o.type);
CREATE INDEX obj_name_idx IF NOT EXISTS FOR (o:Object) ON (o.name);
CREATE INDEX routine_name_idx IF NOT EXISTS FOR (r:Routine) ON (r.name);
CREATE INDEX module_kind_idx IF NOT EXISTS FOR (m:Module) ON (m.kind);
CREATE INDEX role_name_idx IF NOT EXISTS FOR (r:Role) ON (r.name);
```

Acceptance
- Running the migration is idempotent; re-run results in no-op.
- Neo4j Browser shows created constraints/indices.

