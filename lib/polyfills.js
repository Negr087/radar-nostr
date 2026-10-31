// What NDK and its dependencies use that older browsers lack (smart TVs run an
// old Chromium: Samsung Tizen 6.5 is Chromium 85). Next already polyfills `at` and
// `Object.hasOwn`; syntax is handled by `transpilePackages` in next.config.mjs.

if (!Array.prototype.findLast) {
  Array.prototype.findLast = function (fn, thisArg) {
    for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return this[i];
    return undefined;
  };
  Array.prototype.findLastIndex = function (fn, thisArg) {
    for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return i;
    return -1;
  };
}

if (!String.prototype.replaceAll) {
  String.prototype.replaceAll = function (search, replacement) {
    if (search instanceof RegExp) return this.replace(search, replacement);
    const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return this.replace(new RegExp(escaped, "g"), replacement);
  };
}

if (!Promise.any) {
  Promise.any = function (promises) {
    return new Promise((resolve, reject) => {
      const list = Array.from(promises);
      const errors = [];
      let pending = list.length;
      if (!pending) reject(new Error("All promises were rejected"));
      list.forEach((p, i) =>
        Promise.resolve(p).then(resolve, (err) => {
          errors[i] = err;
          if (--pending === 0) reject(Object.assign(new Error("All promises were rejected"), { errors }));
        })
      );
    });
  };
}
