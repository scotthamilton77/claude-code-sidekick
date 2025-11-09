# LLM Model Analysis Report

**Last Updated**: 2025-11-09 11:40:45 UTC

This report tracks all LLM models configured in Sidekick and their benchmark performance data.

## Summary

- **Total Models Configured**: 18
  - Claude CLI: 3
  - OpenAI API: 3
  - OpenRouter: 12
- **Models Tested**: 1
- **Models Untested**: 17

---

## Claude CLI Models

| Model | Input Cost | Output Cost | Status |
|-------|------------|-------------|--------|
| haiku (4.5) | $1.00/M | $5.00/M | ❌ Not Tested |
| sonnet (4.5) | $3.00/M | $15.00/M | ❌ Not Tested |
| opus (4.1) | $15.00/M | $75/M | ❌ Not Tested |

---

## OpenAI API Models

| Model | Input Cost | Output Cost | Status |
|-------|------------|-------------|--------|
| gpt-5-nano | $0.05/M | $0.40/M | ❌ Not Tested |
| gpt-o4-mini | $0.15/M | $0.60/M | ❌ Not Tested |
| gpt-5-mini | $0.25/M | $2.00/M | ❌ Not Tested |

---

## OpenRouter Models

| Model | Input Cost | Output Cost | Context | Notes | Status |
|-------|------------|-------------|---------|-------|--------|
| google/gemma-3n-e4b-it | $0.02/M | $0.04/M | 32k | high error rate (100% on 2025-10-30) | ❌ Not Tested |
| google/gemma-3-4b-it | $0.02/M | $0.07/M | 32k |  | ❌ Not Tested |
| google/gemma-3-12b-it | $0.03/M | $0.10/M | 128k | high error rate (20% on 2025-10-30) | ❌ Not Tested |
| openai/gpt-oss-20b | $0.03/M | $0.14/M | 128k |  | ✅ Tested |
| openai/gpt-5-nano | $0.05/M | $0.40/M | 400k |  | ❌ Not Tested |
| google/gemma-3-27b-it | $0.09/M | $0.16/M | 128k |  | ❌ Not Tested |
| mistralai/ministral-8b | $0.10/M | $0.10/M | 131K |  | ❌ Not Tested |
| google/gemini-2.0-flash-lite-001 | $0.08/M | $0.30/M | 1000k | (max out: 8k) | ❌ Not Tested |
| google/gemini-2.5-flash-lite | $0.10/M | $0.40/M | 1000k |  | ❌ Not Tested |
| x-ai/grok-4 | $3.00/M | $15.00/M | 256k |  | ❌ Not Tested |
| google/gemini-2.5-pro | $1.25/M | $10.00/M | 1000k |  | ❌ Not Tested |
| openai/gpt-5-chat | $1.25/M | $10.00/M | 128k |  | ❌ Not Tested |

---

## Benchmark Results

### openai/gpt-oss-20b via OpenRouter

**Test Run**: 2025-11-09_095020  
**Total Runs**: 13  
**Overall Success Rate**: 46.2%  
**Input Cost**: $0.03/M tokens  
**Output Cost**: $0.14/M tokens  

#### Performance by OpenRouter Backend Provider

| Backend Provider | Runs | Success | Failed | Success Rate | Failures |
|------------------|------|---------|--------|--------------|----------|
| OpenRouter/SiliconFlow | 5 | 3 | 2 | 60.0% | 1× timeout, 1× invalid_json |
| OpenRouter/Novita | 4 | 2 | 2 | 50.0% | 1× empty_content, 1× invalid_json |
| OpenRouter/Nebius | 3 | 1 | 2 | 33.3% | 2× invalid_json |
| OpenRouter/WandB | 1 | 0 | 1 | 0.0% | 1× invalid_json |

**Key Findings**:
- ❌ **Not Recommended** for production use
- Primary failure mode: Invalid JSON formatting (71% of failures)
  - Model outputs explanatory text before/after JSON structure
  - Does not reliably follow structured output constraints
- Secondary issues:
  - Empty content field (reasoning model puts output in wrong field)
  - API timeouts (15-second threshold)
- Best backend provider: SiliconFlow (60% success)
- Worst backend provider: WandB (0% success, limited sample)

**Recommendation**: Avoid this model for structured JSON tasks. Consider alternatives with better instruction-following capabilities.

---

## Testing Status

### ✅ Tested Models (1)

1. **openai/gpt-oss-20b** (OpenRouter)
   - Success Rate: 46.2%
   - Cost: $0.03 input / $0.14 output per M tokens
   - Status: ❌ **Not Recommended** (unreliable structured output)

### ❌ Untested Models

All models listed above with ❌ status have not been benchmarked yet. Priority candidates for testing:

**Budget Tier** (< $0.10 input):
- google/gemma-3n-e4b-it ($0.02/$0.04) - ⚠️ Flagged: high error rate (100% on 2025-10-30)
- google/gemma-3-4b-it ($0.02/$0.07)
- google/gemma-3-12b-it ($0.03/$0.10) - ⚠️ Flagged: high error rate (20% on 2025-10-30)
- openai/gpt-5-nano ($0.05/$0.40) - Available via both OpenAI API and OpenRouter
- google/gemini-2.0-flash-lite-001 ($0.08/$0.30)

**Mid-Tier** (< $0.50 input):
- google/gemma-3-27b-it ($0.09/$0.16)
- mistralai/ministral-8b ($0.10/$0.10)
- google/gemini-2.5-flash-lite ($0.10/$0.40)

**Premium Tier** (reference/baseline):
- x-ai/grok-4 ($3.00/$15.00)
- google/gemini-2.5-pro ($1.25/$10.00)
- openai/gpt-5-chat ($1.25/$10.00)

---

## Failure Type Glossary

- **invalid_json**: Model outputs text before/after JSON or produces malformed JSON
- **empty_content**: Reasoning model puts output in reasoning field instead of content field
- **timeout**: API request exceeded timeout threshold (15s for benchmarks)
- **other**: Unclassified errors

---

## Methodology

Benchmarks test LLM topic extraction capability with:
- Real Claude Code conversation transcripts (5 test cases, 3 runs each = 15 total per model)
- Structured JSON output requirements (8-field schema)
- 15-second timeout threshold
- Multiple metrics: reliability, latency, cost, failure modes

**Evaluation Criteria**:
- ✅ **Recommended**: ≥80% success rate, reliable structured output
- ⚠️ **Use with Caution**: 50-79% success rate, occasional failures
- ❌ **Not Recommended**: <50% success rate, unreliable output
