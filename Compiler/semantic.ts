import {
    BlockStatement,
    EntityConstructionExpression,
    EntityDeclaration,
    EntityTypeName,
    Expression,
    FunctionDeclaration,
    ListTypeName,
    MapTypeName,
    Module,
    Program,
    SetTypeName,
    Statement,
    TypeName,
    VariableDeclaration,
} from "./ast.js";
import { DiagnosticBag } from "./diagnostics.js";
import { collectModuleExports, ModuleExports } from "./module-semantics.js";

type ResolvedType = TypeName | "error";
interface SymbolInfo {
    name: string;
    type: TypeName;
    moneyCurrency?: string;
}
type Symbols = Map<string, SymbolInfo>;
type Functions = Map<string, FunctionSymbol>;
type Entities = Map<string, EntitySymbol>;

interface FunctionSymbol {
    name: string;
    parameters: TypeName[];
    returnType: TypeName;
}

interface MoneyInfo {
    currency: string;
}

interface EntitySymbol {
    name: string;
    fields: Map<
        string,
        {
            type: TypeName;
            hasDefault: boolean;
        }
    >;
    serializable: boolean;
    permissions: Set<string>;
}

export function analyze(program: Program, diagnostics: DiagnosticBag): void {
    const entities = collectEntities([program.body]);
    const symbols: Symbols = new Map();
    const functions: Functions = new Map();

    for (const statement of program.body) {
        if (statement.type === "FunctionDeclaration") {
            registerFunction(statement, functions, diagnostics);
        }
    }

    for (const statement of program.body) {
        analyzeStatement(statement, symbols, functions, entities, null, diagnostics);
    }
}

export function analyzeModules(modules: Module[], diagnostics: DiagnosticBag): void {
    const entities = collectEntities(modules.map((module) => module.body));
    const exports = collectModuleExports(modules);

    for (const module of modules) {
        analyzeModule(module, exports, entities, diagnostics);
    }
}

function getMoneyInfo(
    expression: Expression,
    symbols: Symbols,
): MoneyInfo | null {
    if (
        expression.type === "CallExpression" &&
        expression.callee.type === "IdentifierExpression" &&
        expression.callee.name === "money" &&
        expression.arguments.length === 2
    ) {
        const currency = expression.arguments[1];

        if (
            currency !== undefined &&
            currency.type === "StringLiteral"
        ) {
            return {
                currency: currency.value,
            };
        }
    }

    if (expression.type === "IdentifierExpression") {
        const symbol = symbols.get(expression.name);
        if (symbol?.moneyCurrency !== undefined) {
            return { currency: symbol.moneyCurrency };
        }
    }

    if (expression.type === "BinaryExpression" && expression.operator === "+") {
        const left = getMoneyInfo(expression.left, symbols);
        const right = getMoneyInfo(expression.right, symbols);
        if (left !== null && right !== null && left.currency === right.currency) {
            return left;
        }
    }

    if (expression.type === "MoneyExpression") {
        return { currency: expression.currency };
    }

    return null;
}

function collectEntities(bodies: Statement[][]): Entities {
    const entities: Entities = new Map();

    for (const body of bodies) {
        for (const statement of body) {
            if (statement.type !== "EntityDeclaration") continue;

            if (entities.has(statement.name)) continue;
            const fields = new Map<string, { type: TypeName; hasDefault: boolean }>();
            for (const field of statement.fields) {
                if (!fields.has(field.name)) fields.set(field.name, {
                    type: field.type,
                    hasDefault: field.defaultValue !== null,
                });
            }
            entities.set(statement.name, {
                name: statement.name,
                fields,
                serializable: !Array.from(fields.values()).some(
                    (field) => field.type === "secret",
                ),
                permissions: new Set(
                    statement.permissions.map((permission) => permission.name),
                ),
            });
        }
    }

    return entities;
}

function analyzeModule(
    module: Module,
    exports: Map<string, ModuleExports>,
    entities: Entities,
    diagnostics: DiagnosticBag,
): void {
    const symbols: Symbols = new Map();
    const functions: Functions = new Map();

    for (const statement of module.body) {
        if (statement.type === "FunctionDeclaration") {
            registerFunction(statement, functions, diagnostics);
        }
    }

    for (const declaration of module.imports) {
        const importedModule = exports.get(declaration.module);
        const importedFunction = importedModule?.functions.get(declaration.name);

        if (importedModule === undefined) {
            diagnostics.add("VELA-300", `Module "${declaration.module}" is not available.`, "error", declaration.location);
            continue;
        }
        if (importedFunction === undefined) {
            diagnostics.add("VELA-301", `Module "${declaration.module}" does not export "${declaration.name}".`, "error", declaration.location);
            continue;
        }
        if (functions.has(declaration.name)) {
            diagnostics.add("VELA-302", `Imported function "${declaration.name}" conflicts with a local function.`, "error", declaration.location);
            continue;
        }

        functions.set(declaration.name, {
            name: declaration.name,
            parameters: importedFunction.parameters,
            returnType: importedFunction.returnType,
        });
    }

    for (const statement of module.body) {
        analyzeStatement(statement, symbols, functions, entities, null, diagnostics);
    }
}

function registerFunction(statement: FunctionDeclaration, functions: Functions, diagnostics: DiagnosticBag): void {
    if (functions.has(statement.name)) {
        diagnostics.add("VELA-200", `Function "${statement.name}" is already declared.`, "error", statement.location);
        return;
    }

    const names = new Set<string>();
    for (const parameter of statement.parameters) {
        if (names.has(parameter.name)) {
            diagnostics.add("VELA-201", `Parameter "${parameter.name}" is declared more than once in function "${statement.name}".`, "error", parameter.location);
        }
        names.add(parameter.name);
    }

    functions.set(statement.name, {
        name: statement.name,
        parameters: statement.parameters.map((parameter) => parameter.type),
        returnType: statement.returnType,
    });
}

function analyzeStatement(
    statement: Statement,
    symbols: Symbols,
    functions: Functions,
    entities: Entities,
    expectedReturnType: TypeName | null,
    diagnostics: DiagnosticBag,
): void {
    switch (statement.type) {
        case "VariableDeclaration":
            analyzeVariableDeclaration(statement, symbols, functions, entities, diagnostics);
            return;
        case "PrintStatement":
            const valueType = inferExpressionType(
                statement.value,
                symbols,
                functions,
                entities,
                diagnostics,
            );

            if (valueType === "secret" || valueType === "secret_hash") {
                diagnostics.add(
                    "VELA-508",
                    "Sensitive values cannot be printed.",
                    "error",
                    statement.value.location,
                );
            }
            return;
        case "EntityDeclaration":
            analyzeEntityDeclaration(statement, entities, diagnostics);
            return;
        case "IfStatement": {
            const conditionType = inferExpressionType(statement.condition, symbols, functions, entities, diagnostics);
            if (conditionType !== "bool" && conditionType !== "error") {
                diagnostics.add("VELA-102", `"if" condition must be bool, received "${displayType(conditionType)}".`, "error", statement.condition.location);
            }
            analyzeBlock(statement.thenBranch, symbols, functions, entities, expectedReturnType, diagnostics);
            if (statement.elseBranch !== null) analyzeBlock(statement.elseBranch, symbols, functions, entities, expectedReturnType, diagnostics);
            return;
        }
        case "ExpressionStatement":
            inferExpressionType(
                statement.expression,
                symbols,
                functions,
                entities,
                diagnostics,
            );
            return;
        case "FunctionDeclaration":
            analyzeFunctionDeclaration(statement, functions, entities, diagnostics);
            return;
        case "ReturnStatement":
            if (expectedReturnType === null) {
                diagnostics.add("VELA-103", `"return" can only be used inside a function.`, "error", statement.location);
                return;
            }
            {
                const returnType = inferExpressionType(statement.value, symbols, functions, entities, diagnostics);
                if (returnType !== "error" && !sameType(returnType, expectedReturnType)) {
                    diagnostics.add("VELA-101", `Function must return "${displayType(expectedReturnType)}" but received "${displayType(returnType)}".`, "error", statement.location);
                }
            }
            return;
        default:
            return assertNever(statement);
    }
}

function analyzeEntityDeclaration(statement: EntityDeclaration, entities: Entities, diagnostics: DiagnosticBag): void {
    const fields = new Set<string>();
    for (const field of statement.fields) {
        if (fields.has(field.name)) {
            diagnostics.add("VELA-400", `Entity "${statement.name}" contains duplicate field "${field.name}".`, "error", field.location);
        }
        fields.add(field.name);
        validateType(field.type, entities, field.location, diagnostics);
    }

    const permissions = new Set<string>();
    for (const permission of statement.permissions) {
        if (permissions.has(permission.name)) {
            diagnostics.add(
                "VELA-600",
                `Entity "${statement.name}" contains duplicate permission "${permission.name}".`,
                "error",
                permission.location,
            );
        } else {
            permissions.add(permission.name);
        }

        if (!fields.has(permission.rule)) {
            diagnostics.add(
                "VELA-601",
                `Permission "${permission.name}" references unknown field "${permission.rule}".`,
                "error",
                permission.location,
            );
        }
    }

    if (!entities.has(statement.name)) {
        entities.set(statement.name, {
            name: statement.name,
            fields: new Map(
                statement.fields.map((field) => [
                    field.name,
                    { type: field.type, hasDefault: field.defaultValue !== null },
                ]),
            ),
            serializable: !statement.fields.some((field) => field.type === "secret"),
            permissions: new Set(
                statement.permissions.map((permission) => permission.name),
            ),
        });
    }
}

function analyzeFunctionDeclaration(statement: FunctionDeclaration, functions: Functions, entities: Entities, diagnostics: DiagnosticBag): void {
    const symbols: Symbols = new Map();
    for (const parameter of statement.parameters) {
        if (symbols.has(parameter.name)) continue;
        symbols.set(parameter.name, { name: parameter.name, type: parameter.type });
        validateType(parameter.type, entities, parameter.location, diagnostics);
    }

    let hasReturn = false;
    for (const bodyStatement of statement.body.statements) {
        if (bodyStatement.type === "ReturnStatement") hasReturn = true;
        analyzeStatement(bodyStatement, symbols, functions, entities, statement.returnType, diagnostics);
    }
    validateType(statement.returnType, entities, statement.location, diagnostics);
    if (!hasReturn) diagnostics.add("VELA-104", `Function "${statement.name}" must contain a return statement.`, "error", statement.location);
}

function analyzeBlock(block: BlockStatement, parentSymbols: Symbols, functions: Functions, entities: Entities, expectedReturnType: TypeName | null, diagnostics: DiagnosticBag): void {
    const symbols = new Map(parentSymbols);
    for (const statement of block.statements) analyzeStatement(statement, symbols, functions, entities, expectedReturnType, diagnostics);
}

function analyzeVariableDeclaration(
    statement: VariableDeclaration,
    symbols: Symbols,
    functions: Functions,
    entities: Entities,
    diagnostics: DiagnosticBag,
): void {
    if (symbols.has(statement.name)) {
        diagnostics.add("VELA-100", `Variable "${statement.name}" is already declared.`, "error", statement.location);
        return;
    }
    if (functions.has(statement.name)) {
        diagnostics.add("VELA-105", `"${statement.name}" is already used as a function name.`, "error", statement.location);
        return;
    }

    validateType(statement.declaredType, entities, statement.location, diagnostics);
    const inferredType = inferExpressionType(statement.initializer, symbols, functions, entities, diagnostics);

    if (statement.declaredType !== null && inferredType !== "error" && !sameType(statement.declaredType, inferredType)) {
        diagnostics.add("VELA-106", `Variable "${statement.name}" is declared as "${displayType(statement.declaredType)}" but received "${displayType(inferredType)}".`, "error", statement.location);
    }

    if (statement.declaredType === "decimal" && statement.initializer.type === "NumberLiteral") {
        statement.initializer.resolvedType = "decimal";
    }

    const type = statement.declaredType ?? (inferredType === "error" ? "text" : inferredType);
    const moneyInfo = type === "money"
        ? getMoneyInfo(statement.initializer, symbols)
        : null;
    symbols.set(statement.name, {
        name: statement.name,
        type,
        ...(moneyInfo === null ? {} : { moneyCurrency: moneyInfo.currency }),
    });
}

function inferExpressionType(
    expression: Expression,
    symbols: Symbols,
    functions: Functions,
    entities: Entities,
    diagnostics: DiagnosticBag,
): ResolvedType {
    switch (expression.type) {
        case "StringLiteral":
            return resolveExpressionType(expression, "text");
        case "NumberLiteral":
            return resolveExpressionType(expression, "int");
        case "DecimalLiteral":
            return resolveExpressionType(
                expression,
                "decimal",
            );
        case "BooleanLiteral":
            return resolveExpressionType(expression, "bool");
        case "IdentifierExpression": {
            const symbol = symbols.get(expression.name);
            if (symbol !== undefined) {
                return resolveExpressionType(expression, symbol.type);
            }

            const functionSymbol = functions.get(expression.name);
            if (functionSymbol !== undefined) {
                return resolveExpressionType(
                    expression,
                    {
                        kind: "function",
                        parameters: functionSymbol.parameters,
                        returnType: functionSymbol.returnType,
                    },
                );
            }

            diagnostics.add("VELA-107", `"${expression.name}" is not defined.`, "error", expression.location);
            return "error";
        }
        case "MemberExpression": {
            const objectType = inferExpressionType(
                expression.object,
                symbols,
                functions,
                entities,
                diagnostics,
            );

            if (typeof objectType === "string" || !isEntityType(objectType)) {
                diagnostics.add(
                    "VELA-606",
                    "Property access requires an entity value.",
                    "error",
                    expression.location,
                );
                return "error";
            }

            const entity = entities.get(objectType.name);
            const field = entity?.fields.get(expression.property);

            if (field === undefined) {
                diagnostics.add(
                    "VELA-607",
                    `Entity "${objectType.name}" does not define field "${expression.property}".`,
                    "error",
                    expression.location,
                );
                return "error";
            }

            return resolveExpressionType(expression, field.type);
        }
        case "PermissionCheckExpression": {
            const entityType = inferExpressionType(
                expression.entity,
                symbols,
                functions,
                entities,
                diagnostics,
            );

            if (typeof entityType === "string") {
                diagnostics.add(
                    "VELA-604",
                    "Permission checks expect an entity.",
                    "error",
                    expression.entity.location,
                );
                return "error";
            }
            if (!isEntityType(entityType)) {
                // Not an entity type.
                // A list or primitive cannot be used here.
                return "error";
            }
            const entity = entities.get(entityType.name);
            if (entity === undefined) return "error";

            if (!entity.permissions.has(expression.permission)) {
                diagnostics.add(
                    "VELA-605",
                    `Entity "${entity.name}" does not define permission "${expression.permission}".`,
                    "error",
                    expression.location,
                );
                return "error";
            }

            inferExpressionType(
                expression.user,
                symbols,
                functions,
                entities,
                diagnostics,
            );
            return resolveExpressionType(expression, "bool");
        }
        case "CallExpression": {
            const calleeName = expression.callee.type === "IdentifierExpression"
                ? expression.callee.name
                : null;
            if (calleeName === "weave") {
                if (expression.arguments.length < 2) {
                    diagnostics.add(
                        "VELA-620",
                        "weave() expects a source collection and at least one stage.",
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const sourceType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    sourceType === "error" ||
                    !isListType(sourceType)
                ) {
                    diagnostics.add(
                        "VELA-621",
                        `weave() currently expects a list source, received "${formatTypeName(sourceType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                let currentType: TypeName = sourceType;

                for (
                    let index = 1;
                    index < expression.arguments.length;
                    index++
                ) {
                    const stage = expression.arguments[index]!;

                    if (
                        stage.type !== "CallExpression" ||
                        stage.callee.type !== "IdentifierExpression" ||
                        stage.arguments.length !== 1
                    ) {
                        diagnostics.add(
                            "VELA-622",
                            "Each weave stage must be filter(fn), map(fn), or find(fn).",
                            "error",
                            stage.location,
                        );

                        return "error";
                    }

                    const stageName = stage.callee.name;
                    if (
                        stageName === "find" &&
                        index !== expression.arguments.length - 1
                    ) {
                        diagnostics.add(
                            "VELA-629",
                            "weave find() must be the final stage.",
                            "error",
                            stage.location,
                        );

                        return "error";
                    }

                    if (
                        stageName !== "filter" &&
                        stageName !== "map" &&
                        stageName !== "find"
                    ) {
                        diagnostics.add(
                            "VELA-623",
                            `Unknown weave stage "${stageName}".`,
                            "error",
                            stage.location,
                        );

                        return "error";
                    }

                    const functionType = inferExpressionType(
                        stage.arguments[0]!,
                        symbols,
                        functions,
                        entities,
                        diagnostics,
                    );

                    if (
                        functionType === "error" ||
                        typeof functionType === "string" ||
                        functionType.kind !== "function"
                    ) {
                        diagnostics.add(
                            "VELA-624",
                            `weave ${stageName} stage requires a function.`,
                            "error",
                            stage.arguments[0]!.location,
                        );

                        return "error";
                    }

                    if (functionType.parameters.length !== 1) {
                        diagnostics.add(
                            "VELA-625",
                            `weave ${stageName} stage function must accept exactly one argument.`,
                            "error",
                            stage.arguments[0]!.location,
                        );

                        return "error";
                    }

                    if (
                        !sameType(
                            functionType.parameters[0]!,
                            isListType(currentType)
                                ? currentType.elementType
                                : currentType,
                        )
                    ) {
                        diagnostics.add(
                            "VELA-626",
                            `weave ${stageName} function expects "${formatTypeName(
                                functionType.parameters[0]!,
                            )}".`,
                            "error",
                            stage.arguments[0]!.location,
                        );

                        return "error";
                    }

                    if (stageName === "filter") {
                        if (functionType.returnType !== "bool") {
                            diagnostics.add(
                                "VELA-627",
                                "weave filter() function must return bool.",
                                "error",
                                stage.arguments[0]!.location,
                            );

                            return "error";
                        }

                        continue;
                    }

                    if (stageName === "map") {
                        currentType = {
                            kind: "list",
                            elementType: functionType.returnType,
                        };

                        continue;
                    }

                    if (stageName === "find") {
                        if (index !== expression.arguments.length - 1) {
                            diagnostics.add(
                                "VELA-629",
                                "weave find() must be the final stage.",
                                "error",
                                stage.location,
                            );

                            return "error";
                        }

                        if (functionType.returnType !== "bool") {
                            diagnostics.add(
                                "VELA-628",
                                "weave find() function must return bool.",
                                "error",
                                stage.arguments[0]!.location,
                            );

                            return "error";
                        }

                        const elementType = isListType(currentType)
                            ? currentType.elementType
                            : currentType;

                        return resolveExpressionType(
                            expression,
                            elementType,
                        );
                    }
                }

                return resolveExpressionType(
                    expression,
                    currentType,
                );
            }
            if (calleeName === "create") {
                if (expression.arguments.length !== 1) {
                    diagnostics.add(
                        "VELA-630",
                        `create() expects 1 argument, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const entityConstruction = expression.arguments[0]!;

                if (entityConstruction.type !== "EntityConstructionExpression") {
                    diagnostics.add(
                        "VELA-631",
                        "create() expects an entity construction.",
                        "error",
                        entityConstruction.location,
                    );

                    return "error";
                }

                const entityType = inferExpressionType(
                    entityConstruction,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (entityType === "error") {
                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    entityType,
                );
            }
            if (calleeName === "update") {
                if (expression.arguments.length !== 3) {
                    diagnostics.add(
                        "VELA-636",
                        `update() expects 3 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const entityArgument = expression.arguments[0]!;

                if (
                    entityArgument.type !== "IdentifierExpression"
                ) {
                    diagnostics.add(
                        "VELA-637",
                        "update() expects an entity name as its first argument.",
                        "error",
                        entityArgument.location,
                    );

                    return "error";
                }

                const entity = entities.get(
                    entityArgument.name,
                );

                if (entity === undefined) {
                    diagnostics.add(
                        "VELA-402",
                        `Entity "${entityArgument.name}" is not defined.`,
                        "error",
                        entityArgument.location,
                    );

                    return "error";
                }

                const idField = entity.fields.get("id");

                if (idField === undefined) {
                    diagnostics.add(
                        "VELA-638",
                        `Entity "${entity.name}" does not have an "id" field.`,
                        "error",
                        entityArgument.location,
                    );

                    return "error";
                }

                const idArgument = expression.arguments[1]!;

                const actualIdType = inferExpressionType(
                    idArgument,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    actualIdType !== "error" &&
                    !sameType(actualIdType, idField.type)
                ) {
                    diagnostics.add(
                        "VELA-639",
                        `update() expects an "${displayType(idField.type)}" id for entity "${entity.name}", received "${displayType(actualIdType)}".`,
                        "error",
                        idArgument.location,
                    );

                    return "error";
                }

                const entityValue = expression.arguments[2]!;

                if (
                    entityValue.type !== "EntityConstructionExpression"
                ) {
                    diagnostics.add(
                        "VELA-640",
                        `update() expects a "${entity.name}" value as its third argument.`,
                        "error",
                        entityValue.location,
                    );

                    return "error";
                }

                const entityValueType = analyzeEntityUpdate(
                    entityValue,
                    entity,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const expectedEntityType: TypeName = {
                    kind: "entity",
                    name: entity.name,
                };

                if (
                    entityValueType !== "error" &&
                    !sameType(entityValueType, expectedEntityType)
                ) {
                    diagnostics.add(
                        "VELA-640",
                        `update() expects a "${entity.name}" value as its third argument.`,
                        "error",
                        entityValue.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    expectedEntityType,
                );
            }
            if (calleeName === "delete") {
                if (expression.arguments.length !== 2) {
                    diagnostics.add(
                        "VELA-641",
                        `delete() expects 2 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const entityArgument = expression.arguments[0]!;

                if (
                    entityArgument.type !== "IdentifierExpression"
                ) {
                    diagnostics.add(
                        "VELA-642",
                        "delete() expects an entity name as its first argument.",
                        "error",
                        entityArgument.location,
                    );

                    return "error";
                }

                const entity = entities.get(
                    entityArgument.name,
                );

                if (entity === undefined) {
                    diagnostics.add(
                        "VELA-402",
                        `Entity "${entityArgument.name}" is not defined.`,
                        "error",
                        entityArgument.location,
                    );

                    return "error";
                }

                const idField = entity.fields.get("id");

                if (idField === undefined) {
                    diagnostics.add(
                        "VELA-643",
                        `Entity "${entity.name}" does not have an "id" field.`,
                        "error",
                        entityArgument.location,
                    );

                    return "error";
                }

                const idArgument = expression.arguments[1]!;

                const actualIdType = inferExpressionType(
                    idArgument,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    actualIdType !== "error" &&
                    !sameType(actualIdType, idField.type)
                ) {
                    diagnostics.add(
                        "VELA-644",
                        `delete() expects an "${displayType(idField.type)}" id for entity "${entity.name}", received "${displayType(actualIdType)}".`,
                        "error",
                        idArgument.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    {
                        kind: "entity",
                        name: entity.name,
                    },
                );
            }
            if (calleeName === "read") {
                if (expression.arguments.length !== 2) {
                    diagnostics.add(
                        "VELA-632",
                        `read() expects 2 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const entityArgument = expression.arguments[0]!;

                if (
                    entityArgument.type !== "IdentifierExpression"
                ) {
                    diagnostics.add(
                        "VELA-633",
                        "read() expects an entity name as its first argument.",
                        "error",
                        entityArgument.location,
                    );

                    return "error";
                }

                const entity = entities.get(
                    entityArgument.name,
                );

                if (entity === undefined) {
                    diagnostics.add(
                        "VELA-402",
                        `Entity "${entityArgument.name}" is not defined.`,
                        "error",
                        entityArgument.location,
                    );

                    return "error";
                }

                const idField = entity.fields.get("id");

                if (idField === undefined) {
                    diagnostics.add(
                        "VELA-634",
                        `Entity "${entity.name}" does not have an "id" field.`,
                        "error",
                        entityArgument.location,
                    );

                    return "error";
                }

                const idArgument = expression.arguments[1]!;

                const actualIdType = inferExpressionType(
                    idArgument,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    actualIdType !== "error" &&
                    !sameType(actualIdType, idField.type)
                ) {
                    diagnostics.add(
                        "VELA-635",
                        `read() expects an "${displayType(idField.type)}" id for entity "${entity.name}", received "${displayType(actualIdType)}".`,
                        "error",
                        idArgument.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    {
                        kind: "entity",
                        name: entity.name,
                    },
                );
            }

            if (
                expression.callee.type === "IdentifierExpression" &&
                expression.callee.name === "input" &&
                expression.typeArguments !== undefined
            ) {
                if (expression.arguments.length !== 0) {
                    diagnostics.add(
                        "VELA-610",
                        "input[T]() does not accept runtime arguments.",
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                if (expression.typeArguments.length !== 1) {
                    diagnostics.add(
                        "VELA-611",
                        "input[T]() expects exactly one type argument.",
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    expression.typeArguments[0]!,
                );
            }
            if (calleeName === "input") {
                if (expression.arguments.length !== 0) {
                    diagnostics.add(
                        "VELA-600",
                        `input() expects 0 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    "text",
                );
            }
            if (calleeName === "reduce") {
                if (expression.arguments.length !== 3) {
                    diagnostics.add(
                        "VELA-590",
                        `reduce() expects 3 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const listType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const initialType = inferExpressionType(
                    expression.arguments[1]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const reducerType = inferExpressionType(
                    expression.arguments[2]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    listType === "error" ||
                    initialType === "error" ||
                    reducerType === "error"
                ) {
                    return "error";
                }

                if (!isListType(listType)) {
                    diagnostics.add(
                        "VELA-591",
                        `reduce() expects a list as its first argument, received "${formatTypeName(listType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                if (
                    typeof reducerType === "string" ||
                    reducerType.kind !== "function"
                ) {
                    diagnostics.add(
                        "VELA-592",
                        `reduce() expects a reducer function, received "${formatTypeName(reducerType)}".`,
                        "error",
                        expression.arguments[2]!.location,
                    );

                    return "error";
                }

                if (reducerType.parameters.length !== 2) {
                    diagnostics.add(
                        "VELA-593",
                        "reduce() reducer must accept exactly 2 arguments.",
                        "error",
                        expression.arguments[2]!.location,
                    );

                    return "error";
                }

                if (
                    !sameType(
                        reducerType.parameters[0]!,
                        initialType,
                    )
                ) {
                    diagnostics.add(
                        "VELA-594",
                        `reduce() reducer accumulator expects "${formatTypeName(
                            reducerType.parameters[0]!,
                        )}", but the initial value is "${formatTypeName(
                            initialType,
                        )}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                if (
                    !sameType(
                        reducerType.parameters[1]!,
                        listType.elementType,
                    )
                ) {
                    diagnostics.add(
                        "VELA-595",
                        `reduce() reducer value expects "${formatTypeName(
                            reducerType.parameters[1]!,
                        )}", but the list contains "${formatTypeName(
                            listType.elementType,
                        )}".`,
                        "error",
                        expression.arguments[2]!.location,
                    );

                    return "error";
                }

                if (
                    !sameType(
                        reducerType.returnType,
                        initialType,
                    )
                ) {
                    diagnostics.add(
                        "VELA-596",
                        `reduce() reducer must return "${formatTypeName(
                            initialType,
                        )}", received "${formatTypeName(
                            reducerType.returnType,
                        )}".`,
                        "error",
                        expression.arguments[2]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    initialType,
                );
            }
            if (calleeName === "map") {
                if (expression.arguments.length !== 2) {
                    diagnostics.add(
                        "VELA-585",
                        `map() expects 2 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const listType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const mapperType = inferExpressionType(
                    expression.arguments[1]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    listType === "error" ||
                    mapperType === "error"
                ) {
                    return "error";
                }

                if (!isListType(listType)) {
                    diagnostics.add(
                        "VELA-586",
                        `map() expects a list as its first argument, received "${formatTypeName(listType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                if (
                    typeof mapperType === "string" ||
                    mapperType.kind !== "function"
                ) {
                    diagnostics.add(
                        "VELA-587",
                        `map() expects a function mapper, received "${formatTypeName(mapperType)}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                if (mapperType.parameters.length !== 1) {
                    diagnostics.add(
                        "VELA-588",
                        "map() mapper must accept exactly 1 argument.",
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                if (
                    !sameType(
                        mapperType.parameters[0]!,
                        listType.elementType,
                    )
                ) {
                    diagnostics.add(
                        "VELA-589",
                        `map() mapper expects "${formatTypeName(
                            mapperType.parameters[0]!,
                        )}" but the list contains "${formatTypeName(
                            listType.elementType,
                        )}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    {
                        kind: "list",
                        elementType: mapperType.returnType,
                    },
                );
            }
            if (calleeName === "filter") {
                if (expression.arguments.length !== 2) {
                    diagnostics.add(
                        "VELA-579",
                        `filter() expects 2 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const listType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const predicateType = inferExpressionType(
                    expression.arguments[1]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    listType === "error" ||
                    predicateType === "error"
                ) {
                    return "error";
                }

                if (!isListType(listType)) {
                    diagnostics.add(
                        "VELA-580",
                        `filter() expects a list as its first argument, received "${formatTypeName(listType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                if (
                    typeof predicateType === "string" ||
                    predicateType.kind !== "function"
                ) {
                    diagnostics.add(
                        "VELA-581",
                        `filter() expects a function predicate, received "${formatTypeName(predicateType)}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                if (predicateType.parameters.length !== 1) {
                    diagnostics.add(
                        "VELA-582",
                        `filter() predicate must accept exactly 1 argument.`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                if (
                    !sameType(
                        predicateType.parameters[0]!,
                        listType.elementType,
                    )
                ) {
                    diagnostics.add(
                        "VELA-583",
                        `filter() predicate expects "${formatTypeName(
                            predicateType.parameters[0]!,
                        )}" but the list contains "${formatTypeName(
                            listType.elementType,
                        )}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                if (predicateType.returnType !== "bool") {
                    diagnostics.add(
                        "VELA-584",
                        `filter() predicate must return bool, received "${formatTypeName(
                            predicateType.returnType,
                        )}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    listType,
                );
            }

            if (calleeName === "find") {
                if (expression.arguments.length !== 2) {
                    diagnostics.add(
                        "VELA-585",
                        `find() expects 2 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const listType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const predicateType = inferExpressionType(
                    expression.arguments[1]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    listType === "error" ||
                    predicateType === "error"
                ) {
                    return "error";
                }

                if (!isListType(listType)) {
                    diagnostics.add(
                        "VELA-586",
                        `find() expects a list as its first argument, received "${formatTypeName(listType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                if (
                    typeof predicateType === "string" ||
                    predicateType.kind !== "function"
                ) {
                    diagnostics.add(
                        "VELA-587",
                        `find() expects a function predicate, received "${formatTypeName(predicateType)}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                if (predicateType.parameters.length !== 1) {
                    diagnostics.add(
                        "VELA-588",
                        "find() predicate must accept exactly 1 argument.",
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                if (
                    !sameType(
                        predicateType.parameters[0]!,
                        listType.elementType,
                    )
                ) {
                    diagnostics.add(
                        "VELA-589",
                        `find() predicate expects "${formatTypeName(
                            predicateType.parameters[0]!,
                        )}" but the list contains "${formatTypeName(
                            listType.elementType,
                        )}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                if (predicateType.returnType !== "bool") {
                    diagnostics.add(
                        "VELA-590",
                        `find() predicate must return bool, received "${formatTypeName(
                            predicateType.returnType,
                        )}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    listType.elementType,
                );
            }
            if (calleeName === "map") {
                if (expression.arguments.length === 0) {
                    diagnostics.add(
                        "VELA-565",
                        "map() requires at least one key/value pair.",
                        "error",
                        expression.location,
                    );

                    return "error";
                }
                if (expression.arguments.length % 2 !== 0) {
                    diagnostics.add(
                        "VELA-566",
                        "map() requires key/value pairs.",
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const keyType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const valueType = inferExpressionType(
                    expression.arguments[1]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    keyType === "error" ||
                    valueType === "error"
                ) {
                    return "error";
                }

                for (
                    let index = 2;
                    index < expression.arguments.length;
                    index += 2
                ) {
                    const currentKeyType = inferExpressionType(
                        expression.arguments[index]!,
                        symbols,
                        functions,
                        entities,
                        diagnostics,
                    );

                    const currentValueType = inferExpressionType(
                        expression.arguments[index + 1]!,
                        symbols,
                        functions,
                        entities,
                        diagnostics,
                    );

                    if (
                        currentKeyType !== "error" &&
                        !sameType(keyType, currentKeyType)
                    ) {
                        diagnostics.add(
                            "VELA-567",
                            `map() key ${index / 2 + 1} is "${formatTypeName(currentKeyType)}" but expected "${formatTypeName(keyType)}".`,
                            "error",
                            expression.arguments[index]!.location,
                        );

                        return "error";
                    }

                    if (
                        currentValueType !== "error" &&
                        !sameType(valueType, currentValueType)
                    ) {
                        diagnostics.add(
                            "VELA-568",
                            `map() value ${index / 2 + 1} is "${formatTypeName(currentValueType)}" but expected "${formatTypeName(valueType)}".`,
                            "error",
                            expression.arguments[index + 1]!.location,
                        );

                        return "error";
                    }
                }

                return resolveExpressionType(
                    expression,
                    {
                        kind: "map",
                        keyType,
                        valueType,
                    },
                );
            }
            if (calleeName === "mapGet") {
                if (expression.arguments.length !== 2) {
                    diagnostics.add(
                        "VELA-569",
                        `mapGet() expects 2 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const mapType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const keyType = inferExpressionType(
                    expression.arguments[1]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (mapType === "error" || keyType === "error") {
                    return "error";
                }

                if (!isMapType(mapType)) {
                    diagnostics.add(
                        "VELA-570",
                        `mapGet() expects a map as its first argument, received "${formatTypeName(mapType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                if (!sameType(mapType.keyType, keyType)) {
                    diagnostics.add(
                        "VELA-571",
                        `mapGet() expects key type "${formatTypeName(mapType.keyType)}", received "${formatTypeName(keyType)}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    mapType.valueType,
                );
            }
            if (calleeName === "mapSet") {
                if (expression.arguments.length !== 3) {
                    diagnostics.add(
                        "VELA-572",
                        `mapSet() expects 3 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const mapType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const keyType = inferExpressionType(
                    expression.arguments[1]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const valueType = inferExpressionType(
                    expression.arguments[2]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    mapType === "error" ||
                    keyType === "error" ||
                    valueType === "error"
                ) {
                    return "error";
                }

                if (!isMapType(mapType)) {
                    diagnostics.add(
                        "VELA-573",
                        `mapSet() expects a map as its first argument, received "${formatTypeName(mapType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                if (!sameType(mapType.keyType, keyType)) {
                    diagnostics.add(
                        "VELA-574",
                        `mapSet() expects key type "${formatTypeName(mapType.keyType)}", received "${formatTypeName(keyType)}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                if (!sameType(mapType.valueType, valueType)) {
                    diagnostics.add(
                        "VELA-575",
                        `mapSet() expects value type "${formatTypeName(mapType.valueType)}", received "${formatTypeName(valueType)}".`,
                        "error",
                        expression.arguments[2]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    mapType.valueType,
                );
            }
            if (calleeName === "mapContains") {
                if (expression.arguments.length !== 2) {
                    diagnostics.add(
                        "VELA-576",
                        `mapContains() expects 2 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const mapType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const keyType = inferExpressionType(
                    expression.arguments[1]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (mapType === "error" || keyType === "error") {
                    return "error";
                }

                if (!isMapType(mapType)) {
                    diagnostics.add(
                        "VELA-577",
                        `mapContains() expects a map as its first argument, received "${formatTypeName(mapType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                if (!sameType(mapType.keyType, keyType)) {
                    diagnostics.add(
                        "VELA-578",
                        `mapContains() expects key type "${formatTypeName(mapType.keyType)}", received "${formatTypeName(keyType)}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(expression, "bool");
            }
            if (calleeName === "set") {
                if (expression.arguments.length === 0) {
                    diagnostics.add(
                        "VELA-563",
                        "set() requires at least one element so its element type can be inferred.",
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const elementTypes = expression.arguments.map(
                    (argument) =>
                        inferExpressionType(
                            argument,
                            symbols,
                            functions,
                            entities,
                            diagnostics,
                        ),
                );

                const firstType = elementTypes[0];

                if (
                    firstType === undefined ||
                    firstType === "error"
                ) {
                    return "error";
                }

                for (
                    let index = 1;
                    index < elementTypes.length;
                    index++
                ) {
                    const currentType = elementTypes[index]!;

                    if (
                        currentType !== "error" &&
                        !sameType(firstType, currentType)
                    ) {
                        diagnostics.add(
                            "VELA-564",
                            `set() elements must have the same type; element ${index + 1} is "${formatTypeName(currentType)}" but expected "${formatTypeName(firstType)}".`,
                            "error",
                            expression.arguments[index]!.location,
                        );

                        return "error";
                    }
                }

                return resolveExpressionType(
                    expression,
                    {
                        kind: "set",
                        elementType: firstType,
                    },
                );
            }
            if (calleeName === "contains") {
                if (expression.arguments.length !== 2) {
                    diagnostics.add(
                        "VELA-560",
                        `contains() expects 2 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const collectionType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const valueType = inferExpressionType(
                    expression.arguments[1]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    collectionType === "error" ||
                    valueType === "error"
                ) {
                    return "error";
                }

                const isList =
                    typeof collectionType !== "string" &&
                    collectionType.kind === "list";

                const isSet =
                    typeof collectionType !== "string" &&
                    collectionType.kind === "set";

                if (!isList && !isSet) {
                    diagnostics.add(
                        "VELA-561",
                        `contains() expects a list or set as its first argument, received "${formatTypeName(collectionType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                const elementType = collectionType.elementType;

                if (!sameType(elementType, valueType)) {
                    diagnostics.add(
                        "VELA-562",
                        `contains() expects "${formatTypeName(elementType)}", received "${formatTypeName(valueType)}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    "bool",
                );
            }
            if (calleeName === "append") {
                if (expression.arguments.length !== 2) {
                    diagnostics.add(
                        "VELA-557",
                        `append() expects 2 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const listType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const valueType = inferExpressionType(
                    expression.arguments[1]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (listType === "error" || valueType === "error") {
                    return "error";
                }

                if (
                    typeof listType === "string" ||
                    listType.kind !== "list"
                ) {
                    diagnostics.add(
                        "VELA-558",
                        `append() expects a list as its first argument, received "${formatTypeName(listType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                if (!sameType(listType.elementType, valueType)) {
                    diagnostics.add(
                        "VELA-559",
                        `append() expects "${formatTypeName(listType.elementType)}", received "${formatTypeName(valueType)}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    listType.elementType,
                );
            }
            if (calleeName === "get") {
                if (expression.arguments.length !== 2) {
                    diagnostics.add(
                        "VELA-554",
                        `get() expects 2 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const listType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const indexType = inferExpressionType(
                    expression.arguments[1]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (listType === "error" || indexType === "error") {
                    return "error";
                }

                if (
                    typeof listType === "string" ||
                    listType.kind !== "list"
                ) {
                    diagnostics.add(
                        "VELA-555",
                        `get() expects a list as its first argument, received "${formatTypeName(listType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                if (indexType !== "int") {
                    diagnostics.add(
                        "VELA-556",
                        `get() expects an int index, received "${formatTypeName(indexType)}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    listType.elementType,
                );
            }
            if (calleeName === "length") {
                if (expression.arguments.length !== 1) {
                    diagnostics.add(
                        "VELA-552",
                        `length() expects 1 argument, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const argumentType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    argumentType === "error"
                ) {
                    return "error";
                }

                if (
                    typeof argumentType === "string" ||
                    argumentType.kind !== "list"
                ) {
                    diagnostics.add(
                        "VELA-553",
                        `length() expects a list, received "${formatTypeName(argumentType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    "int",
                );
            }
            if (calleeName === "list") {
                if (
                    expression.arguments.length === 1 &&
                    expression.arguments[0]!.type === "IdentifierExpression" &&
                    entities.has(expression.arguments[0]!.name)
                ) {
                    const entityName =
                        expression.arguments[0]!.name;

                    return resolveExpressionType(
                        expression,
                        {
                            kind: "list",
                            elementType: {
                                kind: "entity",
                                name: entityName,
                            },
                        },
                    );
                }
                if (expression.arguments.length === 0) {
                    diagnostics.add(
                        "VELA-550",
                        "list() requires at least one element so its element type can be inferred.",
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const elementTypes = expression.arguments.map(
                    (argument) =>
                        inferExpressionType(
                            argument,
                            symbols,
                            functions,
                            entities,
                            diagnostics,
                        ),
                );

                const firstType = elementTypes[0];

                if (
                    firstType === undefined ||
                    firstType === "error"
                ) {
                    return "error";
                }

                for (let index = 1; index < elementTypes.length; index++) {
                    const currentType = elementTypes[index]!;

                    if (
                        currentType !== "error" &&
                        !sameType(firstType, currentType)
                    ) {
                        diagnostics.add(
                            "VELA-551",
                            `list() elements must have the same type; element ${index + 1} is "${formatTypeName(currentType)}" but expected "${formatTypeName(firstType)}".`,
                            "error",
                            expression.arguments[index]!.location,
                        );

                        return "error";
                    }
                }

                return resolveExpressionType(
                    expression,
                    {
                        kind: "list",
                        elementType: firstType,
                    },
                );
            }
            if (calleeName === "round") {
                if (expression.arguments.length !== 2) {
                    diagnostics.add(
                        "VELA-542",
                        `round() expects 2 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const valueType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const digits = expression.arguments[1]!;

                if (
                    valueType !== "decimal" &&
                    valueType !== "error"
                ) {
                    diagnostics.add(
                        "VELA-543",
                        `round() expects decimal as its first argument, received "${formatTypeName(valueType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                if (
                    digits.type !== "NumberLiteral"
                ) {
                    diagnostics.add(
                        "VELA-544",
                        "round() expects an integer number of decimal places as its second argument.",
                        "error",
                        digits.location,
                    );

                    return "error";
                }

                if (
                    !Number.isInteger(digits.value) ||
                    digits.value < 0
                ) {
                    diagnostics.add(
                        "VELA-545",
                        "round() decimal places must be a non-negative integer.",
                        "error",
                        digits.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    "decimal",
                );
            }
            if (calleeName === "convert") {
                if (expression.arguments.length !== 3) {
                    diagnostics.add(
                        "VELA-531",
                        `convert() expects 3 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const source = expression.arguments[0]!;
                const target = expression.arguments[1]!;
                const rate = expression.arguments[2]!;

                const sourceType = inferExpressionType(
                    source,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (sourceType !== "money" && sourceType !== "error") {
                    diagnostics.add(
                        "VELA-532",
                        `convert() expects money as its first argument, received "${formatTypeName(sourceType)}".`,
                        "error",
                        source.location,
                    );

                    return "error";
                }

                if (
                    target.type !== "StringLiteral"
                ) {
                    diagnostics.add(
                        "VELA-533",
                        "convert() expects a currency code as its second argument.",
                        "error",
                        target.location,
                    );

                    return "error";
                }

                if (!isValidCurrencyCode(target.value)) {
                    diagnostics.add(
                        "VELA-534",
                        `Invalid currency code "${target.value}".`,
                        "error",
                        target.location,
                    );

                    return "error";
                }

                if (
                    rate.type !== "NumberLiteral" ||
                    rate.value <= 0
                ) {
                    diagnostics.add(
                        "VELA-535",
                        "convert() expects a positive numeric exchange rate as its third argument.",
                        "error",
                        rate.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    "money",
                );
            }
            if (calleeName === "money") {
                if (expression.arguments.length !== 2) {
                    diagnostics.add(
                        "VELA-520",
                        `money() expects 2 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const amount = expression.arguments[0]!;
                const currency = expression.arguments[1]!;

                const amountType = inferExpressionType(
                    amount,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    amountType !== "int" &&
                    amountType !== "decimal" &&
                    amountType !== "error"
                ) {
                    diagnostics.add(
                        "VELA-521",
                        "money() expects a numeric amount as its first argument.",
                        "error",
                        amount.location,
                    );

                    return "error";
                }

                if (
                    amount.type === "NumberLiteral" &&
                    !Number.isFinite(amount.value)
                ) {
                    diagnostics.add(
                        "VELA-524",
                        "money() amount must be finite.",
                        "error",
                        amount.location,
                    );

                    return "error";
                }

                if (
                    amount.type === "DecimalLiteral" &&
                    !Number.isFinite(Number(amount.value))
                ) {
                    diagnostics.add(
                        "VELA-524",
                        "money() amount must be finite.",
                        "error",
                        amount.location,
                    );

                    return "error";
                }

                if (
                    currency.type !== "StringLiteral"
                ) {
                    diagnostics.add(
                        "VELA-522",
                        "money() expects a currency code as its second argument.",
                        "error",
                        currency.location,
                    );

                    return "error";
                }

                if (!isValidCurrencyCode(currency.value)) {
                    diagnostics.add(
                        "VELA-523",
                        `Invalid currency code "${currency.value}".`,
                        "error",
                        currency.location,
                    );

                    return "error";
                }

                return resolveExpressionType(expression, "money");
            }
            if (calleeName === "decimalText") {
                if (expression.arguments.length !== 1) {
                    diagnostics.add(
                        "VELA-540",
                        `decimalText() expects 1 argument, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const argumentType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    argumentType !== "decimal" &&
                    argumentType !== "error"
                ) {
                    diagnostics.add(
                        "VELA-541",
                        `decimalText() expects decimal, received "${formatTypeName(argumentType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    "text",
                );
            }
            if (calleeName === "moneyText") {
                if (expression.arguments.length !== 1) {
                    diagnostics.add(
                        "VELA-520",
                        `moneyText() expects 1 argument, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const argumentType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    argumentType !== "money" &&
                    argumentType !== "error"
                ) {
                    diagnostics.add(
                        "VELA-521",
                        `moneyText() expects money, received "${formatTypeName(argumentType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(
                    expression,
                    "text",
                );
            }
            if (calleeName === "can") {
                if (expression.arguments.length !== 3) {
                    diagnostics.add(
                        "VELA-602",
                        `can() expects 3 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const userType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const permissionExpression = expression.arguments[1]!;

                const entityType = inferExpressionType(
                    expression.arguments[2]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    permissionExpression.type !== "StringLiteral"
                ) {
                    diagnostics.add(
                        "VELA-603",
                        'can() expects the permission name to be a string literal.',
                        "error",
                        permissionExpression.location,
                    );

                    return "error";
                }

                if (
                    typeof entityType === "string" ||
                    entityType.kind !== "entity"
                ) {
                    diagnostics.add(
                        "VELA-604",
                        "can() expects an entity as its third argument.",
                        "error",
                        expression.arguments[2]!.location,
                    );

                    return "error";
                }

                const entity = entities.get(entityType.name);

                if (entity === undefined) {
                    return "error";
                }

                if (
                    !entity.permissions.has(
                        permissionExpression.value,
                    )
                ) {
                    diagnostics.add(
                        "VELA-605",
                        `Entity "${entity.name}" does not define permission "${permissionExpression.value}".`,
                        "error",
                        permissionExpression.location,
                    );

                    return "error";
                }

                void userType;

                return resolveExpressionType(expression, "bool");
            }
            if (calleeName === "hash") {
                if (expression.arguments.length !== 1) {
                    diagnostics.add(
                        "VELA-511",
                        `hash() expects 1 argument, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const argumentType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (argumentType !== "secret" && argumentType !== "error") {
                    diagnostics.add(
                        "VELA-512",
                        `hash() expects secret, received "${formatTypeName(argumentType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(expression, "secret_hash");
            }
            if (calleeName === "verify") {
                if (expression.arguments.length !== 2) {
                    diagnostics.add(
                        "VELA-513",
                        `verify() expects 2 arguments, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const secretType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                const hashType = inferExpressionType(
                    expression.arguments[1]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (
                    secretType !== "secret" &&
                    secretType !== "error"
                ) {
                    diagnostics.add(
                        "VELA-514",
                        `verify() expects a secret as its first argument, received "${formatTypeName(secretType)}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );
                }

                if (
                    hashType !== "secret_hash" &&
                    hashType !== "error"
                ) {
                    diagnostics.add(
                        "VELA-515",
                        `verify() expects a secret_hash as its second argument, received "${formatTypeName(hashType)}".`,
                        "error",
                        expression.arguments[1]!.location,
                    );
                }

                if (
                    (secretType !== "secret" && secretType !== "error") ||
                    (hashType !== "secret_hash" && hashType !== "error")
                ) {
                    return "error";
                }

                return resolveExpressionType(expression, "bool");
            }
            if (calleeName === "serialize") {
                if (expression.arguments.length !== 1) {
                    diagnostics.add(
                        "VELA-509",
                        `serialize() expects 1 argument, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const argumentType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (argumentType === "error") {
                    return "error";
                }

                if (typeof argumentType !== "string") {
                    if (isEntityType(argumentType)) {
                        const entity = entities.get(argumentType.name);

                        if (entity !== undefined && !entity.serializable) {
                            diagnostics.add(
                                "VELA-510",
                                `Entity "${entity.name}" cannot be serialized because it contains a secret field.`,
                                "error",
                                expression.arguments[0]!.location,
                            );

                            return "error";
                        }
                    }

                    return resolveExpressionType(expression, "text");
                }

                if (
                    argumentType !== "text" &&
                    argumentType !== "int" &&
                    argumentType !== "bool" &&
                    argumentType !== "email" &&
                    argumentType !== "uuid"
                ) {
                    diagnostics.add(
                        "VELA-510",
                        `Type "${formatTypeName(argumentType)}" cannot be serialized.`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(expression, "text");
            }
            if (calleeName === "secret") {
                if (expression.arguments.length !== 1) {
                    diagnostics.add(
                        "VELA-506",
                        `secret() expects 1 argument, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const argumentType = inferExpressionType(
                    expression.arguments[0]!,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (argumentType !== "text" && argumentType !== "error") {
                    diagnostics.add(
                        "VELA-507",
                        `secret() expects text, received "${argumentType}".`,
                        "error",
                        expression.arguments[0]!.location,
                    );

                    return "error";
                }

                return resolveExpressionType(expression, "secret");
            }
            if (calleeName === "uuid") {
                if (expression.arguments.length !== 1) {
                    diagnostics.add(
                        "VELA-503",
                        `uuid() expects 1 argument, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const argument = expression.arguments[0]!;
                const argumentType = inferExpressionType(
                    argument,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (argumentType !== "text" && argumentType !== "error") {
                    diagnostics.add(
                        "VELA-504",
                        `uuid() expects text, received "${argumentType}".`,
                        "error",
                        argument.location,
                    );

                    return "error";
                }

                if (
                    argument.type === "StringLiteral" &&
                    !isValidUuid(argument.value)
                ) {
                    diagnostics.add(
                        "VELA-505",
                        `Invalid UUID "${argument.value}".`,
                        "error",
                        argument.location,
                    );

                    return "error";
                }

                return resolveExpressionType(expression, "uuid");
            }

            if (calleeName === "email") {
                if (expression.arguments.length !== 1) {
                    diagnostics.add(
                        "VELA-500",
                        `email() expects 1 argument, received ${expression.arguments.length}.`,
                        "error",
                        expression.location,
                    );

                    return "error";
                }

                const argument = expression.arguments[0]!;
                const argumentType = inferExpressionType(
                    argument,
                    symbols,
                    functions,
                    entities,
                    diagnostics,
                );

                if (argumentType !== "text" && argumentType !== "error") {
                    diagnostics.add(
                        "VELA-501",
                        `email() expects text, received "${displayType(argumentType)}".`,
                        "error",
                        argument.location,
                    );

                    return "error";
                }
                if (
                    argument.type === "StringLiteral" &&
                    !isValidEmail(argument.value)
                ) {
                    diagnostics.add(
                        "VELA-502",
                        `Invalid email address "${argument.value}".`,
                        "error",
                        argument.location,
                    );

                    return "error";
                }

                return resolveExpressionType(expression, "email");
            }

            const calleeType = inferExpressionType(
                expression.callee,
                symbols,
                functions,
                entities,
                diagnostics,
            );
            if (
                calleeType === "error" ||
                typeof calleeType === "string" ||
                calleeType.kind !== "function"
            ) {
                if (calleeType !== "error") {
                    diagnostics.add(
                        "VELA-108",
                        "Function expression is not callable or is not defined.",
                        "error",
                        expression.callee.location,
                    );
                }
                return "error";
            }
            if (expression.arguments.length !== calleeType.parameters.length) {
                diagnostics.add("VELA-109", `Function "${calleeName ?? "expression"}" expects ${calleeType.parameters.length} argument(s), received ${expression.arguments.length}.`, "error", expression.location);
            }
            for (let index = 0; index < expression.arguments.length; index++) {
                const argument = expression.arguments[index]!;
                const actual = inferExpressionType(argument, symbols, functions, entities, diagnostics);
                const expected = calleeType.parameters[index];
                if (expected !== undefined && actual !== "error" && !sameType(actual, expected)) {
                    diagnostics.add("VELA-110", `Argument ${index + 1} of "${calleeName}" must be "${displayType(expected)}", received "${displayType(actual)}".`, "error", argument.location);
                }
            }
            return resolveExpressionType(
                expression,
                calleeType.returnType,
            );
        }

        case "EntityConstructionExpression":
            return analyzeEntityConstruction(expression, symbols, functions, entities, diagnostics);
        case "UnaryExpression": {
            const operand = inferExpressionType(expression.operand, symbols, functions, entities, diagnostics);
            if (operand === "error") return "error";
            const expected = expression.operator === "!" ? "bool" : "int";
            if (operand !== expected) {
                diagnostics.add(expression.operator === "!" ? "VELA-111" : "VELA-112", `Operator "${expression.operator}" requires ${expected}, received "${displayType(operand)}".`, "error", expression.location);
                return "error";
            }
            return resolveExpressionType(expression, operand);
        }
        case "MoneyExpression":
            return resolveExpressionType(expression, "money");
        case "BinaryExpression":
            return inferBinaryExpressionType(expression, symbols, functions, entities, diagnostics);
        default:
            return assertNever(expression);
    }
}

function isValidCurrencyCode(value: string): boolean {
    return /^[A-Z]{3}$/.test(value);
}

function formatTypeName(type: TypeName | ResolvedType): string {
    if (type === "error") {
        return "error";
    }

    if (typeof type === "string") {
        return type;
    }

    if (isEntityType(type)) {
        return type.name;
    }

    if (isMapType(type)) {
        return `map[${formatTypeName(
            type.keyType,
        )}, ${formatTypeName(type.valueType)}]`;
    }
    if (type.kind === "function") {
        return `(${type.parameters
            .map(formatTypeName)
            .join(", ")}) -> ${formatTypeName(
                type.returnType,
            )}`;
    }

    if (isListType(type)) {
        return `list[${formatTypeName(type.elementType)}]`;
    }
    if (isSetType(type)) {
        return `set[${formatTypeName(type.elementType)}]`;
    }

    return "unknown";
}

function isValidUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
    );
}

function inferBinaryExpressionType(
    expression: Extract<Expression, { type: "BinaryExpression" }>,
    symbols: Symbols,
    functions: Functions,
    entities: Entities,
    diagnostics: DiagnosticBag,
): ResolvedType {
    const left = inferExpressionType(
        expression.left,
        symbols,
        functions,
        entities,
        diagnostics,
    );
    const right = inferExpressionType(
        expression.right,
        symbols,
        functions,
        entities,
        diagnostics,
    );

    if (
        (expression.operator === "+" ||
            expression.operator === "-" ||
            expression.operator === "*" ||
            expression.operator === "/" ||
            expression.operator === "%") &&
        ((left === "decimal" && right === "decimal") ||
            (left === "decimal" && right === "int") ||
            (left === "int" && right === "decimal"))
    ) {
        if (expression.left.type === "NumberLiteral" && left === "int") {
            expression.left.resolvedType = "decimal";
        }
        if (expression.right.type === "NumberLiteral" && right === "int") {
            expression.right.resolvedType = "decimal";
        }
        return resolveExpressionType(
            expression,
            "decimal",
        );
    }

    if (left === "error" || right === "error") {
        return "error";
    }

    if (
        (expression.operator === "+" || expression.operator === "-") &&
        left === "decimal" &&
        right === "decimal"
    ) {
        return resolveExpressionType(expression, "decimal");
    }

    if (
        left === "money" &&
        (expression.operator === "*" ||
            expression.operator === "/") &&
        right === "decimal"
    ) {
        return resolveExpressionType(
            expression,
            "money",
        );
    }

    if (
        (expression.operator === "+" || expression.operator === "-") &&
        left === "money" &&
        right === "money"
    ) {
        const leftMoney = getMoneyInfo(expression.left, symbols);
        const rightMoney = getMoneyInfo(expression.right, symbols);

        if (
            leftMoney !== null &&
            rightMoney !== null &&
            leftMoney.currency !== rightMoney.currency
        ) {
            const operationName = expression.operator === "+" ? "add" : "subtract";
            diagnostics.add(
                "VELA-530",
                `Cannot ${operationName} money values with different currencies: "${leftMoney.currency}" and "${rightMoney.currency}".`,
                "error",
                expression.location,
            );

            return "error";
        }

        return resolveExpressionType(expression, "money");
    }

    if (["+", "-", "*", "/", "%"].includes(expression.operator)) {
        if (left !== "int" || right !== "int") {
            diagnostics.add(
                "VELA-113",
                `Operator "${expression.operator}" requires int operands.`,
                "error",
                expression.location,
            );
            return "error";
        }
        return resolveExpressionType(expression, "int");
    }

    if (["<", "<=", ">", ">="].includes(expression.operator)) {
        if (left !== "int" || right !== "int") {
            diagnostics.add(
                "VELA-114",
                `Operator "${expression.operator}" requires int operands.`,
                "error",
                expression.location,
            );
            return "error";
        }
        return resolveExpressionType(expression, "bool");
    }

    if (["==", "!="].includes(expression.operator)) {
        if (!sameType(left, right)) {
            diagnostics.add(
                "VELA-115",
                `Cannot compare "${displayType(left)}" with "${displayType(right)}".`,
                "error",
                expression.location,
            );
            return "error";
        }
        return resolveExpressionType(expression, "bool");
    }

    if (["&&", "||"].includes(expression.operator)) {
        if (left !== "bool" || right !== "bool") {
            diagnostics.add(
                "VELA-116",
                `Operator "${expression.operator}" requires bool operands.`,
                "error",
                expression.location,
            );
            return "error";
        }
        return resolveExpressionType(expression, "bool");
    }

    diagnostics.add(
        "VELA-116",
        `Operator "${expression.operator}" is not supported.`,
        "error",
        expression.location,
    );
    return "error";
}

function isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function analyzeEntityConstruction(
    expression: EntityConstructionExpression,
    symbols: Symbols,
    functions: Functions,
    entities: Entities,
    diagnostics: DiagnosticBag,
): ResolvedType {
    const entity = entities.get(expression.entityName);

    if (entity === undefined) {
        diagnostics.add("VELA-402", `Entity "${expression.entityName}" is not defined.`, "error", expression.location);
        return "error";
    }

    const seen = new Set<string>();
    for (const field of expression.fields) {
        if (seen.has(field.name)) {
            diagnostics.add("VELA-403", `Field "${field.name}" is specified more than once.`, "error", field.location);
            continue;
        }
        seen.add(field.name);

        const definition = entity.fields.get(field.name);
        if (definition === undefined) {
            diagnostics.add("VELA-404", `Entity "${entity.name}" has no field named "${field.name}".`, "error", field.location);
            continue;
        }

        const actual = inferExpressionType(field.value, symbols, functions, entities, diagnostics);
        if (actual !== "error" && !sameType(actual, definition.type)) {
            diagnostics.add("VELA-405", `Field "${field.name}" of "${entity.name}" expects "${displayType(definition.type)}", received "${displayType(actual)}".`, "error", field.location);
        }
    }

    for (const [name, definition] of entity.fields) {
        if (!definition.hasDefault && !seen.has(name)) {
            diagnostics.add("VELA-406", `Required field "${name}" is missing from "${entity.name}".`, "error", expression.location);
        }
    }

    return resolveExpressionType(
        expression,
        {
            kind: "entity",
            name: entity.name,
        },
    );
}

function analyzeEntityUpdate(
    expression: EntityConstructionExpression,
    entity: EntitySymbol,
    symbols: Symbols,
    functions: Functions,
    entities: Entities,
    diagnostics: DiagnosticBag,
): ResolvedType {
    const seen = new Set<string>();

    for (const field of expression.fields) {
        if (seen.has(field.name)) {
            diagnostics.add(
                "VELA-403",
                `Field "${field.name}" is specified more than once.`,
                "error",
                field.location,
            );
            continue;
        }

        seen.add(field.name);

        const definition = entity.fields.get(field.name);

        if (definition === undefined) {
            diagnostics.add(
                "VELA-404",
                `Entity "${entity.name}" has no field named "${field.name}".`,
                "error",
                field.location,
            );
            continue;
        }

        const actual = inferExpressionType(
            field.value,
            symbols,
            functions,
            entities,
            diagnostics,
        );

        if (
            actual !== "error" &&
            !sameType(actual, definition.type)
        ) {
            diagnostics.add(
                "VELA-405",
                `Field "${field.name}" of "${entity.name}" expects "${displayType(definition.type)}", received "${displayType(actual)}".`,
                "error",
                field.location,
            );
        }
    }

    return resolveExpressionType(
        expression,
        {
            kind: "entity",
            name: entity.name,
        },
    );
}

function validateType(
    type: TypeName | null,
    entities: Entities,
    location: { line: number; column: number },
    diagnostics: DiagnosticBag,
): void {
    if (type !== null && isEntityType(type) && !entities.has(type.name)) {
        diagnostics.add("VELA-401", `Unknown entity type "${type.name}".`, "error", location);
    }
}

function isEntityType(type: TypeName): type is EntityTypeName {
    return (
        typeof type !== "string" &&
        type.kind === "entity"
    );
}

function isSetType(
    type: TypeName,
): type is SetTypeName {
    return (
        typeof type !== "string" &&
        type.kind === "set"
    );
}

function isMapType(
    type: TypeName,
): type is MapTypeName {
    return (
        typeof type !== "string" &&
        type.kind === "map"
    );
}

function isListType(type: TypeName): type is ListTypeName {
    return (
        typeof type !== "string" &&
        type.kind === "list"
    );
}

function sameType(
    left: ResolvedType,
    right: ResolvedType,
): boolean {
    if (left === "error" || right === "error") {
        return left === right;
    }

    if (left === "int" && right === "decimal") return true;
    if (left === "decimal" && right === "int") return true;

    if (typeof left === "string" || typeof right === "string") {
        return left === right;
    }
    if (
        left.kind === "function" &&
        right.kind === "function"
    ) {
        if (
            left.parameters.length !==
            right.parameters.length
        ) {
            return false;
        }

        for (let index = 0; index < left.parameters.length; index++) {
            if (
                !sameType(
                    left.parameters[index]!,
                    right.parameters[index]!,
                )
            ) {
                return false;
            }
        }

        return sameType(
            left.returnType,
            right.returnType,
        );
    }

    if (isEntityType(left) && isEntityType(right)) {
        return left.name === right.name;
    }

    if (isMapType(left) && isMapType(right)) {
        return (
            sameType(left.keyType, right.keyType) &&
            sameType(left.valueType, right.valueType)
        );
    }

    if (isListType(left) && isListType(right)) {
        return sameType(left.elementType, right.elementType);
    }
    if (isSetType(left) && isSetType(right)) {
        return sameType(
            left.elementType,
            right.elementType,
        );
    }

    return false;
}

function displayType(type: ResolvedType): string {
    return formatTypeName(type);
}

function assertNever(value: never): never {
    throw new Error(`Unsupported semantic node: ${JSON.stringify(value)}`);
}

function resolveExpressionType(
    expression: Expression,
    type: TypeName,
): TypeName {
    expression.resolvedType = type;
    return type;
}
