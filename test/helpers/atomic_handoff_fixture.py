"""Tiny isolated publisher fixture; invoked only by the deferred focused tests."""
import os,sys,stat
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
import atomic_handoff as handoff
run=Path(sys.argv[1]);mode=sys.argv[2]
osignal=os.write;original_sync=os.fsync
state={'partial':False,'synced':False}
def write(fd,data):
    count=osignal(fd,data[:64])
    if not state['partial']:
        state['partial']=True
        if mode=='crash':os._exit(17)
        print('PARTIAL',flush=True);sys.stdin.readline()
    return count
def sync(fd):
    original_sync(fd)
    if not state['synced'] and stat.S_ISREG(os.fstat(fd).st_mode):
        state['synced']=True;print('SYNCED',flush=True);sys.stdin.readline()
handoff.os.write=write;handoff.os.fsync=sync
handoff.publish_handoff(run,'consumer-owner.json',{'fixture':'synthetic-only','text':'x'*32768})
print('PUBLISHED',flush=True)
