# R2 Complete File Organization Guide

## 📁 Your Repo Structure After R2

```
workpulse/  (or ichalichali/workpluse)
│
├── 📂 docs/                           ← NEW: Documentation folder
│   ├── R2_DEPLOYMENT_GUIDE.md         ← How to deploy R2
│   ├── R2_SUMMARY.md                  ← What's new in R2
│   └── PRIVACY_POLICY_ID.md           ← Markdown source (reference)
│
├── 📂 templates/
│   ├── index.html                     ← (existing)
│   └── privacy-policy.html            ← NEW: Web-served privacy policy
│
├── 📂 static/
│   └── 📂 js/
│       └── app.js                     ← UPDATED: R2 features (2,442 lines)
│
├── app.py                             ← UPDATED: R2 backend (1,224 lines)
├── requirements.txt                   ← (existing, no changes)
├── Procfile                           ← (existing, no changes)
├── railway.json                       ← (existing, no changes)
├── .python-version                    ← (existing, no changes)
├── README.md                          ← (existing, may update)
└── ...
```

---

## 📋 What to Do Now

### 1️⃣ Create `docs/` Folder in Your Repo

```bash
mkdir -p docs
```

### 2️⃣ Copy Documentation Files to `docs/`

**From `/mnt/user-data/outputs/` to your local `docs/`:**
- `R2_DEPLOYMENT_GUIDE.md`
- `R2_SUMMARY.md`
- `PRIVACY_POLICY_ID.md`

### 3️⃣ Copy Privacy Policy HTML to `templates/`

**From `/mnt/user-data/outputs/` to your local `templates/`:**
- `privacy-policy.html`

### 4️⃣ Replace App Files

**From `/mnt/user-data/outputs/` to your local root:**
- `app.py` (replace existing)
- Copy to `static/js/app.js` (replace existing)

### 5️⃣ Update `app.py` — Add Privacy Policy Route

**Find this in `app.py`:**
```python
@app.route('/')
def index():
    return render_template('index.html')
```

**Add this right after:**
```python
@app.route('/privacy-policy')
def privacy_policy():
    """Serve Indonesian privacy policy (UU PDP compliant)."""
    return render_template('privacy-policy.html')
```

### 6️⃣ Commit & Deploy

```bash
git add docs/ templates/privacy-policy.html app.py static/js/app.js
git commit -m "R2: UU PDP Compliance + Consent"
git push origin main
```

**Railway auto-deploys** (~2 min)

---

## 📂 File Purposes

| Folder | File | Purpose | Audience |
|--------|------|---------|----------|
| `docs/` | R2_DEPLOYMENT_GUIDE.md | Step-by-step deployment instructions | Developers |
| `docs/` | R2_SUMMARY.md | Feature summary & code statistics | Developers |
| `docs/` | PRIVACY_POLICY_ID.md | Markdown source (backup) | Developers |
| `templates/` | privacy-policy.html | Web-served privacy policy (public) | Employees |
| root | app.py | Backend with R2 endpoints | System |
| `static/js/` | app.js | Frontend with R2 UI | System |

---

## 🔗 Access Points

**After deployment, users can access privacy policy from:**

1. **Public URL:** `https://your-app.railway.app/privacy-policy`
2. **Employee PDP page:** Click 🔒 Profil & Privasi → Link in page
3. **Consent modal:** On first login → Link to policy
4. **HR Admin:** Can reference `/privacy-policy` when reviewing deletions

---

## ⚡ Quick Checklist Before Pushing

- [ ] Created `docs/` folder
- [ ] Copied 3 markdown files to `docs/`
- [ ] Copied `privacy-policy.html` to `templates/`
- [ ] Replaced `app.py` (1,224 lines)
- [ ] Replaced `static/js/app.js` (2,442 lines)
- [ ] Added `/privacy-policy` route to `app.py`
- [ ] Verified syntax: `python3 -m py_compile app.py` ✓
- [ ] Verified syntax: `node -c static/js/app.js` ✓
- [ ] Committed & pushed to main

---

## 🚀 After Push (Verification)

1. **Railway builds** (2-3 min)
2. **Test login** → Consent modal appears
3. **Visit** `https://your-app.railway.app/privacy-policy` → HTML policy loads
4. **Click** 🔒 Profil & Privasi → Can download data + request deletion
5. **Login as HR** → See 🗑️ Deletion Requests

---

## 📞 File Download Links

All files are ready in `/mnt/user-data/outputs/`:
- ✅ app.py
- ✅ app.js
- ✅ PRIVACY_POLICY_ID.md
- ✅ privacy-policy.html
- ✅ R2_DEPLOYMENT_GUIDE.md
- ✅ R2_SUMMARY.md
- ✅ PRIVACY_POLICY_SETUP.md (setup instructions)

**Download all, organize into repo as shown above, and push to main.**

---

**R2 is complete. Let me know once you've deployed and I can help with R3!** 🚀
