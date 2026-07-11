# Chat 对话框 AI Fix：显式错误标记 + 修复后保留会话历史

## Goal

Chat Modal 中代码执行失败时，用户能像在 Execution Panel 里一样点击 "AI Fix" 让后端 coding agent 诊断并修复代码；修复应用后无需重建会话即可继续对话（聊天历史保留）。

## Background / Problem

- Execution Panel 已有完整 AI Fix 链路（`POST /api/fix-code/stream` + 进度 UI + `onApplyFixedCode` 回写 CodeState），Chat Modal 完全没有接入。
- 后端会话服务把执行错误当普通 agent 回复返回：
  - 非流式：`conversation_service._execute_agent` 失败时 `return f"Error: {stderr}"`，前端渲染成普通 agent 气泡，无法可靠区分"代码错误"和正常回复。
  - 流式：`_execute_agent_stream` 失败时 `yield f"\nError: {stderr}"`——多行 chunk 塞进单个 SSE `data:` 行后，除首行外全部被前端解析器丢弃（现有 bug），错误检测靠 `startsWith('Error: ')` 前缀猜测，且因首字符是 `\n` 实际匹配不到。
- 错误内容会作为 agent 消息存入会话历史并在后续轮次通过 `--messages` 回放给 agent，污染上下文。
- 会话创建时后端把 `generated_code` 写入临时目录 `agent.py`，之后无法更新；修复代码后旧会话仍跑坏代码，重建会话则丢历史。

## Requirements

### R1 后端显式错误信号（用户决策：显式标记，不做前缀猜测）
- 非流式 `ChatResponse` 增加 `success: bool` 与 `error: Optional[str]` 字段；执行失败时 `success=false`、`error` 携带完整 stderr，`content` 不再伪装成回复文本。
- 流式 SSE 增加结构化错误哨兵事件（错误文本 JSON 编码为单行，解决多行丢失 bug），在 `[CHAT_COMPLETE:id]` 之前发出；前端据此触发 onError 并拿到完整错误文本。
- 失败轮次（触发错误的 user 消息 + 错误 agent 消息）标记 `metadata.error=true`，`_construct_messages_list` 回放历史时成对跳过，保持 role 交替、不污染后续上下文。
- 错误消息仍保留在会话消息列表中（供 UI 展示历史），只是不回放给 agent。

### R2 修复后保留聊天历史（用户决策）
- 新增会话代码更新接口（如 `PUT /api/conversations/{session_id}/code`）：原地重写会话目录的 `agent.py`，会话与消息记录不动。
- Chat Modal 应用修复后：先通过 `onApplyFixedCode` 回写全局 CodeState（`source:'ai'`，与 Execution Panel 语义一致），再调用会话代码更新接口；不重建会话，历史消息在 UI 中原样保留。

### R3 Chat Modal AI Fix 入口
- 执行错误在聊天中以明显区分于正常回复的错误样式呈现（错误气泡/横幅），旁边提供 "AI Fix" 按钮。
- 按钮仅在 codegen 后端可用时显示（复用 `GET /api/generate-code/status` 检查，避免重复请求可由 Execution Panel 传入）。
- 点击后调用现有 `POST /api/fix-code/stream`（code=当前生成代码，error=完整错误文本，flow_data/graph_mode 一并传入），展示与 Execution Panel 一致的进度事件、诊断卡片（code/config/environment 三类）与失败态。
- 修复成功且 `changed:true` 时自动应用（R2 流程）并提示用户重新发送消息；`changed:false` 时仅展示诊断。
- 修复期间禁止发送新消息。

### R4 兼容性约束
- `/api/fix-code/stream` 合同不改动。
- Execution Panel 现有 AI Fix 行为不回归（若抽取共享逻辑，行为必须等价）。
- `ChatResponse` 新字段带默认值（`success=true`），不破坏现有前端对旧字段的读取。
- 生成代码合同（contract_spec）不涉及、不改动。

## Acceptance Criteria

- [ ] 非流式聊天执行失败：前端收到 `success=false` + 完整 stderr，聊天区显示错误样式 + AI Fix 按钮；正常回复不再可能被误判为错误。
- [ ] 流式聊天执行失败：多行 traceback 完整到达前端 onError（现有多行丢失 bug 一并修复），错误样式 + AI Fix 按钮同样出现。
- [ ] 点击 AI Fix：进度事件实时展示；修复成功后 CodeState 更新为 `source:'ai'`、Code Panel 显示新代码，会话 `agent.py` 同步更新。
- [ ] 修复后不重建会话：历史消息在 UI 保留，重新发消息使用新代码执行成功（端到端：故意用坏代码建会话 → 发消息得到显式错误 → AI Fix → 再发消息成功）。
- [ ] 失败轮次不回放：修复后继续对话时 `--messages` 中不含错误文本，且 role 序列保持交替。
- [ ] Execution Panel 的 AI Fix 全流程（按钮显隐、进度、诊断卡、应用通知）行为不变。
- [ ] `npm run build`、`npm run lint` 通过；后端可正常启动（uv run）。

## Out of Scope

- config/environment 类诊断的自动落回 canvas 节点属性（维持现状：只展示建议）。
- AI Fix 结果缓存、会话持久化（跨重启）改造。
- Lambda/ECS 等停用部署目标。
