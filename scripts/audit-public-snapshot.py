"""Inventory and conservative secret/private-identifier scan; not a safety guarantee."""
from pathlib import Path
import hashlib,json,re,sys
root=Path(__file__).resolve().parents[1]
skip={'.git','node_modules','dist','evidence','.sites-runtime','outputs','test-results','__pycache__'}
rules={
'credential':rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)',
'private-deployment-id':rb'(?:appgprj_[a-f0-9]{20,}|appgdep_[a-f0-9]{20,}|plugin_asdk_app_sites_[a-f0-9]{20,})',
'private-contact':rb'[A-Za-z0-9._%+-]+@privaterelay\.appleid\.com',
'internal-path':rb'(?:/workspace/scratch/|/home/agent/)',
}
files=[];findings=[]
for p in sorted(root.rglob('*')):
 rel=p.relative_to(root)
 if any(x in skip for x in rel.parts):continue
 if p.is_symlink():findings.append({'file':str(rel),'kind':'symlink'});continue
 if not p.is_file():continue
 b=p.read_bytes();files.append({'path':str(rel),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
 if p.name.startswith(('.env','.dev.vars')):findings.append({'file':str(rel),'kind':'environment-file'})
 if rel.as_posix()=='scripts/audit-public-snapshot.py':continue
 for kind,pattern in rules.items():
  if re.search(pattern,b):findings.append({'file':str(rel),'kind':kind})
print(json.dumps({'file_count':len(files),'files':files,'findings':findings},indent=2))
sys.exit(bool(findings))
