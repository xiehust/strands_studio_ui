"""
Claude Agent SDK backend (design 2.2).

Runs a headless Claude Code session (via claude-agent-sdk, Bedrock auth)
inside a temporary workspace to produce generated_agent.py.
"""
import asyncio
import logging
import shutil
from pathlib import Path
from typing import Awaitable, Callable, Tuple

from codegen import config
from codegen.backends.base import CodingAgentBackend, GenerationError, GenerationTask

logger = logging.getLogger(__name__)

OUTPUT_FILENAME = config.GENERATED_FILENAME

SYSTEM_PROMPT = (
    "You are a code generator for Strands Agent SDK Python programs. "
    "Your only deliverable is a single file named generated_agent.py written to the "
    "current working directory. Read CLAUDE.md first: it describes the task, the "
    "mandatory code contract (contract_spec.md), the flow semantics (flow_semantics.md), "
    "the input flow (flow.json), and reference examples under examples/. "
    "The generated code MUST satisfy every rule in contract_spec.md. "
    "Do not create any file other than generated_agent.py. Do not explain at length; "
    "write the file."
)

INITIAL_PROMPT = (
    "Generate the agent program now.\n\n"
    "1. Read CLAUDE.md, contract_spec.md, flow_semantics.md and flow.json in this directory.\n"
    "2. Study the reference examples under examples/ (if present) — they show the exact "
    "code style and contract to follow.\n"
    "3. Write the complete program to generated_agent.py in this directory.\n\n"
    "The file must fully implement the flow described by flow.json and satisfy every "
    "contract rule in contract_spec.md."
)

REPAIR_PROMPT_TEMPLATE = (
    "The generated_agent.py you wrote failed validation. Fix it in place.\n\n"
    "Validation errors:\n{errors}\n\n"
    "Edit generated_agent.py so that all of these errors are resolved while still "
    "implementing flow.json and satisfying every rule in contract_spec.md."
)


def _summarize_tool_use(name: str, tool_input: dict) -> str:
    """One-line human-readable summary of a tool invocation."""
    target = (
        tool_input.get("file_path")
        or tool_input.get("path")
        or tool_input.get("pattern")
        or tool_input.get("query")
        or ""
    )
    return f"{name} {target}".strip()


class ClaudeSdkBackend(CodingAgentBackend):
    """Coding agent backend powered by the Claude Agent SDK over Bedrock."""

    name = "claude"

    def __init__(self):
        self._client = None  # ClaudeSDKClient kept alive across repair rounds

    async def check_available(self) -> Tuple[bool, str]:
        # 1. SDK importable
        try:
            import claude_agent_sdk  # noqa: F401
        except ImportError as e:
            return False, f"claude-agent-sdk not installed: {e}"

        # 2. Claude Code CLI present (SDK spawns it as a subprocess)
        if not shutil.which("claude"):
            return False, (
                "Claude Code CLI not found on PATH. "
                "Install it with: npm install -g @anthropic-ai/claude-code"
            )

        # 3. Bedrock (AWS) credentials resolvable
        try:
            import boto3

            credentials = await asyncio.to_thread(
                lambda: boto3.Session().get_credentials()
            )
            if credentials is None:
                return False, "No AWS credentials available for Bedrock authentication"
        except Exception as e:
            return False, f"AWS credential check failed: {e}"

        return True, ""

    def _build_options(self, workspace: Path):
        from claude_agent_sdk import ClaudeAgentOptions

        return ClaudeAgentOptions(
            cwd=str(workspace),
            system_prompt=SYSTEM_PROMPT,
            allowed_tools=["Read", "Write", "Edit", "Grep", "Glob"],
            permission_mode="acceptEdits",
            max_turns=config.CODEGEN_MAX_TURNS,
            mcp_servers={
                "strands": {
                    "type": "stdio",
                    "command": "uvx",
                    "args": ["strands-agents-mcp-server"],
                }
            },
            env={
                "CLAUDE_CODE_USE_BEDROCK": "1",
                "ANTHROPIC_MODEL": config.get_model(),
            },
        )

    async def generate(
        self,
        workspace: Path,
        task: GenerationTask,
        on_progress: Callable[[str], Awaitable[None]],
    ) -> None:
        from claude_agent_sdk import (
            AssistantMessage,
            ClaudeSDKClient,
            ResultMessage,
            TextBlock,
            ToolUseBlock,
        )

        is_repair_round = bool(task.validation_errors)

        if self._client is None:
            # First round: open a session that stays alive for repair rounds
            self._client = ClaudeSDKClient(options=self._build_options(workspace))
            await self._client.connect()

        if is_repair_round:
            errors_text = "\n".join(f"- {e}" for e in task.validation_errors)
            prompt = REPAIR_PROMPT_TEMPLATE.format(errors=errors_text)
        else:
            prompt = INITIAL_PROMPT

        await self._client.query(prompt)

        async for message in self._client.receive_response():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        text = block.text.strip()
                        if text:
                            await on_progress(text)
                    elif isinstance(block, ToolUseBlock):
                        summary = _summarize_tool_use(block.name, block.input or {})
                        await on_progress(f"[tool] {summary}")
            elif isinstance(message, ResultMessage):
                if message.is_error:
                    raise GenerationError(
                        f"Claude agent session ended with error: {message.result or message.subtype}"
                    )
                duration_s = (message.duration_ms or 0) / 1000
                await on_progress(f"Agent round finished in {duration_s:.1f}s")

        output_file = workspace / OUTPUT_FILENAME
        if not output_file.exists():
            raise GenerationError(
                f"Agent session completed but {OUTPUT_FILENAME} was not written"
            )

    async def close(self) -> None:
        if self._client is not None:
            try:
                await self._client.disconnect()
            except Exception as e:
                logger.warning(f"Error disconnecting Claude SDK client: {e}")
            finally:
                self._client = None
