# 📋 Changelog

All notable changes to the Vela programming language will be documented in this file. This project adheres to standard semantic versioning practices.

---

## 🚀 — Initial Public Release
*Released on September 14, 2026*

Vela's historic first public iteration, introducing domain-driven types, compiler-directed data pipelines, and language-level security semantics.

### 🧠 Language & Core Architecture
* **Domain-Driven Types:** Native, first-class semantic handling for `email`, `uuid`, `secret`, `secret_hash`, `money`, and `decimal`.
* **Structural Declarations:** Solid support for robust entity definitions and structured function declarations.
* **Functional Paradigms:** First-class functions, recursive collection type tracking, and strongly typed function invocations.

### 🛡️ Security & Privacy Semantics
* **Leak-Proof Secrets:** Built-in safeguards preventing `secret` values from being accidentally printed to logs or serialized.
* **Native Cryptography:** Out-of-the-box password hashing and secure verification utilities.
* **Access Control:** Native permission declarations scoped directly inside entity models.

### 🪢 Collections & Data Pipelines
* **Generic Structures:** Type-safe implementations of `list[T]`, `set[T]`, and `map[K,V]`.
* **Functional Operations:** Native support for standard data transformations via `filter`, `map`, and `reduce`.
* **Weave Pipelines:** Advanced, compiler-optimized `weave()` pipelines built for readability and operational efficiency.

### 📥 Type-Safe Ingestion
* **Secure Inputs:** Silent console input streams tailored specifically for passwords and tokens (`input[secret]()`).
* **Complex Data Ingestion:** Automated runtime validation for nested collections and schema-driven entity inputs.

### ⚙️ Target Runtime
* **Compilation Pipeline:** Stable emitter targeting modern, pure JavaScript.
* **Exact Mathematics:** Custom minor-unit decimal arithmetic engine to prevent floating-point errors.
* **Financial Metadata:** Native runtime handling for currency constraints and explicit cross-currency conversions.
