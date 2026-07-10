"""
Flow-level generation cache (design 2.5).

key = sha256(canonical flow JSON + guidance VERSION + backend name + model id).
Layout-only node fields are stripped so moving nodes never invalidates the cache.
Fallback results are never cached.
"""
import copy
import hashlib
import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from codegen import config

logger = logging.getLogger(__name__)

# Node fields that do not affect generated code
LAYOUT_FIELDS = (
    "position",
    "width",
    "height",
    "selected",
    "dragging",
    "measured",
    "positionAbsolute",
)


def canonicalize_flow(flow_data: dict, graph_mode: bool) -> dict:
    """Deep-copy flow_data, strip layout-only fields, include graph_mode."""
    canonical = copy.deepcopy(flow_data)
    for node in canonical.get("nodes", []):
        if isinstance(node, dict):
            for field in LAYOUT_FIELDS:
                node.pop(field, None)
    return {
        "nodes": canonical.get("nodes", []),
        "edges": canonical.get("edges", []),
        "graph_mode": graph_mode,
    }


def canonical_flow_json(flow_data: dict, graph_mode: bool) -> str:
    """Deterministic JSON serialization of the canonical flow."""
    return json.dumps(
        canonicalize_flow(flow_data, graph_mode),
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )


def compute_cache_key(
    flow_data: dict,
    graph_mode: bool,
    backend_name: str,
    model: str,
) -> str:
    payload = "\n".join([
        canonical_flow_json(flow_data, graph_mode),
        config.get_guidance_version(),
        backend_name,
        model,
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _cache_file(cache_key: str) -> Path:
    return config.CACHE_DIR / f"{cache_key}.json"


def get_cached(cache_key: str) -> Optional[Dict[str, Any]]:
    """Return cached entry {code, validation_report, backend, model, created_at} or None."""
    cache_file = _cache_file(cache_key)
    if not cache_file.exists():
        return None
    try:
        entry = json.loads(cache_file.read_text(encoding="utf-8"))
        if not isinstance(entry, dict) or "code" not in entry:
            logger.warning(f"Malformed codegen cache entry ignored: {cache_file.name}")
            return None
        return entry
    except (OSError, json.JSONDecodeError) as e:
        logger.warning(f"Failed to read codegen cache {cache_file.name}: {e}")
        return None


def put_cached(cache_key: str, entry: Dict[str, Any]) -> None:
    """Persist a successful (source=agent) generation. Never call for fallback results."""
    try:
        config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_file(cache_key).write_text(
            json.dumps(entry, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError as e:
        logger.warning(f"Failed to write codegen cache {cache_key}: {e}")


def clear_cache() -> int:
    """Delete all cache entries. Returns the number of deleted files."""
    if not config.CACHE_DIR.exists():
        return 0
    deleted = 0
    for cache_file in config.CACHE_DIR.glob("*.json"):
        try:
            cache_file.unlink()
            deleted += 1
        except OSError as e:
            logger.warning(f"Failed to delete cache file {cache_file.name}: {e}")
    return deleted
