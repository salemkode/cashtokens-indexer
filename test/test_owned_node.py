import unittest,importlib.util,sys,os,socket,subprocess,threading,time,json,uuid
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'scripts'))
import owned_node as guard
import bounded_store
from peer_byte_gate import PeerByteGate
TEST_ROOT=ROOT/'.build/runtime'/('supervisor-tests-'+uuid.uuid4().hex[:8]); TEST_ROOT.mkdir(mode=0o700,parents=True)

def host():
 return {'at':guard.utc(),'free_bytes':20*guard.GIB,'swap_bytes':100,'pressure':1,'reclaimable_page_estimate_bytes':8*guard.GIB,'heavy_builds':[],'load_averages':[0,0,0]}

def limits():
 return {'deadline':time.time()+4,'free_stop_bytes':9*guard.GIB,'allocated_stop_bytes':2*guard.GIB-256*2**20,'rss_stop_bytes':2*guard.GIB,'initial_swap_bytes':100,'swap_growth_stop_bytes':512*2**20,'receive_stop_bytes':2*guard.GIB-64*2**20,'checkpoint_height':115252,'no_progress_seconds':600,'startup_grace_seconds':0.1,'poll_seconds':0.1,'graceful_stop_seconds':0.15,'term_stop_seconds':0.5}

class OwnerTests(unittest.TestCase):
 def fixture(self,mode='rpc',lifetime=5):
  run=TEST_ROOT/uuid.uuid4().hex[:8]; run.mkdir(mode=0o700); data=run/'data'; data.mkdir(mode=0o700)
  sock=socket.socket(); sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1];sock.close()
  child=subprocess.Popen([sys.executable,str(ROOT/'test/helpers/owned_process_fixture.py'),f'-datadir={data}',f'-port={port}',f'-mode={mode}',f'-lifetime={lifetime}'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  reaper=threading.Thread(target=child.wait,daemon=True);reaper.start()
  until=time.monotonic()+3
  while not (data/'ready').exists() and time.monotonic()<until:
   if child.poll() is not None:self.fail('Owned fixture failed to start')
   time.sleep(0.02)
  self.assertTrue((data/'ready').exists())
  identity=guard.inspect_process(child.pid)
  ledger={'schema':1,'hostname':socket.gethostname(),'pid':child.pid,'uid':os.getuid(),'identity':identity,'parent_identity':guard.inspect_process(os.getpid()),'executable':identity['executable'],'datadir':str(data),'cookie':str(data/'regtest/.cookie'),'rpc_port':port,'network':'regtest'}
  guard.save_new(run/'owner.json',ledger)
  self.addCleanup(lambda: reaper.join(timeout=lifetime+1))
  return run,ledger,child
 def test_limits_and_preflight_fail_closed(self):
  now=time.time(); current={**host(),'allocated_bytes':0,'rss_bytes':0,'received_bytes':0,'blocks':0}; progress={'received_bytes':0,'last_progress_at':now}
  values=limits(); self.assertIsNone(guard.limits_reason(current,values,now,progress))
  changes=[('deadline',{},dict(values,deadline=now)),('free_space',{'free_bytes':8*guard.GIB},values),('owned_allocation',{'allocated_bytes':2*guard.GIB},values),('rss',{'rss_bytes':3*guard.GIB},values),('swap_growth',{'swap_bytes':1024*2**20},values),('memory_pressure',{'pressure':2},values),('receive_budget',{'received_bytes':2*guard.GIB},values),('connection_budget',{'connections':3},values),('node_warning',{'warnings':'old software'},values),('software_expiry',{'software_expiration_time':now-1},values),('checkpoint',{'blocks':115252},values),('log_limit',{'log_limit':True},values)]
  for reason,change,configuration in changes:
   with self.subTest(reason=reason):self.assertEqual(guard.limits_reason(dict(current,**change),configuration,now,progress),reason)
  self.assertEqual(guard.limits_reason(current,values,now,dict(progress,last_progress_at=now-601)),'no_progress')
  self.assertEqual(guard.limits_reason(current,values,now,dict(progress,received_bytes=1)),'receive_counter_regression')
  self.assertEqual(guard.preflight(host(),host(),True),[])
  sample=dict(host(),pressure=2,free_bytes=11*guard.GIB,swap_bytes=101,heavy_builds=[{'name':'clang'}])
  reasons=guard.preflight(host(),sample,False)
  self.assertTrue({'memory_pressure_not_normal','free_space_below_12GiB','concurrent_heavy_build','swap_rising_during_preflight','strict_disk_receive_ceiling_not_established_by_polling'}.issubset(reasons))
 def test_invalid_poll_and_ceiling_rejected(self):
  for changes in [{'poll_seconds':2.1},{'deadline':float('nan')},{'allocated_stop_bytes':3*guard.GIB},{'receive_stop_bytes':3*guard.GIB},{'deadline':time.time()+1801}]:
   with self.subTest(changes=changes),self.assertRaises(guard.GuardError):guard.validate_limits(dict(limits(),**changes))
 def test_actual_rpc_stop_and_private_receipt(self):
  run,ledger,child=self.fixture(); guard.validate_ledger(ledger,run)
  receipt=guard.stop_owned(ledger,run,'test_rpc',0.3,0.5)
  self.assertEqual(receipt['outcome'],'rpc_stop_exited'); self.assertFalse(receipt['sigterm_sent']); self.assertEqual(child.wait(timeout=2),0)
  self.assertEqual((run/'stop-receipt.json').stat().st_mode&0o777,0o600)
 def test_rpc_unavailable_exact_owner_sigterm(self):
  run,ledger,child=self.fixture('stalled')
  receipt=guard.stop_owned(ledger,run,'test_unavailable',0.05,1.5)
  self.assertEqual(receipt['outcome'],'sigterm_exited');self.assertTrue(receipt['sigterm_sent']);self.assertFalse(receipt['sigkill_or_restart']);child.wait(timeout=2)
 def test_owner_rpc_does_not_use_environment_proxy(self):
  run,ledger,child=self.fixture()
  with patch.dict(os.environ,{'http_proxy':'http://127.0.0.1:9','HTTP_PROXY':'http://127.0.0.1:9','no_proxy':'','NO_PROXY':''}),patch('urllib.request.proxy_bypass',return_value=False):
   self.assertEqual(guard.rpc(ledger,'getnetworkinfo')['connections'],0)
  receipt=guard.stop_owned(ledger,run,'proxy_isolation',0.3,0.5)
  self.assertEqual(receipt['outcome'],'rpc_stop_exited');child.wait(timeout=2)
 def test_concurrent_stop_claim_allows_only_one_mutation(self):
  run,ledger,child=self.fixture()
  receipts=[]
  def stop():receipts.append(guard.stop_owned(ledger,run,'parallel',0.3,0.5))
  threads=[threading.Thread(target=stop) for _ in range(2)]
  for t in threads:t.start()
  for t in threads:t.join(timeout=3)
  self.assertEqual(sum(r['rpc_stop_attempted'] for r in receipts),1)
  self.assertEqual(sum(r['outcome']=='stop_already_claimed' for r in receipts),1)
  child.wait(timeout=2)
 def test_identity_mismatch_never_touches_process(self):
  for field in ['birth','executable','command','uid']:
   with self.subTest(field=field):
    run,ledger,child=self.fixture(lifetime=1.3); wrong=dict(ledger);wrong['identity']=dict(ledger['identity'],**{field:'wrong'})
    receipt=guard.stop_owned(wrong,run,'mismatch',0.01,0.01)
    self.assertEqual(receipt['outcome'],'ownership_refused');self.assertFalse(receipt['rpc_stop_attempted']);self.assertFalse(receipt['sigterm_sent']);self.assertIsNone(child.poll());child.wait(timeout=2)
 def test_pid_and_datadir_mismatch_refuse_before_any_rpc(self):
  for kind in ['pid','datadir']:
   run,ledger,child=self.fixture(lifetime=1)
   wrong=dict(ledger)
   if kind=='pid':wrong['pid']=os.getpid()
   else:
    data=run/'other-data';data.mkdir(mode=0o700);wrong['datadir']=str(data)
   receipt=guard.stop_owned(wrong,run,'mismatch')
   self.assertEqual(receipt['outcome'],'ownership_refused');self.assertFalse(receipt['rpc_stop_attempted']);self.assertFalse(receipt['sigterm_sent']);self.assertIsNone(child.poll());child.wait(timeout=2)
 def test_ambiguous_stop_has_no_force_or_restart(self):
  run,ledger,child=self.fixture('ignore',lifetime=1.4)
  # Simulate unavailable RPC; the owned process ignores SIGTERM but exits itself shortly.
  with patch.object(guard,'rpc',side_effect=guard.GuardError('unavailable')):
   receipt=guard.stop_owned(ledger,run,'ambiguous',0.01,0.05)
  self.assertEqual(receipt['outcome'],'ambiguous_no_force');self.assertFalse(receipt['sigkill_or_restart']);self.assertIsNone(child.poll());child.wait(timeout=2)
 def test_supervisor_deadline_and_no_progress_process_backed(self):
  for reason,change in [('deadline',{'deadline':time.time()+0.4}),('no_progress',{'no_progress_seconds':0.25})]:
   with self.subTest(reason=reason):
    run,ledger,child=self.fixture(); cfg=dict(limits(),**change);guard.save_new(run/'limits.json',cfg)
    with patch.object(guard,'host_sample',side_effect=lambda path:host()):self.assertEqual(guard.watch(run),0)
    report=json.loads((run/'guard-report.json').read_text());self.assertEqual(report['reason'],reason);self.assertFalse(report['strict_allocation_or_receive_quota']);self.assertTrue((run/'counters.jsonl').exists());child.wait(timeout=2)
 def test_supervisor_resource_exhaustion_and_rpc_stall(self):
  for reason,mode,change in [('owned_allocation','rpc',{'allocated_stop_bytes':1}),('rpc_unavailable','stalled',{})]:
   with self.subTest(reason=reason):
    run,ledger,child=self.fixture(mode);guard.save_new(run/'limits.json',dict(limits(),**change))
    with patch.object(guard,'host_sample',side_effect=lambda path:host()):self.assertEqual(guard.watch(run),0)
    report=json.loads((run/'guard-report.json').read_text());self.assertEqual(report['reason'],reason);child.wait(timeout=2)
 def test_expired_rpc_and_parent_mismatch_stop_owned_process(self):
  for reason in ['native_identity_or_expiry_failure','launcher_lost']:
   run,ledger,child=self.fixture()
   if reason=='launcher_lost':
    ledger['parent_identity']=dict(ledger['parent_identity'],birth='wrong')
    # New private owner fixture document is written once for this case.
    other=run/'altered-owner.json';guard.save_new(other,ledger)
   guard.save_new(run/'limits.json',limits())
   original=guard.rpc
   def fault(owned,method,params=(),timeout=0.4):
    if method!='stop':raise guard.GuardError('Owner RPC code -100')
    return original(owned,method,params,timeout)
   with patch.object(guard,'host_sample',side_effect=lambda path:host()):
    if reason=='launcher_lost':
     original_load=guard.load_private
     with patch.object(guard,'load_private',side_effect=lambda path:ledger if Path(path).name=='owner.json' else original_load(path)):result=guard.watch(run)
    else:
     with patch.object(guard,'rpc',side_effect=fault):result=guard.watch(run)
   self.assertEqual(result,0);self.assertEqual(json.loads((run/'guard-report.json').read_text())['reason'],reason);child.wait(timeout=2)
 def test_peer_activation_refuses_regtest_ungated_and_unowned_targets(self):
  run,ledger,child=self.fixture(lifetime=1)
  with self.assertRaises(guard.GuardError):guard.rpc(ledger,'addnode',['127.0.0.1:12345','onetry'])
  wrong=dict(ledger,network='chipnet',storage={'image':str(run/'bounded.dmg')})
  guard.save_new(run/'armed.json',{'watchdog_pid':os.getpid()})
  guard.save_new(run/'peer-gate.json',{'pid':os.getpid(),'ports':[12345]})
  guard.save_new(run/'watchdog-owner.json',{'pid':os.getpid(),'identity':dict(guard.inspect_process(os.getpid()),birth='foreign')})
  with self.assertRaises(guard.GuardError):guard.rpc(wrong,'addnode',['127.0.0.1:12345','onetry'])
  self.assertFalse(list(run.glob('activation-*.json')));self.assertIsNone(child.poll());child.wait(timeout=2)
 def test_chipnet_ledger_requires_fixed_history_routes_and_default_expiry(self):
  run,ledger,child=self.fixture(lifetime=1)
  wrong=dict(ledger,network='chipnet',cookie=str(Path(ledger['datadir'])/'chipnet/.cookie'))
  with self.assertRaises(guard.GuardError):guard.validate_ledger(wrong,run)
  required=' -chipnet -connect=0 -dnsseed=0 -listen=0 -discover=0 -upnp=0 -natpmp=0 -disablewallet=1 -prune=0 -txindex=1 -stopatheight=115252'
  wrong['identity']=dict(wrong['identity'],command=wrong['identity']['command']+required)
  wrong['storage']={'mountpoint':str(run)};wrong['peer_routes']=[{'ip':'127.0.0.1','port':12345}]
  with patch.object(bounded_store,'image_binding',return_value=True):
   guard.validate_ledger(wrong,run)
   for override in [' -expire=0',' -expirerpc=0',' -upgrade2027activationtime=0',' -prune=1',' -connect=1.2.3.4']:
    bad=dict(wrong,identity=dict(wrong['identity'],command=wrong['identity']['command']+override))
    with self.assertRaises(guard.GuardError):guard.validate_ledger(bad,run)
  self.assertIsNone(child.poll());child.wait(timeout=2)
 def test_parent_heartbeat_uses_monotonic_progress_and_two_second_bound(self):
  run=TEST_ROOT/('heartbeat-'+uuid.uuid4().hex[:8]);run.mkdir(mode=0o700)
  first=guard.watchdog_progress(run,now=10)
  self.assertFalse(guard.watchdog_progress(run,first,now=12)['stale'])
  self.assertTrue(guard.watchdog_progress(run,first,now=12.01)['stale'])
  guard.save_new(run/'counters.jsonl',{'sample':1})
  changed=guard.watchdog_progress(run,first,now=13)
  self.assertFalse(changed['stale']);self.assertEqual(changed['changed_at'],13)
 def test_early_child_exit_is_reported_without_signal(self):
  child=subprocess.Popen([sys.executable,'-c','pass'])
  child.wait(timeout=2)
  with self.assertRaises(guard.GuardError):guard.capture_child_identity(child)
 def test_symlink_and_private_owner_document_refused(self):
  run,ledger,child=self.fixture(lifetime=1); (run/'link').symlink_to(ROOT)
  with self.assertRaises(guard.GuardError):guard.allocated_bytes(run)
  os.chmod(run/'owner.json',0o644)
  with self.assertRaises(guard.GuardError):guard.load_private(run/'owner.json')
  child.wait(timeout=2)

class StrictBoundaryTests(unittest.TestCase):
 def test_fixed_owned_filesystem_enforces_enospc_and_exact_detach(self):
  import errno
  run=TEST_ROOT/('filesystem-'+uuid.uuid4().hex[:8]);run.mkdir(mode=0o700)
  store=bounded_store.create_store(run,32)
  self.assertLessEqual(store['capacity_bytes'],32*2**20)
  self.assertTrue(bounded_store.image_binding(run,store))
  failure=None
  try:
   with (Path(store['mountpoint'])/'fill.bin').open('xb') as file:
    for _ in range(40):file.write(b'x'*2**20);file.flush()
  except OSError as error:failure=error.errno
  self.assertEqual(failure,errno.ENOSPC);self.assertEqual(Path(store['image']).stat().st_size,store['image_bytes'])
  with self.assertRaises(guard.GuardError):bounded_store.detach_store(run,dict(store,device='/dev/definitely-not-this-image'))
  receipt=bounded_store.detach_store(run,store)
  self.assertTrue(receipt['unmounted']);self.assertFalse(receipt['force']);self.assertTrue(Path(store['image']).exists())
 def test_two_loopback_receive_streams_cannot_exceed_one_shared_budget(self):
  sources=[]; workers=[]
  def source(listener):
   try:
    connection,_=listener.accept()
    with connection:
     for _ in range(32):connection.sendall(b'a'*4096)
   except (OSError,TimeoutError):pass
   finally:listener.close()
  for _ in range(2):
   listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(2)
   sources.append(('127.0.0.1',listener.getsockname()[1]));worker=threading.Thread(target=source,args=(listener,),daemon=True);worker.start();workers.append(worker)
  events=[];gate=PeerByteGate(sources,32768,65536,events.append);ports=gate.start();received=[]
  def client(port):
   data=b''
   try:
    with socket.create_connection(('127.0.0.1',port),timeout=2) as connection:
     while True:
      chunk=connection.recv(4096)
      if not chunk:break
      data+=chunk
   except OSError:pass
   received.append(len(data))
  clients=[threading.Thread(target=client,args=(port,)) for port in ports]
  for thread in clients:thread.start()
  for thread in clients:thread.join(timeout=3)
  gate.close()
  for worker in workers:worker.join(timeout=3)
  self.assertEqual(gate.received,32768);self.assertLessEqual(sum(received),32768);self.assertEqual(events,['receive_limit']);self.assertFalse(gate.snapshot()['automatic_reconnect'])
 def test_upload_budget_is_separate_from_receive_budget(self):
  listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(2);port=listener.getsockname()[1];data=[]
  def sink():
   try:
    connection,_=listener.accept()
    with connection:
     while True:
      chunk=connection.recv(4096)
      if not chunk:break
      data.append(chunk)
   except OSError:pass
   finally:listener.close()
  worker=threading.Thread(target=sink,daemon=True);worker.start();events=[];gate=PeerByteGate([('127.0.0.1',port)],65536,8192,events.append);local=gate.start()[0]
  with socket.create_connection(('127.0.0.1',local),timeout=2) as connection:
   try:connection.sendall(b'x'*65536)
   except OSError:pass
   gate.stopped.wait(timeout=2)
  gate.close();worker.join(timeout=3)
  self.assertEqual(gate.uploaded,8192);self.assertLessEqual(sum(map(len,data)),8192);self.assertEqual(events,['upload_limit'])

if __name__=='__main__':unittest.main()
