# Bakes assets/models/rover_cad.glb (our CAD, metres, Z up) into rover_parts.bin: every CAD part keeps its own node, identical
# meshes are stored once, positions are 16-bit, normals 8-bit. Standard library only:  python3 assets/models/rover_parts.py
import json,struct,os,hashlib
H=os.path.dirname(os.path.abspath(__file__))
f=open(os.path.join(H,'rover_cad.glb'),'rb').read()
n=struct.unpack('<I',f[12:16])[0]; j=json.loads(f[20:20+n]); B=f[20+n+8:]
I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
def mul(a,b): return [sum(a[k*4+r]*b[c*4+k] for k in range(4)) for c in range(4) for r in range(4)]
def acc(i):
  a=j['accessors'][i]; v=j['bufferViews'][a['bufferView']]; o=v.get('byteOffset',0)+a.get('byteOffset',0)
  nc={'SCALAR':1,'VEC3':3}[a['type']]; fm={5126:'f',5125:'I',5123:'H'}[a['componentType']]; sz=struct.calcsize(fm)
  assert v.get('byteStride',nc*sz)==nc*sz
  return struct.unpack_from('<%d%s'%(a['count']*nc,fm),B,o)
blob=bytearray(); meshes=[]; seen={}; raw={}
def pad():
  while len(blob)%4: blob.append(0)
def bake(prim,name):
  P=acc(prim['attributes']['POSITION']); N=acc(prim['attributes']['NORMAL']); X=acc(prim['indices'])
  key={};pos=[];nor=[];idx=[]
  for v in X:
    k=tuple(round(c,6) for c in P[v*3:v*3+3])+tuple(round(c,2) for c in N[v*3:v*3+3])
    if k not in key: key[k]=len(pos)//3; pos+=P[v*3:v*3+3]; nor+=N[v*3:v*3+3]
    idx.append(key[k])
  sig=hashlib.sha1(repr(([round(c,5) for c in pos],idx)).encode()).hexdigest()
  if sig in seen: return seen[sig]
  lo=[min(pos[a::3]) for a in range(3)]; hi=[max(pos[a::3]) for a in range(3)]; ex=[max(h-l,1e-9) for l,h in zip(lo,hi)]
  e=dict(name=name,verts=len(pos)//3,count=len(idx),lo=[round(c,7) for c in lo],ex=[round(c,7) for c in ex]); pad(); e['pos']=len(blob)
  for v in range(0,len(pos),3): blob.extend(struct.pack('<4H',*[round((pos[v+a]-lo[a])/ex[a]*65535) for a in range(3)],0))
  e['nor']=len(blob)
  for v in range(0,len(nor),3):
    l=sum(c*c for c in nor[v:v+3])**.5 or 1
    blob.extend(struct.pack('<4b',*[max(-127,min(127,round(c/l*127))) for c in nor[v:v+3]],0))
  e['idx']=len(blob); assert e['verts']<65536; blob.extend(struct.pack('<%dH'%len(idx),*idx))
  seen[sig]=len(meshes); meshes.append(e); return seen[sig]
nodes=[]
def walk(i,T,par):
  nd=j['nodes'][i]; W=mul(T,nd.get('matrix',I)); nm=(nd.get('extras')or{}).get('cadName') or nd.get('name')
  if 'mesh' in nd:
    for p in j['meshes'][nd['mesh']]['primitives']:
      nodes.append(dict(id=nd.get('name'),name=nm,group=par,mesh=bake(p,nm),mat=p.get('material',0),m=[round(c,6) for c in W]))
  for c in nd.get('children',[]): walk(c,W,nm if par=='' or par.startswith('Mecanum') else par)
for r in j['scenes'][0]['nodes']: walk(r,I,'')
head=json.dumps(dict(units='m',up='z',nodes=nodes,meshes=meshes),separators=(',',':')).encode(); head+=b' '*((-len(head))%4)
out=struct.pack('<I',len(head))+head+bytes(blob)
open(os.path.join(H,'rover_parts.bin'),'wb').write(out)
print(len(out),'bytes',len(nodes),'parts',len(meshes),'meshes',sum(meshes[x['mesh']]['count'] for x in nodes)//3,'triangles')
for k,m in enumerate(meshes):
  if k<26: print(k,m['name'],m['verts'],m['count']//3,[round(c,4) for c in m['lo']],[round(c,4) for c in m['ex']])
print(sorted(set(x['group'] for x in nodes)))
