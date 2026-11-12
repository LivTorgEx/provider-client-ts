import type { MappingDocument } from "../types/catalog.js";
import type { JsonValue } from "../types/json.js";

export type MappingContext = {
  input: JsonValue;
  provider_code: string;
  state: JsonValue;
};

export function assertMappingSupported(document: MappingDocument): void {
  if (document.context?.length) {
    throw new Error("Catalog mappings with context requests are not supported by this client version");
  }
  if (document.rules.some((rule) => rule.operation !== undefined)) {
    throw new Error("Catalog mappings with operation expressions are not supported by this client version");
  }
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
    const value = hasSource
      ? resolvePath(source, rule.source ?? "", context)
      : rule.value ?? null;
    result = setTarget(result, rule.target, value);
  }
  return result as Output;
}

function resolvePath(source: JsonValue, path: string, context: MappingContext): JsonValue {
  let root = source;
  let pathValue = path.trim();
  if (pathValue.startsWith("$.")) pathValue = pathValue.slice(2);
  if (pathValue === "$" || pathValue === "") return source;
  if (pathValue === "input") return context.input;
  if (pathValue === "provider_code") return context.provider_code;
  if (pathValue === "state") return context.state;

  const parts = pathValue.startsWith("/")
    ? pathValue.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    : pathValue.split(".").filter(Boolean);
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

  let value: unknown = root;
  for (const part of parts) {
    if (Array.isArray(value) && /^\d+$/.test(part)) {
      value = value[Number(part)];
    } else if (isRecord(value)) {
      value = value[part];
    } else {
      throw new Error(`Catalog mapping source is missing: ${path}`);
    }
  }
  if (!isJsonValue(value)) throw new Error(`Catalog mapping source is not JSON: ${path}`);
  return value;
}

function setTarget(root: JsonValue, path: string, value: JsonValue): JsonValue {
  const parts = path.trim().startsWith("/")
    ? path.trim().slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    : path.trim().replace(/^\$\.?/, "").split(".").filter(Boolean);
  if (parts.length === 0) return value;
  if (parts.includes("*") || parts.includes("**")) {
    throw new Error("Catalog mapping target wildcards are not supported by this client version");
  }

  const output = cloneJson(root);
  let cursor: JsonValue = output;
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    const nextIsIndex = /^\d+$/.test(parts[index + 1] ?? "");
    if (Array.isArray(cursor)) {
      const arrayIndex = Number(part);
      if (!Number.isInteger(arrayIndex)) throw new Error(`Invalid array mapping target: ${path}`);
      if (isLast) cursor[arrayIndex] = value;
      else {
        cursor[arrayIndex] ??= nextIsIndex ? [] : {};
        const child = cursor[arrayIndex];
        if (!isContainer(child)) throw new Error(`Invalid nested catalog mapping target: ${path}`);
        cursor = child;
      }
    } else if (isRecord(cursor)) {
      if (isLast) cursor[part] = value;
      else {
        cursor[part] ??= nextIsIndex ? [] : {};
        const child = cursor[part];
        if (!isContainer(child)) throw new Error(`Invalid nested catalog mapping target: ${path}`);
        cursor = child;
      }
    } else {
      throw new Error(`Invalid nested catalog mapping target: ${path}`);
    }
  });
  return output;
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJson(child)]));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isContainer(value: JsonValue | undefined): value is JsonValue[] | Record<string, JsonValue> {
  return Array.isArray(value) || (typeof value === "object" && value !== null);
}
