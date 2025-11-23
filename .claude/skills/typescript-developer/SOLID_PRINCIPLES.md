# SOLID Principles in TypeScript

## Table of Contents

- [Overview](#overview)
- [Single Responsibility Principle](#single-responsibility-principle-srp)
- [Open/Closed Principle](#openclosed-principle-ocp)
- [Liskov Substitution Principle](#liskov-substitution-principle-lsp)
- [Interface Segregation Principle](#interface-segregation-principle-isp)
- [Dependency Inversion Principle](#dependency-inversion-principle-dip)
- [Refactoring Strategies](#refactoring-strategies)

---

## Overview

| Principle | Core Rule | Key Benefit |
|-----------|-----------|-------------|
| **S**ingle Responsibility | One class, one reason to change | Easier modification |
| **O**pen/Closed | Open for extension, closed for modification | Add features without breaking |
| **L**iskov Substitution | Subtypes substitutable for base types | Reliable polymorphism |
| **I**nterface Segregation | Many small interfaces > one fat interface | Clients don't depend on unused methods |
| **D**ependency Inversion | Depend on abstractions, not concretions | Flexible, testable |

---

## Single Responsibility Principle (SRP)

### Definition

**One class, one reason to change.** Each class should have exactly one well-defined responsibility.

### Red Flags

- Class name contains "and" or "or" (UserManagerAndValidator)
- Class has methods for multiple concerns (data persistence, validation, email, logging)
- Changes in one area force modification of unrelated code
- Difficult to describe class purpose in one sentence

### Refactoring Strategy

**Extract responsibilities into separate classes:**
- UserRepository → data persistence only
- UserValidator → validation only
- EmailService → email operations only
- ActivityLogger → logging only
- UserService → orchestrates the above

### TypeScript Pattern

Use dependency injection to compose single-responsibility classes:

```typescript
class UserService {
  constructor(
    private repository: UserRepository,
    private validator: UserValidator,
    private emailService: EmailService,
    private logger: ActivityLogger
  ) {}
}
```

---

## Open/Closed Principle (OCP)

### Definition

**Open for extension, closed for modification.** Add new functionality without changing existing code.

### Red Flags

- if/else chains or switch statements on type checking
- Adding new behavior requires modifying existing classes
- New features touch multiple existing files
- Type-checking strings instead of using polymorphism

### Refactoring Strategy

**Replace conditionals with polymorphism:**
- Define interface for behavior
- Create implementations for each case
- Use dependency injection to select implementation
- Add new cases by creating new classes, not modifying existing

### TypeScript Patterns

- **Strategy Pattern:** Different algorithms via interface
- **Template Method:** Override specific steps
- **Composition:** Combine behaviors via interfaces

---

## Liskov Substitution Principle (LSP)

### Definition

**Subtypes must be substitutable for their base types** without altering correctness. Derived classes must honor base class contracts.

### Red Flags

- Derived class throws errors in overridden methods
- Derived class strengthens preconditions (requires more than base)
- Derived class weakens postconditions (guarantees less than base)
- Derived class changes behavior unexpectedly (Square/Rectangle problem)
- Type checking before using polymorphic object

### Refactoring Strategy

**Fix by composition over inheritance:**
- Don't inherit if "is-a" relationship doesn't hold semantically
- Use interfaces for shared behavior
- Prefer composition and delegation
- Split interfaces by capability (Bird vs FlyingBird)

### Common Violations

- Square extending Rectangle (setWidth affects height)
- Penguin implementing Bird.fly() (throws error)
- ReadOnlyList extending List (mutation methods throw)

---

## Interface Segregation Principle (ISP)

### Definition

**Clients should not depend on interfaces they don't use.** Many small, focused interfaces > one large interface.

### Red Flags

- Interface with methods irrelevant to some implementations
- Implementations throwing "not supported" errors
- Implementations with empty method bodies
- Forced to implement methods that don't make sense for the class

### Refactoring Strategy

**Split fat interfaces:**
- Identify method groups by responsibility
- Create separate interfaces for each group
- Classes implement only needed interfaces
- Use intersection types when multiple interfaces needed

### TypeScript Pattern

```typescript
// Split into focused interfaces
interface Readable<T> { read(id: string): Promise<T>; }
interface Writable<T> { write(data: T): Promise<void>; }
interface Queryable<T> { query(filter: Filter): Promise<T[]>; }

// Implement only what's needed
class Cache<T> implements Readable<T>, Writable<T> { }
class Database<T> implements Readable<T>, Writable<T>, Queryable<T> { }
```

---

## Dependency Inversion Principle (DIP)

### Definition

**Depend on abstractions, not concretions.** High-level modules shouldn't depend on low-level modules. Both should depend on abstractions.

### Red Flags

- Direct instantiation with `new` in business logic
- Importing concrete implementation classes
- Hard-coded dependencies (new MySQLDatabase())
- Difficult to test due to concrete dependencies
- Can't swap implementations

### Refactoring Strategy

**Invert dependencies:**
1. Define interface for dependency
2. Constructor accepts interface, not concrete class
3. Inject implementation at composition root
4. High-level and low-level both depend on interface

### Benefits

- **Testability:** Mock interfaces in tests
- **Flexibility:** Swap implementations easily
- **Decoupling:** Modules independent
- **Reusability:** High-level logic reusable

### TypeScript Pattern

```typescript
// Define abstraction
interface Database {
  query<T>(...): Promise<T>;
}

// Depend on abstraction
class UserService {
  constructor(private db: Database) {}  // Not: new MySQLDatabase()
}

// Inject at composition root
const db = new PostgresDatabase();  // Or MySQLDatabase, or MockDatabase
const service = new UserService(db);
```

---

## Refactoring Strategies

### Identifying Violations

**Ask these questions:**

1. **SRP:** Can I describe this class purpose in one sentence without "and"?
2. **OCP:** Would adding new behavior require modifying this class?
3. **LSP:** Can I replace base type with derived without code breaking?
4. **ISP:** Does every implementer need every method in this interface?
5. **DIP:** Am I directly instantiating dependencies with `new`?

### Refactoring Priorities

1. **Start with DIP:** Makes testing easier immediately
2. **Then SRP:** Breaks god objects into manageable pieces
3. **Then OCP:** Removes conditional complexity
4. **LSP and ISP:** Address as violations discovered

### Testing SOLID Code

SOLID code is inherently testable:
- **SRP:** Small classes, focused tests
- **OCP:** Test new behavior without changing existing tests
- **LSP:** Same tests work for base and derived types
- **ISP:** Mock only methods under test
- **DIP:** Inject mocks easily

### Metrics to Track

- **Class size:** <200 lines suggests SRP
- **Cyclomatic complexity:** <10 suggests OCP
- **Method count:** <10 suggests SRP/ISP
- **Dependencies:** <5 suggests good architecture

### Progressive Refactoring

**Don't refactor everything at once:**
1. Identify highest-pain violation
2. Refactor one principle at a time
3. Ensure tests pass between refactorings
4. Document why changes were made
5. Review with team

---

**Back to:** [TypeScript Developer Skill](SKILL.md)
