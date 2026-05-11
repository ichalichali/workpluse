# R2 Deployment Guide: UU PDP Compliance + Consent

**Release:** R2 · UU PDP Compliance + Consent  
**Date:** 11 Mei 2026  
**Status:** ✅ Ready for Deployment

---

## 📋 What's New in R2

### Backend (`app.py`)
- ✅ New tables: `consent_log`, `data_deletion_requests`
- ✅ Soft-delete columns: `deleted_at` on `users`, `attendance`, `leave_requests`
- ✅ 6 new endpoints for consent, data export, deletion requests
- ✅ Login now returns `consent_accepted` flag
- ✅ Migration R2 in `schema_migrations`

### Frontend (`app.js`)
- ✅ Consent modal (Indonesian) — shows on first login without consent
- ✅ New page: **🔒 Profil & Privasi** (Employee sidebar)
  - Download personal data (JSON export)
  - Request account deletion with reason
- ✅ New page: **🗑️ Deletion Requests** (HR Admin sidebar)
  - View pending deletion requests
  - Approve/reject with review notes
- ✅ Sidebar navigation updated for both roles

### Documentation
- ✅ Privacy Policy (Indonesian, UU PDP compliant)

---

## 🚀 Deployment Steps

### 1. Backup Database
```bash
# On Railway, use PostgreSQL CLI backup
# Or download backup through Railway dashboard
```

**⚠️ CRITICAL:** Backup before applying migration (adds soft-delete columns to 3 tables)

### 2. Update Code on Railway

1. **Pull latest code locally:**
   ```bash
   git pull origin main
   ```

2. **Replace files:**
   - `app.py` (1,224 lines) — includes R2 migration in `init_db()`
   - `static/js/app.js` (2,442 lines) — includes consent modal + PDP pages

3. **Commit & Push:**
   ```bash
   git add app.py static/js/app.js
   git commit -m "R2: UU PDP Compliance + Consent"
   git push origin main
   ```

4. **Railway auto-deploys** — wait for build to complete (~2 min)

### 3. Verify Deployment

**Test Consent Flow:**
1. Open OnTime in incognito window (clear localStorage)
2. Create a new test user or logout
3. Login with test credentials
4. **Expected:** Consent modal appears (Indonesian text)
5. Click "Saya Setuju" → should redirect to dashboard
6. Check `SELECT * FROM consent_log` in database

**Test PDP Features:**
1. Login as regular employee
2. Click sidebar: **🔒 Profil & Privasi**
3. ✅ Download button works (downloads JSON)
4. ✅ Deletion request form works
5. Logout, login as HR Admin
6. Click sidebar: **🗑️ Deletion Requests**
7. ✅ Should show pending requests
8. ✅ Review/approve/reject buttons work

### 4. Deploy Privacy Policy

**Option A: Host as Static Page**
```bash
# Save PRIVACY_POLICY_ID.md as /templates/privacy-policy.html
# Add route in app.py:
@app.route('/privacy-policy')
def privacy_policy():
    return render_template('privacy-policy.html')
```

**Option B: Link in UI**
- Add link in footer or Profile page pointing to `/privacy-policy`
- Users can access anytime

---

## 📊 Database Schema Changes

### New Tables Created
```sql
-- Consent tracking
CREATE TABLE consent_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    consent_type TEXT,           -- 'privacy_policy'
    version TEXT,                -- '2026-05-v1'
    accepted BOOLEAN,
    ip_address TEXT,
    accepted_at TIMESTAMP WITH TIME ZONE
);

-- Deletion requests
CREATE TABLE data_deletion_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    reason TEXT,
    status TEXT DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
    requested_at TIMESTAMP WITH TIME ZONE,
    reviewed_by INTEGER,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT
);
```

### Columns Added (Soft-Delete)
```sql
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE attendance ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE leave_requests ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
```

---

## 🔐 Security Notes

### Soft-Delete Implementation
- **All SELECT queries** must now include `WHERE deleted_at IS NULL`
- Prevents returning deleted users' records
- Data is retained for compliance (7-year tax retention)
- Cannot be undone — verify before approving deletion

### Consent Versioning
- `CURRENT_CONSENT_VERSION = '2026-05-v1'`
- If privacy policy changes materially:
  - Increment version (e.g., `'2026-06-v2'`)
  - All users must re-consent
  - Old version records are preserved in `consent_log`

### Deletion Request Approval
- HR can review reason before approving
- On approval: user is soft-deleted across all 3 tables
- User cannot login after deletion (returns error)
- Data remains in database (audit trail, compliance)

---

## 🛠️ Post-Deployment Checklist

- [ ] Database migration applied successfully (`schema_migrations` shows R2_uu_pdp)
- [ ] New tables exist: `consent_log`, `data_deletion_requests`
- [ ] `deleted_at` columns exist on users, attendance, leave_requests
- [ ] Login endpoint returns `consent_accepted: true/false`
- [ ] Consent modal appears for users without consent
- [ ] PDP Profile page loads and download works
- [ ] HR can view and review deletion requests
- [ ] Audit log records consent acceptance and deletion requests
- [ ] Privacy policy is accessible (copy PRIVACY_POLICY_ID.md to templates or static)

---

## 📞 Rollback Plan

If issues occur:

1. **Check logs:** `Railway > Logs` for Python errors
2. **Verify database migration:** 
   ```sql
   SELECT * FROM schema_migrations WHERE release_id = 'R2_uu_pdp';
   ```
3. **If rollback needed:**
   - Revert to previous `app.py` and `app.js` commit
   - Push to main
   - Railway redeploys
   - **Note:** Soft-delete columns remain but won't be used until R2 code is back online

---

## 💡 Known Limitations (By Design)

1. **Deletion Request:** After user is deleted, their account cannot be recovered
2. **Data Export:** Only exports user's own data (not sensitive like password hashes)
3. **Consent Modal:** Cannot be dismissed without accepting (force consent on first login)
4. **Soft-Delete:** Data physically remains in database (not destroyed)

---

## 📝 Next Steps

### R3 (Quick Win): Hand Emoji + Motivational Quote
- On-time % indicator (👍 ≥80%, 👋 60-79%, 👎 <60%)
- Random motivational quote on dashboard
- Frontend only — no DB changes

### R4: Probation Rules
- `hire_date` and `probation_months` on users table
- Adjust leave balance based on probation status
- Block leave requests during probation (configurable)

---

**R2 is now live. All users will see consent modal on next login.**

Questions? Check the Privacy Policy or contact HR via the PDP Profile page.
