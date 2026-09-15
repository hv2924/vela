import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { getCurrencyMetadata } from "./currency.js";

import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";

const scrypt = promisify(scryptCallback);

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export interface VelaMoney {
  minorUnits: bigint;
  currency: string;
}

export async function velaWeave<T, U>(
  list: T[],
  stages: Array<
    | {
      kind: "filter";
      fn: (value: T) => boolean | PromiseLike<boolean>;
    }
    | {
      kind: "map";
      fn: (value: T) => U | PromiseLike<U>;
    }
    | {
      kind: "find";
      fn: (value: T) => boolean | PromiseLike<boolean>;
    }
  >,
): Promise<U[]> {
  const result: U[] = [];

  outer: for (const original of list) {
    let value: unknown = original;

    for (const stage of stages) {
      if (stage.kind === "filter" || stage.kind === "find") {
        if (!(await stage.fn(value as T))) {
          continue outer;
        }
      } else {
        value = await stage.fn(value as T);
      }
    }

    result.push(value as U);
  }

  return result;
}

export async function velaWeaveFind<T, U>(
  list: T[],
  stages: Array<
    | {
        kind: "filter";
        fn: (value: unknown) => boolean | PromiseLike<boolean>;
      }
    | {
        kind: "map";
        fn: (value: unknown) => unknown | PromiseLike<unknown>;
      }
  >,
  predicate: (value: U) => boolean | PromiseLike<boolean>,
): Promise<U> {
  outer: for (const original of list) {
    let value: unknown = original;

    for (const stage of stages) {
      if (stage.kind === "filter") {
        if (!(await stage.fn(value))) {
          continue outer;
        }
      } else {
        value = await stage.fn(value);
      }
    }

    if (await predicate(value as U)) {
      return value as U;
    }
  }

  throw new Error(
    "weave find() found no matching value.",
  );
}



export async function velaInputSecret(): Promise<string> {
  if (!process.stdin.isTTY) {
    return readFileSync(0, "utf8").replace(/[\r\n]+$/, "");
  }

  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();

  return await new Promise<string>((resolve, reject) => {
    let value = "";

    const finish = (error?: Error): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();

      if (error !== undefined) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    const onData = (chunk: Buffer | string): void => {
      const input = chunk.toString();

      for (const character of input) {
        if (character === "\u0003") {
          finish(new Error("Secret input cancelled."));
          return;
        }

        if (character === "\r" || character === "\n") {
          finish();
          return;
        }

        if (character === "\u0008" || character === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }

        value += character;
      }
    };

    stdin.on("data", onData);
  });
}

interface CurrencyMetadata {
  code: string;
  minorUnitDigits: number;
}

const CURRENCY_METADATA: Record<string, CurrencyMetadata> = {
  EUR: { code: "EUR", minorUnitDigits: 2 },
  USD: { code: "USD", minorUnitDigits: 2 },
  GBP: { code: "GBP", minorUnitDigits: 2 },
  JPY: { code: "JPY", minorUnitDigits: 0 },
  KWD: { code: "KWD", minorUnitDigits: 3 },
};


function normalizeNumericValue(
  value: number | VelaDecimal,
): number {
  if (typeof value === "number") {
    return value;
  }

  return Number(velaDecimalToString(value));
}

export function velaDecimalToNumber(
  value: VelaDecimal,
): number {
  return Number(velaDecimalToString(value));
}

export function velaMoney(
  amount: number | VelaDecimal,
  currency: string,
): VelaMoney {
  const metadata = getCurrencyMetadata(currency);
  const numericAmount = normalizeNumericValue(amount);

  if (!Number.isFinite(numericAmount)) {
    throw new Error("Money amount must be finite.");
  }

  const scale =
    10 ** metadata.minorUnitDigits;

  const minorUnits = BigInt(
    Math.round(numericAmount * scale),
  );

  return {
    minorUnits,
    currency,
  };
}

export function velaMoneyAdd(
  left: VelaMoney,
  right: VelaMoney,
): VelaMoney {
  if (left.currency !== right.currency) {
    throw new Error(
      `Cannot add ${left.currency} and ${right.currency}.`,
    );
  }

  return {
    currency: left.currency,
    minorUnits: left.minorUnits + right.minorUnits,
  };
}

export function velaMoneyToString(
  value: VelaMoney,
): string {
  const metadata = getCurrencyMetadata(
    value.currency,
  );

  const sign = value.minorUnits < 0n ? "-" : "";
  const absoluteMinorUnits = value.minorUnits < 0n
    ? -value.minorUnits
    : value.minorUnits;
  const digits = absoluteMinorUnits.toString().padStart(
    metadata.minorUnitDigits + 1,
    "0",
  );
  const splitAt = digits.length - metadata.minorUnitDigits;
  const major = metadata.minorUnitDigits === 0
    ? digits
    : digits.slice(0, splitAt);
  const minor = metadata.minorUnitDigits === 0
    ? ""
    : `.${digits.slice(splitAt)}`;

  return `${value.currency} ${sign}${major}${minor}`;
}

export function velaCan(
  user: Record<string, unknown>,
  entity: Record<string, unknown>,
  permission: string,
): boolean {
  const permissions = entity.__velaPermissions as
    | Record<string, string>
    | undefined;
  const field = permissions?.[permission] ?? permission;
  const fieldValue = entity[field];

  const userId = typeof user === "object" && user !== null
    ? user.id
    : undefined;

  return user === fieldValue || userId === fieldValue;
}

export function velaListGet<T>(
  list: T[],
  index: number,
): T {
  if (!Number.isInteger(index)) {
    throw new Error(
      "List index must be an integer.",
    );
  }

  if (index < 0 || index >= list.length) {
    throw new Error(
      `List index ${index} is out of bounds.`,
    );
  }

  return list[index]!;
}

interface VelaInputEntityDescriptor {
  kind: "entity";
  name: string;
  fields: Array<{
    name: string;
    type: unknown;
  }>;
}

export function velaListAppend<T>(
  list: T[],
  value: T,
): T[] {
  list.push(value);
  return list;
}

export function velaListContains<T>(
  list: T[],
  value: T,
): boolean {
  return list.includes(value);
}

export function velaSet<T>(
  values: T[],
): Set<T> {
  return new Set(values);
}

export function velaMap<K, V>(
  entries: Array<[K, V]>,
): Map<K, V> {
  return new Map(entries);
}

export function velaMapGet<K, V>(
  map: Map<K, V>,
  key: K,
): V {
  if (!map.has(key)) {
    throw new Error("Map key was not found.");
  }

  return map.get(key)!;
}

export function velaMapSet<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
): V {
  map.set(key, value);
  return value;
}

export function velaMapContains<K>(
  map: Map<K, unknown>,
  key: K,
): boolean {
  return map.has(key);
}

export async function velaListFilter<T>(
  list: T[],
  predicate: (value: T) => boolean | PromiseLike<boolean>,
): Promise<T[]> {
  const filtered: T[] = [];

  for (const value of list) {
    if (await predicate(value)) {
      filtered.push(value);
    }
  }

  return filtered;
}

export async function velaListMap<T, U>(
  list: T[],
  mapper: (value: T) => U | PromiseLike<U>,
): Promise<U[]> {
  const mapped: U[] = [];

  for (const value of list) {
    mapped.push(await mapper(value));
  }

  return mapped;
}

export function velaListFilterMap<T, U>(
  list: T[],
  predicate: (value: T) => boolean,
  mapper: (value: T) => U,
): U[] {
  const result: U[] = [];

  for (const value of list) {
    if (predicate(value)) {
      result.push(mapper(value));
    }
  }

  return result;
}

export async function velaListFilterMapReduce<T, U, A>(
  list: T[],
  predicate: (value: T) => boolean | PromiseLike<boolean>,
  mapper: (value: T) => U | PromiseLike<U>,
  initial: A,
  reducer: (accumulator: A, value: U) => A | PromiseLike<A>,
): Promise<A> {
  let accumulator = initial;

  for (const value of list) {
    if (await predicate(value)) {
      accumulator = await reducer(
        accumulator,
        await mapper(value),
      );
    }
  }

  return accumulator;
}

export async function velaListPipeline<T, U, A>(
  list: T[],
  predicate: ((value: T) => boolean | PromiseLike<boolean>) | null,
  mapper: ((value: T) => U | PromiseLike<U>) | null,
  initial: A | null,
  reducer: ((accumulator: A, value: U) => A | PromiseLike<A>) | null,
): Promise<U[] | A> {
  let accumulator = initial;
  const output: U[] = [];

  for (const value of list) {
    if (predicate !== null && !(await predicate(value))) {
      continue;
    }

    const mapped =
      mapper !== null
        ? await mapper(value)
        : (value as unknown as U);

    if (reducer !== null) {
      accumulator = await reducer(
        accumulator as A,
        mapped,
      );
    } else {
      output.push(mapped);
    }
  }

  return reducer !== null
    ? (accumulator as A)
    : output;
}

export async function velaInput(): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return await new Promise<string>((resolve) => {
    readline.question("", (answer) => {
      readline.close();
      resolve(answer);
    });
  });
}

export async function velaInputText(): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return await new Promise<string>((resolve) => {
    readline.question("", (answer) => {
      readline.close();
      resolve(answer);
    });
  });
}

export async function velaListReduce<T, A>(
  list: T[],
  initial: A,
  reducer: (accumulator: A, value: T) => A | PromiseLike<A>,
): Promise<A> {
  let result = initial;

  for (const value of list) {
    result = await reducer(result, value);
  }

  return result;
}

export function velaSetContains<T>(
  set: Set<T>,
  value: T,
): boolean {
  return set.has(value);
}

export async function velaHash(
  secret: string,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);

  const derivedKey = (await scrypt(
    secret,
    salt,
    KEY_LENGTH,
  )) as Buffer;

  return [
    "vela-scrypt",
    salt.toString("base64"),
    derivedKey.toString("base64"),
  ].join("$");
}

export async function velaVerify(
  secret: string,
  encodedHash: string,
): Promise<boolean> {
  const parts = encodedHash.split("$");

  if (
    parts.length !== 3 ||
    parts[0] !== "vela-scrypt"
  ) {
    return false;
  }

  const salt = Buffer.from(parts[1]!, "base64");
  const expected = Buffer.from(parts[2]!, "base64");

  if (
    salt.length !== SALT_LENGTH ||
    expected.length !== KEY_LENGTH
  ) {
    return false;
  }

  const derivedKey = (await scrypt(
    secret,
    salt,
    KEY_LENGTH,
  )) as Buffer;

  return timingSafeEqual(
    derivedKey,
    expected,
  );
}

export async function velaInputListInt(): Promise<number[]> {
  const input = await velaInputText();

  if (input.trim() === "") {
    return [];
  }

  return input.split(",").map((part, index) => {
    const value = Number(part.trim());

    if (!Number.isInteger(value)) {
      throw new Error(
        `Invalid list[int] input at element ${index + 1
        }: "${part.trim()}".`,
      );
    }

    return value;
  });
}

export async function velaInputSetInt(): Promise<Set<number>> {
  const input = await velaInputText();

  if (input.trim() === "") {
    return new Set<number>();
  }

  const values = input.split(",").map((part, index) => {
    const value = Number(part.trim());

    if (!Number.isInteger(value)) {
      throw new Error(
        `Invalid set[int] input at element ${index + 1}: "${part.trim()}".`,
      );
    }

    return value;
  });

  return new Set(values);
}

export async function velaInputMapTextInt(): Promise<Map<string, number>> {
  const input = await velaInputText();
  const result = new Map<string, number>();

  if (input.trim() === "") {
    return result;
  }

  const entries = input.split(",");

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!.trim();

    const separator = entry.indexOf("=");

    if (separator === -1) {
      throw new Error(
        `Invalid map[text, int] input at entry ${index + 1}: "${entry}". Expected key=value.`,
      );
    }

    const key = entry.slice(0, separator).trim();
    const rawValue = entry.slice(separator + 1).trim();
    const value = Number(rawValue);

    if (key === "") {
      throw new Error(
        `Invalid map[text, int] input at entry ${index + 1}: key cannot be empty.`,
      );
    }

    if (!Number.isInteger(value)) {
      throw new Error(
        `Invalid map[text, int] input at entry ${index + 1}: "${rawValue}" is not an int.`,
      );
    }

    result.set(key, value);
  }

  return result;
}

export async function velaInputTyped(
  type: unknown,
): Promise<unknown> {
  if (
    typeof type === "object" &&
    type !== null &&
    (type as { kind?: string }).kind === "entity"
  ) {
    if (process.stdin.isTTY) {
      return velaParseTypedInput("", type);
    }
  }

  const input = readFileSync(0, "utf8");

  return velaParseTypedInput(
    input,
    type,
  );
}

export function velaMoneySubtract(
  left: VelaMoney,
  right: VelaMoney,
): VelaMoney {
  if (left.currency !== right.currency) {
    throw new Error(
      `Cannot subtract ${right.currency} from ${left.currency}.`,
    );
  }

  return {
    currency: left.currency,
    minorUnits: left.minorUnits - right.minorUnits,
  };
}

export function velaMoneyMultiply(
  value: VelaMoney,
  factor: VelaDecimal,
): VelaMoney {
  const metadata = getCurrencyMetadata(
    value.currency,
  );

  const targetScale = metadata.minorUnitDigits;

  const scaledValue =
    value.minorUnits * factor.value;

  const scaleDifference =
    factor.scale;

  const divisor =
    10n ** BigInt(scaleDifference);

  let result = scaledValue / divisor;
  const remainder = scaledValue % divisor;

  const absoluteRemainder =
    remainder < 0n ? -remainder : remainder;

  const half = divisor / 2n;

  if (absoluteRemainder >= half) {
    result += scaledValue >= 0n ? 1n : -1n;
  }

  return {
    currency: value.currency,
    minorUnits: result,
  };
}

export interface VelaDecimal {
  value: bigint;
  scale: number;
}

export function velaDecimal(
  source: string,
): VelaDecimal {
  const negative = source.startsWith("-");
  const normalized = negative
    ? source.slice(1)
    : source;

  const [whole, fractional = ""] =
    normalized.split(".");

  const digits = `${whole}${fractional}`;
  const value = BigInt(
    `${negative ? "-" : ""}${digits}`,
  );

  return {
    value,
    scale: fractional.length,
  };
}

export function velaDecimalAdd(
  left: VelaDecimal,
  right: VelaDecimal,
): VelaDecimal {
  const scale = Math.max(left.scale, right.scale);

  const leftValue =
    left.value * 10n ** BigInt(scale - left.scale);

  const rightValue =
    right.value * 10n ** BigInt(scale - right.scale);

  return {
    value: leftValue + rightValue,
    scale,
  };
}

export function velaDecimalSubtract(
  left: VelaDecimal,
  right: VelaDecimal,
): VelaDecimal {
  const scale = Math.max(left.scale, right.scale);

  const leftValue =
    left.value * 10n ** BigInt(scale - left.scale);

  const rightValue =
    right.value * 10n ** BigInt(scale - right.scale);

  return {
    value: leftValue - rightValue,
    scale,
  };
}

export function velaDecimalToString(
  value: VelaDecimal,
): string {
  const negative = value.value < 0n;
  const absolute = negative
    ? -value.value
    : value.value;

  if (value.scale === 0) {
    return `${negative ? "-" : ""}${absolute}`;
  }

  const digits = absolute
    .toString()
    .padStart(value.scale + 1, "0");

  const split =
    digits.length - value.scale;

  const whole = digits.slice(0, split);
  const fractional = digits.slice(split);

  return `${negative ? "-" : ""}${whole}.${fractional}`;
}

export function velaDecimalMultiply(
  left: VelaDecimal,
  right: VelaDecimal,
): VelaDecimal {
  return {
    value: left.value * right.value,
    scale: left.scale + right.scale,
  };
}

export function velaMoneyDivide(
  value: VelaMoney,
  divisor: VelaDecimal,
): VelaMoney {
  if (divisor.value === 0n) {
    throw new Error(
      "Cannot divide money by zero.",
    );
  }

  const metadata = getCurrencyMetadata(
    value.currency,
  );

  const targetScale =
    metadata.minorUnitDigits;

  const numerator =
    value.minorUnits *
    10n ** BigInt(divisor.scale + targetScale);

  const denominator =
    divisor.value *
    10n ** BigInt(targetScale);

  let result =
    numerator / denominator;

  const remainder =
    numerator % denominator;

  const absoluteRemainder =
    remainder < 0n ? -remainder : remainder;

  const half =
    (denominator < 0n
      ? -denominator
      : denominator) / 2n;

  if (absoluteRemainder >= half) {
    result += numerator >= 0n ? 1n : -1n;
  }

  return {
    currency: value.currency,
    minorUnits: result,
  };
}
const DECIMAL_DIVISION_SCALE = 18;

export function velaDecimalDivide(
  left: VelaDecimal,
  right: VelaDecimal,
): VelaDecimal {
  if (right.value === 0n) {
    throw new Error("Cannot divide by zero.");
  }

  const targetScale = DECIMAL_DIVISION_SCALE;

  const numerator =
    left.value *
    10n ** BigInt(
      targetScale + right.scale,
    );

  const denominator =
    right.value *
    10n ** BigInt(left.scale);

  const value =
    numerator / denominator;

  return {
    value,
    scale: targetScale,
  };
}

export function velaDecimalRound(
  value: VelaDecimal,
  digits: number,
): VelaDecimal {
  if (!Number.isInteger(digits) || digits < 0) {
    throw new Error(
      "Decimal rounding digits must be a non-negative integer.",
    );
  }

  if (value.scale <= digits) {
    return value;
  }

  const remove = value.scale - digits;
  const divisor = 10n ** BigInt(remove);

  let rounded = value.value / divisor;
  const remainder = value.value % divisor;

  const absoluteRemainder =
    remainder < 0n ? -remainder : remainder;

  const half = divisor / 2n;

  if (absoluteRemainder >= half) {
    rounded += value.value >= 0n ? 1n : -1n;
  }

  return {
    value: rounded,
    scale: digits,
  };
}

async function velaParseTypedInput(
  input: string,
  type: unknown,
): Promise<unknown> {
  if (type === "secret") {
    throw new Error(
      "secret input must use the secure terminal reader.",
    );
  }
  if (typeof type === "string") {
    switch (type) {
      case "text":
        return input;

      case "int": {
        const value = Number(input.trim());

        if (!Number.isInteger(value)) {
          throw new Error(
            `Invalid int input: "${input}".`,
          );
        }

        return value;
      }

      case "decimal":
        return velaDecimal(input.trim());

      case "bool": {
        const normalized =
          input.trim().toLowerCase();

        if (normalized === "true") {
          return true;
        }

        if (normalized === "false") {
          return false;
        }

        throw new Error(
          `Invalid bool input: "${input}".`,
        );
      }

      default:
        throw new Error(
          `Unsupported typed input "${type}".`,
        );
    }
  }

  const descriptor = type as {
    kind: string;
    elementType?: unknown;
    keyType?: unknown;
    valueType?: unknown;
    name?: string;
    fields?: Array<{ name: string; type: unknown }>;
  };

  if (descriptor.kind === "entity") {
    if (input.trim() === "") {
      const result: Record<string, unknown> = {};

      for (const field of descriptor.fields ?? []) {
        result[field.name] = await velaInputField(
          field.name,
          field.type,
        );
      }

      return result;
    }

    const lines = input.split(/\r?\n/);
    const result: Record<string, unknown> = {};

    for (let index = 0; index < (descriptor.fields ?? []).length; index++) {
      const field = descriptor.fields![index]!;
      result[field.name] = await velaParseTypedInput(
        lines[index] ?? "",
        field.type,
      );
    }

    return result;
  }

  if (descriptor.kind === "list") {
    if (input.trim() === "") {
      return [];
    }

    const elementType = descriptor.elementType;
    const isNestedList =
      typeof elementType === "object" &&
      elementType !== null &&
      (elementType as { kind?: string }).kind === "list";
    const parts = isNestedList
      ? input.split(/\r?\n/).map((row) => row.trim()).filter(Boolean)
      : input.split(",").map((part) => part.trim());

    return Promise.all(
      parts.map((part) =>
        velaParseTypedInput(part, elementType),
      ),
    );
  }

  if (descriptor.kind === "set") {
    const values = input.trim() === ""
      ? []
      : await Promise.all(
        input.split(",").map((part) =>
          velaParseTypedInput(part.trim(), descriptor.elementType),
        ),
      );

    return new Set(values);
  }

  if (descriptor.kind === "map") {
    const result = new Map();

    if (input.trim() === "") {
      return result;
    }

    for (const entry of input.split(",")) {
      const separator = entry.indexOf("=");

      if (separator === -1) {
        throw new Error(
          `Invalid map input: "${entry}". Expected key=value.`,
        );
      }

      const key = await velaParseTypedInput(
        entry.slice(0, separator).trim(),
        descriptor.keyType,
      );
      const value = await velaParseTypedInput(
        entry.slice(separator + 1).trim(),
        descriptor.valueType,
      );

      result.set(key, value);
    }

    return result;
  }

  throw new Error("Unsupported typed input descriptor.");
}


async function velaInputField(
  fieldName: string,
  type: unknown,
): Promise<unknown> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return await new Promise<unknown>((resolve, reject) => {
    readline.question(
      `${fieldName}: `,
      async (answer) => {
        readline.close();

        try {
          resolve(
            await velaParseTypedInput(
              answer,
              type,
            ),
          );
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

export function velaMoneyConvert(
  value: VelaMoney,
  targetCurrency: string,
  rate: number,
): VelaMoney {
  const sourceMetadata = getCurrencyMetadata(
    value.currency,
  );

  const targetMetadata = getCurrencyMetadata(
    targetCurrency,
  );

  const sourceScale =
    10 ** sourceMetadata.minorUnitDigits;

  const targetScale =
    10 ** targetMetadata.minorUnitDigits;

  const majorAmount =
    Number(value.minorUnits) / sourceScale;

  const convertedMajorAmount =
    majorAmount * rate;

  const targetMinorUnits = BigInt(
    Math.round(
      convertedMajorAmount * targetScale,
    ),
  );

  return {
    minorUnits: targetMinorUnits,
    currency: targetCurrency,
  };
}
