"""Sanitized one-shot diagnostics; never re-probes or serializes raw exceptions/paths/env."""
import json,math,os,subprocess,uuid
from pathlib import Path
import owned_node as guard

STAGES={'specification','sample_first','sample_second','node_inventory','parent_identity','resource_admission','native_hash','node_version','compiled_runtime','admitted'}
RESOURCE={'free_space_below_12GiB','memory_pressure_not_normal','concurrent_heavy_build','less_than_4GiB_reclaimable_page_estimate','swap_rising_during_preflight','strict_disk_receive_ceiling_not_established_by_polling','existing_native_node','missing_parent_identity'}
KNOWN={'Lease must be finite60..1200 seconds including setup/stop margin':'invalid_lease','Unbounded/foreign datadir root refused':'invalid_owned_root','Pinned native runtime changed':'native_hash_mismatch','Verified Node24 required':'node_version_not_24','Source differs from intended compiled release; review before JS compile':'runtime_source_hash_mismatch','Immutable runtime artifact changed':'artifact_hash_mismatch','Compiled API differs; no automatic rebuild':'compiled_api_mismatch','Kernel executable mapping unavailable':'parent_executable_mapping_unavailable','Executable inspection raced exit or is unavailable':'parent_executable_inspection_unavailable','Unrecognized process birth/argv record':'parent_identity_unrecognized'}

class PrestartRefused(guard.GuardError):
    def __init__(self,path,stage,codes):
        super().__init__('Sanitized pre-start refusal')
        self.path=path;self.stage=stage;self.codes=codes

class Diagnostic:
    def __init__(self,root):
        self.directory=Path(root)/('bounded-prestart-'+uuid.uuid4().hex[:8]);self.directory.mkdir(mode=0o700)
        self.stage='specification';self.samples=[];self.parent=None
    def __enter__(self):return self
    def sample(self,value):
        safe={}
        for key in ['free_bytes','swap_bytes','pressure','reclaimable_page_estimate_bytes']:
            v=value.get(key)
            if type(v) in [int,float] and math.isfinite(v) and 0<=v<2**63:safe[key]=v
        if isinstance(value.get('heavy_builds'),list):safe['heavy_build_count']=min(len(value['heavy_builds']),10000)
        if len(self.samples)<2:self.samples.append(safe)
    def parent_facts(self,value):
        self.parent={'present':value.get('state')=='present','uid_matches_owner':value.get('uid')==os.getuid(),'pid_present':type(value.get('pid')) is int,'birth_present':bool(value.get('birth')),'argv_present':bool(value.get('command')),'executable_present':bool(value.get('executable'))}
    def __exit__(self,kind,error,trace):
        stage=self.stage if self.stage in STAGES else 'unknown'
        codes=[]
        if error is not None:
            if isinstance(error,guard.GuardError):
                message=str(error)
                if message in KNOWN:codes=[KNOWN[message]]
                elif message.startswith('No startup: '):
                    candidates=message[len('No startup: '):].split(',')
                    codes=sorted(set(candidates)) if candidates and all(c in RESOURCE for c in candidates) else ['guard_check_failed']
                else:codes=['guard_check_failed']
            elif isinstance(error,subprocess.TimeoutExpired):codes=['process_check_timeout']
            elif isinstance(error,subprocess.SubprocessError):codes=['process_check_failed']
            elif isinstance(error,OSError):codes=['io_or_path_unavailable']
            elif isinstance(error,(ValueError,TypeError,KeyError)):codes=['input_validation_failed']
            else:codes=['prestart_check_failed']
        receipt={'at':guard.utc(),'status':'prestart_refused' if error else 'prestart_admitted','stage':stage,'reason_codes':codes,'samples':self.samples,'parent':self.parent,'native_datadir_created':False,'new_samples_collected_by_diagnostics':False}
        path=self.directory/'receipt.json';guard.save_new(path,receipt)
        fd=os.open(self.directory,os.O_RDONLY)
        try:os.fsync(fd)
        finally:os.close(fd)
        if error is not None:raise PrestartRefused(path,stage,codes) from None
        return False
