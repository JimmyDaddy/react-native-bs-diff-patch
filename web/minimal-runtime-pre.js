/* exported assert */

// Emscripten 6's WORKERFS calls assert even when MINIMAL_RUNTIME removes its
// assertion helper under -sASSERTIONS=0. This declaration is inserted into the
// generated module factory and is not a global or application-facing polyfill.
// eslint-disable-next-line no-unused-vars
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'WebAssembly runtime assertion failed');
  }
}
