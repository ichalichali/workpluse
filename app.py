from flask import Flask, request, jsonify, session, send_from_directory
import os, json, math, smtplib, hashlib, secrets
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
    conn.commit()

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

def send_email(to_addr,subject,html_body):
    if get_setting('email_enabled')!='1': return False,'Email not enabled'
    host=get_setting('smtp_host','smtp.gmail.com'); port=int(get_setting('smtp_port','587'))
    user=get_setting('smtp_user'); pw=get_setting('smtp_pass'); frm=get_setting('smtp_from') or user
    if not user or not pw: return False,'SMTP credentials not configured'
    try:
        msg=MIMEMultipart('alternative'); msg['Subject']=subject; msg['From']=frm; msg['To']=to_addr
        msg.attach(MIMEText(html_body,'html'))
        with smtplib.SMTP(host,port) as s:
            s.starttls(); s.login(user,pw); s.sendmail(frm,[to_addr],msg.as_string())
        return True,'sent'
    except Exception as e: return False,str(e)

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

# ── Auth ──────────────────────────────────────────────────────────────────────
@app.route('/api/login',methods=['POST'])
def login():
    data=request.json; conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM users WHERE email=%s AND password=%s",(data['email'],hash_password(data['password'])))
    user=row(c); conn.close()
    if not user: return jsonify({'error':'Invalid credentials'}),401
    session['user_id']=user['id']; session['role']=user['role']
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM attendance WHERE user_id=%s AND date=%s",(user['id'],today_local().isoformat()))
    att=row(c); conn.close()
    punch_status=att['status'] if att else ('not_punched' if today_local().weekday()<5 else None)
    return jsonify({'user':{'id':user['id'],'name':user['name'],'first_name':user['first_name'],'last_name':user['last_name'],
        'email':user['email'],'role':user['role'],'employee_id':user['employee_id'],
        'department':user['department'],'shift_start':user['shift_start'],'shift_end':user['shift_end'],
        'branch_id':user['branch_id']},'punch_status':punch_status})

@app.route('/api/logout',methods=['POST'])
def logout():
    session.clear(); return jsonify({'ok':True})

@app.route('/api/forgot-password',methods=['POST'])
def forgot_password():
    email=request.json.get('email'); conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM users WHERE email=%s",(email,)); user=row(c)
    if not user: conn.close(); return jsonify({'ok':True})
    token=secrets.token_urlsafe(32); expires=(now_local()+timedelta(hours=1)).isoformat()
    c.execute("UPDATE users SET reset_token=%s,reset_expires=%s WHERE id=%s",(token,expires,user['id']))
    conn.commit(); conn.close()
    return jsonify({'ok':True,'demo_token':token,'message':f'Reset link sent to {email}.'})

@app.route('/api/reset-password',methods=['POST'])
def reset_password():
    data=request.json; conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM users WHERE reset_token=%s",(data.get('token'),)); user=row(c)
    if not user or user['reset_expires']<now_local().isoformat():
        conn.close(); return jsonify({'error':'Invalid or expired token'}),400
    c.execute("UPDATE users SET password=%s,reset_token=NULL,reset_expires=NULL WHERE id=%s",(hash_password(data['password']),user['id']))
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
        c.execute("UPDATE branches SET name=%s,address=%s,latitude=%s,longitude=%s,radius_m=%s WHERE id=%s",
                  (data['name'],data.get('address',''),data.get('latitude'),data.get('longitude'),data.get('radius_m',200),data['id']))
    else:
        c.execute("INSERT INTO branches (name,address,latitude,longitude,radius_m) VALUES (%s,%s,%s,%s,%s)",
                  (data['name'],data.get('address',''),data.get('latitude'),data.get('longitude'),data.get('radius_m',200)))
    conn.commit(); conn.close(); return jsonify({'ok':True})

@app.route('/api/branches/delete',methods=['POST'])
def delete_branch():
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    conn=get_db(); c=conn.cursor()
    c.execute("DELETE FROM branches WHERE id=%s",(request.json['id'],))
    conn.commit(); conn.close(); return jsonify({'ok':True})

# ── Settings ──────────────────────────────────────────────────────────────────
@app.route('/api/settings')
def get_settings():
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT key,value FROM app_settings"); data=rows(c); conn.close()
    s={r['key']:r['value'] for r in data}; s.pop('smtp_pass',None)
    return jsonify(s)

@app.route('/api/settings/save',methods=['POST'])
def save_settings():
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    conn=get_db(); c=conn.cursor()
    for k,v in request.json.items():
        if k=='smtp_pass' and not v: continue
        c.execute("INSERT INTO app_settings (key,value) VALUES (%s,%s) ON CONFLICT(key) DO UPDATE SET value=%s",(k,str(v),str(v)))
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
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM leave_balances WHERE user_id=%s AND leave_type_id=%s AND year=%s",
              (uid,data['leave_type_id'],int(start_date[:4]))); bal=row(c)
    if not bal or (bal['total_days']-bal['used_days'])<days:
        conn.close(); return jsonify({'error':'Insufficient leave balance'}),400
    c.execute("INSERT INTO leave_requests (user_id,leave_type_id,start_date,end_date,days,reason,dates_json) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",
              (uid,data['leave_type_id'],start_date,end_date,days,data.get('reason',''),dates_json))
    req_id=row(c)['id']
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
    uid=session['user_id']; data=request.json; action=data['action']
    conn=get_db(); c=conn.cursor()
    c.execute("SELECT * FROM leave_requests WHERE id=%s",(data['request_id'],)); req=row(c)
    if not req: conn.close(); return jsonify({'error':'Not found'}),404
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
    conn.commit(); conn.close(); return jsonify({'ok':True})

# ── Users ─────────────────────────────────────────────────────────────────────
@app.route('/api/users')
def list_users():
    err=require_login()
    if err: return err
    conn=get_db(); c=conn.cursor()
    c.execute("""SELECT u.id,u.employee_id,u.first_name,u.last_name,u.name,u.email,u.role,
                  u.department,u.branch_id,u.manager_id,u.shift_start,u.shift_end,
                  u.created_at::text,m.name as manager_name,b.name as branch_name
           FROM users u LEFT JOIN users m ON u.manager_id=m.id
           LEFT JOIN branches b ON u.branch_id=b.id ORDER BY u.name""")
    data=rows(c); conn.close(); return jsonify([dict(r) for r in data])

@app.route('/api/users/add',methods=['POST'])
def add_user():
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    data=request.json
    first=data.get('first_name','').strip(); last=data.get('last_name','').strip()
    full=f"{first} {last}".strip(); conn=get_db(); c=conn.cursor()
    try:
        c.execute("INSERT INTO users (employee_id,first_name,last_name,name,email,password,role,department,branch_id,manager_id,shift_start,shift_end) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                  (data['employee_id'],first,last,full,data['email'],hash_password(data.get('password','Password123')),
                   data.get('role','employee'),data.get('department',''),
                   data.get('branch_id') or None,data.get('manager_id') or None,
                   data.get('shift_start','09:00'),data.get('shift_end','18:00')))
        uid=row(c)['id']; yr=today_local().year
        c.execute("SELECT id,max_days FROM leave_types"); lts=rows(c)
        for lt in lts:
            c.execute("INSERT INTO leave_balances (user_id,leave_type_id,year,total_days) VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                      (uid,lt['id'],yr,lt['max_days']))
        conn.commit()
    except Exception as e: conn.rollback(); conn.close(); return jsonify({'error':str(e)}),400
    conn.close(); return jsonify({'ok':True})

@app.route('/api/users/update',methods=['POST'])
def update_user():
    err=require_login()
    if err: return err
    if session['role']!='hr_admin': return jsonify({'error':'Forbidden'}),403
    data=request.json; first=data.get('first_name','').strip(); last=data.get('last_name','').strip()
    full=f"{first} {last}".strip(); conn=get_db(); c=conn.cursor()
    try:
        c.execute("UPDATE users SET first_name=%s,last_name=%s,name=%s,email=%s,role=%s,department=%s,branch_id=%s,manager_id=%s,shift_start=%s,shift_end=%s WHERE id=%s",
                  (first,last,full,data['email'],data.get('role','employee'),data.get('department',''),
                   data.get('branch_id') or None,data.get('manager_id') or None,
                   data.get('shift_start','09:00'),data.get('shift_end','18:00'),data['id']))
        if data.get('password'):
            c.execute("UPDATE users SET password=%s WHERE id=%s",(hash_password(data['password']),data['id']))
        conn.commit()
    except Exception as e: conn.rollback(); conn.close(); return jsonify({'error':str(e)}),400
    conn.close(); return jsonify({'ok':True})

# ── Serve ─────────────────────────────────────────────────────────────────────
@app.route('/setup-db-workpulse-2026')
def setup_db():
    """One-time setup endpoint — initializes all DB tables and seed data."""
    try:
        init_db()
        return jsonify({'ok': True, 'message': 'Database initialized successfully! You can now log in.'})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

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
    row = c.fetchone()
    notes_data = {}
    if row and row['notes']:
        try: notes_data = json.loads(row['notes'])
        except: notes_data = {}
    notes_data['planned_checkout'] = planned_out
    notes_data['overtime'] = True
    c.execute("UPDATE attendance SET notes=%s WHERE user_id=%s AND date=%s",
              (json.dumps(notes_data), uid, today))
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

if __name__=='__main__':
    app.run(debug=False, host='0.0.0.0', port=int(os.environ.get('PORT',5000)))

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
