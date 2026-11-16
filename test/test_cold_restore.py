"""Bounded small synthetic restoration; no actual stage restore/mount/native process."""
import sys,os,json,uuid,datetime,unittest,hashlib,io
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'scripts'))
import cold_restore as restore
import cold_archive as cold
import owned_node as guard
import chipnet_resume

class RestoreTests(unittest.TestCase):
 def setUp(self):
  self.base=ROOT/'.build/runtime'/('restore-test-'+uuid.uuid4().hex[:8]);self.base.mkdir(mode=0o700)
  self.run=self.base/'origin';self.run.mkdir(mode=0o700);self.archive=self.base/'archive';self.archive.mkdir(mode=0o700)
  self.target=self.run/'bounded.dmg';self.data=b'complete preserved bytes\0'*4096
  self.target.write_bytes(self.data);os.chmod(self.target,0o600)
  self.mount=self.run/'mount';self.mount.mkdir(mode=0o700)
  self.store={'image':str(self.target),'mountpoint':str(self.mount),'image_inode':self.target.stat().st_ino,'image_bytes':len(self.data)}
  guard.save_new(self.run/'fixed-store.json',self.store);guard.save_new(self.run/'detach-receipt.json',{'exit_code':0,'unmounted':True})
  guard.save_new(self.run/'measurement-receipt.json',{'process_exit_confirmed':True,'node_exit_code':0,'watchdog_exit_code':0,'elapsed_seconds':4.196,'peer_gate_receipt':{'received_application_bytes':1570,'uploaded_application_bytes':783}})
  conf=self.run/'empty.conf';conf.touch(mode=0o600)
  entry={'path':str(self.target),'identity':cold.fingerprint(self.target.stat()),'allocated_bytes':self.target.stat().st_blocks*512,'receipt_sha256':{p.name:cold.file_hash(p) for p in self.run.glob('*.json')}}
  self.originals=dict(entry['receipt_sha256']);r=cold.archive_image(entry,self.archive,2**20,check_idle=lambda p:None)
  self.custody=Path(r['archive']).with_suffix('.custody.json')
  self.quiet=self.base/'quiet.json';now=datetime.datetime.now(datetime.timezone.utc)
  self.host={'free_bytes':20*guard.GIB,'pressure':1,'swap_bytes':0,'heavy_builds':[],'reclaimable_page_estimate_bytes':8*guard.GIB,'at':guard.utc()}
  samples=[dict(self.host,at=(now-datetime.timedelta(seconds=60-i*2)).isoformat()) for i in range(31)]
  guard.save_new(self.quiet,{'samples':samples,'reasons':[],'elapsed_seconds':60})
  self.patches=[patch.object(guard,'host_sample',return_value=self.host),patch.object(cold,'idle',return_value=None)]
  for p in self.patches:p.start();self.addCleanup(p.stop)
 def run_restore(self):return restore.restore_image(self.custody,self.quiet)
 def test_full_restore_and_guard_admits_new_identity_without_old_receipt_edits(self):
  r=self.run_restore();self.assertEqual(self.target.read_bytes(),self.data)
  self.assertEqual(r['decoded_length'],len(self.data));self.assertTrue(r['restored_file_and_parent_fsynced'])
  plan=chipnet_resume.resume_plan(self.run)
  self.assertEqual(plan['store']['image_inode'],self.target.stat().st_ino)
  self.assertIn('restoration_receipt_sha256',plan['store']);self.assertEqual(plan['prior_received_bytes'],1570)
  self.assertEqual(plan['prior_allocated_bytes'],guard.allocated_bytes(self.run,excluded=self.mount)+guard.cold_allocation(plan['store']))
  self.assertGreater(guard.cold_allocation(plan['store']),0)
  for name,h in self.originals.items():self.assertEqual(cold.file_hash(self.run/name),h)
  self.assertEqual(self.target.stat().st_mode&0o777,0o600)
 def test_existing_target_symlink_and_foreign_file_are_never_overwritten(self):
  foreign=self.base/'foreign';foreign.write_bytes(b'foreign')
  self.target.symlink_to(foreign)
  with self.assertRaises(guard.GuardError):self.run_restore()
  self.assertEqual(foreign.read_bytes(),b'foreign');self.assertFalse((self.run/'restoration-claim.json').exists())
 def test_existing_regular_file_never_overwritten(self):
  self.target.write_bytes(b'new owner bytes')
  with self.assertRaises(guard.GuardError):self.run_restore()
  self.assertEqual(self.target.read_bytes(),b'new owner bytes')
 def test_wrong_archive_rejected_before_claim(self):
  archive=Path(json.loads(self.custody.read_text())['archive']);archive.write_bytes(b'wrong archive')
  with self.assertRaises(guard.GuardError):self.run_restore()
  self.assertFalse(self.target.exists());self.assertFalse((self.run/'restoration-claim.json').exists())
 def test_low_space_and_pressure_refuse_before_claim(self):
  for h in [dict(self.host,free_bytes=restore.FLOOR),dict(self.host,pressure=2)]:
   with patch.object(guard,'host_sample',return_value=h),self.assertRaises(guard.GuardError):self.run_restore()
   self.assertFalse(self.target.exists());self.assertFalse((self.run/'restoration-claim.json').exists())
 def test_interrupted_decode_leaves_claim_and_no_admission_or_retry(self):
  with patch.object(restore.gzip,'open',side_effect=OSError('interrupted')),self.assertRaises(OSError):self.run_restore()
  self.assertTrue((self.run/'restoration-claim.json').exists());self.assertFalse((self.run/'restoration-receipt.json').exists())
  with self.assertRaises((guard.GuardError,FileNotFoundError)):chipnet_resume.resume_plan(self.run)
  with self.assertRaises(guard.GuardError):self.run_restore()
 def test_changed_restored_bytes_and_config_fail_guard(self):
  self.run_restore();self.target.write_bytes(b'altered')
  with self.assertRaises(guard.GuardError):chipnet_resume.resume_plan(self.run)
 def test_changed_historical_receipt_fails_custody(self):
  (self.run/'measurement-receipt.json').write_text('{}')
  with self.assertRaises(guard.GuardError):self.run_restore()
  self.assertFalse(self.target.exists())
 def test_changed_config_after_restore_refused(self):
  self.run_restore();(self.run/'empty.conf').write_text('expire=0')
  with self.assertRaises(guard.GuardError):chipnet_resume.resume_plan(self.run)
 def test_new_inode_without_restoration_receipt_refused(self):
  self.target.write_bytes(self.data);os.chmod(self.target,0o600)
  with self.assertRaises(guard.GuardError):restore.verify_restored(self.run,self.store)
 def test_mismatched_custody_and_duplicate_atomic_receipt_refuse(self):
  d=json.loads(self.custody.read_text());d['decoded_sha256']='0'*64;self.custody.write_text(json.dumps(d))
  with self.assertRaises(guard.GuardError):self.run_restore()
  path=self.base/'atomic.json';restore.append_atomic(path,{'first':True})
  with self.assertRaises(FileExistsError):restore.append_atomic(path,{'second':True})
  self.assertEqual(json.loads(path.read_text()),{'first':True})
 def test_decoded_sha_failure_never_admits_even_with_correct_length(self):
  with patch.object(restore.gzip,'open',return_value=io.BytesIO(b'z'*len(self.data))),self.assertRaises(guard.GuardError):self.run_restore()
  self.assertTrue((self.run/'restoration-claim.json').exists());self.assertFalse((self.run/'restoration-receipt.json').exists())
  with self.assertRaises(guard.GuardError):chipnet_resume.resume_plan(self.run)
 def test_crash_before_final_receipt_requires_manual_reconciliation(self):
  original=restore.append_atomic
  def crash_receipt(path,value):
   if Path(path).name=='restoration-receipt.json':raise OSError('crash before publication')
   return original(path,value)
  with patch.object(restore,'append_atomic',side_effect=crash_receipt),self.assertRaises(OSError):self.run_restore()
  self.assertEqual(self.target.read_bytes(),self.data)
  with self.assertRaises(guard.GuardError):chipnet_resume.resume_plan(self.run)
  with self.assertRaises(guard.GuardError):self.run_restore()
 def test_fsync_failure_never_admits_output(self):
  original=restore.sync_parent
  def fail_target(path):
   if Path(path)==self.target:raise OSError('simulated parent fsync failure')
   original(path)
  with patch.object(restore,'sync_parent',side_effect=fail_target),self.assertRaises(OSError):self.run_restore()
  self.assertFalse((self.run/'restoration-receipt.json').exists())
  with self.assertRaises((guard.GuardError,FileNotFoundError)):chipnet_resume.resume_plan(self.run)

if __name__=='__main__':unittest.main()
