# Зачем эта система (смысл и ценность)

Классический векторный RAG «видит» текст фрагментами и плохо объясняет **почему** ответ верен. Для 1С это критично: реальный вопрос почти всегда — про **поведение** (кто кого вызывает, какие регистры читаются/пишутся, какие формы и права задействованы).
GraphRAG решает это так:

* **Строит предметный граф 1С** по вашей онтологии (Объект → Модуль → Процедура/Функция → Регистры/Атрибуты/Роли/Формы → …) и связывает его с текстовыми чанками (код/комментарии/описания). 
* **Ретривит по смыслу и по связям одновременно**: сначала находит релевантные куски текста (эмбеддинги), затем **раскрывает** окружение в графе (CALLS/READS_FROM/WRITES_TO/REFERENCES/HAS_*), подтягивая цепочку причинно-следственных узлов.
* **Отвечает строго из контекста** и возвращает **цитаты + пути графа** (trace): оператор видит, какие процедуры, модули и регистры привели к ответу — можно кликнуть и перейти к исходнику.

пример как в репе https://github.com/ROCTUP/1c-mcp-metacode

Что это даёт:

* ✅ Ответы «как это работает?» не в вакууме, а с трассируемыми цепочками.
* ✅ Уменьшение галлюцинаций: LLM отвечает **только** из извлечённого контекста.
* ✅ Готовая точка интеграции с SGR-агентами (инструмент ретривала в составе более сложных пайплайнов).

---

# Общая картина (в 30 секунд)

* **Indexer (worker)**: принимает файлы (html/xml/bsl/txt) → чанкует → делает эмбеддинги → пишет узлы/рёбра в Neo4j → строит локальный векторный индекс (FAISS) → маппит `chunk_id → node_id`.
* **API (FastAPI)**: загрузка/статус задач, Q&A (гибридный ретривал, LLM-ответ со ссылками), минимальный Admin/health.
* **GUI (Next.js)**: страница Upload/Index (драг-энд-дроп, прогресс, статусы), страница Q&A (чат, стрим ответа, цитаты, «пути графа»).
* **SGR-интеграция**: 2 инструмента — `graphrag.search` и `graphrag.expand` (строго без внешних фоллбэков).

---

# Приоритет 1) Механизм индексирования + GUI

## 1.1 Архитектура индексатора

Пайплайн задачи индексации:

1. **Loaders**: читаем локальные файлы (монтируемый volume `workspace`).
2. **Normalize**: выравниваем кодировку/концы строк; извлекаем относительный путь.
3. **Extract 1C features** (эвристики для BSL и метаданных):

   * `Routine` (имя, сигнатура, export, exec_side, owner).
   * Межмодульные вызовы `CALLS` (по статическим вызовам).
   * Доступ к регистрам `WRITES_TO/READS_FROM` (по ключевым паттернам).
   * Ссылки на объекты метаданных `REFERENCES`.
   * Привязки форм/ролей/команд (если распознаны из html/xml).
4. **Chunking**: семантический/структурный, цель ~800 токенов, overlap ~120.
5. **Embeddings**: OpenAI BYOK (`text-embedding-3-large` по умолчанию).
6. **Graph writer (Neo4j)**: upsert узлов/рёбер по вашей онтологии (из ответа), индексы/уникальные ограничения.
7. **Vector index**: локальный FAISS (`/indexes/<collection>/faiss`) + таблица соответствия `chunk_id ↔ graph node_id/path`.

### Neo4j: обязательные ограничения (пример Cypher)

```cypher
CREATE CONSTRAINT IF NOT EXISTS FOR (o:Object) REQUIRE o.qualified_name IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (r:Routine) REQUIRE r.guid IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (m:Module) REQUIRE m.guid IS UNIQUE;
CREATE INDEX IF NOT EXISTS FOR (f:Form) ON (f.guid);
CREATE INDEX IF NOT EXISTS FOR (reg:AccumulationRegister) ON (reg.name);
CREATE INDEX IF NOT EXISTS FOR (inf:InformationRegister) ON (inf.name);
```

### Запись графа (общий паттерн)

* Upsert узел по ключам из `entity_resolution` вашей онтологии.
* Upsert ребро по типу из `relationship_types`.
* Свяжите `Chunk` → `PART_OF_DOCUMENT` → `Document` → `RESOLVES_TO` → доменные `Object/Module/Routine` (если используете лексический слой).

## 1.2 API для индексации

* `POST /upload`

  * multipart файлы **или** `{ paths: string[] }` (если фронт уже положил в workspace).
  * сервер складывает сырые файлы в `/app/workspace/<collection>/<job-id>/raw` и ставит джобу в Redis.
  * ответ: `{ job_id }`.
* `GET /jobs/{job_id}` → `{ status, stats, errors[] }`.
* `POST /indexes/rebuild` (опционально) → `{ job_id }`.

**Статусы**: `PENDING | RUNNING | DONE | ERROR` + `processed_files`, `nodes_written`, `edges_written`, `vector_chunks`, `duration_sec`.

## 1.3 GUI: страница Upload/Index

Функции:

* Drag&drop / выбор файлов. Поле `collection` (строка). Кнопка «Индексировать».
* Отправка на `/upload`, получение `job_id`.
* Поллинг `/jobs/{job_id}` каждые 1–2 сек → прогрессбар, статистика, логи ошибок.
* Список последних задач с quick-actions: «повторить», «очистить коллекцию» (опционально).

Минимальная модель фронта:

```ts
type Job = {
  id: string; status: 'PENDING'|'RUNNING'|'DONE'|'ERROR';
  stats?: { processed_files: number; nodes: number; edges: number; vector_chunks: number; };
  errors?: string[];
}
```

## 1.4 DoD индексатора

* Загружается ≥ N файлов (bsl/xml/html/txt), «DONE» ≤ 60 минут на 5 ГБ (базовая цель).
* В Neo4j присутствуют ключевые узлы (Object/Module/Routine/Register/Form/Role), связи `CALLS/READS_FROM/WRITES_TO/REFERENCES/HAS_*`.
* Построен FAISS-индекс; маппинг `chunk_id → node_id` сохранён.
* Рестарт безопасен (идемпотентные upsert’ы).

---


# Приоритет 2) Простой ретривал Q&A + GUI

## 2.1 Поток запроса

1. **/qa** принимает `{ question, collection, top_k=12, max_hops=2 }`.
2. **Vector search**: ищем по FAISS top_k_v ~ 50.
3. **Seed extraction**: из top_k_v извлекаем связанные доменные узлы (Object/Routine/Register/…); собираем `seed_ids`.
4. **Graph expansion** (k-hop, по «сильным» рёбрам): `CALLS, USES_MODULE, REFERENCES, WRITES_TO, READS_FROM, HAS_*`.
5. **Context pack**:

   * лучшие чанки (текст + путь к файлу),
   * набор опорных узлов,
   * пары/пути (nodes/edges),
   * список использованных Cypher (для трассировки).
6. **LLM Answer (strict grounding)**: промпт (англ) с правилом «отвечай по-русски, только из контекста; иначе “Недостаточно данных в индексе.”».
7. Ответ:

   ```json
   {
     "answer": "…",
     "citations": [{ "node_id":123, "label":"Routine", "title":"Документы.ОбработкаПроведения()", "snippet":"…", "path":"…/src/module.bsl" }],
     "graph_paths": [{ "nodes":[…], "edges":[…] }],
     "cypher_used": ["MATCH …", "MATCH …"],
     "confidence": 0.0
   }
   ```

### Пример Cypher без APOC (k-hop до 2)

```cypher
MATCH (s) WHERE id(s) IN $seed_ids
MATCH p=(s)-[r1]->(m)
WHERE type(r1) IN $strong_rels
OPTIONAL MATCH p2=(m)-[r2]->(t)
WHERE type(r2) IN $strong_rels
RETURN p, p2 LIMIT 200;
```

`$strong_rels = ["CALLS","USES_MODULE","REFERENCES","WRITES_TO","READS_FROM",
"HAS_MODULE","HAS_ROUTINE","HAS_FORM","DEFINES_ATTRIBUTE","HAS_DIMENSION","HAS_RESOURCE","HAS_TABULAR_PART"]`

### Строгий промпт (идея)

* System: «You are a code base QA explainer. Use only the supplied context, otherwise answer in Russian: “Недостаточно данных в индексе.” Output must be concise and factual, no speculation.»
* User: вопрос (RU).
* Context: чанки + «краткая сводка путей»:

  * «Модуль A вызывает Процедуру B, которая пишет в Регистр X…».

## 2.2 GUI: страница Q&A (чат)

* Поле вопроса → отправка на `/qa` (SSE для стрима).
* Блок ответа (стрим).
* «Цитаты»: список источников (кликабельны; показываем сниппет + путь).
* «Пути графа» — компактный просмотр (табличка: from →(edge)→ to), сортировать по длине/релевантности.

Мини-модель фронта:

```ts
type Citation = { node_id: number; label: string; title: string; snippet: string; path?: string };
type GraphPath = { nodes: {id:number; label:string; title?:string}[]; edges:{type:string; from:number; to:number}[] };
```

## 2.3 DoD Q&A

* На типовых вопросах «где пишется регистр X», «кто вызывает Y» — ответ ≤ 4 сек p95, с ≥ 1–2 валидными цитатами.
* При отсутствии контента: корректный отказ («Недостаточно данных…»).
* Референсы кликабельны и ведут к ожидаемым файлам/рутинам.

---

# Приоритет 3) Подключение диалогового SGR-агента

## 3.1 Инструменты для агента

* **`graphrag.search`** — основной инструмент ответа.

  * input: `{ question, collection, top_k?, max_hops?, hint_entities?[] }`
  * output: `{ answer, citations[], graph_paths[], cypher_used[], confidence }`
* **`graphrag.expand`** — расширение подграфа (для уточняющих расследований).

  * input: `{ node_ids[], max_hops?, filters? }`
  * output: `{ subgraph: { nodes[], edges[] } }`

Политика:

* `answer_from_graph_only = true`
* **без фоллбэков** (никакого веб-поиска).
* (Опц.) «Clarification» включать только если вопрос слишком расплывчатый: агент спрашивает «о какой подсистеме/объекте речь?».

## 3.2 Контракт интеграции

Если у тебя SGR уже предоставляет OpenAI-совместимый /v1/chat/completions — то достаточно предоставить **tool schema** в messages:

```json
{
  "type": "function",
  "function": {
    "name": "graphrag.search",
    "description": "Answer domain question strictly from the 1C graph+chunks.",
    "parameters": {
      "type":"object",
      "properties":{
        "question":{"type":"string"},
        "collection":{"type":"string"},
        "top_k":{"type":"integer","default":12},
        "max_hops":{"type":"integer","default":2},
        "hint_entities":{"type":"array","items":{"type":"string"}}
      },
      "required":["question","collection"]
    }
  }
}
```

Ответ инструмента передаётся в SGR, который формирует финальный месседж пользователю (RU).

## 3.3 DoD SGR

* Агент корректно вызывает `graphrag.search` и **не** пытается отвечать без него.
* При расплывчатом вопросе → 1 уточняющий вопрос, затем вызов инструмента.
* Ответ совпадает с «ручным» `/qa` ≥ 95% случаев.

---

# Технические шаги по компонентам (пошаговый план)

## A. Repo каркас (день 0–1)

```
/services
  /api (FastAPI)
  /indexer (worker + пайплайн)
/frontend (Next.js)
/workspace  # общая папка для локальных файлов
/indexes    # FAISS индексы
docker-compose.yml
.env.example
```

* Поднять Docker Compose: `neo4j`, `redis`, `graphrag-api`, `graphrag-indexer`, `front`.
* В `neo4j` применить constraints (скрипт миграции).

## B. Индексатор (день 1–4)

1. **Loaders**: рекурсивный обход `workspace/<collection>/<job-id>/raw`, фильтры по расширениям.
2. **Extract 1C**: простые регулярки/парсеры для BSL (имена процедур/функций, экспорт, ключевые обращения к регистрам, ссылки на объекты).
3. **Chunking**: по заголовкам/процедурам; fallback — по размеру.
4. **Embeddings (OpenAI)**: батчирование, ретраи, лимиты RPS.
5. **Graph writer**: idempotent upsert по онтологии (MERGE); накопительный счётчик узлов/рёбер.
6. **FAISS build**: сохранить индекс + таблицу `chunk_id → node_id, path`.
7. **Job status**: прогресс в Redis (JSON).
8. **Тесты**: парсер BSL на синтетике, запись узлов/связей, консистент-чек (уникальные ключи).

## C. GUI Upload/Index (день 2–4)

* Страница `/upload`: драг-энд-дроп → `POST /upload` → поллинг `/jobs/:id`.
* Отображение статистики, список последних задач.

## D. Q&A API (день 4–6)

* Векторный поиск → seed → k-hop расширение → сбор контекста → LLM (strict) → ответ.
* SSE стриминг.
* Тест-набор: 10–20 ваших вопросов → ручная валидация цитат и путей.

## E. GUI Q&A (день 5–6)

* Страница `/qa`: поле вопроса, стрим ответа, блоки «Цитаты», «Пути».
* Переключатели `top_k`, `max_hops`.

## F. Интеграция SGR (день 6–7)

* Экспорт JS/JSON схем tools; эндпоинт-прокси под OpenAI-совместимый формат — если требуется.
* Включить в вашем SGR конфиг инструмент `graphrag.search`.
* E2E тест: SGR → инструмент → ответ.

---

# Конфигурация и эксплуатация

**.env**

```
OPENAI_API_KEY=sk-...
NEO4J_PASSWORD=neo4jpass
JWT_SECRET=change_me
EMBEDDING_MODEL=text-embedding-3-large
```

**Ресурсы**

* Neo4j heap 8ГБ, pagecache 8ГБ (под 5 ГБ корпуса ок).
* Indexer CPU 4, RAM 16ГБ (регулируется по месту).

**Мониторинг**

* Логи индексатора с агрегацией по фазам.
* Счётчики: files, chunks, nodes, edges, faiss_vectors, duration.

**Безопасность**

* Один оператор, JWT.
* Доступ только локально (или за reverse proxy).
* Секреты — только в .env (не коммитить).

---

# Риски и как снизить

* **Парсинг BSL/метаданных**: начните с эвристик (регулярки и ключевые шаблоны). Позже можно добавить полноценный парсер.
* **Объём графа**: следите за ростом ребёр (`CALLS` легко разрастается). Ограничивайте `max_hops`, лимиты на расширение.
* **Качество эмбеддингов**: если окажется, что OpenAI «переобобщает», держите опцию локальной модели (bge-m3/GTE) с переиндексацией.
* **Строгий ответ**: при недостатке контекста не пытайтесь «додумывать» — это фича, а не баг.
