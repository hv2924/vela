import {
  Expression,
  Program,
  Statement,
  EntityDeclaration,
  TypeName,
} from "./ast.js";

import {
  extractCollectionPipeline,
  canFuseCollectionPipeline,
  CollectionPipeline,
  extractWeaveExpression,
} from "./collection-ir.js";

export function generate(
  program: Program,
  entities: Map<string, EntityDeclaration>,
): string {
  const generatedStatements = program.body.map((statement) =>
    generateStatement(statement, entities),
  );

  return [
    `const { velaHash, velaVerify, velaCan, velaMoney, velaMoneyAdd, velaMoneyToString, velaMoneyConvert, velaMoneySubtract, velaMoneyMultiply, velaMoneyDivide, velaDecimal, velaDecimalAdd, velaDecimalSubtract, velaDecimalToString, velaDecimalMultiply, velaDecimalDivide, velaDecimalRound, velaListGet, velaListAppend, velaListContains, velaSet, velaSetContains, velaMap, velaMapGet, velaMapSet, velaMapContains, velaListFilter, velaListMap, velaListReduce, velaListFilterMap, velaListFilterMapReduce, velaListPipeline, velaInput, velaInputListInt, velaInputSetInt, velaInputMapTextInt, velaInputTyped, velaInputSecret, velaWeave, velaWeaveFind, velaCreate, velaRead, velaUpdate, velaDelete, velaList, velaFind } = require("./Compiler/runtime.js");`,
    "",
    "(async () => {",
    ...generatedStatements.map((statement) => `  ${statement.replace(/\n/g, "\n  ")}`),
    "})();",
  ].join("\n");
}

function generateCollectionPipeline(
  pipeline: CollectionPipeline,
  entities: Map<string, EntityDeclaration>,
): string | null {
  if (pipeline.operations.length === 0) {
    return null;
  }

  let predicate: string | null = null;
  let mapper: string | null = null;
  let initial: string | null = null;
  let reducer: string | null = null;

  for (const operation of pipeline.operations) {
    switch (operation.kind) {
      case "filter":
        predicate = generateExpression(
          operation.predicate,
          entities,
        );
        break;

      case "map":
        mapper = generateExpression(
          operation.mapper,
          entities,
        );
        break;

      case "reduce":
        initial = generateExpression(
          operation.initial,
          entities,
        );
        reducer = generateExpression(
          operation.reducer,
          entities,
        );
        break;
    }
  }

  const predicateCode =
    predicate === null ? "null" : predicate;

  const mapperCode =
    mapper === null ? "null" : mapper;

  const initialCode =
    initial === null ? "null" : initial;

  const reducerCode =
    reducer === null ? "null" : reducer;

  return `(await velaListPipeline(${generateExpression(
    pipeline.source,
    entities,
  )}, ${predicateCode}, ${mapperCode}, ${initialCode}, ${reducerCode}))`;
}

function generateStatement(
  statement: Statement,
  entities: Map<string, EntityDeclaration>,
): string {
  switch (statement.type) {
    case "VariableDeclaration":
      return `const ${statement.name} = ${generateExpression(statement.initializer, entities)};`;

    case "PrintStatement":
      return `console.log(${generateExpression(statement.value, entities)});`;

    case "ReturnStatement":
      return `return ${generateExpression(statement.value, entities)};`;

    case "FunctionDeclaration":
      return generateFunctionDeclaration(statement, entities);

    case "IfStatement":
      return generateIfStatement(statement, entities);

    case "EntityDeclaration":
      return "";
    case "ExpressionStatement":
      return `${generateExpression(
        statement.expression,
        entities,
      )};`;

    default:
      return assertNever(statement);
  }
}

function tryGenerateFusedFilterMapReduce(
  expression: Expression,
  entities: Map<string, EntityDeclaration>,
): string | null {
  if (
    expression.type !== "CallExpression" ||
    expression.callee.type !== "IdentifierExpression" ||
    expression.callee.name !== "reduce"
  ) {
    return null;
  }

  const [source, initial, reducer] =
    expression.arguments;

  if (
    source === undefined ||
    initial === undefined ||
    reducer === undefined ||
    source.type !== "CallExpression" ||
    source.callee.type !== "IdentifierExpression" ||
    source.callee.name !== "map"
  ) {
    return null;
  }

  const [filteredSource, mapper] =
    source.arguments;

  if (
    filteredSource === undefined ||
    mapper === undefined ||
    filteredSource.type !== "CallExpression" ||
    filteredSource.callee.type !== "IdentifierExpression" ||
    filteredSource.callee.name !== "filter"
  ) {
    return null;
  }

  const [list, predicate] =
    filteredSource.arguments;

  if (
    list === undefined ||
    predicate === undefined
  ) {
    return null;
  }

  return `(await velaListFilterMapReduce(${generateExpression(
    list,
    entities,
  )}, ${generateExpression(
    predicate,
    entities,
  )}, ${generateExpression(
    mapper,
    entities,
  )}, ${generateExpression(
    initial,
    entities,
  )}, ${generateExpression(
    reducer,
    entities,
  )}))`;
}

function generateInputTypeDescriptor(
  type: TypeName,
  entities: Map<string, EntityDeclaration>,
): string {
  return JSON.stringify(
    generateInputTypeDescriptorObject(type, entities),
  );
}

function generateInputTypeDescriptorObject(
  type: TypeName,
  entities: Map<string, EntityDeclaration>,
): unknown {
  if (typeof type === "string") {
    return type;
  }
  if (type.kind === "entity") {
    const entity = entities.get(type.name);

    if (entity === undefined) {
      throw new Error(
        `Unknown entity "${type.name}" during input generation.`,
      );
    }

    return {
      kind: "entity",
      name: type.name,
      fields: entity.fields.map((field) => ({
        name: field.name,
        type: generateInputTypeDescriptorObject(
          field.type,
          entities,
        ),
      })),
    };
  }

  if (type.kind === "list") {
    return {
      kind: "list",
      elementType:
        generateInputTypeDescriptorObject(
          type.elementType,
          entities,
        ),
    };
  }

  if (type.kind === "set") {
    return {
      kind: "set",
      elementType:
        generateInputTypeDescriptorObject(
          type.elementType,
          entities,
        ),
    };
  }

  if (type.kind === "map") {
    return {
      kind: "map",
      keyType:
        generateInputTypeDescriptorObject(
          type.keyType,
          entities,
        ),
      valueType:
        generateInputTypeDescriptorObject(
          type.valueType,
          entities,
        ),
    };
  }

  if (type.kind === "function") {
    return {
      kind: "function",
      parameters: type.parameters.map((parameter) =>
        generateInputTypeDescriptorObject(parameter, entities),
      ),
      returnType: generateInputTypeDescriptorObject(
        type.returnType,
        entities,
      ),
    };
  }

  throw new Error("Unsupported input type descriptor.");
}

function generateEntityConstruction(
  expression: Extract<
    Expression,
    { type: "EntityConstructionExpression" }
  >,
  entities: Map<string, EntityDeclaration>,
): string {
  const entity = entities.get(expression.entityName);

  if (entity === undefined) {
    throw new Error(
      `Code generation error: Entity "${expression.entityName}" was not found.`,
    );
  }

  const permissionMetadata = Object.fromEntries(
    entity.permissions.map((permission) => [permission.name, permission.rule]),
  );

  const suppliedFields = new Map(
    expression.fields.map((field) => [
      field.name,
      field.value,
    ]),
  );

  const generatedFields: string[] = [];

  for (const field of entity.fields) {
    const supplied = suppliedFields.get(field.name);

    if (supplied !== undefined) {
      generatedFields.push(
        `${JSON.stringify(field.name)}: ${generateExpression(
          supplied,
          entities,
        )}`,
      );
      continue;
    }

    if (field.defaultValue !== null) {
      generatedFields.push(
        `${JSON.stringify(field.name)}: ${generateExpression(
          field.defaultValue,
          entities,
        )}`,
      );
    }
  }

  return `Object.defineProperty({ ${generatedFields.join(", ")} }, "__velaPermissions", { value: ${JSON.stringify(
    permissionMetadata,
  )} })`;
}

function generateFunctionDeclaration(
  statement: Extract<
    Statement,
    { type: "FunctionDeclaration" }
  >,
  entities: Map<string, EntityDeclaration>,
): string {
  const parameters = statement.parameters
    .map((parameter) => parameter.name)
    .join(", ");

  const body = statement.body.statements
    .map((nestedStatement) => generateStatement(nestedStatement, entities))
    .join("\n");

  let output = `async function ${statement.name}(${parameters}) {\n`;

  if (body.length > 0) {
    output += `${indent(body)}\n`;
  }

  output += "}";

  return output;
}

function generateIfStatement(
  statement: Extract<
    Statement,
    { type: "IfStatement" }
  >,
  entities: Map<string, EntityDeclaration>,
): string {
  const condition = generateExpression(statement.condition, entities);

  const thenBody = statement.thenBranch.statements
    .map((nestedStatement) => generateStatement(nestedStatement, entities))
    .join("\n");

  let output = `if (${condition}) {\n`;

  if (thenBody.length > 0) {
    output += `${indent(thenBody)}\n`;
  }

  output += "}";

  if (statement.elseBranch !== null) {
    const elseBody =
      statement.elseBranch.statements
        .map((nestedStatement) => generateStatement(nestedStatement, entities))
        .join("\n");

    output += " else {\n";

    if (elseBody.length > 0) {
      output += `${indent(elseBody)}\n`;
    }

    output += "}";
  }

  return output;
}

function generateExpression(
  expression: Expression,
  entities: Map<string, EntityDeclaration>,
): string {
  switch (expression.type) {
    case "StringLiteral":
      return JSON.stringify(expression.value);

    case "NumberLiteral":
      if (expression.resolvedType === "decimal") {
        return `velaDecimal(${JSON.stringify(String(expression.value))})`;
      }
      return String(expression.value);
    case "DecimalLiteral":
      return `velaDecimal(${JSON.stringify(expression.value)})`;

    case "MoneyExpression":
      return `velaMoney(${expression.amount}, ${JSON.stringify(
        expression.currency,
      )})`;

    case "BooleanLiteral":
      return String(expression.value);

    case "IdentifierExpression":
      return expression.name;

    case "MemberExpression":
      return `${generateExpression(expression.object, entities)}[${JSON.stringify(
        expression.property,
      )}]`;

    case "PermissionCheckExpression":
      return `velaCan(${generateExpression(expression.user, entities)}, ${generateExpression(
        expression.entity,
        entities,
      )}, ${JSON.stringify(
        expression.permission,
      )})`;

    case "CallExpression":
      {
        const calleeName = expression.callee.type === "IdentifierExpression"
          ? expression.callee.name
          : null;
        if (
          expression.callee.type === "IdentifierExpression" &&
          expression.callee.name === "weave"
        ) {
          const weave = extractWeaveExpression(
            expression,
          );

          if (weave === null) {
            throw new Error(
              "Invalid weave expression.",
            );
          }

          const findIndex = weave.stages.findIndex(
            (stage) => stage.kind === "find",
          );

          if (findIndex !== -1) {
            const findStage = weave.stages[findIndex]!;
            const priorStages = weave.stages.slice(0, findIndex);
            const stageCode = priorStages
              .map((stage) => `{ kind: "${stage.kind}", fn: ${generateExpression(
                stage.function,
                entities,
              )} }`)
              .join(", ");
            const source = priorStages.length === 0
              ? generateExpression(weave.source, entities)
              : generateExpression(weave.source, entities);

            return `(await velaWeaveFind(${source}, [${stageCode}], ${generateExpression(
              findStage.function,
              entities,
            )}))`;
          }

          const stages = weave.stages
            .map((stage) => {
              return `{
        kind: "${stage.kind}",
        fn: ${generateExpression(
                stage.function,
                entities,
              )}
      }`;
            })
            .join(", ");

          return `(await velaWeave(${generateExpression(
            weave.source,
            entities,
          )}, [${stages}]))`;
        }
        if (
          expression.callee.type === "IdentifierExpression" &&
          expression.callee.name === "input"
        ) {
          const typeArgument =
            expression.typeArguments?.[0];
          if (
            typeArgument !== undefined &&
            typeArgument === "secret"
          ) {
            return "(await velaInputSecret())";
          }

          if (typeArgument !== undefined) {
            return `(await velaInputTyped(${generateInputTypeDescriptor(
              typeArgument,
              entities,
            )}))`;
          }

          return "(await velaInput())";
        }

        if (
          expression.callee.type === "IdentifierExpression" &&
          (
            expression.callee.name === "filter" ||
            expression.callee.name === "map" ||
            expression.callee.name === "reduce"
          )
        ) {
          const pipeline =
            extractCollectionPipeline(expression);

          if (
            pipeline !== null &&
            canFuseCollectionPipeline(pipeline)
          ) {
            const generated =
              generateCollectionPipeline(
                pipeline,
                entities,
              );

            if (generated !== null) {
              return generated;
            }
          }
        }
        if (
          calleeName === "map" &&
          expression.resolvedType !== undefined &&
          typeof expression.resolvedType !== "string" &&
          expression.resolvedType.kind === "list"
        ) {
          return `(await velaListMap(${generateExpression(
            expression.arguments[0]!,
            entities,
          )}, ${generateExpression(
            expression.arguments[1]!,
            entities,
          )}))`;
        }
        const fused =
          tryGenerateFusedFilterMapReduce(
            expression,
            entities,
          );

        if (fused !== null) {
          return fused;
        }
        if (calleeName === "reduce") {
          return `(await velaListReduce(${expression.arguments
            .map((argument) =>
              generateExpression(argument, entities),
            )
            .join(", ")}))`;
        }

        if (calleeName === "filter") {
          return `(await velaListFilter(${generateExpression(
            expression.arguments[0]!,
            entities,
          )}, ${generateExpression(
            expression.arguments[1]!,
            entities,
          )}))`;
        }
        if (calleeName === "find") {
          return `(await velaFind(
    ${generateExpression(
            expression.arguments[0]!,
            entities,
          )},
    ${generateExpression(
            expression.arguments[1]!,
            entities,
          )}
  ))`;
        }
        if (calleeName === "mapContains") {
          return `velaMapContains(${expression.arguments
            .map((argument) =>
              generateExpression(argument, entities),
            )
            .join(", ")})`;
        }
        if (calleeName === "mapSet") {
          return `velaMapSet(${expression.arguments
            .map((argument) =>
              generateExpression(argument, entities),
            )
            .join(", ")})`;
        }
        if (calleeName === "mapGet") {
          return `velaMapGet(${expression.arguments
            .map((argument) =>
              generateExpression(argument, entities),
            )
            .join(", ")})`;
        }
        if (calleeName === "map") {
          const entries: string[] = [];

          for (
            let index = 0;
            index < expression.arguments.length;
            index += 2
          ) {
            const key = generateExpression(
              expression.arguments[index]!,
              entities,
            );

            const value = generateExpression(
              expression.arguments[index + 1]!,
              entities,
            );

            entries.push(`[${key}, ${value}]`);
          }

          return `velaMap([${entries.join(", ")}])`;
        }
        if (calleeName === "set") {
          return `velaSet([${expression.arguments
            .map((argument) =>
              generateExpression(argument, entities),
            )
            .join(", ")}])`;
        }
        if (calleeName === "contains") {
          const collection = expression.arguments[0]!;

          if (
            collection.resolvedType !== undefined &&
            typeof collection.resolvedType !== "string" &&
            collection.resolvedType.kind === "set"
          ) {
            return `velaSetContains(${generateExpression(
              collection,
              entities,
            )}, ${generateExpression(
              expression.arguments[1]!,
              entities,
            )})`;
          }

          return `velaListContains(${generateExpression(
            collection,
            entities,
          )}, ${generateExpression(
            expression.arguments[1]!,
            entities,
          )})`;
        }
        if (calleeName === "append") {
          return `velaListAppend(${expression.arguments
            .map((argument) =>
              generateExpression(argument, entities),
            )
            .join(", ")})`;
        }
        if (calleeName === "get") {
          return `velaListGet(${expression.arguments
            .map((argument) =>
              generateExpression(argument, entities),
            )
            .join(", ")})`;
        }
        if (calleeName === "list") {
          if (
            expression.arguments.length === 1 &&
            expression.arguments[0]!.type === "IdentifierExpression" &&
            entities.has(expression.arguments[0]!.name)
          ) {
            return `(await velaList(
      ${JSON.stringify(expression.arguments[0]!.name)}
    ))`;
          }

          return `[${expression.arguments
            .map((argument) =>
              generateExpression(argument, entities),
            )
            .join(", ")}]`;
        }
        if (calleeName === "length") {
          return `(${generateExpression(
            expression.arguments[0]!,
            entities,
          )}).length`;
        }
        if (calleeName === "round") {
          return `velaDecimalRound(${expression.arguments
            .map((argument) =>
              generateExpression(argument, entities),
            )
            .join(", ")})`;
        }
        if (calleeName === "convert") {
          return `velaMoneyConvert(${expression.arguments
            .map((argument) =>
              generateExpression(argument, entities),
            )
            .join(", ")})`;
        }
        if (calleeName === "decimalText") {
          return `velaDecimalToString(${expression.arguments
            .map((argument) =>
              generateExpression(argument, entities),
            )
            .join(", ")})`;
        }

        if (calleeName === "moneyText") {
          return `velaMoneyToString(${expression.arguments
            .map((argument) =>
              generateExpression(argument, entities),
            )
            .join(", ")})`;
        }
        const argumentsCode = expression.arguments
          .map((argument) => generateExpression(argument, entities))
          .join(", ");
        if (calleeName === "money") {
          return `velaMoney(${expression.arguments
            .map((argument) =>
              generateExpression(argument, entities),
            )
            .join(", ")})`;
        }

        if (calleeName === "can") {
          const user = generateExpression(
            expression.arguments[0]!,
            entities,
          );

          const permission = expression.arguments[1]!;

          const entity = generateExpression(
            expression.arguments[2]!,
            entities,
          );

          if (permission.type !== "StringLiteral") {
            throw new Error(
              "Code generation error: can() permission must be a string literal.",
            );
          }

          return `velaCan(${user}, ${entity}, ${JSON.stringify(permission.value)})`;
        }
        if (calleeName === "hash") {
          return `(await velaHash(${argumentsCode}))`;
        }

        if (calleeName === "verify") {
          return `(await velaVerify(${argumentsCode}))`;
        }

        if (calleeName === "money") {
          return `{ amount: ${generateExpression(
            expression.arguments[0]!,
            entities,
          )}, currency: ${generateExpression(
            expression.arguments[1]!,
            entities,
          )} }`;
        }

        if (
          calleeName === "email" ||
          calleeName === "uuid" ||
          calleeName === "secret"
        ) {
          return argumentsCode;
        }

        if (calleeName === "serialize") {
          return `JSON.stringify(${argumentsCode})`;
        }
        if (calleeName === "create") {
          return `(await velaCreate(
    ${JSON.stringify(
            (
              expression.arguments[0] as Extract<
                Expression,
                { type: "EntityConstructionExpression" }
              >
            ).entityName,
          )},
    ${generateExpression(
            expression.arguments[0]!,
            entities,
          )}
  ))`;
        }
        if (calleeName === "read") {
          const entityArgument = expression.arguments[0]!;

          if (entityArgument.type !== "IdentifierExpression") {
            throw new Error(
              "Code generation error: read() entity argument must be an identifier.",
            );
          }

          return `(await velaRead(
    ${JSON.stringify(entityArgument.name)},
    ${generateExpression(
            expression.arguments[1]!,
            entities,
          )}
  ))`;
        }
        if (calleeName === "update") {
          const entityName =
            expression.arguments[0]!.type === "IdentifierExpression"
              ? expression.arguments[0]!.name
              : "Unknown";

          return `(await velaUpdate(${JSON.stringify(
            entityName,
          )}, ${generateExpression(
            expression.arguments[1]!,
            entities,
          )}, ${generateExpression(
            expression.arguments[2]!,
            entities,
          )}))`;
        }
        if (calleeName === "delete") {
          const entityName =
            expression.arguments[0]!.type === "IdentifierExpression"
              ? expression.arguments[0]!.name
              : "Unknown";

          return `(await velaDelete(
    ${JSON.stringify(entityName)},
    ${generateExpression(
            expression.arguments[1]!,
            entities,
          )}
  ))`;
        }

        return `(await ${generateExpression(expression.callee, entities)}(${argumentsCode}))`;
      }

    case "EntityConstructionExpression":
      return generateEntityConstruction(
        expression,
        entities,
      );

    case "BinaryExpression": {
      if (
        expression.resolvedType === "decimal" &&
        expression.operator === "+"
      ) {
        return `velaDecimalAdd(${generateExpression(
          expression.left,
          entities,
        )}, ${generateExpression(
          expression.right,
          entities,
        )})`;
      }

      if (
        expression.resolvedType === "decimal" &&
        expression.operator === "-"
      ) {
        return `velaDecimalSubtract(${generateExpression(
          expression.left,
          entities,
        )}, ${generateExpression(
          expression.right,
          entities,
        )})`;
      }
      if (
        expression.resolvedType === "decimal" &&
        expression.operator === "*"
      ) {
        return `velaDecimalMultiply(${generateExpression(
          expression.left,
          entities,
        )}, ${generateExpression(
          expression.right,
          entities,
        )})`;
      }

      if (
        expression.resolvedType === "decimal" &&
        expression.operator === "/"
      ) {
        return `velaDecimalDivide(${generateExpression(
          expression.left,
          entities,
        )}, ${generateExpression(
          expression.right,
          entities,
        )})`;
      }
      if (expression.resolvedType === "money") {
        if (expression.operator === "+" || expression.operator === "-") {
          const runtimeFunction =
            expression.operator === "+"
              ? "velaMoneyAdd"
              : "velaMoneySubtract";

          return `${runtimeFunction}(${generateExpression(
            expression.left,
            entities,
          )}, ${generateExpression(
            expression.right,
            entities,
          )})`;
        }

        if (expression.operator === "*") {
          const moneyOperand =
            expression.left.type === "IdentifierExpression" ||
              expression.left.type === "CallExpression" ||
              expression.left.type === "MoneyExpression"
              ? expression.left
              : expression.right;
          const scalarOperand =
            moneyOperand === expression.left
              ? expression.right
              : expression.left;

          return `velaMoneyMultiply(${generateExpression(
            moneyOperand,
            entities,
          )}, ${generateExpression(
            scalarOperand,
            entities,
          )})`;
        }

        if (expression.operator === "/") {
          const moneyOperand =
            expression.left.type === "IdentifierExpression" ||
              expression.left.type === "CallExpression" ||
              expression.left.type === "MoneyExpression"
              ? expression.left
              : expression.right;
          const scalarOperand =
            moneyOperand === expression.left
              ? expression.right
              : expression.left;

          return `velaMoneyDivide(${generateExpression(
            moneyOperand,
            entities,
          )}, ${generateExpression(
            scalarOperand,
            entities,
          )})`;
        }
      }

      return `(${generateExpression(expression.left, entities)} ${expression.operator} ${generateExpression(expression.right, entities)})`;
    }

    case "UnaryExpression":
      return `(${expression.operator}${generateExpression(expression.operand, entities)})`;

    default:
      return assertNever(expression);
  }
}

function isMoneyExpression(
  expression: Expression,
): boolean {
  if (
    expression.type === "CallExpression" &&
    expression.callee.type === "IdentifierExpression" &&
    expression.callee.name === "money"
  ) {
    return true;
  }

  return false;
}

function indent(source: string): string {
  return source
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function assertNever(value: never): never {
  throw new Error(
    `Unsupported AST node: ${JSON.stringify(value)}`,
  );
}

function formatTypeName(type: NonNullable<Expression["resolvedType"]>): string {
  if (typeof type === "string") {
    return type;
  }

  switch (type.kind) {
    case "entity":
      return type.name;
    case "list":
      return `list[${formatTypeName(type.elementType)}]`;
    case "set":
      return `set[${formatTypeName(type.elementType)}]`;
    case "map":
      return `map[${formatTypeName(type.keyType)}, ${formatTypeName(
        type.valueType,
      )}]`;
    case "function":
      return `(${type.parameters
        .map((parameter) => formatTypeName(parameter))
        .join(", ")})->${formatTypeName(type.returnType)}`;
  }
}