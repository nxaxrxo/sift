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

Two commands, total:

```powershell
cd C:\Users\MarciNaro\Documents\VSCODE-PROJECTS\sift
npx wrangler login     # opens a browser, one click, done
node scripts/deploy.mjs
```

`scripts/deploy.mjs` (also `npm run deploy`) does the rest and stops at the first failure with
the reason: creates `sift-db` if it does not exist, writes its id into `wrangler.toml`, creates
the Pages project, uploads `public/`, then pokes `/api/sync` until the board has cards. It is
safe to re-run — an existing database and project are reused, never recreated.

It prints the live URL at the end. Expect `https://sift.pages.dev`.

### Keeping it fed

`.github/workflows/sync.yml` is already written and committed: a GitHub Actions schedule that
pokes `https://sift.pages.dev/api/sync` every 15 minutes. Pages Functions have no cron trigger of
their own, so this is the supported pattern. It needs nothing from you beyond the push — it will
start running the moment the repository is on GitHub (and the first few runs will 404 harmlessly
until the site is deployed).

If the project name or domain ends up different, change the one `url=` line in that file.

You can also trigger it by hand from the Actions tab, or point any other free cron at the same
URL instead.

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
