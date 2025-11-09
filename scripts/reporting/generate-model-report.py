#!/usr/bin/env python3
import re
import json
from datetime import datetime
from pathlib import Path

# Read config.defaults
config_path = Path("src/sidekick/config.defaults")
config_text = config_path.read_text()

# Output file
report_path = Path("docs/model-analysis-report.md")
report_path.parent.mkdir(parents=True, exist_ok=True)

# Parse models from config
claude_models = []
openai_models = []
openrouter_models = []

# Parse Claude models (format: # -haiku (4.5)  $1.00 / $5.00)
claude_pattern = r'^# -(\S+)\s+\(([^)]+)\)\s+\$([0-9.]+)\s*/\s*\$([0-9.]+)'
for line in config_text.split('\n'):
    match = re.match(claude_pattern, line)
    if match:
        claude_models.append({
            'model': match.group(1),
            'version': match.group(2),
            'input_cost': match.group(3),
            'output_cost': match.group(4)
        })

# Parse OpenAI models (format: # -gpt-5-nano  $0.05 / $0.40)
openai_pattern = r'^# -(gpt-[^\s]+)\s+\$([0-9.]+)\s*/\s*\$([0-9.]+)'
for line in config_text.split('\n'):
    match = re.match(openai_pattern, line)
    if match:
        openai_models.append({
            'model': match.group(1),
            'input_cost': match.group(2),
            'output_cost': match.group(3)
        })

# Parse OpenRouter models (format: # -google/gemma-3n-e4b-it  $0.02 / $0.04  32k  notes)
openrouter_pattern = r'^# -([^\s]+)\s+\$([0-9.]+)\s*/\s*\$([0-9.]+)\s+(\d+[kK])\s*(.*)?$'
in_openrouter_section = False
for line in config_text.split('\n'):
    if 'OPENROUTER API PROVIDER' in line:
        in_openrouter_section = True
    elif in_openrouter_section and line.startswith('# ===='):
        in_openrouter_section = False
    elif in_openrouter_section:
        match = re.match(openrouter_pattern, line)
        if match:
            openrouter_models.append({
                'model': match.group(1),
                'input_cost': match.group(2),
                'output_cost': match.group(3),
                'context': match.group(4),
                'notes': match.group(5).strip() if match.group(5) else ''
            })

# Generate report
report = f"""# LLM Model Analysis Report

**Last Updated**: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}

This report tracks all LLM models configured in Sidekick and their benchmark performance data.

## Summary

- **Total Models Configured**: {len(claude_models) + len(openai_models) + len(openrouter_models)}
  - Claude CLI: {len(claude_models)}
  - OpenAI API: {len(openai_models)}
  - OpenRouter: {len(openrouter_models)}
- **Models Tested**: 1
- **Models Untested**: {len(claude_models) + len(openai_models) + len(openrouter_models) - 1}

---

## Claude CLI Models

| Model | Input Cost | Output Cost | Status |
|-------|------------|-------------|--------|
"""

for model in claude_models:
    status = "❌ Not Tested"
    report += f"| {model['model']} ({model['version']}) | ${model['input_cost']}/M | ${model['output_cost']}/M | {status} |\n"

report += """
---

## OpenAI API Models

| Model | Input Cost | Output Cost | Status |
|-------|------------|-------------|--------|
"""

for model in openai_models:
    status = "❌ Not Tested"
    report += f"| {model['model']} | ${model['input_cost']}/M | ${model['output_cost']}/M | {status} |\n"

report += """
---

## OpenRouter Models

| Model | Input Cost | Output Cost | Context | Notes | Status |
|-------|------------|-------------|---------|-------|--------|
"""

for model in openrouter_models:
    status = "✅ Tested" if model['model'] == "openai/gpt-oss-20b" else "❌ Not Tested"
    notes = model.get('notes', '')
    report += f"| {model['model']} | ${model['input_cost']}/M | ${model['output_cost']}/M | {model['context']} | {notes} | {status} |\n"

report += """
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
"""

report_path.write_text(report)
print(f"Report generated: {report_path}")
print(f"Total models: {len(claude_models) + len(openai_models) + len(openrouter_models)}")
print(f"Tested: 1, Untested: {len(claude_models) + len(openai_models) + len(openrouter_models) - 1}")

