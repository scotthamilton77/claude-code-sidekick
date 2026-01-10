---
name: writing-unit-tests
description: Use when writing unit tests, reviewing test code, or when asked to add tests to complex/untestable code
---

# Writing Unit Tests

## Overview

Good tests verify behavior, not implementation. Bad tests cement complexity and break on every refactor.

**Core principle:** If you can't test it simply, the code needs refactoring—not more mocks.

**Violating the letter of these rules is violating the spirit of good testing.**

## The Iron Laws

```
1. TEST BEHAVIOR, NOT IMPLEMENTATION
2. REFUSE TO TEST UNTESTABLE CODE—REFACTOR FIRST
3. MOCKS ARE A SMELL, NOT A SOLUTION
```

## When to Push Back

**REFUSE to write tests when:**

- Function has 5+ dependencies requiring mocks
- Function has 10+ conditionals or early returns
- Test setup exceeds 20 lines of mock configuration
- You're testing "did method X get called" instead of "did it produce correct output"

**What to say:**

> "This code isn't testable in its current form. Writing tests would cement the complexity. Let's refactor into smaller units first, then test each unit simply."

**No exceptions:**
- Not for "90% coverage by EOD"
- Not for "tech lead approved it"
- Not for "it's already in production"
- Not for "just add a quick test"

Untestable code + tests = two problems instead of one.

## Behavior vs Implementation

```dot
digraph test_decision {
    "Writing a test assertion" [shape=box];
    "What am I verifying?" [shape=diamond];
    "Output/return value" [shape=box, style=filled, fillcolor="#ccffcc", label="GOOD:\nOutput/return value"];
    "State change" [shape=box, style=filled, fillcolor="#ccffcc", label="GOOD:\nObservable state change"];
    "Method was called" [shape=box, style=filled, fillcolor="#ffcccc", label="BAD:\nMethod X was called"];
    "Internal order" [shape=box, style=filled, fillcolor="#ffcccc", label="BAD:\nInternal execution order"];

    "Writing a test assertion" -> "What am I verifying?";
    "What am I verifying?" -> "Output/return value" [label="result"];
    "What am I verifying?" -> "State change" [label="effect"];
    "What am I verifying?" -> "Method was called" [label="interaction"];
    "What am I verifying?" -> "Internal order" [label="sequence"];
}
```

### Good: Behavior Tests

```typescript
it('returns full name when no nickname', () => {
  const user = { firstName: 'Jane', lastName: 'Doe' };
  expect(formatDisplayName(user)).toBe('Jane Doe');
});

it('returns nickname when present', () => {
  const user = { firstName: 'Jane', lastName: 'Doe', nickname: 'JD' };
  expect(formatDisplayName(user)).toBe('JD');
});
```

Tests actual output. Survives any refactor that preserves behavior.

### Bad: Implementation Tests

```typescript
it('should call validator.validate with card', async () => {
  mockValidator.validate.mockResolvedValue(true);
  await processor.processPayment(100, card);
  expect(mockValidator.validate).toHaveBeenCalledWith(card);
});
```

Tests that code calls a method. Breaks on any internal change. Proves nothing about correctness.

## Test Doubles: Mocks vs Fakes vs Spies

| Type | What It Does | When to Use |
|------|--------------|-------------|
| **Fake** | Simple working implementation | Default choice—database → in-memory map |
| **Stub** | Returns canned responses | External services with predictable responses |
| **Spy** | Records calls to real object | Verifying side effects (analytics, logging) |
| **Mock** | Verifies specific calls | Almost never—last resort |

### Prefer Fakes

```typescript
// GOOD: Fake implementation
const users = new Map<string, User>();
const fakeDb = {
  findById: async (id: string) => users.get(id) ?? null
};

it('returns user display name', async () => {
  users.set('123', { firstName: 'Jane', lastName: 'Doe' });
  const name = await service.getDisplayName('123');
  expect(name).toBe('Jane Doe');
});
```

### Avoid Mock Forests

```typescript
// BAD: Mock everything
let mockDb: jest.Mocked<Database>;
let mockCache: jest.Mocked<CacheService>;
let mockLogger: jest.Mocked<Logger>;
let mockMetrics: jest.Mocked<MetricsService>;

beforeEach(() => {
  mockDb = { users: { findById: jest.fn() } } as any;
  mockCache = { get: jest.fn(), set: jest.fn() } as any;
  mockLogger = { info: jest.fn(), warn: jest.fn() } as any;
  mockMetrics = { track: jest.fn() } as any;
  // 20 lines of setup before any test
});
```

If you need 4+ mocks, the code is too coupled. Refactor it.

## When Mocks ARE Appropriate

1. **External services you don't control** (payment gateways, third-party APIs)
2. **Non-deterministic behavior** (time, random, network)
3. **Expensive operations** (only when fakes aren't feasible)

Even then, prefer integration tests with test accounts over mocks.

## Test Isolation

Each test must:
- Set up its own state
- Not depend on other tests running first
- Not leave state that affects other tests
- Pass when run alone or in any order

```typescript
// BAD: Shared mutable state
let counter = 0;
beforeEach(() => { counter++; });

it('test 1', () => { expect(counter).toBe(1); }); // Passes first
it('test 2', () => { expect(counter).toBe(1); }); // Fails!

// GOOD: Fresh state per test
it('test 1', () => {
  const counter = createCounter();
  counter.increment();
  expect(counter.value).toBe(1);
});
```

## Business Logic vs Incidentals

**Test business logic:**
- Calculation correctness
- Validation rules
- State transitions
- Business rule enforcement

**Don't test incidentals:**
- Logging calls
- Metric tracking
- Cache key formats
- Internal method call order

```typescript
// GOOD: Tests business rule
it('caps commission at 50% of sales', () => {
  const commission = calculateCommission(1000, { rate: 0.8 });
  expect(commission).toBe(500); // Capped, not 800
});

// BAD: Tests logging
it('should log when processing', async () => {
  await processOrder(order);
  expect(mockLogger.info).toHaveBeenCalledWith('Processing order');
});
```

## Refactoring for Testability

When code is untestable, decompose it:

```typescript
// BEFORE: Untestable monolith
async function processOrder(order, db, cache, logger, metrics, notifications) {
  // 200 lines mixing everything
}

// AFTER: Testable units
function validateOrder(order: Order): ValidationResult { /* pure */ }
function calculateTotal(items: Item[], discount: number): number { /* pure */ }
function applyDiscounts(order: Order, rules: DiscountRule[]): Order { /* pure */ }

// Integration just wires them together
async function processOrder(order: Order, deps: OrderDeps): Promise<Result> {
  const validation = validateOrder(order);
  if (!validation.valid) return { error: validation.error };

  const total = calculateTotal(order.items, order.discount);
  // etc.
}
```

Each pure function is trivial to test. Integration test verifies wiring.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Team pattern requires mocking everything" | Bad patterns don't become good through repetition. Push back. |
| "Need 90% coverage by EOD" | Coverage without behavior verification is theater. |
| "Tech lead wrote it, just add tests" | Authority doesn't make untestable code testable. |
| "It's already in production" | Sunk cost. Cementing bad design costs more long-term. |
| "Just a quick test" | Quick bad test = permanent maintenance burden. |
| "Mock tests are team standard" | Standards can be wrong. Demonstrate better alternatives. |
| "Don't have time to refactor" | Time to write mock forest > time to extract pure function. |

## Red Flags - STOP

If you're about to:
- Write `expect(mock.method).toHaveBeenCalledWith(...)` as main assertion
- Create 4+ mocks in beforeEach
- Write 20+ lines of test setup
- Test that internal methods were called in order
- Add tests to code you know is poorly structured
- Follow a "team pattern" that tests implementation

**STOP. Propose refactoring instead.**

## Verification Checklist

Before submitting tests:

- [ ] Tests verify outputs/behavior, not method calls
- [ ] Each test name describes the behavior being verified
- [ ] Tests use fakes over mocks where possible
- [ ] No test depends on another test's execution
- [ ] Setup is under 10 lines per test
- [ ] Would these tests survive an internal refactor?

Can't check all boxes? Refactor the code or the tests.
