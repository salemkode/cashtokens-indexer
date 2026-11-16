"""Two-route, one-attempt, byte-bounded TCP relay for a supervised native node.

Counts application bytes read from remote peers, including bytes not delivered.
It never reconnects. Strict delivered-byte bound is separate from TCP/IP overhead.
"""
import ipaddress,socket,threading,time


class PeerByteGate:
    def __init__(self,targets,receive_limit,upload_limit,on_stop):
        if not 1<=len(targets)<=2 or not 1<=receive_limit<=1792*2**20 or not 1<=upload_limit<=64*2**20:
            raise ValueError('Gate limits outside bounded stage')
        for host,port in targets:
            ipaddress.ip_address(host)
            if not 1<=port<=65535:raise ValueError('Peer port invalid')
        self.targets=targets;self.receive_limit=receive_limit;self.upload_limit=upload_limit;self.on_stop=on_stop
        self.received=0;self.uploaded=0;self.stop_reason=None;self.stopped=threading.Event();self.lock=threading.RLock();self.rx_lock=threading.Lock();self.tx_lock=threading.Lock();self.sockets=[];self.threads=[];self.ports=[]
    def start(self):
        for target in self.targets:
            listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(0.25)
            self.sockets.append(listener);self.ports.append(listener.getsockname()[1])
            worker=threading.Thread(target=self.accept_once,args=(listener,target),daemon=True);worker.start();self.threads.append(worker)
        return self.ports
    def stop(self,reason):
        with self.lock:
            if self.stopped.is_set():return
            self.stop_reason=reason;self.stopped.set()
            for connection in self.sockets:
                try:connection.shutdown(socket.SHUT_RDWR)
                except OSError:pass
                connection.close()
        self.on_stop(reason)
    def accept_once(self,listener,target):
        try:
            while not self.stopped.is_set():
                try:local,address=listener.accept();break
                except socket.timeout:continue
            else:return
            if address[0]!='127.0.0.1':local.close();self.stop('nonloopback_client');return
            remote=socket.socket(socket.AF_INET6 if ipaddress.ip_address(target[0]).version==6 else socket.AF_INET)
            remote.settimeout(1);remote.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,65536);remote.connect(target)
            with self.lock:
                if self.stopped.is_set():local.close();remote.close();return
                for connection in [local,remote]:
                    connection.settimeout(0.25);connection.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,65536)
                    self.sockets.append(connection)
            forward=threading.Thread(target=self.forward,args=(local,remote,False),daemon=True);forward.start();self.threads.append(forward)
            self.forward(remote,local,True)
        except OSError:
            if not self.stopped.is_set():self.stop('peer_connection_or_stream_failed')
    def forward(self,source,destination,receiving):
        lock=self.rx_lock if receiving else self.tx_lock
        while not self.stopped.is_set():
            try:
                with lock:
                    remaining=(self.receive_limit-self.received) if receiving else (self.upload_limit-self.uploaded)
                    if remaining<=0:self.stop('receive_limit' if receiving else 'upload_limit');return
                    try:data=source.recv(min(65536,remaining))
                    except socket.timeout:continue
                    if not data:self.stop('peer_or_native_eof');return
                    if receiving:self.received+=len(data)
                    else:self.uploaded+=len(data)
                destination.sendall(data)
                if (self.received>=self.receive_limit if receiving else self.uploaded>=self.upload_limit):
                    self.stop('receive_limit' if receiving else 'upload_limit');return
            except OSError:
                if not self.stopped.is_set():self.stop('peer_connection_or_stream_failed')
                return
    def snapshot(self):
        with self.lock:return {'received_application_bytes':self.received,'uploaded_application_bytes':self.uploaded,'receive_limit':self.receive_limit,'upload_limit':self.upload_limit,'stop_reason':self.stop_reason,'loopback_ports':list(self.ports),'automatic_reconnect':False,'wire_overhead_excluded':True,'socket_receive_buffer_requested_bytes':65536}
    def close(self):
        self.stop('owner_close')
        deadline=time.monotonic()+2
        for worker in self.threads:
            if worker is not threading.current_thread():worker.join(timeout=max(0,deadline-time.monotonic()))
