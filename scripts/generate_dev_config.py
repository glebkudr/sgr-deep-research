from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Dict


def load_dotenv(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}

    data: Dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if value and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        data[key] = value
    return data


DOTENV_CACHE = load_dotenv(Path(".env"))


def lookup_env(name: str) -> str | None:
    value = os.getenv(name)
    if value is not None and value.strip():
        return value.strip()
    value = DOTENV_CACHE.get(name)
    if value is None or not value.strip():
        return None
    return value.strip()


def require_env(name: str) -> str:
    value = lookup_env(name)
    if value is None:
        raise RuntimeError(f"Missing required configuration value '{name}'. "
                           "Provide it via environment variable or .env file before running make up-dev.")
    return value


def optional_env(name: str, default: str | None = None) -> str | None:
    value = lookup_env(name)
    if value is None:
        return default
    return value if value else default


def optional_int(name: str, default: int) -> int:
    raw = optional_env(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"Invalid integer value for {name}: {raw}") from exc


def optional_float(name: str, default: float) -> float:
    raw = optional_env(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise RuntimeError(f"Invalid float value for {name}: {raw}") from exc


def optional_bool(name: str, default: bool) -> bool:
    raw = optional_env(name)
    if raw is None:
        return default
    lowered = raw.lower()
    if lowered in {"true", "1", "yes"}:
        return True
    if lowered in {"false", "0", "no"}:
        return False
    raise RuntimeError(f"Invalid boolean value for {name}: {raw}")


def build_config() -> dict:
    openai_api_key = require_env("OPENAI_API_KEY")
    tavily_api_key = require_env("TAVILY_API_KEY")

    return {
        "openai": {
            "api_key": openai_api_key,
            "base_url": optional_env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            "model": optional_env("QA_MODEL", "gpt-4o-mini"),
            "max_tokens": optional_int("OPENAI_MAX_TOKENS", 8000),
            "temperature": optional_float("QA_TEMPERATURE", 0.4),
            "proxy": optional_env("OPENAI_PROXY", ""),
        },
        "tavily": {
            "api_key": tavily_api_key,
            "api_base_url": optional_env("TAVILY_API_BASE_URL", "https://api.tavily.com"),
        },
        "search": {"max_results": optional_int("SEARCH_MAX_RESULTS", 10)},
        "scraping": {
            "enabled": optional_bool("SCRAPING_ENABLED", False),
            "max_pages": optional_int("SCRAPING_MAX_PAGES", 5),
            "content_limit": optional_int("SCRAPING_CONTENT_LIMIT", 1500),
        },
        "prompts": {
            "prompts_dir": optional_env("PROMPTS_DIR", "prompts"),
            "system_prompt_file": optional_env("SYSTEM_PROMPT_FILE", "system_prompt.txt"),
        },
        "execution": {
            "max_steps": optional_int("EXECUTION_MAX_STEPS", 6),
            "reports_dir": optional_env("EXECUTION_REPORTS_DIR", "reports"),
            "logs_dir": optional_env("EXECUTION_LOGS_DIR", "logs"),
        },
        "logging": {"config_file": optional_env("LOGGING_CONFIG_FILE", "logging_config.yaml")},
        "mcp": {
            "context_limit": optional_int("MCP_CONTEXT_LIMIT", 15000),
            "transport_config": {},
        },
    }


def main() -> None:
    output_path = Path(optional_env("DEV_APP_CONFIG_PATH", "config.generated.yaml") or "config.generated.yaml")
    config = build_config()
    output_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    print(json.dumps({"event": "dev_config_generated", "path": str(output_path.resolve())}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"event": "dev_config_failed", "error": str(exc)}), file=sys.stderr)
        raise
