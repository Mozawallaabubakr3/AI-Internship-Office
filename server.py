#!/usr/bin/env python3
"""Local-only internship workspace. Python standard library; no external sending."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
import argparse, hashlib, json, mimetypes, os, sqlite3, uuid
import pipeline
import review_inbox
import robot_sources
import robot_chat
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parent
DB=ROOT/'data'/'office.sqlite3'
STAGES=['Discovered','Researching','Preparing','Ready for approval','Applied','Interviewing','Offer','Rejected','Withdrawn']
COUNCIL=['Pending evaluation','Needs review','Approved','Approved — priority','Not approved']
ROLES=['Recruiter','Career strategist','Realist','Advocate','Skeptic']
DOCS={'base':ROOT/'documents'/'resume.pdf','example':ROOT/'documents'/'tailored-resume.pdf'}
def now(): return datetime.now(timezone.utc).isoformat()
def connect():
 return pipeline.db(DB)
def event(c,text): c.execute('INSERT INTO activity(text,created) VALUES(?,?)',(text,now()))
def initial():
 DB.parent.mkdir(exist_ok=True)
 with connect() as c:
  c.executescript('''CREATE TABLE IF NOT EXISTS opportunities(id TEXT PRIMARY KEY,source_key TEXT UNIQUE NOT NULL,data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,text TEXT NOT NULL,created TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);''')
  if c.execute("SELECT 1 FROM meta WHERE key='seeded'").fetchone():
   pipeline.init(DB)
   return
  c.execute("INSERT INTO meta VALUES('seeded','1')")
  event(c,'Empty source workspace initialized. No applications submitted.')
 pipeline.init(DB)

def all_data(c,table):return [json.loads(r['data']) for r in c.execute(f'SELECT data FROM {table}')]
def state():
 with connect() as c:
  approvals=all_data(c,'approvals')
  for a in approvals:
   if a.get('kind') in ('question','application','update') and not review_inbox.files_current(a,DOCS) and a['status']!='superseded':a['status']='needs_refresh'
   if a['kind']=='document':
    p=DOCS[a['document_id']];current=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
    a['changed']=current!=a['fingerprint']
    if a['changed']:a['status']='needs_refresh'
  return dict(opportunities=all_data(c,'opportunities'),contacts=all_data(c,'contacts'),approvals=approvals,activity=[dict(r) for r in c.execute('SELECT text,created FROM activity ORDER BY id DESC LIMIT 40')],stages=STAGES,pipeline=pipeline.view(DB),updated=now())
def clean(value,limit=10000):
 if not isinstance(value,str) or len(value)>limit:raise ValueError('Invalid text field.')
 return value.strip()
def url(value):
 value=clean(value,2000)
 if urlparse(value).scheme not in ('http','https') or not urlparse(value).netloc:raise ValueError('Use an http or https source URL.')
 return value

def source_key(value):
 p=urlparse(value)
 query=[(k,v) for k,v in parse_qsl(p.query,keep_blank_values=True) if not k.lower().startswith('utm_') and k.lower() not in ('trk','trackingid','ref','source')]
 return urlunparse(p._replace(query=urlencode(sorted(query)),fragment=''))

def allowed_origins(port):
 origins=[f'http://127.0.0.1:{port}',f'http://localhost:{port}']
 tunnel=os.environ.get('OFFICE_TUNNEL_ORIGIN','').strip()
 if tunnel:
  parsed=urlparse(tunnel)
  if (parsed.scheme!='http' or parsed.hostname not in ('127.0.0.1','localhost')
      or not parsed.port or parsed.username or parsed.password
      or parsed.path not in ('','/') or parsed.query or parsed.fragment):
   raise ValueError('OFFICE_TUNNEL_ORIGIN must be an HTTP localhost origin with a port.')
  origins.append(f'http://{parsed.hostname}:{parsed.port}')
 tailnet=os.environ.get('OFFICE_TAILNET_ORIGIN','').strip()
 if tailnet:
  parsed=urlparse(tailnet)
  if (parsed.scheme!='https' or not parsed.hostname or not parsed.hostname.endswith('.ts.net')
      or parsed.username or parsed.password or parsed.port not in (None,443)
      or parsed.path not in ('','/') or parsed.query or parsed.fragment):
   raise ValueError('OFFICE_TAILNET_ORIGIN must be an HTTPS *.ts.net origin without a path.')
  origins.append(f'https://{parsed.hostname}')
 return origins

def mutate(path,b,actor="User"):
 if path=='/api/world-chat':return robot_chat.post(ROOT,b)
 with connect() as c:
  if path=='/api/inbox/respond':return review_inbox.respond(c,b,DOCS)
  if path=='/api/inbox/instruction':return review_inbox.instruction(c,b)
  if path=='/api/opportunities':
   company=clean(b.get('company',''),150);title=clean(b.get('title',''),300);source=url(b.get('url',''))
   if not company or not title:raise ValueError('Company and role are required.')
   key=clean(b.get('source_key') or source_key(source),2000)
   if c.execute('SELECT 1 FROM opportunities WHERE source_key=?',(key,)).fetchone() or any(source_key(j['url'])==source_key(source) for j in all_data(c,'opportunities')):raise ValueError('This opportunity is already in your tracker.')
   j=dict(id=str(uuid.uuid4()),source_key=key,company=company,title=title,url=source,location=clean(b.get('location',''),200),season=clean(b.get('season','Summer 2027'),100),pay=clean(b.get('pay','Unknown'),100),category=clean(b.get('category','Finance'),100),council='Pending evaluation',user_approved=False,stage='Discovered',source=clean(b.get('source','Manual entry'),100),checked=clean(b.get('checked',''),30),deadline=clean(b.get('deadline',''),30),summary=clean(b.get('summary','')),next_action='Verify pay, dates and eligibility.',concerns=[],votes=[],notes='',documents=[],revision=1,history=[],evidence=[])
   c.execute('INSERT INTO opportunities VALUES(?,?,?)',(j['id'],key,json.dumps(j)));event(c,f'Added {company}: {title}.');return j
  if path=='/api/opportunity/update':
   row=c.execute('SELECT data FROM opportunities WHERE id=?',(b.get('id'),)).fetchone()
   if not row:raise ValueError('Opportunity not found.')
   j=json.loads(row['data']);stage=b.get('stage',j['stage'])
   if stage not in STAGES:raise ValueError('Invalid application stage.')
   proof=clean(b.get('evidence',''))
   if stage!=j['stage'] and stage in ['Applied','Interviewing','Offer','Rejected','Withdrawn'] and not proof:raise ValueError('Add a confirmation or source for this external status update.')
   old=j['stage'];j['stage']=stage
   if 'user_approved' in b:
    if not isinstance(b['user_approved'],bool):raise ValueError('User approval must be true or false.')
    j['user_approved']=b['user_approved']
    j['user_approval_note']=clean(b.get('user_approval_note',''),1000)
    j['user_approval_recorded_at']=now()
   for k in ['notes','next_action','deadline']:
    if k in b:j[k]=clean(b[k])
   j['revision']+=1
   if old!=stage:j['history'].append(dict(created=now(),stage=stage,evidence=proof,recorded_by=actor));event(c,f'{j["company"]}: {stage} recorded by {actor}.')
   c.execute('UPDATE opportunities SET data=? WHERE id=?',(json.dumps(j),j['id']));return j
  if path=='/api/contacts':
   if not c.execute('SELECT 1 FROM opportunities WHERE id=?',(b.get('opportunity_id'),)).fetchone():raise ValueError('Choose an opportunity.')
   name=clean(b.get('name',''),200)
   if not name:raise ValueError('Contact name required.')
   x=dict(id=str(uuid.uuid4()),opportunity_id=b['opportunity_id'],name=name,role=clean(b.get('role',''),200),group=clean(b.get('group',''),100),url=url(b.get('url','')),connection=clean(b.get('connection','')),created=now())
   c.execute('INSERT INTO contacts VALUES(?,?)',(x['id'],json.dumps(x)));event(c,f'Added contact {name}.');return x
  if path=='/api/outreach':
   if not c.execute('SELECT 1 FROM opportunities WHERE id=?',(b.get('opportunity_id'),)).fetchone():raise ValueError('Choose an opportunity.')
   recipient=clean(b.get('recipient',''),250);body=clean(b.get('body',''));channel=clean(b.get('channel',''),50)
   if not recipient or not body or channel not in ['Email','LinkedIn']:raise ValueError('Recipient, channel and message are required.')
   a=dict(id=str(uuid.uuid4()),kind='outreach',opportunity_id=b['opportunity_id'],title=clean(b.get('title','Outreach draft'),250),recipient=recipient,channel=channel,body=body,status='pending',created=now())
   a['fingerprint']=hashlib.sha256(json.dumps([a['recipient'],a['channel'],a['title'],a['body']]).encode()).hexdigest()
   c.execute('INSERT INTO approvals VALUES(?,?)',(a['id'],json.dumps(a)));event(c,f'Queued {channel} draft for review. Nothing sent.');return a
  if path=='/api/approval':
   row=c.execute('SELECT data FROM approvals WHERE id=?',(b.get('id'),)).fetchone()
   if not row:raise ValueError('Review item not found.')
   a=json.loads(row['data'])
   if a['kind'] not in ('document','outreach'):raise ValueError('Use the dedicated inbox review for this item.')
   if b.get('fingerprint')!=a['fingerprint']:raise ValueError('The reviewed version changed. Reopen it before deciding.')
   if a['kind']=='document' and hashlib.sha256(DOCS[a['document_id']].read_bytes()).hexdigest()!=a['fingerprint']:raise ValueError('Document changed after this review was created. It needs a fresh review.')
   if a['status']!='pending':raise ValueError('This version already has a decision.')
   if b.get('decision') not in ['approved','changes_requested']:raise ValueError('Invalid decision.')
   a['status']=b['decision'];a['decided']=now()
   c.execute('UPDATE approvals SET data=? WHERE id=?',(json.dumps(a),a['id']));event(c,f'{a["title"]}: {a["status"].replace("_"," ")}. Nothing submitted or sent.');return a
  raise ValueError('Unknown action.')

class Handler(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def headers_(self,status,ctype):
  self.send_response(status);self.send_header('Content-Type',ctype);self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('X-Frame-Options','DENY');self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");self.end_headers()
 def json_(self,status,obj):self.headers_(status,'application/json');self.wfile.write(json.dumps(obj).encode())
 def host_ok(self):return self.headers.get('Host') in [urlparse(origin).netloc for origin in allowed_origins(self.server.server_port)]
 def do_GET(self):
  if not self.host_ok():return self.json_(403,{'error':'Local access only.'})
  path=urlparse(self.path).path
  if path=='/api/state':return self.json_(200,state())
  if path=='/api/robot-sources':return self.json_(200,robot_sources.blueprints(ROOT))
  if path=='/api/world-systems':return self.json_(200,robot_chat.systems(ROOT))
  if path=='/api/world-chat-instructions':return self.json_(200,{'common':(ROOT/'config/world-chat-instructions.txt').read_text(),'model':robot_chat.settings(ROOT)['model']})
  if path=='/api/world-chat':
   try:return self.json_(200,robot_chat.view(ROOT,dict(parse_qsl(urlparse(self.path).query)).get('system','office')))
   except ValueError as e:return self.json_(400,{'error':str(e)})
  if path=='/api/export':return self.json_(200,state())
  if path.startswith('/documents/'):
   p=DOCS.get(path.split('/')[-1])
  else:
   p=(ROOT/'dist'/('index.html' if path=='/' else path.lstrip('/'))).resolve()
   if not p.is_relative_to(ROOT/'dist'):return self.json_(404,{'error':'Not found'})
  if not p or not p.is_file():return self.json_(404,{'error':'Not found'})
  self.headers_(200,mimetypes.guess_type(str(p))[0] or 'application/octet-stream');self.wfile.write(p.read_bytes())
 def do_POST(self):
  origin=self.headers.get('Origin');allowed=allowed_origins(self.server.server_port)
  if not self.host_ok() or origin not in allowed or self.headers.get('Content-Type','').split(';')[0]!='application/json':return self.json_(403,{'error':'Use this local workspace to make changes.'})
  try:
   n=int(self.headers.get('Content-Length','0'))
   if n<1 or n>65536:raise ValueError('Invalid request size.')
   b=json.loads(self.rfile.read(n))
   if not isinstance(b,dict):raise ValueError('Invalid request.')
   return self.json_(200,mutate(urlparse(self.path).path,b))
  except (ValueError,KeyError,TypeError) as e:return self.json_(400,{'error':str(e)})

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8765);args=parser.parse_args()
 if (ROOT/'data'/'REMOTE_PRIMARY').exists():
  raise SystemExit('The server dashboard is the live record. This Mac database is archived; use the private server connection.')
 initial()
 robot_chat.recover(ROOT)
 allowed_origins(args.port)
 print(f'Internship Office: http://127.0.0.1:{args.port}',flush=True)
 ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
