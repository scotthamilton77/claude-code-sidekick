# LLM Model Analysis Report

**Last Updated**: 2025-11-09 15:19:42 UTC

This report tracks all LLM models configured in Sidekick and their benchmark performance data.

## Summary

- **Total Models Configured**: 19
  - Claude CLI: 3
  - OpenAI API: 3
  - OpenRouter: 13
- **Models Tested**: 6
- **Models Untested**: 13

---

## Claude CLI Models

| Model | Input Cost | Output Cost | Status |
|-------|------------|-------------|--------|
| haiku (4.5) | $1.00/M | $5.00/M | ✅ Tested |
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
| google/gemma-3-4b-it | $0.02/M | $0.07/M | 32k |  | ✅ Tested |
| google/gemma-3-12b-it | $0.03/M | $0.10/M | 128k | high error rate (20% on 2025-10-30) | ✅ Tested |
| openai/gpt-oss-20b | $0.03/M | $0.14/M | 128k |  | ✅ Tested |
| openai/gpt-5-nano | $0.05/M | $0.40/M | 400k |  | ❌ Not Tested |
| google/gemma-3-27b-it | $0.09/M | $0.16/M | 128k |  | ✅ Tested |
| mistralai/ministral-8b | $0.10/M | $0.10/M | 131K |  | ❌ Not Tested |
| google/gemini-2.0-flash-lite-001 | $0.08/M | $0.30/M | 1000k | (max out: 8k) | ✅ Tested |
| google/gemini-2.5-flash-lite | $0.10/M | $0.40/M | 1000k |  | ❌ Not Tested |
| deepseek/deepseek-r1-distill-qwen-14b | $0.15/M | $0.15/M | 32k |  | ❌ Not Tested |
| x-ai/grok-4 | $3.00/M | $15.00/M | 256k |  | ❌ Not Tested |
| google/gemini-2.5-pro | $1.25/M | $10.00/M | 1000k |  | ❌ Not Tested |
| openai/gpt-5-chat | $1.25/M | $10.00/M | 128k |  | ❌ Not Tested |

---

## Benchmark Results

### haiku (Claude CLI)

**Test Run**: 2025-11-09_132454
**Total Runs**: 3
**Overall Score**: 56.50/100
**Latency**: 5.02s avg (min: 4.83s, max: 5.30s)
**Status**: ❌ **Not Recommended**

#### Performance Metrics

| Metric | Average | Min | Max |
|--------|---------|-----|-----|
| Schema Compliance | 83.3% | 80% | 85% |
| Technical Accuracy | 55.0% | N/A | N/A |
| Content Quality | 20.0% | N/A | N/A |
| Overall Score | 56.50 | 50.50 | 59.50 |
| Latency | 5.02s | 4.83s | 5.30s |

**Key Findings**:
- ❌ **Not Recommended** for production use
- Below production threshold (avg 56.5% < 70%)
- Consider higher-quality models
- ⚠️ High average latency: 5.0s (acceptable but not ideal)

---

### google/gemini-2.0-flash-lite-001 (OpenRouter)

**Test Run**: 2025-11-09_145957
**Total Runs**: 30
**Overall Score**: 75.59/100
**Latency**: 1.50s avg (min: 1.13s, max: 2.33s)
**Status**: ⚠️ **Use with Caution**

#### Performance Metrics

| Metric | Average | Min | Max |
|--------|---------|-----|-----|
| Schema Compliance | 94.5% | 90% | 100% |
| Technical Accuracy | 76.6% | N/A | N/A |
| Content Quality | 44.7% | N/A | N/A |
| Overall Score | 75.59 | 63.50 | 89.40 |
| Latency | 1.50s | 1.13s | 2.33s |

**Key Findings**:
- ⚠️ **Use with Caution** in production
- Moderate performance (avg 75.6%)
- May require fallback mechanisms
- ✅ Good latency: 1.5s average

---

### google/gemma-3-12b-it (OpenRouter)

**Test Run**: 2025-11-09_145430
**Total Runs**: 30
**Overall Score**: 74.64/100
**Latency**: 3.59s avg (min: 2.31s, max: 8.99s)
**Status**: ⚠️ **Use with Caution**

#### Performance Metrics

| Metric | Average | Min | Max |
|--------|---------|-----|-----|
| Schema Compliance | 99.5% | 95% | 100% |
| Technical Accuracy | 69.9% | N/A | N/A |
| Content Quality | 49.1% | N/A | N/A |
| Overall Score | 74.64 | 40.00 | 90.70 |
| Latency | 3.59s | 2.31s | 8.99s |

**Key Findings**:
- ⚠️ **Use with Caution** in production
- Moderate performance (avg 74.6%)
- May require fallback mechanisms
- ✅ Good latency: 3.6s average

---

### google/gemma-3-27b-it (OpenRouter)

**Test Run**: 2025-11-09_150606
**Total Runs**: 33
**Overall Score**: 66.45/100
**Latency**: 3.61s avg (min: 0.29s, max: 5.21s)
**Status**: ❌ **Not Recommended**

#### Performance Metrics

| Metric | Average | Min | Max |
|--------|---------|-----|-----|
| Schema Compliance | 87.9% | 0% | 100% |
| Technical Accuracy | 64.8% | N/A | N/A |
| Content Quality | 38.4% | N/A | N/A |
| Overall Score | 66.45 | 0.00 | 88.90 |
| Latency | 3.61s | 0.29s | 5.21s |

**Key Findings**:
- ❌ **Not Recommended** for production use
- Below production threshold (avg 66.5% < 70%)
- Consider higher-quality models
- ✅ Good latency: 3.6s average

---

### google/gemma-3-4b-it (OpenRouter)

**Test Run**: 2025-11-09_143555
**Total Runs**: 33
**Overall Score**: 59.11/100
**Latency**: 7.35s avg (min: 0.17s, max: 63.19s)
**Status**: ❌ **Not Recommended**

#### Performance Metrics

| Metric | Average | Min | Max |
|--------|---------|-----|-----|
| Schema Compliance | 84.2% | 0% | 100% |
| Technical Accuracy | 52.1% | N/A | N/A |
| Content Quality | 39.0% | N/A | N/A |
| Overall Score | 59.11 | 0.00 | 81.90 |
| Latency | 7.35s | 0.17s | 63.19s |

**Key Findings**:
- ❌ **Not Recommended** for production use
- Below production threshold (avg 59.1% < 70%)
- Consider higher-quality models
- ⚠️ Latency concerns: max 63.2s exceeds 10s production threshold

---

### openai/gpt-oss-20b (OpenRouter)

**Test Run**: 2025-11-09_135255
**Total Runs**: 56
**Overall Score**: 37.14/100
**Latency**: 18.77s avg (min: 1.01s, max: 63.18s)
**Status**: ❌ **Not Recommended**

#### Performance Metrics

| Metric | Average | Min | Max |
|--------|---------|-----|-----|
| Schema Compliance | 51.1% | 0% | 100% |
| Technical Accuracy | 35.4% | N/A | N/A |
| Content Quality | 20.5% | N/A | N/A |
| Overall Score | 37.14 | 0.00 | 91.50 |
| Latency | 18.77s | 1.01s | 63.18s |

**Key Findings**:
- ❌ **Not Recommended** for production use
- Below production threshold (avg 37.1% < 70%)
- Consider higher-quality models
- ⚠️ Latency concerns: max 63.2s exceeds 10s production threshold

---

## Testing Status

### ✅ Tested Models (6)

1. **haiku (Claude CLI)**
   - Overall Score: 56.50/100
   - Total Runs: 3
   - Status: ❌ **Not Recommended**

1. **google/gemini-2.0-flash-lite-001 (OpenRouter)**
   - Overall Score: 75.59/100
   - Total Runs: 30
   - Status: ⚠️ **Use with Caution**

1. **google/gemma-3-12b-it (OpenRouter)**
   - Overall Score: 74.64/100
   - Total Runs: 30
   - Status: ⚠️ **Use with Caution**

1. **google/gemma-3-27b-it (OpenRouter)**
   - Overall Score: 66.45/100
   - Total Runs: 33
   - Status: ❌ **Not Recommended**

1. **google/gemma-3-4b-it (OpenRouter)**
   - Overall Score: 59.11/100
   - Total Runs: 33
   - Status: ❌ **Not Recommended**

1. **openai/gpt-oss-20b (OpenRouter)**
   - Overall Score: 37.14/100
   - Total Runs: 56
   - Status: ❌ **Not Recommended**

### ❌ Untested Models

All models listed above with ❌ status have not been benchmarked yet.

---

## Methodology

Benchmarks test LLM topic extraction capability with:
- Real Claude Code conversation transcripts from golden set
- Structured JSON output requirements (8-field schema)
- Multiple runs per transcript for statistical significance
- Scored on: schema compliance (30%), technical accuracy (50%), content quality (20%)

**Evaluation Criteria**:
- ✅ **Recommended**: ≥80% overall score, reliable structured output
- ⚠️ **Use with Caution**: 70-79% overall score, acceptable for non-critical use
- ❌ **Not Recommended**: <70% overall score, below production threshold

**Production Requirements** (from `scripts/benchmark/config.sh`):
- JSON Parse Rate: ≥95%
- Latency (P95): <10s
- Accuracy Score: ≥70%
- Cost per 1K ops: <$1.00
