# Knesset Protocol Reader

Local Node app for browsing and downloading official Knesset plenary protocols,
committee protocols, and member-focused protocol references and analyses.

## What it does

- Pulls all plenum protocol records from the official Knesset OData feed.
- Pulls committee protocol records from the official Knesset OData feed for the last five years.
- Shows separate website sections for plenum sittings and committee sittings.
- Shows a `חברי הכנסת` section with dedicated pages for the supplied MK list, grouped by party.
- Scans protocols from `2022-01-01` onward and links each member page to protocols where that member was identified as a speaker.
- Builds one utterance file per member, grouped by protocol, for speeches of at least 50 words.
- Can run an AI political analysis for all members and show it inside each member page, with explicit and implicit readings plus four ideological axes.
- Each member page can also trigger or refresh the analysis for that member only.
- Opens each protocol in its own reader page.
- Downloads the original file for a single protocol with a date-based filename.
- Runs a bulk download job for each section, saving local files with date-based filenames.

## Start

```powershell
npm.cmd install
npm.cmd start
```

Then open [http://localhost:3000](http://localhost:3000).

If you only want protocol browsing, downloads, and member quote files, the app can still run without `GEMINI_API_KEY`.
The key is required only for the bulk political-analysis feature in the `חברי הכנסת` section.
If you already use Google's default variable name, `GOOGLE_API_KEY` works too.

To avoid setting the key manually on every startup, create a local `.env.local`
file in the project root:

```text
GEMINI_API_KEY=your_api_key_here
```

The app loads `.env.local` automatically on startup, and the file is ignored by git.

## Access Control

Privileged actions are now configured only through environment variables.

- If you do not set any `AUTH_*` credentials, the public site still runs, but login-protected actions stay unavailable.
- For local development, you can add credentials to `.env.local`.
- For production, put the credentials only in the server-side `.env` file and never commit them.

Minimum secure production setup:

```text
AUTH_SESSION_SECRET=replace_with_a_long_random_secret_at_least_32_chars
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=replace_with_a_strong_admin_password
AUTH_COOKIE_SECURE=auto
```

## Staging vs Production

To avoid redeploying the real site for every UI revision, use your own computer as a local
staging environment and keep the VPS as production only.

### Local staging

Run the staging copy locally on a separate port:

```powershell
npm.cmd run start:staging
```

Then open:

```text
http://localhost:3001
```

If `3001` is already in use, the app will automatically try the next free local port and print the correct address in the terminal.

This lets you inspect the exact code you are editing before you touch the public website.

### Share the staging copy temporarily

If you want to show the staging version to someone else before production, start a temporary
Cloudflare tunnel that points to the staging port:

```powershell
npm.cmd run share:staging
```

This publishes a temporary `trycloudflare.com` URL for the local staging copy. If staging had to move from `3001` to another free port, the share script follows the running staging instance.

To stop the temporary public link:

```powershell
npm.cmd run share:cloudflare:stop
```

### Recommended workflow

1. Make your code changes locally.
2. Run `npm.cmd run start:staging`.
3. Check the exact `http://localhost:...` address printed in the terminal.
4. Optionally run `npm.cmd run share:staging` if you want a temporary review link.
5. Only after you are satisfied, run the production deployment command from your own computer.

### Move the current site to production

Use the deployment helper when you want production to receive both the new code and the current persistent site data.
The default deploy is intentionally lightweight so it does not resend the huge protocol/download caches every time.
It also supports SSH key auth so you do not have to sit near the computer during a long deploy.

1. On your own computer, put these values in `.env.local` or `.env`:

```text
PRODUCTION_SSH_TARGET=root@YOUR_SERVER_IP
PRODUCTION_SSH_PORT=22
PRODUCTION_SSH_KEY_PATH=C:/Users/YOUR_USER/.ssh/knesset_prod
PRODUCTION_APP_PATH=/opt/knesset-site
```

2. If you want passwordless deploys, set up a dedicated SSH key once:

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\knesset_prod -C "knesset-prod"
Get-Content $env:USERPROFILE\.ssh\knesset_prod.pub | ssh root@YOUR_SERVER_IP "umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys"
```

If the key has a passphrase, load it into `ssh-agent` before deploying so the deploy stays unattended.

3. Check that SSH auth works before you start any upload:

```powershell
npm.cmd run deploy:prod:check-auth
```

4. On the server, create `PRODUCTION_APP_PATH/.env` once and keep your production secrets there. For example:

```text
APP_DOMAIN=your-domain.example
GEMINI_API_KEY=your_gemini_api_key_here
GOOGLE_API_KEY=
AUTH_SESSION_SECRET=replace_with_a_long_random_secret_at_least_32_chars
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=replace_with_a_strong_admin_password
AUTH_COOKIE_SECURE=auto
```

5. Preview what will be copied without changing the server:

```powershell
npm.cmd run deploy:prod -- --dry-run
```

6. Run the real deployment:

```powershell
npm.cmd run deploy:prod
```

What the default `npm.cmd run deploy:prod` command copies to production:

- code and site changes from `src/`, `public/`, `Dockerfile`, `Caddyfile`, and the Docker Compose files
- contact data from `data/member-contact-directory.json` and the contact report files
- law, protocol, and vote metadata from the cached JSON files plus `data/law-raw` and `data/law-parsed`
- generated outputs such as `data/member-utterances`, `data/member-analyses`, `data/member-comparisons.json`, `data/law-analyses`, `data/law-surprise-explanations`, `data/fact-checks`, and `data/methodology-documentation.json`

What it intentionally does not copy:

- authentication secrets or login credentials; those stay in the server-side `.env` file only
- the very large cache folders `data/downloads`, `data/raw`, `data/parsed`, `data/committee-raw`, and `data/committee-parsed`
- browser profile folders under `data/chrome-*`
- tunnel files, logs, pid files, and temporary runtime artifacts
- temporary admin preview files such as `data/admin-law-update-preview.json`

If you do want the slow, full cache migration too, run:

```powershell
npm.cmd run deploy:prod:full-data
```

That full-data deploy includes the large folders that are skipped by default:

- `data/downloads`
- `data/raw`
- `data/parsed`
- `data/committee-raw`
- `data/committee-parsed`

With the lightweight default deploy, production can still fetch or rebuild those skipped cache files on demand.
That means the first request for some protocol pages, committee protocol pages, or original file downloads may be slower after deployment, but the site does not have to wait for a multi-hour cache upload before you go live.

If you only want to sync the files first and restart production yourself later:

```powershell
npm.cmd run deploy:prod -- --skip-restart
```

Because `docker-compose.prod.yml` mounts `./data` into `/app/data`, the data copied into the server's `data/` folder becomes the live production dataset after the stack is rebuilt.

### Promote staged law analyses to production

If you run a big law-axis analysis locally on staging and want production to use those exact results,
promote the local `data/law-analyses` folder to the VPS explicitly.

1. Put these values in `.env.local` or `.env` on your own computer:

```text
PRODUCTION_SSH_TARGET=root@YOUR_SERVER_IP
PRODUCTION_SSH_PORT=22
PRODUCTION_SSH_KEY_PATH=C:/Users/YOUR_USER/.ssh/knesset_prod
PRODUCTION_APP_PATH=/opt/knesset-site
```

2. Run the staging-side law analysis until `data/law-analyses` contains the results you want.
3. Push those results to production:

```powershell
npm.cmd run promote:law-analyses
```

What this does:

- copies your local staging `data/law-analyses` results to the VPS
- replaces the production `data/law-analyses` folder with those files
- overwrites the current production law-axis analyses with the staged versions

Because the production site reads law analyses directly from `data/law-analyses`, the promoted results
become the live production results as soon as the copy finishes.

### Promote all staged analysis data to production

If you want one manual catch-up command for every analysis type, use:

```powershell
npm.cmd run promote:analyses
```

This pushes all current staged analysis outputs to production, including:

- `data/member-utterances`
- `data/member-analyses`
- `data/member-comparisons.json`
- `data/law-analyses`
- `data/law-surprise-explanations`

The same promotion system now also supports the core data layer when staging writes it:

- `data/laws.json`
- `data/law-votes.json`
- files under `data/law-raw`
- files under `data/law-parsed`
- `data/protocols.json`
- files under `data/raw`
- files under `data/parsed`
- `data/committee-protocols.json`
- files under `data/committee-raw`
- files under `data/committee-parsed`
- `data/member-protocol-index.json`

### Auto-promote staging analyses to production

If you do not want to run a promotion command after each staging analysis job, enable automatic promotion
in your local staging environment.

Add these values to `.env.local` on your own computer:

```text
PRODUCTION_SSH_TARGET=root@YOUR_SERVER_IP
PRODUCTION_SSH_PORT=22
PRODUCTION_SSH_KEY_PATH=C:/Users/YOUR_USER/.ssh/knesset_prod
PRODUCTION_APP_PATH=/opt/knesset-site
AUTO_PROMOTE_ANALYSES_TO_PRODUCTION=true
PRODUCTION_SYNC_DEBOUNCE_MS=15000
```

With that enabled:

- staging watches for completed analysis writes
- staging also watches for completed writes to the core law/protocol/vote data layer
- it batches repeated writes together
- after a short quiet period, it syncs the changed staged data to production automatically

This is the recommended setup if you want staging analysis runs to update production without separate
promotion commands every time.

### Notes

- `npm.cmd start` is still your normal local run mode.
- `npm.cmd run start:staging` is the safer preview mode for revisions before deployment.
- The real production site at your domain is updated only when you manually redeploy the changed files.

## Run It Online

The app is now prepared for real online deployment with Docker.

Files added for this:

- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `Caddyfile`
- `.env.example`

### Quick server deployment

On a Linux server with Docker and Docker Compose installed:

1. Copy the project to the server.
2. Create a `.env` file in the project root and put your Gemini key there if you want AI analysis:

```text
GEMINI_API_KEY=your_api_key_here
AUTH_SESSION_SECRET=replace_with_a_long_random_secret_at_least_32_chars
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=replace_with_a_strong_admin_password
```

3. Start the app:

```bash
docker compose up -d --build
```

4. Open the server in a browser:

```text
http://YOUR_SERVER_IP:3000
```

### Run it with a real domain and HTTPS

For an actual public website with a domain, use the production compose file with Caddy as the HTTPS reverse proxy.

1. Point your domain or subdomain to the server IP with an `A` record.
2. Create a `.env` file in the project root:

```text
APP_DOMAIN=your-domain.example
GEMINI_API_KEY=your_gemini_api_key_here
```

3. Open inbound ports `80` and `443` on the server firewall.
4. Start the production stack:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

5. Open:

```text
https://YOUR_DOMAIN
```

In this setup:

- `knesset-reader` serves the Node app internally on port `3000`
- `caddy` terminates HTTPS and routes public traffic to the app
- TLS certificates are handled automatically by Caddy for public domains
- all site data is still persisted in `./data`

### Persistent data

The container stores all downloaded files, parsed protocols, member quote files,
member analyses, and comparison caches inside `/app/data`.

`docker-compose.yml` already maps that to a persistent host folder:

```text
./data:/app/data
```

That means the website keeps its downloaded and computed data even after restarts.
The `npm.cmd run deploy:prod` helper copies the essential live `data/` files into that same
server-side folder before rebuilding production, and `npm.cmd run deploy:prod:full-data`
adds the large raw/parsed/download caches when you explicitly want a full cache sync.

### Important note for production

For a proper public website, place the app behind a reverse proxy or a hosting
setup that gives you HTTPS and a domain name. The app itself is ready to run
publicly on port `3000`, but TLS/domain setup depends on the server you choose.

## Notes

- The first plenum metadata sync pulls about 20,000+ records, so the first load can take a little while.
- The committee section currently loads records from the last five years only.
- The `חברי הכנסת` section builds a local speaker index from `2022-01-01` onward. The first full scan can take a while because it parses a large number of committee protocols.
- The AI analysis button first makes sure all member utterance files are up to date, and only then starts the LLM analysis run.
- Older documents are legacy Word `.doc` files and newer ones are really DOCX files with a `.doc` extension from the source system.
- Bulk-downloaded files are written to `data/downloads/all-protocols/`.
- Bulk-downloaded committee files are written to `data/downloads/committee-protocols/`.
