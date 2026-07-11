"""
Validation pipeline for generated code (design 2.4).

Stages (short-circuit on first failing stage):
  1. AST contract validation (in-process, no execution risk)
  2. ruff check --select E9,F (hard errors only)
  3. import smoke test in a subprocess (credentials stripped, 20s timeout),
     including the AgentCore-style inspect.signature introspection check.
"""
import ast
import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List

from codegen import config

logger = logging.getLogger(__name__)

GENERATED_FILENAME = config.GENERATED_FILENAME

# Env var prefixes stripped from the import smoke subprocess
CREDENTIAL_ENV_PREFIXES = ("AWS_", "OPENAI_", "ANTHROPIC_")

# Mirrors agent_runtime_template.py introspection: import + signature check
IMPORT_SMOKE_SNIPPET = (
    "import generated_agent, inspect; "
    "sig = inspect.signature(generated_agent.main); "
    "missing = {'user_input_arg', 'messages_arg'} - set(sig.parameters); "
    "assert not missing, f'main() missing parameters: {missing}'"
)


@dataclass
class ValidationIssue:
    stage: str      # "ast" | "ruff" | "import"
    message: str

    def to_dict(self) -> Dict[str, str]:
        return {"stage": self.stage, "message": self.message}


@dataclass
class ValidationReport:
    passed: bool
    errors: List[ValidationIssue] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "errors": [e.to_dict() for e in self.errors],
        }

    def error_messages(self) -> List[str]:
        return [f"[{e.stage}] {e.message}" for e in self.errors]


# ---------------------------------------------------------------------------
# Stage 1: AST contract validation
# ---------------------------------------------------------------------------

def _params_with_default_flags(fn: ast.AsyncFunctionDef) -> Dict[str, bool]:
    """Map parameter name -> has_default for positional and keyword-only params."""
    result: Dict[str, bool] = {}
    args = fn.args
    positional = list(args.posonlyargs) + list(args.args)
    num_defaults = len(args.defaults)
    first_defaulted = len(positional) - num_defaults
    for i, arg in enumerate(positional):
        result[arg.arg] = i >= first_defaulted
    for arg, default in zip(args.kwonlyargs, args.kw_defaults):
        result[arg.arg] = default is not None
    return result


def _is_main_guard(node: ast.If) -> bool:
    """Detect `if __name__ == "__main__":` (either operand order)."""
    test = node.test
    if not isinstance(test, ast.Compare) or len(test.ops) != 1:
        return False
    if not isinstance(test.ops[0], ast.Eq):
        return False
    operands = [test.left] + list(test.comparators)
    has_name = any(isinstance(o, ast.Name) and o.id == "__name__" for o in operands)
    has_literal = any(
        isinstance(o, ast.Constant) and o.value == "__main__" for o in operands
    )
    return has_name and has_literal


def _is_agent_call(call: ast.Call) -> bool:
    func = call.func
    if isinstance(func, ast.Name):
        return func.id == "Agent"
    if isinstance(func, ast.Attribute):
        return func.attr == "Agent"
    return False


def _flow_has_streaming_agent(flow_data: dict) -> bool:
    for node in flow_data.get("nodes", []):
        if not isinstance(node, dict):
            continue
        data = node.get("data") or {}
        if isinstance(data, dict) and data.get("streaming") is True:
            return True
    return False


GRAPH_BUILDER_SETUP_ATTRS = {"add_node", "add_edge", "set_entry_point"}

ALLOWED_TOP_LEVEL = (
    ast.Import,
    ast.ImportFrom,
    ast.Assign,
    ast.AnnAssign,
    ast.FunctionDef,
    ast.AsyncFunctionDef,
    ast.ClassDef,
)


def validate_contract(code: str, flow_data: dict) -> List[ValidationIssue]:
    """AST-based contract checks. Returns a list of issues (empty = pass)."""
    issues: List[ValidationIssue] = []

    def err(message: str) -> None:
        issues.append(ValidationIssue(stage="ast", message=message))

    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        err(f"Syntax error: {e.msg} (line {e.lineno})")
        return issues

    # -- module-level async def main(user_input_arg=None, messages_arg=None)
    main_fn = None
    sync_main = None
    for node in tree.body:
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "main":
            main_fn = node
        elif isinstance(node, ast.FunctionDef) and node.name == "main":
            sync_main = node

    if main_fn is None:
        if sync_main is not None:
            err("main() must be declared 'async def', found a sync 'def main'")
        else:
            err("Missing module-level 'async def main(...)' function")
    else:
        params = _params_with_default_flags(main_fn)
        for param in ("user_input_arg", "messages_arg"):
            if param not in params:
                err(f"main() is missing required parameter '{param}'")
            elif not params[param]:
                err(f"main() parameter '{param}' must have a default value")

    # -- every Agent(...) call must pass callback_handler=None
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _is_agent_call(node):
            kw = next(
                (k for k in node.keywords if k.arg == "callback_handler"), None
            )
            if kw is None:
                err(
                    f"Agent(...) call at line {node.lineno} is missing "
                    "'callback_handler=None'"
                )
            elif not (isinstance(kw.value, ast.Constant) and kw.value.value is None):
                err(
                    f"Agent(...) call at line {node.lineno}: callback_handler "
                    "must be exactly None"
                )

    # -- if __name__ == "__main__" guard + import-safe top level
    has_main_guard = False
    for node in tree.body:
        if isinstance(node, ast.If):
            if _is_main_guard(node):
                has_main_guard = True
            else:
                err(
                    f"Top-level 'if' at line {node.lineno} is not the "
                    "__main__ guard; module import must be side-effect free"
                )
        elif isinstance(node, ast.Expr):
            is_docstring = isinstance(node.value, ast.Constant) and isinstance(
                node.value.value, str
            )
            # contract_spec.md section 6: GraphBuilder setup calls are
            # import-safe and explicitly allowed at module top level.
            is_builder_setup = (
                isinstance(node.value, ast.Call)
                and isinstance(node.value.func, ast.Attribute)
                and node.value.func.attr in GRAPH_BUILDER_SETUP_ATTRS
            )
            if not (is_docstring or is_builder_setup):
                err(
                    f"Top-level expression at line {node.lineno} is not allowed "
                    "(only docstrings or GraphBuilder setup calls); module "
                    "import must be side-effect free"
                )
        elif not isinstance(node, ALLOWED_TOP_LEVEL):
            err(
                f"Top-level statement '{type(node).__name__}' at line "
                f"{node.lineno} is not allowed; module import must be "
                "side-effect free"
            )
    if not has_main_guard:
        err("Missing 'if __name__ == \"__main__\"' guard")

    # -- argparse CLI contract
    if "--user-input" not in code:
        err("Code must support the '--user-input' command line argument")
    if "--messages" not in code:
        err("Code must support the '--messages' command line argument")

    # -- streaming bidirectional consistency
    flow_streaming = _flow_has_streaming_agent(flow_data)
    code_streaming = "stream_async" in code
    if flow_streaming and not code_streaming:
        err(
            "Flow has an agent with streaming enabled but the code does not "
            "use stream_async"
        )
    elif code_streaming and not flow_streaming:
        err(
            "Code contains 'stream_async' but no agent in the flow has "
            "streaming enabled (this string toggles streaming detection and "
            "must not appear)"
        )

    return issues


# ---------------------------------------------------------------------------
# Stage 2: ruff (hard errors only)
# ---------------------------------------------------------------------------

async def run_ruff(workspace: Path) -> List[ValidationIssue]:
    issues: List[ValidationIssue] = []
    try:
        proc = await asyncio.create_subprocess_exec(
            "uvx", "ruff", "check",
            "--select", "E9,F",
            # The template generator (and golden examples the AI imitates)
            # emit catch-all imports; unused imports are harmless here.
            "--ignore", "F401",
            "--output-format", "json",
            GENERATED_FILENAME,
            cwd=str(workspace),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
    except FileNotFoundError:
        return [ValidationIssue(stage="ruff", message="uvx not found on PATH; cannot run ruff")]
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return [ValidationIssue(stage="ruff", message="ruff check timed out")]

    if proc.returncode == 0:
        return []

    try:
        diagnostics = json.loads(stdout.decode("utf-8", errors="replace"))
        for diag in diagnostics:
            code_id = diag.get("code") or ""
            message = diag.get("message") or ""
            row = (diag.get("location") or {}).get("row")
            issues.append(
                ValidationIssue(
                    stage="ruff",
                    message=f"{code_id}: {message} (line {row})",
                )
            )
    except (json.JSONDecodeError, AttributeError, TypeError):
        detail = stderr.decode("utf-8", errors="replace").strip() or "unknown ruff failure"
        issues.append(ValidationIssue(stage="ruff", message=f"ruff failed: {detail}"))

    return issues


# ---------------------------------------------------------------------------
# Stage 3: import smoke test (subprocess, credentials stripped)
# ---------------------------------------------------------------------------

def _stripped_env() -> Dict[str, str]:
    return {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(CREDENTIAL_ENV_PREFIXES)
    }


async def run_import_smoke(workspace: Path) -> List[ValidationIssue]:
    """Import the module in a subprocess and re-check the AgentCore signature contract.

    Runs against the backend project environment (strands deps available),
    with cwd=workspace so generated_agent is importable.
    """
    cmd = [
        "uv", "run",
        "--project", str(config.BACKEND_DIR),
        "python", "-c", IMPORT_SMOKE_SNIPPET,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(workspace),
            env=_stripped_env(),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=config.IMPORT_SMOKE_TIMEOUT_S
        )
    except FileNotFoundError:
        return [ValidationIssue(stage="import", message="uv not found on PATH; cannot run import smoke test")]
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return [
            ValidationIssue(
                stage="import",
                message=(
                    f"Import smoke test timed out after "
                    f"{config.IMPORT_SMOKE_TIMEOUT_S}s (module import must be "
                    "side-effect free)"
                ),
            )
        ]

    if proc.returncode == 0:
        return []

    detail = stderr.decode("utf-8", errors="replace").strip()
    # Keep the last few lines of the traceback for a readable error
    tail = "\n".join(detail.splitlines()[-5:]) if detail else "unknown import failure"
    return [ValidationIssue(stage="import", message=f"Import smoke test failed: {tail}")]


# ---------------------------------------------------------------------------
# Pipeline entry point
# ---------------------------------------------------------------------------

async def validate_generated_code(workspace: Path, flow_data: dict) -> ValidationReport:
    """Run the full pipeline against workspace/generated_agent.py.

    Stages short-circuit: ruff only runs after AST passes; import smoke only
    runs after ruff passes (never executes syntactically broken code).
    """
    generated_file = workspace / GENERATED_FILENAME
    if not generated_file.exists():
        return ValidationReport(
            passed=False,
            errors=[ValidationIssue(stage="ast", message=f"{GENERATED_FILENAME} does not exist")],
        )

    try:
        code = generated_file.read_text(encoding="utf-8")
    except OSError as e:
        return ValidationReport(
            passed=False,
            errors=[ValidationIssue(stage="ast", message=f"Cannot read {GENERATED_FILENAME}: {e}")],
        )

    ast_issues = validate_contract(code, flow_data)
    if ast_issues:
        return ValidationReport(passed=False, errors=ast_issues)

    ruff_issues = await run_ruff(workspace)
    if ruff_issues:
        return ValidationReport(passed=False, errors=ruff_issues)

    import_issues = await run_import_smoke(workspace)
    if import_issues:
        return ValidationReport(passed=False, errors=import_issues)

    return ValidationReport(passed=True)
