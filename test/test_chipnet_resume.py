"""Resume control tests: no image allocation/mount, daemon or external connection."""
import sys,unittest,json,os,uuid
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'scripts'))
import chipnet_resume as resume
import owned_node as guard
import bounded_store

class ResumeTests(unittest.TestCase):
 def fixture(self):
  run=ROOT/'.build/runtime'/('resume-contract-test-'+uuid.uuid4().hex[:8]);run.mkdir(mode=0o700)
  image=run/'bounded.dmg';image.write_bytes(b'x'*4096);os.chmod(image,0o600);mount=run/'mount';mount.mkdir(mode=0o700)
  store={'image':str(image),'mountpoint':str(mount),'image_inode':image.stat().st_ino,'image_bytes':4096}
  receipt={'process_exit_confirmed':True,'node_exit_code':0,'watchdog_exit_code':0,'peer_gate_receipt':{'received_application_bytes':1570,'uploaded_application_bytes':783},'elapsed_seconds':4.196}
  guard.save_new(run/'fixed-store.json',store);guard.save_new(run/'measurement-receipt.json',receipt);guard.save_new(run/'detach-receipt.json',{'exit_code':0,'unmounted':True})
  return run,store,receipt
 def test_carries_prior_counts_and_retains_image_without_mounting(self):
  run,store,_=self.fixture();before=Path(store['image']).read_bytes()
  with patch('subprocess.run',side_effect=AssertionError('No mount/process allowed')):
   plan=resume.resume_plan(run)
  self.assertEqual(plan['remaining_receive_bytes'],1792*2**20-1570)
  self.assertEqual(plan['remaining_upload_bytes'],64*2**20-783)
  self.assertEqual(Path(store['image']).read_bytes(),before)
 def test_rejects_ambiguous_shutdown_and_exhausted_or_missing_counters(self):
  for change in [{'node_exit_code':None},{'watchdog_exit_code':1},{'process_exit_confirmed':False},{'peer_gate_receipt':{}},{'peer_gate_receipt':{'received_application_bytes':1792*2**20,'uploaded_application_bytes':0}}]:
   run,_,receipt=self.fixture();receipt.update(change)
   # Alter this synthetic test receipt only; never the retained native evidence.
   (run/'measurement-receipt.json').write_text(json.dumps(receipt))
   with self.assertRaises(guard.GuardError):resume.resume_plan(run)
 def test_rejects_changed_image_or_attached_mount(self):
  run,store,_=self.fixture();Path(store['image']).write_bytes(b'changed')
  with self.assertRaises(guard.GuardError):resume.resume_plan(run)
  run,_,_=self.fixture()
  with patch('os.path.ismount',return_value=True),self.assertRaises(guard.GuardError):resume.resume_plan(run)
 def test_quiet_window_requires_every_sample_not_only_endpoints(self):
  normal={'free_bytes':13*guard.GIB,'pressure':1,'swap_bytes':100,'heavy_builds':[],'reclaimable_page_estimate_bytes':8*guard.GIB}
  self.assertEqual(resume.quiet_reasons([normal,normal],59),['quiet_window_shorter_than_60_seconds'])
  self.assertEqual(resume.quiet_reasons([normal,normal],60),[])
  warning=dict(normal,pressure=2,free_bytes=4*guard.GIB)
  reasons=resume.quiet_reasons([normal,warning,normal],60)
  self.assertIn('memory_pressure_not_normal',reasons);self.assertIn('free_space_below_12GiB',reasons)
  self.assertIn('swap_rising_during_preflight',resume.quiet_reasons([normal,dict(normal,swap_bytes=101),normal],60))
 def test_actual_preserved_plan_is_read_only_and_budget_carries_1570(self):
  origin=ROOT/'.build/runtime/chipnet-stage1-1649e90f'
  if (origin/'bounded.dmg').exists():
   plan=resume.resume_plan(origin)
   self.assertEqual(plan['prior_received_bytes'],1570);self.assertEqual(plan['store']['image_bytes'],1536*2**20)
  else:
   with self.assertRaisesRegex(guard.GuardError,'explicit byte-verified restoration'):resume.resume_plan(origin)
 def test_resume_allocation_counts_image_once_plus_new_records(self):
  run,_,_=self.fixture();plan=resume.resume_plan(run)
  control=run.parent/('resume-contract-control-'+uuid.uuid4().hex[:8]);control.mkdir(mode=0o700)
  guard.save_new(control/'counter.json',{'bytes':1})
  store=dict(plan['store'],origin_run=str(run))
  with patch.object(bounded_store,'image_binding',return_value=True):
   amount=guard.owned_allocation(control,{'storage':store})
  self.assertEqual(amount,guard.allocated_bytes(control)+guard.allocated_bytes(run,excluded=Path(store['mountpoint'])))
 def test_exhausted_retained_allocation_refuses_without_mount(self):
  run,_,_=self.fixture()
  with patch.object(guard,'allocated_bytes',return_value=1792*2**20),self.assertRaises(guard.GuardError):resume.resume_plan(run)
 def test_changed_plan_refuses_before_attach(self):
  run,_,_=self.fixture();plan=resume.resume_plan(run);plan['prior_received_bytes']=0
  control=run.parent/('resume-contract-control-'+uuid.uuid4().hex[:8]);control.mkdir(mode=0o700)
  with patch('subprocess.run',side_effect=AssertionError('No mount allowed')),self.assertRaises(guard.GuardError):resume.attach_preserved(control,plan)

if __name__=='__main__':unittest.main()
