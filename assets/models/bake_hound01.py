
import json,struct,sys
R='/Users/rishith/Developer/hound-ultra/'
f=open(R+'assets/models/rover_cad.glb','rb').read()
n=struct.unpack('<I',f[12:16])[0]; j=json.loads(f[20:20+n]); B=f[20+n+8:]
I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
def mul(a,b): return [sum(a[k*4+r]*b[c*4+k] for k in range(4)) for c in range(4) for r in range(4)]
def acc(i):
  a=j['accessors'][i]; v=j['bufferViews'][a['bufferView']]; o=v.get('byteOffset',0)+a.get('byteOffset',0)
  nc={'SCALAR':1,'VEC3':3}[a['type']]; fm={5126:'f',5125:'I',5123:'H'}[a['componentType']]; sz=struct.calcsize(fm)
  assert v.get('byteStride',nc*sz)==nc*sz
  return struct.unpack_from('<%d%s'%(a['count']*nc,fm),B,o)
# material table: rgb (sRGB 0..255), metal, rough, brushed
MT={0:((196,200,204),1,.36,1),1:((20,22,25),0,.55,0),2:((36,40,46),0,.58,0),3:((24,44,78),.7,.38,0),4:((17,18,20),0,.88,0),5:((142,146,150),0,.5,0),6:((14,80,52),0,.5,0),7:((120,24,22),0,.45,0),8:((190,152,72),1,.35,0)}
class M:
  def __init__(s): s.p=[];s.n=[];s.c=[];s.q=[];s.i=[];s.k=0
out={k:M() for k in ('body','carriage','hubA','hubB','roller')}
def put(dst,mesh,T,three=True,ov=None):
  for p in j['meshes'][mesh]['primitives']:
    P=acc(p['attributes']['POSITION']);N=acc(p['attributes']['NORMAL']);X=acc(p['indices'])
    rgb,me,ro,br=ov or MT[p.get('material',0)]
    base=dst.k
    for v in range(len(P)//3):
      x,y,z=P[v*3:v*3+3]; q=[T[r]*x+T[4+r]*y+T[8+r]*z+T[12+r] for r in range(3)]
      x,y,z=N[v*3:v*3+3]; m=[T[r]*x+T[4+r]*y+T[8+r]*z for r in range(3)]
      dst.p+= [q[0],q[2],-q[1]]; dst.n+=[m[0],m[2],-m[1]]
      dst.c+=list(rgb)+[255]; dst.q+=[int(me*255),int(ro*255),int(br*255),255]
    dst.i+=[base+k for k in X]; dst.k+=len(P)//3
SKIP={'o1.35','o1.37','o1.38','o1.39','o1.40','o1.41','o1.42','o1.43','o1.44','o1.45','o1.46','o1.47','o1.48','o1.64','o1.65','o1.66','o1.67','o1.68','o1.75','o1.76','o1.77','o1.78'}
CAR={'o1.73','o1.74'}
WH={'o1.8':'rr','o1.12':'rl','o1.16':'fr','o1.20':'fl'}
wheels={};ROL={};done=set()
def walk(i,T):
  nd=j['nodes'][i]; W=mul(T,nd.get('matrix',I)); nm=nd.get('name')
  if nm in WH:
    key=WH[nm]; rot=W[:]; rot[12:15]=[0,0,0]
    L=[j['nodes'][c] for c in nd['children']]
    rs=[mul(rot,c.get('matrix',I)) for c in L if 'roller' in c['extras']['cadName'] and 'free' in c['extras']['cadName']]
    axis=[rs[0][8],rs[0][9],rs[0][10]]  # top roller axis in CAD axes
    h='hubA' if axis[0]*axis[1]>0 else 'hubB'
    wheels[key]=dict(x=W[12],y=W[13],z=W[14],hub=h,topAxis=axis)
    if h not in done:
      done.add(h)
      for c in L:
        if 'free_roller' in c['extras']['cadName']: continue
        put(out[h],c['mesh'],mul(rot,c.get('matrix',I)),ov=((150,154,158),1,.42,0) if 'side_plate' in c['extras']['cadName'] else None)
    ROL[h]=[dict(p=[m[12],m[14],-m[13]],a=[m[8],m[10],-m[9]]) for m in rs]
    if not out['roller'].k: 
      c=[c for c in L if 'free_roller' in c['extras']['cadName']][0]
      put(out['roller'],c['mesh'],[1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1])  # placeholder orientation fixed below
    return
  if 'mesh' in nd and nm not in SKIP: put(out['carriage' if nm in CAR else 'body'],nd['mesh'],W)
  for c in nd.get('children',[]): walk(c,W)
for r in j['scenes'][0]['nodes']: walk(r,I)
# roller geometry: CAD local axis z. Store raw CAD coords (axis z) for the JS side.
out['roller']=M()
c=[x for x in j['nodes'] if x.get('name')=='o1.8.4'][0]
d=out['roller']; put(d,c['mesh'],I); d.p=[v for k in range(d.k) for v in (d.p[k*3],-d.p[k*3+2],d.p[k*3+1])]; d.n=[v for k in range(d.k) for v in (d.n[k*3],-d.n[k*3+2],d.n[k*3+1])]
blob=b'';meta={'wheels':wheels,'rollers':ROL,'parts':{}}
for m in out.values():
  seen={};P=[];N=[];C=[];Q=[];ix=[]
  for v in m.i:
    key=tuple(round(x,5) for x in m.p[v*3:v*3+3])+tuple(round(x,2) for x in m.n[v*3:v*3+3])+tuple(m.c[v*4:v*4+3])+tuple(m.q[v*4:v*4+3])
    if key not in seen:
      seen[key]=len(seen); P+=m.p[v*3:v*3+3];N+=m.n[v*3:v*3+3];C+=m.c[v*4:v*4+4];Q+=m.q[v*4:v*4+4]
    ix.append(seen[key])
  m.p,m.n,m.c,m.q,m.i,m.k=P,N,C,Q,ix,len(seen)
for k,m in out.items():
  e={'verts':m.k,'tris':len(m.i)//3}
  def add(name,b):
    global blob
    while len(blob)%4: blob+=b'\0'
    e[name]=len(blob); blob+=b
  add('pos',struct.pack('<%df'%len(m.p),*m.p))
  nn=[]
  for v in range(m.k):
    x,y,z=m.n[v*3:v*3+3]; l=(x*x+y*y+z*z)**.5 or 1
    nn+=[max(-127,min(127,round(x/l*127))),max(-127,min(127,round(y/l*127))),max(-127,min(127,round(z/l*127))),0]
  add('nor',struct.pack('<%db'%len(nn),*nn)); add('col',bytes(m.c)); add('pbr',bytes(m.q)); add('idx',struct.pack('<%dH'%len(m.i),*m.i) if m.k<65536 else struct.pack('<%dI'%len(m.i),*m.i)); e['wide']=m.k>=65536
  e['count']=len(m.i)
  xs=m.p[0::3];ys=m.p[1::3];zs=m.p[2::3]; print(k,m.k,len(m.i)//3,[round(min(a),3) for a in (xs,ys,zs)],[round(max(a),3) for a in (xs,ys,zs)])
  meta['parts'][k]=e
h=json.dumps(meta).encode(); h+=b' '*((4-len(h)%4)%4)
open(R+'assets/models/hound01.bin','wb').write(struct.pack('<I',len(h))+h+blob)
print(len(blob),json.dumps(wheels)); print(json.dumps(ROL)[:900])
