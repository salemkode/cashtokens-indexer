"""Deterministic mocked pre-start stages/privacy. No host sampling or executable startup."""
import json,os,sys,uuid,unittest,subprocess
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(ROOT/'scripts'))
import bounded_regtest as b
import prestart_diagnostics as d

class DiagnosticTests(unittest.TestCase):
 def setUp(self):
  self.root=ROOT/'.build/diagnostics'/('prestart-unit-'+uuid.uuid4().hex[:8]);self.root.mkdir(mode=0o700)
 def test_each_stage_has_bounded_reason_and_no_raw_exception(self):
  for stage in sorted(d.STAGES-{'admitted'}):
   diagnostic=d.Diagnostic(self.root)
   with self.assertRaises(d.PrestartRefused):
    with diagnostic:
     diagnostic.stage=stage;raise OSError('SECRET_COOKIE=private /foreign/private/path\npassword')
   raw=(diagnostic.directory/'receipt.json').read_text();r=json.loads(raw)
   self.assertEqual(r['stage'],stage);self.assertEqual(r['reason_codes'],['io_or_path_unavailable'])
   for secret in ['SECRET','private/path','password']:self.assertNotIn(secret,raw)
   self.assertEqual((diagnostic.directory/'receipt.json').stat().st_mode&0o777,0o600)
 def test_only_allowlisted_sample_and_parent_fields_survive(self):
  diagnostic=d.Diagnostic(self.root)
  with diagnostic:
   diagnostic.sample({'free_bytes':123,'swap_bytes':4,'pressure':2,'reclaimable_page_estimate_bytes':99,'heavy_builds':[{'name':'SECRET_PATH'}],'env':{'cookie':'SECRET'},'at':'SECRET','other':'SECRET'})
   diagnostic.parent_facts({'state':'present','uid':os.getuid(),'pid':123,'birth':'SECRET','command':'SECRET','executable':'SECRET'})
   diagnostic.stage='admitted'
  raw=(diagnostic.directory/'receipt.json').read_text();self.assertNotIn('SECRET',raw)
  self.assertEqual(json.loads(raw)['samples'],[{'free_bytes':123,'swap_bytes':4,'pressure':2,'reclaimable_page_estimate_bytes':99,'heavy_build_count':1}])
 def test_known_domain_reasons_and_unknown_guard_message_are_sanitized(self):
  for error,expected in [(b.guard.GuardError('No startup: memory_pressure_not_normal,existing_native_node'),['existing_native_node','memory_pressure_not_normal']),(b.guard.GuardError('No startup: password=/private'),['guard_check_failed']),(b.guard.GuardError('Verified Node24 required'),['node_version_not_24']),(subprocess.TimeoutExpired(['SECRET'],1),['process_check_timeout'])]:
   diagnostic=d.Diagnostic(self.root)
   with self.assertRaises(d.PrestartRefused):
    with diagnostic:raise error
   r=json.loads((diagnostic.directory/'receipt.json').read_text());self.assertEqual(r['reason_codes'],expected);self.assertNotIn('SECRET',json.dumps(r))
 def test_failed_mocked_sample_stops_main_without_native_or_datadir(self):
  actual=d.Diagnostic
  with patch.object(sys,'argv',['bounded_regtest.py','--binary','SECRET','--node','SECRET']),patch.object(b,'Diagnostic',side_effect=lambda _:actual(self.root)),patch.object(b.guard,'host_sample',side_effect=OSError('SECRET')),patch.object(b.subprocess,'Popen') as spawn,patch.object(b.bounded_store,'create_store') as store:
   with self.assertRaises(d.PrestartRefused) as result:b.main()
   self.assertEqual(result.exception.stage,'sample_first');spawn.assert_not_called();store.assert_not_called()
 def test_old_refusal_not_reconstructed(self):
  old=ROOT/'docs/bounded-regtest-actual-refusal-20261116.json';before=old.read_bytes()
  with d.Diagnostic(self.root):pass
  self.assertEqual(old.read_bytes(),before)

if __name__=='__main__':unittest.main()
