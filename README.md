# just-bash-gdrive

Google Drive filesystem adapter for [just-bash](https://github.com/vercel-labs/just-bash).

Lets AI agents interact with Google Drive files using standard bash commands (`ls`, `cat`, `cp`, `grep`, etc.) without needing any Drive API knowledge.

Inspired by [just-bash-dropbox](https://github.com/manishrc/just-bash-dropbox) — the same pattern, applied to Google Drive.

## Install

```bash
npm install just-bash-gdrive just-bash
```

## Usage

```ts
import { Bash } from "just-bash";
import { GDriveFs } from "just-bash-gdrive";

const fs = new GDriveFs({
  // Static token or async provider for OAuth2 refresh
  accessToken: () => getAccessToken(),
  // Constrain agent to a specific folder (optional)
  rootFolderId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
});

const bash = new Bash({ fs });
const result = await bash.exec("ls -la /");
```

### Safe mode (read-only Drive, writes go to memory)

```ts
import { Bash, MountableFs, InMemoryFs } from "just-bash";
import { GDriveFs } from "just-bash-gdrive";

const drive = new GDriveFs({ accessToken: () => getAccessToken() });
const memory = new InMemoryFs();
const mountable = new MountableFs(memory);

// Mount Drive at /drive — writes go to memory, not Drive
await mountable.mount("/drive", drive);

const bash = new Bash({ fs: mountable });

// Reads come from Drive, writes stay in memory
await bash.exec("cat /drive/my-doc.txt");
await bash.exec("echo 'draft' > /draft.txt"); // memory only
```

### Prefetch for glob support

```ts
const fs = new GDriveFs({ accessToken: token, rootFolderId: myFolderId });

// Recursively cache all paths for glob/find support
await fs.prefetchAllPaths();

const bash = new Bash({ fs });
await bash.exec("find / -name '*.md'"); // works after prefetch
```

### AI SDK tool

```ts
import { generateText } from "ai";
import { bashTool } from "just-bash/ai-sdk";

const { text } = await generateText({
  model: yourModel,
  tools: { bash: bashTool({ fs }) },
  prompt: "List all markdown files in my Drive and summarize what they contain",
});
```

### Getting an access token

Use your preferred Google OAuth2 library. The `accessToken` option accepts either a static string or an async function — use the async form for long-running agents so the token refreshes automatically:

```ts
import { google } from "googleapis";

const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
auth.setCredentials({ refresh_token: REFRESH_TOKEN });

const fs = new GDriveFs({
  accessToken: async () => {
    const { token } = await auth.getAccessToken();
    return token!;
  },
});
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `accessToken` | `string \| () => Promise<string>` | required | OAuth2 access token or async provider |
| `rootFolderId` | `string` | `"root"` | Constrain agent to this Drive folder ID |

## How it works

Google Drive uses opaque file IDs rather than paths. `GDriveFs` maintains a bidirectional path-to-ID cache that is built lazily as you navigate the filesystem, or all at once via `prefetchAllPaths()`. Every bash command (`ls`, `cat`, `cp`, etc.) resolves paths through this cache before hitting the Drive API.

Rate limit handling: automatically retries on HTTP 429 with `Retry-After` backoff (up to 3 attempts).

## Limitations

- `chmod`, `symlink`, `link`, `readlink`, `utimes` throw `ENOSYS` — Drive has no POSIX permission or symlink concept
- `getAllPaths()` returns `[]` until `prefetchAllPaths()` is called — glob operations require prefetch
- `appendFile` reads the existing file, appends, then rewrites — Drive has no atomic append
- Google Workspace files (Docs, Sheets, Slides) cannot be read as raw content; use `gog-andy` or the Drive export API for those

## Inspiration

This adapter was built following the pattern established by [just-bash-dropbox](https://github.com/manishrc/just-bash-dropbox) by [@manishrc](https://github.com/manishrc). The `IFileSystem` interface, the token provider pattern, the `prefetchAllPaths` approach for glob support, and the `MountableFs` safe mode pattern are all drawn from that work. Thanks Manish.

## License

Apache-2.0
