# Sift — deploy handoff

Everything is built, tested and running locally. Two things need your hands, both because
a credential is missing rather than because anything is broken.

Repo: `C:\Users\MarciNaro\Documents\VSCODE-PROJECTS\sift`

---

## 1. GitHub — the repo exists, the push is refused

`https://github.com/nxaxrxo/sift` is created (public, empty). The commit is made locally
(`68a325c`). The push fails with **403** because the logged-in token cannot write repository
contents:

```
$ gh api -X PUT repos/nxaxrxo/sift/contents/probe.txt -f message=probe -f content=dGVzdA==
gh: Resource not accessible by personal access token (HTTP 403)
```

`gh auth status` shows the account is `nxaxrxo`, but the token is a fine-grained PAT with
**metadata: read** only. The vault entry `github-nsfw-pat` belongs to a different account
(`pizzydodaglizzy`), which has no access to this repo — it returns the same 403.

**Fix, either one:**

```powershell
gh auth refresh -h github.com -s repo       # adds the scope, walks you through a browser
# or, if you'd rather use a token:
$env:GH_TOKEN="<a classic PAT with 'repo'>"; gh auth login --with-token
```

Then, and this is the whole job:

```powershell
cd C:\Users\MarciNaro\Documents\VSCODE-PROJECTS\sift
git push -u origin main
```

`origin` is already set, the branch is already `main`, the commit is already made.

---

## 2. Cloudflare — never authenticated

```
$ npx wrangler whoami
You are not authenticated. Please run `wrangler login`.
```

There is no Cloudflare token in the vault and none in the environment, so the deploy cannot
be finished from here.

```powershell
cd C:\Users\MarciNaro\Documents\VSCODE-PROJECTS\sift
npx wrangler login                    # opens a browser, one click
npx wrangler d1 create sift-db        # prints a database_id
```

Paste that id into `wrangler.toml`, replacing the placeholder:

```toml
database_id = "00000000-0000-0000-0000-000000000000"
```

Then:

```powershell
npx wrangler pages project create sift --production-branch main
npx wrangler pages deploy public --project-name sift
```

First page load triggers a sync. The site is then at `https://sift.pages.dev`.

To keep it fed without anyone visiting, point any free cron at
`https://sift.pages.dev/api/sync` every 10 minutes — Pages Functions have no cron trigger of
their own, and this is the supported pattern.

---

## What is already proven, so you know you're not deploying a guess

| check | result |
|---|---|
| `npm test` | 44 tests, 0 failures |
| real ingest, live internet | 81 of 82 feeds ok, **1,237 articles**, 5.6 s |
| cursor paging | 5 pages, 125 unique keys, **0 duplicates** |
| local site | `wrangler pages dev` on :8788, all three endpoints answering |
| layout at 390 / 820 / 1440 px | 0 horizontal overflow, 0 broken image frames |

## If you'd rather just look at it first

```powershell
cd C:\Users\MarciNaro\Documents\VSCODE-PROJECTS\sift
node scripts/preview.mjs start     # hidden server on http://localhost:8788
node scripts/preview.mjs shot      # headless screenshots into .dev\
node scripts/preview.mjs stop
```

Or open `http://localhost:8788` in your own browser — the server is already running.
