"""Read daily progress and record continuation state; this module never launches workers."""
import json
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import review_inbox

ZONE = ZoneInfo('America/New_York')


def overnight_policy():
    return json.loads((Path(__file__).parent / 'config' / 'efficiency.json').read_text()).get('overnight', {})


def local_time(at=None):
    return (at or datetime.now(ZONE)).astimezone(ZONE)


def on_day(value, day):
    try:
        return datetime.fromisoformat(value).astimezone(ZONE).date().isoformat() == day
    except (TypeError, ValueError):
        return False


def status(connection, docs, at=None):
    local = local_time(at)
    day = local.date().isoformat()
    connection.execute('CREATE TABLE IF NOT EXISTS morning_cycles(day TEXT PRIMARY KEY, data TEXT NOT NULL)')
    row = connection.execute('SELECT data FROM morning_cycles WHERE day=?', (day,)).fetchone()
    cycle = json.loads(row['data']) if row else None
    jobs = [json.loads(r['data']) for r in connection.execute('SELECT data FROM opportunities')]
    approvals = [json.loads(r['data']) for r in connection.execute('SELECT data FROM approvals')]
    councils = [json.loads(r['data']) for r in connection.execute('SELECT data FROM councils')]
    approved = {j['id'] for j in jobs if j.get('council') in ('Approved', 'Approved — priority')}
    submitted = {j['id'] for j in jobs if any(h.get('stage') == 'Applied' and h.get('evidence') and on_day(h.get('created'), day) for h in j.get('history', []))}
    submitted_or_later = {j['id'] for j in jobs if j.get('stage') in ('Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn') or any(h.get('stage') == 'Applied' and h.get('evidence') for h in j.get('history', []))}
    ready = {a.get('opportunity_id') for a in approvals if a.get('kind') == 'application' and a.get('ready') and a.get('status') in ('pending', 'approved', 'ready_auto_submit') and review_inbox.files_current(a, docs)}
    today_approved = {c.get('opportunity_id') for c in councils if c.get('status') == 'complete' and c.get('decision') in ('Approved', 'Approved — priority') and on_day(c.get('finished'), day)}
    counts = dict(target=5, council_approved_today=len(today_approved & approved), currently_approved=len(approved), ready_unsubmitted=len((ready & approved)-submitted_or_later), confirmed_submitted_today=len(submitted), remaining_submissions=max(0,5-len(submitted)))
    due = local.hour >= 9 and counts['remaining_submissions'] > 0 and (cycle is None or cycle.get('status') == 'running')
    night = overnight_policy()
    start, end = night.get('start_hour', 0), night.get('end_hour', 7)
    in_window = start <= local.hour < end if start < end else local.hour >= start or local.hour < end
    active = night.get('enabled') is True and in_window
    target = night.get('submission_target', 5)
    overnight_due = active and counts['confirmed_submitted_today'] < target and (cycle is None or cycle.get('status') == 'running')
    return dict(local_time=local.isoformat(), day=day, counts=counts, morning_due=due,
                overnight=dict(active=active, due=overnight_due, mode=night.get('mode', 'prepare_and_submit'),
                               submission_target=target, ready=counts['ready_unsubmitted'],
                               submitted=counts['confirmed_submitted_today']), work_due=due or overnight_due, cycle=cycle,
                explanation='A running cycle is resumable work, not proof a worker is live. Check actual process/session handles before recovery. Partial scout runs never complete this cycle.')


def record(connection, body, docs, at=None):
    current = status(connection, docs, at)
    if body.get('day') != current['day']:
        raise ValueError('Daily record must match the current New York date.')
    phase = review_inbox.text(body.get('phase', ''), 200)
    note = review_inbox.text(body.get('note', ''), 5000)
    state = body.get('status')
    if state not in ('running', 'waiting', 'completed') or not phase or not note:
        raise ValueError('Provide a running, waiting or completed status, phase and factual note.')
    if state == 'completed' and current['counts']['confirmed_submitted_today'] < 5:
        raise ValueError('Five distinct employer-confirmed submissions today are required to complete the daily target.')
    item = dict(day=current['day'], status=state, phase=phase, note=note, counts=current['counts'], updated=review_inbox.stamp())
    connection.execute('INSERT OR REPLACE INTO morning_cycles VALUES(?,?)', (item['day'],json.dumps(item)))
    return item
