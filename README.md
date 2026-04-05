# just-bash-gdrive

Google Drive filesystem adapter for [just-bash](https://github.com/vercel-labs/just-bash).

Lets AI agents interact with Google Drive files using standard bash commands (`ls`, `cat`, `cp`, `grep`, etc.) without needing any Drive API knowledge.

Inspired by [just-bash-dropbox](https://github.com/manishrc/just-bash-dropbox) — the same pattern, applied to Google Drive.

## Why not just use the Drive API or gogcli?

Tools like [gogcli](https://github.com/steipete/gogcli) are great when *you* know exactly what you want to do with Drive. You write the specific command, it runs.

`just-bash-gdrive` is for when you want to hand an *agent* the ability to figure that out — and do it safely.

**Compositional bash logic at runtime.** An LLM can write arbitrary pipelines on the fly — `find / -name "*.md" | xargs grep "keyword" | sort` — without you anticipating every possible query in advance. No new API code per use case.

**Drive as a mountable filesystem.** `MountableFs` lets you compose Drive with other filesystems. An agent works across `/drive` (real files) and `/tmp` (scratch space) in the same bash session. The Drive API has no composability story.

**Safe exploration mode.** Mount Drive read-only — the agent can `cat`, `grep`, and `find` freely with zero write risk. There's no equivalent in any Drive CLI.

**AI SDK tool wrapper.** The `bash-tool` package from just-bash wraps the whole thing as a single LLM tool. One line to give any model bash access to Drive.

**The rule of thumb:** use gogcli when you're writing the script. Use just-bash-gdrive when the agent is writing the script.

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

The `accessToken` option accepts either a static string or an async function — use the async form for long-running agents so the token refreshes automatically.

**Option 1: [gogcli](https://github.com/steipete/gogcli) (recommended for quick setup)**

gogcli handles Google OAuth2 authentication and stores tokens locally. After running `gog auth login`, you can retrieve tokens programmatically:

```bash
# Install gogcli
npm install -g gogcli

# Authenticate (opens browser)
gog auth login
```

```ts
import { execSync } from "child_process";

const fs = new GDriveFs({
  accessToken: () => {
    // gogcli outputs a fresh token to stdout
    return execSync("gog auth token", { encoding: "utf8" }).trim();
  },
});
```

**Option 2: googleapis (full OAuth2 flow)**

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

**Option 3: Static token (scripts and testing)**

For short-lived scripts, pass a token directly. Get one via `gog auth token` or the [OAuth2 Playground](https://developers.google.com/oauthplayground).

```ts
const fs = new GDriveFs({ accessToken: "ya29.your_token_here" });
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
- Google Workspace files (Docs, Sheets, Slides) cannot be read as raw content; use `gog export` (gogcli) or the Drive export API to convert them first

## Inspiration

This adapter was built following the pattern established by [just-bash-dropbox](https://github.com/manishrc/just-bash-dropbox) by [@manishrc](https://github.com/manishrc). The `IFileSystem` interface, the token provider pattern, the `prefetchAllPaths` approach for glob support, and the `MountableFs` safe mode pattern are all drawn from that work. Thanks Manish.

## License

Apache-2.0
