"""DEFERRED: serial tiny process fixtures, no node/image/resource probe or real handoff."""
import json,os,sys,uuid,unittest,subprocess,threading,time,queue
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'scripts'))
from atomic_handoff import publish_handoff

class AtomicHandoffTests(unittest.TestCase):
 def setUp(self):
  self.run=ROOT/'.build/runtime'/('atomic-handoff-fixture-'+uuid.uuid4().hex[:8]);self.run.mkdir(mode=0o700)
  self.target=self.run/'consumer-owner.json'
 def fixture(self,mode):
  child=subprocess.Popen([sys.executable,'-B',str(ROOT/'test/helpers/atomic_handoff_fixture.py'),str(self.run),mode],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  messages=queue.Queue()
  def read():
   for line in child.stdout:messages.put(line.strip())
  reader=threading.Thread(target=read,daemon=True);reader.start()
  def stop():
   if child.poll() is None:child.terminate()  # Only this freshly created synthetic fixture handle.
   child.wait(timeout=3)
   for stream in [child.stdin,child.stdout,child.stderr]:stream.close()
  self.addCleanup(stop)
  return child,messages
 def test_final_absent_until_complete_fsynced_publish_and_concurrent_reader(self):
  child,messages=self.fixture('publish')
  self.assertEqual(messages.get(timeout=3),'PARTIAL');self.assertFalse(self.target.exists())
  partial=next(self.run.glob('.*.pending'));self.assertGreater(partial.stat().st_size,0);self.assertLess(partial.stat().st_size,32768)
  errors=[];seen=[];done=threading.Event()
  def read():
   while not done.is_set():
    try:seen.append(json.loads(self.target.read_text()))
    except FileNotFoundError:pass
    except Exception as error:errors.append(type(error).__name__)
    time.sleep(0.0005)
  thread=threading.Thread(target=read);thread.start()
  try:
   child.stdin.write('continue\n');child.stdin.flush()
   self.assertEqual(messages.get(timeout=3),'SYNCED');self.assertFalse(self.target.exists())
   child.stdin.write('publish\n');child.stdin.flush()
   self.assertEqual(messages.get(timeout=3),'PUBLISHED');self.assertEqual(child.wait(timeout=3),0)
   for _ in range(20):
    if seen:break
    time.sleep(0.001)
  finally:done.set();thread.join(timeout=1)
  self.assertEqual(errors,[]);self.assertTrue(seen)
  self.assertTrue(all(value=={'fixture':'synthetic-only','text':'x'*32768} for value in seen))
  self.assertEqual(self.target.stat().st_mode&0o777,0o600);self.assertEqual(list(self.run.glob('.*.pending')),[])
 def test_interrupted_producer_never_publishes_incomplete_final(self):
  child,_=self.fixture('crash');self.assertEqual(child.wait(timeout=3),17)
  self.assertFalse(self.target.exists());self.assertTrue(list(self.run.glob('.*.pending')))
 def test_existing_handoff_refused_without_replacement_or_temp(self):
  self.target.write_bytes(b'original foreign handoff sentinel')
  with self.assertRaises(FileExistsError):publish_handoff(self.run,self.target.name,{'new':True})
  self.assertEqual(self.target.read_bytes(),b'original foreign handoff sentinel');self.assertEqual(list(self.run.glob('.*.pending')),[])
 def test_symlink_final_refused_without_touching_referent(self):
  other=self.run/'foreign.json';other.write_bytes(b'keep')
  self.target.symlink_to(other)
  with self.assertRaises(FileExistsError):publish_handoff(self.run,self.target.name,{'new':True})
  self.assertTrue(self.target.is_symlink());self.assertEqual(other.read_bytes(),b'keep')

if __name__=='__main__':unittest.main()
