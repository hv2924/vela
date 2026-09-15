import { SourceLocation } from "./ast.js";

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  location?: SourceLocation;
}

export class DiagnosticBag {
  private readonly diagnostics: Diagnostic[] = [];

  add(
    code: string,
    message: string,
    severity: DiagnosticSeverity = "error",
    location?: SourceLocation,
  ): void {
    this.diagnostics.push({
      severity,
      code,
      message,
      ...(location === undefined ? {} : { location }),
    });
  }

  get all(): readonly Diagnostic[] {
    return this.diagnostics;
  }

  get hasErrors(): boolean {
    return this.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    );
  }

  get size(): number {
    return this.diagnostics.length;
  }
}