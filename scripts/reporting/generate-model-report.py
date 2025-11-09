#!/usr/bin/env python3
"""
Generate LLM model benchmark report from actual test results.

Scans test-data/results/ directory and dynamically generates markdown report
from real benchmark data files.
"""
import re
import json
from datetime import datetime, UTC
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Any

# Paths
PROJECT_ROOT = Path(__file__).parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "src/sidekick/config.defaults"
RESULTS_DIR = PROJECT_ROOT / "test-data/results"
REPORT_PATH = PROJECT_ROOT / "docs/model-analysis-report.md"


def parse_config_models() -> Dict[str, List[Dict[str, Any]]]:
    """Parse model configurations from config.defaults."""
    config_text = CONFIG_PATH.read_text()

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

    return {
        'claude': claude_models,
        'openai': openai_models,
        'openrouter': openrouter_models
    }


def scan_benchmark_results() -> Dict[str, Dict[str, Any]]:
    """Scan test-data/results and extract benchmark metrics for all models."""
    if not RESULTS_DIR.exists():
        return {}

    model_results = defaultdict(lambda: {
        'runs': [],
        'latest_run_dir': None,
        'total_runs': 0
    })

    # Scan all result directories (sorted by timestamp, newest first)
    result_dirs = sorted(RESULTS_DIR.glob("*"), reverse=True)

    for result_dir in result_dirs:
        if not result_dir.is_dir():
            continue

        raw_dir = result_dir / "raw"
        if not raw_dir.exists():
            continue

        # Find all model directories
        for model_dir in raw_dir.iterdir():
            if not model_dir.is_dir():
                continue

            model_name = model_dir.name

            # Track latest run directory for this model
            if model_results[model_name]['latest_run_dir'] is None:
                model_results[model_name]['latest_run_dir'] = result_dir.name

            # Parse all score files and corresponding timing files
            for score_file in model_dir.glob("*/run_*_scores.json"):
                try:
                    with open(score_file) as f:
                        score_data = json.load(f)

                        # Try to read corresponding timing file
                        timing_file = score_file.parent / score_file.name.replace('_scores.json', '_timing.txt')
                        latency_ms = None
                        if timing_file.exists():
                            try:
                                latency_ms = int(timing_file.read_text().strip())
                                score_data['latency_ms'] = latency_ms
                            except (ValueError, OSError):
                                pass

                        model_results[model_name]['runs'].append(score_data)
                        model_results[model_name]['total_runs'] += 1
                except (json.JSONDecodeError, FileNotFoundError):
                    continue

    return dict(model_results)


def calculate_aggregate_metrics(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Calculate aggregate metrics from multiple runs."""
    if not runs:
        return {}

    schema_scores = [r['schema_compliance']['score'] for r in runs]
    accuracy_scores = [r['technical_accuracy']['score'] for r in runs]
    quality_scores = [r['content_quality']['score'] for r in runs]
    overall_scores = [r['overall_score'] for r in runs]

    # Extract latency data where available
    latencies = [r['latency_ms'] for r in runs if 'latency_ms' in r and r['latency_ms'] is not None]

    metrics = {
        'schema_avg': sum(schema_scores) / len(schema_scores),
        'accuracy_avg': sum(accuracy_scores) / len(accuracy_scores),
        'quality_avg': sum(quality_scores) / len(quality_scores),
        'overall_avg': sum(overall_scores) / len(overall_scores),
        'schema_min': min(schema_scores),
        'schema_max': max(schema_scores),
        'overall_min': min(overall_scores),
        'overall_max': max(overall_scores),
        'count': len(runs)
    }

    # Add latency metrics if available
    if latencies:
        metrics['latency_avg_ms'] = sum(latencies) / len(latencies)
        metrics['latency_min_ms'] = min(latencies)
        metrics['latency_max_ms'] = max(latencies)
        metrics['latency_count'] = len(latencies)

    return metrics


def normalize_model_name(dir_name: str) -> str:
    """Convert directory name to human-readable model name.

    Example: openrouter_openai_gpt-oss-20b -> openai/gpt-oss-20b (OpenRouter)
    """
    parts = dir_name.split('_', 1)
    if len(parts) == 2:
        provider, model = parts
        if provider == 'openrouter':
            # Convert underscores to slashes for OpenRouter models
            model = model.replace('_', '/', 1)
            return f"{model} (OpenRouter)"
        elif provider == 'openai-api':
            return f"{model} (OpenAI API)"
        elif provider == 'claude-cli':
            return f"{model} (Claude CLI)"
    return dir_name


def determine_recommendation(metrics: Dict[str, Any]) -> tuple[str, str]:
    """Determine recommendation status and emoji based on metrics."""
    if not metrics:
        return "❌", "Not Tested"

    overall_avg = metrics.get('overall_avg', 0)

    if overall_avg >= 80:
        return "✅", "Recommended"
    elif overall_avg >= 70:
        return "⚠️", "Use with Caution"
    else:
        return "❌", "Not Recommended"


def generate_report():
    """Generate the full benchmark report."""
    # Parse config
    config_models = parse_config_models()

    # Scan results
    benchmark_results = scan_benchmark_results()

    # Determine which models have been tested
    tested_models = set()
    for model_dir_name in benchmark_results.keys():
        # Extract base model name from directory name
        if '_' in model_dir_name:
            tested_models.add(model_dir_name.split('_', 1)[1].replace('_', '/'))

    total_models = (len(config_models['claude']) +
                    len(config_models['openai']) +
                    len(config_models['openrouter']))

    # Generate report header
    report = f"""# LLM Model Analysis Report

**Last Updated**: {datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S UTC')}

This report tracks all LLM models configured in Sidekick and their benchmark performance data.

## Summary

- **Total Models Configured**: {total_models}
  - Claude CLI: {len(config_models['claude'])}
  - OpenAI API: {len(config_models['openai'])}
  - OpenRouter: {len(config_models['openrouter'])}
- **Models Tested**: {len(tested_models)}
- **Models Untested**: {total_models - len(tested_models)}

---

## Claude CLI Models

| Model | Input Cost | Output Cost | Status |
|-------|------------|-------------|--------|
"""

    # Claude models table
    for model in config_models['claude']:
        model_key = model['model']
        status = "✅ Tested" if model_key in tested_models else "❌ Not Tested"
        report += f"| {model['model']} ({model['version']}) | ${model['input_cost']}/M | ${model['output_cost']}/M | {status} |\n"

    # OpenAI models table
    report += """
---

## OpenAI API Models

| Model | Input Cost | Output Cost | Status |
|-------|------------|-------------|--------|
"""

    for model in config_models['openai']:
        status = "✅ Tested" if model['model'] in tested_models else "❌ Not Tested"
        report += f"| {model['model']} | ${model['input_cost']}/M | ${model['output_cost']}/M | {status} |\n"

    # OpenRouter models table
    report += """
---

## OpenRouter Models

| Model | Input Cost | Output Cost | Context | Notes | Status |
|-------|------------|-------------|---------|-------|--------|
"""

    for model in config_models['openrouter']:
        status = "✅ Tested" if model['model'] in tested_models else "❌ Not Tested"
        notes = model.get('notes', '')
        report += f"| {model['model']} | ${model['input_cost']}/M | ${model['output_cost']}/M | {model['context']} | {notes} | {status} |\n"

    # Benchmark results section
    report += """
---

## Benchmark Results

"""

    if not benchmark_results:
        report += "*No benchmark results available. Run benchmarks with `./scripts/benchmark/run-benchmark.sh`*\n"
    else:
        # Generate detailed results for each tested model
        for model_dir_name, data in sorted(benchmark_results.items()):
            if data['total_runs'] == 0:
                continue

            model_display_name = normalize_model_name(model_dir_name)
            metrics = calculate_aggregate_metrics(data['runs'])
            emoji, recommendation = determine_recommendation(metrics)

            # Format latency data if available
            latency_info = ""
            if 'latency_avg_ms' in metrics:
                avg_sec = metrics['latency_avg_ms'] / 1000
                min_sec = metrics['latency_min_ms'] / 1000
                max_sec = metrics['latency_max_ms'] / 1000
                latency_info = f"\n**Latency**: {avg_sec:.2f}s avg (min: {min_sec:.2f}s, max: {max_sec:.2f}s)"

            report += f"""### {model_display_name}

**Test Run**: {data['latest_run_dir']}
**Total Runs**: {metrics['count']}
**Overall Score**: {metrics['overall_avg']:.2f}/100{latency_info}
**Status**: {emoji} **{recommendation}**

#### Performance Metrics

| Metric | Average | Min | Max |
|--------|---------|-----|-----|
| Schema Compliance | {metrics['schema_avg']:.1f}% | {metrics['schema_min']:.0f}% | {metrics['schema_max']:.0f}% |
| Technical Accuracy | {metrics['accuracy_avg']:.1f}% | N/A | N/A |
| Content Quality | {metrics['quality_avg']:.1f}% | N/A | N/A |
| Overall Score | {metrics['overall_avg']:.2f} | {metrics['overall_min']:.2f} | {metrics['overall_max']:.2f} |"""

            # Add latency row to table if available
            if 'latency_avg_ms' in metrics:
                avg_sec = metrics['latency_avg_ms'] / 1000
                min_sec = metrics['latency_min_ms'] / 1000
                max_sec = metrics['latency_max_ms'] / 1000
                report += f"""
| Latency | {avg_sec:.2f}s | {min_sec:.2f}s | {max_sec:.2f}s |"""

            report += "\n\n**Key Findings**:\n"

            # Add recommendation details
            if metrics['overall_avg'] >= 80:
                report += "- ✅ **Recommended** for production use\n"
                report += f"- Consistently high performance (avg {metrics['overall_avg']:.1f}%)\n"
                report += f"- Schema compliance: {metrics['schema_avg']:.1f}%\n"
            elif metrics['overall_avg'] >= 70:
                report += "- ⚠️ **Use with Caution** in production\n"
                report += f"- Moderate performance (avg {metrics['overall_avg']:.1f}%)\n"
                report += f"- May require fallback mechanisms\n"
            else:
                report += "- ❌ **Not Recommended** for production use\n"
                report += f"- Below production threshold (avg {metrics['overall_avg']:.1f}% < 70%)\n"
                report += f"- Consider higher-quality models\n"

            # Add latency assessment
            if 'latency_avg_ms' in metrics:
                avg_sec = metrics['latency_avg_ms'] / 1000
                max_sec = metrics['latency_max_ms'] / 1000
                if max_sec > 10:
                    report += f"- ⚠️ Latency concerns: max {max_sec:.1f}s exceeds 10s production threshold\n"
                elif avg_sec > 5:
                    report += f"- ⚠️ High average latency: {avg_sec:.1f}s (acceptable but not ideal)\n"
                else:
                    report += f"- ✅ Good latency: {avg_sec:.1f}s average\n"

            report += "\n---\n\n"

    # Testing status summary
    report += """## Testing Status

"""

    if tested_models:
        report += f"### ✅ Tested Models ({len(tested_models)})\n\n"
        for model_dir_name, data in sorted(benchmark_results.items()):
            if data['total_runs'] == 0:
                continue
            metrics = calculate_aggregate_metrics(data['runs'])
            emoji, recommendation = determine_recommendation(metrics)
            model_display_name = normalize_model_name(model_dir_name)
            report += f"1. **{model_display_name}**\n"
            report += f"   - Overall Score: {metrics['overall_avg']:.2f}/100\n"
            report += f"   - Total Runs: {metrics['count']}\n"
            report += f"   - Status: {emoji} **{recommendation}**\n\n"

    report += "### ❌ Untested Models\n\n"
    report += "All models listed above with ❌ status have not been benchmarked yet.\n"

    # Methodology section
    report += """
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
"""

    # Write report
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(report)

    print(f"✅ Report generated: {REPORT_PATH}")
    print(f"   Total models: {total_models}")
    print(f"   Tested: {len(tested_models)}, Untested: {total_models - len(tested_models)}")
    if benchmark_results:
        print(f"   Benchmark runs processed: {sum(d['total_runs'] for d in benchmark_results.values())}")


if __name__ == '__main__':
    generate_report()
