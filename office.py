#!/usr/bin/env python3
"""Agent-to-dashboard bridge; reads/writes SQLite even when the UI server is off."""
import argparse
import json
import os
import sys
from pathlib import Path
import server
import pipeline
import office_schedule
import office_efficiency

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['work-brief','work-budget','work-reserve','opportunity','inbox-item','review-packet','inbox','inbox-work','inbox-receipt','morning-status','morning-record','review-publish','profile','profile-update','queue','state','scout-start','scout-import','scout-finish','council-start','council-packet','council-vote','council-finish'])
    parser.add_argument('--file',help='JSON input file; omit to read JSON from stdin for write operations')
    parser.add_argument('--id',help='Council ID for council-packet')
    parser.add_argument('--limit',type=int,default=5,help='Maximum items per category in work-brief')
    parser.add_argument('--role',choices=pipeline.ROLES)
    parser.add_argument('--round',type=int,choices=(1,2))
    parser.add_argument('--output',help='Save full JSON to a file and print only its path and byte count')
    args=parser.parse_args()
    if (server.ROOT / 'data' / 'REMOTE_PRIMARY').exists():
        raise ValueError('The server dashboard is the live record. Run office.py on the server; this Mac copy is archived.')
    if os.environ.get('OFFICE_WORK_MODE') == 'application_only' and args.command in ('scout-start', 'scout-import'):
        raise ValueError('Cloud application-only mode does not start or import scout runs.')
    server.initial()
    if args.command=='work-brief':result=office_efficiency.brief(server.DB,server.DOCS,args.limit)
    elif args.command=='work-budget':
        with server.connect() as c:result=office_efficiency.budget_status(c)
    elif args.command=='work-reserve':
        body=json.loads(Path(args.file).read_text() if args.file else sys.stdin.read())
        result=office_efficiency.reserve_work(server.DB,body)
    elif args.command=='review-packet':result=office_efficiency.review_packet(server.DB,args.id,args.role,args.round)
    elif args.command in ('opportunity','inbox-item'):
        with server.connect() as c:
            result=pipeline.get(c,'opportunities' if args.command=='opportunity' else 'approvals',args.id)
            if args.command=='opportunity':
                result={k:v for k,v in result.items() if k not in ('prior_council','research_history')}
            else:result=dict(result,files_current=server.review_inbox.files_current(result,server.DOCS),response_token=server.review_inbox.response_token(result))
    elif args.command=='inbox':result=[a for a in server.state()['approvals'] if a.get('kind') in ('question','application','update','instruction')]
    elif args.command=='inbox-work':
        with server.connect() as c:result=server.review_inbox.work(c,server.DOCS)
    elif args.command=='inbox-receipt':
        body=json.loads(Path(args.file).read_text() if args.file else sys.stdin.read())
        with server.connect() as c:result=server.review_inbox.receipt(c,body,server.DOCS)
    elif args.command=='morning-status':
        with server.connect() as c:result=office_schedule.status(c,server.DOCS)
    elif args.command=='morning-record':
        body=json.loads(Path(args.file).read_text() if args.file else sys.stdin.read())
        with server.connect() as c:result=office_schedule.record(c,body,server.DOCS)
    elif args.command=='review-publish':
        body=json.loads(Path(args.file).read_text() if args.file else sys.stdin.read())
        with server.connect() as c:result=server.review_inbox.publish(c,body,server.DOCS)
    elif args.command=='profile':
        with server.connect() as c:result=pipeline.profile(c)
    elif args.command=='queue':result=pipeline.queue(server.DB)
    elif args.command=='state':result=server.state()
    elif args.command=='council-packet':result=pipeline.council_packet(server.DB,args.id)
    else:
        body=json.loads(Path(args.file).read_text() if args.file else sys.stdin.read())
        if not isinstance(body,dict):raise ValueError('Input must be a JSON object.')
        fn={'profile-update':pipeline.profile_update,'scout-start':pipeline.start,'scout-import':pipeline.import_scout,'scout-finish':pipeline.finish,'council-start':pipeline.council_start,'council-vote':pipeline.council_vote,'council-finish':pipeline.council_finish}[args.command]
        result=fn(server.DB,body)
    encoded=json.dumps(result,indent=2,ensure_ascii=False)
    if args.output:
        target=Path(args.output).resolve()
        if not target.is_relative_to(server.ROOT/'runs'):
            raise ValueError('Output artifacts must be inside internship-office/runs.')
        target.write_text(encoded+'\n')
        print(json.dumps(dict(output=str(target),bytes=len(encoded.encode()))))
    else:print(encoded)

if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,TypeError) as error:
        print(json.dumps({'error':str(error)}),file=sys.stderr)
        sys.exit(1)
