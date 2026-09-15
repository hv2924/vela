import {
  FunctionDeclaration,
  Module,
  TypeName,
} from "./ast.js";

export interface ImportedFunction {
  name: string;
  module: string;
  parameters: TypeName[];
  returnType: TypeName;
}

export interface ModuleExports {
  module: string;
  functions: Map<string, ImportedFunction>;
}

export function collectModuleExports(
  modules: Module[],
): Map<string, ModuleExports> {
  const exports = new Map<string, ModuleExports>();

  for (const module of modules) {
    const functions = new Map<string, ImportedFunction>();

    for (const statement of module.body) {
      if (
        statement.type === "FunctionDeclaration" &&
        statement.exported
      ) {
        functions.set(statement.name, {
          name: statement.name,
          module: module.name,
          parameters: statement.parameters.map(
            (parameter) => parameter.type,
          ),
          returnType: statement.returnType,
        });
      }
    }

    exports.set(module.name, {
      module: module.name,
      functions,
    });
  }

  return exports;
}