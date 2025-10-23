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
