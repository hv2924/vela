# Vela

> A small, strongly typed language for programs that handle real-world data.

Vela makes important concepts visible in the type system: money is not just a number, secrets are not ordinary text, collections have explicit shapes, and entities carry their own access rules.

**Make intent clear. Make unsafe behavior difficult. Keep programs readable.**

---

## Quick Start

Create `hello.vela`:

```vela
fn greet(name : text) -> text {
	return "Hello, " + name
}

let name : text = input()
print(greet(name))
```

Compile and run it:

```powershell
npm run vela -- hello.vela
"Vela" | node dist/hello.js
```

The compiler writes generated JavaScript to `dist/<file-name>.js`.

## Program Shape

Vela programs use declarations and statements. Semicolons are optional; line breaks separate tokens.

Supported statements include `let`, `print`, `if` / `else`, `fn`, `return`, `entity`, expression statements, and `import`.

### Variables

```vela
let count : int = 3
let message : text = "ready"
let enabled : bool = true
```

Declared types must agree with their initializers.

### Conditions and Functions

```vela
if count > 0 {
	print("There are items")
} else {
	print("Empty")
}

fn add(left : int, right : int) -> int {
	return left + right
}
```

Functions are first-class values and can be passed to collection operations.

## Types

### Primitive Types

| Type | Meaning |
| --- | --- |
| `text` | Text values |
| `int` | Integer numbers |
| `bool` | `true` or `false` |
| `decimal` | Exact decimal arithmetic |
| `money` | Currency-aware monetary values |
| `email` | Email-shaped values |
| `uuid` | UUID-shaped values |
| `secret` | Sensitive values that cannot be printed or serialized |
| `secret_hash` | Hashes produced from secrets |

### Collection Types

```vela
list[int]
set[text]
map[text, int]
list[list[int]]
```

### Function Types

```vela
(int) -> bool
(text, int) -> decimal
```

## Expressions and Operators

Vela supports arithmetic, comparison, logical, and unary operators:

```text
+  -  *  /  %
==  !=  <  <=  >  >=
&&  ||
!   unary -
```

Expressions include literals, identifiers, calls, member access, entity construction, collection construction, and permission checks.

```vela
let total : int = (2 + 3) * 4
let valid : bool = total >= 10 && total != 0
print(user.name)
```

## Domain Primitives

### Money

Money values preserve their currency during arithmetic:

```vela
let price : money = money(19.99, "USD")
let tax : money = money(2.00, "USD")
let total : money = price + tax
print(moneyText(total))
```

Available currency metadata currently includes `EUR`, `USD`, `GBP`, `JPY`, and `KWD`.

Useful operations include `money`, `moneyText`, `convert`, addition, subtraction, multiplication, and division.

### Decimal

```vela
let rate : decimal = 1.25
let result : decimal = rate / 2
print(decimalText(result))
```

Use `round(value, digits)` for fixed precision.

### Secrets

```vela
let password : secret = input[secret]()
let stored : secret_hash = hash(password)
let valid : bool = verify(password, stored)
print(valid)
```

Secret input is silent in a terminal. Secret values cannot be printed or serialized. `hash` uses a salted password hash, and `verify` checks a secret against a `secret_hash`.

## Collections

```vela
let numbers : list[int] = list(1, 2, 3, 4)
let evens : list[int] = filter(numbers, fn(value : int) -> bool {
	return value % 2 == 0
})
```

Common operations:

- `list(...)`, `set(...)`, and `map(key, value, ...)`
- `get(list, index)`, `append(list, value)`, and `length(list)`
- `contains(collection, value)`
- `filter(list, predicate)`, `map(list, mapper)`, and `reduce(list, initial, reducer)`
- `mapGet`, `mapSet`, and `mapContains`

Callback parameter and return types are checked before compilation.

## Weave Pipelines

`weave` composes collection stages from left to right. It supports `filter`, `map`, and a terminal `find` stage.

```vela
fn isEven(value : int) -> bool {
	return value % 2 == 0
}

fn double(value : int) -> int {
	return value * 2
}

fn greaterThanTen(value : int) -> bool {
	return value > 10
}

let numbers : list[int] = list(1, 2, 3, 4, 5, 6, 7)
let result : int = weave(
	numbers,
	filter(isEven),
	map(double),
	find(greaterThanTen)
)

print(result)
```

`find(...)` must be the final stage. A weave without `find` returns a list. If `find` has no match, execution reports a runtime error.

## Entities and Permissions

Entities describe structured domain values:

```vela
entity User {
	name : text
	age : int = 0
	permission read = owner
}

let user : User = input[User]()
print(user.name)
```

Entities support typed fields, default values, member access, permission metadata, and `can(user, permission, entity)` checks:

```vela
if can(currentUser, "read", user) {
	print(user.name)
}
```

Interactive entity input prompts for each field.

## Typed Input

```vela
let age : int = input[int]()
let tags : list[int] = input[list[int]]()
let scores : map[text, int] = input[map[text, int]]()
```

Input formats:

```text
list[int]        10, 20, 30
set[int]         10, 20, 20
map[text, int]   alice=10, bob=20
list[list[int]]  1, 2
								 3, 4
```

Nested list rows are separated by newlines. In PowerShell:

```powershell
"1, 2`n3, 4" | node dist/hello.js
```

## Modules

Modules are `.vela` files in the same directory. Functions can be exported and imported.

`math.vela`:

```vela
export fn add(left : int, right : int) -> int {
	return left + right
}
```

`main.vela`:

```vela
import add from "math"
print(add(2, 3))
```

The compiler validates that imported functions exist and are exported.

## Compiler Workflow

```text
.vela source → lexer → parser → AST → semantic analysis → JavaScript
```

Compile a program:

```powershell
npm run vela -- path\to\program.vela
```

Run the generated program:

```powershell
node dist\program.js
```

Check the compiler itself:

```powershell
npm run typecheck
```

Vela currently targets JavaScript and uses `Compiler/runtime.ts` for secure values, collection helpers, input, arithmetic, and weave execution.

## Design Promise

- Money carries currency.
- Secrets stay protected.
- Entities carry structure and permissions.
- Collection transformations remain readable.
- Semantic errors appear before generated code runs.

**Write the intent. Let the compiler defend it.**