import { Token, TokenType } from "./lexer.js";
import {
    BinaryOperator, BlockStatement, Expression, FunctionDeclaration,
    IfStatement, ImportDeclaration, Module, Parameter, PrintStatement,
    Program, ReturnStatement, TypeName, VariableDeclaration,
    EntityDeclaration, EntityField, EntityConstructionExpression,
    EntityFieldValue, ExpressionStatement, PermissionDeclaration,
} from "./ast.js";

export class Parser {
    private current = 0;

    constructor(private readonly tokens: Token[]) { }

    parse(): Program {
        const module = this.parseModule("main");
        return { type: "Program", location: module.location, body: module.body };
    }

    parseModule(moduleName: string): Module {
        const imports: ImportDeclaration[] = [];
        const body: Array<VariableDeclaration | PrintStatement | IfStatement | FunctionDeclaration | ReturnStatement | EntityDeclaration | ExpressionStatement> = [];
        while (!this.check(TokenType.EOF)) {
            if (this.checkIdentifier("import")) imports.push(this.parseImportDeclaration());
            else body.push(this.parseStatement());
        }
        return { type: "Module", location: { line: 1, column: 1 }, name: moduleName, imports, body };
    }

    private parseImportDeclaration(): ImportDeclaration {
        const token = this.consumeIdentifier("import");
        const name = this.consume(TokenType.Identifier, "Expected an imported name after 'import'.");
        this.consumeIdentifier("from");
        const module = this.consume(TokenType.String, "Expected a module name after 'from'.");
        return { type: "ImportDeclaration", location: this.location(token), name: name.value, module: module.value };
    }

    private parseStatement(): VariableDeclaration | PrintStatement | IfStatement | FunctionDeclaration | ReturnStatement | EntityDeclaration | ExpressionStatement {
        if (!this.check(TokenType.Identifier)) throw this.error(this.peek(), "Expected a statement.");
        switch (this.peek().value) {
            case "let": return this.parseVariableDeclaration();
            case "print": return this.parsePrintStatement();
            case "if": return this.parseIfStatement();
            case "fn": return this.parseFunctionDeclaration();
            case "export": return this.parseExportedDeclaration();
            case "return": return this.parseReturnStatement();
            case "entity": return this.parseEntityDeclaration();
            default: const expression = this.parseExpression();

                return {
                    type: "ExpressionStatement",
                    location: expression.location,
                    expression,
                };
        }
    }
    private parseEntityDeclaration(): EntityDeclaration {
        const entityToken = this.consumeIdentifier("entity");

        const name = this.consume(
            TokenType.Identifier,
            'Expected an entity name after "entity".',
        );

        this.consume(TokenType.LeftBrace, 'Expected "{" after the entity name.');

        const fields: EntityField[] = [];
        const permissions: PermissionDeclaration[] = [];

        while (
            !this.check(TokenType.RightBrace) &&
            !this.check(TokenType.EOF)
        ) {
            if (
                this.check(TokenType.Identifier) &&
                this.peek().value === "permission"
            ) {
                permissions.push(
                    this.parsePermissionDeclaration(),
                );

                continue;
            }
            const fieldName = this.consume(
                TokenType.Identifier,
                "Expected an entity field name.",
            );

            this.consume(
                TokenType.Colon,
                'Expected ":" after the field name.',
            );

            let defaultValue: Expression | null = null;

            if (this.match(TokenType.Equals)) {
                defaultValue = this.parseExpression();
            }

            fields.push({
                name: fieldName.value,
                type: this.parseTypeNameFromCurrent("Expected a field type."),
                location: {
                    line: fieldName.line,
                    column: fieldName.column,
                },
                defaultValue,
            });
        }

        this.consume(
            TokenType.RightBrace,
            'Expected "}" after entity fields.',
        );

        return {
            type: "EntityDeclaration",
            location: {
                line: entityToken.line,
                column: entityToken.column,
            },
            name: name.value,
            fields,
            permissions,
        };
    }

    private parsePermissionDeclaration(): PermissionDeclaration {
        const permissionToken =
            this.consumeIdentifier("permission");

        const name = this.consume(
            TokenType.Identifier,
            'Expected a permission name after "permission".',
        );

        this.consume(
            TokenType.Equals,
            'Expected "=" after the permission name.',
        );

        const rule = this.consume(
            TokenType.Identifier,
            "Expected a permission rule.",
        );

        return {
            name: name.value,
            rule: rule.value,
            location: {
                line: permissionToken.line,
                column: permissionToken.column,
            },
        };
    }

    private parseExportedDeclaration(): FunctionDeclaration {
        const token = this.consumeIdentifier("export");
        const declaration = this.parseFunctionDeclaration();
        return { ...declaration, location: this.location(token), exported: true };
    }

    private parseFunctionDeclaration(): FunctionDeclaration {
        const token = this.consumeIdentifier("fn");
        const name = this.consume(TokenType.Identifier, "Expected a function name after 'fn'.");
        this.consume(TokenType.LeftParen, 'Expected "(" after the function name.');
        const parameters: Parameter[] = [];
        if (!this.check(TokenType.RightParen)) {
            do {
                const parameter = this.consume(TokenType.Identifier, "Expected a parameter name.");
                this.consume(TokenType.Colon, 'Expected ":" after the parameter name.');
                const type = this.parseTypeNameFromCurrent("Expected a parameter type.");
                parameters.push({ name: parameter.value, type, location: this.location(parameter) });
            } while (this.match(TokenType.Comma));
        }
        this.consume(TokenType.RightParen, 'Expected ")" after function parameters.');
        this.consume(TokenType.Arrow, 'Expected "->" before the return type.');
        const returnType = this.parseTypeNameFromCurrent("Expected a return type.");
        return { type: "FunctionDeclaration", location: this.location(token), name: name.value, parameters, returnType, body: this.parseBlock() };
    }

    private parseReturnStatement(): ReturnStatement {
        const token = this.consumeIdentifier("return");
        return { type: "ReturnStatement", location: this.location(token), value: this.parseExpression() };
    }

    private parseIfStatement(): IfStatement {
        const token = this.consumeIdentifier("if");
        const condition = this.parseExpression();
        const thenBranch = this.parseBlock();
        let elseBranch: BlockStatement | null = null;
        if (this.checkIdentifier("else")) { this.advance(); elseBranch = this.parseBlock(); }
        return { type: "IfStatement", location: this.location(token), condition, thenBranch, elseBranch };
    }

    private parseBlock(): BlockStatement {
        const token = this.consume(TokenType.LeftBrace, 'Expected "{" before block.');
        const statements: Array<VariableDeclaration | PrintStatement | IfStatement | FunctionDeclaration | ReturnStatement | EntityDeclaration | ExpressionStatement> = [];
        while (!this.check(TokenType.RightBrace) && !this.check(TokenType.EOF)) statements.push(this.parseStatement());
        this.consume(TokenType.RightBrace, 'Expected "}" after block.');
        return { type: "BlockStatement", location: this.location(token), statements };
    }

    private parseVariableDeclaration(): VariableDeclaration {
        const token = this.consumeIdentifier("let");
        const name = this.consume(TokenType.Identifier, "Expected a variable name after 'let'.");
        let declaredType: TypeName | null = null;
        if (this.match(TokenType.Colon)) declaredType = this.parseTypeNameFromCurrent("Expected a type name after ':'.");
        this.consume(TokenType.Equals, 'Expected "=" after the variable declaration.');
        return { type: "VariableDeclaration", location: this.location(token), name: name.value, declaredType, initializer: this.parseExpression() };
    }

    private parsePrintStatement(): PrintStatement {
        const token = this.consumeIdentifier("print");
        this.consume(TokenType.LeftParen, 'Expected "(" after "print".');
        const value = this.parseExpression();
        this.consume(TokenType.RightParen, 'Expected ")" after the expression.');
        return { type: "PrintStatement", location: this.location(token), value };
    }

    private parseExpression(): Expression { return this.parseLogicalOr(); }
    private parseLogicalOr(): Expression { return this.parseBinaryLevel(() => this.parseLogicalAnd(), TokenType.OrOr); }
    private parseLogicalAnd(): Expression { return this.parseBinaryLevel(() => this.parseEquality(), TokenType.AndAnd); }
    private parseEquality(): Expression { return this.parseBinaryLevel(() => this.parseComparison(), TokenType.EqualEqual, TokenType.BangEqual); }
    private parseComparison(): Expression { return this.parseBinaryLevel(() => this.parseTerm(), TokenType.Less, TokenType.LessEqual, TokenType.Greater, TokenType.GreaterEqual); }
    private parseTerm(): Expression { return this.parseBinaryLevel(() => this.parseFactor(), TokenType.Plus, TokenType.Minus); }
    private parseFactor(): Expression { return this.parseBinaryLevel(() => this.parseUnary(), TokenType.Star, TokenType.Slash, TokenType.Percent); }

    private parseBinaryLevel(parseOperand: () => Expression, ...types: TokenType[]): Expression {
        let expression = parseOperand();
        while (this.match(...types)) {
            const token = this.previous();
            expression = { type: "BinaryExpression", location: this.location(token), operator: token.value as BinaryOperator, left: expression, right: parseOperand() };
        }
        return expression;
    }

    private parseUnary(): Expression {
        if (this.match(TokenType.Bang, TokenType.Minus)) {
            const token = this.previous();
            return { type: "UnaryExpression", location: this.location(token), operator: token.value as "!" | "-", operand: this.parseUnary() };
        }
        return this.parsePrimary();
    }
    private parseEntityConstruction(
        entityToken: Token,
    ): EntityConstructionExpression {
        this.consume(
            TokenType.LeftBrace,
            'Expected "{" after the entity name.',
        );

        const fields: EntityFieldValue[] = [];

        while (
            !this.check(TokenType.RightBrace) &&
            !this.check(TokenType.EOF)
        ) {
            const fieldName = this.consume(
                TokenType.Identifier,
                "Expected an entity field name.",
            );

            this.consume(
                TokenType.Colon,
                'Expected ":" after the field name.',
            );

            const value = this.parseExpression();

            fields.push({
                name: fieldName.value,
                value,
                location: {
                    line: fieldName.line,
                    column: fieldName.column,
                },
            });
        }

        this.consume(
            TokenType.RightBrace,
            'Expected "}" after entity fields.',
        );

        return {
            type: "EntityConstructionExpression",
            location: {
                line: entityToken.line,
                column: entityToken.column,
            },
            entityName: entityToken.value,
            fields,
        };
    }

    private parsePrimary(): Expression {
        if (this.match(TokenType.Decimal)) {
            const token = this.previous();

            return {
                type: "DecimalLiteral",
                location: {
                    line: token.line,
                    column: token.column,
                },
                value: token.value,
            };
        }
        if (this.match(TokenType.Number)) { const token = this.previous(); return { type: "NumberLiteral", location: this.location(token), value: Number(token.value) }; }
        if (this.match(TokenType.String)) { const token = this.previous(); return { type: "StringLiteral", location: this.location(token), value: token.value }; }
        if (this.match(TokenType.Identifier)) {
            const token = this.previous();
            const location = this.location(token);
            const callee: Expression = {
                type: "IdentifierExpression",
                location,
                name: token.value,
            };

            if (this.check(TokenType.LeftBrace)) {
                return this.parseEntityConstruction(token);
            }
            let typeArguments: TypeName[] | undefined;

            if (
                callee.type === "IdentifierExpression" &&
                callee.name === "input" &&
                this.match(TokenType.LeftBracket)
            ) {
                const parsedType = this.parseTypeNameFromCurrent(
                    "Expected an input type.",
                );
                typeArguments = [parsedType];

                this.consume(
                    TokenType.RightBracket,
                    'Expected "]" after input type.',
                );
            }
            if (token.value === "true" || token.value === "false") return { type: "BooleanLiteral", location: this.location(token), value: token.value === "true" };
            let expression: Expression = callee;

            if (this.match(TokenType.LeftParen)) {
                const args: Expression[] = [];
                if (!this.check(TokenType.RightParen)) { do args.push(this.parseExpression()); while (this.match(TokenType.Comma)); }
                this.consume(TokenType.RightParen, 'Expected ")" after function arguments.');
                expression = {
                    type: "CallExpression",
                    location,
                    callee,
                    arguments: args,
                    ...(typeArguments === undefined
                        ? {}
                        : { typeArguments }),
                };
            }

            while (this.match(TokenType.Dot)) {
                const property = this.consume(
                    TokenType.Identifier,
                    'Expected a property name after ".".',
                );
                expression = {
                    type: "MemberExpression",
                    location: this.location(property),
                    object: expression,
                    property: property.value,
                };
            }

            return expression;
        }
        if (this.match(TokenType.LeftParen)) { const expression = this.parseExpression(); this.consume(TokenType.RightParen, 'Expected ")" after expression.'); return expression; }
        throw this.error(this.peek(), "Expected an expression.");
    }

    private parseTypeNameFromCurrent(message: string): TypeName {
        const token = this.check(TokenType.Identifier) || this.check(TokenType.LeftParen)
            ? this.advance()
            : this.consume(TokenType.Identifier, message);
        return this.parseTypeName(token);
    }

    private parseTypeName(token: Token): TypeName {
        if (token.type === TokenType.LeftParen) {
            const parameters: TypeName[] = [];

            if (!this.check(TokenType.RightParen)) {
                do {
                    parameters.push(
                        this.parseTypeNameFromCurrent(
                            "Expected a parameter type in function type.",
                        ),
                    );
                } while (this.match(TokenType.Comma));
            }

            this.consume(
                TokenType.RightParen,
                'Expected ")" after function type parameters.',
            );

            this.consume(
                TokenType.Arrow,
                'Expected "->" in function type.',
            );

            return {
                kind: "function",
                parameters,
                returnType: this.parseTypeNameFromCurrent(
                    "Expected a function return type.",
                ),
            };
        }
        if (token.value === "map") {
            this.consume(
                TokenType.LeftBracket,
                'Expected "[" after "map".',
            );

            const keyType = this.parseTypeNameFromCurrent(
                "Expected a key type inside map[...].",
            );

            this.consume(
                TokenType.Comma,
                'Expected "," between map key and value types.',
            );

            const valueType = this.parseTypeNameFromCurrent(
                "Expected a value type inside map[...].",
            );

            this.consume(
                TokenType.RightBracket,
                'Expected "]" after map types.',
            );

            return {
                kind: "map",
                keyType,
                valueType,
            };
        }
        if (token.value === "set") {
            this.consume(
                TokenType.LeftBracket,
                'Expected "[" after "set".',
            );

            const elementType = this.parseTypeNameFromCurrent(
                "Expected a type inside set[...].",
            );

            this.consume(
                TokenType.RightBracket,
                'Expected "]" after set element type.',
            );

            return {
                kind: "set",
                elementType,
            };
        }
        if (token.value === "list") {
            this.consume(
                TokenType.LeftBracket,
                'Expected "[" after "list".',
            );

            const elementType = this.parseTypeNameFromCurrent(
                "Expected a type inside list[...].",
            );

            this.consume(
                TokenType.RightBracket,
                'Expected "]" after list element type.',
            );

            return {
                kind: "list",
                elementType,
            };
        }
        switch (token.value) {
            case "text":
            case "int":
            case "bool":
            case "email":
            case "uuid":
            case "secret":
            case "secret_hash":
            case "money":
            case "decimal":
                return token.value;

            default:
                return {
                    kind: "entity",
                    name: token.value,
                };
        }
    }

    private checkIdentifier(value: string): boolean { return this.check(TokenType.Identifier) && this.peek().value === value; }
    private consumeIdentifier(expected: string): Token { const token = this.consume(TokenType.Identifier, `Expected "${expected}".`); if (token.value !== expected) throw this.error(token, `Expected "${expected}".`); return token; }
    private match(...types: TokenType[]): boolean { if (types.includes(this.peek().type)) { this.advance(); return true; } return false; }
    private check(type: TokenType): boolean { return this.peek().type === type; }
    private peek(): Token { const token = this.tokens[this.current]; if (token === undefined) throw new Error("Parser reached the end of the token stream unexpectedly."); return token; }
    private previous(): Token { const token = this.tokens[this.current - 1]; if (token === undefined) throw new Error("Parser has no previous token."); return token; }
    private advance(): Token { const token = this.peek(); if (token.type !== TokenType.EOF) this.current++; return token; }
    private consume(type: TokenType, message: string): Token { if (this.check(type)) return this.advance(); throw this.error(this.peek(), message); }
    private location(token: Token): { line: number; column: number } { return { line: token.line, column: token.column }; }
    private error(token: Token, message: string): Error { return new Error(`Vela parser error at ${token.line}:${token.column}: ${message}`); }
}
