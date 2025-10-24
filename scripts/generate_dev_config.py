from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import yaml
except ModuleNotFoundError as exc:  # pragma: no cover - handled at runtime
    raise RuntimeError("PyYAML is required to generate the dev config.") from exc


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def optional_env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None:
        return default
    value = value.strip()
    return value if value else default


def build_config() -> dict:
    openai_api_key = require_env("OPENAI_API_KEY")
    tavily_api_key = require_env("TAVILY_API_KEY")

    return {
        "openai": {
            "api_key": openai_api_key,
            "base_url": optional_env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            "model": optional_env("QA_MODEL", "gpt-4o-mini"),
            "max_tokens": int(optional_env("OPENAI_MAX_TOKENS", "8000")),
            "temperature": float(optional_env("QA_TEMPERATURE", "0.4")),
            "proxy": optional_env("OPENAI_PROXY", ""),
        },
        "tavily": {
            "api_key": tavily_api_key,
            "api_base_url": optional_env("TAVILY_API_BASE_URL", "https://api.tavily.com"),
        },
        "search": {"max_results": int(optional_env("SEARCH_MAX_RESULTS", "10"))},
        "scraping": {
            "enabled": optional_env("SCRAPING_ENABLED", "false").lower() == "true",
            "max_pages": int(optional_env("SCRAPING_MAX_PAGES", "5")),
            "content_limit": int(optional_env("SCRAPING_CONTENT_LIMIT", "1500")),
        },
        "prompts": {
            "prompts_dir": optional_env("PROMPTS_DIR", "prompts"),
            "system_prompt_file": optional_env("SYSTEM_PROMPT_FILE", "system_prompt.txt"),
        },
        "execution": {
            "max_steps": int(optional_env("EXECUTION_MAX_STEPS", "6")),
            "reports_dir": optional_env("EXECUTION_REPORTS_DIR", "reports"),
            "logs_dir": optional_env("EXECUTION_LOGS_DIR", "logs"),
        },
        "logging": {"config_file": optional_env("LOGGING_CONFIG_FILE", "logging_config.yaml")},
        "mcp": {
            "context_limit": int(optional_env("MCP_CONTEXT_LIMIT", "15000")),
            "transport_config": {},
        },
    }


def main() -> None:
    output_path = Path(os.getenv("DEV_APP_CONFIG_PATH", "config.generated.yaml"))
    config = build_config()
    output_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    print(f"Generated dev config at {output_path.resolve()}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - runtime failure surfaced
        print(f"Failed to generate dev config: {exc}", file=sys.stderr)
        raise
