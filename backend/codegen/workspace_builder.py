"""
Temporary workspace construction for the coding agent (design 2.3).

Layout:
  workspace/
    CLAUDE.md            # guidance: task + contract highlights + prohibitions
    contract_spec.md     # full contract spec
    flow_semantics.md    # edge handle semantics
    flow.json            # canonical flow (nodes + edges + graph_mode)
    examples/            # up to 2 golden examples chosen by heuristics
    generated_agent.py   # <- agent output target
"""
import json
import logging
import shutil
import tempfile
from pathlib import Path
from typing import List

from codegen import config
from codegen.cache import canonicalize_flow

logger = logging.getLogger(__name__)

GUIDANCE_FILES = ("CLAUDE.md", "contract_spec.md", "flow_semantics.md")


def select_examples(flow_data: dict, graph_mode: bool) -> List[str]:
    """Pick up to 2 example keys by flow-feature heuristics (design 2.3)."""
    node_types = {
        node.get("type")
        for node in flow_data.get("nodes", [])
        if isinstance(node, dict)
    }

    keys: List[str] = []

    def add(key: str) -> None:
        if key not in keys:
            keys.append(key)

    if "swarm" in node_types:
        add("swarm")
    if graph_mode:
        add("graph")
    if "mcp-tool" in node_types:
        add("agent_mcp")
    if "tool" in node_types or "custom-tool" in node_types:
        add("agent_tools")
    if "orchestrator-agent" in node_types:
        add("orchestrator")

    if not keys:
        keys.append("single_agent")

    return keys[:2]


def build_workspace(flow_data: dict, graph_mode: bool) -> Path:
    """Create a temp workspace with guidance assets, canonical flow.json and examples."""
    workspace = Path(tempfile.mkdtemp(prefix="codegen_"))

    # Guidance documents (written by a separate asset pipeline; warn-skip if missing)
    for filename in GUIDANCE_FILES:
        source = config.GUIDANCE_DIR / filename
        if source.exists():
            shutil.copy2(source, workspace / filename)
        else:
            logger.warning(f"Guidance file missing, skipped: {source}")

    # Canonical flow input (layout fields stripped, graph_mode included)
    flow_json = json.dumps(
        canonicalize_flow(flow_data, graph_mode),
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    (workspace / "flow.json").write_text(flow_json, encoding="utf-8")

    # Golden examples (up to 2, chosen by heuristics; warn-skip missing files)
    example_keys = select_examples(flow_data, graph_mode)
    examples_dir = workspace / "examples"
    for key in example_keys:
        example_file = config.GUIDANCE_DIR / "examples" / f"{key}.py"
        if example_file.exists():
            examples_dir.mkdir(exist_ok=True)
            shutil.copy2(example_file, examples_dir / example_file.name)
        else:
            logger.warning(f"Golden example missing, skipped: {example_file}")

    return workspace


def cleanup_workspace(workspace: Path) -> None:
    """Remove the temp workspace, ignoring errors."""
    shutil.rmtree(workspace, ignore_errors=True)
