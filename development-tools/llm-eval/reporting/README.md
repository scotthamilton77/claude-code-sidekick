# Reporting Scripts

## generate-model-report.py

Generates the LLM Model Analysis Report (`docs/model-analysis-report.md`).

**Usage**:
```bash
./scripts/reporting/generate-model-report.py
```

**What it does**:
1. Parses `src/sidekick/config.defaults` to extract all configured models and pricing
2. Analyzes benchmark results from `test-data/results/`
3. Generates a comprehensive markdown report showing:
   - All available models (Claude CLI, OpenAI API, OpenRouter)
   - Pricing information (input/output costs)
   - Test status (tested vs. untested)
   - Benchmark results with provider breakdowns (e.g., "OpenRouter/SiliconFlow")
   - Reliability metrics, failure modes, and recommendations

**When to run**:
- After adding new models to config.defaults
- After completing new benchmark runs
- To refresh the report with updated timestamps

**Output**: `docs/model-analysis-report.md`
