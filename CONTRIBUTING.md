# Contributing

## Setup

```bash
bun install
```

## Development

```bash
bun run typecheck   # TypeScript type check
bun run test        # Run vitest suite
bun run build       # Compile to dist/
```

## Testing

Unit tests use vitest with a fetch mock — no real Drive credentials needed:

```bash
bun run test
```

For live integration testing against real Drive, set up OAuth2 credentials and run:

```bash
bun test-live.ts [optional-folder-id]
```

## Structure

```
src/
  index.ts         — Public exports
  gdrive-fs.ts     — IFileSystem implementation
  gdrive-client.ts — Drive API wrapper (thin fetch layer)
  path-cache.ts    — Bidirectional path↔ID cache
  errors.ts        — Drive API errors → POSIX errnos
  types.ts         — Drive API response shapes + options
  type-check.ts    — Compile-time IFileSystem conformance check
  gdrive-fs.test.ts — Unit tests
```

## Adding a feature

1. The `IFileSystem` interface is in `node_modules/just-bash/dist/fs/interface.d.ts`
2. All methods must match the interface exactly
3. Run `bun run typecheck` to verify conformance
4. Add tests for any new behavior

## Publishing

```bash
bun run build
npm publish
```
