"""Disposable process-backed owner-guard fixture. No chain, keys or peer traffic."""
import sys,json,os,time,signal,threading
from pathlib import Path
from http.server import HTTPServer,BaseHTTPRequestHandler
args=dict(x.split('=',1) for x in sys.argv[1:]); directory=Path(args['-datadir']); mode=args.get('-mode','rpc'); port=int(args['-port'])
(directory/'regtest').mkdir(mode=0o700,exist_ok=True)
cookie=directory/'regtest/.cookie'; cookie.write_text('owned-fixture:nonsecret-test-cookie'); os.chmod(cookie,0o600)
state={'running':True}
def term(*args):
 if mode!='ignore':state['running']=False
signal.signal(signal.SIGTERM,term)
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  if mode=='stalled': time.sleep(0.8); return
  method=body['method']; result=None
  if method=='stop':state['running']=False; result='fixture stopping'
  elif method=='getblockchaininfo':result={'chain':'regtest','blocks':0,'bestblockhash':'0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206','warnings':'','upgrade_status':{'software_expiration_time':2000000000}}
  elif method=='getblockhash':result='0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'
  elif method=='getnetworkinfo':result={'version':29020100,'connections':0,'warnings':''}
  elif method=='getnettotals':result={'totalbytesrecv':0}
  payload=json.dumps({'id':body['id'],'result':result,'error':None}).encode(); self.send_response(200); self.end_headers()
  try:self.wfile.write(payload)
  except OSError:pass
server=HTTPServer(('127.0.0.1',port),Handler); server.timeout=0.05
(directory/'ready').write_text(str(os.getpid()))
until=time.monotonic()+float(args.get('-lifetime','5'))
while state['running'] and time.monotonic()<until:server.handle_request()
server.server_close()
