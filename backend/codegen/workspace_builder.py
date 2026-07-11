"""
Temporary workspace construction for the coding agent (design 2.3).

Generation layout:
  workspace/
    CLAUDE.md            # guidance: task + contract highlights + prohibitions
    contract_spec.md     # full contract spec
    flow_semantics.md    # edge handle semantics
    flow.json            # canonical flow (nodes + edges + graph_mode)
    examples/            # up to 2 golden examples chosen by heuristics
    generated_agent.py   # <- agent output target

Fix layout (build_fix_workspace):
  workspace/
    CLAUDE.md            # FIX_CLAUDE.md renamed (fix task + diagnosis rules)
    contract_spec.md / flow_semantics.md / flow.json
    generated_agent.py   # the failing code (agent edits in place)
    error.txt            # execution error, tail-truncated to 8KB
    (no examples — the current code is the strongest context)
"""
import json
import logging
import shutil
import tempfile
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

from codegen import config
from codegen.cache import canonicalize_flow

logger = logging.getLogger(__name__)

# (source filename in guidance dir, target filename in workspace)
GENERATE_GUIDANCE_FILES: Sequence[Tuple[str, str]] = (
    ("CLAUDE.md", "CLAUDE.md"),
    ("contract_spec.md", "contract_spec.md"),
    ("flow_semantics.md", "flow_semantics.md"),
)

FIX_GUIDANCE_FILES: Sequence[Tuple[str, str]] = (
    ("FIX_CLAUDE.md", "CLAUDE.md"),
    ("contract_spec.md", "contract_spec.md"),
    ("flow_semantics.md", "flow_semantics.md"),
)

ERROR_TAIL_BYTES = 8 * 1024


def _copy_guidance(workspace: Path, file_pairs: Sequence[Tuple[str, str]]) -> None:
    """Copy guidance documents into the workspace (warn-skip if missing)."""
    for source_name, target_name in file_pairs:
        source = config.GUIDANCE_DIR / source_name
        if source.exists():
            shutil.copy2(source, workspace / target_name)
        else:
            logger.warning(f"Guidance file missing, skipped: {source}")


def _write_flow_json(workspace: Path, flow_data: dict, graph_mode: bool) -> None:
    """Write the canonical flow (layout fields stripped, graph_mode included)."""
    flow_json = json.dumps(
        canonicalize_flow(flow_data, graph_mode),
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    (workspace / "flow.json").write_text(flow_json, encoding="utf-8")


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

    _copy_guidance(workspace, GENERATE_GUIDANCE_FILES)
    _write_flow_json(workspace, flow_data, graph_mode)

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


def _truncate_error_tail(error: str) -> str:
    """Keep the last ERROR_TAIL_BYTES of the error (the root cause lives at the end)."""
    encoded = error.encode("utf-8")
    if len(encoded) <= ERROR_TAIL_BYTES:
        return error
    tail = encoded[-ERROR_TAIL_BYTES:].decode("utf-8", errors="ignore")
    return "[... error output truncated; showing only the last 8KB ...]\n" + tail


def build_fix_workspace(
    code: str,
    error: str,
    flow_data: dict,
    graph_mode: bool,
    input_data: Optional[str] = None,
) -> Path:
    """Create a temp workspace for the AI-fix flow (no golden examples).

    FIX_CLAUDE.md is copied in as CLAUDE.md; the failing code is written to
    generated_agent.py for in-place editing; the error is tail-truncated to
    8KB and written to error.txt (optionally prefixed with the user input
    that triggered the failed run).
    """
    workspace = Path(tempfile.mkdtemp(prefix="codefix_"))

    _copy_guidance(workspace, FIX_GUIDANCE_FILES)
    _write_flow_json(workspace, flow_data, graph_mode)

    # The failing code, edited in place by the agent
    (workspace / config.GENERATED_FILENAME).write_text(code, encoding="utf-8")

    # Error output (tail matters most); truncation happens before the header
    # so the input context is never dropped.
    sections = []
    if input_data and input_data.strip():
        sections.append(
            "# User input of the failed execution:\n"
            f"# {input_data.strip()[:500]}\n"
        )
    sections.append(_truncate_error_tail(error))
    (workspace / "error.txt").write_text("\n".join(sections), encoding="utf-8")

    return workspace


def cleanup_workspace(workspace: Path) -> None:
    """Remove the temp workspace, ignoring errors."""
    shutil.rmtree(workspace, ignore_errors=True)
