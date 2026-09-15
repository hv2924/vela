import { Expression } from "./ast.js";

export type CollectionPipelineOperation =
  | {
    kind: "filter";
    predicate: Expression;
  }
  | {
    kind: "map";
    mapper: Expression;
  }
  | {
    kind: "reduce";
    initial: Expression;
    reducer: Expression;
  };

export type WeaveStage =
  | {
    kind: "filter";
    function: Expression;
  }
  | {
    kind: "map";
    function: Expression;
  }
  | {
    kind: "find";
    function: Expression;
  };

export interface WeaveExpression {
  source: Expression;
  stages: WeaveStage[];
}
export function isValidWeaveStage(
  stage: WeaveStage,
): boolean {
  return (
    stage.kind === "filter" ||
    stage.kind === "map" ||
    stage.kind === "find"
  );
}

export function extractWeaveExpression(
  expression: Expression,
): WeaveExpression | null {
  if (
    expression.type !== "CallExpression" ||
    expression.callee.type !== "IdentifierExpression" ||
    expression.callee.name !== "weave" ||
    expression.arguments.length < 2
  ) {
    return null;
  }

  const source = expression.arguments[0]!;
  const stages: WeaveStage[] = [];

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
      return null;
    }

    switch (stage.callee.name) {
      case "filter":
        stages.push({
          kind: "filter",
          function: stage.arguments[0]!,
        });
        break;

      case "map":
        stages.push({
          kind: "map",
          function: stage.arguments[0]!,
        });
        break;

      case "find":
        stages.push({
          kind: "find",
          function: stage.arguments[0]!,
        });
        break;

      default:
        return null;
    }
  }

  return {
    source,
    stages,
  };
}
export interface CollectionPipeline {
  source: Expression;
  operations: CollectionPipelineOperation[];
}
export function extractCollectionPipeline(
  expression: Expression,
): CollectionPipeline | null {
  if (
    expression.type !== "CallExpression" ||
    expression.callee.type !== "IdentifierExpression"
  ) {
    return null;
  }

  const name = expression.callee.name;

  if (name === "filter") {
    if (expression.arguments.length !== 2) {
      return null;
    }

    const source = extractCollectionPipeline(
      expression.arguments[0]!,
    );

    if (source === null) {
      return {
        source: expression.arguments[0]!,
        operations: [
          {
            kind: "filter",
            predicate: expression.arguments[1]!,
          },
        ],
      };
    }

    source.operations.push({
      kind: "filter",
      predicate: expression.arguments[1]!,
    });

    return source;
  }

  if (name === "map") {
    if (expression.arguments.length !== 2) {
      return null;
    }

    const source = extractCollectionPipeline(
      expression.arguments[0]!,
    );

    if (source === null) {
      return {
        source: expression.arguments[0]!,
        operations: [
          {
            kind: "map",
            mapper: expression.arguments[1]!,
          },
        ],
      };
    }

    source.operations.push({
      kind: "map",
      mapper: expression.arguments[1]!,
    });

    return source;
  }

  if (name === "reduce") {
    if (expression.arguments.length !== 3) {
      return null;
    }

    const source = extractCollectionPipeline(
      expression.arguments[0]!,
    );

    if (source === null) {
      return {
        source: expression.arguments[0]!,
        operations: [
          {
            kind: "reduce",
            initial: expression.arguments[1]!,
            reducer: expression.arguments[2]!,
          },
        ],
      };
    }

    source.operations.push({
      kind: "reduce",
      initial: expression.arguments[1]!,
      reducer: expression.arguments[2]!,
    });

    return source;
  }

  return null;
}

export type CollectionPipelineKind =
  | "filter"
  | "map"
  | "reduce";

export function canFuseCollectionPipeline(
  pipeline: CollectionPipeline,
): boolean {
  return pipeline.operations.length > 1;
}