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
            return "\n".join(
                [
                    "## ソースコード解析結果（dry-run）",
                    "",
                    "- Gemini API は呼び出していません。",
                    "- 入力ファイル一覧と prompt 構造の確認用レスポンスです。",
                    "- 実装時はファイル構成、API、DB定義、依存関係、README を抽出します。",
                ]
            )
        if "[TASK: DOCUMENT_EXTRACTION]" in prompt:
            return "\n".join(
                [
                    "## ドキュメント抽出結果（dry-run）",
                    "",
                    "- Gemini API は呼び出していません。",
                    "- 入力ドキュメント一覧と prompt 構造の確認用レスポンスです。",
                    "- 実装時は既存ドキュメント上の仕様記述を抽出します。",
                ]
            )
        if "[TASK: TRUE_DESIGN]" in prompt:
            return "\n".join(
                [
                    "# 真の設計書（dry-run）",
                    "",
                    "この成果物はローカル動作確認用です。",
                    "Gemini API を呼び出さず、生成フェーズの接続だけを確認しています。",
                    "",
                    "## 未実装",
                    "",
                    "- 実装ベースの仕様抽出",
                    "- Markdown 設計書の本生成",
                ]
            )
        if "[TASK: DRIFT_REPORT]" in prompt:
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
                ]
            )
        return "Gemini dry-run response"


def build_gemini_client(settings: GeminiSettings) -> GeminiClient:
    if settings.dry_run or not settings.api_key:
        return DryRunGeminiClient()
    return GoogleGenAIClient(settings)
