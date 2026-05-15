from flask import Flask, request, jsonify, session, send_from_directory, Response
import os, json, math, hashlib, secrets, csv, io, sys
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import psycopg2
from psycopg2.extras import RealDictCursor

def now_local():
    """Current datetime in the configured timezone (default: Asia/Jakarta UTC+7)."""
    tz = ZoneInfo(os.environ.get('TZ', 'Asia/Jakarta'))
    return datetime.now(tz)

def today_local():
    return now_local().date()

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))

# ── R2 Constants ───────────────────────────────────────────────────────────
CURRENT_CONSENT_VERSION = '2026-05-v1'

@app.after_request
def add_cors(response):
    response.headers['Access-Control-Allow-Origin'] = request.headers.get('Origin', '*')
    response.headers['Access-Control-Allow-Credentials'] = 'true'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
    return response

# ── DB ────────────────────────────────────────────────────────────────────────
DATABASE_URL = os.environ.get('DATABASE_URL', '')

def get_db():
    url = DATABASE_URL
    # Render gives postgres:// but psycopg2 needs postgresql://
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)
    conn = psycopg2.connect(url, cursor_factory=RealDictCursor)
    conn.autocommit = False
    return conn

def hash_password(p):
    return hashlib.sha256(p.encode()).hexdigest()

def generate_password(length=8):
    """Generate a random alphanumeric password."""
    import string
    chars = string.ascii_letters + string.digits
    return ''.join(secrets.choice(chars) for _ in range(length))

def send_welcome_email(user_email, user_name, temp_password, app_url):
    """Send welcome email with login credentials to new employee."""
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT value FROM app_settings WHERE key IN ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from')")
        settings = {row['key']: row['value'] for row in c.fetchall()}
        conn.close()
        
        # Check if SMTP is configured
        missing_keys = [k for k in ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from'] if k not in settings or not settings[k]]
        if missing_keys:
            sys.stderr.write(f"[send_welcome_email] Missing SMTP config: {missing_keys}\n")
            sys.stderr.flush()
            return False
        
        subject = "Welcome to OnTime - Your Login Credentials"
        body = f"""
Hi {user_name},

Welcome to the team! Your OnTime account is ready.

Here are your login details:
- Email: {user_email}
- Temporary Password: {temp_password}
- Login URL: {app_url}

Please log in and change your password in Settings → Change Password.

Best regards,
OnTime System
        """.strip()
        
        msg = MIMEMultipart()
        msg['From'] = settings['smtp_from']
        msg['To'] = user_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))
        
        sys.stderr.write(f"[send_welcome_email] Connecting to {settings['smtp_host']}:{settings['smtp_port']}...\n")
        sys.stderr.flush()
        
        server = smtplib.SMTP(settings['smtp_host'], int(settings['smtp_port']))
        server.starttls()
        server.login(settings['smtp_user'], settings['smtp_pass'])
        server.send_message(msg)
        server.quit()
        
        sys.stderr.write(f"[send_welcome_email] ✅ Sent to {user_email}\n")
        sys.stderr.flush()
        return True
    except Exception as e:
        sys.stderr.write(f"[send_welcome_email] ❌ FAILED: {type(e).__name__}: {str(e)}\n")
        sys.stderr.flush()
        return False


def init_db():
    conn = get_db(); c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            employee_id TEXT UNIQUE NOT NULL,
            first_name TEXT NOT NULL DEFAULT '',
            last_name  TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'employee',
            department TEXT,
            branch_id INTEGER,
            manager_id INTEGER,
            hire_date DATE,
            probation_status TEXT DEFAULT 'active',  -- 'active', 'passed', 'failed'
            probation_months INTEGER DEFAULT 3,       -- default 90 days
            shift_start TEXT DEFAULT '09:00',
            shift_end   TEXT DEFAULT '18:00',
            reset_token TEXT, reset_expires TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS branches (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL, address TEXT,
            latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
            radius_m INTEGER DEFAULT 200,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY, value TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS attendance (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL, date TEXT NOT NULL,
            punch_in TEXT, punch_out TEXT, status TEXT,
            lat_in DOUBLE PRECISION, lon_in DOUBLE PRECISION,
            lat_out DOUBLE PRECISION, lon_out DOUBLE PRECISION,
            geo_in TEXT, geo_out TEXT, notes TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id),
            UNIQUE(user_id, date)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS leave_types (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL, max_days INTEGER DEFAULT 12
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS leave_balances (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL, leave_type_id INTEGER NOT NULL,
            year INTEGER NOT NULL, total_days INTEGER DEFAULT 0, used_days INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id),
            UNIQUE(user_id, leave_type_id, year)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS leave_requests (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL, leave_type_id INTEGER NOT NULL,
            start_date TEXT NOT NULL, end_date TEXT NOT NULL,
            days INTEGER NOT NULL, reason TEXT, dates_json TEXT,
            status TEXT DEFAULT 'pending',
            approved_by INTEGER, approved_at TEXT, remarks TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    # ── Phase 1 Migrations ────────────────────────────────────────────────────
    # Schema migration tracker (records which releases have been applied)
    c.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            release_id TEXT PRIMARY KEY,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            notes TEXT
        )
    """)
    conn.commit()

    # Release 1 · Audit Log (idempotent, safe to re-run)
    try:
        c.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                action TEXT NOT NULL,
                entity_type TEXT, entity_id INTEGER,
                before_json JSONB, after_json JSONB,
                ip_address TEXT, user_agent TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(user_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_log(entity_type, entity_id)")
        c.execute("INSERT INTO schema_migrations (release_id, notes) VALUES ('R1_audit_log', 'Phase 1 - Audit Log') ON CONFLICT DO NOTHING")
        conn.commit()
        sys.stderr.write("[init_db] R1 Audit Log applied\n")
        sys.stderr.flush()
    except Exception as e:
        conn.rollback()
        sys.stderr.write(f"[init_db] R1 FAILED: {e}\n")
        sys.stderr.flush()

    # Release 2 · UU PDP Compliance (Indonesian Privacy Law)
    try:
        # Soft-delete tracking
        c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE")
        c.execute("ALTER TABLE attendance ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE")
        c.execute("ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE")
        
        # Consent tracking
        c.execute("""
            CREATE TABLE IF NOT EXISTS consent_log (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                consent_type TEXT NOT NULL,
                version TEXT NOT NULL,
                accepted BOOLEAN NOT NULL,
                ip_address TEXT,
                accepted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_consent_user ON consent_log(user_id)")
        
        # Data deletion requests
        c.execute("""
            CREATE TABLE IF NOT EXISTS data_deletion_requests (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                reason TEXT,
                status TEXT DEFAULT 'pending',
                requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                reviewed_by INTEGER REFERENCES users(id),
                reviewed_at TIMESTAMP WITH TIME ZONE,
                review_notes TEXT
            )
        """)
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_deletion_pending ON data_deletion_requests(user_id) WHERE status='pending'")
        c.execute("CREATE INDEX IF NOT EXISTS idx_deletion_user ON data_deletion_requests(user_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_deletion_status ON data_deletion_requests(status)")
        
        c.execute("INSERT INTO schema_migrations (release_id, notes) VALUES ('R2_uu_pdp', 'Phase 1 - UU PDP Compliance') ON CONFLICT DO NOTHING")
        conn.commit()
        sys.stderr.write("[init_db] R2 UU PDP applied\n")
        sys.stderr.flush()
    except Exception as e:
        conn.rollback()
        sys.stderr.write(f"[init_db] R2 FAILED: {e}\n")
        sys.stderr.flush()

    # Release 3 · Three-tier Hand Emoji + Motivational Quotes
    try:
        c.execute("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS thumb_down_threshold TEXT DEFAULT '40'")
        c.execute("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS thumb_up_threshold TEXT DEFAULT '80'")
        c.execute("""
            INSERT INTO schema_migrations (release_id, notes)
            VALUES ('R3_hand_emoji', 'Phase 1 - Three-tier Emoji + Quotes')
            ON CONFLICT DO NOTHING
        """)
        conn.commit()
        sys.stderr.write("[init_db] R3 Hand Emoji applied\n")
        sys.stderr.flush()
    except Exception as e:
        conn.rollback()
        sys.stderr.write(f"[init_db] R3 FAILED: {e}\n")
        sys.stderr.flush()

    # Release 4b · Employee Onboarding (Integrated with Employee Management)
    try:
        c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS hire_date DATE")
        c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS certificate_name TEXT")
        c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS certificate_expiry DATE")
        c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS probation_status TEXT DEFAULT 'not_started'")
        c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS probation_months INTEGER DEFAULT 3")
        c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)")
        
        c.execute("""
            INSERT INTO schema_migrations (release_id, notes)
            VALUES ('R4b_onboarding', 'Phase 1 - Employee Onboarding')
            ON CONFLICT DO NOTHING
        """)
        conn.commit()
        sys.stderr.write("[init_db] R4b Onboarding applied\n")
        sys.stderr.flush()
    except Exception as e:
        conn.rollback()
        sys.stderr.write(f"[init_db] R4b FAILED: {e}\n")
        sys.stderr.flush()

    # Seed leave types
    c.execute("SELECT COUNT(*) as cnt FROM leave_types")
    if c.fetchone()['cnt'] == 0:
        c.executemany("INSERT INTO leave_types (name,max_days) VALUES (%s,%s)", [
            ('Annual Leave',14),('Sick Leave',14),('Emergency Leave',3),
            ('Maternity Leave',90),('Paternity Leave',7),('Unpaid Leave',30)])

    # Seed default branch
    c.execute("SELECT COUNT(*) as cnt FROM branches")
    if c.fetchone()['cnt'] == 0:
        c.execute("INSERT INTO branches (name,address,latitude,longitude,radius_m) VALUES (%s,%s,%s,%s,%s)",
                  ('Head Office','Jakarta, Indonesia',-6.2088,106.8456,200))

    # Seed default settings
    c.execute("SELECT COUNT(*) as cnt FROM app_settings")
    if c.fetchone()['cnt'] == 0:
        c.executemany("INSERT INTO app_settings (key,value) VALUES (%s,%s) ON CONFLICT DO NOTHING", [
            ('smtp_host','smtp.gmail.com'),('smtp_port','587'),
            ('smtp_user',''),('smtp_pass',''),('smtp_from',''),
            ('email_enabled','0'),('geofence_enabled','1'),
            ('base_url','https://your-app.onrender.com')])

    # Seed demo users
    c.execute("SELECT COUNT(*) as cnt FROM users")
    if c.fetchone()['cnt'] == 0:
        demo = [
            ('HR001','Sarah','Johnson','Sarah Johnson','hr@company.com',hash_password('hr123'),'hr_admin','HR',1,None,'08:00','17:00'),
            ('MGR001','David','Chen','David Chen','manager@company.com',hash_password('mgr123'),'manager','Engineering',1,1,'09:00','18:00'),
            ('EMP001','Alice','Wong','Alice Wong','alice@company.com',hash_password('emp123'),'employee','Engineering',1,2,'09:00','18:00'),
            ('EMP002','Bob','Martinez','Bob Martinez','bob@company.com',hash_password('bob123'),'employee','Engineering',1,2,'09:00','18:00'),
            ('EMP003','Carol','Kim','Carol Kim','carol@company.com',hash_password('carol123'),'employee','Design',1,2,'09:00','18:00'),
        ]
        for d in demo:
            c.execute("INSERT INTO users (employee_id,first_name,last_name,name,email,password,role,department,branch_id,manager_id,shift_start,shift_end) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", d)
        conn.commit()

        c.execute("SELECT id FROM users"); user_ids=[r['id'] for r in c.fetchall()]
        c.execute("SELECT id,max_days FROM leave_types"); lts=c.fetchall()
        yr=today_local().year
        for uid in user_ids:
            for lt in lts:
                c.execute("INSERT INTO leave_balances (user_id,leave_type_id,year,total_days,used_days) VALUES (%s,%s,%s,%s,0) ON CONFLICT DO NOTHING",(uid,lt['id'],yr,lt['max_days']))

        import random
        for uid in [3,4,5]:
            for i in range(14,0,-1):
                d=today_local()-timedelta(days=i)
                if d.weekday()>=5: continue
                st=random.choice(['ontime','ontime','ontime','late','ontime'])
                ph=9 if st=='ontime' else random.randint(9,11)
                pm=random.randint(0,30) if st=='ontime' else random.randint(0,59)
                try:
                    c.execute("INSERT INTO attendance (user_id,date,punch_in,punch_out,status) VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                              (uid,d.isoformat(),f"{ph:02d}:{pm:02d}:00",f"{random.randint(17,19):02d}:{random.randint(0,59):02d}:00",st))
                except: pass

# Release 4 · Probation Rules
    try:
        # Add probation columns if they don't exist
        c.execute("""
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS hire_date DATE,
            ADD COLUMN IF NOT EXISTS probation_status TEXT DEFAULT 'active',
            ADD COLUMN IF NOT EXISTS probation_months INTEGER DEFAULT 3;
        """)
        c.execute("""
            INSERT INTO schema_migrations (release_id, notes)
            VALUES ('R4_probation_rules', 'Probation tracking and enforcement')
            ON CONFLICT DO NOTHING;
        """)
        conn.commit()
        print("[init_db] R4 Probation Rules applied")
    except Exception as e:
        conn.rollback()
        print(f"[init_db] R4 FAILED: {e}")
        
# Release 5 · Blackout Dates
    try:
        c.execute("""
            CREATE TABLE IF NOT EXISTS blackout_dates (
                id SERIAL PRIMARY KEY,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                reason TEXT,
                applies_to TEXT DEFAULT 'all',
                department_id INTEGER,
                user_ids_json TEXT,
                auto_reject BOOLEAN DEFAULT TRUE,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_blackout_dates ON blackout_dates(start_date, end_date)")
        c.execute("""
            INSERT INTO schema_migrations (release_id, notes)
            VALUES ('R5_blackout_dates', 'Blackout date management for leave freezes')
            ON CONFLICT DO NOTHING
        """)
        conn.commit()
        sys.stderr.write("[init_db] R5 Blackout Dates applied\n")
        sys.stderr.flush()
    except Exception as e:
        conn.rollback()
        sys.stderr.write(f"[init_db] R5 FAILED: {e}\n")
        sys.stderr.flush()

# Release 7 · Attendance Regularization
    try:
        c.execute("""
            CREATE TABLE IF NOT EXISTS attendance_corrections (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                date TEXT NOT NULL,
                original_punch_in TEXT,
                original_punch_out TEXT,
                original_status TEXT,
                corrected_punch_in TEXT,
                corrected_punch_out TEXT,
                corrected_status TEXT,
                reason TEXT NOT NULL,
                attachment_url TEXT,
                status TEXT DEFAULT 'pending',
                manager_id INTEGER REFERENCES users(id),
                manager_approved_at TIMESTAMP WITH TIME ZONE,
                hr_id INTEGER REFERENCES users(id),
                hr_acknowledged_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_correction_user ON attendance_corrections(user_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_correction_status ON attendance_corrections(status)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_correction_date ON attendance_corrections(date)")
        c.execute("""
            INSERT INTO schema_migrations (release_id, notes)
            VALUES ('R7_attendance_regularization', 'Attendance Regularization - Punch correction requests')
            ON CONFLICT DO NOTHING
        """)
        conn.commit()
        sys.stderr.write("[init_db] R7 Attendance Regularization applied\n")
        sys.stderr.flush()
    except Exception as e:
        conn.rollback()
        sys.stderr.write(f"[init_db] R7 FAILED: {e}\n")
        sys.stderr.flush()

# Release 8 · Approval Delegation
    try:
        c.execute("""
            CREATE TABLE IF NOT EXISTS approval_delegations (
                id SERIAL PRIMARY KEY,
                delegator_id INTEGER NOT NULL REFERENCES users(id),
                delegate_id INTEGER NOT NULL REFERENCES users(id),
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                revoked_at TIMESTAMP WITH TIME ZONE
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_delegation_active ON approval_delegations(is_active, start_date, end_date)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_delegation_delegate ON approval_delegations(delegate_id, is_active)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_delegation_delegator ON approval_delegations(delegator_id)")
        c.execute("""
            INSERT INTO schema_migrations (release_id, notes)
            VALUES ('R8_approval_delegation', 'Approval Delegation - Managers delegate leave approvals temporarily')
            ON CONFLICT DO NOTHING
        """)
        conn.commit()
        sys.stderr.write("[init_db] R8 Approval Delegation applied\n")
        sys.stderr.flush()
    except Exception as e:
        conn.rollback()
        sys.stderr.write(f"[init_db] R8 FAILED: {e}\n")
        sys.stderr.flush()

# Release 9 · Cuti Bersama 2026
    try:
        c.execute("""
            CREATE TABLE IF NOT EXISTS cuti_bersama (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL UNIQUE,
                name TEXT NOT NULL,
                year INTEGER NOT NULL,
                deduction_type TEXT DEFAULT 'annual',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_cuti_year ON cuti_bersama(year)")
        
        # Seed 13 dates for 2026
        cuti_dates = [
            ('2026-01-29', 'Isra & Miraj', 2026, 'annual'),
            ('2026-02-10', 'Tahun Baru Imlek', 2026, 'annual'),
            ('2026-03-16', 'Nyepi', 2026, 'annual'),
            ('2026-05-01', 'Hari Buruh', 2026, 'annual'),
            ('2026-05-26', 'Hari Raya (Lebaran)', 2026, 'annual'),
            ('2026-05-27', 'Hari Raya (Lebaran)', 2026, 'annual'),
            ('2026-06-01', 'Pancasila Day', 2026, 'annual'),
            ('2026-06-04', 'Cuti Bersama Lebaran', 2026, 'annual'),
            ('2026-06-05', 'Cuti Bersama Lebaran', 2026, 'annual'),
            ('2026-08-17', 'Independence Day', 2026, 'annual'),
            ('2026-09-16', 'Hari Raya (Haji)', 2026, 'annual'),
            ('2026-12-25', 'Christmas Day', 2026, 'annual'),
            ('2026-12-26', 'Cuti Bersama Natal', 2026, 'annual'),
        ]
        for date, name, year, dtype in cuti_dates:
            c.execute("""
                INSERT INTO cuti_bersama (date, name, year, deduction_type)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (date, name, year, dtype))
        
        c.execute("""
            INSERT INTO schema_migrations (release_id, notes)
            VALUES ('R9_cuti_bersama', 'Cuti Bersama 2026 - 13 joint holidays')
            ON CONFLICT DO NOTHING
        """)
        conn.commit()
        sys.stderr.write("[init_db] R9 Cuti Bersama applied (13 dates)\n")
        sys.stderr.flush()
    except Exception as e:
        conn.rollback()
        sys.stderr.write(f"[init_db] R9 FAILED: {e}\n")
        sys.stderr.flush()
    conn.commit(); conn.close()

# ── Helpers ───────────────────────────────────────────────────────────────────
def get_setting(key, default=''):
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT value FROM app_settings WHERE key=%s",(key,))
    row=c.fetchone(); conn.close()
    return row['value'] if row else default

def haversine(lat1,lon1,lat2,lon2):
    R=6371000; phi1,phi2=math.radians(lat1),math.radians(lat2)
    dphi=math.radians(lat2-lat1); dlam=math.radians(lon2-lon1)
    a=math.sin(dphi/2)**2+math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R*2*math.atan2(math.sqrt(a),math.sqrt(1-a))

def check_geofence(branch_id,lat,lon):
    if get_setting('geofence_enabled')!='1': return True,0,'Geofence disabled'
    if lat is None or lon is None: return False,None,'Location not provided'
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM branches WHERE id=%s",(branch_id,)) if branch_id else None
    branch=c.fetchone() if branch_id else None
    if not branch:
        c.execute("SELECT * FROM branches LIMIT 1"); branch=c.fetchone()
    conn.close()
    if not branch or branch['latitude'] is None: return True,0,'No location set'
    dist=int(haversine(lat,lon,branch['latitude'],branch['longitude']))
    return dist<=branch['radius_m'],dist,branch['name']

# ── R4: Probation Rules Helper ────────────────────────────────────────────────
def check_and_transition_probation():
    """Auto-transition employees from active probation to passed (90 days from hire_date)"""
    try:
        conn = get_db()
        cur = conn.cursor()
        today = today_local()
        
        # Find all active probation employees whose probation period has ended (90 days = 3 months)
        cur.execute("""
            SELECT id, first_name, last_name, hire_date, probation_months
            FROM users
            WHERE probation_status = 'active' 
            AND hire_date IS NOT NULL
            AND hire_date + INTERVAL '1 day' * (probation_months * 30)::INTEGER <= %s
        """, (today,))
        
        rows = cur.fetchall()
        for row in rows:
            emp_id, fname, lname, hire_date, prob_months = row['id'], row['first_name'], row['last_name'], row['hire_date'], row['probation_months']
            
            # Update status to 'passed'
            cur.execute("UPDATE users SET probation_status = 'passed' WHERE id = %s", (emp_id,))
            
            # Log to audit trail
            cur.execute("""
                INSERT INTO audit_log (user_id, action, entity_type, entity_id, before_json, after_json)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                emp_id,
                'probation_auto_transition',
                'user',
                emp_id,
                '{"probation_status": "active"}',
                '{"probation_status": "passed"}'
            ))
            
            sys.stderr.write(f"[R4] Auto-transitioned {fname} {lname} from probation (hired {hire_date})\n")
            sys.stderr.flush()
        
        conn.commit()
        conn.close()
    except Exception as e:
        sys.stderr.write(f"[R4] Probation transition check failed: {e}\n")
        sys.stderr.flush()

def send_email(to_addr,subject,html_body):
    """Send email using Resend API (no SMTP issues on Railway)."""
    if get_setting('email_enabled')!='1': return False,'Email not enabled'
    # Read from environment first, then fall back to app_settings
    import os
    api_key=os.environ.get('RESEND_API_KEY') or get_setting('resend_api_key')
    frm=os.environ.get('RESEND_FROM_EMAIL') or get_setting('smtp_from')
    if not api_key: return False,'Resend API key not configured'
    if not frm: return False,'Sender email not configured'
    try:
        import requests
        sys.stderr.write(f"[send_email] Sending via Resend API to {to_addr}...\n")
        sys.stderr.flush()
        response=requests.post("https://api.resend.com/emails",headers={"Authorization":f"Bearer {api_key}","Content-Type":"application/json"},json={"from":frm,"to":to_addr,"subject":subject,"html":html_body},timeout=10)
        if response.status_code==200:
            sys.stderr.write(f"[send_email] ✅ Email sent to {to_addr}\n")
            sys.stderr.flush()
            return True,'sent'
        else:
            error_msg=response.json().get('message',response.text) if response.text else f"HTTP {response.status_code}"
            sys.stderr.write(f"[send_email] ❌ Failed: {error_msg}\n")
            sys.stderr.flush()
            return False,f"Resend error: {error_msg}"
    except requests.exceptions.Timeout as e:
        err=f"Request timeout - Resend API not responding"
        sys.stderr.write(f"[send_email] ❌ {err}\n")
        sys.stderr.flush()
        return False,err
    except requests.exceptions.ConnectionError as e:
        err=f"Connection error: {str(e)}"
        sys.stderr.write(f"[send_email] ❌ {err}\n")
        sys.stderr.flush()
        return False,err
    except Exception as e:
        err=f"{type(e).__name__}: {str(e)}"
        sys.stderr.write(f"[send_email] ❌ {err}\n")
        sys.stderr.flush()
        return False,err

def notify_supervisor(req_id):
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM leave_requests WHERE id=%s",(req_id,)); req=c.fetchone()
    if not req: conn.close(); return
    c.execute("SELECT * FROM users WHERE id=%s",(req['user_id'],)); emp=c.fetchone()
    c.execute("SELECT name FROM leave_types WHERE id=%s",(req['leave_type_id'],)); lt=c.fetchone()
    mgr=None
    if emp['manager_id']:
        c.execute("SELECT * FROM users WHERE id=%s",(emp['manager_id'],)); mgr=c.fetchone()
    conn.close()
    if not mgr: return
    dates_str=', '.join(json.loads(req['dates_json'])) if req['dates_json'] else f"{req['start_date']} → {req['end_date']}"
    base=get_setting('base_url','http://localhost:5000')
    html=f"""<div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:#0f1f3d;padding:24px 28px"><h2 style="color:white;margin:0">⏱ OnTime — Leave Request</h2></div>
      <div style="padding:28px">
        <p>Hi <strong>{mgr['name']}</strong>,</p>
        <p><strong>{emp['name']}</strong> has submitted a leave request requiring your approval.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
          <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-weight:600;width:140px">Employee</td><td style="padding:10px">{emp['name']} ({emp['employee_id']})</td></tr>
          <tr><td style="padding:10px;color:#64748b;font-weight:600">Department</td><td style="padding:10px">{emp['department'] or '—'}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-weight:600">Leave Type</td><td style="padding:10px">{lt['name']}</td></tr>
          <tr><td style="padding:10px;color:#64748b;font-weight:600">Dates</td><td style="padding:10px">{dates_str}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-weight:600">Total Days</td><td style="padding:10px"><strong>{req['days']} working day(s)</strong></td></tr>
          <tr><td style="padding:10px;color:#64748b;font-weight:600">Reason</td><td style="padding:10px">{req['reason'] or '—'}</td></tr>
        </table>
        <a href="{base}" style="display:inline-block;background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Open OnTime to Approve →</a>
      </div>
      <div style="background:#f8fafc;padding:14px 28px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0">Automated notification from OnTime.</div>
    </div>"""
    send_email(mgr['email'],f"Leave Request: {emp['name']} — {req['days']} day(s) [{lt['name']}]",html)

def require_login():
    if 'user_id' not in session: return jsonify({'error':'Unauthorized'}),401
    return None

def row(c): return c.fetchone()
def rows(c): return c.fetchall()

# ── R1 Audit Log Helper ───────────────────────────────────────────────────────
def log_audit(c, user_id, action, entity_type=None, entity_id=None, before=None, after=None):
    """Write audit row using existing cursor. Caller commits. Never raises."""
    try:
        ip = request.remote_addr if request else None
        ua = (request.headers.get('User-Agent') or '')[:500] if request else None
        c.execute("""INSERT INTO audit_log (user_id,action,entity_type,entity_id,before_json,after_json,ip_address,user_agent)
                     VALUES (%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s)""",
                  (user_id, action, entity_type, entity_id,
                   json.dumps(before, default=str) if before is not None else None,
                   json.dumps(after,  default=str) if after  is not None else None,
                   ip, ua))
    except Exception as e:
        print(f"[AUDIT ERROR] {action} user={user_id}: {e}", file=sys.stderr)

def diff_dict(before, after, fields=None):
    """Build minimal before/after pair containing only changed fields."""
    if fields is None:
        fields = set(before.keys()) | set(after.keys())
    b = {k: before.get(k) for k in fields if before.get(k) != after.get(k)}
    a = {k: after.get(k)  for k in fields if before.get(k) != after.get(k)}
    return (b if b else None, a if a else None)

# ── Auth ──────────────────────────────────────────────────────────────────────
@app.route('/api/login',methods=['POST'])
def login():
    data=request.json; conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM users WHERE email=%s AND password=%s AND deleted_at IS NULL",(data['email'],hash_password(data['password'])))
    user=row(c)
    if not user:
        log_audit(c, None, 'login_failed', entity_type='user', after={'email': data.get('email')})
        conn.commit(); conn.close()
        return jsonify({'error':'Invalid credentials'}),401
    session['user_id']=user['id']; session['role']=user['role']
    log_audit(c, user['id'], 'login_success', entity_type='user', entity_id=user['id'])
    c.execute("SELECT * FROM attendance WHERE user_id=%s AND date=%s",(user['id'],today_local().isoformat()))
    att=row(c)
    # Get consent status (gracefully handle if table doesn't exist)
    consent_accepted = False
    try:
        c.execute("""SELECT accepted FROM consent_log 
                     WHERE user_id=%s AND version=%s AND accepted=true 
                     ORDER BY accepted_at DESC LIMIT 1""",
                  (user['id'], CURRENT_CONSENT_VERSION))
        consent_accepted = bool(c.fetchone())
    except Exception as e:
        print(f"[login] Consent check failed (table may not exist): {e}")
        consent_accepted = False
    conn.commit(); conn.close()
    punch_status=att['status'] if att else ('not_punched' if today_local().weekday()<5 else None)
    return jsonify({'user':{'id':user['id'],'name':user['name'],'first_name':user['first_name'],'last_name':user['last_name'],
        'email':user['email'],'role':user['role'],'employee_id':user['employee_id'],
        'department':user['department'],'shift_start':user['shift_start'],'shift_end':user['shift_end'],
        'branch_id':user['branch_id'],'probation_status':user['probation_status'],'hire_date':user.get('hire_date')},'punch_status':punch_status,'consent_accepted':consent_accepted})

@app.route('/api/logout',methods=['POST'])
def logout():
    uid = session.get('user_id')
    conn=get_db(); c=conn.cursor()
    log_audit(c, uid, 'logout', entity_type='user', entity_id=uid)
    conn.commit(); conn.close()
    session.clear(); return jsonify({'ok':True})

@app.route('/api/forgot-password',methods=['POST'])
def forgot_password():
    email=request.json.get('email'); conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM users WHERE email=%s",(email,)); user=row(c)
    if not user:
        log_audit(c, None, 'password_reset_requested', entity_type='user', after={'email': email, 'found': False})
        conn.commit(); conn.close()
        return jsonify({'ok':True})
    token=secrets.token_urlsafe(32); expires=(now_local()+timedelta(hours=1)).isoformat()
    c.execute("UPDATE users SET reset_token=%s,reset_expires=%s WHERE id=%s",(token,expires,user['id']))
    log_audit(c, user['id'], 'password_reset_requested', entity_type='user', entity_id=user['id'], after={'email': email})
    conn.commit(); conn.close()
    return jsonify({'ok':True,'demo_token':token,'message':f'Reset link sent to {email}.'})

@app.route('/api/reset-password',methods=['POST'])
def reset_password():
    data=request.json; conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM users WHERE reset_token=%s",(data.get('token'),)); user=row(c)
    if not user or user['reset_expires']<now_local().isoformat():
        conn.close(); return jsonify({'error':'Invalid or expired token'}),400
    c.execute("UPDATE users SET password=%s,reset_token=NULL,reset_expires=NULL WHERE id=%s",(hash_password(data['password']),user['id']))
    log_audit(c, user['id'], 'password_reset_completed', entity_type='user', entity_id=user['id'])
    conn.commit(); conn.close(); return jsonify({'ok':True})

# ── Attendance ────────────────────────────────────────────────────────────────
@app.route('/api/punch-in',methods=['POST'])
def punch_in():
    err=require_login()
    if err: return err
    uid=session['user_id']; today=today_local().isoformat(); now=now_local().strftime('%H:%M:%S')
    data=request.json or {}; lat=data.get('lat'); lon=data.get('lon')
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM users WHERE id=%s",(uid,)); user=row(c)
    c.execute("SELECT * FROM attendance WHERE user_id=%s AND date=%s",(uid,today)); existing=row(c)
    if existing and existing['punch_in']: conn.close(); return jsonify({'error':'Already punched in today'}),400
    allowed,dist,bname=check_geofence(user['branch_id'],lat,lon)
    if not allowed: conn.close(); return jsonify({'error':f"You are {dist}m from {bname}. Must be within the allowed radius.",'distance':dist}),403
    shift_start=datetime.strptime(user['shift_start'],'%H:%M')
    status='ontime' if datetime.strptime(now[:5],'%H:%M')<=shift_start+timedelta(minutes=15) else 'late'
    geo=f"{dist}m from {bname}" if dist else 'verified'
    c.execute("""INSERT INTO attendance (user_id,date,punch_in,status,lat_in,lon_in,geo_in) VALUES (%s,%s,%s,%s,%s,%s,%s)
                 ON CONFLICT(user_id,date) DO UPDATE SET punch_in=%s,status=%s,lat_in=%s,lon_in=%s,geo_in=%s""",
              (uid,today,now,status,lat,lon,geo,now,status,lat,lon,geo))
    log_audit(c, uid, 'punch_in', entity_type='attendance',
              after={'date':today,'punch_in':now,'status':status,'lat':lat,'lon':lon,'geo':geo,'distance_m':dist})
    conn.commit(); conn.close()
    return jsonify({'ok':True,'status':status,'punch_in':now,'distance':dist})

@app.route('/api/punch-out',methods=['POST'])
def punch_out():
    err=require_login()
    if err: return err
    uid=session['user_id']; today=today_local().isoformat(); now=now_local().strftime('%H:%M:%S')
    data=request.json or {}; lat=data.get('lat'); lon=data.get('lon')
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM users WHERE id=%s",(uid,)); user=row(c)
    c.execute("SELECT * FROM attendance WHERE user_id=%s AND date=%s",(uid,today)); existing=row(c)
    if not existing or not existing['punch_in']: conn.close(); return jsonify({'error':'Punch in first'}),400
    if existing['punch_out']: conn.close(); return jsonify({'error':'Already punched out'}),400
    allowed,dist,bname=check_geofence(user['branch_id'],lat,lon)
    if not allowed: conn.close(); return jsonify({'error':f"You are {dist}m from {bname}. Must be within the allowed radius.",'distance':dist}),403
    geo=f"{dist}m from {bname}" if dist else 'verified'
    c.execute("UPDATE attendance SET punch_out=%s,lat_out=%s,lon_out=%s,geo_out=%s WHERE user_id=%s AND date=%s",(now,lat,lon,geo,uid,today))
    log_audit(c, uid, 'punch_out', entity_type='attendance', entity_id=existing['id'],
              after={'punch_out':now,'lat':lat,'lon':lon,'geo':geo,'distance_m':dist})
    conn.commit(); conn.close()
    return jsonify({'ok':True,'punch_out':now,'distance':dist})

@app.route('/api/attendance/me')
def my_attendance():
    err=require_login()
    if err: return err
    month=request.args.get('month',today_local().strftime('%Y-%m')); conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM attendance WHERE user_id=%s AND date LIKE %s ORDER BY date DESC",(session['user_id'],f"{month}%"))
    data=rows(c); conn.close(); return jsonify([dict(r) for r in data])

@app.route('/api/attendance/today')
def today_status():
    err=require_login()
    if err: return err
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM attendance WHERE user_id=%s AND date=%s",(session['user_id'],today_local().isoformat()))
    r=row(c); conn.close(); return jsonify(dict(r) if r else {})

@app.route('/api/attendance/summary')
def attendance_summary():
    err=require_login()
    if err: return err
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT status,COUNT(*) as cnt FROM attendance WHERE user_id=%s AND date LIKE %s GROUP BY status",
              (session['user_id'],f"{today_local().year}-{today_local().month:02d}%"))
    data=rows(c); conn.close()
    s={'ontime':0,'late':0,'absent':0,'leave':0}
    for r in data:
        if r['status'] in s: s[r['status']]=r['cnt']
    return jsonify(s)

@app.route('/api/attendance/team')
def team_attendance():
    err=require_login()
    if err: return err
    uid=session['user_id']; role=session['role']; df=request.args.get('date',today_local().isoformat())
    conn=get_db(); c=conn.cursor()
    if role=='hr_admin':
        c.execute("""SELECT u.name,u.employee_id,u.department,a.punch_in,a.punch_out,a.status,a.date,a.geo_in,a.geo_out
               FROM users u LEFT JOIN attendance a ON u.id=a.user_id AND a.date=%s
               WHERE u.role!='hr_admin' ORDER BY u.department,u.name""",(df,))
    else:
        c.execute("""SELECT u.name,u.employee_id,u.department,a.punch_in,a.punch_out,a.status,a.date,a.geo_in,a.geo_out
               FROM users u LEFT JOIN attendance a ON u.id=a.user_id AND a.date=%s
               WHERE u.manager_id=%s ORDER BY u.name""",(df,uid))
    data=rows(c); conn.close(); return jsonify([dict(r) for r in data])

# ── Branches ──────────────────────────────────────────────────────────────────
@app.route('/api/branches')
def list_branches():
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM branches ORDER BY name"); data=rows(c); conn.close()
    return jsonify([dict(r) for r in data])

@app.route('/api/branches/save',methods=['POST'])
def save_branch():
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    data=request.json; conn=get_db(); c=conn.cursor()
    if data.get('id'):
        c.execute("SELECT * FROM branches WHERE id=%s",(data['id'],)); old=row(c)
        c.execute("UPDATE branches SET name=%s,address=%s,latitude=%s,longitude=%s,radius_m=%s WHERE id=%s",
                  (data['name'],data.get('address',''),data.get('latitude'),data.get('longitude'),data.get('radius_m',200),data['id']))
        new={'name':data['name'],'address':data.get('address',''),'latitude':data.get('latitude'),'longitude':data.get('longitude'),'radius_m':data.get('radius_m',200)}
        old_d={'name':old['name'],'address':old['address'],'latitude':old['latitude'],'longitude':old['longitude'],'radius_m':old['radius_m']} if old else {}
        b,a=diff_dict(old_d, new)
        if b: log_audit(c, session['user_id'], 'branch_update', entity_type='branch', entity_id=data['id'], before=b, after=a)
    else:
        c.execute("INSERT INTO branches (name,address,latitude,longitude,radius_m) VALUES (%s,%s,%s,%s,%s) RETURNING id",
                  (data['name'],data.get('address',''),data.get('latitude'),data.get('longitude'),data.get('radius_m',200)))
        new_id=row(c)['id']
        log_audit(c, session['user_id'], 'branch_create', entity_type='branch', entity_id=new_id,
                  after={'name':data['name'],'address':data.get('address',''),'latitude':data.get('latitude'),'longitude':data.get('longitude'),'radius_m':data.get('radius_m',200)})
    conn.commit(); conn.close(); return jsonify({'ok':True})

@app.route('/api/branches/delete',methods=['POST'])
def delete_branch():
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    bid=request.json['id']; conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM branches WHERE id=%s",(bid,)); old=row(c)
    c.execute("DELETE FROM branches WHERE id=%s",(bid,))
    if old:
        log_audit(c, session['user_id'], 'branch_delete', entity_type='branch', entity_id=bid,
                  before={'name':old['name'],'address':old['address']})
    conn.commit(); conn.close(); return jsonify({'ok':True})

# ── Settings ──────────────────────────────────────────────────────────────────
@app.route('/api/settings')
def get_settings():
    err=require_login()
    if err: return err
    # Allow all logged-in users to READ settings (needed for hand emoji thresholds, etc)
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT key,value FROM app_settings"); data=rows(c); conn.close()
    s={r['key']:r['value'] for r in data}; s.pop('smtp_pass',None)
    return jsonify(data=s)

@app.route('/api/settings/save',methods=['POST'])
def save_settings():
    err=require_login()
    if err: return err
    # Only HR admins can WRITE settings
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    conn=get_db(); c=conn.cursor()
    changes={}
    for k,v in request.json.items():
        if k=='smtp_pass' and not v: continue
        c.execute("INSERT INTO app_settings (key,value) VALUES (%s,%s) ON CONFLICT(key) DO UPDATE SET value=%s",(k,str(v),str(v)))
        changes[k] = '***' if 'pass' in k.lower() else str(v)
    log_audit(c, session['user_id'], 'settings_update', entity_type='settings', after=changes)
    conn.commit(); conn.close(); return jsonify({'ok':True})

@app.route('/api/settings/test-email',methods=['POST'])
def test_email():
    err=require_login()
    if err: return err
    ok,msg=send_email(request.json.get('to'),'OnTime — Test Email','<p>Your email configuration is working! 🎉</p>')
    return jsonify({'ok':ok,'message':msg})

# ── Leave ─────────────────────────────────────────────────────────────────────
@app.route('/api/leave/types')
def leave_types():
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM leave_types"); data=rows(c); conn.close()
    return jsonify([dict(r) for r in data])

@app.route('/api/leave/balance')
def leave_balance():
    err=require_login()
    if err: return err
    conn=get_db(); c=conn.cursor()
    c.execute("""SELECT lb.*,lt.name as leave_name,lt.max_days,(lb.total_days-lb.used_days) as remaining
           FROM leave_balances lb JOIN leave_types lt ON lb.leave_type_id=lt.id
           WHERE lb.user_id=%s AND lb.year=%s""",(session['user_id'],today_local().year))
    data=rows(c); conn.close(); return jsonify([dict(r) for r in data])

@app.route('/api/leave/apply',methods=['POST'])
def apply_leave():
    err=require_login()
    if err: return err
    uid=session['user_id']; data=request.json
    if 'dates' in data and data['dates']:
        sel=sorted([d for d in data['dates'] if datetime.strptime(d,'%Y-%m-%d').weekday()<5])
        if not sel: return jsonify({'error':'No valid working days'}),400
        days=len(sel); start_date=sel[0]; end_date=sel[-1]; dates_json=json.dumps(sel)
    else:
        s=datetime.strptime(data['start_date'],'%Y-%m-%d').date()
        e=datetime.strptime(data['end_date'],'%Y-%m-%d').date()
        days=sum(1 for i in range((e-s).days+1) if (s+timedelta(days=i)).weekday()<5)
        start_date=data['start_date']; end_date=data['end_date']; dates_json=None

# R5: Check blackout dates
    dates_to_check = sel if 'dates' in data and data['dates'] else [str(s + timedelta(days=i)) for i in range((e-s).days+1) if (s + timedelta(days=i)).weekday()<5]
    conn_bd = get_db(); c_bd = conn_bd.cursor()
    for date_str in dates_to_check:
        c_bd.execute("SELECT * FROM blackout_dates WHERE start_date <= %s AND end_date >= %s LIMIT 1", (date_str, date_str))
        blocking = c_bd.fetchone()
        if blocking:
            conn_bd.close()
            return jsonify({'error': f"Cannot apply leave during blackout: {blocking['reason']}. Contact HR for override.", 'is_blackout': True}), 400
    conn_bd.close()
    
# R4: Check Probation Status
    conn_prob = get_db(); c_prob = conn_prob.cursor()
    c_prob.execute("SELECT probation_status FROM users WHERE id = %s", (uid,))
    prob_row = c_prob.fetchone()
    conn_prob.close()
    
    if prob_row and prob_row['probation_status'] == 'active':
        return jsonify({'error': 'Leave not allowed during probation period. Please contact HR to request an exception.', 'probation_status': 'active'}), 403
    
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM leave_balances WHERE user_id=%s AND leave_type_id=%s AND year=%s",
              (uid,data['leave_type_id'],int(start_date[:4]))); bal=row(c)
    if not bal or (bal['total_days']-bal['used_days'])<days:
        conn.close(); return jsonify({'error':'Insufficient leave balance'}),400
    c.execute("INSERT INTO leave_requests (user_id,leave_type_id,start_date,end_date,days,reason,dates_json) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",
              (uid,data['leave_type_id'],start_date,end_date,days,data.get('reason',''),dates_json))
    req_id=row(c)['id']
    log_audit(c, uid, 'leave_apply', entity_type='leave_request', entity_id=req_id,
              after={'leave_type_id':data['leave_type_id'],'start_date':start_date,'end_date':end_date,
                     'days':days,'dates':json.loads(dates_json) if dates_json else None,'reason':data.get('reason','')})
    conn.commit(); conn.close()
    try: notify_supervisor(req_id)
    except: pass
    return jsonify({'ok':True,'days':days})

@app.route('/api/leave/my-requests')
def my_leave_requests():
    err=require_login()
    if err: return err
    conn=get_db(); c=conn.cursor()
    c.execute("""SELECT lr.*,lt.name as leave_name,u.name as approver_name
           FROM leave_requests lr JOIN leave_types lt ON lr.leave_type_id=lt.id
           LEFT JOIN users u ON lr.approved_by=u.id
           WHERE lr.user_id=%s ORDER BY lr.created_at DESC""",(session['user_id'],))
    data=rows(c); conn.close(); return jsonify([dict(r) for r in data])

@app.route('/api/leave/pending')
def pending_leaves():
    err=require_login()
    if err: return err
    uid=session['user_id']; role=session['role']; conn=get_db(); c=conn.cursor()
    if role=='hr_admin':
        c.execute("""SELECT lr.*,lt.name as leave_name,u.name as employee_name,u.employee_id,u.department
               FROM leave_requests lr JOIN leave_types lt ON lr.leave_type_id=lt.id
               JOIN users u ON lr.user_id=u.id WHERE lr.status='pending' ORDER BY lr.created_at""")
    else:
        c.execute("""SELECT lr.*,lt.name as leave_name,u.name as employee_name,u.employee_id,u.department
               FROM leave_requests lr JOIN leave_types lt ON lr.leave_type_id=lt.id
               JOIN users u ON lr.user_id=u.id
               WHERE lr.status='pending' AND u.manager_id=%s ORDER BY lr.created_at""",(uid,))
    data=rows(c); conn.close(); return jsonify([dict(r) for r in data])


@app.route('/api/leave/action',methods=['POST'])
def leave_action():
    err=require_login()
    if err: return err
    uid=session['user_id']; role=session['role']; data=request.json; action=data['action']
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM leave_requests WHERE id=%s",(data['request_id'],)); req=row(c)
    if not req: conn.close(); return jsonify({'error':'Not found'}),404
    
    # ── R8: Check delegation ──────────────────────────────────────────────
    # Get the employee's manager
    c.execute("SELECT manager_id FROM users WHERE id=%s", (req['user_id'],))
    user_rec = c.fetchone()
    original_manager = user_rec['manager_id'] if user_rec else None
    
    # Check if current user is a delegated approver
    is_delegated_approver = False
    if uid != original_manager and role == 'manager':
        today = today_local().isoformat()
        c.execute("""SELECT * FROM approval_delegations 
                     WHERE delegate_id=%s AND delegator_id=%s 
                     AND is_active=TRUE AND start_date <= %s AND end_date >= %s""",
                  (uid, original_manager, today, today))
        if c.fetchone():
            is_delegated_approver = True
    
    # Permission check: only original manager or delegated approver or HR can approve
    if role == 'manager' and uid != original_manager and not is_delegated_approver:
        conn.close()
        return jsonify({'error': 'Forbidden - not your team'}), 403
    elif role == 'employee':
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    
    # ── Rest of original approval logic ───────────────────────────────────
    before_status=req['status']
    c.execute("UPDATE leave_requests SET status=%s,approved_by=%s,approved_at=%s,remarks=%s WHERE id=%s",
              (action+'d',uid,now_local().isoformat(),data.get('remarks',''),data['request_id']))
    if action=='approve':
        c.execute("UPDATE leave_balances SET used_days=used_days+%s WHERE user_id=%s AND leave_type_id=%s AND year=%s",
                  (req['days'],req['user_id'],req['leave_type_id'],req['start_date'][:4]))
        leave_dates=json.loads(req['dates_json']) if req['dates_json'] else []
        if not leave_dates:
            s=datetime.strptime(req['start_date'],'%Y-%m-%d').date()
            e=datetime.strptime(req['end_date'],'%Y-%m-%d').date(); d=s
            while d<=e:
                if d.weekday()<5: leave_dates.append(d.isoformat())
                d+=timedelta(days=1)
        for ds in leave_dates:
            c.execute("INSERT INTO attendance (user_id,date,status) VALUES (%s,%s,'leave') ON CONFLICT(user_id,date) DO UPDATE SET status='leave'",(req['user_id'],ds))
    log_audit(c, uid, 'leave_'+action, entity_type='leave_request', entity_id=data['request_id'],
              before={'status':before_status},
              after={'status':action+'d','remarks':data.get('remarks',''),'target_user_id':req['user_id'],'days':float(req['days'])})
    conn.commit(); conn.close(); return jsonify({'ok':True})

# ── R4: Probation Management ──────────────────────────────────────────────────

@app.route('/api/probation/employee/<int:emp_id>', methods=['GET'])
def get_probation_status(emp_id):
    """Get probation status for an employee (HR only)"""
    err=require_login()
    if err: return err
    if session['role'] != 'hr_admin':
        return jsonify({'error': 'Unauthorized'}), 403
    
    conn = get_db(); c = conn.cursor()
    c.execute("""
        SELECT id, name, hire_date, probation_status, probation_months
        FROM users WHERE id = %s
    """, (emp_id,))
    row_data = c.fetchone()
    conn.close()
    
    if not row_data:
        return jsonify({'error': 'Employee not found'}), 404
    
    hire_date = row_data['hire_date']
    prob_months = row_data['probation_months']
    
    if hire_date:
        probation_end = hire_date + timedelta(days=prob_months * 30)
        days_remaining = (probation_end - today_local()).days
    else:
        days_remaining = None
    
    return jsonify({
        'id': row_data['id'],
        'name': row_data['name'],
        'hire_date': hire_date.isoformat() if hire_date else None,
        'probation_status': row_data['probation_status'],
        'probation_months': row_data['probation_months'],
        'days_remaining': days_remaining,
        'probation_end_date': (hire_date + timedelta(days=prob_months*30)).isoformat() if hire_date else None
    })

@app.route('/api/probation/list', methods=['GET'])
def get_probation_list():
    """List all employees currently on probation (HR only)"""
    err=require_login()
    if err: return err
    if session['role'] != 'hr_admin':
        return jsonify({'error': 'Unauthorized'}), 403
    
    conn = get_db(); c = conn.cursor()
    c.execute("""
        SELECT id, name, hire_date, probation_status, probation_months
        FROM users
        WHERE probation_status IN ('active', 'failed')
        ORDER BY hire_date DESC
    """)
    rows_data = c.fetchall()
    conn.close()
    
    today = today_local()
    result = []
    for row_data in rows_data:
        hire_date = row_data['hire_date']
        prob_months = row_data['probation_months']
        
        if hire_date:
            probation_end = hire_date + timedelta(days=prob_months * 30)
            days_remaining = (probation_end - today).days
        else:
            days_remaining = None
        
        result.append({
            'id': row_data['id'],
            'name': row_data['name'],
            'hire_date': hire_date.isoformat() if hire_date else None,
            'status': row_data['probation_status'],
            'days_remaining': days_remaining
        })
    
    return jsonify(result)

@app.route('/api/probation/update-status', methods=['POST'])
def update_probation_status():
    """HR Admin: Manually update probation status (passed/failed)"""
    err=require_login()
    if err: return err
    if session['role'] != 'hr_admin':
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.get_json()
    emp_id = data.get('emp_id')
    new_status = data.get('status')  # 'passed' or 'failed'
    
    if new_status not in ['passed', 'failed']:
        return jsonify({'error': 'Invalid status. Must be passed or failed'}), 400
    
    conn = get_db(); c = conn.cursor()
    
    # Get old status for audit
    c.execute("SELECT probation_status FROM users WHERE id = %s", (emp_id,))
    old_row = c.fetchone()
    old_status = old_row['probation_status'] if old_row else 'unknown'
    
    # Update status
    c.execute("""
        UPDATE users
        SET probation_status = %s
        WHERE id = %s
    """, (new_status, emp_id))
    
    # Log to audit
    c.execute("""
        INSERT INTO audit_log (user_id, action, entity_type, entity_id, before_json, after_json)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, (
        session['user_id'],
        'probation_status_updated',
        'user',
        emp_id,
        json.dumps({'probation_status': old_status}),
        json.dumps({'probation_status': new_status})
    ))
    
    conn.commit(); conn.close()
    
    return jsonify({'ok': True, 'message': f'Employee probation status set to {new_status}'})

@app.route('/api/probation/manual-leave', methods=['POST'])
def add_manual_leave_probation():
    """HR Admin: Manually add leave for probation employee (exception)"""
    err=require_login()
    if err: return err
    if session['role'] != 'hr_admin':
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.get_json()
    emp_id = data.get('emp_id')
    leave_type_id = data.get('leave_type_id')
    start_date = data.get('start_date')
    end_date = data.get('end_date')
    days = data.get('days')
    reason = data.get('reason', 'HR override during probation')
    
    conn = get_db(); c = conn.cursor()
    
    # Create leave request (auto-approved by HR)
    c.execute("""
        INSERT INTO leave_requests 
        (user_id, leave_type_id, start_date, end_date, days, status, approved_by, approved_at, reason)
        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), %s)
        RETURNING id
    """, (emp_id, leave_type_id, start_date, end_date, days, 'approved', session['user_id'], reason))
    
    leave_id = c.fetchone()['id']
    
    # Update leave balance
    c.execute("""
        UPDATE leave_balances
        SET used_days = used_days + %s
        WHERE user_id = %s AND leave_type_id = %s
        AND EXTRACT(YEAR FROM NOW())::INTEGER = year
    """, (days, emp_id, leave_type_id))
    
    # Log to audit
    c.execute("""
        INSERT INTO audit_log (user_id, action, entity_type, entity_id, before_json, after_json)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, (
        session['user_id'],
        'leave_probation_override',
        'leave_request',
        leave_id,
        json.dumps({'source': 'hr_manual_probation'}),
        json.dumps({'leave_id': leave_id, 'emp_id': emp_id})
    ))
    
    conn.commit(); conn.close()
    
    return jsonify({'ok': True, 'leave_id': leave_id, 'message': 'Leave added for probation employee'})


@app.route('/api/users')
def list_users():
    err=require_login()
    if err: return err
    conn=get_db(); c=conn.cursor()
    c.execute("""SELECT u.id,u.employee_id,u.first_name,u.last_name,u.name,u.email,u.role,
                  u.department,u.branch_id,u.manager_id,u.shift_start,u.shift_end,
                  u.hire_date,u.probation_status,u.created_at::text,m.name as manager_name,b.name as branch_name
           FROM users u LEFT JOIN users m ON u.manager_id=m.id
           LEFT JOIN branches b ON u.branch_id=b.id 
           WHERE u.deleted_at IS NULL ORDER BY u.name""")
    data=rows(c); conn.close(); return jsonify([dict(r) for r in data])

@app.route('/api/users/add',methods=['POST'])
def add_user():
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    data=request.json
    first=data.get('first_name','').strip(); last=data.get('last_name','').strip()
    full=f"{first} {last}".strip(); conn=get_db(); c=conn.cursor()
    
    # R4b: Auto-generate password if not provided
    temp_password = data.get('password') or generate_password(8)
    hashed_password = hash_password(temp_password)
    
    # R4b: Determine probation status based on hire_date
    hire_date = data.get('hire_date') or None
    probation_status = 'active' if hire_date else 'not_started'
    
    try:
        c.execute("""INSERT INTO users 
                    (employee_id,first_name,last_name,name,email,password,role,department,branch_id,manager_id,
                     shift_start,shift_end,hire_date,certificate_name,certificate_expiry,probation_status,created_by) 
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                  (data['employee_id'],first,last,full,data['email'],hashed_password,
                   data.get('role','employee'),data.get('department',''),
                   data.get('branch_id') or None,data.get('manager_id') or None,
                   data.get('shift_start','09:00'),data.get('shift_end','18:00'),
                   hire_date, data.get('certificate_name'), data.get('certificate_expiry'),
                   probation_status, session['user_id']))
        uid=row(c)['id']; yr=today_local().year
        c.execute("SELECT id,max_days FROM leave_types"); lts=rows(c)
        for lt in lts:
            c.execute("INSERT INTO leave_balances (user_id,leave_type_id,year,total_days) VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                      (uid,lt['id'],yr,lt['max_days']))
        log_audit(c, session['user_id'], 'user_create', entity_type='user', entity_id=uid,
                  after={'employee_id':data['employee_id'],'name':full,'email':data['email'],
                         'role':data.get('role','employee'),'department':data.get('department',''),
                         'branch_id':data.get('branch_id'),'manager_id':data.get('manager_id'),
                         'hire_date':hire_date,'probation_status':probation_status})
        conn.commit()
        conn.close()
        
        # R4b: Send welcome email with auto-generated password
        app_url = f"{request.host_url.rstrip('/')}/index.html"
        send_welcome_email(data['email'], full, temp_password, app_url)
        
        return jsonify({'ok':True, 'id':uid, 'temp_password':temp_password})
    except Exception as e: conn.rollback(); conn.close(); return jsonify({'error':str(e)}),400


@app.route('/api/users/update',methods=['POST'])
def update_user():
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    data=request.json; first=data.get('first_name','').strip(); last=data.get('last_name','').strip()
    full=f"{first} {last}".strip(); conn=get_db(); c=conn.cursor()
    try:
        c.execute("SELECT first_name,last_name,name,email,role,department,branch_id,manager_id,shift_start,shift_end,hire_date,certificate_name,certificate_expiry FROM users WHERE id=%s",(data['id'],))
        old=row(c); old_d=dict(old) if old else {}
        
        # R4b: Update hire_date and certificate fields
        hire_date = data.get('hire_date') or None
        probation_status = 'active' if hire_date and not old_d.get('hire_date') else old_d.get('probation_status', 'not_started')
        
        c.execute("""UPDATE users SET first_name=%s,last_name=%s,name=%s,email=%s,role=%s,department=%s,branch_id=%s,manager_id=%s,
                    shift_start=%s,shift_end=%s,hire_date=%s,certificate_name=%s,certificate_expiry=%s,probation_status=%s WHERE id=%s""",
                  (first,last,full,data['email'],data.get('role','employee'),data.get('department',''),
                   data.get('branch_id') or None,data.get('manager_id') or None,
                   data.get('shift_start','09:00'),data.get('shift_end','18:00'),
                   hire_date, data.get('certificate_name'), data.get('certificate_expiry'),
                   probation_status, data['id']))
        new_d={'first_name':first,'last_name':last,'name':full,'email':data['email'],
               'role':data.get('role','employee'),'department':data.get('department',''),
               'branch_id':data.get('branch_id'),'manager_id':data.get('manager_id'),
               'shift_start':data.get('shift_start','09:00'),'shift_end':data.get('shift_end','18:00'),
               'hire_date':hire_date,'certificate_name':data.get('certificate_name'),
               'certificate_expiry':data.get('certificate_expiry')}
        b,a=diff_dict(old_d, new_d)
        if b: log_audit(c, session['user_id'], 'user_update', entity_type='user', entity_id=data['id'], before=b, after=a)
        if data.get('password'):
            c.execute("UPDATE users SET password=%s WHERE id=%s",(hash_password(data['password']),data['id']))
            log_audit(c, session['user_id'], 'user_password_reset', entity_type='user', entity_id=data['id'])
        conn.commit()
    except Exception as e: conn.rollback(); conn.close(); return jsonify({'error':str(e)}),400
    conn.close(); return jsonify({'ok':True})

# ── R4b Employee Onboarding · Bulk CSV Import ──────────────────────────────────
@app.route('/api/users/csv-template')
def csv_template():
    """Return CSV template for bulk employee import."""
    template = """employee_id,first_name,last_name,email,department,branch_id,manager_id,shift_start,shift_end,hire_date,certificate_name,certificate_expiry
EMP001,John,Doe,john@company.com,Engineering,1,2,09:00,18:00,2026-05-01,,
EMP002,Jane,Smith,jane@company.com,Design,1,3,09:00,18:00,2026-05-01,,"""
    return Response(template, mimetype='text/csv', headers={'Content-Disposition':'attachment;filename=employee_template.csv'})

@app.route('/api/users/bulk-import', methods=['POST'])
def bulk_import_users():
    """Bulk import employees from CSV file. R4b feature."""
    err = require_login()
    if err: return err
    if session['role'] != 'hr_admin': return jsonify({'error': 'Forbidden'}), 403
    
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if not file.filename.endswith('.csv'):
        return jsonify({'error': 'File must be CSV format'}), 400
    
    try:
        stream = io.TextIOWrapper(file.stream, encoding='utf-8')
        reader = csv.DictReader(stream)
        
        if not reader.fieldnames:
            return jsonify({'error': 'Empty CSV file'}), 400
        
        required_fields = ['employee_id', 'first_name', 'last_name', 'email']
        if not all(f in reader.fieldnames for f in required_fields):
            return jsonify({'error': f'Missing required columns: {", ".join(required_fields)}'}), 400
        
        conn = get_db(); c = conn.cursor()
        imported = []; errors = []
        
        for idx, row in enumerate(reader, start=2):  # start=2 to account for header row
            try:
                first = row.get('first_name', '').strip()
                last = row.get('last_name', '').strip()
                full = f"{first} {last}".strip()
                email = row.get('email', '').strip()
                employee_id = row.get('employee_id', '').strip()
                
                if not (first and last and email and employee_id):
                    errors.append(f"Row {idx}: Missing required fields (first_name, last_name, email, employee_id)")
                    continue
                
                # Check for duplicate email
                c.execute("SELECT id FROM users WHERE email=%s AND deleted_at IS NULL", (email,))
                if c.fetchone():
                    errors.append(f"Row {idx}: Email {email} already exists")
                    continue
                
                # Check for duplicate employee_id
                c.execute("SELECT id FROM users WHERE employee_id=%s AND deleted_at IS NULL", (employee_id,))
                if c.fetchone():
                    errors.append(f"Row {idx}: Employee ID {employee_id} already exists")
                    continue
                
                # Generate password
                temp_password = generate_password(8)
                hashed_password = hash_password(temp_password)
                
                # Parse hire_date
                hire_date = row.get('hire_date', '').strip() or None
                if hire_date:
                    try:
                        datetime.strptime(hire_date, '%Y-%m-%d')  # Validate date format
                    except ValueError:
                        errors.append(f"Row {idx}: Invalid hire_date format (use YYYY-MM-DD)")
                        continue
                
                probation_status = 'active' if hire_date else 'not_started'
                
                # Parse branch_id
                branch_id = row.get('branch_id', '').strip() or None
                if branch_id:
                    try:
                        branch_id = int(branch_id)
                    except ValueError:
                        errors.append(f"Row {idx}: Invalid branch_id")
                        continue
                
                # Parse manager_id
                manager_id = row.get('manager_id', '').strip() or None
                if manager_id:
                    try:
                        manager_id = int(manager_id)
                    except ValueError:
                        errors.append(f"Row {idx}: Invalid manager_id")
                        continue
                
                c.execute("""INSERT INTO users 
                            (employee_id, first_name, last_name, name, email, password, role, department, 
                             branch_id, manager_id, shift_start, shift_end, hire_date, certificate_name, 
                             certificate_expiry, probation_status, created_by)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            RETURNING id""",
                        (employee_id, first, last, full, email, hashed_password, 'employee',
                         row.get('department', '').strip(),
                         branch_id, manager_id,
                         row.get('shift_start', '09:00').strip() or '09:00',
                         row.get('shift_end', '18:00').strip() or '18:00',
                         hire_date, row.get('certificate_name', '').strip() or None,
                         row.get('certificate_expiry', '').strip() or None,
                         probation_status, session['user_id']))
                
                uid = row(c)['id']
                yr = today_local().year
                c.execute("SELECT id, max_days FROM leave_types")
                for lt in rows(c):
                    c.execute("INSERT INTO leave_balances (user_id, leave_type_id, year, total_days) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                              (uid, lt['id'], yr, lt['max_days']))
                
                log_audit(c, session['user_id'], 'user_create_bulk', entity_type='user', entity_id=uid,
                          after={'employee_id': employee_id, 'name': full, 'email': email, 'probation_status': probation_status})
                
                imported.append({'id': uid, 'email': email, 'name': full, 'temp_password': temp_password})
                
            except Exception as e:
                errors.append(f"Row {idx}: {str(e)}")
                continue
        
        conn.commit()
        conn.close()
        
        # Send welcome emails for successfully imported employees
        for emp in imported:
            app_url = f"{request.host_url.rstrip('/')}/index.html"
            send_welcome_email(emp['email'], emp['name'], emp['temp_password'], app_url)
        
        return jsonify({
            'ok': True,
            'imported': len(imported),
            'errors': errors,
            'employees': imported if imported else []
        })
    
    except Exception as e:
        return jsonify({'error': f"CSV parsing error: {str(e)}"}), 400

# ── Employee Termination · Soft Delete with Archive Export ──────────────────────
@app.route('/api/users/export-archive/<int:user_id>')
def export_employee_archive(user_id):
    """Export employee data + attendance history as CSV before termination."""
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    
    conn=get_db(); c=conn.cursor()
    try:
        # Get employee info
        c.execute("SELECT id,employee_id,first_name,last_name,email,department,hire_date,role FROM users WHERE id=%s AND deleted_at IS NULL",(user_id,))
        emp=row(c)
        if not emp:
            conn.close()
            return jsonify({'error':'Employee not found'}),404
        
        # Get all attendance records
        c.execute("SELECT date,punch_in,punch_out,status,geo_in,geo_out FROM attendance WHERE user_id=%s AND deleted_at IS NULL ORDER BY date DESC",(user_id,))
        atts=rows(c)
        conn.close()
        
        # Build CSV
        output=io.StringIO()
        w=csv.writer(output)
        w.writerow(['EMPLOYEE ARCHIVE EXPORT'])
        w.writerow(['Employee ID',emp['employee_id']])
        w.writerow(['Name',f"{emp['first_name']} {emp['last_name']}"])
        w.writerow(['Email',emp['email']])
        w.writerow(['Department',emp['department']])
        w.writerow(['Hire Date',emp['hire_date']])
        w.writerow(['Export Date',now_local().strftime('%Y-%m-%d %H:%M:%S')])
        w.writerow([])
        w.writerow(['ATTENDANCE RECORDS'])
        w.writerow(['Date','Punch In','Punch Out','Status','Location In','Location Out'])
        for a in atts:
            w.writerow([a['date'],a['punch_in'],a['punch_out'],a['status'],a['geo_in'],a['geo_out']])
        
        fname=f"employee_archive_{emp['employee_id']}_{today_local().strftime('%Y%m%d')}.csv"
        return Response(output.getvalue(),mimetype='text/csv',headers={'Content-Disposition':f'attachment;filename={fname}'})
    except Exception as e:
        conn.close()
        return jsonify({'error':str(e)}),400

@app.route('/api/users/terminate',methods=['POST'])
def terminate_employee():
    """Soft delete a single employee (and all their attendance records)."""
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    
    user_id=request.json.get('user_id')
    if not user_id: return jsonify({'error':'user_id required'}),400
    
    conn=get_db(); c=conn.cursor()
    try:
        # Get employee name for audit
        c.execute("SELECT first_name,last_name FROM users WHERE id=%s AND deleted_at IS NULL",(user_id,))
        emp=row(c)
        if not emp: conn.close(); return jsonify({'error':'Employee not found'}),404
        
        emp_name=f"{emp['first_name']} {emp['last_name']}"
        now=now_local()
        
        # Soft delete employee
        c.execute("UPDATE users SET deleted_at=%s WHERE id=%s",(now,user_id))
        
        # Soft delete all attendance records
        c.execute("UPDATE attendance SET deleted_at=%s WHERE user_id=%s",(now,user_id))
        
        # Log to audit trail
        log_audit(c,session['user_id'],'user_terminate',entity_type='user',entity_id=user_id,
                  after={'name':emp_name,'terminated_at':now.isoformat()})
        
        conn.commit()
        conn.close()
        
        sys.stderr.write(f"[terminate_employee] ✅ User {user_id} ({emp_name}) terminated\n")
        sys.stderr.flush()
        return jsonify({'ok':True,'message':f'Employee {emp_name} terminated'})
    except Exception as e:
        conn.rollback()
        conn.close()
        sys.stderr.write(f"[terminate_employee] ❌ Error: {str(e)}\n")
        sys.stderr.flush()
        return jsonify({'error':str(e)}),400

@app.route('/api/users/terminate-bulk',methods=['POST'])
def terminate_employees_bulk():
    """Soft delete multiple employees at once."""
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    
    user_ids=request.json.get('user_ids',[])
    if not user_ids: return jsonify({'error':'user_ids required'}),400
    
    conn=get_db(); c=conn.cursor()
    try:
        now=now_local()
        terminated=[]
        
        for uid in user_ids:
            c.execute("SELECT first_name,last_name FROM users WHERE id=%s AND deleted_at IS NULL",(uid,))
            emp=row(c)
            if emp:
                emp_name=f"{emp['first_name']} {emp['last_name']}"
                c.execute("UPDATE users SET deleted_at=%s WHERE id=%s",(now,uid))
                c.execute("UPDATE attendance SET deleted_at=%s WHERE user_id=%s",(now,uid))
                log_audit(c,session['user_id'],'user_terminate',entity_type='user',entity_id=uid,
                          after={'name':emp_name,'terminated_at':now.isoformat()})
                terminated.append({'id':uid,'name':emp_name})
        
        conn.commit()
        conn.close()
        
        sys.stderr.write(f"[terminate_bulk] ✅ Terminated {len(terminated)} employees\n")
        sys.stderr.flush()
        return jsonify({'ok':True,'count':len(terminated),'terminated':terminated})
    except Exception as e:
        conn.rollback()
        conn.close()
        sys.stderr.write(f"[terminate_bulk] ❌ Error: {str(e)}\n")
        sys.stderr.flush()
        return jsonify({'error':str(e)}),400

# ── R1 Audit Log Endpoints (HR Admin only) ────────────────────────────────────
@app.route('/api/audit-log')
def audit_log_list():
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    try:
        limit=min(int(request.args.get('limit',100)),500)
        offset=max(int(request.args.get('offset',0)),0)
    except (TypeError,ValueError):
        return jsonify({'error':'Invalid limit/offset'}),400
    filters=[]; params=[]
    for arg,col in [('user_id','al.user_id'),('action','al.action'),('entity_type','al.entity_type')]:
        v=request.args.get(arg)
        if v: filters.append(f"{col}=%s"); params.append(v)
    fd=request.args.get('from_date'); td=request.args.get('to_date')
    if fd: filters.append("al.created_at>=%s"); params.append(fd)
    if td: filters.append("al.created_at<(%s::date+INTERVAL '1 day')"); params.append(td)
    where=("WHERE "+" AND ".join(filters)) if filters else ""
    conn=get_db(); c=conn.cursor()
    c.execute(f"SELECT COUNT(*) as cnt FROM audit_log al {where}",params)
    total=c.fetchone()['cnt']
    c.execute(f"""SELECT al.id,al.user_id,COALESCE(u.name,'(deleted)') as user_name,
                         al.action,al.entity_type,al.entity_id,
                         al.before_json,al.after_json,al.ip_address,al.user_agent,al.created_at
                  FROM audit_log al LEFT JOIN users u ON u.id=al.user_id
                  {where} ORDER BY al.created_at DESC LIMIT %s OFFSET %s""",params+[limit,offset])
    data=[]
    for r in rows(c):
        data.append({'id':r['id'],'user_id':r['user_id'],'user_name':r['user_name'],
                     'action':r['action'],'entity_type':r['entity_type'],'entity_id':r['entity_id'],
                     'before':r['before_json'],'after':r['after_json'],
                     'ip':r['ip_address'],'user_agent':r['user_agent'],
                     'created_at':r['created_at'].isoformat() if r['created_at'] else None})
    conn.close()
    return jsonify({'total':total,'rows':data,'limit':limit,'offset':offset})

@app.route('/api/audit-log/export')
def audit_log_export():
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    conn=get_db(); c=conn.cursor()
    c.execute("""SELECT al.id,COALESCE(u.name,'(deleted)') as user_name,
                        al.action,al.entity_type,al.entity_id,al.ip_address,al.created_at
                 FROM audit_log al LEFT JOIN users u ON u.id=al.user_id
                 ORDER BY al.created_at DESC LIMIT 10000""")
    out=io.StringIO(); w=csv.writer(out)
    w.writerow(['ID','User','Action','Entity Type','Entity ID','IP','Timestamp (Jakarta)'])
    for r in rows(c):
        ts=r['created_at'].astimezone(ZoneInfo('Asia/Jakarta')).strftime('%Y-%m-%d %H:%M:%S') if r['created_at'] else ''
        w.writerow([r['id'],r['user_name'],r['action'],r['entity_type'] or '',r['entity_id'] or '',r['ip_address'] or '',ts])
    conn.close()
    return Response(out.getvalue(),mimetype='text/csv',
                    headers={'Content-Disposition':'attachment; filename=ontime_audit_log.csv'})

# ── R5: Blackout Dates API ──────────────────────────────────────────────────
@app.route('/api/blackout-dates', methods=['GET'])
def list_blackout_dates():
    """HR Admin: List all blackout dates."""
    err = require_login()
    if err: return err
    if session['role'] != 'hr_admin':
        return jsonify({'error': 'Forbidden'}), 403
    
    conn = get_db()
    c = conn.cursor()
    c.execute("""SELECT id, start_date, end_date, reason, applies_to, department_id, user_ids_json, auto_reject, created_at 
                 FROM blackout_dates ORDER BY start_date DESC""")
    rows = c.fetchall()
    conn.close()
    result = [dict(r) for r in rows]
    return jsonify(result)

@app.route('/api/blackout-dates/save', methods=['POST'])
def save_blackout_date():
    """HR Admin: Create or update blackout date."""
    err = require_login()
    if err: return err
    if session['role'] != 'hr_admin':
        return jsonify({'error': 'Forbidden'}), 403
    
    data = request.json
    bd_id = data.get('id')
    start_date = data.get('start_date')
    end_date = data.get('end_date')
    reason = data.get('reason', '')
    applies_to = data.get('applies_to', 'all')
    department_id = data.get('department_id')
    user_ids_json = data.get('user_ids_json')
    auto_reject = data.get('auto_reject', True)
    
    conn = get_db()
    c = conn.cursor()
    try:
        if bd_id:
            c.execute("""UPDATE blackout_dates 
                         SET start_date=%s, end_date=%s, reason=%s, applies_to=%s, department_id=%s, user_ids_json=%s, auto_reject=%s
                         WHERE id=%s""",
                      (start_date, end_date, reason, applies_to, department_id, user_ids_json, auto_reject, bd_id))
        else:
            c.execute("""INSERT INTO blackout_dates (start_date, end_date, reason, applies_to, department_id, user_ids_json, auto_reject, created_by)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                      (start_date, end_date, reason, applies_to, department_id, user_ids_json, auto_reject, session['user_id']))
        
        log_audit(c, session['user_id'], 'blackout_date_created', entity_type='blackout_dates',
                  after={'start_date': start_date, 'end_date': end_date, 'reason': reason})
        conn.commit()
        conn.close()
        return jsonify({'ok': True})
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(e)}), 400

@app.route('/api/blackout-dates/delete', methods=['POST'])
def delete_blackout_date():
    """HR Admin: Delete blackout date."""
    err = require_login()
    if err: return err
    if session['role'] != 'hr_admin':
        return jsonify({'error': 'Forbidden'}), 403
    
    data = request.json
    bd_id = data.get('id')
    
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute("DELETE FROM blackout_dates WHERE id=%s", (bd_id,))
        log_audit(c, session['user_id'], 'blackout_date_deleted', entity_type='blackout_dates', entity_id=bd_id)
        conn.commit()
        conn.close()
        return jsonify({'ok': True})
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(e)}), 400

@app.route('/api/blackout-dates/check', methods=['POST'])
def check_blackout_dates():
    """Check if dates fall within any blackout period."""
    data = request.json
    dates = data.get('dates', [])
    user_id = session.get('user_id')
    
    conn = get_db()
    c = conn.cursor()
    
    # Get user's department
    c.execute("SELECT department FROM users WHERE id=%s", (user_id,))
    user = c.fetchone()
    user_dept = user['department'] if user else None
    
    for date_str in dates:
        c.execute("""SELECT * FROM blackout_dates 
                     WHERE start_date <= %s AND end_date >= %s 
                     LIMIT 1""", (date_str, date_str))
        blocking = c.fetchone()
        
        if blocking:
            # Check if applies to this user
            applies_to = blocking['applies_to']
            
            if applies_to == 'all':
                conn.close()
                return jsonify({
                    'is_blackout': True,
                    'blocking_blackout': {
                        'id': blocking['id'],
                        'reason': blocking['reason'],
                        'start_date': str(blocking['start_date']),
                        'end_date': str(blocking['end_date']),
                    }
                })
            elif applies_to == 'department' and blocking['department_id']:
                c.execute("SELECT id FROM branches WHERE id=%s", (blocking['department_id'],))
                dept = c.fetchone()
                if dept and user_dept:
                    conn.close()
                    return jsonify({
                        'is_blackout': True,
                        'blocking_blackout': {
                            'id': blocking['id'],
                            'reason': blocking['reason'],
                        }
                    })
            elif applies_to == 'users' and blocking['user_ids_json']:
                try:
                    user_ids = json.loads(blocking['user_ids_json'])
                    if user_id in user_ids:
                        conn.close()
                        return jsonify({
                            'is_blackout': True,
                            'blocking_blackout': {
                                'id': blocking['id'],
                                'reason': blocking['reason'],
                            }
                        })
                except:
                    pass
    
    conn.close()
    return jsonify({'is_blackout': False})

# ── R7: Attendance Regularization API ────────────────────────────────────
@app.route('/api/attendance/request-correction', methods=['POST'])
def request_attendance_correction():
    """Employee requests punch time/status correction for current week."""
    err = require_login()
    if err: return err
    
    uid = session['user_id']
    data = request.json
    correction_date = data.get('date')
    original_punch_in = data.get('original_punch_in')
    original_punch_out = data.get('original_punch_out')
    original_status = data.get('original_status')
    corrected_punch_in = data.get('corrected_punch_in')
    corrected_punch_out = data.get('corrected_punch_out')
    corrected_status = data.get('corrected_status')
    reason = data.get('reason', '')
    attachment_url = data.get('attachment_url')
    
    # Validate: only current work week
    correction_d = datetime.strptime(correction_date, '%Y-%m-%d').date()
    today = today_local()
    monday = today - timedelta(days=today.weekday())  # Start of current week
    sunday = monday + timedelta(days=6)
    
    if not (monday <= correction_d <= sunday):
        return jsonify({'error': 'Can only request corrections for current work week (Mon-Sun)'}), 400
    
    conn = get_db()
    c = conn.cursor()
    
    try:
        c.execute("""
            INSERT INTO attendance_corrections (user_id, date, original_punch_in, original_punch_out, original_status, 
                                                corrected_punch_in, corrected_punch_out, corrected_status, reason, attachment_url, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending')
        """, (uid, correction_date, original_punch_in, original_punch_out, original_status,
              corrected_punch_in, corrected_punch_out, corrected_status, reason, attachment_url))
        
        # Get manager for notification
        c.execute("SELECT manager_id FROM users WHERE id=%s", (uid,))
        user = c.fetchone()
        manager_id = user['manager_id'] if user else None
        
        log_audit(c, uid, 'attendance_correction_requested', entity_type='attendance_corrections',
                  after={'date': correction_date, 'reason': reason})
        
        conn.commit()
        conn.close()
        
        return jsonify({'ok': True, 'message': 'Correction request submitted to your manager'})
    
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(e)}), 400

@app.route('/api/attendance/corrections/my-requests', methods=['GET'])
def get_my_corrections():
    """Employee views their own correction requests."""
    err = require_login()
    if err: return err
    
    uid = session['user_id']
    conn = get_db()
    c = conn.cursor()
    c.execute("""SELECT * FROM attendance_corrections 
                 WHERE user_id=%s ORDER BY created_at DESC""", (uid,))
    rows = c.fetchall()
    conn.close()
    
    result = [dict(r) for r in rows]
    return jsonify(result)

@app.route('/api/attendance/corrections/pending', methods=['GET'])
def get_pending_corrections():
    """Manager views pending corrections for their team."""
    err = require_login()
    if err: return err
    
    uid = session['user_id']
    role = session['role']
    
    if role == 'manager':
        conn = get_db()
        c = conn.cursor()
        c.execute("""SELECT ac.*, u.name, u.email FROM attendance_corrections ac
                     JOIN users u ON ac.user_id = u.id
                     WHERE u.manager_id=%s AND ac.status='pending'
                     ORDER BY ac.created_at ASC""", (uid,))
    elif role == 'hr_admin':
        conn = get_db()
        c = conn.cursor()
        c.execute("""SELECT ac.*, u.name, u.email, m.name as manager_name FROM attendance_corrections ac
                     JOIN users u ON ac.user_id = u.id
                     LEFT JOIN users m ON ac.manager_id = m.id
                     ORDER BY ac.created_at ASC""")
    else:
        return jsonify({'error': 'Forbidden'}), 403
    
    rows = c.fetchall()
    conn.close()
    
    result = [dict(r) for r in rows]
    return jsonify(result)

@app.route('/api/attendance/corrections/manager-approve', methods=['POST'])
def manager_approve_correction():
    """Manager approves correction request."""
    err = require_login()
    if err: return err
    
    if session['role'] != 'manager':
        return jsonify({'error': 'Forbidden'}), 403
    
    data = request.json
    correction_id = data.get('id')
    approved = data.get('approved', True)  # True = approve, False = reject
    
    conn = get_db()
    c = conn.cursor()
    
    try:
        c.execute("SELECT * FROM attendance_corrections WHERE id=%s", (correction_id,))
        correction = c.fetchone()
        
        if not correction:
            conn.close()
            return jsonify({'error': 'Correction not found'}), 404
        
        # Verify manager is supervising this user
        c.execute("SELECT id FROM users WHERE id=%s AND manager_id=%s", 
                  (correction['user_id'], session['user_id']))
        if not c.fetchone():
            conn.close()
            return jsonify({'error': 'Forbidden'}), 403
        
        if approved:
            c.execute("""UPDATE attendance_corrections 
                         SET status='manager_approved', manager_id=%s, manager_approved_at=%s
                         WHERE id=%s""",
                      (session['user_id'], now_local().isoformat(), correction_id))
            log_audit(c, session['user_id'], 'correction_manager_approved', 
                      entity_type='attendance_corrections', entity_id=correction_id)
        else:
            c.execute("""UPDATE attendance_corrections 
                         SET status='rejected', manager_id=%s, manager_approved_at=%s
                         WHERE id=%s""",
                      (session['user_id'], now_local().isoformat(), correction_id))
            log_audit(c, session['user_id'], 'correction_rejected', 
                      entity_type='attendance_corrections', entity_id=correction_id)
        
        conn.commit()
        conn.close()
        
        return jsonify({'ok': True, 'message': 'Manager approval recorded'})
    
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(e)}), 400

@app.route('/api/attendance/corrections/hr-acknowledge', methods=['POST'])
def hr_acknowledge_correction():
    """HR acknowledges and applies correction to actual attendance."""
    err = require_login()
    if err: return err
    
    if session['role'] != 'hr_admin':
        return jsonify({'error': 'Forbidden'}), 403
    
    data = request.json
    correction_id = data.get('id')
    
    conn = get_db()
    c = conn.cursor()
    
    try:
        c.execute("SELECT * FROM attendance_corrections WHERE id=%s", (correction_id,))
        correction = c.fetchone()
        
        if not correction:
            conn.close()
            return jsonify({'error': 'Correction not found'}), 404
        
        # Apply correction to attendance table
        c.execute("""UPDATE attendance 
                     SET punch_in=%s, punch_out=%s, status=%s
                     WHERE user_id=%s AND date=%s""",
                  (correction['corrected_punch_in'], correction['corrected_punch_out'], 
                   correction['corrected_status'], correction['user_id'], correction['date']))
        
        # Mark correction as acknowledged
        c.execute("""UPDATE attendance_corrections 
                     SET status='hr_acknowledged', hr_id=%s, hr_acknowledged_at=%s
                     WHERE id=%s""",
                  (session['user_id'], now_local().isoformat(), correction_id))
        
        log_audit(c, session['user_id'], 'correction_hr_acknowledged_and_applied',
                  entity_type='attendance', entity_id=correction['user_id'],
                  after={'date': correction['date'], 'new_status': correction['corrected_status']})
        
        conn.commit()
        conn.close()
        
        return jsonify({'ok': True, 'message': 'Correction applied to attendance'})
    
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(e)}), 400
    
@app.route('/api/attendance/corrections/upload', methods=['POST'])
def upload_correction_attachment():
    """Upload attachment for correction request."""
    err = require_login()
    if err: return err
    
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # For now, just store filename and path (you can add cloud storage later)
    filename = f"{session['user_id']}_{int(now_local().timestamp())}_{file.filename}"
    
    try:
        # Create uploads folder if it doesn't exist
        import os
        os.makedirs('uploads', exist_ok=True)
        filepath = os.path.join('uploads', filename)
        file.save(filepath)
        
        return jsonify({
            'ok': True,
            'filename': filename,
            'url': f'/uploads/{filename}'
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 400

# ── R8: Approval Delegation API ──────────────────────────────────────────────
@app.route('/api/approval-delegations/create', methods=['POST'])
def create_delegation():
    """Manager/HR creates a delegation."""
    err = require_login()
    if err: return err
    
    if session['role'] not in ['manager', 'hr_admin']:
        return jsonify({'error': 'Forbidden'}), 403
    
    data = request.json
    delegate_id = data.get('delegate_id')
    start_date = data.get('start_date')
    end_date = data.get('end_date')
    
    # Validate
    if not delegate_id or not start_date or not end_date:
        return jsonify({'error': 'Missing required fields'}), 400
    
    # Validate date range
    try:
        s = datetime.strptime(start_date, '%Y-%m-%d').date()
        e = datetime.strptime(end_date, '%Y-%m-%d').date()
        if s > e:
            return jsonify({'error': 'Start date must be before end date'}), 400
    except:
        return jsonify({'error': 'Invalid date format'}), 400
    
    conn = get_db()
    c = conn.cursor()
    
    try:
        # Check if delegate exists
        c.execute("SELECT id FROM users WHERE id=%s", (delegate_id,))
        if not c.fetchone():
            conn.close()
            return jsonify({'error': 'Delegate not found'}), 404
        
        # Revoke any existing active delegation from this delegator (one-to-one rule)
        c.execute("""UPDATE approval_delegations 
                     SET is_active=FALSE, revoked_at=%s
                     WHERE delegator_id=%s AND is_active=TRUE""",
                  (now_local().isoformat(), session['user_id']))
        
        # Create new delegation
        c.execute("""
            INSERT INTO approval_delegations (delegator_id, delegate_id, start_date, end_date, is_active)
            VALUES (%s, %s, %s, %s, TRUE)
        """, (session['user_id'], delegate_id, start_date, end_date))
        
        log_audit(c, session['user_id'], 'delegation_created', entity_type='approval_delegations',
                  after={'delegate_id': delegate_id, 'start_date': start_date, 'end_date': end_date})
        
        conn.commit()
        conn.close()
        
        return jsonify({'ok': True, 'message': f'Delegation created until {end_date}'})
    
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(e)}), 400

@app.route('/api/approval-delegations/my-delegations', methods=['GET'])
def get_my_delegations():
    """Manager/HR views delegations they've made (to revoke if needed)."""
    err = require_login()
    if err: return err
    
    uid = session['user_id']
    conn = get_db()
    c = conn.cursor()
    c.execute("""SELECT ad.*, u.name as delegate_name 
                 FROM approval_delegations ad
                 JOIN users u ON ad.delegate_id = u.id
                 WHERE ad.delegator_id=%s
                 ORDER BY ad.created_at DESC""", (uid,))
    rows = c.fetchall()
    conn.close()
    
    result = [dict(r) for r in rows]
    return jsonify(result)

@app.route('/api/approval-delegations/active', methods=['GET'])
def get_active_delegations():
    """Get active delegations for current user (as delegate)."""
    err = require_login()
    if err: return err
    
    uid = session['user_id']
    today = today_local().isoformat()
    conn = get_db()
    c = conn.cursor()
    c.execute("""SELECT ad.*, u.name as delegator_name, u.email as delegator_email
                 FROM approval_delegations ad
                 JOIN users u ON ad.delegator_id = u.id
                 WHERE ad.delegate_id=%s AND ad.is_active=TRUE AND ad.start_date <= %s AND ad.end_date >= %s
                 ORDER BY ad.start_date ASC""", (uid, today, today))
    rows = c.fetchall()
    conn.close()
    
    result = [dict(r) for r in rows]
    return jsonify(result)

@app.route('/api/approval-delegations/revoke', methods=['POST'])
def revoke_delegation():
    """Manager/HR revokes a delegation."""
    err = require_login()
    if err: return err
    
    if session['role'] not in ['manager', 'hr_admin']:
        return jsonify({'error': 'Forbidden'}), 403
    
    data = request.json
    delegation_id = data.get('id')
    
    conn = get_db()
    c = conn.cursor()
    
    try:
        c.execute("SELECT delegator_id FROM approval_delegations WHERE id=%s", (delegation_id,))
        delegation = c.fetchone()
        
        if not delegation:
            conn.close()
            return jsonify({'error': 'Delegation not found'}), 404
        
        # Only delegator can revoke
        if delegation['delegator_id'] != session['user_id']:
            conn.close()
            return jsonify({'error': 'Forbidden'}), 403
        
        c.execute("""UPDATE approval_delegations 
                     SET is_active=FALSE, revoked_at=%s
                     WHERE id=%s""",
                  (now_local().isoformat(), delegation_id))
        
        log_audit(c, session['user_id'], 'delegation_revoked', entity_type='approval_delegations', entity_id=delegation_id)
        
        conn.commit()
        conn.close()
        
        return jsonify({'ok': True, 'message': 'Delegation revoked'})
    
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(e)}), 400
    
# ── R9: Cuti Bersama API ────────────────────────────────────────────────────
@app.route('/api/cuti-bersama/list', methods=['GET'])
def get_cuti_bersama():
    """Fetch all cuti bersama dates for a given year."""
    year = request.args.get('year', 2026, type=int)
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id, date, name, year, deduction_type FROM cuti_bersama WHERE year=%s ORDER BY date", (year,))
    rows = c.fetchall()
    conn.close()
    result = [dict(r) for r in rows]
    return jsonify(result)

# ── Serve ─────────────────────────────────────────────────────────────────────
@app.route('/setup-db-workpulse-2026')
def setup_db():
    """One-time setup endpoint — initializes all DB tables and seed data."""
    try:
        init_db()
        return jsonify({'ok': True, 'message': 'Database initialized successfully! You can now log in.'})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/backup-db-r6-safety', methods=['GET'])
def backup_db():
    """Simple database backup"""
    from datetime import datetime
    import json
    
    try:
        conn = get_db()
        c = conn.cursor()
        
        # Get all tables
        c.execute("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema='public' AND table_type='BASE TABLE'
            ORDER BY table_name
        """)
        tables = [row[0] for row in c.fetchall()]
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'backup_r6_{timestamp}.json'
        
        backup_data = {}
        
        for table in tables:
            c.execute(f"SELECT * FROM {table}")
            cols = [desc[0] for desc in c.description]
            rows = c.fetchall()
            
            backup_data[table] = {
                'columns': cols,
                'rows': [dict(zip(cols, row)) for row in rows]
            }
        
        conn.close()
        
        return json.dumps(backup_data, indent=2, default=str), 200, {
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Content-Type': 'application/json'
        }
    except Exception as e:
        return f"Error: {str(e)}", 500
    
@app.route('/clear-today-workpulse-2026', methods=['GET','POST'])
def clear_today():
    """Clear ALL attendance records for today — use after timezone fix."""
    try:
        conn = get_db(); c = conn.cursor()
        today = today_local().isoformat()
        c.execute("DELETE FROM attendance WHERE date = %s", (today,))
        deleted = c.rowcount
        conn.commit(); conn.close()
        return jsonify({'ok': True, 'message': f'Cleared {deleted} attendance record(s) for {today}. Everyone can punch in fresh now.'})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Overtime & Auto Checkout ──────────────────────────────────────────────────
@app.route('/api/overtime/set', methods=['POST'])
def set_overtime():
    """Employee confirms overtime — store planned checkout time."""
    err = require_login()
    if err: return err
    uid   = session['user_id']
    data  = request.json
    today = today_local().isoformat()
    planned_out = data.get('planned_checkout')   # e.g. '19:00'
    conn = get_db(); c = conn.cursor()
    # Store planned_checkout in attendance notes JSON
    c.execute("SELECT notes FROM attendance WHERE user_id=%s AND date=%s", (uid, today))
    row_data = c.fetchone()
    notes_data = {}
    if row_data and row_data['notes']:
        try: notes_data = json.loads(row_data['notes'])
        except: notes_data = {}
    notes_data['planned_checkout'] = planned_out
    notes_data['overtime'] = True
    c.execute("UPDATE attendance SET notes=%s WHERE user_id=%s AND date=%s",
              (json.dumps(notes_data), uid, today))
    log_audit(c, uid, 'overtime_set', entity_type='attendance', after={'planned_checkout':planned_out})
    conn.commit(); conn.close()
    return jsonify({'ok': True, 'planned_checkout': planned_out})

@app.route('/api/overtime/auto-checkout', methods=['POST'])
def auto_checkout():
    """System auto punch-out at planned checkout time (called by frontend timer)."""
    err = require_login()
    if err: return err
    uid   = session['user_id']
    today = today_local().isoformat()
    checkout_time = request.json.get('time')   # HH:MM:SS
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM attendance WHERE user_id=%s AND date=%s", (uid, today))
    att = c.fetchone()
    if not att or not att['punch_in']:
        conn.close(); return jsonify({'error': 'No punch-in found'}), 400
    if att['punch_out']:
        conn.close(); return jsonify({'ok': True, 'already_done': True})
    c.execute("UPDATE attendance SET punch_out=%s WHERE user_id=%s AND date=%s",
              (checkout_time, uid, today))
    log_audit(c, uid, 'auto_checkout', entity_type='attendance', entity_id=att['id'], after={'punch_out':checkout_time})
    conn.commit(); conn.close()
    return jsonify({'ok': True, 'punch_out': checkout_time})

@app.route('/api/overtime/missing-report', methods=['POST'])
def missing_checkout_report():
    """Notify supervisor when employee forgets to clock out entirely."""
    err = require_login()
    if err: return err
    uid   = session['user_id']
    today = today_local().isoformat()
    conn  = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM attendance WHERE user_id=%s AND date=%s", (uid, today)); att = c.fetchone()
    c.execute("SELECT * FROM users WHERE id=%s", (uid,)); emp = c.fetchone()
    mgr = None
    if emp['manager_id']:
        c.execute("SELECT * FROM users WHERE id=%s", (emp['manager_id'],)); mgr = c.fetchone()
    conn.close()
    if not att or not att['punch_in']: return jsonify({'ok': False, 'error': 'No attendance record'}), 400
    if not mgr: return jsonify({'ok': True, 'note': 'No supervisor to notify'})
    base = get_setting('base_url', 'http://localhost:5000')
    html = f"""<div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:#0f1f3d;padding:24px 28px"><h2 style="color:white;margin:0">⚠️ OnTime — Missing Clock-Out</h2></div>
      <div style="padding:28px">
        <p>Hi <strong>{mgr['name']}</strong>,</p>
        <p><strong>{emp['name']}</strong> did not clock out today and the system could not determine their checkout time.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
          <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-weight:600;width:140px">Employee</td><td style="padding:10px">{emp['name']} ({emp['employee_id']})</td></tr>
          <tr><td style="padding:10px;color:#64748b;font-weight:600">Department</td><td style="padding:10px">{emp['department'] or '—'}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:10px;color:#64748b;font-weight:600">Date</td><td style="padding:10px">{today}</td></tr>
          <tr><td style="padding:10px;color:#64748b;font-weight:600">Clock In</td><td style="padding:10px">{att['punch_in']}</td></tr>
          <tr style="background:#fef2f2"><td style="padding:10px;color:#dc2626;font-weight:600">Clock Out</td><td style="padding:10px;color:#dc2626"><strong>MISSING</strong></td></tr>
        </table>
        <p style="color:#64748b;font-size:14px">Please log in to OnTime to manually enter their clock-out time.</p>
        <a href="{base}" style="display:inline-block;background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Open OnTime →</a>
      </div>
      <div style="background:#f8fafc;padding:14px 28px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0">Automated notification from OnTime.</div>
    </div>"""
    ok, msg = send_email(mgr['email'], f"Missing Clock-Out: {emp['name']} — {today}", html)
    return jsonify({'ok': True, 'email_sent': ok, 'note': msg})

@app.route('/api/overtime/manual-checkout', methods=['POST'])
def manual_checkout():
    """Supervisor manually sets clock-out time for an employee."""
    err = require_login()
    if err: return err
    if session['role'] not in ('manager', 'hr_admin'):
        return jsonify({'error': 'Forbidden'}), 403
    data    = request.json
    user_id = data['user_id']
    date_   = data['date']
    time_   = data['time']   # HH:MM
    conn    = get_db(); c = conn.cursor()
    c.execute("UPDATE attendance SET punch_out=%s, notes=COALESCE(notes,'') WHERE user_id=%s AND date=%s",
              (time_ + ':00', user_id, date_))
    if c.rowcount == 0:
        conn.close(); return jsonify({'error': 'Attendance record not found'}), 404
    log_audit(c, session['user_id'], 'manual_checkout', entity_type='attendance',
              after={'target_user_id':user_id,'date':date_,'punch_out':time_+':00'})
    conn.commit(); conn.close()
    return jsonify({'ok': True})

@app.route('/api/attendance/missing-checkouts')
def missing_checkouts():
    """Get employees with punch-in but no punch-out for a given date (manager/HR only)."""
    err = require_login()
    if err: return err
    uid  = session['user_id']
    role = session['role']
    if role not in ('manager', 'hr_admin'):
        return jsonify({'error': 'Forbidden'}), 403
    date_ = request.args.get('date', today_local().isoformat())
    conn  = get_db(); c = conn.cursor()
    if role == 'hr_admin':
        c.execute("""SELECT u.id,u.name,u.employee_id,u.department,u.shift_end,
                          a.punch_in,a.punch_out,a.date,a.notes
                   FROM attendance a JOIN users u ON a.user_id=u.id
                   WHERE a.date=%s AND a.punch_in IS NOT NULL
                   AND (a.punch_out IS NULL OR a.punch_out='')
                   AND u.role!='hr_admin' ORDER BY u.name""", (date_,))
    else:
        c.execute("""SELECT u.id,u.name,u.employee_id,u.department,u.shift_end,
                          a.punch_in,a.punch_out,a.date,a.notes
                   FROM attendance a JOIN users u ON a.user_id=u.id
                   WHERE a.date=%s AND a.punch_in IS NOT NULL
                   AND (a.punch_out IS NULL OR a.punch_out='')
                   AND u.manager_id=%s ORDER BY u.name""", (date_, uid))
    data = c.fetchall(); conn.close()
    return jsonify([dict(r) for r in data])

@app.route('/')
@app.route('/<path:path>')
def serve(path=''):
    if path and os.path.exists(os.path.join(app.static_folder,path)):
        return send_from_directory(app.static_folder,path)
    return send_from_directory(app.template_folder,'index.html')

# Auto-initialize DB on startup (works with gunicorn too, not just __main__)
try:
    init_db()
    print("✅ Database ready")
except Exception as e:
    print(f"⚠️  DB init error: {e}")


# ── R4: Auto-transition probation on startup ──────────────────────────────────
try:
    check_and_transition_probation()
except Exception as e:
    sys.stderr.write(f"[startup] Probation transition check failed: {e}\n")
    sys.stderr.flush()

if __name__=='__main__':
    app.run(debug=False, host='0.0.0.0', port=int(os.environ.get('PORT',5000)))


# ── R2 · Consent & Data Privacy (UU PDP) ──────────────────────────────────
@app.route('/api/consent/accept', methods=['POST'])
def accept_consent():
    """Accept privacy policy and consent to data processing."""
    err = require_login()
    if err: return err
    try:
        uid = session['user_id']
        conn = get_db(); c = conn.cursor()
        c.execute("""INSERT INTO consent_log (user_id, consent_type, version, accepted, ip_address)
                     VALUES (%s, 'privacy_policy', %s, %s, %s)""",
                  (uid, CURRENT_CONSENT_VERSION, True, request.remote_addr))
        # Try to log audit, but don't fail if it errors
        try:
            log_audit(c, uid, 'consent_accepted', entity_type='consent', entity_id=uid,
                      after={'version': CURRENT_CONSENT_VERSION})
        except Exception as audit_err:
            print(f"[accept_consent] Audit log failed: {audit_err}")
        conn.commit(); conn.close()
        return jsonify({'ok': True})
    except Exception as e:
        print(f"[accept_consent] Error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/user/consent-status')
def get_consent_status():
    """Check if user has accepted current privacy policy version."""
    err = require_login()
    if err: return err
    uid = session['user_id']
    conn = get_db(); c = conn.cursor()
    c.execute("""SELECT accepted FROM consent_log 
                 WHERE user_id=%s AND version=%s AND accepted=true 
                 ORDER BY accepted_at DESC LIMIT 1""",
              (uid, CURRENT_CONSENT_VERSION))
    result = c.fetchone()
    conn.close()
    return jsonify({'accepted': bool(result)})

@app.route('/api/user/data')
def export_user_data():
    """Export user's personal data (GDPR/UU PDP right to access)."""
    err = require_login()
    if err: return err
    uid = session['user_id']
    conn = get_db(); c = conn.cursor()
    
    # User profile
    c.execute("""SELECT id, employee_id, first_name, last_name, email, role, department, 
                        shift_start, shift_end, created_at FROM users WHERE id=%s""", (uid,))
    user = c.fetchone()
    
    # Attendance records
    c.execute("""SELECT date, punch_in, punch_out, status, geo_in, geo_out FROM attendance 
                 WHERE user_id=%s AND deleted_at IS NULL ORDER BY date DESC""", (uid,))
    attendance = [dict(r) for r in c.fetchall()]
    
    # Leave requests
    c.execute("""SELECT lr.start_date, lr.end_date, lr.days, lt.name as leave_type, 
                        lr.status, lr.reason, lr.created_at
                 FROM leave_requests lr JOIN leave_types lt ON lr.leave_type_id=lt.id
                 WHERE lr.user_id=%s AND lr.deleted_at IS NULL ORDER BY lr.created_at DESC""", (uid,))
    leaves = [dict(r) for r in c.fetchall()]
    
    # Consent history
    c.execute("""SELECT consent_type, version, accepted, accepted_at FROM consent_log 
                 WHERE user_id=%s ORDER BY accepted_at DESC""", (uid,))
    consents = [dict(r) for r in c.fetchall()]
    
    c.execute("SELECT * FROM users WHERE id=%s", (uid,))
    user_for_audit = c.fetchone()
    log_audit(c, uid, 'data_export_requested', entity_type='user', entity_id=uid)
    conn.commit(); conn.close()
    
    # Return as JSON (user can download via browser)
    export_data = {
        'exported_at': now_local().isoformat(),
        'user': dict(user) if user else None,
        'attendance': attendance,
        'leave_requests': leaves,
        'consent_history': consents
    }
    
    return jsonify(export_data)

@app.route('/api/user/delete-request', methods=['POST'])
def request_deletion():
    """User requests account deletion (right to be forgotten)."""
    err = require_login()
    if err: return err
    uid = session['user_id']
    reason = request.json.get('reason', '')
    conn = get_db(); c = conn.cursor()
    
    # Check if already pending
    c.execute("SELECT id FROM data_deletion_requests WHERE user_id=%s AND status='pending'", (uid,))
    if c.fetchone():
        conn.close()
        return jsonify({'error': 'Deletion request sudah dalam proses'}), 400
    
    c.execute("""INSERT INTO data_deletion_requests (user_id, reason, status) 
                 VALUES (%s, %s, 'pending')""", (uid, reason))
    log_audit(c, uid, 'deletion_request_submitted', entity_type='user', entity_id=uid,
              after={'reason': reason})
    conn.commit(); conn.close()
    return jsonify({'ok': True, 'message': 'Permintaan penghapusan akun diterima. Tim HR akan meninjau dalam 7 hari.'})

@app.route('/api/admin/deletion-requests')
def list_deletion_requests():
    """HR Admin view pending deletion requests."""
    err = require_login()
    if err: return err
    if session['role'] != 'hr_admin':
        return jsonify({'error': 'Forbidden'}), 403
    
    conn = get_db(); c = conn.cursor()
    c.execute("""SELECT dr.id, dr.user_id, u.name, u.email, u.employee_id, 
                        dr.reason, dr.status, dr.requested_at, dr.reviewed_at, dr.review_notes
                 FROM data_deletion_requests dr JOIN users u ON u.id=dr.user_id
                 WHERE dr.status IN ('pending', 'approved') 
                 ORDER BY dr.requested_at DESC""")
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return jsonify(rows)

@app.route('/api/admin/deletion-review', methods=['POST'])
def review_deletion():
    """HR Admin approve or reject deletion request."""
    err = require_login()
    if err: return err
    if session['role'] != 'hr_admin':
        return jsonify({'error': 'Forbidden'}), 403
    
    data = request.json
    req_id = data['request_id']
    action = data['action']  # 'approve' or 'reject'
    notes = data.get('notes', '')
    
    if action not in ('approve', 'reject'):
        return jsonify({'error': 'Invalid action'}), 400
    
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT user_id FROM data_deletion_requests WHERE id=%s", (req_id,))
    req = c.fetchone()
    if not req:
        conn.close()
        return jsonify({'error': 'Request not found'}), 404
    
    target_user_id = req['user_id']
    new_status = 'approved' if action == 'approve' else 'rejected'
    
    c.execute("""UPDATE data_deletion_requests 
                 SET status=%s, reviewed_by=%s, reviewed_at=%s, review_notes=%s 
                 WHERE id=%s""",
              (new_status, session['user_id'], now_local().isoformat(), notes, req_id))
    
    # If approved, soft-delete the user and their data
    if action == 'approve':
        delete_time = now_local().isoformat()
        c.execute("UPDATE users SET deleted_at=%s WHERE id=%s", (delete_time, target_user_id))
        c.execute("UPDATE attendance SET deleted_at=%s WHERE user_id=%s", (delete_time, target_user_id))
        c.execute("UPDATE leave_requests SET deleted_at=%s WHERE user_id=%s", (delete_time, target_user_id))
        log_audit(c, session['user_id'], 'user_deletion_approved', entity_type='user', 
                  entity_id=target_user_id, after={'deleted_at': delete_time})
    else:
        log_audit(c, session['user_id'], 'user_deletion_rejected', entity_type='user',
                  entity_id=target_user_id, after={'rejection_notes': notes})
    
    conn.commit(); conn.close()
    return jsonify({'ok': True})

# ── Reports API ───────────────────────────────────────────────────────────────
@app.route('/api/reports/my-attendance')
def report_my_attendance():
    err = require_login()
    if err: return err
    uid   = session['user_id']
    month = request.args.get('month', today_local().strftime('%Y-%m'))
    conn  = get_db(); c = conn.cursor()
    c.execute(
        "SELECT u.name,u.employee_id,u.department,u.shift_start,u.shift_end,"
        "a.date,a.punch_in,a.punch_out,a.status,a.geo_in,a.geo_out "
        "FROM attendance a JOIN users u ON a.user_id=u.id "
        "WHERE a.user_id=%s AND a.date LIKE %s ORDER BY a.date",
        (uid, f"{month}%"))
    att = c.fetchall()
    c.execute(
        "SELECT lr.*,lt.name as leave_name "
        "FROM leave_requests lr JOIN leave_types lt ON lr.leave_type_id=lt.id "
        "WHERE lr.user_id=%s AND lr.start_date LIKE %s ORDER BY lr.start_date",
        (uid, f"{month}%"))
    leaves = c.fetchall()
    conn.close()
    return jsonify({'attendance':[dict(r) for r in att],'leaves':[dict(r) for r in leaves]})

@app.route('/api/reports/team-attendance')
def report_team_attendance():
    err = require_login()
    if err: return err
    uid  = session['user_id']
    role = session['role']
    if role not in ('manager','hr_admin'): return jsonify({'error':'Forbidden'}),403
    month = request.args.get('month', today_local().strftime('%Y-%m'))
    dept  = request.args.get('dept','')
    conn  = get_db(); c = conn.cursor()

    # Attendance
    if role == 'hr_admin':
        base = ("SELECT u.name,u.employee_id,u.department,u.shift_start,u.shift_end,"
                "a.date,a.punch_in,a.punch_out,a.status,a.geo_in "
                "FROM attendance a JOIN users u ON a.user_id=u.id "
                "WHERE a.date LIKE %s AND u.role!='hr_admin'")
        if dept:
            c.execute(base + " AND u.department=%s ORDER BY u.department,u.name,a.date", (f"{month}%",dept))
        else:
            c.execute(base + " ORDER BY u.department,u.name,a.date", (f"{month}%",))
    else:
        c.execute(
            "SELECT u.name,u.employee_id,u.department,u.shift_start,u.shift_end,"
            "a.date,a.punch_in,a.punch_out,a.status,a.geo_in "
            "FROM attendance a JOIN users u ON a.user_id=u.id "
            "WHERE a.date LIKE %s AND u.manager_id=%s ORDER BY u.name,a.date",
            (f"{month}%", uid))
    att_rows = c.fetchall()

    # Leaves
    if role == 'hr_admin':
        base2 = ("SELECT u.name,u.employee_id,u.department,lr.start_date,lr.end_date,"
                 "lr.days,lt.name as leave_name,lr.status,lr.reason "
                 "FROM leave_requests lr JOIN users u ON lr.user_id=u.id "
                 "JOIN leave_types lt ON lr.leave_type_id=lt.id "
                 "WHERE lr.start_date LIKE %s")
        if dept:
            c.execute(base2 + " AND u.department=%s ORDER BY u.name,lr.start_date", (f"{month}%",dept))
        else:
            c.execute(base2 + " ORDER BY u.name,lr.start_date", (f"{month}%",))
    else:
        c.execute(
            "SELECT u.name,u.employee_id,u.department,lr.start_date,lr.end_date,"
            "lr.days,lt.name as leave_name,lr.status,lr.reason "
            "FROM leave_requests lr JOIN users u ON lr.user_id=u.id "
            "JOIN leave_types lt ON lr.leave_type_id=lt.id "
            "WHERE lr.start_date LIKE %s AND u.manager_id=%s ORDER BY u.name,lr.start_date",
            (f"{month}%", uid))
    leave_rows = c.fetchall()

    c.execute("SELECT DISTINCT department FROM users WHERE role!='hr_admin' AND department IS NOT NULL ORDER BY department")
    depts = [r['department'] for r in c.fetchall()]
    conn.close()
    return jsonify({'attendance':[dict(r) for r in att_rows],'leaves':[dict(r) for r in leave_rows],'departments':depts})