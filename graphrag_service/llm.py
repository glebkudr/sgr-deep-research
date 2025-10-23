from __future__ import annotations

from typing import List

from openai import OpenAI, OpenAIError

from .config import get_settings


class OpenAIChatClient:
    """Wrapper for OpenAI chat completions used in Q&A pipeline."""

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured.")
        self.client = OpenAI(api_key=settings.openai_api_key)
        self.model = settings.qa_model
        self.temperature = settings.qa_temperature
        self.max_tokens = settings.qa_max_tokens

    def complete(self, system_prompt: str, messages: List[dict]) -> str:
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                messages=[{"role": "system", "content": system_prompt}, *messages],
            )
        except OpenAIError as exc:  # pragma: no cover
            raise RuntimeError(f"Failed to generate response: {exc}") from exc

        return response.choices[0].message.content or ""
