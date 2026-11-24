import * as T from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

export function buildInterior(host, read) {
  const scene=new T.Scene();
  scene.background=new T.Color(0x121d29);
  scene.fog=new T.FogExp2(0x121d29,.012);
  const renderer=new T.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=T.PCFSoftShadowMap;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.22;
  renderer.domElement.setAttribute('aria-label','Interactive 3D model of Building B and the simulated HOUND rover');
  host.prepend(renderer.domElement);
  const camera=new T.PerspectiveCamera(42,1,.08,200);
  const material=(color,other={})=>new T.MeshStandardMaterial({color,roughness:.78,...other});
  const concrete=material(0x9aa9ac), footing=material(0x52626c), steel=material(0x353f4b,{metalness:.4});
  const glass=material(0x77b4c7,{transparent:true,opacity:.33,depthWrite:false,roughness:.28});
  const trim=material(0x55798d), door=material(0x627f85), wood=material(0x8f7360);
  const safety=material(0xc49f54), rubble=[material(0x879099),material(0x686560),material(0x5b6a76)];
  const cyan=material(0x5bb4d1,{emissive:0x348bab,emissiveIntensity:1});
  function box(parent,w,h,d,x,y,z,mat,cast=true) {
    const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),mat);
    mesh.position.set(x,y,z);mesh.castShadow=cast;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  const loc=p=>[(p[0]-420)*.063,(p[1]-395)*.063];
  const light=new T.HemisphereLight(0xd3e9ff,0x66716e,2.15);scene.add(light);
  const sun=new T.DirectionalLight(0xffe3bd,3.1);
  sun.position.set(-24,35,14);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-24,right:24,top:28,bottom:-28,near:1,far:75});
  sun.shadow.normalBias=.025;scene.add(sun);
  const fill=new T.DirectionalLight(0x92c7ff,.72);fill.position.set(18,12,-24);scene.add(fill);

  const textureCanvas=document.createElement('canvas');
  textureCanvas.width=textureCanvas.height=256;
  const pattern=textureCanvas.getContext('2d');
  pattern.fillStyle='#59686d';pattern.fillRect(0,0,256,256);
  for(let i=0;i<5800;i++){
    const x=(i*73.63)%256,y=(i*101.27)%256;
    pattern.fillStyle=i%3?'#80918b35':'#2130343d';pattern.fillRect(x,y,i%4+1,i%3+1);
  }
  pattern.strokeStyle='#394a50';pattern.lineWidth=2;pattern.strokeRect(0,0,256,256);
  const texture=new T.CanvasTexture(textureCanvas);
  texture.colorSpace=T.SRGBColorSpace;
  texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(21,23);texture.anisotropy=8;
  const floor=material(0xbec9c8,{map:texture});
  box(scene,42,.26,43,0,-.37,1,footing);
  box(scene,40,.24,41,0,-.12,1,floor);
  const underlay=new T.Mesh(new T.PlaneGeometry(180,180),material(0x273a46));
  underlay.rotation.x=-Math.PI/2;underlay.position.y=-.51;underlay.receiveShadow=true;scene.add(underlay);
  const grid=new T.GridHelper(100,50,0x4e6878,0x344957);grid.position.y=-.5;scene.add(grid);

  function wall(x1,z1,x2,z2,{windows=false,height=2.8}={}) {
    const length=Math.hypot(x2-x1,z2-z1), group=new T.Group();
    group.position.set((x1+x2)/2,0,(z1+z2)/2);
    group.rotation.y=-Math.atan2(z2-z1,x2-x1);
    scene.add(group);
    if (windows) {
      box(group,length,.92,.22,0,.46,0,concrete);
      box(group,length,.46,.22,0,height-.23,0,concrete);
      const count=Math.max(2,Math.round(length/2.7));
      const spacing=length/count;
      box(group,length,height-1.38,.06,0,(height+.46)/2,0,glass,false);
      for(let i=0;i<=count;i++)box(group,.22,height,.30,-length/2+spacing*i,height/2,0,steel);
    } else {
      box(group,length,height,.23,0,height/2,0,concrete);
      box(group,length,.09,.28,0,.09,0,trim);
    }
  }
  wall(-20,-18.5,20,-18.5,{windows:true});
  wall(-20,-18.5,-20,16,{windows:true});
  wall(20,-18.5,20,15,{windows:true});
  wall(-20,20,20,20,{height:.4});

  // Open-front rooms keep the simulation route and the rover visible in the cutaway.
  const rooms=[
    {x:-18,z:-15,w:9,d:10,name:'105 · storage'},
    {x:-18,z:-2,w:9,d:9,name:'106 · utilities'},
    {x:9,z:-17,w:9,d:7,name:'112 · search sector'},
    {x:11,z:-5,w:7,d:8,name:'110 · equipment'},
    {x:13,z:7,w:6,d:9,name:'108 · staging'}
  ];
  const labels=[];
  const label=(text,x,z,color='#ddf5fa')=>{
    const c=document.createElement('canvas');c.width=480;c.height=96;
    const ctx=c.getContext('2d');ctx.fillStyle='#10222be8';ctx.fillRect(2,2,476,92);
    ctx.strokeStyle='#87a9b9';ctx.lineWidth=4;ctx.strokeRect(4,4,472,88);
    ctx.fillStyle=color;ctx.font='bold 37px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,240,48,450);
    const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;
    const sprite=new T.Sprite(new T.SpriteMaterial({map,transparent:true,depthTest:false}));
    sprite.position.set(x,.65,z);sprite.scale.set(5.1,1.02,1);scene.add(sprite);labels.push(sprite);
  };
  for(const {x,z,w,d,name} of rooms){
    wall(x,z,x+w,z);
    wall(x+w,z,x+w,z+d,{height:2.2});
    wall(x,z,x,z+d*.61,{height:2.2});
    box(scene,w-.35,.013,d-.36,x+w/2,.01,z+d/2,material(0x546a70),false);
    label(name,x+w/2,z+d*.73);
    box(scene,w*.53,.14,.85,x+w*.46,.89,z+1.05,wood);
    for(const side of [-1,1])box(scene,.12,.82,.65,x+w*.46+side*w*.22,.43,z+1.05,steel);
    for(let i=0;i<3;i++)box(scene,.55,.6+i*.18,.62,x+1.2+i*.64,.3+i*.09,z+2.0,door);
  }
  for(const [x,z] of [[-13,9],[-6,-12],[2,9],[4,-8],[16,-8],[10,15],[-13,14]]){
    box(scene,.45,2.9,.45,x,1.45,z,footing);
    box(scene,.65,.1,.65,x,.06,z,steel);
  }
  for(let i=0;i<56;i++){
    const x=-3.4+(i*1.371)%4.6,z=-8.5+(i*1.873)%3.1;
    const w=.18+(i%5)*.12;
    const piece=box(scene,w,.12+(i%4)*.09,w*.7,x,.09,z,rubble[i%3]);
    piece.rotation.set((i%4)*.13,i*1.7,(i%7)*.09);
  }
  const segment=(a,b,color)=>{
    const [x,z]=loc(a),[u,v]=loc(b);
    const width=Math.hypot(u-x,v-z);
    const item=box(scene,width,.018,.07,(x+u)/2,.038,(z+v)/2,color,false);
    item.rotation.y=-Math.atan2(v-z,u-x);return item;
  };
  const trace=material(0x6e9aab,{emissive:0x203c49});
  const station=[[190,660],[310,570],[530,560],[570,430],[520,290],[430,305],[370,312],[380,312]];
  for(let i=0;i<station.length-1;i++){
    const [x,z]=loc(station[i]);
    box(scene,.22,.038,.22,x,.037,z,cyan,false);segment(station[i],station[i+1],trace);
    if(i<6)label('S'+(i+1),x-.4,z+.46);
  }
  const goal=loc([500,205]);
  const target=new T.Mesh(new T.RingGeometry(.42,.52,40),new T.MeshBasicMaterial({color:0xff986e,side:T.DoubleSide}));
  target.rotation.x=-Math.PI/2;target.position.set(goal[0],.07,goal[1]);target.visible=false;scene.add(target);
  label('112',goal[0],goal[1]-1.15,'#ffdba9');

  const rover=new T.Group();scene.add(rover);
  const body=material(0x41566b,{metalness:.49,roughness:.37});
  const silver=material(0xaab7bc,{metalness:.6,roughness:.34});
  const rubber=material(0x1d242b);
  box(rover,1.48,.19,1.0,0,.37,0,body);
  box(rover,1.24,.08,.87,0,.51,0,silver);
  box(rover,.49,.19,.42,-.28,.64,0,steel);
  box(rover,.12,.91,.12,.32,.98,0,silver);
  box(rover,.29,.14,.39,.36,1.43,0,steel);
  box(rover,.036,.12,.17,.526,1.43,0,cyan);
  box(rover,.16,.16,.38,.51,.76,0,safety);
  box(rover,.035,.12,.33,.61,.76,0,glass);
  const wheels=[];
  for(const x of [-.53,.53])for(const z of [-.53,.53]){
    const assembly=new T.Group();assembly.position.set(x,.25,z);rover.add(assembly);wheels.push(assembly);
    const wheel=new T.Mesh(new T.CylinderGeometry(.25,.25,.15,22),rubber);
    wheel.rotation.x=Math.PI/2;wheel.castShadow=true;assembly.add(wheel);
    const hub=new T.Mesh(new T.CylinderGeometry(.125,.125,.157,18),silver);
    hub.rotation.x=Math.PI/2;assembly.add(hub);
    for(let i=0;i<10;i++){
      const angle=i*Math.PI/5;
      const grip=box(assembly,.11,.042,.16,Math.cos(angle)*.247,Math.sin(angle)*.247,0,steel);
      grip.rotation.z=angle+Math.PI/2;
    }
  }
  for(const z of [-.31,.31])box(rover,.045,.065,.16,.75,.4,z,cyan,false);
  label('HOUND / BUILDING B',-9,16);

  let previousTime=0;
  let drag, angle=.64, tilt=.92, distance=49, follow=false, lastRoute, routeMeshes=[];
  const frameTarget=new T.Vector3(),viewTarget=new T.Vector3(),goalCamera=new T.Vector3();
  function fit(){
    const {width,height}=host.getBoundingClientRect();if(!width||!height)return;
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
  }
  new ResizeObserver(fit).observe(host);fit();
  const canvas=renderer.domElement;
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    drag=[event.clientX,event.clientY];canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!drag)return;
    angle-=(event.clientX-drag[0])*.009;
    tilt=T.MathUtils.clamp(tilt+(event.clientY-drag[1])*.006,.28,1.42);
    drag=[event.clientX,event.clientY];
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{drag=null;});
  canvas.addEventListener('wheel',event=>{
    event.preventDefault();
    distance=T.MathUtils.clamp(distance*Math.exp(event.deltaY*.0014),4,85);
  },{passive:false});
  const followButton=host.querySelector('#interior-follow');
  const overviewButton=host.querySelector('#interior-overview');
  function setCameraMode(on){
    follow=on; distance=on?8:49;tilt=on?.52:.92;
    followButton.setAttribute('aria-pressed',String(on));
    overviewButton.setAttribute('aria-pressed',String(!on));
  }
  followButton.onclick=()=>setCameraMode(true);
  overviewButton.onclick=()=>{angle=.64;setCameraMode(false);};
  host.querySelector('#interior-zoom-in').onclick=()=>{distance=Math.max(4,distance/1.24);};
  host.querySelector('#interior-zoom-out').onclick=()=>{distance=Math.min(85,distance*1.24);};

  function update(time) {
    const delta=previousTime?Math.min(40,time-previousTime):0;previousTime=time;
    if(host.hidden)return;
    const state=read();
    const [x,z]=loc(state.rover);
    rover.position.set(x,0,z);rover.rotation.y=-state.angle*Math.PI/180;
    if(state.moving)wheels.forEach(wheel=>{wheel.rotation.z-=delta*.0024;});
    labels.forEach(label=>label.scale.set(follow?2.25:5.1,follow?.45:1.02,1));
    target.visible=state.found;
    target.scale.setScalar(1+.1*Math.sin(time*.004));
    if(state.route!==lastRoute){
      if(state.route||!state.found){
        routeMeshes.forEach(item=>{scene.remove(item);item.geometry.dispose();});
        routeMeshes=[];
        if(state.route)for(let i=1;i<state.route.length;i++)routeMeshes.push(segment(state.route[i-1],state.route[i],cyan));
      }
      lastRoute=state.route;
    }
    frameTarget.set(follow?x:0,follow?.6:0,follow?z:0);
    viewTarget.lerp(frameTarget,.09);
    goalCamera.set(viewTarget.x+Math.sin(angle)*Math.cos(tilt)*distance,
      viewTarget.y+Math.sin(tilt)*distance,viewTarget.z+Math.cos(angle)*Math.cos(tilt)*distance);
    if(camera.position.lengthSq()<.01)camera.position.copy(goalCamera);
    else camera.position.lerp(goalCamera,.12);
    camera.lookAt(viewTarget);
    renderer.render(scene,camera);
  }
  renderer.setAnimationLoop(update);
}
