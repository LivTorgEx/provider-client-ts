import type { MappingDocument } from "../types/catalog";
import type { JsonValue } from "../types/json";

export type MappingContext = {
  input: JsonValue;
  provider_code: string;
  state: JsonValue;
};

const SUPPORTED_FUNCTIONS = new Set([
  "datetime.now",
  "math.round",
  "math.to_decimal",
  "math.to_integer",
  "number.from",
  "str.concat",
  "str.lower_ascii",
  "str.to_text",
  "str.upper",
  "symbol.exchange_symbol",
]);

export function assertMappingSupported(document: MappingDocument): void {
  if (document.context?.length) {
    throw new Error("Catalog mappings with context requests are not supported by this client version");
  }
  for (const rule of document.rules) {
    if (rule.operation !== undefined) assertExpressionFunctionsSupported(rule.operation);
  }
}

export function assertConditionSupported(condition: string): void {
  assertExpressionFunctionsSupported(condition);
}

export function matchesCondition(
  condition: string,
  source: JsonValue,
  context: MappingContext,
): boolean {
  return evaluateCondition(condition, source, context);
}

export function applyMapping<Output = JsonValue>(
  document: MappingDocument | null | undefined,
  source: JsonValue,
  context: MappingContext,
): Output {
  if (!document || document.rules.length === 0) return source as Output;
  assertMappingSupported(document);

  let result: JsonValue = {};
  for (const rule of document.rules) {
    const hasSource = typeof rule.source === "string";
    const hasValue = Object.hasOwn(rule, "value");
    if (hasSource === hasValue) {
      throw new Error("Each catalog mapping rule must have exactly one of source or value");
    }

    const sourcePath = rule.source ?? "";
    const values = hasSource
      ? resolvePathValues(source, sourcePath, context)
      : [rule.value ?? null];
    const targetHasWildcard = rule.target.includes("*");
    const sourceHasWildcard = hasSource && sourcePath.includes("*");

    if (values.length === 0) {
      if (sourceHasWildcard && targetHasWildcard) result = setTarget(result, rule.target, []);
      continue;
    }

    const operation = rule.operation;
    const mappedValues = operation === undefined
      ? values
      : values.map((value) => evaluateOperation(operation, value, context));
    const firstValue = mappedValues[0] ?? null;
    const targetValue = targetHasWildcard && !sourceHasWildcard && Array.isArray(firstValue)
      ? firstValue
      : targetHasWildcard || sourceHasWildcard
        ? mappedValues
        : firstValue;
    result = setTarget(result, rule.target, targetValue);
  }
  return result as Output;
}

function resolvePathValues(
  source: JsonValue,
  path: string,
  context: MappingContext,
): JsonValue[] {
  const parts = parsePath(path);
  let root = source;
  if (parts[0] === "input") {
    root = context.input;
    parts.shift();
  } else if (parts[0] === "provider_code") {
    root = context.provider_code;
    parts.shift();
  } else if (parts[0] === "state") {
    root = context.state;
    parts.shift();
  }
  return resolvePathParts(root, parts, path);
}

function resolvePathParts(value: JsonValue, parts: string[], path: string): JsonValue[] {
  const [part, ...remaining] = parts;
  if (part === undefined) return [value];
  if (part === "*") {
    if (!Array.isArray(value)) throw new Error(`Catalog mapping source is not an array: ${path}`);
    return value.flatMap((item) => resolvePathParts(item, remaining, path));
  }

  let next: JsonValue | undefined;
  if (Array.isArray(value) && /^\d+$/.test(part)) next = value[Number(part)];
  else if (isRecord(value)) next = value[part];
  if (next === undefined) throw new Error(`Catalog mapping source is missing: ${path}`);
  return resolvePathParts(next, remaining, path);
}

function parsePath(path: string): string[] {
  let value = path.trim();
  if (value.startsWith("$.")) value = value.slice(2);
  if (value === "$" || value === "") return [];
  return value.startsWith("/")
    ? value.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    : value.split(".").filter(Boolean);
}

function setTarget(root: JsonValue, path: string, value: JsonValue): JsonValue {
  return setPathValue(root, parsePath(path), value, path);
}

function setPathValue(
  root: JsonValue,
  parts: string[],
  value: JsonValue,
  fullPath: string,
): JsonValue {
  const [part, ...remaining] = parts;
  if (part === undefined) return value;

  if (part === "*") {
    const values = Array.isArray(value) ? value : [value];
    const output: JsonValue[] = Array.isArray(root) ? cloneJson(root) as JsonValue[] : [];
    values.forEach((item, index) => {
      const child = output[index] ?? createContainer(remaining);
      output[index] = setPathValue(child, remaining, item, fullPath);
    });
    return output;
  }

  if (Array.isArray(root)) {
    if (!/^\d+$/.test(part)) throw new Error(`Invalid array mapping target: ${fullPath}`);
    const output = cloneJson(root) as JsonValue[];
    const index = Number(part);
    const child = remaining.length === 0
      ? value
      : setPathValue(output[index] ?? createContainer(remaining), remaining, value, fullPath);
    output[index] = child;
    return output;
  }

  const output: Record<string, JsonValue> = isRecord(root)
    ? cloneJson(root) as Record<string, JsonValue>
    : {};
  output[part] = remaining.length === 0
    ? value
    : setPathValue(output[part] ?? createContainer(remaining), remaining, value, fullPath);
  return output;
}

function createContainer(parts: string[]): JsonValue[] | Record<string, JsonValue> {
  return parts[0] === "*" || /^\d+$/.test(parts[0] ?? "") ? [] : {};
}

function evaluateOperation(
  expression: string,
  current: JsonValue,
  context: MappingContext,
): JsonValue {
  const trimmed = expression.trim();
  return evaluateValue(trimmed.startsWith("return ") ? trimmed.slice(7) : trimmed, current, context);
}

function evaluateCondition(
  expression: string,
  current: JsonValue,
  context: MappingContext,
): boolean {
  const value = stripOuterParentheses(expression.trim());
  const orParts = splitTopLevel(value, "||");
  if (orParts.length > 1) return orParts.some((part) => evaluateCondition(part, current, context));
  const andParts = splitTopLevel(value, "&&");
  if (andParts.length > 1) return andParts.every((part) => evaluateCondition(part, current, context));
  if (value.startsWith("not ")) return !evaluateCondition(value.slice(4), current, context);

  const comparison = findComparison(value);
  if (!comparison) return Boolean(evaluateValue(value, current, context));
  const left = evaluateConditionOperand(value.slice(0, comparison.index), current, context);
  const right = evaluateConditionOperand(value.slice(comparison.index + comparison.operator.length), current, context);
  if (comparison.operator === "==") return JSON.stringify(left) === JSON.stringify(right);
  if (comparison.operator === "!=") return JSON.stringify(left) !== JSON.stringify(right);
  const leftNumber = numericValue(left);
  const rightNumber = numericValue(right);
  switch (comparison.operator) {
    case ">": return leftNumber > rightNumber;
    case ">=": return leftNumber >= rightNumber;
    case "<": return leftNumber < rightNumber;
    case "<=": return leftNumber <= rightNumber;
    default: throw new Error(`Catalog comparison is not supported: ${comparison.operator}`);
  }
}

function evaluateConditionOperand(
  expression: string,
  current: JsonValue,
  context: MappingContext,
): JsonValue {
  try {
    return evaluateValue(expression, current, context);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Catalog mapping source is missing:")) return null;
    throw error;
  }
}

function evaluateValue(
  expression: string,
  current: JsonValue,
  context: MappingContext,
): JsonValue {
  const value = stripOuterParentheses(expression.trim());
  if (value.startsWith("return ")) return evaluateValue(value.slice(7), current, context);
  const conditional = splitConditional(value);
  if (conditional) {
    return evaluateCondition(conditional.condition, current, context)
      ? evaluateValue(conditional.whenTrue, current, context)
      : evaluateValue(conditional.whenFalse, current, context);
  }
  if (value === "$" || value.startsWith("$.")) return resolveExpressionPath(value, current, context);
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "string") throw new Error("Catalog mapping string literal is invalid");
    return parsed;
  }

  const call = parseFunctionCall(value);
  if (!call) throw new Error(`Catalog mapping expression is not supported: ${expression}`);
  assertSupportedFunction(call.name);
  const args = call.arguments.map((argument) => evaluateValue(argument, current, context));
  return callFunction(call.name, args);
}

function resolveExpressionPath(
  path: string,
  source: JsonValue,
  context: MappingContext,
): JsonValue {
  if (path === "$") return source;
  if (path.startsWith("$.context.")) {
    const contextValue: JsonValue = {
      input: context.input,
      provider_code: context.provider_code,
      state: context.state,
    };
    const values = resolvePathValues(contextValue, path.slice("$.context.".length), context);
    return values.length === 1 ? values[0] ?? null : values;
  }
  const values = resolvePathValues(source, path, context);
  return values.length === 1 ? values[0] ?? null : values;
}

function callFunction(name: string, args: JsonValue[]): JsonValue {
  switch (name) {
    case "datetime.now": return Date.now();
    case "math.round": return Math.round(numericValue(requireArgument(args, 0, name)));
    case "math.to_decimal":
    case "number.from": return numericValue(requireArgument(args, 0, name));
    case "math.to_integer": return Math.trunc(numericValue(requireArgument(args, 0, name)));
    case "str.concat": return args.map(stringValue).join("");
    case "str.lower_ascii": return stringValue(requireArgument(args, 0, name)).replace(/[A-Z]/g, (char) => char.toLowerCase());
    case "str.to_text": return scalarText(requireArgument(args, 0, name));
    case "str.upper": return stringValue(requireArgument(args, 0, name)).toUpperCase();
    case "symbol.exchange_symbol": {
      const parts = stringValue(requireArgument(args, 0, name)).split("#");
      if (parts.length !== 3 || !parts[1]) throw new Error("Catalog symbol key is invalid");
      return parts[1];
    }
    default: throw new Error(`Catalog mapping function is not supported: ${name}`);
  }
}

function parseFunctionCall(value: string): { name: string; arguments: string[] } | null {
  const open = value.indexOf("(");
  if (open <= 0 || !value.endsWith(")")) return null;
  const name = value.slice(0, open).trim();
  if (!/^[A-Za-z_][\w.]*$/.test(name) || matchingCloseParen(value, open) !== value.length - 1) return null;
  const body = value.slice(open + 1, -1).trim();
  return { name, arguments: body === "" ? [] : splitTopLevel(body, ",") };
}

function splitConditional(value: string): {
  whenTrue: string;
  condition: string;
  whenFalse: string;
} | null {
  const ifIndex = findTopLevel(value, " if ");
  if (ifIndex <= 0) return null;
  const elseIndex = findTopLevel(value, " else ", ifIndex + 4);
  if (elseIndex < 0) return null;
  return {
    whenTrue: value.slice(0, ifIndex).trim(),
    condition: value.slice(ifIndex + 4, elseIndex).trim(),
    whenFalse: value.slice(elseIndex + 6).trim(),
  };
}

function splitTopLevel(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (depth === 0 && value.startsWith(delimiter, index)) {
      parts.push(value.slice(start, index).trim());
      start = index + delimiter.length;
      index += delimiter.length - 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function findTopLevel(value: string, token: string, startAt = 0): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index <= value.length - token.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (depth === 0 && index >= startAt && value.startsWith(token, index)) return index;
  }
  return -1;
}

function findComparison(value: string): { index: number; operator: string } | null {
  for (const operator of ["==", "!=", ">=", "<=", ">", "<"]) {
    const index = findTopLevel(value, operator);
    if (index >= 0) return { index, operator };
  }
  return null;
}

function matchingCloseParen(value: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = openIndex; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return index;
  }
  return -1;
}

function stripOuterParentheses(value: string): string {
  let result = value;
  while (result.startsWith("(") && matchingCloseParen(result, 0) === result.length - 1) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

function assertExpressionFunctionsSupported(expression: string): void {
  const names = [...expression.matchAll(/([A-Za-z_][\w.]*)\s*\(/g)].map((match) => match[1]);
  for (const name of names) {
    if (name !== undefined && name !== "not") assertSupportedFunction(name);
  }
}

function assertSupportedFunction(name: string): void {
  if (!SUPPORTED_FUNCTIONS.has(name)) {
    throw new Error(`Catalog mapping function is not supported: ${name}`);
  }
}

function requireArgument(args: JsonValue[], index: number, name: string): JsonValue {
  const value = args[index];
  if (value === undefined) throw new Error(`${name} is missing an argument`);
  return value;
}

function numericValue(value: JsonValue): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error("Catalog mapping value cannot be converted to a number");
}

function stringValue(value: JsonValue): string {
  if (typeof value !== "string") throw new Error("Catalog mapping value must be a string");
  return value;
}

function scalarText(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new Error("Catalog mapping value cannot be converted to text");
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJson(child)]));
  return value;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
