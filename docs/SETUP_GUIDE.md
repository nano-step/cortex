# Cortex Setup Guide — Configuration for New Users

> Each user who installs Cortex from the `.dmg` will have their own data store at `~/Library/Application Support/Cortex/`.
> All API keys are encrypted using Electron safeStorage (macOS Keychain).

---

## Step 1: LLM Proxy (REQUIRED)

Cortex requires an LLM proxy to call AI models.

**In Cortex:** Settings → Proxy → enter URL + API Key

| Field | Value |
|-------|-------|
| Proxy URL | `https://proxy.hoainho.info` (or self-hosted) |
| Proxy Key | Contact your admin to receive a key |

**Test:** After entering → click "Test Connection" → should show "Connected" + latency.

---

## Step 2: Embeddings — Voyage AI (RECOMMENDED)

For Cortex to understand your code (RAG search), an embedding model is required.

### Get a Voyage API Key:
1. Go to https://dash.voyageai.com/
2. Sign up / Log in (Google or GitHub)
3. Left menu → **API Keys** → Create new key
4. Copy the key (format: `pa-...`)

**In Cortex:** Settings → Voyage AI → paste key

| Field | Value |
|-------|-------|
| Voyage API Key | `pa-xxxxxxxxxxxxx` |
| Model | `voyage-3-large` (auto-selected) |
| Dimensions | 1024 (compatible with current DB) |
| Free tier | 200M tokens/month |

---

## Step 3: Vector Database — Qdrant (OPTIONAL)

Qdrant stores embeddings for faster vector search than SQLite.

### Run Qdrant with Docker:
```bash
docker run -d --name qdrant \
  -p 6333:6333 \
  -v ~/qdrant-data:/qdrant/storage \
  qdrant/qdrant
```

**In Cortex:** Settings → Qdrant

| Field | Value |
|-------|-------|
| Qdrant URL | `http://localhost:6333` |
| API Key | (leave empty for local) |

### Qdrant Cloud (for teams):
1. Go to https://cloud.qdrant.io/
2. Create a cluster (free tier: 1GB storage)
3. Cluster → API Keys → create key
4. Copy URL (format: `https://xxx.us-east-1.aws.cloud.qdrant.io:6333`) + API Key

---

## Step 4: OpenRouter — Vision + Image Generation (OPTIONAL)

Allows Cortex to analyze images (FREE) and generate images (paid).

### Get an OpenRouter API Key:
1. Go to https://openrouter.ai/keys
2. Sign up (Google or GitHub)
3. **Create Key** → copy (format: `sk-or-v1-...`)
4. No credit required for vision models (free tier)

**In Cortex:** Settings → OpenRouter

| Field | Value |
|-------|-------|
| API Key | `sk-or-v1-xxxxxxxxxxxxx` |
| Free models | healer-alpha (vision), hunter-alpha (1M context) |
| Paid models | gemini-2.5-flash-image ($0.30/M — image gen) |

---

## Step 5: Atlassian — Jira + Confluence (OPTIONAL)

Connect Cortex to Jira issues and Confluence docs.

### Get an Atlassian API Token:
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. **Create API token** → name it "Cortex" → copy the token
3. Note your Atlassian account email

**In Cortex:** Settings → Atlassian

| Field | Value | Example |
|-------|-------|---------|
| Site URL | `https://your-domain.atlassian.net` | `https://playsweeps.atlassian.net` |
| Email | Your Atlassian email | `you@company.com` |
| API Token | Token you just created | `ATATT3xF...` |

---

## Step 6: GitHub — Code Context (OPTIONAL)

For Cortex to read GitHub repos, PRs, and issues.

### Get a GitHub PAT:
1. Go to https://github.com/settings/tokens?type=beta
2. **Generate new token** → Fine-grained
3. Permissions: Repository access → select needed repos
   - Contents: Read
   - Pull requests: Read
   - Issues: Read
4. Generate → copy token (format: `github_pat_...`)

**In Cortex:** Settings → GitHub → paste token

---

## Step 7: Perplexity — Web Search (OPTIONAL)

Cortex uses a Perplexity Pro session for web search.

**How to get cookies:**
1. Log in to https://www.perplexity.ai/ (Pro account required)
2. Open DevTools (F12) → Application → Cookies → `perplexity.ai`
3. Copy all cookies (or use the "EditThisCookie" extension)

**In Cortex:** Settings → Perplexity → paste cookies

---

## Summary: Priority Order

| Service | Required? | Free? | Used for |
|---------|:---------:|:-----:|----------|
| **LLM Proxy** | ✅ Required | Team key | Chat, analysis, code suggestions |
| **Voyage AI** | ✅ Recommended | 200M tokens free | RAG search, code understanding |
| **Qdrant** | ⚡ Optional | Docker local | Faster vector search |
| **OpenRouter** | ⚡ Optional | Vision free | Image analysis, image generation |
| **Atlassian** | ⚡ Optional | API token | Jira issues, Confluence docs |
| **GitHub** | ⚡ Optional | Free PAT | PR review, code context |
| **Perplexity** | ⚡ Optional | Pro required | Web search, URL reading |

---

## Troubleshooting

### "Embedding rate limited (429)"
→ Voyage key not set. Go to Settings → Voyage AI → paste key.

### "No agents produced results"
→ Proxy connection failed. Settings → Proxy → Test Connection.

### "Qdrant connection refused"
→ Docker is not running. `docker start qdrant`

### Image preview not showing
→ Fixed in v3.2 (CSP update). If still occurring: Ctrl+Shift+R to force refresh.

### Where is my data stored?
- macOS: `~/Library/Application Support/Cortex/`
- Database: `cortex.db` (SQLite)
- Settings + API keys: in `cortex.db` table `settings` (encrypted)
