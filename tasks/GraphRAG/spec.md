# Refactoring/Design Plan: SGR-промпт для GraphRAG (file-centric Parent-Child/Hierarchical Retrieval)

  ## 1. Executive Summary & Goals
   - Цель: заменить «веб-поиск» парадигму в SGR на «GraphRAG file-centric retrieval» и закрепить это на уровне системного промпта и набора инструментов.
   - Ключевые результаты:
     - Новый системный промпт, который жёстко направляет агента использовать графовые инструменты (vector→chunk, promote→file, expand→neighbors, prune) и запрещает web.
     - Конфигурация агента SGR без WebSearchTool, с набором GraphRAG-тулов.
     - Fail-fast и наблюдаемость: строгие ответы при нехватке контекста, журналирование шагов.

## 2. Current Situation Analysis 
   - В проекте системный промпт подставляется через PromptLoader (sgr_deep_research/core/prompts.py) с плейсхолдером {available_tools}.
   - Агентные реализации (sgr_tools_agent.py, sgr_agent.py) собирают toolkit (system_agent_tools, research_agent_tools, MCP2ToolConverter). Сейчас набор включает веб-инструменты (WebSearchTool, ExtractPageContentTool), логика промпта описывает веб-поиск.
   - Для GraphRAG уже есть backend-компонент RetrievalService (graphrag_api/retrieval.py), а также сервисные клиенты Neo4j/FAISS (graphrag_service/*), но нет SGR-тулов, вызывающих эти операции непосредственно из агента.
   - Болевые точки: смешение доменов (веб vs граф), отсутствие промпт-правил про Parent-Child/Hierarchical retrieval, нет запрета на web, нет инструкций по file-centric ранжированию и «анти-взрыв» стратегиям.

## 3. Proposed Solution / Refactoring Strategy
   ### 3.1. High-Level Design / Architectural Overview
      - Ввести новый системный промпт «GraphRAG System Prompt», который:
        - Определяет роль агента как GraphRAG file-centric retriever для домена 1С.
        - Жёстко предписывает использовать только доступные графовые инструменты, каждый шаг через ReasoningTool.
        - Фиксирует алгоритм: retrieve chunks → promote to files → expand via graph neighbors → rerank files → prune frontier → stop checks.
        - Требует ответ только из предоставленного контекста, fail-fast строкой при нехватке.
      - Подготовить отдельный toolkit из GraphRAG-тулов (wrapper-ы поверх FAISS/Neo4j или MCP-интеграция), исключить web-инструменты из конкретного агента.
      - Обеспечить журналы и структурированную объяснимость: хранить supporting chunks/edges/files и cypher.

   ### 3.2. Key Components / Modules
      - Новый шаблон промпта:
        - файл: sgr_deep_research/core/prompts/graphrag_system_prompt.txt
        - содержит: роль, строгие правила, пошаговую стратегию, бюджет/стоп-правила, формат финального ответа, плейсхолдер {available_tools}.
      - Новый агент-профиль (вариант конфигурации):
        - класс-обёртка или фабрика для SGRToolCallingResearchAgent/SGRResearchAgent с отключёнными WebSearchTool/ExtractPageContentTool, добавленными GraphRAG-инструментами.
      - GraphRAG Toolkit (новые инструменты в sgr_deep_research/core/tools/):
        - VectorSearchChunksTool: запрос к FaissVectorStore (через graphrag_service.vector_store), возвращает чанки с parent_file и score.
        - ParentsOfChunksTool: подтягивает parent files (если не пришли в метаданных).
        - FilesRankFromChunksTool: агрегация passage→document (max/mean/softmax-attn), возвращает топ файлов с supporting_chunks.
        - FilesNeighborhoodViaChunksTool: расширение по рёбрам (REFERS_TO/CALLS/IMPORTS/INCLUDES) через Neo4j, группировка до файлов.
        - FilesPruneFrontierTool: анти-взрыв/дедуп/пороговые отсечки.
        - FilesGetFullTool: для объяснимости/контекста подтягивает содержимое/метаданные.
        - GraphTextMatchFilesTool: текстовые бусты по имени/пути/комментам.
        - GraphEffectsOfFileTool: эффекты и объяснимость (опционально).
        - MemoryStoreStateTool: лог итераций/рационале.
      - Конфигурация prompts_dir/system_prompt_file для режима GraphRAG в settings/config.

   ### 3.3. Detailed Action Plan / Phases
      - Phase 1: Промпт и конфигурация
        - Priority: High
        - Task 1.1: Добавить файл промпта sgr_deep_research/core/prompts/graphrag_system_prompt.txt
          - Rationale/Goal: Закрепить правила GraphRAG-режима на уровне системного промпта.
          - DoD: Файл существует, содержит плейсхолдер {available_tools}, проходит загрузку PromptLoader.get_system_prompt.
        - Task 1.2: Обновить конфиг для GraphRAG режима
          - Rationale/Goal: Указать prompts_dir и system_prompt_file на новый файл для профильного агента.
          - DoD: config.yaml (или профиль) имеет prompts.system_prompt_file=graphrag_system_prompt.txt; юнит-тест загружает именно его.
        - Task 1.3: Отключить web-инструменты для GraphRAG-агента
          - Rationale/Goal: Исключить использование WebSearchTool/ExtractPageContentTool.
          - DoD: В фабрике агента/конструкторе toolkit не содержит web-инструментов, списки available_tools в промпте совпадают.

      - Phase 2: Инструменты GraphRAG
        - Priority: High
        - Task 2.1: Реализовать VectorSearchChunksTool
          - Rationale/Goal: Начальное извлечение чанков по эмбеддингу.
          - DoD: Инструмент вызывает FaissVectorStore.query, возвращает список чанков с score, path, parent_file_id (из метаданных).
        - Task 2.2: Реализовать FilesRankFromChunksTool
          - Rationale/Goal: Агрегировать chunk→file и вернуть топ файлов.
          - DoD: Поддерживает методы max/mean/softmax-attn; юнит-тесты на корректность агрегации.
        - Task 2.3: Реализовать FilesNeighborhoodViaChunksTool
          - Rationale/Goal: Расширение по рёбрам через Neo4j, возвращает соседние файлы и supporting edges.
          - DoD: Выполняет Cypher с белым списком рёбер и лимитами; покрыт тестом со стабами Neo4j.
        - Task 2.4: Реализовать FilesPruneFrontierTool
          - Rationale/Goal: Анти-взрыв и дедуп с порогами.
          - DoD: Юнит-тесты на фильтрацию visited/min_score/max_batch.
        - Task 2.5: Реализовать вспомогательные инструменты FilesGetFullTool, GraphTextMatchFilesTool, GraphEffectsOfFileTool, MemoryStoreStateTool
          - Rationale/Goal: Объяснимость, буст релевантности, логирование итераций.
          - DoD: Инструменты отдают ожидаемые структуры; логируются параметры и результаты.

      - Phase 3: Агентная обвязка и поведение
        - Priority: Medium
        - Task 3.1: Создать GraphRAG-вариант агента
          - Rationale/Goal: Предустановленный toolkit и prompts для GraphRAG.
          - DoD: Класс-фабрика (например, GraphRAGResearchAgent) наследует SGRToolCallingResearchAgent или SGRResearchAgent, подставляет новый промпт и toolkit.
        - Task 3.2: Настроить лимиты/бюджеты итераций
          - Rationale/Goal: Стабильность и контроль затрат.
          - DoD: Конфиг управляет max_iters, max_files_total, max_neighbors_per_iter, min_score; агент уважает их.
        - Task 3.3: Интеграционные тесты сценария
          - Rationale/Goal: Проверить полный цикл: retrieve→promote→expand→prune→final answer.
          - DoD: Сквозной тест со стабами FAISS/Neo4j; проверка отсутствия вызовов web-инструментов.

   ### 3.4. Data Model Changes (if applicable)
      - Нет изменений в графовой схеме. Инструменты используют существующие узлы/ребра. Возможно, потребуется убедиться, что чанки в векторном индексе содержат parent_file_id, path, node_id в метаданных (это уже предусмотрено RetrievalService._select_chunk_contexts).

   ### 3.5. API Design / Interface Changes (if applicable)
      - Инструменты обращаются к существующим сервисам:
        - FAISS: через graphrag_service.vector_store.FaissVectorStore
        - Neo4j: через graphrag_service.neo4j_client.neo4j_session
      - Внешний API не меняется. Для MCP-варианта — опционально описать эндпоинты тулов, но в рамках данного плана не требуется.

## 4. Key Considerations & Risk Mitigation
  ### 4.1. Technical Risks & Challenges
      - Риск: Агент всё ещё попытается использовать web-инструменты.
        - Митигирование: Исключить web-инструменты из toolkit GraphRAG-агента; явный запрет в системном промпте.
      - Риск: Взрыв соседства в графе.
        - Митигирование: Белый список рёбер, жёсткие лимиты max_neighbors_per_file, prune фронтира и min_score пороги.
      - Риск: Недостаточный контекст для ответа.
        - Митигирование: Жёсткая фраза отказа (как в RetrievalService), правило fail-fast в промпте и проверка в финальном ответе.
      - Риск: Неполные метаданные в векторном индексе.
        - Митигирование: Доп. шаг ParentsOfChunksTool или корректировка пайплайна индексации для гарантированного parent_file_id.

  ### 4.2. Dependencies
      - Внутренние: наличие корректных индексов FAISS и данных в Neo4j; настройки prompts в config; реализации GraphRAG-тулов.
      - Внешние: OpenAI-модель для SGR; отсутствие конфликтов с MCP-динамическими инструментами (при GraphRAG-профиле MCP можно отключить).

  ### 4.3. Test design
      - Unit:
        - PromptLoader загружает graphrag_system_prompt.txt, корректно подставляет {available_tools}.
        - Каждый GraphRAG-tool: валидация входов (fail fast), логирование, ожидаемые структуры результатов.
      - Integration:
        - Сквозной сценарий retrieve→promote→expand→prune c заглушками FAISS/Neo4j; проверка, что агент не вызывает web-инструменты.
      - Behavioral:
        - Проверка ответов: при пустом контексте агент возвращает ровно строку отказа.

  ### 4.4. Non-Functional Requirements (NFRs) Addressed
      - Надёжность: fail-fast при недостающих данных/некорректных входах; строгая фраза отказа.
      - Производительность: анти-взрыв лимиты, раннее ранжирование по файлам, агрегация сигналов.
      - Обслуживаемость: разделение промпта, чёткий toolkit; модульные инструменты.
      - Безопасность: запрет внешних запросов (web), только локальные источники.
      - Наблюдаемость: структурированное логирование параметров/результатов инструментов и итераций.

## 5. Success Metrics / Validation Criteria
   - Агент не вызывает web-инструменты в GraphRAG-профиле.
   - Ответы опираются на файл-уровневые цитаты и графовые пути; при недостатке контекста — точная фраза отказа.
   - В интеграционном тесте агент выполняет минимум 1 полный цикл retrieve→promote→expand→prune и формирует объяснимость (supporting chunks/files/edges).
   - Снижение «шумовых» файлов в топе за счёт document-level reranking.

## 6. Assumptions Made
   - Имя коллекции/набора данных доступно агенту либо через конфигурацию задачи, либо через отдельный параметр инструмента.
   - Метаданные чанков в векторном индексе содержат chunk_id, parent_file_id, path, node_id и score; иначе будет задействован ParentsOfChunksTool.
   - Разрешённые типы рёбер и лимиты будут заданы в настройках.

## 7. Open Questions / Areas for Further Investigation
   - Где хранить и как передавать active collection для агентных вызовов (конфиг задачи vs tool param)?
   - Точный список разрешённых рёбер и пороги (min_score, max_neighbors_per_iter, max_files_total) для типичных коллекций 1С.
   - Нужна ли в первой итерации лёгкая переоценка (cross-encoder) для top-M файлов или достаточно passage→document агрегации?


---

Приложение: Каркас содержимого системного промпта (graphrag_system_prompt.txt)

Role:
- You are a GraphRAG retrieval agent for 1C codebases. Operate strictly with the provided graph and vector index. Answer in Russian only.

Hard constraints:
- Use only the available tools listed below. Never use web search or external resources.
- Always call ReasoningTool before any action, and after executing the action to reassess state.
- Ground your answer exclusively in retrieved context. If insufficient, reply exactly: "Извините, я не нашёл подходящего ответа."
- Keep responses concise (1–2 sentences) and include explicit supporting facts when available.

Retrieval strategy (file-centric Parent-Child / Hierarchical):
1) Retrieve top-k chunks via vector search.
2) Promote chunk signals to files (document-level aggregation: max/mean/softmax-attn). Prefer whole-file context.
3) Expand via graph neighbors across whitelisted edge types (REFERS_TO, CALLS, IMPORTS, INCLUDES), group back to files.
4) Rerank and prune frontier with strict limits to prevent graph explosion.
5) Iterate until budget/stop criteria (max_iters, max_files_total, stability) are met.

Budget and stop rules:
- Respect configured limits for iterations and neighbors per iteration.
- Stop early if frontier is empty or the top-N set stabilizes for multiple iterations.

Explainability and logging:
- Keep for each selected file: supporting chunks and edges that justify inclusion.
- Store iteration state via memory tool to enable traceability.

Finalization:
- Use FinalAnswerTool only when enough_data is true, providing: answer, list of supporting files, brief rationale, and confidence.

Available tools:
{available_tools}
