export enum TokenType {
  Identifier,
  String,
  Number,
  Decimal,

  LeftParen,
  RightParen,
  LeftBrace,
  RightBrace,
  LeftBracket,
  RightBracket,
  Comma,
  Dot,

  Equals,
  EqualEqual,
  Bang,
  BangEqual,
  Colon,

  AndAnd,
  OrOr,

  Plus,
  Minus,
  Star,
  Slash,
  Percent,

  Arrow,
  Less,
  LessEqual,
  Greater,
  GreaterEqual,

  EOF,
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];

  let index = 0;
  let line = 1;
  let column = 1;

  const addToken = (
    type: TokenType,
    value: string,
    tokenLine: number,
    tokenColumn: number,
  ): void => {
    tokens.push({
      type,
      value,
      line: tokenLine,
      column: tokenColumn,
    });
  };

  const peekCharacter = (): string | undefined =>
    source[index + 1];

  while (index < source.length) {
    const char = source[index];

    if (char === undefined) {
      break;
    }

    if (char === " " || char === "\t" || char === "\r") {
      index++;
      column++;
      continue;
    }

    if (char === "\n") {
      index++;
      line++;
      column = 1;
      continue;
    }

    if (char === ",") {
      addToken(TokenType.Comma, char, line, column);
      index++;
      column++;
      continue;
    }

    if (char === "(") {
      addToken(TokenType.LeftParen, char, line, column);
      index++;
      column++;
      continue;
    }

    if (char === ")") {
      addToken(TokenType.RightParen, char, line, column);
      index++;
      column++;
      continue;
    }
    if (char === "[") {
      addToken(TokenType.LeftBracket, char, line, column);
      index++;
      column++;
      continue;
    }

    if (char === "]") {
      addToken(TokenType.RightBracket, char, line, column);
      index++;
      column++;
      continue;
    }

    if (char === ".") {
      addToken(TokenType.Dot, char, line, column);
      index++;
      column++;
      continue;
    }

    if (char === "{") {
      addToken(TokenType.LeftBrace, char, line, column);
      index++;
      column++;
      continue;
    }

    if (char === "}") {
      addToken(TokenType.RightBrace, char, line, column);
      index++;
      column++;
      continue;
    }

    if (char === "+") {
      addToken(TokenType.Plus, char, line, column);
      index++;
      column++;
      continue;
    }

    if (char === "-") {
      const tokenLine = line;
      const tokenColumn = column;

      if (peekCharacter() === ">") {
        addToken(TokenType.Arrow, "->", tokenLine, tokenColumn);
        index += 2;
        column += 2;
      } else {
        addToken(TokenType.Minus, char, tokenLine, tokenColumn);
        index++;
        column++;
      }

      continue;
    }

    if (char === "&") {
      const tokenLine = line;
      const tokenColumn = column;

      if (peekCharacter() === "&") {
        addToken(TokenType.AndAnd, "&&", tokenLine, tokenColumn);
        index += 2;
        column += 2;
      } else {
        throw new Error(
          `Unexpected character "&" at ${line}:${column}. Vela uses "&&" for logical AND.`,
        );
      }

      continue;
    }

    if (char === "|") {
      const tokenLine = line;
      const tokenColumn = column;

      if (peekCharacter() === "|") {
        addToken(TokenType.OrOr, "||", tokenLine, tokenColumn);
        index += 2;
        column += 2;
      } else {
        throw new Error(
          `Unexpected character "|" at ${line}:${column}. Vela uses "||" for logical OR.`,
        );
      }

      continue;
    }

    if (char === "*") {
      addToken(TokenType.Star, char, line, column);
      index++;
      column++;
      continue;
    }

    if (char === "/") {
      addToken(TokenType.Slash, char, line, column);
      index++;
      column++;
      continue;
    }

    if (char === "%") {
      addToken(TokenType.Percent, char, line, column);
      index++;
      column++;
      continue;
    }

    if (char === "=") {
      const tokenLine = line;
      const tokenColumn = column;

      if (source[index + 1] === "=") {
        addToken(TokenType.EqualEqual, "==", tokenLine, tokenColumn);
        index += 2;
        column += 2;
      } else {
        addToken(TokenType.Equals, char, tokenLine, tokenColumn);
        index++;
        column++;
      }

      continue;
    }

    if (char === "!") {
      const tokenLine = line;
      const tokenColumn = column;

      if (source[index + 1] === "=") {
        addToken(TokenType.BangEqual, "!=", tokenLine, tokenColumn);
        index += 2;
        column += 2;
      } else {
        addToken(TokenType.Bang, char, tokenLine, tokenColumn);
        index++;
        column++;
      }

      continue;
    }

    if (char === "<" || char === ">") {
      const tokenLine = line;
      const tokenColumn = column;
      const isLess = char === "<";
      const isEqual = source[index + 1] === "=";

      if (isLess) {
        addToken(
          isEqual ? TokenType.LessEqual : TokenType.Less,
          isEqual ? "<=" : char,
          tokenLine,
          tokenColumn,
        );
      } else {
        addToken(
          isEqual ? TokenType.GreaterEqual : TokenType.Greater,
          isEqual ? ">=" : char,
          tokenLine,
          tokenColumn,
        );
      }

      index += isEqual ? 2 : 1;
      column += isEqual ? 2 : 1;
      continue;
    }

    if (char === ":") {
      addToken(TokenType.Colon, char, line, column);
      index++;
      column++;
      continue;
    }

    if (char === '"') {
      const startLine = line;
      const startColumn = column;

      index++;
      column++;

      let value = "";

      while (index < source.length) {
        const current = source[index];

        if (current === undefined) {
          break;
        }

        if (current === '"') {
          index++;
          column++;
          break;
        }

        value += current;
        index++;
        column++;
      }

      addToken(TokenType.String, value, startLine, startColumn);
      continue;
    }

    if (/[0-9]/.test(char)) {
      const startLine = line;
      const startColumn = column;

      let value = "";

      while (index < source.length) {
        const current = source[index];

        if (
          current === undefined ||
          !/[0-9]/.test(current)
        ) {
          break;
        }

        value += current;
        index++;
        column++;
      }

      if (
        source[index] === "." &&
        /[0-9]/.test(source[index + 1] ?? "")
      ) {
        value += ".";
        index++;
        column++;

        while (index < source.length) {
          const current = source[index];

          if (
            current === undefined ||
            !/[0-9]/.test(current)
          ) {
            break;
          }

          value += current;
          index++;
          column++;
        }

        addToken(
          TokenType.Decimal,
          value,
          startLine,
          startColumn,
        );

        continue;
      }

      addToken(
        TokenType.Number,
        value,
        startLine,
        startColumn,
      );

      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const startLine = line;
      const startColumn = column;

      let value = "";

      while (index < source.length) {
        const current = source[index];

        if (
          current === undefined ||
          !/[A-Za-z0-9_]/.test(current)
        ) {
          break;
        }

        value += current;
        index++;
        column++;
      }

      addToken(TokenType.Identifier, value, startLine, startColumn);
      continue;
    }

    throw new Error(
      `Unexpected character "${char}" at ${line}:${column}`,
    );
  }

  tokens.push({
    type: TokenType.EOF,
    value: "",
    line,
    column,
  });

  return tokens;
}