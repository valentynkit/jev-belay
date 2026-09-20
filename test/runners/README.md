# Runner output, one shape per file

`<runner>-pass.txt` and `<runner>-fail.txt` are real output, captured by running the runner
in a throwaway project under `/tmp`. `.doc.txt` is the runner's documented summary written
out by hand, because the runner is not installed on the machine that built this directory.

`test/runners.test.mjs` asserts belt 2 decides every file here, so a shape it cannot read
is a failing test. A clean compile prints no summary, so `cargo check`, `cargo clippy`,
`go build` and `go vet` have a failing file only; belt 1 reads the command for the rest.

Captured with `<cmd> > <runner>-<verdict>.txt 2>&1`, once green and once red, for:
`node --test`, `pytest`, `ruff check`, `bun test`, `deno test`, `cargo test`,
`cargo nextest run`, `cargo check`, `cargo clippy -- -D warnings`, `go test ./...`,
`go build ./...`, `go vet ./...`, `swift test`, `ctest`.
