SHELL := /bin/bash
COMPOSE ?= docker compose
COMPOSE_FILE ?= docker-compose.yml
COMPOSE_DEV_FLAGS ?= -f docker-compose.yml -f docker-compose.dev.yml
ENV_FILE ?= .env

# Windows copy/paste equivalents:
#   up          -> docker compose -f docker-compose.yml up -d neo4j redis
#   down        -> docker compose -f docker-compose.yml down
#   stop        -> docker compose -f docker-compose.yml stop
#   logs        -> docker compose -f docker-compose.yml logs -f neo4j redis
#   build       -> docker compose -f docker-compose.yml build
#   up-dev      -> docker compose -f docker-compose.yml -f docker-compose.dev.yml up
#   down-dev    -> docker compose -f docker-compose.yml -f docker-compose.dev.yml down
#   stop-dev    -> docker compose -f docker-compose.yml -f docker-compose.dev.yml stop
#   logs-dev    -> docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f

.PHONY: up down stop logs ps build seed-neo4j-constraints env-copy up-dev down-dev stop-dev logs-dev

up:
	$(COMPOSE) -f $(COMPOSE_FILE) up -d neo4j redis

down:
	$(COMPOSE) -f $(COMPOSE_FILE) down

stop:
	$(COMPOSE) -f $(COMPOSE_FILE) stop

logs:
	$(COMPOSE) -f $(COMPOSE_FILE) logs -f neo4j redis

ps:
	$(COMPOSE) -f $(COMPOSE_FILE) ps

build:
	$(COMPOSE) -f $(COMPOSE_FILE) build

seed-neo4j-constraints:
	python services/indexer/migrations/run_constraints.py

env-copy:
	@if [ ! -f $(ENV_FILE) ]; then cp .env.example $(ENV_FILE); fi

up-dev:
	$(COMPOSE) $(COMPOSE_DEV_FLAGS) up --build

down-dev:
	$(COMPOSE) $(COMPOSE_DEV_FLAGS) down

stop-dev:
	$(COMPOSE) $(COMPOSE_DEV_FLAGS) stop

logs-dev:
	$(COMPOSE) $(COMPOSE_DEV_FLAGS) logs -f
