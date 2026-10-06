"""Versioned local handoffs for the Codex Scout and five independent reviewers.
No model calls, browser actions, application submission, or email sending here.
"""
from contextlib import contextmanager
import copy
import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

ROOT = Path(__file__).resolve().parent
ROLES = ['Recruiter', 'Career strategist', 'Realist', 'Advocate', 'Skeptic']
GATES = ['season', 'pay', 'location', 'eligibility', 'availability']

def now(): return datetime.now(timezone.utc).isoformat()
def digest(data): return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
@contextmanager
def db(path):
    c = sqlite3.connect(path, timeout=20)
    c.row_factory = sqlite3.Row
    try:
        with c:
            yield c
    finally:
        c.close()

def text(value, limit=10000):
    if not isinstance(value, str) or not value.strip() or len(value)>limit:
        raise ValueError('Required nonempty text is missing or too long.')
    return value.strip()

def url(value):
    value = text(value, 2000)
    parsed = urlparse(value)
    if parsed.scheme not in ('http','https') or not parsed.netloc:
        raise ValueError('Evidence needs an http or https URL.')
    return value

def canonical(value):
    p=urlparse(url(value))
    query=[(k,v) for k,v in parse_qsl(p.query,keep_blank_values=True) if not k.lower().startswith('utm_') and k.lower() not in ('trk','trackingid','ref','source')]
    return urlunparse(p._replace(query=urlencode(sorted(query)), fragment=''))

def get(c, table, item):
    row=c.execute(f'SELECT data FROM {table} WHERE id=?',(item,)).fetchone()
    if not row: raise ValueError('Record not found: '+str(item))
    return json.loads(row['data'])

def put(c,table,item):
    c.execute(f'INSERT OR REPLACE INTO {table}(id,data) VALUES(?,?)',(item['id'],json.dumps(item)))

def log(c,message): c.execute('INSERT INTO activity(text,created) VALUES(?,?)',(message,now()))

def init(path):
    with db(path) as c:
        c.executescript('''CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS pipeline_runs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS councils(id TEXT PRIMARY KEY,data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL);''')
        if not c.execute('SELECT 1 FROM profiles').fetchone():
            profile=json.loads((ROOT/'config/candidate.json').read_text())
            profile.update(id=digest(profile),created=now(),revision=1)
            put(c,'profiles',profile)
            log(c,'Shared candidate profile created from approved facts. Unknowns retained.')

def profile(c):
    return json.loads(c.execute('SELECT data FROM profiles ORDER BY rowid DESC LIMIT 1').fetchone()['data'])

def snapshot(job):
    return {k:job.get(k) for k in ['company','title','url','location','season','pay','category','summary','research']}

def decision_snapshot(job):
    """A newer check of identical evidence is not a new job requirement.

    Keep every evidence note, gate and requirement in the fingerprint. In
    particular, failed rechecks must change availability/evidence and go stale.
    Works with legacy council snapshots without rewriting their audit trail.
    """
    value=copy.deepcopy(snapshot(job))
    if value.get('research'):
        value['research'].pop('checked_at',None)
    return value

def decision_profile(candidate):
    """Conservative reuse: only provenance/record metadata can be ignored.

    All fact values and sources (including skills), unknowns, preferences and
    boundaries remain significant. Only top-level record/provenance metadata
    and the order of facts can be ignored safely.
    """
    return dict(name=candidate.get('name'),
                facts=sorted([{k:f.get(k) for k in ('id','label','value','source')}
                              for f in candidate.get('facts',[])],key=lambda f:f['id']),
                preferences=candidate.get('preferences'),unknowns=candidate.get('unknowns'),
                boundaries=candidate.get('boundaries'))

def packet(c, council):
    job=get(c,'opportunities',council['opportunity_id'])
    return dict(council=council, candidate=council['profile_snapshot'], opportunity=council['opportunity_snapshot'],
                current=decision_profile(council['profile_snapshot'])==decision_profile(profile(c)) and
                decision_snapshot(council['opportunity_snapshot'])==decision_snapshot(job), roles=ROLES)

def view(path):
    with db(path) as c:
        runs=[json.loads(r['data']) for r in c.execute('SELECT data FROM pipeline_runs ORDER BY rowid DESC LIMIT 30')]
        for r in runs:
            if r['status']=='running' and datetime.fromisoformat(r['updated']) < datetime.now(timezone.utc)-timedelta(minutes=20):
                r['status']='interrupted';r['display_note']='No heartbeat for 20 minutes; completion not confirmed.'
        councils=[]
        for row in c.execute('SELECT data FROM councils ORDER BY rowid DESC LIMIT 100'):
            x=json.loads(row['data']);x['current']=packet(c,x)['current']
            councils.append(x)
        return dict(profile=profile(c),runs=runs,councils=councils)

def start(path, body):
    kind=body.get('kind','scout')
    if kind!='scout': raise ValueError('Only scout runs use this entrypoint.')
    r=dict(id=str(uuid.uuid4()),kind=kind,status='running',origin=body.get('origin','interactive'),started=now(),updated=now(),sources=[],summary='',imported=0)
    if r['origin'] not in ('interactive','scheduled'):raise ValueError('Invalid run origin.')
    with db(path) as c:
        c.execute('BEGIN IMMEDIATE')
        if r['origin']=='scheduled':
            import office_efficiency
            office_efficiency.reserve(c,'scout_batch',r['id'])
        put(c,'pipeline_runs',r);log(c,'Scout started ('+r['origin']+').')
    return r

def finish(path,body):
    with db(path) as c:
        r=get(c,'pipeline_runs',body['run_id'])
        if r['status']!='running':raise ValueError('Run is already finished.')
        status=body.get('status','completed')
        if status not in ('running','completed','partial','failed'):raise ValueError('Invalid run status.')
        sources=body.get('sources',[])
        if not isinstance(sources,list) or len(sources)>20:raise ValueError('Invalid source list.')
        for s in sources:
            text(s['name'],150);text(s['detail'],2000)
            if s['status'] not in ('checked','limited','unavailable'):raise ValueError('Invalid source status.')
        if status!='running' and not sources:raise ValueError('Record source coverage, including failures.')
        if status=='completed' and any(s['status']!='checked' for s in sources):raise ValueError('Limited source coverage must be reported as partial.')
        r.update(status=status,sources=sources,summary=text(body.get('summary','')),updated=now())
        put(c,'pipeline_runs',r)
        if status!='running':log(c,'Scout '+status+': '+r['summary'])
        return r

def validate_lead(raw):
    if not isinstance(raw,dict):raise ValueError('Lead must be an object.')
    lead={k:text(raw.get(k,''),2000 if k=='url' else 10000) for k in ['company','title','url','location','season','pay','category','summary']}
    lead['url']=url(lead['url']);lead['source']=text(raw.get('source','Scout'),200)
    lead['source_key']=text(raw.get('source_key') or canonical(lead['url']),2000)
    research=raw.get('research')
    if not isinstance(research,dict) or set(research.get('gates',{}))!=set(GATES):raise ValueError('Provide all five research gates.')
    checked=datetime.fromisoformat(text(research.get('checked_at','')).replace('Z','+00:00'))
    if checked.tzinfo is None or checked>datetime.now(timezone.utc)+timedelta(minutes=5):raise ValueError('Use a valid past verification timestamp with timezone.')
    evidence=research.get('evidence',[])
    if not isinstance(evidence,list) or not 1<=len(evidence)<=30:raise ValueError('Include sourced evidence.')
    evidence_ids=set()
    for e in evidence:
        key=text(e['id'],100)
        if key in evidence_ids:raise ValueError('Duplicate evidence id.')
        evidence_ids.add(key);url(e['url']);text(e['note'],6000)
        if e['type'] not in ('employer','job_board','employer_index','general_program'):raise ValueError('Invalid source type.')
    for name,g in research['gates'].items():
        if g['status'] not in ('match','conflict','unknown'):raise ValueError('Invalid gate status.')
        text(g['reason'],3000)
        if not isinstance(g['evidence_ids'],list) or any(x not in evidence_ids for x in g['evidence_ids']):raise ValueError('Invalid evidence reference.')
        if g['status']!='unknown' and not g['evidence_ids']:raise ValueError('A positive or negative gate needs evidence.')
    research['required_skills']=text(research.get('required_skills','Not established'))
    if research.get('deadline'):
        datetime.strptime(text(research['deadline'],10),'%Y-%m-%d')
        text(research.get('deadline_note',''))
    lead['research']=research
    return lead

def import_scout(path,body):
    leads=body.get('opportunities')
    if not isinstance(leads,list) or not 1<=len(leads)<=100:raise ValueError('Import 1–100 opportunities.')
    leads=[validate_lead(x) for x in leads]
    batch=text(body['batch_id'],150);fingerprint=digest(body)
    with db(path) as c:
        c.execute('BEGIN IMMEDIATE')
        existing=c.execute('SELECT digest,result FROM imports WHERE id=?',(batch,)).fetchone()
        if existing:
            if existing['digest']!=fingerprint:raise ValueError('This batch ID already has different content.')
            return json.loads(existing['result'])
        run=get(c,'pipeline_runs',body['run_id'])
        if run['status']!='running':raise ValueError('Scout run must be running.')
        result={'added':[],'updated':[],'unchanged':[]}
        for lead in leads:
            rows=[json.loads(r['data']) for r in c.execute('SELECT data FROM opportunities')]
            matches=[j for j in rows if j['source_key']==lead['source_key'] or canonical(j['url'])==canonical(lead['url'])]
            if len(matches)>1:raise ValueError('Conflicting duplicate identities need review.')
            existing=matches[0] if matches else None
            if existing:
                j=existing;before=digest(decision_snapshot(j))
                previous_research=j.get('research')
                oldtime=j.get('research',{}).get('checked_at')
                if oldtime and datetime.fromisoformat(oldtime.replace('Z','+00:00'))>datetime.fromisoformat(lead['research']['checked_at'].replace('Z','+00:00')):
                    raise ValueError('Cannot overwrite newer research with older evidence.')
                for k,v in lead.items():
                    if k!='source_key':j[k]=v
                change=digest(decision_snapshot(j))!=before
                if change and previous_research:j.setdefault('research_history',[]).append(previous_research)
            else:
                j=dict(id=str(uuid.uuid4()),stage='Discovered',notes='',deadline='',next_action='Review sourced evidence.',documents=[],history=[],revision=0,votes=[],council='Pending evaluation',**lead);change=True
            j['checked']=lead['research']['checked_at'][:10]
            if not j.get('deadline') and lead['research'].get('deadline'):j['deadline']=lead['research']['deadline']
            gates=lead['research']['gates']
            j['scout_status']='Excluded' if any(g['status']=='conflict' for g in gates.values()) else 'Needs verification' if any(g['status']=='unknown' for g in gates.values()) else 'Ready for council'
            j['concerns']=[g['reason'] for g in gates.values() if g['status']!='match']
            j['evidence']=[dict(label=e['note'],url=e['url']) for e in lead['research']['evidence']]
            if change:
                if j.get('votes'):j.setdefault('prior_council',[]).append(dict(council=j['council'],votes=j['votes'],archived=now()))
                j['votes']=[];j['council']='Pending evaluation';j['revision']+=1
                j['council_queue']='excluded' if j['scout_status']=='Excluded' else 'queued'
            c.execute('INSERT INTO opportunities(id,source_key,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',(j['id'],j['source_key'],json.dumps(j)))
            result['added' if not existing else 'updated' if change else 'unchanged'].append(j['id'])
        run['imported']+=len(result['added'])+len(result['updated']);run['updated']=now();put(c,'pipeline_runs',run)
        c.execute('INSERT INTO imports VALUES(?,?,?)',(batch,fingerprint,json.dumps(result)))
        log(c,f"Scout saved {len(result['added'])} new and {len(result['updated'])} updated opportunities.")
        return result

def council_start(path,body):
    with db(path) as c:
        c.execute('BEGIN IMMEDIATE')
        j=get(c,'opportunities',body['opportunity_id']);p=profile(c)
        if not j.get('research'):raise ValueError('Import sourced research before council review.')
        for row in c.execute('SELECT data FROM councils ORDER BY rowid DESC'):
            old=json.loads(row['data'])
            if old['opportunity_id']==j['id'] and old['status']=='complete' and packet(c,old)['current']:
                return packet(c,old)
            if old['opportunity_id']==j['id'] and old['status']=='reviewing':
                if packet(c,old)['current']:return packet(c,old)
                old['status']='superseded';put(c,'councils',old)
        if body.get('origin')=='scheduled':
            import office_efficiency
            office_efficiency.reserve(c,'new_council',digest([j['id'],decision_snapshot(j),decision_profile(p)]))
        x=dict(id=str(uuid.uuid4()),opportunity_id=j['id'],profile_id=p['id'],profile_snapshot=p,opportunity_hash=digest(snapshot(j)),opportunity_snapshot=snapshot(j),started=now(),updated=now(),status='reviewing',round1=[],round2=[])
        put(c,'councils',x);j['council_queue']='reviewing';j['council']='Pending evaluation';j['votes']=[]
        c.execute('UPDATE opportunities SET data=? WHERE id=?',(json.dumps(j),j['id']))
        log(c,'Council review opened for '+j['company']+'. Independent assessments required.')
        return packet(c,x)

def council_vote(path,body):
    with db(path) as c:
        c.execute('BEGIN IMMEDIATE')
        x=get(c,'councils',body['council_id'])
        if x['status']!='reviewing' or not packet(c,x)['current']:raise ValueError('Council packet is stale or closed; start a current review.')
        rnd=body['round']
        if type(rnd)!=int or rnd not in (1,2):raise ValueError('Round must be 1 or 2.')
        if rnd==2 and len(x['round1'])!=5:raise ValueError('All five independent assessments are required before debate.')
        v={k:body.get(k) for k in ['role','worker_id','vote','reason','evidence_ids','priority']}
        if v['role'] not in ROLES or v['vote'] not in ('Approved','Needs review','Not approved'):raise ValueError('Invalid role or vote.')
        text(v['worker_id'],200);text(v['reason'],6000)
        if type(v['priority'])!=bool:raise ValueError('Priority must be true or false.')
        if v['priority'] and v['vote']!='Approved':raise ValueError('Only an approval can recommend priority.')
        ids={e['id'] for e in x['opportunity_snapshot']['research']['evidence']}
        if not isinstance(v['evidence_ids'],list) or not v['evidence_ids'] or any(e not in ids for e in v['evidence_ids']):raise ValueError('Vote needs valid evidence references.')
        votes=x['round'+str(rnd)]
        if any(a['role']==v['role'] for a in votes):
            if any(all(a.get(k)==v[k] for k in v) for a in votes):return x
            raise ValueError('A role already voted in this round.')
        if any(a['worker_id']==v['worker_id'] and a['role']!=v['role'] for a in x['round1']+x['round2']):raise ValueError('Each perspective requires a distinct reviewer.')
        if rnd==2 and not any(a['role']==v['role'] and a['worker_id']==v['worker_id'] for a in x['round1']):raise ValueError('Use the same reviewer for the challenge round.')
        v['created']=now();votes.append(v);x['updated']=now();put(c,'councils',x)
        return x

def council_finish(path,body):
    with db(path) as c:
        c.execute('BEGIN IMMEDIATE')
        x=get(c,'councils',body['council_id'])
        if not packet(c,x)['current']:raise ValueError('Evidence or candidate profile changed; restart review.')
        if x['status']=='complete':return x
        if len(x['round2'])!=5:raise ValueError('All five final votes are required.')
        final=x['round2'];gates=x['opportunity_snapshot']['research']['gates']
        if any(g['status']=='conflict' for g in gates.values()):decision='Not approved'
        elif any(v['vote']=='Not approved' for v in final):decision='Not approved'
        elif any(g['status']=='unknown' for g in gates.values()) or any(v['vote']=='Needs review' for v in final):decision='Needs review'
        else:decision='Approved — priority' if all(v['priority'] for v in final) else 'Approved'
        x.update(status='complete',decision=decision,finished=now(),updated=now());put(c,'councils',x)
        j=get(c,'opportunities',x['opportunity_id']);j.update(council=decision,votes=final,council_queue='complete',council_run_id=x['id'])
        c.execute('UPDATE opportunities SET data=? WHERE id=?',(json.dumps(j),j['id']))
        log(c,'Council completed '+j['company']+': '+decision+'. No application authorized.')
        return x

def council_packet(path,item):
    with db(path) as c:return packet(c,get(c,'councils',item))

def queue(path):
    with db(path) as c:
        return [json.loads(r['data']) for r in c.execute('SELECT data FROM opportunities') if json.loads(r['data']).get('council_queue') in ('queued','reviewing')]

def profile_update(path,body):
    """Explicit, sourced corrections only. Not exposed as a scout action."""
    incoming=body.get('profile')
    if not isinstance(incoming,dict):raise ValueError('Provide a complete candidate profile.')
    for key in ('name','provenance'):text(incoming.get(key,''))
    if not isinstance(incoming.get('facts'),list) or not incoming['facts']:raise ValueError('Candidate facts required.')
    ids=set()
    for f in incoming['facts']:
        for k in ('id','label','value','source'):text(f.get(k,''))
        if f['id'] in ids:raise ValueError('Duplicate candidate fact.')
        ids.add(f['id'])
    if not isinstance(incoming.get('preferences'),dict) or not incoming['preferences']:raise ValueError('Preferences required.')
    for key in ('unknowns','boundaries'):
        if not isinstance(incoming.get(key),list) or not incoming[key]:raise ValueError('Unknowns and boundaries must be explicit.')
        for value in incoming[key]:text(value)
    proof=text(body.get('confirmation',''))
    data={k:incoming[k] for k in ('name','provenance','facts','preferences','unknowns','boundaries')}
    with db(path) as c:
        c.execute('BEGIN IMMEDIATE')
        old=profile(c)
        if digest(data)==old['id']:return old
        material=decision_profile(data)!=decision_profile(old)
        data.update(id=digest(data),created=now(),revision=old['revision']+1,confirmation=proof)
        put(c,'profiles',data)
        for row in c.execute('SELECT data FROM opportunities').fetchall() if material else []:
            j=json.loads(row['data'])
            # Historical submissions stay historical; do not send them back
            # through preparation after a later candidate-profile correction.
            if j.get('stage') in ('Applied','Interviewing','Offer','Rejected','Withdrawn') or any(h.get('stage')=='Applied' and h.get('evidence') for h in j.get('history',[])):
                continue
            if j.get('votes'):j.setdefault('prior_council',[]).append(dict(council=j['council'],votes=j['votes'],archived=now()))
            j.update(council='Pending evaluation',votes=[],council_queue=('excluded' if j.get('scout_status')=='Excluded' else 'queued') if j.get('research') else 'awaiting research')
            c.execute('UPDATE opportunities SET data=? WHERE id=?',(json.dumps(j),j['id']))
        log(c,'Candidate profile updated from explicit confirmation. '+('Unsubmitted council recommendations need reassessment.' if material else 'Fact values unchanged; council assessments retained.'))
        return data
