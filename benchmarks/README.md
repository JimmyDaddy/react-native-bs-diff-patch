# Benchmarks

`web-wasm.json` is a reproducible reference measurement for the checked-in
WebAssembly implementation. It is not a performance guarantee: file contents,
hardware, browser scheduling, and available memory can change results.

Regenerate the 1, 10, and 50 MiB workload with:

```sh
BENCHMARK_OUTPUT=benchmarks/web-wasm.json yarn benchmark:web
```

The workload changes one byte per 4 KiB and verifies every restored byte. The
benchmark measures the WebAssembly core after a small initialization warm-up;
the public browser API additionally transfers data through a module Worker.
