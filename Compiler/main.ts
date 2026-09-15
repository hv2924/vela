import {
    mkdirSync,
    writeFileSync,
} from "node:fs";
import {
    basename,
    resolve,
} from "node:path";
import { analyzeModules } from "./semantic.js";
import { generate } from "./codegen.js";
import { DiagnosticBag } from "./diagnostics.js";
import { loadModuleGraph } from "./modules.js";
import { EntityDeclaration, Program } from "./ast.js";

const inputFile = process.argv[2];

if (!inputFile) {
    console.error("Usage: npm run vela -- <file.vela>");
    process.exit(1);
}

const sourcePath = resolve(inputFile);

try {
    const loadedModules = loadModuleGraph(sourcePath);
    const program: Program = {
        type: "Program",
        location: { line: 1, column: 1 },
        body: loadedModules
            .slice()
            .reverse()
            .flatMap(({ module }) => module.body),
    };

    const modules = loadedModules.map(({ module }) => module);
    const entities = new Map<string, EntityDeclaration>();

    for (const loaded of loadedModules) {
        for (const statement of loaded.module.body) {
            if (statement.type === "EntityDeclaration") {
                entities.set(statement.name, statement);
            }
        }
    }

    const diagnostics = new DiagnosticBag();

    analyzeModules(
        modules,
        diagnostics,
    );

    if (diagnostics.hasErrors) {
        console.error(
            `\nVela found ${diagnostics.size} error${diagnostics.size === 1 ? "" : "s"}:\n`,
        );

        for (const diagnostic of diagnostics.all) {
            const location = diagnostic.location
                ? ` at ${diagnostic.location.line}:${diagnostic.location.column}`
                : "";

            console.error(
                `${diagnostic.severity} ${diagnostic.code}${location}: ${diagnostic.message}`,
            );
        }

        console.error("\nCompilation aborted.\n");
        process.exit(1);
    }

    const javascript = generate(program, entities);

    const outputDirectory = resolve("dist");
    mkdirSync(outputDirectory, { recursive: true });

    const outputFile =
        `${basename(sourcePath, ".vela")}.js`;

    const outputPath =
        resolve(outputDirectory, outputFile);

    writeFileSync(
        outputPath,
        `${javascript}\n`,
        "utf8",
    );

    console.log(
        `Compiled ${inputFile} → ${outputPath}`,
    );
} catch (error) {
    console.error(
        error instanceof Error
            ? error.message
            : "Unknown compiler error.",
    );
    process.exit(1);
}