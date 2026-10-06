"""Persistent, bounded, on-demand robot conversations. Never runs application tools."""
import json
import os
import signal
import sqlite3
import subprocess
import threading
import uuid
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('America/New_York')
_lock = threading.Lock()
_busy = False


def stamp():
    return datetime.now(ZONE).isoformat()


def connection(root):
    db = sqlite3.connect(Path(root) / 'data/world-chat.sqlite3', timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('''CREATE TABLE IF NOT EXISTS messages(
        id TEXT PRIMARY KEY, system TEXT NOT NULL, request_key TEXT UNIQUE,
        role TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL,
        status TEXT NOT NULL, tokens INTEGER, error TEXT, run_day TEXT)''')
    if 'run_day' not in {r['name'] for r in db.execute('PRAGMA table_info(messages)')}:
        db.execute('ALTER TABLE messages ADD COLUMN run_day TEXT')
    return db


def systems(root):
    return json.loads((Path(root) / 'config/world-systems.json').read_text())


def settings(root):
    c = json.loads((Path(root) / 'config/world-chat.json').read_text())
    if c.get('model') != 'gpt-6-sol':
        raise ValueError('Chat model must be the approved Sol model.')
    for key in ('max_messages_per_day', 'max_reported_tokens_per_day',
                'reserve_tokens_per_message', 'max_seconds', 'max_pending'):
        if not isinstance(c.get(key), int) or c[key] <= 0:
            raise ValueError('Invalid chat budget.')
    return c


def usage(db, c):
    day = datetime.now(ZONE).date().isoformat()
    rows = db.execute("SELECT status,tokens,created,run_day FROM messages WHERE role='user'").fetchall()
    today = [r for r in rows if (r['run_day'] or r['created'][:10]) == day]
    admitted_today = [r for r in rows if r['created'].startswith(day) or r['run_day'] == day]
    pending = sum(r['status'] in ('queued', 'replying') for r in rows)
    reported = sum(r['tokens'] or 0 for r in today)
    unknown = any(r['status'] == 'failed' and r['tokens'] is None for r in today)
    return dict(messages=len(admitted_today), reported_tokens=reported, pending=pending,
                unmetered_failure=unknown, max_messages=c['max_messages_per_day'],
                max_reported_tokens=c['max_reported_tokens_per_day'], model=c['model'],
                enabled=c.get('enabled') is True,
                note='Reported tokens are post-run measurements, including cached input. They are not a ChatGPT usage percentage or a guaranteed dollar cap.')


def view(root, system):
    if system not in systems(root):
        raise ValueError('Unknown system.')
    with connection(root) as db:
        rows = db.execute('SELECT id,role,body,created,status,tokens,error FROM messages WHERE system=? ORDER BY rowid DESC LIMIT 60', (system,)).fetchall()
        return dict(system=system, messages=[dict(r) for r in reversed(rows)], usage=usage(db, settings(root)))


def post(root, body, start=True):
    system, text, key = body.get('system'), body.get('body'), body.get('request_key')
    if system not in systems(root):
        raise ValueError('Unknown system.')
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 3000:
        raise ValueError('Write a message of 1–3,000 characters.')
    if not isinstance(key, str) or not 8 <= len(key) <= 100:
        raise ValueError('A request key is required.')
    c = settings(root)
    with connection(root) as db:
        db.execute('BEGIN IMMEDIATE')
        old = db.execute('SELECT system,body FROM messages WHERE request_key=?', (key,)).fetchone()
        if old:
            if old['system'] != system or old['body'] != text.strip():
                raise ValueError('Request key already belongs to another message.')
        else:
            u = usage(db,c)
            if not u['enabled']:
                raise ValueError('Robot chat is disabled.')
            if u['unmetered_failure']:
                raise ValueError('Chat stopped after an unmetered failure today. Inspect it before running more replies.')
            if u['messages'] >= c['max_messages_per_day']:
                raise ValueError('Daily chat-message budget reached.')
            if db.execute("SELECT 1 FROM messages WHERE system=? AND status IN ('queued','replying') LIMIT 1", (system,)).fetchone():
                raise ValueError('This system already has a reply in progress.')
            if u['pending'] >= c['max_pending']:
                raise ValueError('The reply queue is full. Wait for the current conversations.')
            if u['reported_tokens'] + (u['pending']+1)*c['reserve_tokens_per_message'] > c['max_reported_tokens_per_day']:
                raise ValueError('Not enough remaining chat budget for another reserved reply today.')
            db.execute('INSERT INTO messages(id,system,request_key,role,body,created,status,tokens,error) VALUES(?,?,?,?,?,?,?,?,?)',
                       (str(uuid.uuid4()),system,key,'user',text.strip(),stamp(),'queued',None,None))
    if start:
        kick(root)
    return view(root,system)


def snapshot(root, system):
    """Bounded, read-only snapshot. No contact details, resumes or tokens."""
    if system in ('interview','video','accounting'):
        return {'connection':'Conversational assistant only; separate live tools are not connected.'}
    office = Path(root) / 'data/office.sqlite3'
    if not office.exists():
        return {'connection':'Office records unavailable.'}
    with sqlite3.connect(f'file:{office}?mode=ro', uri=True) as db:
        jobs = [json.loads(r[0]) for r in db.execute('SELECT data FROM opportunities')]
        row = db.execute('SELECT data FROM profiles ORDER BY rowid DESC LIMIT 1').fetchone()
        profile = json.loads(row[0]) if row else {}
    order = {'Preparing':0,'Ready for approval':1,'Researching':2,'Discovered':3}
    saved = sorted(jobs,key=lambda j:order.get(j.get('stage'),4))[:8]
    return {'execution_worker':'paused; chat cannot execute the application workflow',
            'total_opportunities':len(jobs),
            'counts':{k:sum(j.get('stage')==k for j in jobs) for k in ('Preparing','Ready for approval','Applied','Offer')},
            'priority_records':[{k:str(j.get(k,''))[:700] for k in ('company','title','location','season','pay','stage','council','next_action','summary')} for j in saved],
            'candidate':{'name':profile.get('name','Example User'),
                         'facts':[{k:f.get(k) for k in ('id','label','value')} for f in profile.get('facts',[]) if f.get('id') in ('education','graduation','standing','authorization','coursework','excel','projects','work_experience','retail','leadership','skills','awards')],
                         'preferences':profile.get('preferences',{}),
                         'policy':'Only the supplied confirmed facts establish qualifications. Other facts, GPA or proficiency levels are unknown unless User provides them. Private contact facts and documents are not supplied.'}}


def prompt(root, system, db):
    recent = db.execute("SELECT role,body FROM messages WHERE system=? AND (role='assistant' OR status IN ('queued','replying','completed')) ORDER BY rowid DESC LIMIT 10", (system,)).fetchall()
    conversation = [dict(r) for r in reversed(recent)]
    while len(json.dumps(conversation)) > 9000 and len(conversation)>1:
        conversation.pop(0)
    return json.dumps({'system_role':systems(root)[system], 'saved_context':snapshot(root,system),
                       'conversation':conversation}, ensure_ascii=False)


def command(root):
    # Ignore inherited apps, MCP servers, hooks and project execution settings.
    return ['codex','exec','--ignore-user-config','--ephemeral','--json',
            '--model',settings(root)['model'],'--sandbox','read-only','--skip-git-repo-check',
            '-c','features.shell_tool=false','-c','features.unified_exec=false',
            '-c','features.multi_agent=false','-c','features.apps=false',
            '-c','features.plugins=false','-c','features.hooks=false',
            '-c','features.memories=false','-c','features.goals=false',
            '-c','features.code_mode.enabled=false','-c','mcp_servers={}',
            '-c','web_search="disabled"','-c','model_reasoning_effort="low"',
            '-c',f'model_instructions_file="{Path(root) / "config/world-chat-instructions.txt"}"','-']


def parse_output(output):
    replies, totals = [], []
    for line in output.splitlines():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if e.get('type') == 'item.completed':
            item = e.get('item',{})
            if item.get('type') == 'agent_message':
                replies.append(item.get('text',''))
            elif item.get('type') not in ('reasoning',):
                raise ValueError('The chat runtime attempted an unsupported tool. No success is recorded.')
        if e.get('type') == 'turn.completed':
            u = e.get('usage',{})
            if not all(isinstance(u.get(k),int) for k in ('input_tokens','output_tokens')):
                raise ValueError('Reply usage was unavailable.')
            totals.append(u['input_tokens']+u['output_tokens'])
    if not replies or not totals:
        raise ValueError('No complete, metered model reply was returned.')
    return '\n\n'.join(replies)[-15000:],sum(totals)


def run_one(root, message):
    c = settings(root)
    env = os.environ.copy()
    for key in ('OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN'):
        env.pop(key,None)
    # Reuse the actual server runtime identity; never read or export credentials.
    runtime_home = Path(root).parent / '.codex'
    if runtime_home.exists():
        env['CODEX_HOME']=str(runtime_home)
    env['PATH']=str(Path(root).parent/'.local/bin')+':'+str(Path(root).parent/'node-v22.23.3-linux-x64/bin')+':'+env.get('PATH','')
    runtime = Path(root)/'data/chat-runtime'
    runtime.mkdir(mode=0o700,exist_ok=True)
    tokens=0  # Preflight failures occur before any model request.
    try:
        login = subprocess.run(['codex','login','status'],env=env,cwd=runtime,capture_output=True,text=True,timeout=10)
        if login.returncode or 'Logged in using ChatGPT' not in login.stdout+login.stderr:
            raise ValueError('The server ChatGPT session is unavailable; no API-key fallback is used.')
        with connection(root) as db:
            text=prompt(root,message['system'],db)
        tokens=None  # A started model request needs actual usage, even on failure.
        child = subprocess.Popen(command(root),env=env,cwd=runtime,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
        try:
            output, errors = child.communicate(text,timeout=c['max_seconds'])
        except subprocess.TimeoutExpired:
            os.killpg(child.pid,signal.SIGKILL);child.communicate()
            raise ValueError('The model reply timed out; usage is unavailable.')
        if child.returncode:
            diagnostic=runtime/(message['id']+'.failure.json')
            diagnostic.write_text(json.dumps({'returncode':child.returncode,'stderr':errors[-6000:],'stdout':output[-6000:]}))
            diagnostic.chmod(0o600)
            raise ValueError('The model runtime did not complete. Its account or model availability needs inspection.')
        reply,tokens=parse_output(output)
        with connection(root) as db:
            db.execute("UPDATE messages SET status='completed',tokens=? WHERE id=?",(tokens,message['id']))
            db.execute('INSERT INTO messages(id,system,request_key,role,body,created,status,tokens,error) VALUES(?,?,?,?,?,?,?,?,?)',(str(uuid.uuid4()),message['system'],None,'assistant',reply,stamp(),'completed',None,None))
    except (OSError,ValueError,subprocess.TimeoutExpired) as error:
        with connection(root) as db:
            db.execute("UPDATE messages SET status='failed',tokens=?,error=? WHERE id=?",(tokens,str(error)[:400],message['id']))


def drain(root):
    global _busy
    try:
        while True:
            with connection(root) as db:
                db.execute('BEGIN IMMEDIATE')
                message = db.execute("SELECT * FROM messages WHERE role='user' AND status='queued' ORDER BY rowid LIMIT 1").fetchone()
                if not message:
                    return
                c = settings(root);u=usage(db,c)
                if not u['enabled'] or u['unmetered_failure'] or u['reported_tokens'] >= c['max_reported_tokens_per_day']:
                    db.execute("UPDATE messages SET status='failed',tokens=0,error='Reply deferred by chat budget or an earlier unmetered failure.' WHERE id=?",(message['id'],))
                    continue
                day=datetime.now(ZONE).date().isoformat()
                if message['created'][:10]!=day and u['messages']>=c['max_messages_per_day']:
                    db.execute("UPDATE messages SET status='failed',tokens=0,error='Reply deferred by the new day message budget.' WHERE id=?",(message['id'],))
                    continue
                db.execute("UPDATE messages SET status='replying',run_day=? WHERE id=?",(day,message['id']))
            run_one(root,dict(message))
    finally:
        with _lock:
            _busy=False
        # A post can land between the last empty read and clearing the busy flag.
        with connection(root) as db:
            queued = db.execute("SELECT 1 FROM messages WHERE status='queued' LIMIT 1").fetchone()
        if queued:
            kick(root)


def kick(root):
    global _busy
    with _lock:
        if _busy:
            return
        _busy=True
        threading.Thread(target=drain,args=(root,),daemon=True,name='robot-chat').start()


def recover(root):
    """An interrupted reply is not silently retried or counted as metered."""
    with connection(root) as db:
        db.execute("UPDATE messages SET status='failed',error='Server restarted before the model reply completed; usage is unknown.' WHERE status='replying'")
    kick(root)
