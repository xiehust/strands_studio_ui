# Design: Chat 对话框 AI Fix

## 1. 边界

改动面：
- 后端：`backend/app/models/conversation.py`、`backend/app/services/conversation_service.py`、`backend/main.py`（conversation 端点段）。
- 前端：`src/lib/api-client.ts`、`src/lib/conversation-types.ts`、`src/components/chat-modal.tsx`、`src/components/execution-panel.tsx`，新增共享 AI Fix hook/组件。

不动：`backend/codegen/`（fix-code 合同）、`contract_spec.md`、CodeState 语义（`main-layout.tsx` 的 `handleApplyFixedCode` 原样复用）、会话存储形态（仍是内存 dict + 临时目录）。

## 2. 后端契约

### 2.1 非流式错误信号

`ChatResponse` 增加字段（带默认值，向后兼容）：

```python
class ChatResponse(BaseModel):
    message_id: str
    content: str
    timestamp: datetime
    streaming_complete: bool = True
    success: bool = True          # NEW
    error: Optional[str] = None   # NEW: 完整 stderr / 超时 / 异常文本
```

`_execute_agent` 返回值从 `str` 改为 `tuple[bool, str]`（`(success, text)`；失败时 text=完整 stderr，不再拼 `"Error: "` 前缀）。`send_message` 据此填充 ChatResponse：
- 成功：`content=stdout`，行为不变。
- 失败：`success=False`、`error=stderr`、`content=""`；agent 错误消息仍写入 `self.messages`（content 存错误文本，供历史查询），但 user 消息与该 agent 消息均标记 `metadata={"error": True}`。

### 2.2 流式错误哨兵

`_execute_agent_stream` 内部协议改为 yield 元组 `("chunk", text)` / `("error", text)`（含超时与异常路径）。`stream_message` 翻译为对外字符串流：
- `("chunk", t)` → 原样 yield（保持现有 stdout 流行为）。
- `("error", t)` → yield `f"[CHAT_ERROR:{json.dumps(t)}]"`（JSON 编码为单行，彻底修掉多行 chunk 被 SSE 丢行的 bug），随后照常 yield `[CHAT_COMPLETE:{id}]`。
- 失败轮次同样对 user + agent 消息打 `metadata.error=True`。

`main.py` 流式端点的异常兜底路径同样改用 `[CHAT_ERROR:...]` 哨兵（替换现有 `data: Error: {e}`）。

### 2.3 历史回放过滤

`_construct_messages_list` 跳过 `metadata.get("error")` 为真的消息。由于失败轮次 user+agent 成对标记，回放序列天然保持 user/assistant 交替（Bedrock converse 约束），修复后的对话不携带错误文本。

### 2.4 会话代码更新（保历史的关键）

```
PUT /api/conversations/{session_id}/code
body: {"generated_code": "<python source>"}
resp: ConversationSession（updated_at 刷新）
404: session 不存在
```

新模型 `UpdateSessionCodeRequest`；服务方法 `update_session_code(session_id, generated_code)` 原地重写 `agent_processes[session_id]['agent_file']`（同一 `agent.py` 路径），`sessions`/`messages` 完全不动。会话是内存态，无迁移问题。

## 3. 前端设计

### 3.1 api-client / 类型

- `conversation-types.ts`：`ChatResponse` 加 `success?: boolean; error?: string`；`ChatMessage` 的本地渲染类型允许 `metadata`（后端已有该字段）。
- `sendChatMessageStream` 解析器：在 `[CHAT_COMPLETE:` 分支之前识别 `[CHAT_ERROR:` 前缀 → `JSON.parse` 出完整错误文本存入 `errorMessage`；保留旧 `Error: ` 前缀分支作为兼容兜底（无害）。
- 新增 `updateConversationCode(sessionId: string, generatedCode: string): Promise<ConversationSession>`。

### 3.2 共享 AI Fix 逻辑抽取

execution-panel 现有 fix 状态机（约 120 行状态 + 事件累积 + 渲染）抽为：
- `src/hooks/use-ai-fix.ts`：`useAiFix({ onApplied })` → `{ isFixing, fixEvents, fixError, fixDiagnosis, fixApplied, startFix(request), resetFixState }`。`startFix` 封装 `apiClient.fixCodeStream` 全部回调翻译（progress/activity/validation/done/error），`onDone` 时 `changed && onApplied(code)`。
- `src/components/ai-fix-progress.tsx`：纯展示组件，渲染进度事件列表、失败头、诊断卡片（code/config/environment 三类 chip 与建议列表）、"已应用"通知——即现有 execution-panel.tsx:799-880 的 JSX 原样迁移，样式类不变。

execution-panel 重构为消费 hook + 组件，对外行为必须等价（按钮显隐条件、事件文案、诊断卡内容不变）。

### 3.3 ChatModal 接入

新 props（由 execution-panel 渲染点传入，避免重复请求 codegen status）：

```ts
codegenAvailable: boolean;
graphMode?: boolean;
onApplyFixedCode?: (code: string) => boolean;  // 与 ExecutionPanel 同一回调
```

交互流：
1. 发消息失败（非流式 `success===false`，或流式 onError）→ 在消息列表追加一条本地错误消息（`metadata.error`），渲染为错误样式气泡（红色边框/AlertTriangle），气泡内含完整错误文本 + "AI Fix" 按钮（`codegenAvailable` 时显示）；同时记录 `lastChatError = { text, messageId }`。流式 partialOutput 若非空，先作为普通 agent 气泡保留（现状行为）。
2. 点击 AI Fix → `startFix({ code: generatedCode, error: lastChatError.text, flow_data: flowData, graph_mode: graphMode })`；进度用 `<AiFixProgress>` 渲染在错误气泡下方；期间输入框与发送按钮禁用（复用 isFixing）。
3. `onApplied(fixedCode)`：先 `onApplyFixedCode(fixedCode)` 回写 CodeState（source:'ai'，触发 Code Panel 更新），再 `await apiClient.updateConversationCode(session.session_id, fixedCode)`——用 fix 结果里的代码字符串直接调后端，不依赖 props 异步更新。成功后显示 "Code fixed — send your message again."；updateConversationCode 失败则显示为 fixError（此时 CodeState 已更新，用户可关闭重开会话兜底）。
4. 会话不重建：session/messages 状态原样保留；用户重发消息即用新代码执行。

`changed:false`（config/environment 诊断）：只展示诊断卡，不调用会话更新。

## 4. 数据流（失败→修复→继续）

```
user msg ──POST /messages──▶ conversation_service ──subprocess──▶ 失败
   ◀── success:false + error(stderr)；user+agent 消息 metadata.error=true
UI 错误气泡 + AI Fix ──POST /api/fix-code/stream──▶ codegen agent 修复
   ◀── done{code, changed:true, diagnosis}
onApplyFixedCode(code) → CodeState(source:'ai')
PUT /conversations/{id}/code → agent.py 原地重写（messages 不动）
user 重发消息 ──▶ 新代码执行；_construct_messages_list 跳过 error 对，
                 role 交替保持，错误文本不进 --messages
```

## 5. 取舍

- **写入时成对标记 vs 回放时成对过滤**：选写入时标记（`metadata.error`）。回放逻辑退化为简单 filter，且错误轮次在 history API 中可观测；缺点是标记逻辑分散在 sync/stream 两处，用小助手方法收敛。
- **哨兵字符串 vs 重构为 JSON-framed SSE**：选 `[CHAT_ERROR:<json>]` 哨兵，与既有 `[CHAT_COMPLETE:id]` 同风格，前端解析器改动最小；全量 JSON 事件化留给未来。
- **抽 hook/组件 vs 复制到 ChatModal**：选抽取。复制约 150 行且两处诊断卡 UI 必然漂移；抽取的风险（execution-panel 回归）用"JSX 原样迁移 + 行为等价检查"控制。
- **会话代码更新 vs 重建会话**：用户已决策保历史，选 PUT 更新。子进程按消息一次性起停，无常驻进程需要失效处理。

## 6. 兼容与回滚

- `ChatResponse` 新字段带默认值；旧前端（若有缓存构建）读旧字段不受影响。
- 前端解析器保留旧 `Error: ` 前缀兜底，滚动升级期间新旧后端均可用。
- 会话全部在内存，无持久化数据迁移；回滚 = revert 单个 commit。
- Execution Panel AI Fix 为纯重构（hook/组件抽取），合同、文案、样式类零变化。

## 7. 验证策略

无测试框架（项目现状），验证靠：
1. `npm run lint` + `npm run build`（TS 编译覆盖前端类型改动）。
2. 后端脚本化 e2e（curl，backend 用 `uv run` 起）：坏代码建会话 → 非流式发消息断言 `success:false` 且 `error` 含 traceback → PUT 修复代码 → 再发消息断言成功 → GET messages 断言错误轮次带 `metadata.error`。流式路径用 `curl -N` 断言 `[CHAT_ERROR:` 哨兵完整携带多行 traceback。
3. UI 手工/浏览器检查：错误气泡、AI Fix 进度、修复后继续对话、Execution Panel 回归。
