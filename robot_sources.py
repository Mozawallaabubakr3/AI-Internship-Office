"""Read-only, fixed-source inspector for the robot office. No worker execution."""
import hashlib
import inspect
import json
from pathlib import Path

import office_efficiency


def source(root, relative, title, kind):
    path = root / relative
    if not path.is_file():
        return dict(id=relative, title=title, kind=kind, available=False,
                    location=relative, body='Source is unavailable on this server.')
    body = path.read_text()
    return dict(id=relative, title=title, kind=kind, available=True,
                location=relative, body=body,
                sha256=hashlib.sha256(body.encode()).hexdigest())


def blueprints(root):
    root = Path(root)
    sources = [source(root, 'deploy/cloud-worker-prompt.txt', 'Cloud application coordinator', 'Configured execution prompt'),
               source(root, 'WORKFLOW.md', 'Internship Office operating workflow', 'Operating instructions'),
               source(root, 'config/application-preferences.json', 'Approved application preferences', 'Configuration')]
    body = inspect.getsource(office_efficiency.review_packet)
    sources.append(dict(id='review-packet', title='Independent reviewer packet builder',
                        kind='Executable packet builder', available=True,
                        location='office_efficiency.py · review_packet', body=body,
                        sha256=hashlib.sha256(body.encode()).hexdigest()))
    config_path = root / 'deploy/cloud-worker.json'
    config = json.loads(config_path.read_text()) if config_path.is_file() else {}
    runtime = {key: config.get(key) for key in ('enabled', 'browser_verified', 'model', 'work_mode')}
    return dict(sources=sources, runtime=runtime,
                notice='These are the current files on the dashboard server. Robot diagrams visualize this workflow; they do not launch agents. Separate per-robot execution prompts are not configured. The coordinator delegates focused tasks and reviewer packets at run time.')
