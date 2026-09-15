import {
  existsSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";

export function resolveModule(
  importingFile: string,
  moduleName: string,
): string {
  const baseDirectory = resolve(
    importingFile,
    "..",
  );

  const modulePath = resolve(
    baseDirectory,
    `${moduleName}.vela`,
  );

  if (!existsSync(modulePath)) {
    throw new Error(
      `Vela: Cannot find module "${moduleName}" imported from "${importingFile}".`,
    );
  }

  return modulePath;
}

export function readModule(
  path: string,
): string {
  return readFileSync(path, "utf8");
}