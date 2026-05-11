# How to Serve Privacy Policy in OnTime

## Step 1: Store Files in Your Repo

```
your-repo/
├── docs/                          ← NEW: Documentation folder
│   ├── R2_DEPLOYMENT_GUIDE.md
│   ├── R2_SUMMARY.md
│   └── PRIVACY_POLICY_ID.md       ← Markdown source (for reference)
│
├── templates/
│   ├── index.html                 ← (existing)
│   └── privacy-policy.html        ← NEW: Web-served version
│
├── app.py
└── ...
```

## Step 2: Add Flask Route to app.py

**Find this line in app.py:**
```python
@app.route('/')
def index():
    return render_template('index.html')
```

**Add this route right after it:**
```python
@app.route('/privacy-policy')
def privacy_policy():
    """Serve Indonesian privacy policy (UU PDP compliant)."""
    return render_template('privacy-policy.html')
```

## Step 3: Copy Files to Your Repo

### Terminal Commands:
```bash
# Create docs folder and add documentation
mkdir -p docs
cp R2_DEPLOYMENT_GUIDE.md docs/
cp R2_SUMMARY.md docs/
cp PRIVACY_POLICY_ID.md docs/

# Add privacy policy to templates
cp privacy-policy.html templates/
```

## Step 4: Commit & Push to GitHub

```bash
git add docs/ templates/privacy-policy.html app.py
git commit -m "R2: Add UU PDP privacy policy and documentation"
git push origin main
```

## Step 5: Test

After Railway deploys:
1. **Visit:** `https://your-app.railway.app/privacy-policy`
2. **Expected:** Full HTML privacy policy in Indonesian (styled, responsive)

---

## File Organization Summary

| File | Location | Purpose |
|------|----------|---------|
| **R2_DEPLOYMENT_GUIDE.md** | `docs/` | Deployment instructions (for developers) |
| **R2_SUMMARY.md** | `docs/` | Release summary (for reference) |
| **PRIVACY_POLICY_ID.md** | `docs/` | Markdown source (backup/reference) |
| **privacy-policy.html** | `templates/` | Web-served privacy policy (user-facing) |
| **app.py** | root | Backend with `/privacy-policy` route |
| **app.js** | `static/js/` | Frontend (PDP pages link to `/privacy-policy`) |

---

## Links in UI

Users can access privacy policy from:

1. **PDP Profile page** → Link to `/privacy-policy`
2. **Consent modal** → Link to `/privacy-policy`
3. **Direct URL** → `https://your-app.railway.app/privacy-policy`

---

## Notes

- ✅ Privacy policy is **public** (no login required)
- ✅ Fully responsive on mobile/tablet
- ✅ Styled with modern CSS (gradient header, table styling)
- ✅ Indonesian language only
- ✅ Version clearly displayed (2026-05-v1)
- ✅ UU PDP compliant with all required sections

---

**You're all set for R2 deployment!**
