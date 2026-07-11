# Implement: Chat 对话框 AI Fix

按序执行；每步的验证命令必须通过再进下一步。回滚点以步骤为粒度（git 工作区级 revert）。

## Step 1 — 后端模型与服务：显式错误信号

- [ ] `backend/app/models/conversation.py`：`ChatResponse` 加 `success: bool = True`、`error: Optional[str] = None`；新增 `UpdateSessionCodeRequest(generated_code: str)`。
- [ ] `conversation_service.py`：
  - `_execute_agent` 返回 `tuple[bool, str]`（成功→stdout；失败/超时/异常→完整错误文本，去掉 `"Error: "` 拼接）。
  - `send_message` 失败分支：`success=False`、`error` 填充、`content=""`；对本轮 user 消息与 agent 错误消息设置 `metadata={"error": True}`（收敛为一个 `_mark_turn_failed(user_msg, agent_msg)` 小助手）。
  - `_execute_agent_stream` 改 yield `("chunk", text)` / `("error", text)`；`stream_message` 翻译：error → `f"[CHAT_ERROR:{json.dumps(text)}]"` 后接 `[CHAT_COMPLETE:{id}]`，并成对打 `metadata.error`。
  - `_construct_messages_list` 过滤 `metadata.get("error")` 的消息。
  - 新增 `update_session_code(session_id, generated_code)`：校验会话存在，原地重写 `agent_file`，刷新 `updated_at`，返回 session。
- 验证：`cd backend && uv run python -c "import main"` 通过（语法/导入）；`uv run python -m compileall app/services/conversation_service.py` 通过。

## Step 2 — 后端端点

- [ ] `main.py`：流式端点 `generate_response` 异常兜底改用 `[CHAT_ERROR:<json>]` 哨兵；新增 `PUT /api/conversations/{session_id}/code`（404 on ValueError，返回 ConversationSession）。
- 验证：启动后端（`uv run uvicorn main:app --host 127.0.0.1 --port 8000`，后台）后跑脚本化 e2e：
  1. `POST /api/conversations` 用故意报错的代码（满足合同的 `async def main(...)` 里 `raise RuntimeError("boom")`，带 argparse/`__main__` guard）建会话。
  2. `POST .../messages` → 断言响应 `success:false` 且 `error` 含 `RuntimeError: boom` 的多行 traceback。
  3. `curl -N POST .../messages/stream` → 断言出现 `[CHAT_ERROR:` 且 JSON 解码后含完整 traceback，最后有 `[CHAT_COMPLETE:`。
  4. `PUT .../code` 换成正常代码 → `POST .../messages` 断言 `success:true` 且有输出。
  5. `GET .../messages` → 断言失败轮次两条消息带 `metadata.error`，正常轮次不带。
  - 注意：正常代码路径会真实调用 Bedrock；若环境无凭证，改用"打印固定文本后退出"的合同兼容代码验证第 4 步。

## Step 3 — 前端 api-client 与类型

- [ ] `conversation-types.ts`：`ChatResponse` 加 `success?: boolean; error?: string`；确认 `ChatMessage` 类型含 `metadata?: Record<string, unknown>`。
- [ ] `api-client.ts`：`sendChatMessageStream` 解析器在 `[CHAT_COMPLETE:` 之前处理 `[CHAT_ERROR:` （`JSON.parse` 剩余部分为错误文本），保留旧 `Error: ` 前缀兜底；新增 `updateConversationCode(sessionId, generatedCode)`。
- 验证：`npm run build` 通过。

## Step 4 — 抽取共享 AI Fix hook / 组件（Execution Panel 重构，行为等价）

- [ ] 新建 `src/hooks/use-ai-fix.ts`（状态机 + `startFix` + `resetFixState`，签名见 design §3.2）。
- [ ] 新建 `src/components/ai-fix-progress.tsx`：迁移 execution-panel.tsx:799-880 的进度/失败头/诊断卡/已应用通知 JSX，样式类逐字保留。
- [ ] `execution-panel.tsx` 改为消费 hook + 组件；删除被迁移的本地状态与 JSX。
- 行为等价检查清单：AI Fix 按钮显隐条件（`codegenAvailable && success===false`）、事件文案（"Starting AI fix..." / "Validation round N: ..."）、诊断三类 chip、"Code fixed by AI — re-run to verify." 通知、切换执行记录时 `resetFixState`。
- 验证：`npm run lint`、`npm run build` 通过；浏览器手工回归 Execution Panel AI Fix 一次（可用坏代码触发）。

## Step 5 — ChatModal 接入 AI Fix

- [ ] `chat-modal.tsx`：
  - 新 props：`codegenAvailable`、`graphMode?`、`onApplyFixedCode?`。
  - 非流式失败（`response.success === false`）与流式 onError：追加 `metadata.error` 本地错误消息，记录 `lastChatError`；错误气泡样式（crit 边框 + AlertTriangle）+ 气泡内 "AI Fix" 按钮。
  - 接 `useAiFix`：`startFix({code: generatedCode, error, flow_data: flowData, graph_mode: graphMode})`；`<AiFixProgress>` 渲染在错误气泡下方；`isFixing` 时禁用输入/发送。
  - `onApplied`：`onApplyFixedCode(code)` → `apiClient.updateConversationCode(session.session_id, code)` → 成功提示 "Code fixed — send your message again."；PUT 失败计入 fixError。
  - 模态关闭时重置 fix 状态与 `lastChatError`。
- [ ] `execution-panel.tsx` 渲染点给 ChatModal 传 `codegenAvailable`、`graphMode`、`onApplyFixedCode`。
- 验证：`npm run lint`、`npm run build`。

## Step 6 — 端到端与全量检查（最后一轮全范围）

- [ ] 起前后端（`npm run dev:full` 或生产脚本），浏览器走完整链路：坏代码 → Chat 发消息（流式与非流式各一次）→ 错误气泡 + AI Fix → 修复应用（Code Panel 变为 AI 来源）→ 不关模态继续发消息成功、历史仍在。
- [ ] Execution Panel AI Fix 回归一次。
- [ ] `npm run lint` && `npm run build` 最终通过；后端 e2e 脚本复跑通过。

## Step 7 — 收尾

- [ ] Spec 更新：`.trellis/spec/backend/`（conversation 错误信号契约 + 会话代码更新端点）视情况补充；`CLAUDE.md` 的 Conversation Management / AI Fix 小节补一句 Chat AI Fix 与显式错误契约。
- [ ] 提交（feat + 简述契约变化），任务归档。

## 回滚

全部改动限于单分支工作区；任一步失败且不可快速修复时 `git checkout -- <files>` 回退该步文件。合同性改动（ChatResponse 字段、SSE 哨兵）均为增量带默认值，回滚无数据影响。
