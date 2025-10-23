from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from neo4j import GraphDatabase

from .config import get_settings


def get_neo4j_driver():
    settings = get_settings()
    return GraphDatabase.driver(settings.neo4j_uri, auth=(settings.neo4j_username, settings.neo4j_password))


@contextmanager
def neo4j_session(database: str | None = None) -> Iterator:
    settings = get_settings()
    driver = get_neo4j_driver()
    try:
        with driver.session(database=database or settings.neo4j_database) as session:
            yield session
    finally:
        driver.close()
