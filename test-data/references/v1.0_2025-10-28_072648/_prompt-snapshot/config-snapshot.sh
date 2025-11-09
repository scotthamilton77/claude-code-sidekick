# Configuration snapshot for reference generation
# Generated: 2025-10-28T11:26:48Z

REFERENCE_VERSION="v1.0"
LLM_TIMEOUT_SECONDS=30
TOPIC_EXCERPT_LINES=80
TOPIC_FILTER_TOOL_MESSAGES=true

# Reference models
REFERENCE_MODELS=(
    "openrouter:x-ai/grok-4"
    "openrouter:google/gemini-2.5-pro"
    "openrouter:openai/gpt-5-chat"
)

# Judge model
JUDGE_MODEL="openrouter:deepseek/deepseek-r1-distill-qwen-14b"
