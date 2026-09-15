export interface EntityConstructionExpression extends ExpressionBase {
  type: "EntityConstructionExpression";
  location: SourceLocation;
  entityName: string;
  fields: EntityFieldValue[];
}

export interface EntityFieldValue {
  name: string;
  value: Expression;
  location: SourceLocation;
}

export interface MoneyExpression extends ExpressionBase {
  type: "MoneyExpression";
  amount: number;
  currency: string;
}

export interface EntityDeclaration {
  type: "EntityDeclaration";
  location: SourceLocation;
  name: string;
  fields: EntityField[];
  permissions: PermissionDeclaration[];
}

export interface PermissionCheckExpression extends ExpressionBase {
  type: "PermissionCheckExpression";
  user: Expression;
  permission: string;
  entity: Expression;
}

export interface EntityField {
  name: string;
  type: TypeName;
  location: SourceLocation;
  defaultValue: Expression | null;
}

export interface Module {
  type: "Module";
  location: SourceLocation;
  name: string;
  imports: ImportDeclaration[];
  body: Statement[];
}

export interface ImportDeclaration {
  type: "ImportDeclaration";
  location: SourceLocation;
  name: string;
  module: string;
}

export interface ExportedFunction {
  module: string;
  name: string;
  parameters: TypeName[];
  returnType: TypeName;
}

export interface SourceLocation {
  line: number;
  column: number;
}

export interface Program {
  type: "Program";
  location: SourceLocation;
  body: Statement[];
}

export type Statement =
  | VariableDeclaration
  | PrintStatement
  | IfStatement
  | FunctionDeclaration
  | ReturnStatement
  | EntityDeclaration
  | ExpressionStatement;

export interface BlockStatement {
  type: "BlockStatement";
  location: SourceLocation;
  statements: Statement[];
}

export interface PermissionDeclaration {
  name: string;
  rule: string;
  location: SourceLocation;
}

export interface DecimalLiteral extends ExpressionBase {
  type: "DecimalLiteral";
  value: string;
}

export interface IfStatement {
  type: "IfStatement";
  location: SourceLocation;
  condition: Expression;
  thenBranch: BlockStatement;
  elseBranch: BlockStatement | null;
}

export interface FunctionDeclaration {
  type: "FunctionDeclaration";
  location: SourceLocation;
  name: string;
  parameters: Parameter[];
  returnType: TypeName;
  body: BlockStatement;
  exported?: boolean;
}

export interface Parameter {
  name: string;
  type: TypeName;
  location: SourceLocation;
}

export interface ReturnStatement {
  type: "ReturnStatement";
  location: SourceLocation;
  value: Expression;
}

export interface VariableDeclaration {
  type: "VariableDeclaration";
  location: SourceLocation;
  name: string;
  declaredType: TypeName | null;
  initializer: Expression;
}

export interface PrintStatement {
  type: "PrintStatement";
  location: SourceLocation;
  value: Expression;
}

export interface ExpressionStatement {
  type: "ExpressionStatement";
  location: SourceLocation;
  expression: Expression;
}

export type Expression =
  | StringLiteral
  | NumberLiteral
  | BooleanLiteral
  | DecimalLiteral
  | IdentifierExpression
  | MemberExpression
  | BinaryExpression
  | UnaryExpression
  | CallExpression
  | EntityConstructionExpression
  | PermissionCheckExpression
  | MoneyExpression;

export interface StringLiteral extends ExpressionBase {
  type: "StringLiteral";
  value: string;
}

export interface NumberLiteral extends ExpressionBase {
  type: "NumberLiteral";
  value: number;
}

export interface BooleanLiteral extends ExpressionBase {
  type: "BooleanLiteral";
  value: boolean;
}

export interface IdentifierExpression extends ExpressionBase {
  type: "IdentifierExpression";
  name: string;
}

export interface ExpressionBase {
  location: SourceLocation;
  resolvedType?: TypeName;
}

export interface BinaryExpression extends ExpressionBase {
  type: "BinaryExpression";
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
}

export type BinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||";

export interface UnaryExpression extends ExpressionBase {
  type: "UnaryExpression";
  operator: "!" | "-";
  operand: Expression;
}

export interface CallExpression extends ExpressionBase {
  type: "CallExpression";
  callee: Expression;
  arguments: Expression[];
}

export interface CallExpression extends ExpressionBase {
  type: "CallExpression";
  callee: Expression;
  arguments: Expression[];
  typeArguments?: TypeName[];
}

export type TypeName =
  | PrimitiveTypeName
  | EntityTypeName
  | ListTypeName
  | SetTypeName
  | MapTypeName
  | FunctionTypeName;

  export interface MapTypeName {
  kind: "map";
  keyType: TypeName;
  valueType: TypeName;
}

export interface FunctionTypeName {
  kind: "function";
  parameters: TypeName[];
  returnType: TypeName;
}

export interface SetTypeName {
  kind: "set";
  elementType: TypeName;
}

export type PrimitiveTypeName =
  | "text"
  | "int"
  | "bool"
  | "email"
  | "uuid"
  | "secret"
  | "secret_hash"
  | "money"
  | "decimal";

export interface EntityTypeName {
  kind: "entity";
  name: string;
}

export interface ListTypeName {
  kind: "list";
  elementType: TypeName;
}

export interface MemberExpression extends ExpressionBase {
  type: "MemberExpression";
  object: Expression;
  property: string;
}