/**
 * Shared Bedrock model catalog and default model id.
 *
 * DEFAULT_MODEL_ID is the single source of truth for the fallback model used by
 * new agent nodes and all code-generation fallback paths.
 *
 * Claude Sonnet 5 / 4.6 / Opus 4.8 ids verified against
 * `aws bedrock list-inference-profiles` (us-west-2) on 2026-07-10.
 * xai.grok-4.3 / openai.gpt-5.5 / openai.gpt-5.4 are available in
 * us-east-1 (per user confirmation; not visible in this account's
 * listings — likely requires model access enablement).
 */

export const DEFAULT_MODEL_ID = 'global.anthropic.claude-sonnet-4-6';

/** Sentinel value for the "Custom model ID" option in model dropdowns. */
export const CUSTOM_MODEL_OPTION = '__custom__';

export interface BedrockModelOption {
  model_id: string;
  model_name: string;
}

export const BEDROCK_MODELS: BedrockModelOption[] = [
  {
    model_id: 'global.anthropic.claude-sonnet-5',
    model_name: 'Claude Sonnet 5 (global)',
  },
  {
    model_id: 'us.anthropic.claude-sonnet-5',
    model_name: 'Claude Sonnet 5 (US)',
  },
  {
    model_id: 'global.anthropic.claude-sonnet-4-6',
    model_name: 'Claude Sonnet 4.6 (global)',
  },
  {
    model_id: 'us.anthropic.claude-sonnet-4-6',
    model_name: 'Claude Sonnet 4.6 (US)',
  },
  {
    model_id: 'eu.anthropic.claude-sonnet-4-6',
    model_name: 'Claude Sonnet 4.6 (EU)',
  },
  {
    model_id: 'global.anthropic.claude-opus-4-8',
    model_name: 'Claude Opus 4.8 (global)',
  },
  {
    model_id: 'us.anthropic.claude-opus-4-8',
    model_name: 'Claude Opus 4.8 (US)',
  },
  {
    model_id: 'eu.anthropic.claude-opus-4-8',
    model_name: 'Claude Opus 4.8 (EU)',
  },
  {
    model_id: 'xai.grok-4.3',
    model_name: 'Grok 4.3 (xAI, us-east-1)',
  },
  {
    model_id: 'openai.gpt-5.5',
    model_name: 'GPT-5.5 (OpenAI, us-east-1)',
  },
  {
    model_id: 'openai.gpt-5.4',
    model_name: 'GPT-5.4 (OpenAI, us-east-1)',
  },
  {
    model_id: 'openai.gpt-oss-120b-1:0',
    model_name: 'GPT-OSS-120B',
  },
  {
    model_id: 'qwen.qwen3-235b-a22b-2507-v1:0',
    model_name: 'Qwen3 235B A22B 2507',
  },
  {
    model_id: 'qwen.qwen3-32b-v1:0',
    model_name: 'Qwen3 32B (dense)',
  },
  {
    model_id: 'qwen.qwen3-coder-480b-a35b-v1:0',
    model_name: 'Qwen3 Coder 480B A35B Instruct',
  },
  {
    model_id: 'deepseek.v3-v1:0',
    model_name: 'DeepSeek-V3.1',
  },
  {
    model_id: 'us.amazon.nova-premier-v1:0',
    model_name: 'Amazon Nova Premier v1',
  },
  {
    model_id: 'us.amazon.nova-pro-v1:0',
    model_name: 'Amazon Nova Pro v1',
  },
];

/** Display name marking a node as using a user-entered (custom) model id. */
export const CUSTOM_MODEL_NAME = 'Custom model';

/**
 * True when the node should show the custom-model-id input: either the stored
 * id is not in the catalog (e.g. a legacy/removed id), or the node was
 * explicitly switched to "Custom model ID…" (marked via modelName) and the id
 * is still being typed.
 */
export function isCustomModel(
  modelId: string | undefined | null,
  modelName?: string | null,
): boolean {
  if (modelName === CUSTOM_MODEL_NAME) return true;
  if (!modelId) return false;
  return !BEDROCK_MODELS.some((m) => m.model_id === modelId);
}
