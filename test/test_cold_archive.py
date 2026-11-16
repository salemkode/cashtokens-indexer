"""Tiny owned synthetic inputs; never restore/mount a retained diagnostic image."""
import sys,unittest,os,uuid,hashlib,gzip,io
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'scripts'))
import cold_archive as cold
import owned_node as guard

class ColdCustodyTests(unittest.TestCase):
 def fixture(self,data=b'preserve all bytes\x00'*4096):
  run=ROOT/'.build/runtime'/('cold-custody-test-'+uuid.uuid4().hex[:8]);run.mkdir(mode=0o700)
  source=run/'synthetic.bin';source.write_bytes(data);os.chmod(source,0o600)
  target=run/'archive';target.mkdir(mode=0o700)
  entry={'path':str(source),'identity':cold.fingerprint(source.stat()),'allocated_bytes':source.stat().st_blocks*512}
  return source,target,entry,data
 def test_verified_custody_precedes_removal_and_preserves_exact_bytes(self):
  source,target,entry,data=self.fixture()
  r=cold.archive_image(entry,target,2**20,check_idle=lambda p:None)
  self.assertFalse(source.exists());self.assertEqual(r['original_sha256'],hashlib.sha256(data).hexdigest())
  self.assertEqual(gzip.decompress(Path(r['archive']).read_bytes()),data)
  self.assertEqual(Path(r['archive']).stat().st_mode&0o777,0o600)
  self.assertTrue(list(target.glob('*.custody.json')));self.assertTrue(list(target.glob('*.removal.json')))
 def test_encoded_budget_failure_retains_original(self):
  source,target,entry,data=self.fixture(os.urandom(32768))
  with self.assertRaises(guard.GuardError):cold.archive_image(entry,target,64,check_idle=lambda p:None)
  self.assertEqual(source.read_bytes(),data);self.assertFalse(list(target.glob('*.removal.json')))
 def test_decompression_mismatch_retains_original(self):
  source,target,entry,data=self.fixture()
  with patch.object(cold.gzip,'open',return_value=io.BytesIO(b'wrong')),self.assertRaises(guard.GuardError):cold.archive_image(entry,target,2**20,check_idle=lambda p:None)
  self.assertEqual(source.read_bytes(),data);self.assertFalse(list(target.glob('*.removal.json')))
 def test_changed_inode_refuses_before_archive(self):
  source,target,entry,data=self.fixture();entry['identity']['st_ino']+=1
  with self.assertRaises(guard.GuardError):cold.archive_image(entry,target,2**20,check_idle=lambda p:None)
  self.assertEqual(source.read_bytes(),data);self.assertEqual(list(target.iterdir()),[])
 def test_open_handle_refusal_preserves_original(self):
  source,target,entry,data=self.fixture()
  def refuse(path):raise guard.GuardError('Open handles')
  with self.assertRaises(guard.GuardError):cold.archive_image(entry,target,2**20,check_idle=refuse)
  self.assertEqual(source.read_bytes(),data)

if __name__=='__main__':unittest.main()
