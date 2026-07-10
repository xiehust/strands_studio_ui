/**
 * Shared Bedrock model catalog and default model id.
 *
 * DEFAULT_MODEL_ID is the single source of truth for the fallback model used by
 * new agent nodes and all code-generation fallback paths.
 *
 * Model ids verified against `aws bedrock list-inference-profiles`
 * (us-west-2 / eu-west-1) on 2026-07-10.
 */

export const DEFAULT_MODEL_ID = 'global.anthropic.claude-sonnet-4-6';

export interface BedrockModelOption {
  model_id: string;
  model_name: string;
}

export const BEDROCK_MODELS: BedrockModelOption[] = [
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
    model_id: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    model_name: 'Claude 4.5 Haiku (global)',
  },
  {
    model_id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    model_name: 'Claude 4.5 Haiku (US)',
  },
  {
    model_id: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
    model_name: 'Claude 4.5 Haiku (EU)',
  },
  {
    model_id: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
    model_name: 'Claude 4.5 Sonnet (global)',
  },
  {
    model_id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    model_name: 'Claude 4.5 Sonnet (US)',
  },
  {
    model_id: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
    model_name: 'Claude 4.5 Sonnet (EU)',
  },
  {
    model_id: 'global.anthropic.claude-sonnet-4-20250514-v1:0',
    model_name: 'Claude 4 Sonnet (global)',
  },
  {
    model_id: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    model_name: 'Claude 4 Sonnet (US)',
  },
  {
    model_id: 'eu.anthropic.claude-sonnet-4-20250514-v1:0',
    model_name: 'Claude 4 Sonnet (EU)',
  },
  {
    model_id: 'apac.anthropic.claude-sonnet-4-20250514-v1:0',
    model_name: 'Claude 4 Sonnet (APAC)',
  },
  {
    model_id: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    model_name: 'Claude 3.7 Sonnet (US)',
  },
  {
    model_id: 'eu.anthropic.claude-3-7-sonnet-20250219-v1:0',
    model_name: 'Claude 3.7 Sonnet (EU)',
  },
  {
    model_id: 'apac.anthropic.claude-3-7-sonnet-20250219-v1:0',
    model_name: 'Claude 3.7 Sonnet (APAC)',
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
