SHELL := /bin/bash
COMPOSE ?= docker compose
COMPOSE_FILE ?= docker-compose.yml
ENV_FILE ?= .env

.PHONY: up down stop logs ps build seed-neo4j-constraints env-copy

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
