from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from common import CONFIG_ROOT, REPORTS_ROOT, ensure_research_dirs, read_json, write_json


MODEL_CONFIG_PATH = CONFIG_ROOT / "nebius_models.json"
MODEL_SELECTION_PATH = REPORTS_ROOT / "nebius_model_selection.json"
DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"


@dataclass(frozen=True)
class TaskModel:
    id: str
    task: str
    temperature: float
    max_tokens: int
    reason: str


class NebiusError(RuntimeError):
    pass


def api_key() -> str:
    return os.environ.get("NEBIUS_API_KEY", "").strip()


def base_url() -> str:
    configured = os.environ.get("NEBIUS_BASE_URL", "").strip()
    if configured:
        return configured.rstrip("/") + "/"
    try:
        payload = read_json(MODEL_CONFIG_PATH)
        configured = str(payload.get("baseUrl", "")).strip()
        if configured:
            return configured.rstrip("/") + "/"
    except FileNotFoundError:
        pass
    return DEFAULT_BASE_URL


def request_json(method: str, path: str, payload: dict[str, Any] | None = None, timeout: int = 90) -> dict[str, Any]:
    token = api_key()
    if not token:
        raise NebiusError("NEBIUS_API_KEY is not set.")
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{base_url().rstrip('/')}/{path.lstrip('/')}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "tradingbot-research-center/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise NebiusError(f"Nebius HTTP {exc.code}: {body[:500]}") from exc
    except urllib.error.URLError as exc:
        raise NebiusError(f"Nebius request failed: {exc.reason}") from exc


def list_models(verbose: bool = False) -> list[str]:
    query = "?verbose=true" if verbose else ""
    payload = request_json("GET", f"models{query}", timeout=45)
    models = payload.get("data", [])
    return sorted(str(item.get("id")) for item in models if isinstance(item, dict) and item.get("id"))


def load_model_config() -> dict[str, Any]:
    return read_json(MODEL_CONFIG_PATH)


def select_task_model(task: str, available_models: set[str] | None = None) -> TaskModel:
    payload = load_model_config()
    tasks = payload.get("tasks", {})
    task_config = tasks.get(task)
    if not isinstance(task_config, dict):
        raise NebiusError(f"Unknown Nebius task: {task}")
    candidates = task_config.get("models", [])
    if not isinstance(candidates, list) or not candidates:
        raise NebiusError(f"No Nebius model candidates configured for task: {task}")

    selected = None
    if available_models:
        selected = next((item for item in candidates if isinstance(item, dict) and item.get("id") in available_models), None)
    if selected is None:
        selected = next(item for item in candidates if isinstance(item, dict) and item.get("id"))

    return TaskModel(
        id=str(selected["id"]),
        task=task,
        temperature=float(task_config.get("temperature", 0.2)),
        max_tokens=int(task_config.get("maxTokens", 1800)),
        reason=str(selected.get("why", "Configured default.")),
    )


def resolve_task_models(tasks: list[str]) -> dict[str, TaskModel]:
    available: set[str] | None = None
    if api_key():
        try:
            available = set(list_models())
        except NebiusError as exc:
            print(f"[nebius] model listing failed; using configured defaults: {exc}")
    resolved = {task: select_task_model(task, available) for task in tasks}
    ensure_research_dirs()
    write_json(
        MODEL_SELECTION_PATH,
        {
            "baseUrl": base_url(),
            "hasApiKey": bool(api_key()),
            "tasks": {
                task: {
                    "model": model.id,
                    "reason": model.reason,
                    "temperature": model.temperature,
                    "maxTokens": model.max_tokens,
                }
                for task, model in resolved.items()
            },
        },
    )
    return resolved


def chat_json(task_model: TaskModel, system: str, user: str, schema_name: str | None = None) -> dict[str, Any]:
    response_format: dict[str, Any] = {"type": "json_object"}
    if schema_name:
        response_format["json_schema"] = {
            "name": schema_name,
            "schema": {"type": "object"},
            "strict": False,
        }
    payload = {
        "model": task_model.id,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": task_model.temperature,
        "max_tokens": task_model.max_tokens,
        "response_format": response_format,
    }
    completion = request_json("POST", "chat/completions", payload=payload, timeout=120)
    choices = completion.get("choices", [])
    if not choices:
        raise NebiusError("Nebius response did not contain choices.")
    message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
    content = str(message.get("content", "")).strip()
    if not content:
        raise NebiusError("Nebius response did not contain JSON content.")
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            return json.loads(content[start : end + 1])
        raise NebiusError(f"Nebius returned invalid JSON: {content[:240]}") from exc


def write_summary(stage: str, title: str, lines: list[str]) -> Path:
    ensure_research_dirs()
    path = REPORTS_ROOT / f"{stage}_summary.md"
    content = [f"# {title}", ""]
    content.extend(line.rstrip() for line in lines)
    path.write_text("\n".join(content).rstrip() + "\n", encoding="utf-8")
    return path
