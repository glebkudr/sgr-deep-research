## Open Questions and Decisions

### Open Questions
- How to pass/select the active collection: task config vs per-tool param?
- Exact whitelist of edge types and default thresholds (`min_score`, `max_neighbors_per_iter`, `max_files_total`) for 1C datasets. - пока не знаю, вынеси в конфиг
- Need for cross-encoder re-ranking for top-M files in the first iteration, or is passage→document aggregation sufficient? -- делаем пока простой вариант

### Decision Records (to be updated)
- Profile disables all web-related tools permanently for GraphRAG.
- `{available_tools}` must list only GraphRAG tools for this profile.
- Refusal string fixed: "Извините, я не нашёл подходящего ответа." (no variants allowed).


