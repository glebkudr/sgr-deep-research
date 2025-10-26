отлично — расширил онтологию под твои MCP-инструменты и типовые вопросы по 1С. Ниже даю полный обновлённый **JSON-schema** (v2), **конфиг пайплайна** (YAML), плюс **индексы/констрейнты Cypher**. Кидай как есть.

---

> Update: `path` is now required on every node, always matching `document.rel_path`. `TextUnit` and `Chunk` records carry the same `path` plus an optional `locator` that identifies the intra-file anchor (routine signature, etc.). Any previous use of `path` as a locator should be migrated to the dedicated `locator` field.

# `schema_1c_v2.json`

```json
{
  "version": "2",
  "notes": "Ontology for 1C metadata, UI, access control, HTTP services, call graph, GUID resolution, and registers. Designed to align with MCP search_metadata / search_code / search_metadata_by_description.",
  "node_types": [
    { "label": "Configuration", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "version", "type": "STRING"}
    ]},

    { "label": "Subsystem", "properties": [
      {"name": "name", "type": "STRING", "required": true}
    ]},

    { "label": "ObjectType", "properties": [
      {"name": "name", "type": "STRING", "required": true, "enum": [
        "Catalog","Document","Enum","Constant","AccumulationRegister",
        "InformationRegister","Report","DataProcessor","ExchangePlan",
        "HTTPService","DocumentJournal","CommonModule","CommandGroup","Other"
      ]}
    ]},

    { "label": "Object", "properties": [
      {"name": "qualified_name", "type": "STRING", "required": true},
      {"name": "type", "type": "STRING", "required": true},
      {"name": "name", "type": "STRING"},
      {"name": "guid", "type": "STRING"},
      {"name": "path", "type": "STRING"}
    ]},

    { "label": "Module", "properties": [
      {"name": "name", "type": "STRING"},
      {"name": "kind", "type": "STRING", "required": true, "enum": [
        "ObjectModule","ManagerModule","FormModule","CommonModule","CommandModule"
      ]},
      {"name": "guid", "type": "STRING"}
    ]},

    { "label": "Routine", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "signature", "type": "STRING"},
      {"name": "export", "type": "BOOLEAN"},
      {"name": "directives", "type": "STRING"}, 
      {"name": "exec_side", "type": "STRING", "enum": ["Server","Client","ServerCall","ClientServer","Unknown"]},
      {"name": "guid", "type": "STRING"},
      {"name": "owner_qn", "type": "STRING"}
    ]},

    { "label": "Form", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "role", "type": "STRING", "enum": ["Main","List","Choice","Other"]},
      {"name": "guid", "type": "STRING"}
    ]},

    { "label": "FormControl", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "kind", "type": "STRING"},
      {"name": "guid", "type": "STRING"}
    ]},

    { "label": "FormEvent", "properties": [
      {"name": "name", "type": "STRING", "required": true}
    ]},

    { "label": "Binding", "properties": [
      {"name": "kind", "type": "STRING", "enum": ["DataBinding","CommandBinding"]},
      {"name": "details", "type": "STRING"}
    ]},

    { "label": "Command", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "guid", "type": "STRING"}
    ]},

    { "label": "Layout", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "guid", "type": "STRING"}
    ]},

    { "label": "Attribute", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "datatype", "type": "STRING"},
      {"name": "guid", "type": "STRING"}
    ]},

    { "label": "TabularPart", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "guid", "type": "STRING"}
    ]},

    { "label": "Resource", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "datatype", "type": "STRING"},
      {"name": "guid", "type": "STRING"}
    ]},

    { "label": "Dimension", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "datatype", "type": "STRING"},
      {"name": "guid", "type": "STRING"}
    ]},

    { "label": "AccumulationRegister", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "guid", "type": "STRING"}
    ]},

    { "label": "InformationRegister", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "guid", "type": "STRING"}
    ]},

    { "label": "DocumentJournal", "properties": [
      {"name": "name", "type": "STRING", "required": true}
    ]},

    { "label": "PredefinedItem", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "flags", "type": "STRING"},
      {"name": "guid", "type": "STRING"}
    ]},

    { "label": "Enum", "properties": [
      {"name": "name", "type": "STRING", "required": true}
    ]},

    { "label": "EnumValue", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "guid", "type": "STRING"}
    ]},

    { "label": "HTTPService", "properties": [
      {"name": "name", "type": "STRING", "required": true}
    ]},

    { "label": "URLTemplate", "properties": [
      {"name": "template", "type": "STRING", "required": true}
    ]},

    { "label": "HTTPMethod", "properties": [
      {"name": "method", "type": "STRING", "required": true, "enum": ["GET","POST","PUT","DELETE","PATCH","HEAD","OPTIONS"]}
    ]},

    { "label": "Role", "properties": [
      {"name": "name", "type": "STRING", "required": true}
    ]},

    { "label": "AccessRight", "properties": [
      {"name": "action", "type": "STRING", "required": true, "enum": [
        "Read","Write","Insert","Delete","Execute","View","Post","Unpost","Custom"
      ]},
      {"name": "condition", "type": "STRING"},
      {"name": "details", "type": "STRING"}
    ]},

    { "label": "EventSubscription", "properties": [
      {"name": "event", "type": "STRING", "required": true}
    ]},

    { "label": "EventSource", "properties": [
      {"name": "name", "type": "STRING", "required": true},
      {"name": "kind", "type": "STRING"}
    ]}

    /* optional lexical graph nodes if you use them:
    { "label": "Document", "properties":[{"name":"path","type":"STRING","required":true}]},
    { "label": "Chunk", "properties":[{"name":"index","type":"INTEGER","required":true}]}
    */
  ],

  "relationship_types": [
    "CONTAINS","BELONGS_TO","HAS_MODULE","HAS_ROUTINE","DEFAULT_FORM",
    "HAS_FORM","HAS_CONTROL","HANDLES_EVENT","BINDS","BINDS_TO_COMMAND","COMMAND_OF",
    "HAS_LAYOUT","LAYOUT_OF","DEFINES_ATTRIBUTE","HAS_TABULAR_PART","HAS_RESOURCE","HAS_DIMENSION",
    "USES_TYPE","REFERENCES","USES_MODULE","READS_FROM","WRITES_TO","MAKES_MOVEMENTS_IN","JOURNALED_IN",
    "HAS_ENUM_VALUE","HAS_PREDEFINED","HAS_HTTP_SERVICE","HAS_URL_TEMPLATE","HAS_URL_METHOD",
    "ROLE_HAS_ACCESS_TO","GRANTS","PERMITS","SUBSCRIBES_TO","HAS_EVENT_SOURCE",
    "CALLS","OWNED_BY","RESOLVES_TO","PART_OF_DOCUMENT","PART_OF_CHUNK"
  ],

  "patterns": [
    ["Configuration","CONTAINS","Subsystem"],
    ["Configuration","CONTAINS","ObjectType"],
    ["ObjectType","CONTAINS","Object"],
    ["Object","BELONGS_TO","Subsystem"],

    ["Object","HAS_MODULE","Module"],
    ["Module","OWNED_BY","Object"],
    ["Module","HAS_ROUTINE","Routine"],

    ["Object","HAS_FORM","Form"],
    ["Object","DEFAULT_FORM","Form"],
    ["Form","HAS_CONTROL","FormControl"],
    ["FormControl","BINDS","Binding"],
    ["Binding","BINDS_TO_COMMAND","Command"],
    ["FormEvent","HANDLES_EVENT","Routine"],

    ["Object","HAS_LAYOUT","Layout"],
    ["Layout","LAYOUT_OF","Object"],

    ["Object","DEFINES_ATTRIBUTE","Attribute"],
    ["Object","HAS_TABULAR_PART","TabularPart"],
    ["AccumulationRegister","HAS_RESOURCE","Resource"],
    ["AccumulationRegister","HAS_DIMENSION","Dimension"],
    ["InformationRegister","HAS_DIMENSION","Dimension"],

    ["Attribute","USES_TYPE","Object"],
    ["Resource","USES_TYPE","Object"],
    ["Dimension","USES_TYPE","Object"],
    ["Attribute","REFERENCES","Object"],

    ["Module","WRITES_TO","AccumulationRegister"],
    ["Module","READS_FROM","InformationRegister"],
    ["DocumentJournal","CONTAINS","Object"],
    ["Object","JOURNALED_IN","DocumentJournal"],
    ["Object","MAKES_MOVEMENTS_IN","AccumulationRegister"],

    ["Enum","HAS_ENUM_VALUE","EnumValue"],
    ["Object","HAS_PREDEFINED","PredefinedItem"],

    ["Configuration","HAS_HTTP_SERVICE","HTTPService"],
    ["HTTPService","HAS_URL_TEMPLATE","URLTemplate"],
    ["URLTemplate","HAS_URL_METHOD","HTTPMethod"],

    ["Role","ROLE_HAS_ACCESS_TO","Object"],
    ["Role","GRANTS","AccessRight"],
    ["AccessRight","PERMITS","Object"],

    ["EventSubscription","HAS_EVENT_SOURCE","EventSource"],
    ["EventSubscription","SUBSCRIBES_TO","Routine"],
    ["EventSubscription","SUBSCRIBES_TO","Object"],

    ["Routine","CALLS","Routine"],

    /* GUID resolution / lexical graph (optional) */
    ["Object","RESOLVES_TO","Object"],
    ["Chunk","PART_OF_DOCUMENT","Document"]
  ],

  "entity_resolution": {
    "Object": ["qualified_name","guid"],
    "Module": ["guid","name","kind","owner_qn"],
    "Routine": ["guid","signature","name","owner_qn"],
    "Attribute": ["guid","name","qualified_name"],
    "Form": ["guid","name","owner_qn"],
    "FormControl": ["guid","name"],
    "Command": ["guid","name","owner_qn"],
    "Layout": ["guid","name","owner_qn"],
    "Enum": ["name"],
    "EnumValue": ["guid","name"],
    "AccumulationRegister": ["name","guid"],
    "InformationRegister": ["name","guid"],
    "Role": ["name"]
  },

  "additional_node_types": false,
  "additional_relationship_types": false,
  "additional_properties_allowed": false
}
```

**Что добавлено/покрыто:**

* Формы, элементы управления, события форм, привязки к командам.
* Команды и макеты + связи поиска «find_objects_by_command/layout».
* Атрибуты/табличные части/ресурсы/измерения с **USES_TYPE** и **REFERENCES**.
* Роли/права/условия (**ROLE_HAS_ACCESS_TO**, **GRANTS**, **PERMITS**).
* Журналы документов и «движения» в регистры (**JOURNALED_IN**, **MAKES_MOVEMENTS_IN**).
* HTTP-сервисы, URL-шаблоны, HTTP-методы.
* Подписки на события и источники подписок.
* Граф вызовов: **Routine**, **CALLS**, связь рутины с модулем и владельцем.
* GUID-ориентированные свойства почти везде (для `find_by_guid/resolve_qn`).

---

# `kg_1c_v2.yaml` (фрагмент )

```yaml
version_: 2
template_: SimpleKGPipeline

neo4j_config:
  uri: neo4j://localhost:7687
  user: neo4j
  password: change-me
  database: neo4j

llm_config:
  provider: openai
  model: gpt-4o-mini
  params:
    temperature: 0
    response_format:
      type: json_object

embedder_config:
  provider: openai
  model: text-embedding-3-large

from_pdf: false
perform_entity_resolution: true

schema:
  ${file}: ./schema_1c_v2.json

# Важно: направляющий prompt под MCP-операции
prompt_template: |
  You extract ONLY entities/relations permitted by the schema.
  Normalize all owners to `Object.qualified_name` (e.g., "Документ.Счет").
  Prefer GUIDs when present. Use patterns and directions exactly as declared.
  Map 1C concepts:
  - Attributes/TabularParts/Resources/Dimensions => USES_TYPE / REFERENCES to Object/Enum.
  - Document posting: Module/Document MAKES_MOVEMENTS_IN AccumulationRegister.
  - Journals: Object JOURNALED_IN DocumentJournal.
  - Forms: Object HAS_FORM Form; default => DEFAULT_FORM.
  - UI: Form HAS_CONTROL FormControl; FormControl BINDS Binding; Binding BINDS_TO_COMMAND Command; Command COMMAND_OF Object.
  - Layouts: Object HAS_LAYOUT Layout; Layout LAYOUT_OF Object.
  - Access: Role GRANTS AccessRight; Role ROLE_HAS_ACCESS_TO Object; AccessRight PERMITS Object (put condition text if any).
  - HTTP: Configuration HAS_HTTP_SERVICE HTTPService; HTTPService HAS_URL_TEMPLATE URLTemplate; URLTemplate HAS_URL_METHOD HTTPMethod.
  - Events: EventSubscription HAS_EVENT_SOURCE EventSource; EventSubscription SUBSCRIBES_TO Routine or Object.
  - Code: Module HAS_ROUTINE Routine; Routine CALLS Routine; Module OWNED_BY Object.
  Emit compact JSON; omit fields not in the schema.

# (опционально) правила шёрстки вывода
schema_filters:
  additional_node_types: false
  additional_relationship_types: false
  additional_properties_allowed: false
```

---

# Индексы и констрейнты (выполни один раз в Neo4j)

```cypher
// Уникальные ключи
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

// Полезные индексы
CREATE INDEX obj_type_idx IF NOT EXISTS FOR (o:Object) ON (o.type);
CREATE INDEX obj_name_idx IF NOT EXISTS FOR (o:Object) ON (o.name);
CREATE INDEX routine_name_idx IF NOT EXISTS FOR (r:Routine) ON (r.name);
CREATE INDEX module_kind_idx IF NOT EXISTS FOR (m:Module) ON (m.kind);
CREATE INDEX role_name_idx IF NOT EXISTS FOR (r:Role) ON (r.name);
```

---

## Пара быстрых Cypher-запросов, отражающих MCP-вопросы

```cypher
// 1) "Какие реквизиты у документа Счёт?"
MATCH (o:Object {qualified_name:"Документ.Счет"})-[:DEFINES_ATTRIBUTE]->(a:Attribute)
RETURN a.name AS attribute, a.datatype AS type
ORDER BY a.name;

// 2) "Где используется справочник Контрагенты как тип?"
MATCH (t:Object {qualified_name:"Справочник.Контрагенты"})
MATCH (x)-[:USES_TYPE]->(t)
RETURN labels(x)[0] AS ownerKind, x.name AS name, x.qualified_name AS qn
LIMIT 100;

// 3) "Какие документы делают движения в регистр ОстаткиТоваров?"
MATCH (reg:AccumulationRegister {name:"ОстаткиТоваров"})<-[:MAKES_MOVEMENTS_IN]-(d:Object {type:"Document"})
RETURN d.qualified_name ORDER BY d.qualified_name;

// 4) "Кто вызывает процедуру ПередЗаписью модуля объекта Документ.Счет?"
MATCH (own:Object {qualified_name:"Документ.Счет"})<-[:OWNED_BY]-(m:Module)-[:HAS_ROUTINE]->(r:Routine {name:"ПередЗаписью"})
MATCH (caller:Routine)-[:CALLS]->(r)
RETURN caller.owner_qn AS owner, caller.name AS routine
LIMIT 50;

// 5) "Какой доступ имеет роль Менеджер к справочнику Контрагенты?"
MATCH (role:Role {name:"Менеджер"})-[:GRANTS]->(ar:AccessRight)
MATCH (role)-[:ROLE_HAS_ACCESS_TO]->(obj:Object {qualified_name:"Справочник.Контрагенты"})
RETURN ar.action, ar.condition, ar.details;
```

---

## Как это стыкуется с твоими MCP-операциями

* **search_metadata** → почти все структурные узлы/связи в схеме: `DEFINES_ATTRIBUTE`, `USES_TYPE`, `JOURNALED_IN`, `MAKES_MOVEMENTS_IN`, формы/контролы/команды/события, роли/права/условия, GUID-поиск.
* **search_code** → `Routine`, `CALLS`, `Module`↔`Object`, `export`, `directives`, `exec_side`.
* **search_metadata_by_description** → у тебя остаются текстовые поля (`name`, `description` в исходниках/индексах). Для полнотекста продолжай держать FTS/векторную сторону вне графа или добавь `Document/Chunk` узлы, связав их с объектами.

---

### Нюансы экстракции

* Для точного «кто делает движения» лучше давать few-shot-примеры кода BSL (проводка → регистр) — тогда `WRITES_TO`/`MAKES_MOVEMENTS_IN` будут стабильнее.
* Для прав с условиями клади «сырой текст условия» в `AccessRight.condition`, а гранулярность действия — в `action`.
* Для форм и UI: если MCP отдаёт явные связи «контрол → команда» и «контрол → атрибут», они уже отражены `BINDS` + `BINDS_TO_COMMAND`; при желании добавь `BINDS_TO_ATTRIBUTE`.

Если хочешь, я добавлю готовые **few-shot** куски под распознавание: запись/чтение регистров, обработчики событий форм, и матчинги директив `&НаСервере/Клиенте` → `exec_side`.

---

## Свойство collection на связях

- Во время индексации каждому отношению добавляется свойство `collection` со значением имени коллекции (`job.collection`).
- Это свойство используется сервисом визуализации графа для выборки подграфов по коллекции.
- Дополнительных миграций в Neo4j не требуется (свойство на отношениях не затрагивает существующие констрейнты на узлах).

Пример проверки в Neo4j:

```cypher
MATCH ()-[r]->()
WHERE r.collection = "MY_COLLECTION"
RETURN type(r) AS rel, count(*) AS cnt
ORDER BY cnt DESC

