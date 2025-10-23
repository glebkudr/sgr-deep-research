"""Run Neo4j constraint migrations for the GraphRAG ontology."""

from __future__ import annotations

import argparse
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List

from neo4j import GraphDatabase
from neo4j.exceptions import Neo4jError


logger = logging.getLogger("graphrag.migrations")


@dataclass
class Neo4jConfig:
    uri: str
    username: str
    password: str
    database: str


def load_environment() -> Neo4jConfig:
    """Load connection information from environment variables."""
    uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    username = os.getenv("NEO4J_USERNAME", "neo4j")
    password = os.getenv("NEO4J_PASSWORD")
    database = os.getenv("NEO4J_DATABASE", "neo4j")

    if not password:
        raise RuntimeError("NEO4J_PASSWORD must be set in environment before running migrations.")

    return Neo4jConfig(uri=uri, username=username, password=password, database=database)


def load_statements(path: Path) -> List[str]:
    """Parse a cypher file into individual statements."""
    buffer: List[str] = []
    statements: List[str] = []

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("//"):
            continue

        buffer.append(raw_line.rstrip())

        if line.endswith(";"):
            statement = "\n".join(buffer).rstrip().rstrip(";")
            if statement:
                statements.append(statement)
            buffer.clear()

    if buffer:
        # Support final statement without trailing semicolon.
        statement = "\n".join(buffer).rstrip()
        if statement:
            statements.append(statement)

    return statements


def apply_statements(config: Neo4jConfig, statements: Iterable[str], dry_run: bool = False) -> None:
    """Apply cypher statements to Neo4j."""
    if dry_run:
        logger.info("Dry run requested. The following statements would be executed:")
        for stmt in statements:
            logger.info("%s;", stmt.replace("\n", " "))
        return

    driver = GraphDatabase.driver(config.uri, auth=(config.username, config.password))
    try:
        with driver.session(database=config.database) as session:
            for statement in statements:
                logger.info("Executing: %s", statement.splitlines()[0])
                session.execute_write(lambda tx, s=statement: tx.run(s))
        logger.info("Migration completed successfully.")
    except Neo4jError as exc:
        logger.error("Failed to execute migration: %s", exc)
        raise
    finally:
        driver.close()


def get_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Apply Neo4j constraint migrations.")
    parser.add_argument(
        "--path",
        type=Path,
        default=Path(__file__).with_name("001_constraints.cypher"),
        help="Path to the cypher migration file.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print statements without executing them.")
    return parser


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = get_parser()
    args = parser.parse_args()

    config = load_environment()
    statements = load_statements(args.path)

    if not statements:
        logger.warning("No statements found in %s. Nothing to do.", args.path)
        return

    apply_statements(config, statements, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
