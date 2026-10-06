import * as THREE from './vendor/three/three.module.min.js';
import {buildSpaceEnvironment,bundledTexture} from './space-environment.js';

// Shared visual engine. Selection callbacks are its only connection to an app.
// Only bundled visual assets load here; no private state, worker execution or model calls.
export const CREW = [
  {id:'scout',title:'Signal scout',color:'#84d9ba'},
  {id:'council',title:'Council core',color:'#b49aff'},
  {id:'writer',title:'Draft engineer',color:'#ffc374'},
  {id:'operator',title:'Application pilot',color:'#83bcff'},
  {id:'researcher',title:'Connection radar',color:'#f993b8'},
  {id:'outreach',title:'Message architect',color:'#8edddc'}
];

export const SYSTEMS = [
  {id:'office',title:'Internship Office',color:'#83bcff',position:[-12,0,-9]},
  {id:'interview',title:'Interview Lab',color:'#b49aff',position:[13,0,-9]},
  {id:'video',title:'Video Studio',color:'#ffc374',position:[-12,0,12]},
  {id:'accounting',title:'Outreach Hub',color:'#84d9ba',position:[13,0,12]}
];

export function createOrbitalScene(host, options={}) {
  const detail = options.mode === 'robot';
  const overview=options.mode==='universe', project=options.project||'office';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setClearColor(0x070d1a,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.02;
  renderer.shadowMap.enabled=!detail;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
  const canvas=renderer.domElement;
  canvas.className='orbital-canvas';
  canvas.setAttribute('aria-label',detail?'3D robot interior; use the component buttons below':overview?'Solar systems; select a station to travel there':'Project space station; select a robot, control room, or jump gate');
  canvas.setAttribute('role','img');
  host.prepend(canvas);
  const camera=new THREE.PerspectiveCamera(36,1,.1,700);
  const startRadius=detail?6.6:overview?68:project==='office'?62:56;
  const startTheta=detail?.08:overview?.08:.36,startPhi=detail?1.32:overview?.68:1.05;
  const target=new THREE.Vector3(0,detail?1.55:-.55,detail||overview?0:3.1);
  let radius=startRadius,theta=startTheta,phi=startPhi;
  let goalRadius=radius,goalTheta=theta,goalPhi=phi;const goalTarget=target.clone();let environmentEffects=null;
  let width=1,height=1,quality='cinematic',disposed=false,frame=0,last=0,elapsed=0;
  let enabled=options.motion!==false&&!reduced.matches, visible=true, dirty=true;
  let pointer=null,hovered=null,selected=options.selected??0;
  let lastShadow=-1,hasRendered=false,lastDraw=0,frames=0,intervalStart=performance.now(),measuredFps=0;
  const mats=new Map(), geos=new Map(), textures=[], picks=[], robots=[], chips=[], pulses=[],instances=[],movingInstances=[],anchors=[],orbiting=[],stellarMaterials=[];
  const world=new THREE.Group();scene.add(world);
  scene.add(new THREE.HemisphereLight(0xc5ddff,0x253955,overview?.045:.6));
  const sun=new THREE.DirectionalLight(0xffe5ba,overview?.025:2.7);sun.position.set(-8,24,12);sun.castShadow=!detail;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-25,right:25,top:24,bottom:-24,near:1,far:100});sun.shadow.bias=-.0005;sun.shadow.normalBias=.035;sun.shadow.needsUpdate=true;scene.add(sun);
  const rim=new THREE.DirectionalLight(0xabc7ff,overview?.03:1.15);rim.position.set(9,5,-8);scene.add(rim);
  function material(color,emissive=false,opacity=1){
    const key=[color,emissive,opacity].join(':');
    if(!mats.has(key))mats.set(key,new THREE.MeshStandardMaterial({color,roughness:.34,metalness:.38,emissive:emissive?color:0,emissiveIntensity:emissive?1.05:0,transparent:opacity<1,opacity}));
    return mats.get(key);
  }
  function geometry(kind,args){const key=kind+args.join(':');if(!geos.has(key))geos.set(key,new THREE[kind](...args));return geos.get(key);}
  function mesh(parent,geo,mat,x=0,y=0,z=0){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);parent.add(m);return m;}
  function box(parent,w,h,d,color,x=0,y=0,z=0,lit=false){return mesh(parent,geometry('BoxGeometry',[w,h,d]),material(color,lit),x,y,z);}
  function round(parent,w,h,d,color,x=0,y=0,z=0,lit=false){
    const key=`round:${w}:${h}:${d}`;
    if(!geos.has(key)){
      const s=new THREE.Shape(),r=Math.min(.24,w*.21,h*.21),l=-w/2,b=-h/2,bevel=Math.min(.055,d*.2,h*.16,w*.16);
      s.moveTo(l+r,b);s.lineTo(l+w-r,b);s.quadraticCurveTo(l+w,b,l+w,b+r);
      s.lineTo(l+w,b+h-r);s.quadraticCurveTo(l+w,b+h,l+w-r,b+h);
      s.lineTo(l+r,b+h);s.quadraticCurveTo(l,b+h,l,b+h-r);
      s.lineTo(l,b+r);s.quadraticCurveTo(l,b,l+r,b);
      const g=new THREE.ExtrudeGeometry(s,{depth:d-bevel*2,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:8});g.translate(0,0,-(d-bevel*2)/2);geos.set(key,g);
    }
    return mesh(parent,geos.get(key),material(color,lit),x,y,z);
  }
  function cylinder(parent,r,h,color,x=0,y=0,z=0,n=24){return mesh(parent,geometry('CylinderGeometry',[r,r,h,n]),material(color),x,y,z);}
  function rod(parent,a,b,color,r=.035,lit=false){
    const p=new THREE.Vector3(...a),q=new THREE.Vector3(...b),delta=q.clone().sub(p);
    const m=mesh(parent,geometry('CylinderGeometry',[r,r,delta.length(),6]),material(color,lit));
    m.position.copy(p.add(q).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return m;
  }
  function label(parent,text,w,x,y,z,color='#c8dcff',h=.42){
    const c=document.createElement('canvas');c.width=512;c.height=96;
    const ctx=c.getContext('2d');ctx.fillStyle='#101b2d';ctx.fillRect(0,0,512,96);
    ctx.strokeStyle='#445772';ctx.lineWidth=3;ctx.strokeRect(3,3,506,90);
    ctx.font='600 46px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,256,50,474);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace; textures.push(t);
    const mat=new THREE.MeshBasicMaterial({map:t,transparent:false});mats.set('label'+textures.length,mat);
    return mesh(parent,geometry('PlaneGeometry',[w,h]),mat,x,y,z);
  }
  const environmentCanvas=document.createElement('canvas');environmentCanvas.width=512;environmentCanvas.height=256;
  const ec=environmentCanvas.getContext('2d'),sky=ec.createLinearGradient(0,0,0,256);sky.addColorStop(0,'#839ab8');sky.addColorStop(.48,'#35445b');sky.addColorStop(1,'#101c31');ec.fillStyle=sky;ec.fillRect(0,0,512,256);
  for(const [x,y,r,color] of [[100,80,80,'#ffefd4'],[380,55,85,'#d6e9ff'],[260,140,55,'#a596d8']]){const g=ec.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'#35445b00');ec.fillStyle=g;ec.fillRect(x-r,y-r,r*2,r*2);}
  const environmentTexture=new THREE.CanvasTexture(environmentCanvas);environmentTexture.colorSpace=THREE.SRGBColorSpace;environmentTexture.mapping=THREE.EquirectangularReflectionMapping;
  const pmrem=new THREE.PMREMGenerator(renderer),environmentTarget=pmrem.fromEquirectangular(environmentTexture);scene.environment=environmentTarget.texture;environmentTexture.dispose();pmrem.dispose();
  const sc=document.createElement('canvas');sc.width=64;sc.height=64;const sx=sc.getContext('2d'),shade=sx.createRadialGradient(32,32,3,32,32,32);shade.addColorStop(0,'#02091bd9');shade.addColorStop(.5,'#02091b60');shade.addColorStop(1,'#02091b00');sx.fillStyle=shade;sx.fillRect(0,0,64,64);
  const shadowTexture=new THREE.CanvasTexture(sc);textures.push(shadowTexture);const shadowMaterial=new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false});mats.set('contact-shadow',shadowMaterial);
  function contact(parent,x,y,z,w,d){const m=mesh(parent,geometry('PlaneGeometry',[w,d]),shadowMaterial,x,y,z);m.rotation.x=-Math.PI/2;return m;}
  function pickGroup(root,data){root.userData.pick=data;root.traverse(o=>{if(o.isMesh){o.userData.pick=data;picks.push(o);}});}
  function bolt(parent,x,y,z){cylinder(parent,.045,.035,'#b8cadb',x,y,z,6).rotation.x=Math.PI/2;}
  function robot(parent,color,id,cutaway=false,interactive=true){
    const g=new THREE.Group();g.userData.dynamic=true;parent.add(g);
    const head=new THREE.Group();head.position.set(0,1.92,0);g.add(head);
    round(head,1.19,.94,.84,color);
    for(const side of [-1,1]){for(let i=0;i<3;i++){const vent=round(head,.045,.16,.025,'#35465f',side*.6,-.1+i*.08,.13);vent.rotation.y=side*Math.PI/2;}for(const y of [-.32,.32])bolt(head,side*.47,y,.439);}
    round(head,.72,.028,.025,'#d5e3f5',0,.435,.25);
    round(head,.96,.69,.075,'#15233b',0,0,.425);
    for(const x of [-.23,.23]){const eye=mesh(head,geometry('SphereGeometry',[.12,16,10]),material('#c7f0ff',true),x,.015,.478);eye.scale.set(.74,1,.3);}
    for(const x of [-.37,.37])round(head,.09,.025,.018,color,x,-.12,.478,true);
    box(head,.15,.028,.025,color,0,-.21,.48,true);
    rod(head,[0,.42,0],[0,.69,0],'#91a4ba',.032);mesh(head,geometry('SphereGeometry',[.09,12,8]),material(color,true),0,.72,0);
    round(head,.14,.26,.24,'#66738c',-.62,0,0);round(head,.14,.26,.24,'#66738c',.62,0,0);
    cylinder(g,.13,.16,'#9dabc0',0,1.38,0);
    cylinder(g,.22,.055,color,0,1.3,0);
    const torso=round(g,.87,.86,.65,'#3e4b63',0,.9,0);
    const moduleColors=['#8edddc','#83bcff','#ffc374','#f993b8'];
    if(cutaway){
      torso.material=material('#303d55');
      box(g,.72,.69,.035,'#101b2d',0,.9,.348);
      const parts=options.modules||['Evidence','Five reviewers','Challenge','Decision'];
      for(let i=0;i<4;i++){
        const x=i%2?.2:-.2,y=i<2?1.1:.71;
        const c=new THREE.Group();c.position.set(x,y,.42);g.add(c);
        round(c,.33,.32,.13,moduleColors[i]);round(c,.27,.26,.018,'#132840',0,0,.082);
        const icon=round(c,.08,.095,.025,moduleColors[i],0,.025,.106,true);
        if(id==='council'&&i===1){round(c,.042,.052,.025,moduleColors[i],-.075,.025,.106,true);round(c,.042,.052,.025,moduleColors[i],.075,.025,.106,true);}
        label(c,parts[i],.27,0,-.085,.11,moduleColors[i],.05);
        pickGroup(c,{type:'module',id:i});chips.push({group:c,icon,baseZ:.42,color:moduleColors[i]});
      }
      // Visible external wiring follows the supplied four-module workflow order.
      rod(g,[-.2,1.29,.4],[.2,1.29,.4],moduleColors[0],.014,true);
      rod(g,[.39,1.1,.4],[.39,.49,.4],moduleColors[1],.014,true);
      rod(g,[.39,.49,.4],[-.2,.49,.4],moduleColors[1],.014,true);
      rod(g,[-.2,.49,.4],[-.2,.55,.4],moduleColors[1],.014,true);
      rod(g,[-.2,.51,.46],[.2,.51,.46],moduleColors[2],.014,true);
      for(let i=0;i<3;i++){const line=new THREE.CubicBezierCurve3(new THREE.Vector3(-.13+i*.07,1.3,.4),new THREE.Vector3(.53+i*.025,1.15,.41),new THREE.Vector3(.56+i*.025,.49,.4),new THREE.Vector3(.05+i*.07,.48,.47));const wire=new THREE.TubeGeometry(line,16,.011,5,false);geos.set('wire-'+i,wire);mesh(g,wire,material(moduleColors[i],true));}
      const panel=new THREE.Group();g.add(panel);panel.position.set(.63,.88,.18);panel.rotation.y=.9;
      round(panel,.39,.79,.075,color);box(panel,.26,.55,.04,'#32445e',0,0,.07);
      for(const x of [-.39,.39])for(const y of [.55,1.26])bolt(g,x,y,.385);
    }else{
      round(g,.64,.58,.07,color,0,.9,.37);round(g,.49,.43,.045,'#163243',0,.91,.422);
      round(g,.17,.16,.03,color,0,.91,.455,true);
      for(let n=0;n<3;n++)round(g,.19,.022,.015,'#abbcd0',0,.62+n*.035,.408);
      for(const x of [-.35,.35])bolt(g,x,.55,.35);
    }
    const arms=[],legs=[];
    for(const side of [-1,1]){
      const arm=new THREE.Group();arm.position.set(side*.55,1.18,0);g.add(arm);
      cylinder(arm,.11,.14,'#7e8fa8',0,0,0,8).rotation.z=Math.PI/2;
      round(arm,.21,.4,.23,color,side*.08,-.26,.02);round(arm,.2,.15,.25,'#7489a1',side*.07,-.53,.04);mesh(arm,geometry('SphereGeometry',[.105,12,8]),material('#253950'),side*.07,-.49,.05);
      round(arm,.23,.19,.23,color,side*.07,-.66,.06);arms.push(arm);
      const leg=new THREE.Group();leg.position.set(side*.23,.4,0);g.add(leg);
      cylinder(leg,.07,.16,'#8d9eb6');
      round(leg,.23,.3,.27,'#708099',0,-.18,0);round(leg,.15,.12,.035,'#acbccb',0,-.18,.163);
      round(leg,.34,.16,.44,color,0,-.355,.07);legs.push(leg);
    }
    const bot={group:g,head,arms,legs,baseY:0,baseX:0,baseZ:0,id,color};robots.push(bot);
    g.traverse(o=>{if(o.isMesh&&!o.material.transparent)o.castShadow=true;});
    if(!cutaway&&interactive)pickGroup(g,{type:'robot',id});return bot;
  }
  function deck(parent,w,d,h,cut,color,x=0,y=0,z=0){
    const key=`deck:${w}:${d}:${h}:${cut}`;
    if(!geos.has(key)){const a=w/2,b=d/2,shape=new THREE.Shape();shape.moveTo(-a+cut,-b);for(const v of [[a-cut,-b],[a,-b+cut],[a,b-cut],[a-cut,b],[-a+cut,b],[-a,b-cut],[-a,-b+cut]])shape.lineTo(...v);shape.closePath();const bevel=Math.min(.08,h*.22),geo=new THREE.ExtrudeGeometry(shape,{depth:h-bevel*2,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:1});geo.translate(0,0,-(h-bevel*2)/2);geos.set(key,geo);}
    const m=mesh(parent,geos.get(key),material(color),x,y,z);m.rotation.x=-Math.PI/2;return m;
  }
  function machinery(parent,x,y,z,w=1.1){
    round(parent,w,.72,.26,'#394b64',x,y,z);round(parent,w*.78,.5,.045,'#1a2b41',x,y,z+.16);
    for(let i=0;i<3;i++)round(parent,w*.56,.045,.02,'#71849c',x,y-.13+i*.12,z+.19);
    round(parent,.09,.15,.023,'#ffd09a',x-w*.36,y+.05,z+.2,true);
    for(const side of [-1,1])bolt(parent,x+side*w*.4,y-.26,z+.17);
  }
  function platform(parent,r,x,y,z,title){
    const p=new THREE.Group();p.position.set(x,y,z);parent.add(p);
    const w=r>6?15:r*2.08,d=r>6?11.7:r*1.73,cut=r>6?1.25:.6;p.userData.deck=[w,d];
    deck(p,w,d,r>6?1.45:.95,cut,'#334158',0,r>6?-.7:-.45,0);deck(p,w*.99,d*.99,.12,cut,'#8e9bad',0,.01,0);
    const floor=deck(p,w-1.0,d-1.0,.065,cut*.8,'#747e8c',0,.104,0);floor.receiveShadow=true;floor.material.roughness=.77;floor.material.metalness=.18;
    deck(p,w*.78,d*.77,.34,cut,'#18283e',0,r>6?-1.54:-1.05,0);
    for(const side of [-1,1]){
      for(let i=-1;i<=1;i++){const xx=i*w*.24;round(p,w*.18,.08,.065,'#ffc787',xx,-.18,side*(d/2+.04),true);round(p,.2,.65,.18,'#6d7c91',xx+w*.1,-.47,side*d/2);}
      for(let i=-1;i<=1;i++){const part=machinery(p,side*(w/2+.03),-.57,i*d*.22,Math.min(1.2,d*.2));}
    }
    const banner=round(p,w*.65,1.0,.13,'#22354e',0,-.58,d/2+.12);round(p,w*.61,.78,.045,'#152740',0,-.58,d/2+.205);
    if(title){label(p,title,w*.59,0,-.46,d/2+.24,'#bddfff',.57);label(p,title==='INTERNSHIP OFFICE'?'IDEAS → APPLICATIONS → OPPORTUNITIES':'YOUR SYSTEMS / ONE WORLD',w*.52,0,-.81,d/2+.245,'#7298bd',.15);}
    for(const side of [-1,1])for(const xx of [-w*.35,w*.35])bolt(p,xx,-.23,d/2+.12);
    if(r>6){for(let n=-2;n<=2;n++){const seam=box(p,12.0,.009,.02,'#9aa8ba',0,.144,n*1.74);}for(const xx of [-4.55,4.55])rod(p,[xx,.145,-3.7],[xx,.145,3.7],'#b5a082',.012);}
    return p;
  }
  function railing(p,a,b){
    rod(p,a,b,'#7f92ac',.048);
    for(let n=0;n<=3;n++){const t=n/3,x=a[0]+(b[0]-a[0])*t,z=a[2]+(b[2]-a[2])*t;rod(p,[x,a[1]-.5,z],[x,a[1],z],'#516980',.045);}
  }
  function bridge(a,b){
    const p=new THREE.Vector3(...a),q=new THREE.Vector3(...b),length=p.distanceTo(q),center=p.clone().add(q).multiplyScalar(.5);
    const g=new THREE.Group();g.position.copy(center);g.rotation.y=Math.atan2(b[0]-a[0],b[2]-a[2]);world.add(g);
    box(g,1,.18,length,'#6d8099',0,0,0);box(g,.05,.025,length,'#8edddc',-.38,.11,0,true);box(g,.05,.025,length,'#8edddc',.38,.11,0,true);
    for(const side of [-1,1])railing(g,[side*.5,.65,-length/2],[side*.5,.65,length/2]);
    for(let z=-length/2;z<length/2;z+=.7)box(g,.92,.02,.06,'#425873',0,.11,z);
  }
  function desk(p,x,z,bot,i){
    const g=new THREE.Group();g.position.set(x,0,z);p.add(g);
    round(g,1.8,.13,.8,'#d1cbc0',0,.9,1.1);round(g,1.59,.78,.68,'#46566f',0,.45,1.12);
    contact(p,x,.113,z+.4,2.6,2.4);
    for(let n=0;n<3;n++)box(g,.18,.065,.018,bot.color,-.64,.45+n*.13,1.47,true);
    const monitor=round(g,.63,.47,.065,'#303d53',.34,1.25,1.25);monitor.rotation.y=Math.PI;
    const screen=round(g,.53,.36,.02,bot.color,.34,1.25,1.205,true);screen.rotation.y=Math.PI;
    box(g,.04,.17,.04,'#8795a7',.34,1,1.25);box(g,.3,.025,.2,'#8293ad',.34,.99,1.2);
    box(g,.6,.035,.19,'#a3b0bf',-.32,.99,1.03);
    for(let n=0;n<3;n++)box(g,.4,.005,.015,'#53627a',-.32,1.015,1+n*.04);
    cylinder(g,.09,.16,'#f3c27e',-.62,1.045,.89,10);
    bot.group.position.set(x,.17,z+.03);bot.baseY=.17;bot.baseX=x;bot.baseZ=z+.03;
    if(i===1){cylinder(p,.78,.02,'#b49aff',x,.12,z+.17,24);}
    label(p,CREW[i].title,2.1,x,.53,z+1.54,bot.color,.32);
  }
  function studio(){
    const p=platform(world,4.1,0,-2.6,10,'DELIVERY STUDIO');
    round(p,6.9,2.4,.4,'#626d7e',0,1.37,-1.84);round(p,7.1,.3,.85,'#a0a7b1',0,2.66,-1.7);contact(p,0,.15,0,7,5);
    for(const x of [-3.1,3.1]){round(p,.43,2.4,2.6,'#6c798e',x,1.37,-.75);round(p,.12,1.65,.045,'#ffc787',x,1.47,.62,true);machinery(p,x,1.45,.61,.35);}
    for(const x of [-2.1,0,2.1]){round(p,1.65,1.35,.07,'#34485f',x,1.65,-1.58);round(p,1.4,.075,.06,'#ffd395',x,2.3,-1.52,true);}
    round(p,5.45,.16,1.88,'#263b50',0,.34,1.04);
    for(let n=-6;n<=6;n++)cylinder(p,.075,1.72,'#8ba1b1',n*.41,.47,1.05,10).rotation.x=Math.PI/2;
    for(let i=0;i<3;i++){const crate=new THREE.Group();crate.position.set((i-1)*1.73,1.05,1.05);p.add(crate);round(crate,1.29,1.11,1.04,['#57978c','#c18e54','#b9698c'][i]);for(const x of [-.56,.56]){round(crate,.085,1.02,.045,'#a9bbc9',x,0,.55);for(const y of [-.43,.43])bolt(crate,x,y,.6);}round(crate,.48,.065,.12,'#3b516a',0,.59,0);for(const x of [-.19,.19])rod(crate,[x,.59,0],[x,.67,0],'#a7b8ca',.022);rod(crate,[-.19,.67,0],[.19,.67,0],'#a7b8ca',.022);label(crate,['Finished','In progress','Not cleared'][i],1.03,0,0,.59,'#edf6ff',.24);}
    label(p,'BUILD / REFINE / DELIVER',3.8,0,2.18,-1.57,'#ffc374',.3);
    for(let i=0;i<3;i++)mesh(p,geometry('SphereGeometry',[.07,12,8]),material(['#9fe8c8','#ffd07e','#f38eaa'][i],true),2.75+i*.13,.55,.73);
    const light=new THREE.PointLight(0xffbb6f,12,9,2);light.position.set(0,2.55,-.2);p.add(light);p.userData.warmLight=light;
    pickGroup(p,{type:'delivery',id:'all'});
  }
  function district(x,z,title,color,kind){
    const p=platform(world,2.9,x,-.1,z,title);
    round(p,4.45,3.0,.4,'#566a81',0,1.66,-1.54);round(p,4.7,.26,.74,'#98a8bb',0,3.23,-1.42);
    for(const xx of [-2.08,2.08]){round(p,.39,2.98,1.48,'#60718a',xx,1.66,-1.05);round(p,.095,1.78,.045,'#ffd08d',xx,1.73,-.25,true);}
    round(p,2.04,1.55,.14,'#253c57',.48,1.91,-1.29);round(p,1.85,1.35,.04,color,.48,1.91,-1.2,true);round(p,1.73,1.23,.045,'#10283f',.48,1.91,-1.15);
    if(kind==='video'){const shape=new THREE.Shape();shape.moveTo(-.28,-.29);shape.lineTo(.31,0);shape.lineTo(-.28,.29);shape.closePath();const geo=new THREE.ShapeGeometry(shape);geos.set('play',geo);mesh(p,geo,material(color,true),.48,1.95,-1.11);}
    else if(kind==='interview'){round(p,.88,.55,.025,color,.48,1.98,-1.1,true);round(p,.8,.47,.027,'#10283f',.48,1.98,-1.08);for(let i=0;i<3;i++)mesh(p,geometry('SphereGeometry',[.057,10,6]),material(color,true),.28+i*.2,1.99,-1.04);}
    else{const flap=rod(p,[.08,1.78,-1.07],[.48,2.04,-1.07],color,.027,true);rod(p,[.48,2.04,-1.07],[.88,1.78,-1.07],color,.027,true);}
    round(p,1.36,.11,.73,'#bbc4d0',-.84,.84,.84);round(p,1.12,.71,.66,'#405773',-.84,.44,.86);machinery(p,-.84,.49,1.22,.7);
    const bot=robot(p,color,kind+'-studio',false,false);bot.group.scale.setScalar(.7);bot.group.position.set(-.84,.16,.03);bot.baseX=-.84;bot.baseY=.16;bot.baseZ=.03;
    cylinder(p,.36,.21,'#435a77',1.76,.28,-.65);rod(p,[1.76,.37,-.65],[1.76,3.88,-.65],'#97adc4',.042);mesh(p,geometry('SphereGeometry',[.095,12,8]),material('#ffc787',true),1.76,3.92,-.65);
    if(kind==='outreach'){const dish=mesh(p,geometry('SphereGeometry',[.64,20,12,0,Math.PI*2,0,Math.PI*.42]),material('#c4b3a1'),-1.4,3.48,-1.2);dish.rotation.z=-.68;rod(p,[-1.4,3.5,-1.2],[-1.73,4.05,-1.2],'#94abc0',.025);}
    if(kind==='video'){round(p,.5,.32,.45,'#354e6b',1.36,1.16,.88);cylinder(p,.13,.16,'#7db8d8',1.36,1.17,1.16).rotation.x=Math.PI/2;for(const a of [-1,1])rod(p,[1.36,.99,.88],[1.36+a*.27,.15,.9],'#8094aa',.026);}
    machinery(p,-1.5,3.12,-1.15,.42);contact(p,0,.15,0,4.6,3.8);
    pickGroup(p,{type:'district',id:kind,title});return p;
  }

  function jumpGate(x,z){
    const g=new THREE.Group();g.position.set(x,.1,z);world.add(g);
    const pad=platform(g,1.8,0,0,0,'JUMP GATE');
    for(const [r,c] of [[1.22,'#526a8c'],[1.03,'#9ee9ff']]){const ring=mesh(pad,geometry('TorusGeometry',[r,.09,12,96]),material(c,r<1.1),0,1.65,0);ring.rotation.y=.2;}
    const portal=mesh(pad,geometry('CircleGeometry',[.94,64]),material('#86baff',true,.14),0,1.65,0);portal.rotation.y=.2;
    for(const side of [-1,1])round(pad,.34,1.2,.48,'#667b95',side*1.1,.6,0);
    label(pad,'SOLAR SYSTEMS',2.3,0,.28,1.62,'#b5e5ff',.26);
    pickGroup(pad,{type:'starmap',id:'map',title:'Jump gate'});
    anchors.push({id:'gate',position:new THREE.Vector3(x,.15,z+2)});
  }
  function controlRoom(x,z,id='office'){
    const p=platform(world,2.7,x,-.25,z,id==='office'?'MISSION CONTROL':'STATION CONTROL');
    round(p,3.8,1.8,.35,'#526780',0,1,-1);
    round(p,3.4,1.36,.06,'#101d32',0,1.13,-.79);
    for(let n=0;n<3;n++){round(p,.78,.62,.04,['#84d9ba','#83bcff','#b49aff'][n],(n-1)*1.02,1.2,-.73,true);round(p,.64,.46,.035,'#1a3045',(n-1)*1.02,1.2,-.68);}
    round(p,3.3,.15,1.1,'#aebdca',0,.7,.45);machinery(p,0,.4,1.03,2.8);
    pickGroup(p,{type:'workspace',id,title:'Station control'});
    anchors.push({id:'control',position:new THREE.Vector3(x,.2,z+2.4)});
  }
  function stationStructure(id){
    // The exposed work deck is a cutaway into a larger pressurized station.
    const root=new THREE.Group();world.add(root);
    const accent=(SYSTEMS.find(s=>s.id===id)||SYSTEMS[0]).color;
    const c=document.createElement('canvas');c.width=c.height=512;const cx=c.getContext('2d');cx.fillStyle='#a9adb2';cx.fillRect(0,0,512,512);
    for(let n=0;n<512;n++){cx.fillStyle=`rgba(${n%3?255:22},${n%3?255:29},${n%3?255:36},${.015+(n%7)*.006})`;cx.fillRect(0,n,512,1);}
    for(let n=0;n<4;n++){cx.strokeStyle='#7c828a';cx.lineWidth=1;cx.strokeRect(n*128+3,4,122,503);cx.fillStyle='#d4d6d8';for(const y of [12,496])for(const x of [n*128+10,n*128+115])cx.fillRect(x,y,3,3);}
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;textures.push(texture);
    const alloy=new THREE.MeshStandardMaterial({color:'#c2c5c9',map:texture,bumpMap:texture,bumpScale:.023,metalness:.72,roughness:.43});mats.set('station-alloy',alloy);
    const dark=new THREE.MeshStandardMaterial({color:'#414853',metalness:.83,roughness:.35});mats.set('station-dark-alloy',dark);
    const hull=(parent,r,length,x,y,z)=>{
      const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);
      const body=mesh(g,geometry('CylinderGeometry',[r,r,length,48]),alloy);body.rotation.x=Math.PI/2;body.castShadow=true;
      for(const side of [-1,1]){const cap=mesh(g,geometry('SphereGeometry',[r,40,24]),alloy,0,0,side*length/2);cap.scale.z=.38;for(const d of [.18,.45])mesh(g,geometry('TorusGeometry',[r+.035,.055,8,48]),dark,0,0,side*(length/2-d));}
      for(let n=-1;n<=1;n++)mesh(g,geometry('TorusGeometry',[r+.02,.035,6,48]),dark,0,0,n*length*.27);
      for(const side of [-1,1])for(let n=0;n<5;n++){const angle=side*.78,x=Math.sin(angle)*(r+.02),y=Math.cos(angle)*(r+.02),window=round(g,.45,.24,.04,'#243b50',x,y,(n-2)*length*.15);window.rotation.x=-Math.PI/2;window.rotation.y=-angle;round(g,.26,.075,.035,accent,x,y+.015,(n-2)*length*.15,true).rotation.x=-Math.PI/2;}
      return g;
    };
    // Layered pressure hull, front docking/service nodes, and a habitat ring.
    hull(root,2.4,13,0,-3.05,-.8);
    for(const side of [-1,1]){hull(root,1.35,8,side*10.8,-1.9,-4.7);hull(root,.85,5,side*7.8,-3.4,7.1);}
    const ring=mesh(root,geometry('TorusGeometry',[8.65,.62,16,128]),alloy,0,-3.2,-.7);ring.rotation.x=Math.PI/2;ring.castShadow=true;
    const rib=mesh(root,geometry('TorusGeometry',[8.65,.065,8,128]),dark,0,-2.56,-.7);rib.rotation.x=Math.PI/2;
    for(let n=0;n<12;n++){const a=n*Math.PI/6,x=Math.sin(a)*8.65,z=-.7+Math.cos(a)*8.65;rod(root,[x,-3.2,z],[0,-3.2,-.7],'#546373',.11);const window=round(root,.63,.05,.22,accent,x,-2.55,z,true);window.rotation.y=a;}
    for(const side of [-1,1]){
      // Docking collars face the arrival camera, with concentric seals and latches.
      const dock=hull(root,1.15,2.3,side*10.8,-1.9,.75);
      for(const [r,z] of [[1.2,1.28],[.99,1.4],[.78,1.49]])mesh(dock,geometry('TorusGeometry',[r,.095,12,64]),r===.99?dark:alloy,0,0,z);
      mesh(dock,geometry('CircleGeometry',[.76,48]),dark,0,0,1.51);
      for(let n=0;n<8;n++){const a=n*Math.PI/4;round(dock,.13,.27,.22,'#8c949f',Math.sin(a)*1.2,Math.cos(a)*1.2,1.3).rotation.z=-a;}
      round(dock,.4,.055,.035,accent,0,.5,1.54,true);
      // Open-web aluminum trusses carry wings without hiding the working deck.
      for(const y of [-1.7,-2.65])for(const z of [-7.1,-5.9])rod(root,[side*6.5,y,z],[side*22,y,z],'#8c99a7',.07);
      for(let n=0;n<8;n++){const x=side*(7+n*2);for(const z of [-7.1,-5.9]){rod(root,[x,-1.7,z],[x+side*2,-2.65,z],'#748496',.045);rod(root,[x,-2.65,z],[x+side*2,-1.7,z],'#748496',.045);}rod(root,[x,-1.7,-7.1],[x,-1.7,-5.9],'#8c99a7',.06);}
      const array=new THREE.Group();array.position.set(side*17,-1.85,-6.5);array.rotation.z=side*.12;root.add(array);
      const solar=new THREE.MeshStandardMaterial({color:'#132841',metalness:.68,roughness:.26});mats.set('solar-array-'+side,solar);
      for(const row of [-1,1])for(let n=0;n<5;n++){
        const x=(n-2)*1.88,z=row*3.6;mesh(array,geometry('BoxGeometry',[1.75,.07,5.9]),solar,x,0,z);
        for(const edge of [-1,1])rod(array,[x+edge*.9,.055,z-3],[x+edge*.9,.055,z+3],'#a3a6ad',.024);
        for(let cell=0;cell<12;cell++)box(array,1.74,.008,.018,'#596e86',x,.045,z-2.75+cell*.5);
        for(const cell of [-.29,.29])box(array,.013,.008,5.86,'#596e86',x+cell,.045,z);
      }
      // White radiator vanes and articulated service plumbing sit behind the rooms.
      const radiators=new THREE.Group();radiators.position.set(side*6.2,.2,-10.8);radiators.rotation.x=-.48;root.add(radiators);
      for(let n=0;n<3;n++){const p=mesh(radiators,geometry('BoxGeometry',[1.15,.07,4.8]),alloy,(n-1)*1.3,0,0);for(let fin=0;fin<12;fin++)box(radiators,1.1,.012,.025,'#838b95',(n-1)*1.3,.045,-2.2+fin*.4);}
      rod(root,[side*6,-2,-7],[side*6,.1,-11],'#8996a5',.13);
      // Engine bells: restrained light inside, not neon hull trim.
      for(const x of [side*3.25,side*4.6]){mesh(root,geometry('CylinderGeometry',[.32,.6,1.15,32,1,true]),dark,x,-5.0,4.3);const bell=mesh(root,geometry('TorusGeometry',[.6,.055,8,40]),alloy,x,-5.57,4.3);bell.rotation.x=Math.PI/2;const core=mesh(root,geometry('CircleGeometry',[.38,32]),material('#7392ba',true),x,-5.5,4.3);core.rotation.x=Math.PI/2;}
    }
    const mast=new THREE.Group();mast.position.set(0,3.0,-7.8);root.add(mast);rod(mast,[0,0,0],[0,3.7,0],'#afbbc8',.055);
    const dish=mesh(mast,geometry('SphereGeometry',[1.1,40,20,0,Math.PI*2,0,.95]),alloy,0,2.0,0);dish.rotation.x=-.65;dish.scale.y=.42;
    rod(mast,[0,2.6,.15],[0,3.3,.6],'#6f8298',.04);mesh(mast,geometry('SphereGeometry',[.09,12,8]),material('#eea68d',true),0,3.55,0);
    for(const side of [-1,1]){const conduit=new THREE.CatmullRomCurve3([new THREE.Vector3(side*3,-2,-5),new THREE.Vector3(side*6,-2.2,-7),new THREE.Vector3(side*9,-1,-7)]);const geo=new THREE.TubeGeometry(conduit,24,.09,8,false);geos.set('service-conduit'+side,geo);mesh(root,geo,dark);}
  }
  function planetMaterial(kind){
    const key='planet-material:'+kind;if(mats.has(key))return mats.get(key);
    const c=document.createElement('canvas');c.width=1024;c.height=512;const ctx=c.getContext('2d'),im=ctx.createImageData(c.width,c.height);
    const palettes={rock:[95,89,80],mars:[154,81,47],ocean:[12,42,86],gas:[153,128,100]};
    const base=palettes[kind]||palettes.rock;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const u=x/c.width,v=y/c.height,lon=u*Math.PI*2,sx=Math.cos(lon)*Math.sin(v*Math.PI),sy=Math.cos(v*Math.PI),sz=Math.sin(lon)*Math.sin(v*Math.PI);
      const fine=Math.sin(sx*179+sy*93+sz*129)*Math.cos(sy*187+sz*97+sx*57),terrain=Math.sin(sx*11+Math.sin(sy*16+sz*7))*Math.cos(sz*17+sy*11),band=Math.sin(v*119+Math.sin(u*28)*.65+terrain*2),i=(y*c.width+x)*4;
      const variation=kind==='gas'?band*15+terrain*14:terrain*26+fine*12;
      const crater=kind==='rock'?Math.pow(Math.max(0,Math.sin(sx*47+sy*39+sz*53)*Math.cos(sz*41-sy*31)),12)*48:0;
      for(let k=0;k<3;k++)im.data[i+k]=base[k]+variation-crater;im.data[i+3]=255;
    }ctx.putImageData(im,0,0);
    if(kind==='rock'||kind==='mars')for(let n=0;n<180;n++){const x=((n*7919)%1024),y=28+(n*1543)%456,r=2+(n%11)*1.15;const crater=ctx.createRadialGradient(x-r*.2,y-r*.2,r*.1,x,y,r);crater.addColorStop(0,'#18171855');crater.addColorStop(.64,'#24222088');crater.addColorStop(.79,'#e3d3b54a');crater.addColorStop(1,'#8a7d6d00');ctx.fillStyle=crater;ctx.fillRect(x-r,y-r,r*2,r*2);}
    if(kind==='gas'){const storm=ctx.createRadialGradient(680,315,3,680,315,50);storm.addColorStop(0,'#975c32cc');storm.addColorStop(.56,'#dba97680');storm.addColorStop(1,'#d9b88d00');ctx.save();ctx.translate(680,315);ctx.scale(1,.46);ctx.translate(-680,-315);ctx.fillStyle=storm;ctx.fillRect(628,263,104,104);ctx.restore();}
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture);
    const m=new THREE.MeshStandardMaterial({map:texture,bumpMap:kind==='rock'||kind==='mars'?texture:null,bumpScale:.055,roughness:kind==='ocean'?.63:.95,metalness:0});mats.set(key,m);
    if(kind==='ocean')bundledTexture('./assets/earth-blue-marble.jpg',t=>{if(disposed){t.dispose();return;}t.colorSpace=THREE.SRGBColorSpace;textures.push(t);m.map=t;m.needsUpdate=true;dirty=true;schedule();});
    return m;
  }
  function stellarMaterial(i,color){
    const m=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uColor:{value:new THREE.Color(color)}},vertexShader:`varying vec3 vP;varying vec3 vN;varying vec3 vV;void main(){vP=position;vec4 p=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,fragmentShader:`varying vec3 vP;varying vec3 vN;varying vec3 vV;uniform float uTime;uniform vec3 uColor;float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}void main(){vec3 p=normalize(vP);float gran=noise(p*49.+uTime*.023),cell=noise(p*19.-uTime*.01),spots=smoothstep(.76,.89,noise(p*7.));float limb=.45+.55*pow(max(0.,dot(normalize(vN),normalize(vV))),.45);vec3 hot=mix(uColor*vec3(1.,.38,.06),uColor,gran*.8);gl_FragColor=vec4(hot*(1.15+cell*.8)*(1.-spots*.8)*limb,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`});mats.set('stellar-surface'+i,m);stellarMaterials.push(m);return m;
  }
  function solarSystems(){
    SYSTEMS.forEach((s,i)=>{
      const g=new THREE.Group();g.position.set(...s.position);g.rotation.set([-.1,.16,-.19,.08][i],i*.12,[.08,-.12,.1,-.07][i]);world.add(g);
      const starColor=['#ffd6a3','#fff1c8','#c9e0ff','#ffb675'][i];
      const star=mesh(g,geometry('SphereGeometry',[1.35,64,40]),stellarMaterial(i,starColor),-1.1,.55,0);
      const haloMaterial=new THREE.SpriteMaterial({color:starColor,transparent:true,opacity:.75,blending:THREE.AdditiveBlending,depthWrite:false});mats.set('solar-halo'+i,haloMaterial);
      const c=document.createElement('canvas');c.width=c.height=256;const cx=c.getContext('2d'),gradient=cx.createRadialGradient(128,128,0,128,128,128);gradient.addColorStop(0,'#ffffff00');gradient.addColorStop(.22,'#ffffff00');gradient.addColorStop(.29,'#ffffffb0');gradient.addColorStop(.4,'#ffffff35');gradient.addColorStop(.72,'#ffffff09');gradient.addColorStop(1,'#ffffff00');cx.fillStyle=gradient;cx.fillRect(0,0,256,256);const t=new THREE.CanvasTexture(c);textures.push(t);haloMaterial.map=t;
      const glow=new THREE.Sprite(haloMaterial);glow.position.copy(star.position);glow.scale.set(9,9,1);g.add(glow);
      const light=new THREE.PointLight(starColor,105,25,2);light.position.copy(star.position);g.add(light);
      // Small magnetic prominences follow the stellar surface instead of a flat glow disc.
      for(let n=0;n<5;n++){const a=n*1.27+i*.4,axis=new THREE.Vector3(Math.cos(a),Math.sin(a),.3).normalize(),tangent=new THREE.Vector3(-axis.y,axis.x,0).normalize();const curve=new THREE.CubicBezierCurve3(axis.clone().multiplyScalar(1.3).add(tangent.clone().multiplyScalar(.15)),axis.clone().multiplyScalar(1.7).add(tangent.clone().multiplyScalar(.35)),axis.clone().multiplyScalar(1.7).sub(tangent.clone().multiplyScalar(.35)),axis.clone().multiplyScalar(1.3).sub(tangent.clone().multiplyScalar(.15)));const geo=new THREE.TubeGeometry(curve,24,.013,5,false);geos.set('stellar-loop'+i+':'+n,geo);mesh(g,geo,material('#ff8c40',true,.55),-1.1,.55,0);}
      for(const r of [3.15,4.85,6.7,8.4]){const orbit=mesh(g,geometry('TorusGeometry',[r,.011,4,160]),material('#788ba6',true,.12),-1.1,.02,0);orbit.rotation.x=Math.PI/2;}
      for(let n=0;n<4;n++){
        const a=i*1.7+n*2.2,r=[3.15,4.85,6.7,8.4][n],kind=['rock',i===3?'mars':'ocean','gas','mars'][n],size=[.33,.63,.86,.42][n];
        const pivot=new THREE.Group();pivot.userData.dynamic=true;g.add(pivot);pivot.position.set(-1.1+Math.cos(a)*r,0,Math.sin(a)*r);
        const planet=mesh(pivot,geometry('SphereGeometry',[size,48,32]),planetMaterial(kind));planet.rotation.z=.18+i*.1;planet.rotation.y=i*1.8;
        if(n===1){const at=new THREE.MeshBasicMaterial({color:'#7aaeff',transparent:true,opacity:.095,side:THREE.BackSide,depthWrite:false});mats.set('planet-atmosphere'+i,at);mesh(pivot,geometry('SphereGeometry',[size*1.08,48,32]),at);}
        if(n===2){
          const rm=new THREE.ShaderMaterial({uniforms:{uColor:{value:new THREE.Color('#a7967d')}},vertexShader:`varying vec3 vLocal;void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`varying vec3 vLocal;uniform vec3 uColor;void main(){float r=length(vLocal.xy);float grains=.54+.16*sin(r*490.)+.1*sin(r*197.);float gap=smoothstep(.017,.045,abs(r-1.43));float edge=smoothstep(1.04,1.12,r)*(1.-smoothstep(1.75,1.85,r));gl_FragColor=vec4(uColor*(.64+.22*sin(r*47.)),grains*gap*edge*.75);}`,side:THREE.DoubleSide,transparent:true,depthWrite:false});mats.set('solar-rings'+i,rm);
          const ring=mesh(pivot,geometry('RingGeometry',[1.04,1.85,160,12]),rm);ring.rotation.x=-.48-i*.14;ring.rotation.y=.2;
        }
        if(n===3){mesh(pivot,geometry('SphereGeometry',[.13,20,14]),planetMaterial('rock'),.73,.07,.14);}
        orbiting.push({mesh:pivot,r,phase:a,center:-1.1,speed:.024/(n+1)});
      }
      for(let n=0;n<72;n++){const a=n*2.399+i*.6,r=5.65+.26*Math.sin(n*17),rock=mesh(g,geometry('IcosahedronGeometry',[.04+(n%4)*.014,1]),planetMaterial('rock'),-1.1+Math.cos(a)*r,.06*Math.sin(n),Math.sin(a)*r);rock.rotation.set(n*.7,n*.4,n*.2);}
      const station=new THREE.Group();station.position.set(3.2,.35,2.5);g.add(station);
      const hub=mesh(station,geometry('CylinderGeometry',[.58,.58,1.6,24]),material('#c6cbd1'),0,.55,0);hub.rotation.z=Math.PI/2;
      for(const side of [-1,1]){round(station,1.35,.06,1.55,'#193c60',side*1.75,.55,0);for(let n=0;n<6;n++)box(station,1.27,.015,.015,'#6c9bb1',side*1.75,.59,-.62+n*.25);rod(station,[side*.7,.5,0],[side*1.5,.5,0],'#acb9c7',.04);}
      const dock=mesh(station,geometry('TorusGeometry',[.52,.06,10,56]),material(s.color,true),0,.37,1.1);dock.rotation.x=Math.PI/2;
      pickGroup(g,{type:'system',id:s.id,title:s.title});
      g.updateMatrixWorld(true);anchors.push({id:s.id,position:g.localToWorld(new THREE.Vector3(3.2,-.25,5.5))});
    });
  }

  if(detail){
    const agent=options.agent||CREW[1];const bot=robot(world,agent.color,agent.id,true);bot.group.scale.setScalar(1.28);bot.group.position.y=-.14;
    cylinder(world,1.3,.09,'#283c59',0,-.18,0,24);
    // Technical grid rings stay static; only the selected chip emits a restrained pulse.
    const ring=mesh(world,geometry('TorusGeometry',[1.25,.013,4,48]),material(agent.color,true));ring.rotation.x=Math.PI/2;ring.position.y=-.1;
  }else if(overview){
    solarSystems();
    environmentEffects=buildSpaceEnvironment(scene,world,{geos,mats,textures,system:'map',onChange:()=>{dirty=true;schedule();}});
  }else if(project!=='office'){
    const s=SYSTEMS.find(s=>s.id===project)||SYSTEMS[2],kind=project==='accounting'?'outreach':project;
    const station=district(0,0,s.title.toUpperCase(),s.color,kind);station.scale.setScalar(2);
    controlRoom(-9,4,project);bridge([-5.7,.06,2],[-6.8,-.1,3]);jumpGate(9,4);
    stationStructure(project);
    environmentEffects=buildSpaceEnvironment(scene,world,{geos,mats,textures,system:project,onChange:()=>{dirty=true;schedule();}});
  }else{
    const p=platform(world,7.1,0,0,0,'INTERNSHIP OFFICE');
    // Layered wall, open side returns and warm fixtures follow the approved model.
    round(p,12.5,4.1,.48,'#7b818b',0,2.24,-4.73);round(p,12.9,.34,.85,'#a5abb4',0,4.34,-4.6);
    for(const side of [-1,1]){const x=side*6.04;round(p,.48,4.15,1.13,'#758398',x,2.24,-4.49);round(p,.12,2.82,.055,'#ffc98f',x,2.3,-3.87,true);round(p,.37,2.18,2.1,'#596d86',side*6.23,1.29,-3.55);machinery(p,side*5.37,.62,-4.42,1.0);for(let n=0;n<4;n++)bolt(p,x,.6+n*.8,-3.89);}
    round(p,2.6,.65,.66,'#65788e',0,4.78,-4.55);machinery(p,0,4.75,-4.2,1.8);for(const x of [-5.4,5.4]){cylinder(p,.19,.11,'#3f526c',x,4.57,-4.55);rod(p,[x,4.65,-4.55],[x,5.25,-4.55],'#9baab9',.032);mesh(p,geometry('SphereGeometry',[.067,12,8]),material('#ffd08d',true),x,5.28,-4.55);}
    for(const x of [-4.3,4.3]){round(p,2.38,2.05,.12,'#35445b',x,2.68,-4.42);round(p,2.15,1.82,.04,'#182c46',x,2.68,-4.33);}
    for(const [x,lines] of [[-4.3,['SMALL STEPS','BIGGER WORLDS']],[4.3,['A MORE CURIOUS','YOU']]])lines.forEach((line,i)=>label(p,line,1.95,x,2.92-i*.44,-4.29,'#b9d9f5',.25));
    round(p,2.45,1.06,.66,'#566477',0,.67,-4.04);round(p,2.6,.13,.74,'#c1b8ab',0,1.24,-4.04);machinery(p,0,.7,-3.67,1.5);round(p,.59,.75,.45,'#314258',0,1.66,-4.03);round(p,.38,.31,.03,'#ffc98f',0,1.86,-3.78,true);cylinder(p,.12,.15,'#e6d1b4',0,1.37,-3.72);
    for(const x of [-3,0,3]){rod(p,[x,4.2,-3.94],[x,3.65,-3.94],'#37465c',.025);const bulb=mesh(p,geometry('SphereGeometry',[.18,16,10]),material('#ffe2a7',true),x,3.5,-3.94);bulb.scale.y=1.17;cylinder(p,.19,.12,'#565f6a',x,3.68,-3.94);}
    const warm=new THREE.PointLight(0xffbe75,24,14,2);warm.position.set(0,3.1,-3.3);p.add(warm);p.userData.warmLight=warm;
    for(let i=0;i<CREW.length;i++){const bot=robot(p,CREW[i].color,CREW[i].id);desk(p,[-3.1,0,3.1][i%3],i<3?-2.6:1.0,bot,i);}
    for(const x of [-5.28,5.28]){cylinder(p,.33,.48,'#bdb2a2',x,.39,-2.45,20);for(let i=0;i<5;i++){const stem=rod(p,[x,.59,-2.45],[x+(i-2)*.13,1.55+(i%2)*.27,-2.45+(i%3-1)*.19],'#617d63',.025);const leaf=mesh(p,geometry('SphereGeometry',[.21,12,8]),material('#638b75'),x+(i-2)*.17,1.38+(i%2)*.3,-2.45+(i%3-1)*.19);leaf.scale.set(.52,1.8,.5);leaf.rotation.z=(i-2)*.22;}}
    for(const side of [-1,1]){railing(p,[side*6.4,.73,.8],[side*6.4,.73,4.13]);round(p,.32,.84,.47,'#72859b',side*6.4,.48,4.19);round(p,.09,.4,.055,'#ffc787',side*6.4,.59,4.46,true);}
    studio();bridge([0,-.3,5.6],[0,-2.5,6.8]);
    controlRoom(-10,3);bridge([-7.05,.1,2],[-7.5,-.1,3]);jumpGate(10,4);
    stationStructure(project);
    environmentEffects=buildSpaceEnvironment(scene,world,{geos,mats,textures,system:project,onChange:()=>{dirty=true;schedule();}});
    // One courier path is purely an illustrative handoff; it never represents a live run.
    const packet=round(world,.26,.21,.17,'#ffc374',0,1.5,0,true);packet.userData.dynamic=true;pulses.push(packet);
  }
  // Batch repeated pieces into GPU instances. Moving robot joints keep their
  // invisible transform skeletons; only their instance matrices change per frame.
  if(!detail){
    world.updateMatrixWorld(true);const buckets=new Map(),staticMeshes=[];
    const moving=o=>{let p=o;while(p&&p!==world){if(p.userData.dynamic)return true;p=p.parent;}return false;};
    world.traverse(o=>{if(!o.isMesh)return;const key=o.geometry.uuid+o.material.uuid;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(o);});
    buckets.forEach(list=>{
      if(list.length<2)return;
      const instance=new THREE.InstancedMesh(list[0].geometry,list[0].material,list.length);
      instance.userData.instancePicks=list.map(m=>m.userData.pick||null);
      list.forEach((m,i)=>{instance.setMatrixAt(i,m.matrixWorld);if(moving(m)){m.visible=false;movingInstances.push({mesh:m,instance,index:i});}else staticMeshes.push(m);const k=picks.indexOf(m);if(k!==-1)picks.splice(k,1);});
      instance.castShadow=list.some(m=>m.castShadow);instance.receiveShadow=list.some(m=>m.receiveShadow);instance.frustumCulled=false;world.add(instance);instances.push(instance);if(instance.userData.instancePicks.some(Boolean))picks.push(instance);
    });
    staticMeshes.forEach(m=>m.removeFromParent());
  }
  const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();
  function publishStats(){host.dataset.graphics=JSON.stringify({fps:measuredFps,frameCap:quality==='cinematic'?60:30,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pixelRatio:renderer.getPixelRatio(),quality,shadows:renderer.shadowMap.enabled,design:'solar-stations-v1',mode:detail?'robot':overview?'universe':project,paused:!enabled||reduced.matches||document.hidden||!visible||!!options.suspended?.()});}
  function hit(e){const r=canvas.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(mouse,camera);const h=ray.intersectObjects(picks,false).find(h=>h.object.userData.pick||h.object.userData.instancePicks?.[h.instanceId]);return h?(h.object.userData.pick||h.object.userData.instancePicks[h.instanceId]):null;}
  function positionCamera(){camera.position.set(target.x+radius*Math.sin(phi)*Math.sin(theta),target.y+radius*Math.cos(phi),target.z+radius*Math.sin(phi)*Math.cos(theta));camera.lookAt(target);}
  function resize(){if(disposed)return;const r=host.getBoundingClientRect(),wasPortrait=camera.aspect<1;width=Math.max(1,r.width);height=Math.max(1,r.height);camera.aspect=width/height;if(!detail&&wasPortrait!==(camera.aspect<1))goalRadius=camera.aspect<1?Math.min(140,startRadius*(overview?.8:.95)/camera.aspect):startRadius;camera.fov=detail?36:(camera.aspect<1?55:36);camera.updateProjectionMatrix();renderer.setPixelRatio(quality==='low'?1:Math.min(devicePixelRatio,quality==='cinematic'?2:1.4));environmentEffects?.setQuality(quality,renderer.getPixelRatio());renderer.setSize(width,height,false);publishStats();dirty=true;schedule();}
  function onDown(e){if(e.button!==0&&e.button!==2)return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false,pan:e.button===2||e.shiftKey};canvas.setPointerCapture(e.pointerId);}
  function onMove(e){
    if(pointer&&pointer.id===e.pointerId){const dx=e.clientX-pointer.lastX,dy=e.clientY-pointer.lastY;pointer.moved||=Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>5;if(pointer.pan&&!detail){const right=new THREE.Vector3().setFromMatrixColumn(camera.matrix,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrix,1);goalTarget.addScaledVector(right,-dx*radius*.0007).addScaledVector(up,dy*radius*.0007);goalTarget.clamp(new THREE.Vector3(-38,-18,-38),new THREE.Vector3(38,18,38));}else{goalTheta-=dx*.005;goalPhi=Math.min(detail?1.65:1.52,Math.max(detail?.85:.25,goalPhi+dy*.004));}pointer.lastX=e.clientX;pointer.lastY=e.clientY;dirty=true;schedule();}
    else{const h=hit(e);if(JSON.stringify(h)!==JSON.stringify(hovered)){hovered=h;canvas.style.cursor=h?'pointer':'grab';options.onHover?.(h);}}
  }
  function onUp(e){if(!pointer||pointer.id!==e.pointerId)return;const clicked=!pointer.moved&&!pointer.pan;pointer=null;if(clicked){const h=hit(e);if(h?.type==='module'){select(h.id);options.onModule?.(h.id);}else if(h)options.onSelect?.(h);} }
  function onCancel(){pointer=null;}
  function onWheel(e){e.preventDefault();goalRadius=Math.max(detail?5.5:overview?30:13,Math.min(detail?12:140,goalRadius*Math.exp(Math.max(-300,Math.min(300,e.deltaY))*.0012)));dirty=true;schedule();}
  function select(n){selected=n;chips.forEach((c,i)=>{c.group.position.z=c.baseZ+(i===n?.11:0);c.icon.material=material(i===n?'#ffffff':c.color,true);});dirty=true;schedule();}
  const cameraMoving=()=>Math.abs(goalTheta-theta)+Math.abs(goalPhi-phi)+Math.abs(goalRadius-radius)+target.distanceTo(goalTarget)>.001;
  function noContextMenu(e){e.preventDefault();}
  function draw(ts){
    frame=0;if(disposed)return;if(document.hidden||!visible||(hasRendered&&options.suspended?.())){publishStats();return;}
    const animate=enabled&&!reduced.matches&&!options.suspended?.();
    const frameCap=quality==='cinematic'?60:30;
    if(ts-lastDraw<1000/frameCap&&!dirty){if(animate||cameraMoving())schedule();return;}
    const dt=last?Math.min((ts-last)/1000,.1):0;last=ts;lastDraw=dirty?ts:ts-(ts-lastDraw)%(1000/frameCap);elapsed+=dt;
    const damping=reduced.matches?1:1-Math.exp(-Math.max(dt,1/60)*12);theta+=(goalTheta-theta)*damping;phi+=(goalPhi-phi)*damping;radius+=(goalRadius-radius)*damping;target.lerp(goalTarget,damping);
    if(animate){
      environmentEffects?.update(elapsed);
      stellarMaterials.forEach(m=>m.uniforms.uTime.value=elapsed);
      orbiting.forEach(o=>{const a=o.phase+elapsed*o.speed;o.mesh.position.x=o.center+Math.cos(a)*o.r;o.mesh.position.z=Math.sin(a)*o.r;});
      robots.forEach((r,i)=>{
        r.head.rotation.z=Math.sin(elapsed*.8+i)*.025;
        const phase=elapsed%22,walking=!detail&&r.id==='council'&&phase>7&&phase<18;
        let distance=0;
        if(walking){distance=phase<11?(phase-7)/4:phase<14?1:1-(phase-14)/4;r.group.rotation.y=phase<14?-Math.PI/2:Math.PI/2;}
        else r.group.rotation.y=0;
        r.group.position.x=r.baseX-distance*2.45;
        r.group.position.z=r.baseZ+(walking?.7*Math.sin(distance*Math.PI):0);
        r.group.position.y=r.baseY+Math.sin(elapsed*(walking?7:1.4)+i)*(walking?.025:.015);
        r.arms.forEach((a,j)=>{a.rotation.x=detail?.05:walking?Math.sin(elapsed*7+j*Math.PI)*.4:Math.sin(elapsed*4+i+j)*.16-.37;});
        r.legs.forEach((leg,j)=>{leg.rotation.x=walking?Math.sin(elapsed*7+j*Math.PI)*.18:0;});
      });
      pulses.forEach(m=>{const t=(elapsed%14)/14;m.position.set(-3.1+6.2*t,1.64+Math.sin(t*Math.PI)*.7,t<.5?-2.6:-2.6+7.2*(t-.5));m.rotation.y=elapsed;});
      chips.forEach((c,i)=>{c.icon.scale.setScalar(i===selected?1+Math.sin(elapsed*2)*.08:1);});
    }
    if(movingInstances.length){world.updateMatrixWorld(true);movingInstances.forEach(r=>{r.instance.setMatrixAt(r.index,r.mesh.matrixWorld);r.instance.instanceMatrix.needsUpdate=true;});}
    if(renderer.shadowMap.enabled&&(dirty||elapsed-lastShadow>.15)){sun.shadow.needsUpdate=true;renderer.shadowMap.needsUpdate=true;lastShadow=elapsed;}
    positionCamera();renderer.render(scene,camera);hasRendered=true;dirty=false;
    if(options.onAnchors)options.onAnchors(anchors.map(a=>{const p=a.position.clone().project(camera);return {id:a.id,x:(p.x*.5+.5)*width,y:(-.5*p.y+.5)*height,visible:p.z>-1&&p.z<1&&Math.abs(p.x)<1.12&&Math.abs(p.y)<1.1};}));
    frames++;if(ts-intervalStart>=1500){measuredFps=Math.round(frames*1000/(ts-intervalStart));frames=0;intervalStart=ts;publishStats();}
    if(animate||cameraMoving())schedule();
  }
  function schedule(){if(!disposed&&!frame&&!document.hidden&&visible&&(!hasRendered||!options.suspended?.()))frame=requestAnimationFrame(draw);}
  function visibility(){last=0;frames=0;measuredFps=0;intervalStart=performance.now();dirty=true;publishStats();schedule();}
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);
  const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible&&frame){cancelAnimationFrame(frame);frame=0;}else visibility();});intersection.observe(host);
  canvas.addEventListener('contextmenu',noContextMenu);canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointermove',onMove);canvas.addEventListener('pointerup',onUp);canvas.addEventListener('pointercancel',onCancel);canvas.addEventListener('wheel',onWheel,{passive:false});
  document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',visibility);
  function contextLost(e){e.preventDefault();options.onFailure?.('Graphics context was lost. The standard office remains available.');}
  canvas.addEventListener('webglcontextlost',contextLost);
  resize();select(selected);schedule();
  return {
    select,
    setMotion(value){enabled=!!value;visibility();},
    setQuality(value){quality=['low','balanced','cinematic'].includes(value)?value:'cinematic';renderer.shadowMap.enabled=!detail&&quality!=='low';sun.shadow.mapSize.set(quality==='cinematic'?2048:1024,quality==='cinematic'?2048:1024);sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.needsUpdate=true;world.traverse(o=>{if(o.isPointLight)o.visible=quality!=='low';});resize();},
    reset(){goalRadius=!detail&&camera.aspect<1?Math.min(140,startRadius*(overview?.8:.95)/camera.aspect):startRadius;goalTheta=startTheta;goalPhi=startPhi;goalTarget.set(0,detail?1.55:-.55,detail||overview?0:3.1);dirty=true;schedule();},
    wake:visibility,
    stats(){return {mode:detail?'robot':'world',fps:measuredFps,frameCap:quality==='cinematic'?60:30,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pixelRatio:renderer.getPixelRatio(),canvas:[canvas.width,canvas.height],geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,paused:!enabled||reduced.matches||document.hidden||!visible||!!options.suspended?.(),quality};},
    dispose(){if(disposed)return;disposed=true;environmentEffects?.dispose();cancelAnimationFrame(frame);resizeObserver.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',visibility);canvas.removeEventListener('contextmenu',noContextMenu);canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointermove',onMove);canvas.removeEventListener('pointerup',onUp);canvas.removeEventListener('pointercancel',onCancel);canvas.removeEventListener('wheel',onWheel);canvas.removeEventListener('webglcontextlost',contextLost);instances.forEach(m=>m.dispose());geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());environmentTarget.dispose();sun.shadow.map?.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();}
  };
}
