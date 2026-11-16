"""Small mocked runner/guardian controls. No resource probe, native process or image operation."""
import sys,os,time,socket,uuid,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'scripts'))
import owned_node as g
import bounded_regtest as b
import bounded_store


def host():return {'at':g.utc(),'free_bytes':20*g.GIB,'pressure':1,'swap_bytes':0,'heavy_builds':[],'reclaimable_page_estimate_bytes':8*g.GIB,'load_averages':[0,0,0]}

class BoundedTests(unittest.TestCase):
 def setUp(self):
  self.run=b.BASE/('bounded-wrapper-fixture-'+uuid.uuid4().hex[:8]);self.run.mkdir(mode=0o700)
  mount=self.run/'mount';mount.mkdir(mode=0o700);data=mount/'data';data.mkdir(mode=0o700);(data/'regtest').mkdir(mode=0o700)
  flags='-regtest -connect=0 -dnsseed=0 -listen=0 -discover=0 -upnp=0 -natpmp=0 -maxconnections=0 -txindex=1 -prune=0'
  def identity(pid,cmd):return {'state':'present','pid':pid,'uid':os.getuid(),'birth':'fixture birth','command':cmd,'executable':str(Path(sys.executable).resolve())}
  self.parent=identity(10002,'owned parent fixture')
  self.native=identity(10001,f'{sys.executable} -datadir={data} {flags}')
  self.owner={'schema':1,'profile':b.PROFILE,'lease_expires_at':time.time()+600,'hostname':socket.gethostname(),'pid':10001,'uid':os.getuid(),'identity':self.native,'parent_identity':self.parent,'executable':self.native['executable'],'datadir':str(data),'cookie':str(data/'regtest/.cookie'),'rpc_port':54321,'network':'regtest','storage':{'image':str(self.run/'synthetic-not-created.dmg'),'mountpoint':str(mount),'image_bytes':96*2**20}}
  self.limits={'deadline':self.owner['lease_expires_at']-30,'free_stop_bytes':9*g.GIB,'allocated_stop_bytes':120*2**20,'rss_stop_bytes':256*2**20,'initial_swap_bytes':0,'swap_growth_stop_bytes':512*2**20,'receive_stop_bytes':1,'checkpoint_height':115252,'no_progress_seconds':600,'startup_grace_seconds':0,'poll_seconds':0.1,'graceful_stop_seconds':0,'term_stop_seconds':0.1}
 def test_overlease_and_unbounded_root_refuse(self):
  for lease in [0,59,1201,float('inf')]:
   with self.assertRaises(g.GuardError):b.validate_spec(lease,b.BASE)
  with self.assertRaises(g.GuardError):b.validate_spec(600,self.run)
 def test_low_resource_cli_starts_nothing(self):
  with patch.object(sys,'argv',['bounded_regtest.py','--binary','never-executed','--node','never-executed']),patch.object(g,'host_sample',return_value=dict(host(),pressure=2)),patch.object(g,'inspect_process',return_value=self.parent),patch.object(g,'command',return_value=''),patch.object(b.time,'sleep'),patch.object(b.subprocess,'Popen') as spawn,patch.object(bounded_store,'create_store') as create:
   with self.assertRaises(g.GuardError):b.main()
   spawn.assert_not_called();create.assert_not_called()
 def test_missing_parent_and_existing_node_refuse(self):
  for parent,node in [({'state':'absent'},False),(self.parent,True)]:
   with self.assertRaises(g.GuardError):b.admit(600,b.BASE,host(),host(),parent,node)
 def test_profile_requires_fixed_storage_zero_peers_and_finite_margin(self):
  with patch.object(bounded_store,'image_binding',return_value=True):
   b.validate_running(self.owner,self.limits,self.run)
   for change in [{'storage':None},{'lease_expires_at':time.time()-1},{'peer_routes':[{'ip':'127.0.0.1'}]},{'network':'chipnet'}]:
    with self.assertRaises(g.GuardError):b.validate_running(dict(self.owner,**change),self.limits,self.run)
   with self.assertRaises(g.GuardError):b.validate_running(self.owner,dict(self.limits,deadline=self.owner['lease_expires_at']),self.run)
 def exercise_watch(self,heartbeat=False,parent_alive=True,stale=False,traffic=0):
  g.save_new(self.run/'owner.json',self.owner);g.save_new(self.run/'limits.json',self.limits)
  if heartbeat:(self.run/'parent-heartbeat.jsonl').write_text('fixture pulse')
  def inspect(pid):
   if pid==10001:return self.native
   if pid==10002:return self.parent if parent_alive else {'state':'absent'}
   return dict(self.parent,pid=pid)
  def rpc(owner,method,params=()):
   return {'getblockchaininfo':{'chain':'regtest','blocks':0,'bestblockhash':g.REG_GENESIS,'upgrade_status':{'software_expiration_time':2000000000},'warnings':''},'getnetworkinfo':{'version':29020100,'connections':0,'warnings':''},'getnettotals':{'totalbytesrecv':traffic,'totalbytessent':traffic},'getblockhash':g.REG_GENESIS}[method]
  with patch.object(g,'inspect_process',side_effect=inspect),patch.object(g,'host_sample',return_value=host()),patch.object(g,'owned_allocation',return_value=0),patch.object(g,'command',return_value='1024'),patch.object(g,'rpc',side_effect=rpc),patch.object(bounded_store,'image_binding',return_value=True),patch.object(g,'watchdog_progress',return_value={'stale':stale}),patch.object(g,'stop_owned',return_value={'outcome':'already_exited'}) as stop:
   self.assertEqual(g.watch(self.run),0);stop.assert_called_once();self.assertEqual(stop.call_args.args[0]['pid'],10001)
  import json
  return json.loads((self.run/'guard-report.json').read_text())['reason']
 def test_missing_owner_heartbeat_stops_via_existing_exact_owner_helper(self):self.assertEqual(self.exercise_watch(),'parent_heartbeat_missing')
 def test_expired_heartbeat_stops(self):self.assertEqual(self.exercise_watch(heartbeat=True,stale=True),'parent_heartbeat_expired')
 def test_expired_parent_stops(self):self.assertEqual(self.exercise_watch(heartbeat=True,parent_alive=False),'launcher_lost')
 def test_any_external_traffic_stops(self):self.assertEqual(self.exercise_watch(heartbeat=True,traffic=1),'bounded_external_peer_traffic')
 def test_consumer_owner_mismatch_never_signals_or_cleans_foreign(self):
  g.save_new(self.run/'consumer-owner.json',dict(self.owner,role='consumer',pid=20000,datadir='/foreign'))
  with patch.object(g,'stop_owned') as stop,patch.object(os,'kill') as signal:
   result=b.stop_consumer(self.run,self.owner,'fixture')
   self.assertEqual(result['outcome'],'ownership_refused');stop.assert_not_called();signal.assert_not_called()
 def test_consumer_stop_uses_separate_receipt_and_never_native_rpc(self):
  child=dict(self.owner,role='consumer',pid=10003,identity=dict(self.native,pid=10003,command=f'{sys.executable} {b.WORKER} -datadir={self.owner["datadir"]}'))
  g.save_new(self.run/'consumer-owner.json',child)
  actual=[child['identity'],child['identity'],{'state':'absent'}]
  with patch.object(bounded_store,'image_binding',return_value=True),patch.object(g,'inspect_process',side_effect=lambda pid:actual.pop(0) if actual else {'state':'absent'}),patch.object(os,'kill') as kill,patch.object(g,'rpc') as rpc:
   result=b.stop_consumer(self.run,self.owner,'fixture')
   self.assertEqual(result['outcome'],'sigterm_exited');kill.assert_called_once();rpc.assert_not_called()
  self.assertTrue((self.run/'consumer-stop-receipt.json').exists());self.assertFalse((self.run/'stop-receipt.json').exists())

if __name__=='__main__':unittest.main()
