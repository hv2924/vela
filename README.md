# ⛵ Vela

### **Vela 0.0.1 — First Public Iteration**

> ⚠️ **Experimental & Evolving:** The language and compiler are subject to change between early releases. 

Vela is a **strongly typed programming language** explicitly designed for software that handles real-world data. It puts meaning where it belongs: directly into the language semantics. 

Money carries its currency. Secrets stay protected. Entities describe their own structure and permissions. Data collection pipelines remain readable from the first stage to the last.

**Make intent clear. Make unsafe behavior difficult. Keep programs readable.**

---

## ✨ Features At A Glance

* **Semantic Type Checking:** Strong validation occurs entirely before code generation.
* **Domain-Driven Types:** First-class language support for `money`, `decimal`, `secret`, `email`, and `uuid`.
* **Structured Typing:** Robust type validation for lists, matrices, sets, maps, and entities.
* **Granular Permissions:** Entities feature native fields, defaults, member access controls, and security permissions.
* **Modern Functional Paradigms:** First-class functions and generic collections out of the box.
* **Streamlined Data Pipelines:** Read-optimized `weave()` pipelines featuring `filter`, `map`, and terminal `find` operations.
* **Lightweight Target:** Outputs clean JavaScript backed by a highly focused, performance-oriented runtime.

---

## 🚀 Getting Started

### First Program
Create a file named `hello.vela`:

```vela
fn greet(name : text) -> text {
    return "Hello, " + name
}

let name : text = input()
print(greet(name))
```

### Compile & Run
Execute the following commands in your terminal to build and execute your first program:

```powershell
# Install dependencies
npm install

# Compile the Vela file
npm run vela -- hello.vela

# Run the generated JavaScript output
"Vela" | node dist/hello.js
```

**Output:**
```text
Hello, Vela
```

---

## 📦 Installation & Setup

### From Source
Clone the repository and install the development environment locally:

```powershell
git clone <repository-url>
cd Vela-Programming-Language
npm install
```

### Development Utilities
Verify compiler integrity and type safety during development:

```powershell
# Run the internal TypeScript typechecker
npm run typecheck

# Compile any local Vela source file
npm run vela -- path\to\program.vela
node dist\program.js
```

---

## 💡 Why Vela?

Vela is built on the philosophy that a compiler should deeply understand the **meaning** of a program, not just its syntax.

Instead of generalizing real-world information into generic strings, numbers, and objects, Vela assigns precise semantic domain types to critical concepts. This allows the compiler to actively reject invalid cross-domain operations, enforce secure runtime paradigms, and automatically optimize complex workflows—all without forcing the developer to manage low-level boilerplate.

### 0.0.1 Highlights
* Exact minor-unit money arithmetic with explicit currency conversion rules.
* Secure, leak-proof secret hashing and verification utilities.
* Compiler-directed `weave()` pipelines featuring operation fusion and early termination.

---

## 🛠️ A Taste of the Type System

### 1. Safe Secrets
Secret inputs are entirely silent. Secret values are protected at the language level and cannot be printed or serialized:

```vela
let password : secret = input[secret]()
let stored : secret_hash = hash(password)

# Safely verifies credentials without exposing raw data
print(verify(password, stored))
```

### 2. Readable Data Pipelines
Clean, composable transformation workflows without performance penalties:

```vela
fn even(value : int) -> bool {
    return value % 2 == 0
}

fn double(value : int) -> int {
    return value * 2
}

let result : list[int] = weave(
    list(1, 2, 3, 4),
    filter(even),
    map(double)
)

print(result)
```

---

## 🏗️ Under the Hood

The compilation architecture follows a strict, predictable pipeline:

```text
Source Code ──> Lexer ──> Parser ──> AST ──> Semantic Analysis ──> JavaScript
```

The compiler currently targets modern JavaScript environments and is built using **TypeScript** running on **Node.js**.

---

## 📖 Documentation

For an exhaustive breakdown of the language syntax, standard library, and design paradigms, please review the full language reference in [SPEC.md](SPEC.md). The specification covers:

* Syntax rules and core language operators
* Primitive values and structured collection types
* Safe money and high-precision decimal arithmetic
* Native entity permissions and access scopes
* Compiler-level `weave()` pipeline optimization semantics

---

## ⚖️ Project Status & License

* **Status:** Actively evolving. Contributions, issues, and feature discussions are welcome.
* **License:** Distributed under the **MIT License**. See `LICENSE` for more information.
