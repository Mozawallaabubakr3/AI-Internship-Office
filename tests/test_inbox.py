import json, tempfile, unittest, sys
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]))
import server
import review_inbox as inbox

class InboxTests(unittest.TestCase):
    def setUp(self):
        self.mode_patch=patch.object(inbox,"automatic_submission_enabled",return_value=True);self.mode_patch.start();self.addCleanup(self.mode_patch.stop)
        self.tmp=tempfile.TemporaryDirectory(); self.old_db,self.old_docs=server.DB,server.DOCS
        root=Path(self.tmp.name);self.doc=root/'draft.pdf';self.doc.write_bytes(b'original')
        server.DB=root/'test.sqlite3';server.DOCS={'example':self.doc,'base':self.doc};server.initial()
    def tearDown(self):
        server.DB,server.DOCS=self.old_db,self.old_docs;self.tmp.cleanup()
    def publish(self,**changes):
        body=dict(kind='application',request_key='test',title='Test application',document_ids=['base'],ready=True,consent='Sign and submit this test application.')
        body.update(changes)
        with server.connect() as c:return inbox.publish(c,body,server.DOCS)
    def answer(self,a,**changes):
        body=dict(id=a['id'],fingerprint=a['fingerprint'],decision='approved',reviewed=True);body.update(changes)
        return server.mutate('/api/inbox/respond',body)
    def test_standing_authorization_record_does_not_change_application_stage(self):
        before=server.state()['opportunities'];a=self.publish();self.assertEqual(a['status'],'ready_auto_submit');self.assertEqual(before,server.state()['opportunities'])
        self.assertNotIn('responded_by',a)
    def test_blocked_and_auto_ready_cannot_be_human_approved(self):
        a=self.publish(ready=False)
        with self.assertRaises(ValueError):self.answer(a)
        a=self.publish()
        with self.assertRaises(ValueError):self.answer(a,reviewed=False)
    def test_document_change_invalidates_ready_record(self):
        a=self.publish();self.doc.write_bytes(b'changed')
        with self.assertRaises(ValueError):self.answer(a)
        self.assertEqual(next(x for x in server.state()['approvals'] if x['id']==a['id'])['status'],'needs_refresh')
    def test_new_version_preserves_but_supersedes_ready_record(self):
        a=self.publish();b=self.publish(body='Updated facts')
        self.assertEqual(b['version'],2);self.assertEqual(b['status'],'ready_auto_submit')
        old=next(x for x in server.state()['approvals'] if x['id']==a['id']);self.assertEqual(old['previous_status'],'ready_auto_submit')
        with self.assertRaises(ValueError):self.answer(a)
    def test_old_pending_review_requires_explicit_revalidation(self):
        old=inbox.automatic_submission_enabled
        try:
            inbox.automatic_submission_enabled=lambda:False
            a=self.publish()
        finally:
            inbox.automatic_submission_enabled=old
        self.assertEqual(self.publish()['id'],a['id'])
        b=self.publish(revalidated=True)
        self.assertEqual(b['status'],'ready_auto_submit')
        self.assertEqual(b['version'],2)
    def test_questions_are_durable_and_idempotent(self):
        q=dict(kind='question',document_ids=[],questions=[dict(id='language',label='Which level?',options=['Intermediate'])])
        a=self.publish(**q)
        with self.assertRaises(ValueError):self.answer(a,answers={})
        self.answer(a,answers={'language':'Speaking intermediate; reading beginner'})
        again=self.publish(**q);self.assertEqual(again['id'],a['id']);self.assertEqual(again['answers']['language'],'Speaking intermediate; reading beginner')
    def test_instruction_is_queued_not_execution(self):
        a=server.mutate('/api/inbox/instruction',{'body':'Please update my draft'})
        self.assertEqual(a['status'],'queued');self.assertEqual(a['kind'],'instruction')
    def test_legacy_endpoint_cannot_bypass_application_review(self):
        a=self.publish()
        with self.assertRaises(ValueError):server.mutate("/api/approval",dict(id=a["id"],fingerprint=a["fingerprint"],decision="approved"))
    def test_can_withdraw(self):
        a=self.publish();self.assertEqual(self.answer(a,decision='withdrawn')['status'],'withdrawn')
if __name__=='__main__':unittest.main()
