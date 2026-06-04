from __future__ import annotations

from typing import Iterable, Protocol

from analysis_worker.payload import AnalysisTaskPayload
from analysis_worker.storage import InputBundle, TextFile


class _Specification(Protocol):
    summary: str


def build_source_analysis_prompt(
    payload: AnalysisTaskPayload,
    inputs: InputBundle,
    static_overview_markdown: str = "",
) -> str:
    return "\n".join(
        [
            "[TASK: SOURCE_ANALYSIS]",
            "",
            "あなたはレガシー Web アプリケーションの実装仕様を抽出する解析エンジンです。",
            "ソースコードを正として扱い、根拠を示せない内容は断定しないでください。",
            "",
            "## 解析対象",
            "",
            f"- ジョブID: {payload.job_id}",
            f"- プロジェクト名: {payload.project_name or '未指定'}",
            f"- ソース: {inputs.source_archive_uri}",
            "",
            "## 抽出してほしい項目",
            "",
            "- ファイル構成",
            "- 技術スタックと依存関係",
            "- ルーティング、画面、API",
            "- DB定義、データモデル",
            "- 業務ルール、バリデーション",
            "- 外部連携",
            "- 判断不能、推測事項",
            "",
            "## 出力形式",
            "",
            "Markdown で、各項目に根拠ファイルパスを添えてください。",
            "",
            "## 事前抽出済みの構造情報",
            "",
            static_overview_markdown or "事前抽出済みの構造情報はありません。",
            "",
            "## 入力ファイル抜粋",
            "",
            _format_text_files(inputs.source_files),
        ]
    )


def build_document_extraction_prompt(
    payload: AnalysisTaskPayload,
    inputs: InputBundle,
    document_overview_markdown: str = "",
) -> str:
    return "\n".join(
        [
            "[TASK: DOCUMENT_EXTRACTION]",
            "",
            "あなたは既存ドキュメントから仕様記述を抽出するエンジンです。",
            "古いドキュメントには実装と乖離した内容が含まれる可能性があります。",
            "文書に書かれている内容と、根拠ドキュメントを分けて整理してください。",
            "",
            "## 解析対象",
            "",
            f"- ジョブID: {payload.job_id}",
            f"- プロジェクト名: {payload.project_name or '未指定'}",
            "",
            "## ドキュメント一覧",
            "",
            *[f"- {uri}" for uri in inputs.document_uris],
            "",
            "## 出力形式",
            "",
            "Markdown で、仕様項目、内容、根拠ドキュメント、判断不能事項を整理してください。",
            "",
            "## 事前抽出済みのドキュメント情報",
            "",
            document_overview_markdown or "事前抽出済みのドキュメント情報はありません。",
            "",
            "## ドキュメント抜粋",
            "",
            _format_text_files(inputs.document_files),
        ]
    )


def build_true_design_prompt(
    payload: AnalysisTaskPayload,
    source_specification: _Specification,
    document_specification: _Specification,
) -> str:
    return "\n".join(
        [
            "[TASK: TRUE_DESIGN]",
            "",
            "あなたはソースコード由来の情報を正として、真の設計書を Markdown で生成します。",
            "既存ドキュメントは補助情報として扱い、根拠がない推測は断定しないでください。",
            "",
            "## 出力章",
            "",
            "1. 解析対象",
            "2. システム概要",
            "3. 技術スタック",
            "4. 主要機能一覧",
            "5. 画面・ルーティング一覧",
            "6. API一覧",
            "7. データモデル",
            "8. 業務ルール・バリデーション",
            "9. 外部連携",
            "10. 判断不能・推測事項",
            "",
            "## ソースコード解析結果",
            "",
            source_specification.summary,
            "",
            "## ドキュメント抽出結果",
            "",
            document_specification.summary,
            "",
            f"ジョブID: {payload.job_id}",
            f"プロジェクト名: {payload.project_name or '未指定'}",
        ]
    )


def build_drift_report_prompt(
    payload: AnalysisTaskPayload,
    source_specification: _Specification,
    document_specification: _Specification,
) -> str:
    return "\n".join(
        [
            "[TASK: DRIFT_REPORT]",
            "",
            "あなたはソースコード由来の実装仕様と既存ドキュメント仕様を比較し、",
            "ドキュメント差分レポートを Markdown で生成します。",
            "",
            "## 差分分類",
            "",
            "- 実装あり・文書なし",
            "- 文書あり・実装なし",
            "- 内容不一致",
            "- 判断不能",
            "",
            "## 判断ルール",
            "",
            "- ソースコードを正とする",
            "- 根拠を示せない内容は断定しない",
            "- 重要度、確度、根拠コード、根拠ドキュメント、推奨対応を出す",
            "",
            "## ソースコード解析結果",
            "",
            source_specification.summary,
            "",
            "## ドキュメント抽出結果",
            "",
            document_specification.summary,
            "",
            f"ジョブID: {payload.job_id}",
            f"プロジェクト名: {payload.project_name or '未指定'}",
        ]
    )


def _format_text_files(files: Iterable[TextFile]) -> str:
    blocks = []
    for file in files:
        blocks.append(
            "\n".join(
                [
                    f"### {file.path}",
                    "",
                    "```text",
                    file.content,
                    "```",
                ]
            )
        )
    if not blocks:
        return "入力ファイル本文はまだ取得されていません。"
    return "\n\n".join(blocks)
