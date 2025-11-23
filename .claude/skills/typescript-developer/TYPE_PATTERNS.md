# Advanced TypeScript Type Patterns

## Table of Contents

- [Discriminated Unions](#discriminated-unions)
- [Type Guards](#type-guards)
- [Generics](#generics)
- [Utility Types](#utility-types)
- [Mapped Types](#mapped-types)
- [Conditional Types](#conditional-types)
- [Template Literal Types](#template-literal-types)
- [Branded Types](#branded-types)

---

## Discriminated Unions

### Purpose

Type-safe state machines and exhaustive pattern matching.

### When to Use

- Modeling mutually exclusive states (loading, success, error)
- API response types (success/failure)
- State machines with distinct states
- Eliminating invalid states

### Key Pattern

Use literal type as discriminant property:
- `type: 'success'` vs `type: 'error'`
- `status: 'idle' | 'loading' | 'complete'`

### Benefits

- Exhaustive switch checks (never type)
- TypeScript narrows union based on discriminant
- Impossible states made impossible

---

## Type Guards

### Purpose

Runtime type checking with compile-time type narrowing.

### Types of Guards

| Guard | Use Case | Syntax |
|-------|----------|--------|
| `typeof` | Primitives | `typeof value === 'string'` |
| `instanceof` | Classes | `value instanceof Date` |
| `in` | Property existence | `'prop' in obj` |
| Custom predicate | Complex types | `function isT(val): val is T` |
| Assertion | Throws if false | `function assert(cond): asserts cond` |

### When to Use

- Narrowing union types
- Handling `unknown` values
- Filtering arrays by type
- Validating external data

### Best Practices

- Use type predicates (`is`) for reusable guards
- Use assertion functions for preconditions
- Prefer narrowing over type assertions

---

## Generics

### Purpose

Write reusable, type-safe code without sacrificing type information.

### When to Use

- Functions/classes that work with multiple types
- Data structures (arrays, maps, sets)
- Utility functions (identity, map, filter)
- API wrappers needing type preservation

### Generic Constraints

Use `extends` to enforce capabilities:
- `T extends HasId` - Must have id property
- `T extends string | number` - Must be primitive
- `T extends (...args: any[]) => any` - Must be function

### Common Patterns

- **Multiple type parameters:** `<T, U>` for transformations
- **Default type parameters:** `<T = unknown>` for flexibility
- **Constraint with keyof:** `<K extends keyof T>` for property access

### Avoid Over-Generalization

Don't use generics for single-use types. Generic adds complexity—ensure it adds value.

---

## Utility Types

### Built-In Utilities

| Type | Purpose | Example |
|------|---------|---------|
| `Partial<T>` | All properties optional | Update DTOs |
| `Required<T>` | All properties required | Validated data |
| `Pick<T, K>` | Select properties | Public API types |
| `Omit<T, K>` | Exclude properties | Remove sensitive fields |
| `Record<K, T>` | Key-value map | Dictionary types |
| `Readonly<T>` | Immutable | Configuration objects |
| `ReturnType<T>` | Extract return type | Type from function |
| `Parameters<T>` | Extract params | Type from function args |
| `Exclude<T, U>` | Remove from union | Filter union types |
| `Extract<T, U>` | Keep only matching | Select from union |
| `NonNullable<T>` | Remove null/undefined | Required values |

### When to Use

- Deriving types from existing types
- Transforming API types for internal use
- Creating type-safe configurations
- Avoiding type duplication

---

## Mapped Types

### Purpose

Transform each property in a type systematically.

### Common Patterns

**Add/remove modifiers:**
- Add readonly: `{ readonly [P in keyof T]: T[P] }`
- Remove readonly: `{ -readonly [P in keyof T]: T[P] }`
- Add optional: `{ [P in keyof T]?: T[P] }`
- Remove optional: `{ [P in keyof T]-?: T[P] }`

**Key remapping:**
- Prefix keys: `{ [P in keyof T as `prefix_${string & P}`]: T[P] }`
- Filter keys: `{ [K in keyof T as Exclude<K, 'excluded'>]: T[K] }`

### When to Use

- Creating variations of existing types
- Implementing deep readonly/partial
- Transforming object shapes
- Creating type-safe builders

---

## Conditional Types

### Purpose

Types that depend on conditions, enabling type-level logic.

### Syntax

`T extends U ? X : Y`

### Common Patterns

**Unwrapping types:**
- `T extends Promise<infer U> ? U : T` - Extract promise value
- `T extends Array<infer E> ? E : never` - Extract array element
- `T extends (...args: any[]) => infer R ? R : never` - Extract return type

**Distributive conditionals:**
- Automatically distribute over unions
- `ToArray<string | number>` = `string[] | number[]`

### When to Use

- Extracting types from complex generics
- Creating type transformations
- Building advanced utility types
- Type-level pattern matching

### Infer Keyword

Use `infer` to extract types within conditional:
- Extract promise value, array element, function return
- Powerful for library type utilities

---

## Template Literal Types

### Purpose

Create string literal types with patterns, enabling type-safe string manipulation.

### Built-In Utilities

- `Uppercase<S>` - 'hello' → 'HELLO'
- `Lowercase<S>` - 'HELLO' → 'hello'
- `Capitalize<S>` - 'hello' → 'Hello'
- `Uncapitalize<S>` - 'Hello' → 'hello'

### When to Use

- Event name generation (`onClick`, `onHover`)
- API method generation (`getUser`, `createUser`)
- CSS class name patterns
- Type-safe route parameters

### Common Patterns

**Event handlers:**
```typescript
type EventName<T extends string> = `on${Capitalize<T>}`;
// 'click' → 'onClick'
```

**Route parsing:**
Extract parameter names from route strings

### Limitations

- Can become verbose quickly
- Limited string manipulation operations
- Compile-time only

---

## Branded Types

### Purpose

Create distinct types from primitives for type safety at compile time.

### Pattern

```typescript
type Brand<K, T> = K & { __brand: T };
type UserId = Brand<string, 'UserId'>;
type ProductId = Brand<string, 'ProductId'>;
```

### When to Use

- Distinguishing IDs (UserId vs ProductId)
- Validated primitives (Email, URL, PositiveNumber)
- Units (Meters vs Feet)
- Preventing primitive obsession

### Factory Pattern

Create branded values through validation functions:
```typescript
function createUserId(id: string): UserId {
  if (!isValidUUID(id)) throw new Error();
  return id as UserId;
}
```

### Benefits

- Prevents mixing incompatible values
- Self-documenting code
- Compile-time safety for runtime concepts
- Zero runtime overhead

### Limitations

- Requires casting (runtime is still primitive)
- No runtime validation without factories
- Can be verbose

---

## Pattern Selection Guide

| Need | Pattern |
|------|---------|
| **Mutually exclusive states** | Discriminated Unions |
| **Runtime type checking** | Type Guards |
| **Reusable with different types** | Generics |
| **Transform existing type** | Utility Types, Mapped Types |
| **Type depends on condition** | Conditional Types |
| **String pattern types** | Template Literal Types |
| **Distinct primitive types** | Branded Types |

---

**Back to:** [TypeScript Developer Skill](SKILL.md)
