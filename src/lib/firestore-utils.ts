function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function omitUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => omitUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, omitUndefinedDeep(child)])
    ) as T;
  }

  return value;
}
