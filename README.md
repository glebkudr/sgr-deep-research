# SGR Deep Research - Open-Source Schema-Guided Reasoning System

## Description

![SGR Concept Architecture](docs/sgr_concept.png)
Open-source framework for building intelligent research agents using Schema-Guided Reasoning. The project provides a core library with a extendable BaseAgent interface implementing a two-phase architecture and multiple ready-to-use research agent implementations built on top of it.

The library includes extensible tools for search, reasoning, and clarification, real-time streaming responses, OpenAI-compatible REST API. Works with any OpenAI-compatible LLM, including local models for fully private research.

______________________________________________________________________

## Documentation

> **Get started quickly with our documentation:**

- **[Project Wiki](https://github.com/vamplabAI/sgr-deep-research/wiki)** - Complete project documentation
- **[Quick Start Guide](https://github.com/vamplabAI/sgr-deep-research/wiki/SGR-Quick-Start)** - Get up and running in minutes
- **[API Documentation](https://github.com/vamplabAI/sgr-deep-research/wiki/SGR-Description-API)** - REST API reference with examples

______________________________________________________________________

## Development Environment with Hot Reload

Use the dedicated dev compose file to run the full stack with live reload for every service.

1. Copy the sample env file and enable dev mode:
   ```bash
   cp .env.example .env
   ```
   Update `.env` with real secrets and set `DEV=true`. Populate `NEO4J_USER_RO` / `NEO4J_PASS_RO` with read-only credentials (can match the admin user in local setups). Set both `OPENAI_API_KEY` and `TAVILY_API_KEY`; the dev stack will generate `config.generated.yaml` automatically for the SGR service based on these values.
2. Start the stack:
   ```bash
   make up-dev
   ```
   This combines `docker-compose.yml` with `docker-compose.dev.yml`, enabling:
   - Next.js frontend on port 3000 (`npm run dev` with polling for Docker Desktop);
   - FastAPI (`uvicorn --reload`) on port 8000;
   - Indexer worker auto-restart on Python changes via `watchfiles`;
   - Graph viewer dev server on port 8081 (`ts-node-dev`);
   - SGR API service running with Uvicorn reload on port 8010.
3. Stop services with `make stop-dev` or `make down-dev`. Follow logs with `make logs-dev`.

The production compose file remains unchanged; omit `DEV=true` or the dev compose override to run the immutable builds.

______________________________________________________________________

## Benchmarking

![SimpleQA Benchmark Comparison](docs/simpleqa_benchmark_comparison.png)

**Performance Metrics on gpt-4.1-mini:**

- **Accuracy:** 86.08%
- **Correct:** 3,724 answers
- **Incorrect:** 554 answers
- **Not Attempted:** 48 answers

More detailed benchmark results are available [here](benchmark/simpleqa_benchmark_results.md).

______________________________________________________________________

## Open-Source Development Team

*All development is driven by pure enthusiasm and open-source community collaboration. We welcome contributors of all skill levels!*

- **SGR Concept Creator** // [@abdullin](https://t.me/llm_under_hood)
- **Project Coordinator & Vision** // [@VaKovaLskii](https://t.me/neuraldeep)
- **Lead Core Developer** // [@virrius](https://t.me/virrius_tech)
- **API Development** // [Pavel Zloi](https://t.me/evilfreelancer)
- **Hybrid FC research** // [@Shadekss](https://t.me/Shadekss)
- **DevOps & Deployment** // [@mixaill76](https://t.me/mixaill76)

If you have any questions - feel free to reach out to [Valerii Kovalskii](https://www.linkedin.com/in/vakovalskii/)↗️.

## Special Thanks To:

This project is developed by the **neuraldeep** community. It is inspired by the Schema-Guided Reasoning (SGR) work and [SGR Agent Demo](https://abdullin.com/schema-guided-reasoning/demo)↗️ delivered by "LLM Under the Hood" community and AI R&D Hub of [TIMETOACT GROUP Österreich](https://www.timetoact-group.at)↗️

Recent benchmarks and validation experiments were conducted in collaboration with the AI R&D team at red_mad_robot. The lab operates at the intersection of fundamental science and real-world business challenges, running applied experiments and building scalable AI solutions with measurable value.

Learn more about the company: [redmadrobot.ai](https://redmadrobot.ai/) ↗️
