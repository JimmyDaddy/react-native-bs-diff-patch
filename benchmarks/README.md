# Benchmarks

`web-wasm.json` and `native-core.json` are the inexpensive reference trend
lines. `web-wasm-large.json` and `native-core-large.json` record the explicit
16/64/128 MiB feasibility profile. They are not performance guarantees: file
contents, hardware, browser scheduling, and available memory can change
results.

Regenerate the 1, 10, and 50 MiB workload with:

```sh
BENCHMARK_OUTPUT=benchmarks/web-wasm.json yarn benchmark:web
BENCHMARK_OUTPUT=benchmarks/native-core.json yarn benchmark:native
BENCHMARK_OUTPUT=benchmarks/web-wasm-large.json yarn benchmark:large:web
BENCHMARK_OUTPUT=benchmarks/native-core-large.json yarn benchmark:large:native
```

The workload changes one byte per 4 KiB and verifies every restored byte. The
Web benchmark measures the WebAssembly core after a small initialization
warm-up; the public browser API additionally transfers data through a module
Worker. Every size runs in a fresh process so peak resident memory is
comparable.

On the recorded Apple M3 Pro baseline, native completed all three large sizes.
Web completed 16 and 64 MiB, but its 128 MiB diff returned `EWEBASSEMBLY` after
reaching the current WebAssembly memory boundary. The failed sample is retained
intentionally: it is a measured limitation, not a flaky result. See the
[large-file roadmap](../docs/large-files-v04.md) before interpreting or changing
these limits.
