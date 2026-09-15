import { resolve } from "node:path";
import { Module } from "./ast.js";
import { tokenize } from "./lexer.js";
import { Parser } from "./parser.js";
import {
  readModule,
  resolveModule,
} from "./module-loader.js";

export interface LoadedModule {
  path: string;
  module: Module;
}

export function loadModuleGraph(
  entryPath: string,
): LoadedModule[] {
  const loaded = new Map<string, LoadedModule>();
  const visiting = new Set<string>();

  visit(resolve(entryPath));

  return [...loaded.values()];

  function visit(path: string): void {
    if (loaded.has(path)) {
      return;
    }

    if (visiting.has(path)) {
      throw new Error(
        `Vela: Circular module dependency detected at "${path}".`,
      );
    }

    visiting.add(path);

    const source = readModule(path);
    const parser = new Parser(tokenize(source));
    const moduleName = path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.vela$/, "") ?? "main";

    const module = parser.parseModule(moduleName);

    loaded.set(path, {
      path,
      module,
    });

    for (const importDeclaration of module.imports) {
      const dependency = resolveModule(
        path,
        importDeclaration.module,
      );

      visit(dependency);
    }

    visiting.delete(path);
  }
}