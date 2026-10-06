"""Versioned dashboard requests. Publishing never approves or executes an action."""
import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path


PREFERENCES = Path(__file__).parent / 'config' / 'application-preferences.json'


def automatic_submission_enabled():
    return json.loads(PREFERENCES.read_text()).get('submission_mode') == 'automatic_after_verified_completion'


def stamp():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def text(value, limit=20000):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError('Invalid text.')
    return value.strip()


def files_current(item, docs):
    return all(key in docs and docs[key].is_file() and hashlib.sha256(docs[key].read_bytes()).hexdigest() == fingerprint
               for key, fingerprint in item.get('documents', {}).items())


def publish(connection, body, docs):
    """CLI-only agent operation; immutable editions preserve human decisions."""
    kind = body.get('kind')
    if kind not in ('question', 'application', 'update'):
        raise ValueError('Unsupported review kind.')
    key = text(body.get('request_key', ''), 200)
    title = text(body.get('title', ''), 250)
    if not key or not title:
        raise ValueError('A request key and title are required.')
    job_id = text(body.get('opportunity_id', ''), 200)
    if job_id and not connection.execute('SELECT 1 FROM opportunities WHERE id=?', (job_id,)).fetchone():
        raise ValueError('Unknown opportunity.')
    sections = body.get('sections', [])
    if not isinstance(sections, list) or len(sections) > 30:
        raise ValueError('Invalid sections.')
    sections = [{'title': text(s['title'], 200), 'items': [text(v, 5000) for v in s['items']]} for s in sections]
    questions = body.get('questions', [])
    if not isinstance(questions, list) or len(questions) > 8:
        raise ValueError('Keep questions short and grouped.')
    questions = [{'id': text(q['id'], 100), 'label': text(q['label'], 1500), 'options': [text(v, 500) for v in q.get('options', [])]} for q in questions]
    if any(not q['id'] or not q['label'] for q in questions) or len({q['id'] for q in questions}) != len(questions) or (kind == 'question' and not questions):
        raise ValueError('Questions need unique IDs.')
    documents = {}
    for key_doc in body.get('document_ids', []):
        if key_doc not in docs or not docs[key_doc].is_file():
            raise ValueError('Unknown document.')
        documents[key_doc] = hashlib.sha256(docs[key_doc].read_bytes()).hexdigest()
    ready = body.get('ready', False) is True
    if kind == 'application' and not documents:
        raise ValueError('Application review needs its exact document version.')
    payload = dict(kind=kind, request_key=key, opportunity_id=job_id, title=title,
                   body=text(body.get('body', '')), sections=sections, questions=questions,
                   documents=documents, ready=ready, consent=text(body.get('consent', ''), 5000))
    if kind == 'application' and ready and not payload['consent']:
        raise ValueError('Ready application needs its exact submission action and declarations recorded.')
    fingerprint = digest(payload)
    old = [json.loads(r['data']) for r in connection.execute('SELECT data FROM approvals')]
    editions = [a for a in old if a.get('request_key') == key]
    current = next((a for a in editions if a['status'] != 'superseded'), None)
    refresh_for_standing_authorization = (current and kind == 'application' and ready and
                                          current['status'] == 'pending' and automatic_submission_enabled() and
                                          body.get('revalidated') is True)
    if current and current['fingerprint'] == fingerprint and not refresh_for_standing_authorization:
        return current
    for previous in editions:
        if previous['status'] != 'superseded':
            previous['previous_status'] = previous['status']
            previous['status'] = 'superseded'
            connection.execute('UPDATE approvals SET data=? WHERE id=?', (json.dumps(previous), previous['id']))
    status = ('blocked' if kind == 'application' and not ready else
              'ready_auto_submit' if kind == 'application' and ready and automatic_submission_enabled() else
              'pending')
    item = dict(payload, id=str(uuid.uuid4()), fingerprint=fingerprint, version=len(editions)+1,
                created=stamp(), status=status)
    connection.execute('INSERT INTO approvals VALUES(?,?)', (item['id'], json.dumps(item)))
    connection.execute('INSERT INTO activity(text,created) VALUES(?,?)', (f'For User: {title}', stamp()))
    return item


def respond(connection, body, docs):
    row = connection.execute('SELECT data FROM approvals WHERE id=?', (body.get('id'),)).fetchone()
    if not row:
        raise ValueError('Review not found.')
    item = json.loads(row['data'])
    if item.get('kind') not in ('question', 'application', 'update'):
        raise ValueError('Use the original document/message review.')
    if body.get('fingerprint') != item['fingerprint'] or not files_current(item, docs):
        raise ValueError('This version changed. Reopen the refreshed review.')
    decision = body.get('decision')
    if decision == 'withdrawn' and item['status'] in ('approved', 'ready_auto_submit'):
        item['status'] = 'withdrawn'
    else:
        if item['status'] != 'pending':
            raise ValueError('This item is not awaiting a response.')
        if item['kind'] == 'question':
            answers = body.get('answers', {})
            if not isinstance(answers, dict) or set(answers) != {q['id'] for q in item['questions']}:
                raise ValueError('Answer each displayed question.')
            answers = {key: text(value, 5000) for key, value in answers.items()}
            if not all(answers.values()):
                raise ValueError('Answers cannot be empty. Use unsure when needed.')
            item['answers'] = answers
            item['status'] = 'answered'
        elif item['kind'] == 'update':
            if decision != 'acknowledged':
                raise ValueError('Invalid response.')
            item['status'] = 'acknowledged'
        else:
            if decision not in ('approved', 'changes_requested'):
                raise ValueError('Invalid decision.')
            if decision == 'approved' and (not item['ready'] or body.get('reviewed') is not True):
                raise ValueError('Review this exact application and its declarations before approving.')
            item['status'] = decision
        item['response_note'] = text(body.get('note', ''), 5000)
    item['responded_at'] = stamp()
    item['responded_by'] = 'User — dashboard'
    connection.execute('UPDATE approvals SET data=? WHERE id=?', (json.dumps(item), item['id']))
    connection.execute('INSERT INTO activity(text,created) VALUES(?,?)', (f'User responded: {item["title"]} — {item["status"].replace("_", " ")}.', stamp()))
    return item


def instruction(connection, body):
    note = text(body.get('body', ''), 10000)
    if not note:
        raise ValueError('Write a request or correction first.')
    item = dict(id=str(uuid.uuid4()), kind='instruction', title='Your request to the team', body=note,
                status='queued', created=stamp(), responded_by='User — dashboard', opportunity_id=text(body.get('opportunity_id', ''), 200))
    item['fingerprint'] = digest(item)
    connection.execute('INSERT INTO approvals VALUES(?,?)', (item['id'], json.dumps(item)))
    connection.execute('INSERT INTO activity(text,created) VALUES(?,?)', ('User left a request in the dashboard.', stamp()))
    return item


def response_token(item):
    """Version a human response separately from the immutable review payload."""
    return digest({key: item.get(key) for key in (
        'id', 'fingerprint', 'status', 'responded_at', 'answers', 'response_note')})


def actionable_response(item, docs):
    if item.get('kind') == 'instruction':
        return item.get('status') == 'queued'
    if item.get('kind') == 'question':
        return item.get('status') == 'answered'
    if item.get('kind') == 'application':
        return item.get('status') in ('approved', 'changes_requested', 'withdrawn') and files_current(item, docs)
    return False


def ensure_receipts(connection):
    connection.execute('''CREATE TABLE IF NOT EXISTS inbox_receipts(
        response_token TEXT PRIMARY KEY, item_id TEXT NOT NULL,
        outcome TEXT NOT NULL, note TEXT NOT NULL, handled_at TEXT NOT NULL)''')


def work(connection, docs):
    """CLI-only read queue. Receipts suppress repeats without altering human decisions."""
    ensure_receipts(connection)
    seen = {row['response_token'] for row in connection.execute('SELECT response_token FROM inbox_receipts')}
    result = []
    for row in connection.execute('SELECT data FROM approvals'):
        item = json.loads(row['data'])
        token = response_token(item)
        if actionable_response(item, docs) and token not in seen:
            result.append(dict(item, response_token=token))
    return sorted(result, key=lambda item: item.get('responded_at', item.get('created', '')))


def receipt(connection, body, docs):
    """Record actual handling; never creates approval or marks an application submitted."""
    ensure_receipts(connection)
    row = connection.execute('SELECT data FROM approvals WHERE id=?', (body.get('id'),)).fetchone()
    if not row:
        raise ValueError('Inbox item not found.')
    item = json.loads(row['data'])
    token = response_token(item)
    if body.get('response_token') != token or not actionable_response(item, docs):
        raise ValueError('Response changed or is no longer actionable. Read the inbox again.')
    outcome = body.get('outcome')
    if outcome not in ('completed', 'blocked'):
        raise ValueError('Record completed handling or a documented blocker.')
    note = text(body.get('note', ''), 5000)
    if not note:
        raise ValueError('Describe the actual work or blocker.')
    previous = connection.execute('SELECT * FROM inbox_receipts WHERE response_token=?', (token,)).fetchone()
    if previous:
        return dict(previous)
    result = dict(response_token=token, item_id=item['id'], outcome=outcome, note=note, handled_at=stamp())
    connection.execute('INSERT INTO inbox_receipts VALUES(:response_token,:item_id,:outcome,:note,:handled_at)', result)
    connection.execute('INSERT INTO activity(text,created) VALUES(?,?)',
                       (f'Team handled {item["title"]}: {note}', result['handled_at']))
    return result
