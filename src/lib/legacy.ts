// Small fill-ins for older phone browsers, loaded before anything else.
if (!Object.hasOwn)
  Object.defineProperty(Object, "hasOwn", {
    value: (o: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(o, key),
    configurable: true,
    writable: true,
  });
if (!Array.prototype.at)
  Object.defineProperty(Array.prototype, "at", {
    value(this: unknown[], i: number) {
      const n = Math.trunc(i) || 0;
      return this[n < 0 ? this.length + n : n];
    },
    configurable: true,
    writable: true,
  });
export {};
