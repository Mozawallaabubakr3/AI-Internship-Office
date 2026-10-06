import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]))
import pipeline as p
import server

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();root=Path(self.tmp.name)
        self.old_db,self.old_docs=server.DB,server.DOCS
        server.DB=root/'office.sqlite3';doc=root/'test.pdf';doc.write_bytes(b'test');server.DOCS={'example':doc,'base':doc}
        server.initial();self.db=server.DB
        p.profile_update(self.db,{'profile':{'name':'Synthetic candidate','provenance':'Synthetic test fixture','preferences':{'season':'Example season'},'boundaries':['Synthetic facts only'],'facts':[{'id':'example','label':'Example qualification','value':'Synthetic evidence only','source':'Synthetic test fixture'}],'unknowns':['Example unknown']},'confirmation':'Synthetic fixture'})
        self.run=p.start(self.db,{'origin':'interactive'})
        self.lead=dict(company='Test firm',title='Finance intern',url='https://example.org/job/1',location='NYC',season='Summer 2027',pay='$25/hour',category='Finance',summary='Real project',research={'checked_at':p.now(),'required_skills':'Communication','evidence':[dict(id='employer',url='https://example.org/job/1',type='employer',note='Test evidence')],'gates':{k:dict(status='match',reason='Supported by test evidence',evidence_ids=['employer']) for k in p.GATES}})
    def tearDown(self):
        server.DB,server.DOCS=self.old_db,self.old_docs;self.tmp.cleanup()
    def ingest(self,lead=None,batch='one'):
        result=p.import_scout(self.db,dict(run_id=self.run['id'],batch_id=batch,opportunities=[lead or self.lead]));return (result['added']+result['updated']+result['unchanged'])[0]
    def council(self,lead=None):
        job=self.ingest(lead);return p.council_start(self.db,{'opportunity_id':job})['council']
    def votes(self,c,rnd=1,count=5,override=None):
        for i,role in enumerate(p.ROLES[:count]):
            b=dict(council_id=c['id'],round=rnd,role=role,worker_id='reviewer-'+str(i),vote='Approved',reason='Test: evidence supports fit',evidence_ids=['employer'],priority=True)
            if override and i==0:b.update(override)
            p.council_vote(self.db,b)
    def test_import_is_idempotent_and_preserves_manual_record(self):
        jid=self.ingest();self.assertEqual(jid,self.ingest())
        server.mutate('/api/opportunity/update',{'id':jid,'notes':'Keep me','stage':'Preparing'})
        revised=copy.deepcopy(self.lead);revised['summary']='New project scope';self.ingest(revised,'two')
        with p.db(self.db) as c:j=p.get(c,'opportunities',jid)
        self.assertEqual(j['notes'],'Keep me');self.assertEqual(j['stage'],'Preparing');self.assertEqual(len(j['research_history']),1)
    def test_different_batch_payload_rejected(self):
        self.ingest();revised=copy.deepcopy(self.lead);revised['pay']='$30/hour'
        with self.assertRaises(ValueError):self.ingest(revised)
    def test_missing_evidence_rejected_atomically(self):
        bad=copy.deepcopy(self.lead);bad['research']['gates']['pay']['evidence_ids']=[]
        with self.assertRaises(ValueError):self.ingest(bad)
        self.assertEqual(len(server.state()['opportunities']),0)
    def test_unknown_pay_not_shortlisted(self):
        lead=copy.deepcopy(self.lead);lead['research']['gates']['pay']['status']='unknown';jid=self.ingest(lead)
        with p.db(self.db) as c:self.assertEqual(p.get(c,'opportunities',jid)['scout_status'],'Needs verification')
    def test_wrong_summer_excluded_but_visible(self):
        lead=copy.deepcopy(self.lead);lead['research']['gates']['season']['status']='conflict';jid=self.ingest(lead)
        self.assertNotIn(jid,[j['id'] for j in p.queue(self.db)])
        self.assertIn(jid,[j['id'] for j in server.state()['opportunities']])
    def test_five_distinct_reviewers_required(self):
        c=self.council();self.votes(c,count=1)
        with self.assertRaises(ValueError):
            p.council_vote(self.db,dict(council_id=c['id'],round=1,role=p.ROLES[1],worker_id='reviewer-0',vote='Approved',reason='Test',evidence_ids=['employer'],priority=True))
        with self.assertRaises(ValueError):self.votes(c,2,count=1)
    def test_four_final_approvals_cannot_finish(self):
        c=self.council();self.votes(c);self.votes(c,2,4)
        with self.assertRaises(ValueError):p.council_finish(self.db,{'council_id':c['id']})
    def test_unanimity_approves_without_submitting(self):
        c=self.council();self.votes(c);self.votes(c,2)
        result=p.council_finish(self.db,{'council_id':c['id']});self.assertEqual(result['decision'],'Approved — priority')
        with p.db(self.db) as db:self.assertEqual(p.get(db,'opportunities',c['opportunity_id'])['stage'],'Discovered')
    def test_dissent_retained(self):
        c=self.council();self.votes(c);self.votes(c,2,override={'vote':'Needs review','priority':False})
        self.assertEqual(p.council_finish(self.db,{'council_id':c['id']})['decision'],'Needs review')
    def test_one_final_rejection_prevents_approval(self):
        c=self.council();self.votes(c);self.votes(c,2,override={'vote':'Not approved','priority':False})
        self.assertEqual(p.council_finish(self.db,{'council_id':c['id']})['decision'],'Not approved')
    def test_confirmed_conflict_cannot_be_overridden_by_votes(self):
        lead=copy.deepcopy(self.lead);lead['research']['gates']['season']['status']='conflict'
        c=self.council(lead);self.votes(c);self.votes(c,2)
        self.assertEqual(p.council_finish(self.db,{'council_id':c['id']})['decision'],'Not approved')
    def test_unknown_gate_prevents_approval_even_if_votes_approve(self):
        lead=copy.deepcopy(self.lead);lead['research']['gates']['availability']['status']='unknown'
        c=self.council(lead);self.votes(c);self.votes(c,2)
        self.assertEqual(p.council_finish(self.db,{'council_id':c['id']})['decision'],'Needs review')
    def test_new_research_invalidates_votes(self):
        c=self.council();self.votes(c);self.votes(c,2)
        revised=copy.deepcopy(self.lead);revised['summary']='Different requirement';self.ingest(revised,'two')
        with self.assertRaises(ValueError):p.council_finish(self.db,{'council_id':c['id']})
    def test_profile_change_invalidates_approval(self):
        c=self.council();self.votes(c);self.votes(c,2);p.council_finish(self.db,{'council_id':c['id']})
        candidate=p.view(self.db)['profile'];candidate['unknowns'].append('Test new question')
        p.profile_update(self.db,{'profile':candidate,'confirmation':'Test user confirmation'})
        with p.db(self.db) as db:self.assertEqual(p.get(db,'opportunities',c['opportunity_id'])['council'],'Pending evaluation')
        self.assertFalse(p.council_packet(self.db,c['id'])['current'])
    def test_failed_source_coverage_cannot_be_completed(self):
        with self.assertRaises(ValueError):p.finish(self.db,{'run_id':self.run['id'],'status':'completed','summary':'Incomplete','sources':[{'name':'LinkedIn','status':'unavailable','detail':'Login unavailable'}]})
        self.assertEqual(p.finish(self.db,{'run_id':self.run['id'],'status':'partial','summary':'Incomplete','sources':[{'name':'LinkedIn','status':'unavailable','detail':'Login unavailable'}]})['status'],'partial')

if __name__=='__main__':unittest.main()
