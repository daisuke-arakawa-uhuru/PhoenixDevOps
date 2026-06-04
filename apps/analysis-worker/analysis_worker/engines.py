from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Protocol, Tuple

from analysis_worker.gemini import GeminiClient
from analysis_worker.payload import AnalysisTaskPayload
from analysis_worker.prompts import (
    build_document_extraction_prompt,
    build_drift_report_prompt,
    build_source_analysis_prompt,
    build_true_design_prompt,
)
from analysis_worker.storage import InputBundle


@dataclass(frozen=True)
class SourceCodeSpecification:
    summary: str
    extracted_items: Dict[str, object]


@dataclass(frozen=True)
class DocumentSpecification:
    summary: str
    extracted_items: Dict[str, object]


@dataclass(frozen=True)
class GeneratedArtifacts:
    true_design_markdown: str
    drift_report_markdown: str

    def as_files(self) -> Dict[str, str]:
        return {
            "true-design.md": self.true_design_markdown,
            "document-drift-report.md": self.drift_report_markdown,
        }


class SourceCodeAnalysisEngine(Protocol):
    def extract(self, payload: AnalysisTaskPayload, inputs: InputBundle) -> SourceCodeSpecification:
        ...


class DocumentExtractionEngine(Protocol):
    def extract(self, payload: AnalysisTaskPayload, inputs: InputBundle) -> DocumentSpecification:
        ...


class TrueDesignGenerator(Protocol):
    def generate(
        self,
        payload: AnalysisTaskPayload,
        source_specification: SourceCodeSpecification,
        document_specification: DocumentSpecification,
    ) -> str:
        ...


class DriftReportGenerator(Protocol):
    def generate(
        self,
        payload: AnalysisTaskPayload,
        source_specification: SourceCodeSpecification,
        document_specification: DocumentSpecification,
    ) -> str:
        ...


class PlaceholderSourceCodeAnalysisEngine:
    def extract(self, payload: AnalysisTaskPayload, inputs: InputBundle) -> SourceCodeSpecification:
        return SourceCodeSpecification(
            summary="Source analysis engine placeholder. Gemini extraction is not implemented yet.",
            extracted_items={
                "source_archive_uri": inputs.source_archive_uri,
                "known_document_count": len(inputs.document_uris),
                "pending_extractors": [
                    "file_structure",
                    "api_routes",
                    "database_definitions",
                    "dependencies",
                    "readme",
                ],
            },
        )


class GeminiSourceCodeAnalysisEngine:
    def __init__(self, gemini_client: GeminiClient) -> None:
        self._gemini_client = gemini_client

    def extract(self, payload: AnalysisTaskPayload, inputs: InputBundle) -> SourceCodeSpecification:
        overview_markdown, overview_items = _build_source_code_overview(inputs)
        prompt = build_source_analysis_prompt(payload, inputs, overview_markdown)
        response = self._gemini_client.generate(prompt)
        return SourceCodeSpecification(
            summary=_join_sections(
                overview_markdown,
                "## Gemini抽出結果\n\n" + response,
            ),
            extracted_items={
                "prompt_task": "SOURCE_ANALYSIS",
                "source_archive_uri": inputs.source_archive_uri,
                "source_file_count": len(inputs.source_files),
                "static_overview": overview_items,
            },
        )


class PlaceholderDocumentExtractionEngine:
    def extract(self, payload: AnalysisTaskPayload, inputs: InputBundle) -> DocumentSpecification:
        return DocumentSpecification(
            summary="Document extraction engine placeholder. PDF/Excel extraction is not implemented yet.",
            extracted_items={
                "document_uris": list(inputs.document_uris),
                "pending_extractors": ["pdf", "excel", "markdown", "plain_text"],
            },
        )


class GeminiDocumentExtractionEngine:
    def __init__(self, gemini_client: GeminiClient) -> None:
        self._gemini_client = gemini_client

    def extract(self, payload: AnalysisTaskPayload, inputs: InputBundle) -> DocumentSpecification:
        overview_markdown, overview_items = _build_document_overview(inputs)
        prompt = build_document_extraction_prompt(payload, inputs, overview_markdown)
        response = self._gemini_client.generate(prompt)
        return DocumentSpecification(
            summary=_join_sections(
                overview_markdown,
                "## Gemini抽出結果\n\n" + response,
            ),
            extracted_items={
                "prompt_task": "DOCUMENT_EXTRACTION",
                "document_count": len(inputs.document_uris),
                "document_file_count": len(inputs.document_files),
                "document_overview": overview_items,
            },
        )


class PlaceholderTrueDesignGenerator:
    def generate(
        self,
        payload: AnalysisTaskPayload,
        source_specification: SourceCodeSpecification,
        document_specification: DocumentSpecification,
    ) -> str:
        title = payload.project_name or payload.job_id
        lines: List[str] = [
            "# True Design Document",
            "",
            "This is a placeholder artifact generated by the analysis worker skeleton.",
            "It must not be treated as the final implementation-derived design document.",
            "",
            "## Analysis Target",
            "",
            f"- Project: {title}",
            f"- Job ID: {payload.job_id}",
            f"- Source archive: {source_specification.extracted_items.get('source_archive_uri')}",
            f"- Existing documents: {len(document_specification.extracted_items.get('document_uris', []))}",
            "",
            "## Pending Implementation",
            "",
            "- F-02 source code analysis with Gemini API",
            "- F-03 document extraction with Gemini API",
            "- F-04 Markdown design document generation prompt",
        ]
        return "\n".join(lines) + "\n"


class GeminiTrueDesignGenerator:
    def __init__(self, gemini_client: GeminiClient) -> None:
        self._gemini_client = gemini_client

    def generate(
        self,
        payload: AnalysisTaskPayload,
        source_specification: SourceCodeSpecification,
        document_specification: DocumentSpecification,
    ) -> str:
        prompt = build_true_design_prompt(payload, source_specification, document_specification)
        return self._gemini_client.generate(prompt)


class PlaceholderDriftReportGenerator:
    def generate(
        self,
        payload: AnalysisTaskPayload,
        source_specification: SourceCodeSpecification,
        document_specification: DocumentSpecification,
    ) -> str:
        lines = [
            "# Document Drift Report",
            "",
            "This is a placeholder artifact generated by the analysis worker skeleton.",
            "It must not be treated as the final drift analysis report.",
            "",
            "## Summary",
            "",
            "| Category | Count |",
            "| --- | ---: |",
            "| Implemented but undocumented | 0 |",
            "| Documented but not implemented | 0 |",
            "| Content mismatch | 0 |",
            "| Unknown | 0 |",
            "",
            "## Pending Implementation",
            "",
            "- F-05 comparison and four-category classification prompt",
        ]
        return "\n".join(lines) + "\n"


class GeminiDriftReportGenerator:
    def __init__(self, gemini_client: GeminiClient) -> None:
        self._gemini_client = gemini_client

    def generate(
        self,
        payload: AnalysisTaskPayload,
        source_specification: SourceCodeSpecification,
        document_specification: DocumentSpecification,
    ) -> str:
        prompt = build_drift_report_prompt(payload, source_specification, document_specification)
        return self._gemini_client.generate(prompt)


def _build_source_code_overview(inputs: InputBundle) -> Tuple[str, Dict[str, object]]:
    file_paths = [file.path for file in inputs.source_files]
    dependencies = _collect_dependencies(inputs.source_files)
    api_routes = _collect_api_routes(inputs.source_files)
    database_definitions = _collect_database_definitions(inputs.source_files)
    config_files = [
        path
        for path in file_paths
        if _is_config_file(path)
    ]
    readme_files = [
        path
        for path in file_paths
        if Path(path).name.lower().startswith("readme")
    ]

    items: Dict[str, object] = {
        "file_structure": file_paths,
        "dependencies": dependencies,
        "api_routes": api_routes,
        "database_definitions": database_definitions,
        "config_files": config_files,
        "readme_files": readme_files,
    }

    lines: List[str] = [
        "## 静的構造解析結果",
        "",
        "### ファイル構成",
        "",
        *_format_bullets(file_paths, empty="読み込み可能なソースファイルはありません。"),
        "",
        "### 設定ファイル",
        "",
        *_format_bullets(config_files, empty="設定ファイル候補は検出されませんでした。"),
        "",
        "### README",
        "",
        *_format_bullets(readme_files, empty="README候補は検出されませんでした。"),
        "",
        "### 依存関係",
        "",
        *_format_dependency_table(dependencies),
        "",
        "### ルーティング/API候補",
        "",
        *_format_route_table(api_routes),
        "",
        "### DB定義/データモデル候補",
        "",
        *_format_database_table(database_definitions),
    ]
    return "\n".join(lines), items


def _build_document_overview(inputs: InputBundle) -> Tuple[str, Dict[str, object]]:
    document_files = list(inputs.document_files)
    unsupported_files = [
        file.path
        for file in document_files
        if file.content.startswith("[未対応") or file.content.startswith("[PDF本文抽出には")
    ]
    items: Dict[str, object] = {
        "document_uris": list(inputs.document_uris),
        "document_file_paths": [file.path for file in document_files],
        "unsupported_files": unsupported_files,
    }

    lines: List[str] = [
        "## ドキュメント事前抽出結果",
        "",
        f"- 入力ドキュメントURI数: {len(inputs.document_uris)}",
        f"- 読み込み済み本文ファイル数: {len(document_files)}",
        "",
        "### 入力ドキュメント",
        "",
        *_format_bullets(inputs.document_uris, empty="入力ドキュメントURIはありません。"),
        "",
        "### 本文抽出ファイル",
        "",
        *_format_document_table(document_files),
    ]
    return "\n".join(lines), items


def _collect_dependencies(files: Iterable[TextFile]) -> List[Dict[str, str]]:
    dependencies: List[Dict[str, str]] = []
    for file in files:
        name = Path(file.path).name.lower()
        if name == "package.json":
            dependencies.extend(_dependencies_from_package_json(file))
        elif name == "requirements.txt":
            dependencies.extend(_dependencies_from_requirements(file))
        elif name == "pyproject.toml":
            dependencies.extend(_dependencies_from_pyproject(file))
        elif name == "go.mod":
            dependencies.extend(_dependencies_from_go_mod(file))
        elif name == "gemfile":
            dependencies.extend(_dependencies_from_gemfile(file))
    return _limit_dicts(dependencies, 80)


def _dependencies_from_package_json(file: TextFile) -> List[Dict[str, str]]:
    try:
        payload = json.loads(file.content)
    except json.JSONDecodeError:
        return []

    dependencies: List[Dict[str, str]] = []
    for section in ("dependencies", "devDependencies"):
        values = payload.get(section)
        if not isinstance(values, dict):
            continue
        for name, version in sorted(values.items()):
            dependencies.append(
                {
                    "kind": section,
                    "name": str(name),
                    "version": str(version),
                    "path": file.path,
                }
            )
    return dependencies


def _dependencies_from_requirements(file: TextFile) -> List[Dict[str, str]]:
    dependencies: List[Dict[str, str]] = []
    for line in file.content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("-"):
            continue
        dependencies.append(
            {
                "kind": "python",
                "name": _dependency_name(stripped),
                "version": stripped,
                "path": file.path,
            }
        )
    return dependencies


def _dependencies_from_pyproject(file: TextFile) -> List[Dict[str, str]]:
    dependencies: List[Dict[str, str]] = []
    in_dependencies = False
    for line in file.content.splitlines():
        stripped = line.strip()
        if stripped.startswith("dependencies"):
            in_dependencies = "[" in stripped and "]" not in stripped
            inline_values = re.findall(r'"([^"]+)"', stripped)
            dependencies.extend(_pyproject_dependency_entries(inline_values, file.path))
            continue
        if in_dependencies:
            if stripped.startswith("]"):
                in_dependencies = False
                continue
            values = re.findall(r'"([^"]+)"', stripped)
            dependencies.extend(_pyproject_dependency_entries(values, file.path))
    return dependencies


def _pyproject_dependency_entries(values: Iterable[str], path: str) -> List[Dict[str, str]]:
    return [
        {
            "kind": "python",
            "name": _dependency_name(value),
            "version": value,
            "path": path,
        }
        for value in values
    ]


def _dependencies_from_go_mod(file: TextFile) -> List[Dict[str, str]]:
    dependencies: List[Dict[str, str]] = []
    for line in file.content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        if stripped.startswith("require "):
            stripped = stripped[len("require ") :].strip()
        if stripped in {"(", ")"}:
            continue
        parts = stripped.split()
        if len(parts) >= 2 and "." in parts[0]:
            dependencies.append(
                {
                    "kind": "go",
                    "name": parts[0],
                    "version": parts[1],
                    "path": file.path,
                }
            )
    return dependencies


def _dependencies_from_gemfile(file: TextFile) -> List[Dict[str, str]]:
    dependencies: List[Dict[str, str]] = []
    for match in re.finditer(r"^\s*gem\s+['\"]([^'\"]+)['\"](?:,\s*['\"]([^'\"]+)['\"])?", file.content, re.M):
        dependencies.append(
            {
                "kind": "ruby",
                "name": match.group(1),
                "version": match.group(2) or "",
                "path": file.path,
            }
        )
    return dependencies


def _collect_api_routes(files: Iterable[TextFile]) -> List[Dict[str, str]]:
    routes: List[Dict[str, str]] = []
    for file in files:
        if _is_test_file(file.path):
            continue
        routes.extend(_routes_from_content(file))
        routes.extend(_routes_from_path(file.path))
    return _limit_dicts(routes, 80)


def _routes_from_content(file: TextFile) -> List[Dict[str, str]]:
    routes: List[Dict[str, str]] = []
    for line_number, line in enumerate(file.content.splitlines(), start=1):
        stripped = line.strip()
        routes.extend(_match_python_route(file.path, line_number, stripped))
        routes.extend(_match_flask_route(file.path, line_number, stripped))
        routes.extend(_match_express_route(file.path, line_number, stripped))
        routes.extend(_match_django_route(file.path, line_number, stripped))
        routes.extend(_match_spring_route(file.path, line_number, stripped))
    return routes


def _match_python_route(path: str, line_number: int, line: str) -> List[Dict[str, str]]:
    match = re.search(
        r"^@(?:\w+\.)?(?:app|router|api)\.(get|post|put|delete|patch|options|head)\(\s*['\"]([^'\"]+)['\"]",
        line,
    )
    if not match:
        return []
    return [_route_dict(match.group(1).upper(), match.group(2), path, line_number)]


def _match_flask_route(path: str, line_number: int, line: str) -> List[Dict[str, str]]:
    match = re.search(r"^@(?:\w+\.)?(?:app|bp|blueprint)\.route\(\s*['\"]([^'\"]+)['\"]", line)
    if not match:
        return []
    methods = re.search(r"methods\s*=\s*\[([^\]]+)\]", line)
    if not methods:
        return [_route_dict("GET", match.group(1), path, line_number)]
    return [
        _route_dict(method.upper(), match.group(1), path, line_number)
        for method in re.findall(r"['\"]([A-Za-z]+)['\"]", methods.group(1))
    ]


def _match_express_route(path: str, line_number: int, line: str) -> List[Dict[str, str]]:
    match = re.search(
        r"\b(?:app|router)\.(get|post|put|delete|patch|options|head|all|use)\(\s*[`'\"]([^`'\"]+)[`'\"]",
        line,
    )
    if not match:
        return []
    return [_route_dict(match.group(1).upper(), match.group(2), path, line_number)]


def _match_django_route(path: str, line_number: int, line: str) -> List[Dict[str, str]]:
    match = re.search(r"\b(?:path|re_path)\(\s*['\"]([^'\"]+)['\"]", line)
    if not match:
        return []
    return [_route_dict("DJANGO", match.group(1), path, line_number)]


def _match_spring_route(path: str, line_number: int, line: str) -> List[Dict[str, str]]:
    match = re.search(
        r"@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)"
        r"(?:\(\s*(?:value\s*=\s*)?['\"]([^'\"]+)['\"])?",
        line,
    )
    if not match:
        return []
    method = match.group(1).replace("Mapping", "").upper() or "REQUEST"
    return [_route_dict(method, match.group(2) or "", path, line_number)]


def _routes_from_path(path: str) -> List[Dict[str, str]]:
    normalized = path.replace("\\", "/")
    if normalized.startswith("pages/api/"):
        route = "/" + normalized.removeprefix("pages/api/").rsplit(".", 1)[0]
        return [_route_dict("NEXT_API", route, path, 0)]
    if "/app/api/" in normalized and normalized.endswith("/route.ts"):
        route = normalized.split("/app/api/", 1)[1].removesuffix("/route.ts")
        return [_route_dict("NEXT_API", "/" + route, path, 0)]
    return []


def _collect_database_definitions(files: Iterable[TextFile]) -> List[Dict[str, str]]:
    definitions: List[Dict[str, str]] = []
    for file in files:
        if _is_test_file(file.path):
            continue
        definitions.extend(_database_definitions_from_content(file))
    return _limit_dicts(definitions, 80)


def _database_definitions_from_content(file: TextFile) -> List[Dict[str, str]]:
    definitions: List[Dict[str, str]] = []
    for line_number, line in enumerate(file.content.splitlines(), start=1):
        stripped = line.strip()
        sql_match = re.search(r"\b(CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX)\s+([^\s(]+)", stripped, re.I)
        if sql_match:
            definitions.append(
                {
                    "kind": sql_match.group(1).upper(),
                    "name": sql_match.group(2),
                    "path": file.path,
                    "line": str(line_number),
                }
            )

        django_match = re.search(r"^class\s+(\w+)\((?:models\.)?Model\):", stripped)
        if django_match:
            definitions.append(
                {
                    "kind": "Django model",
                    "name": django_match.group(1),
                    "path": file.path,
                    "line": str(line_number),
                }
            )

        prisma_match = re.search(r"^model\s+(\w+)\s+\{", stripped)
        if prisma_match:
            definitions.append(
                {
                    "kind": "Prisma model",
                    "name": prisma_match.group(1),
                    "path": file.path,
                    "line": str(line_number),
                }
            )
    return definitions


def _dependency_name(requirement: str) -> str:
    return re.split(r"\s*(?:==|>=|<=|~=|!=|>|<|\[)", requirement, maxsplit=1)[0].strip()


def _route_dict(method: str, route: str, path: str, line_number: int) -> Dict[str, str]:
    return {
        "method": method,
        "path": route,
        "source": _source_reference(path, line_number),
    }


def _source_reference(path: str, line_number: int) -> str:
    if line_number <= 0:
        return path
    return f"{path}:{line_number}"


def _is_config_file(path: str) -> bool:
    name = Path(path).name.lower()
    suffix = Path(path).suffix.lower()
    return (
        name
        in {
            ".env",
            ".env.example",
            "dockerfile",
            "package.json",
            "requirements.txt",
            "pyproject.toml",
            "go.mod",
            "gemfile",
            "composer.json",
            "pom.xml",
            "build.gradle",
        }
        or suffix in {".yaml", ".yml", ".toml", ".properties", ".conf"}
    )


def _is_test_file(path: str) -> bool:
    normalized = path.replace("\\", "/").lower()
    parts = normalized.split("/")
    name = parts[-1]
    return (
        any(part in {"test", "tests", "spec", "specs"} for part in parts[:-1])
        or name.startswith("test_")
        or name.endswith("_test.py")
        or ".test." in name
        or ".spec." in name
    )


def _format_bullets(values: Iterable[str], empty: str) -> List[str]:
    values = list(values)
    if not values:
        return [empty]
    return [f"- {value}" for value in values]


def _format_dependency_table(dependencies: List[Dict[str, str]]) -> List[str]:
    if not dependencies:
        return ["依存関係候補は検出されませんでした。"]
    return [
        "| 種別 | 名前 | バージョン/記述 | 根拠 |",
        "| --- | --- | --- | --- |",
        *[
            f"| {item['kind']} | {item['name']} | {item['version']} | {item['path']} |"
            for item in dependencies
        ],
    ]


def _format_route_table(routes: List[Dict[str, str]]) -> List[str]:
    if not routes:
        return ["ルーティング/API候補は検出されませんでした。"]
    return [
        "| メソッド | パス | 根拠 |",
        "| --- | --- | --- |",
        *[
            f"| {item['method']} | {item['path']} | {item['source']} |"
            for item in routes
        ],
    ]


def _format_database_table(definitions: List[Dict[str, str]]) -> List[str]:
    if not definitions:
        return ["DB定義/データモデル候補は検出されませんでした。"]
    return [
        "| 種別 | 名前 | 根拠 |",
        "| --- | --- | --- |",
        *[
            f"| {item['kind']} | {item['name']} | {item['path']}:{item['line']} |"
            for item in definitions
        ],
    ]


def _format_document_table(files: List[TextFile]) -> List[str]:
    if not files:
        return ["本文抽出済みファイルはありません。"]
    return [
        "| ファイル | 文字数 | 状態 |",
        "| --- | ---: | --- |",
        *[
            f"| {file.path} | {len(file.content)} | {_document_status(file)} |"
            for file in files
        ],
    ]


def _document_status(file: TextFile) -> str:
    if file.content.startswith("[未対応"):
        return "未対応形式"
    if file.content.startswith("[PDF本文抽出には"):
        return "PDF抽出依存不足"
    if file.content.startswith("[") and "抽出できませんでした" in file.content:
        return "抽出不可"
    return "抽出済み"


def _limit_dicts(items: List[Dict[str, str]], max_items: int) -> List[Dict[str, str]]:
    return items[:max_items]


def _join_sections(*sections: str) -> str:
    return "\n\n".join(section.strip() for section in sections if section.strip()) + "\n"
