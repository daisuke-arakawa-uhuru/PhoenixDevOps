from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol


class GeminiClient(Protocol):
    def generate(self, prompt: str) -> str:
        ...


@dataclass(frozen=True)
class GeminiSettings:
    api_key: Optional[str]
    model: str
    dry_run: bool = False


class GoogleGenAIClient:
    def __init__(self, settings: GeminiSettings) -> None:
        if not settings.api_key:
            raise ValueError("GEMINI_API_KEY is required when dry-run is disabled")

        from google import genai

        self._client = genai.Client(api_key=settings.api_key)
        self._model = settings.model

    def generate(self, prompt: str) -> str:
        response = self._client.models.generate_content(
            model=self._model,
            contents=prompt,
        )
        text = getattr(response, "text", None)
        if text:
            return text
        return str(response)


class DryRunGeminiClient:
    def generate(self, prompt: str) -> str:
        if "[TASK: SOURCE_ANALYSIS]" in prompt:
            static_overview = _extract_prompt_section(
                prompt,
                "## 事前抽出済みの構造情報",
                "## 入力ファイル抜粋",
            )
            return "\n".join(
                [
                    "## ソースコード解析結果（dry-run）",
                    "",
                    "- Gemini API は呼び出していません。",
                    "- 事前抽出済みの構造情報と prompt 構造の確認用レスポンスです。",
                    "",
                    _truncate(static_overview, 3000),
                ]
            )
        if "[TASK: DOCUMENT_EXTRACTION]" in prompt:
            document_overview = _extract_prompt_section(
                prompt,
                "## 事前抽出済みのドキュメント情報",
                "## ドキュメント抜粋",
            )
            return "\n".join(
                [
                    "## ドキュメント抽出結果（dry-run）",
                    "",
                    "- Gemini API は呼び出していません。",
                    "- 事前抽出済みのドキュメント情報と prompt 構造の確認用レスポンスです。",
                    "",
                    _truncate(document_overview, 3000),
                ]
            )
        if "[TASK: TRUE_DESIGN]" in prompt:
            source_summary = _extract_prompt_section(
                prompt,
                "## ソースコード解析結果",
                "## ドキュメント抽出結果",
            )
            return "\n".join(
                [
                    "# 真の設計書（dry-run）",
                    "",
                    "この成果物はローカル動作確認用です。",
                    "Gemini API を呼び出さず、生成フェーズの接続だけを確認しています。",
                    "",
                    "## ソースコード解析サマリー",
                    "",
                    _truncate(source_summary, 5000),
                ]
            )
        if "[TASK: DRIFT_REPORT]" in prompt:
            source_summary = _extract_prompt_section(
                prompt,
                "## ソースコード解析結果",
                "## ドキュメント抽出結果",
            )
            document_summary = _extract_prompt_section(
                prompt,
                "## ドキュメント抽出結果",
                "ジョブID:",
            )
            return "\n".join(
                [
                    "# ドキュメント差分レポート（dry-run）",
                    "",
                    "この成果物はローカル動作確認用です。",
                    "Gemini API を呼び出さず、差分生成フェーズの接続だけを確認しています。",
                    "",
                    "| 分類 | 件数 |",
                    "| --- | ---: |",
                    "| 実装あり・文書なし | 0 |",
                    "| 文書あり・実装なし | 0 |",
                    "| 内容不一致 | 0 |",
                    "| 判断不能 | 0 |",
                    "",
                    "## 比較入力サマリー",
                    "",
                    "### ソースコード解析結果",
                    "",
                    _truncate(source_summary, 2500),
                    "",
                    "### ドキュメント抽出結果",
                    "",
                    _truncate(document_summary, 2500),
                ]
            )
        return "Gemini dry-run response"


def build_gemini_client(settings: GeminiSettings) -> GeminiClient:
    if settings.dry_run or not settings.api_key:
        return DryRunGeminiClient()
    return GoogleGenAIClient(settings)


def _extract_prompt_section(prompt: str, start_marker: str, end_marker: str) -> str:
    start = prompt.find(start_marker)
    if start < 0:
        return ""
    start += len(start_marker)
    end = prompt.find(end_marker, start)
    if end < 0:
        end = len(prompt)
    return prompt[start:end].strip()


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n...[truncated]"
