export function canonicalJson(value: unknown): string {
  if (typeof value === 'string' && !value.isWellFormed()) throw new TypeError('Invalid Unicode');
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => `${canonicalJson(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Unsupported canonical JSON value');
}
