# Cortex Setup Guide — Cấu Hình Cho Người Dùng Mới

> Mỗi user khi cài Cortex từ .dmg sẽ có data store riêng tại `~/Library/Application Support/Cortex/`.
> Tất cả API keys được mã hóa bằng Electron safeStorage (macOS Keychain).

---

## Bước 1: LLM Proxy (BẮT BUỘC)

Cortex cần 1 LLM proxy để gọi các models AI.

**Trong Cortex:** Settings → Proxy → nhập URL + API Key

| Field | Giá trị |
|-------|---------|
| Proxy URL | `https://proxy.hoainho.info` (hoặc self-hosted) |
| Proxy Key | Liên hệ admin để nhận key |

**Test:** Sau khi nhập → nút "Test Connection" → phải thấy "Connected" + latency.

---

## Bước 2: Embedding — Voyage AI (KHUYÊN DÙNG)

Để Cortex hiểu code của bạn (RAG search), cần embedding model.

### Lấy Voyage API Key:
1. Vào https://dash.voyageai.com/
2. Sign up / Login (Google hoặc GitHub)
3. Menu trái → **API Keys** → Create new key
4. Copy key (dạng `pa-...`)

**Trong Cortex:** Settings → Voyage AI → paste key

| Field | Giá trị |
|-------|---------|
| Voyage API Key | `pa-xxxxxxxxxxxxx` |
| Model | `voyage-3-large` (tự động) |
| Dimensions | 1024 (tương thích DB hiện tại) |
| Free tier | 200M tokens/tháng |

---

## Bước 3: Vector Database — Qdrant (TÙY CHỌN)

Qdrant lưu embeddings cho vector search nhanh hơn SQLite.

### Chạy Qdrant bằng Docker:
```bash
docker run -d --name qdrant \
  -p 6333:6333 \
  -v ~/qdrant-data:/qdrant/storage \
  qdrant/qdrant
```

**Trong Cortex:** Settings → Qdrant

| Field | Giá trị |
|-------|---------|
| Qdrant URL | `http://localhost:6333` |
| API Key | (để trống nếu local) |

### Qdrant Cloud (cho team):
1. Vào https://cloud.qdrant.io/
2. Tạo cluster (free tier: 1GB storage)
3. Cluster → API Keys → tạo key
4. Copy URL (dạng `https://xxx.us-east-1.aws.cloud.qdrant.io:6333`) + API Key

---

## Bước 4: OpenRouter — Vision + Image Generation (TÙY CHỌN)

Cho phép Cortex phân tích ảnh (FREE) và generate ảnh (paid).

### Lấy OpenRouter API Key:
1. Vào https://openrouter.ai/keys
2. Sign up (Google hoặc GitHub)
3. **Create Key** → copy (dạng `sk-or-v1-...`)
4. KHÔNG cần add credit cho vision models (free tier)

**Trong Cortex:** Settings → OpenRouter

| Field | Giá trị |
|-------|---------|
| API Key | `sk-or-v1-xxxxxxxxxxxxx` |
| Free models | healer-alpha (vision), hunter-alpha (1M context) |
| Paid models | gemini-2.5-flash-image ($0.30/M — image gen) |

---

## Bước 5: Atlassian — Jira + Confluence (TÙY CHỌN)

Kết nối Cortex với Jira issues và Confluence docs.

### Lấy Atlassian API Token:
1. Vào https://id.atlassian.com/manage-profile/security/api-tokens
2. **Create API token** → đặt tên "Cortex" → copy token
3. Ghi nhớ email Atlassian của bạn

**Trong Cortex:** Settings → Atlassian

| Field | Giá trị | Ví dụ |
|-------|---------|-------|
| Site URL | `https://your-domain.atlassian.net` | `https://playsweeps.atlassian.net` |
| Email | Email Atlassian | `you@company.com` |
| API Token | Token vừa tạo | `ATATT3xF...` |

---

## Bước 6: GitHub — Code Context (TÙY CHỌN)

Để Cortex đọc GitHub repos, PRs, issues.

### Lấy GitHub PAT:
1. Vào https://github.com/settings/tokens?type=beta
2. **Generate new token** → Fine-grained
3. Permissions: Repository access → chọn repos cần thiết
   - Contents: Read
   - Pull requests: Read
   - Issues: Read
4. Generate → copy token (dạng `github_pat_...`)

**Trong Cortex:** Settings → GitHub → paste token

---

## Bước 7: Perplexity — Web Search (TÙY CHỌN)

Cortex dùng Perplexity Pro session để search web.

**Cách lấy cookies:**
1. Login vào https://www.perplexity.ai/ (cần Pro account)
2. Mở DevTools (F12) → Application → Cookies → `perplexity.ai`
3. Copy tất cả cookies (hoặc dùng extension "EditThisCookie")

**Trong Cortex:** Settings → Perplexity → paste cookies

---

## Tổng Hợp: Mức Độ Ưu Tiên

| Service | Bắt buộc? | Free? | Dùng cho |
|---------|-----------|-------|----------|
| **LLM Proxy** | ✅ Bắt buộc | Team key | Chat, analysis, code suggestions |
| **Voyage AI** | ✅ Khuyên dùng | 200M tokens free | RAG search, code understanding |
| **Qdrant** | ⚡ Tùy chọn | Docker local | Faster vector search |
| **OpenRouter** | ⚡ Tùy chọn | Vision free | Image analysis, image generation |
| **Atlassian** | ⚡ Tùy chọn | Có token | Jira issues, Confluence docs |
| **GitHub** | ⚡ Tùy chọn | Free PAT | PR review, code context |
| **Perplexity** | ⚡ Tùy chọn | Cần Pro | Web search, URL reading |

---

## Troubleshooting

### "Embedding rate limited (429)"
→ Voyage key chưa set. Vào Settings → Voyage AI → paste key.

### "No agents produced results"
→ Proxy connection failed. Settings → Proxy → Test Connection.

### "Qdrant connection refused"
→ Docker chưa chạy. `docker start qdrant`

### Ảnh preview không hiện
→ Đã fix trong v3.2 (CSP update). Nếu vẫn lỗi: Ctrl+Shift+R force refresh.

### Data lưu ở đâu?
- macOS: `~/Library/Application Support/Cortex/`
- Database: `cortex.db` (SQLite)
- Settings + API keys: trong `cortex.db` table `settings` (encrypted)
