# Test Fixtures

This directory contains test fixtures for validating behavioral parity between Track 1 (Bash) and Track 2 (TypeScript) implementations.

## Test-Driven Validation Strategy

**Core Principle**: Track 1 outputs are the source of truth. Track 2 must produce identical results for identical inputs.

### Workflow

1. **Extract Track 1 behavior** - Run Track 1 Bash scripts with known inputs
2. **Capture outputs** - Save Track 1 responses as JSON fixtures
3. **Write Track 2 tests** - Test against fixtures (expect Track 2 to match)
4. **Implement Track 2** - Write TypeScript code to pass tests
5. **Validate** - Run both implementations on same data, diff outputs

## Fixture Organization

```
test/fixtures/
├── providers/           # LLM provider responses
│   ├── claude/          # Claude API responses
│   ├── openai/          # OpenAI API responses
│   └── openrouter/      # OpenRouter API responses
├── scoring/             # Scoring test cases
│   ├── schema/          # Schema validation inputs/outputs
│   ├── similarity/      # Semantic similarity pairs with known scores
│   ├── technical/       # Technical accuracy test cases
│   └── content/         # Content quality test cases
├── consensus/           # Consensus algorithm test cases
│   ├── string/          # String consensus examples (3-model outputs)
│   ├── numeric/         # Numeric consensus examples
│   ├── boolean/         # Boolean consensus examples
│   └── array/           # Array consensus examples
├── preprocessing/       # Transcript preprocessing examples
│   ├── excerpts/        # Excerpt extraction inputs/outputs
│   └── filtering/       # Message filtering examples
├── json-extraction/     # JSON extraction test cases
│   ├── code-fences/     # ```json ... ``` format
│   ├── markdown/        # Markdown JSON blocks
│   └── raw/             # Raw JSON strings
└── integration/         # End-to-end test cases
    ├── reference-gen/   # Reference generation workflows
    └── benchmark-runs/  # Complete benchmark run outputs
```

## Fixture Format

All fixtures follow a consistent structure:

```json
{
  "description": "Human-readable description of test case",
  "track1_version": "commit hash or date when extracted",
  "input": {
    // Input data that was provided to Track 1
  },
  "expected_output": {
    // Track 1's actual output
  },
  "notes": [
    "Any edge cases or special considerations"
  ]
}
```

### Example: Semantic Similarity Fixture

```json
{
  "description": "Identical strings should return 1.0 similarity",
  "track1_version": "2025-11-09",
  "input": {
    "text1": "Implement user authentication",
    "text2": "Implement user authentication"
  },
  "expected_output": {
    "score": 1.0,
    "skipped_llm_call": true,
    "reason": "identical strings"
  },
  "notes": [
    "Track 1 optimizes identical strings without LLM call",
    "Track 2 must implement same optimization"
  ]
}
```

## Creating Fixtures

### Manual Extraction

For small, targeted test cases:

1. Run Track 1 script with specific input
2. Capture output (stdout, files, etc.)
3. Create JSON fixture with input/output pair
4. Document any special behaviors or edge cases

**Example**:
```bash
cd scripts/benchmark
echo '{"text1":"foo","text2":"bar"}' | ./lib/similarity.sh calculate
# Capture output → create fixture
```

### Automated Extraction

For large-scale extraction (e.g., all scoring test cases):

1. Create helper script in `scripts/extract-fixtures.sh`
2. Run Track 1 on known dataset
3. Parse outputs into fixture JSON files
4. Validate fixtures are representative

**TODO**: Create `scripts/extract-fixtures.sh` to automate this process.

## Using Fixtures in Tests

### Vitest Example

```typescript
import { describe, it, expect } from 'vitest'
import { SemanticSimilarity } from '@/scoring/SemanticSimilarity'
import { loadFixture } from '@/test/utils/fixtures'

describe('SemanticSimilarity', () => {
  it('should match Track 1 behavior for identical strings', async () => {
    const fixture = await loadFixture('scoring/similarity/identical-strings.json')

    const similarity = new SemanticSimilarity(mockProvider)
    const result = await similarity.calculate(
      fixture.input.text1,
      fixture.input.text2
    )

    expect(result.score).toBe(fixture.expected_output.score)
    expect(result.skipped_llm_call).toBe(fixture.expected_output.skipped_llm_call)
  })
})
```

### Fixture Loading Utility

See `test/utils/fixtures.ts` for the `loadFixture()` helper:

```typescript
export async function loadFixture<T = any>(path: string): Promise<Fixture<T>> {
  const fullPath = join(__dirname, '../fixtures', path)
  const content = await readFile(fullPath, 'utf-8')
  return JSON.parse(content)
}
```

## Fixture Quality Guidelines

### Good Fixtures

- **Deterministic**: Same input always produces same output
- **Comprehensive**: Cover happy path + edge cases + error cases
- **Documented**: Clear description and notes
- **Minimal**: Only essential data (no unnecessary fields)
- **Representative**: Reflects real-world usage patterns

### Bad Fixtures

- **Flaky**: Non-deterministic outputs (timestamps, random UUIDs)
- **Incomplete**: Missing edge cases or error scenarios
- **Undocumented**: No explanation of what's being tested
- **Bloated**: Includes irrelevant data
- **Contrived**: Unrealistic inputs that would never occur

## Updating Fixtures

When Track 1 behavior changes (bug fixes, improvements):

1. **Update fixture** - Re-extract from Track 1 with new behavior
2. **Update track1_version** - Document when change occurred
3. **Add notes** - Explain what changed and why
4. **Verify Track 2** - Ensure tests still pass (or update implementation)

## Shared Test Data

**Important**: Fixtures in this directory are for **unit/integration tests** of individual components.

For **end-to-end validation** against real transcripts, use the shared test data:
- `test-data/transcripts/` - 497 real transcripts
- `test-data/golden-set.json` - 15 hand-picked transcripts
- `test-data/references/` - Reference outputs from premium models

See `../../../test-data/README.md` for details on the shared test data structure.

## Coverage Goals

### Phase Coverage Targets

- **Phase 1-3** (Foundation, Infrastructure, Preprocessing): 90%+ coverage
  - Simple, deterministic logic - easy to test thoroughly

- **Phase 4-5** (Scoring, Consensus): 85%+ coverage
  - Some LLM-dependent behavior harder to test deterministically

- **Phase 6-7** (Orchestration, CLI): 80%+ coverage
  - Integration/E2E tests supplement unit test gaps

- **Phase 8** (Circuit Breaker): 95%+ coverage
  - State machine logic - must be exhaustively tested

- **Phase 9** (Validation): N/A (tests themselves)

### Fixture Requirements per Component

Each component should have fixtures covering:

1. **Happy path** - Standard, expected behavior
2. **Edge cases** - Boundary conditions, empty inputs, etc.
3. **Error cases** - Invalid inputs, API failures, timeouts
4. **Track 1 regressions** - Known bugs/fixes from Track 1 history

**Example** - Schema Validator fixtures:
- ✅ Valid JSON with all required fields
- ✅ Valid JSON missing optional fields
- ✅ Invalid JSON (parse error)
- ✅ Valid JSON with wrong types
- ✅ Valid JSON with out-of-range values
- ✅ Empty object
- ✅ Null/undefined inputs

## Fixture Versioning

When Track 1 makes breaking changes (schema updates, algorithm changes):

1. **Create versioned directory** - `scoring/v1/`, `scoring/v2/`, etc.
2. **Keep old fixtures** - For regression testing
3. **Document migration** - Explain what changed between versions
4. **Update tests** - Point to latest version

**Example**:
```
scoring/
├── v1/                  # Original schema
│   └── schema-valid.json
├── v2/                  # After adding new field
│   └── schema-valid.json
└── latest -> v2/        # Symlink to current version
```

## Contribution Guidelines

When adding new fixtures:

1. **Follow naming convention** - `{component}-{scenario}-{variant}.json`
   - `schema-valid-all-fields.json`
   - `similarity-identical-strings.json`
   - `consensus-string-three-models.json`

2. **Include metadata** - description, track1_version, notes

3. **Validate against Track 1** - Run fixture input through Track 1, verify output matches

4. **Add test case** - Don't create orphan fixtures (always have corresponding test)

5. **Document edge cases** - Explain any non-obvious behaviors

## Questions?

See:
- `ROADMAP.md` - Component-level migration plan
- `docs/benchmark-migration.md` - Track 1 → Track 2 requirement sync log
- `CLAUDE.md` - Architecture and development guidance
