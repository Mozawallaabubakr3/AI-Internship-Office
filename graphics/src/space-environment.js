import * as THREE from './vendor/three/three.module.min.js';

const canvasCache=new Map(),imageCache=new Map();
export function bundledTexture(path,onLoad){
  const url=new URL(path,import.meta.url).href;
  if(!imageCache.has(url))imageCache.set(url,new Promise((resolve,reject)=>new THREE.ImageLoader().load(url,resolve,undefined,reject)));
  imageCache.get(url).then(image=>{const texture=new THREE.Texture(image);texture.needsUpdate=true;onLoad(texture);}).catch(()=>imageCache.delete(url));
}

// Visual scenery and bundled public textures. No generation API or application state.
export function buildSpaceEnvironment(scene, world, {geos,mats,textures,onChange,system='office'}) {
  let disposed=false;
  const geo=(name,g)=>{geos.set('space:'+name,g);return g;};
  const mat=(name,m)=>{mats.set('space:'+name,m);return m;};
  const tex=c=>{const t=new THREE.CanvasTexture(c);textures.push(t);return t;};
  let seed=8127;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const fade=t=>t*t*(3-2*t);
  const hash=(x,y)=>{const n=Math.sin(x*127.1+y*311.7)*43758.5453123;return n-Math.floor(n);};
  function noise(x,y){const ix=Math.floor(x),iy=Math.floor(y),a=fade(x-ix),b=fade(y-iy);return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iy),hash(ix+1,iy),a),THREE.MathUtils.lerp(hash(ix,iy+1),hash(ix+1,iy+1),a),b);}
  function fbm(x,y,octaves=5){let n=0,weight=.5,total=0;for(let i=0;i<octaves;i++){n+=noise(x,y)*weight;total+=weight;x=x*2.03+17.2;y=y*2.03-9.1;weight*=.5;}return n/total;}
  function canvas(w,h,name){if(canvasCache.has(name))return canvasCache.get(name);const c=document.createElement('canvas');c.width=w;c.height=h;canvasCache.set(name,c);return c;}

  // Domain-warped emission clouds with dark dust lanes, rather than flat gradients.
  const nebula=canvas(768,384,'nebula'),ctx=nebula.getContext('2d'),pixels=ctx.createImageData(768,384);
  if(!nebula.generated){
  for(let y=0;y<384;y++)for(let x=0;x<768;x++){
    const u=x/768,v=y/384,wx=fbm(u*5+7,v*5,3),wy=fbm(u*5,v*5+23,3);
    const f=fbm(u*10+wx*2,v*9+wy*2,5);
    const band=Math.exp(-Math.pow((v-.64-.13*Math.sin(u*7+wx))/.23,2));
    const clump=Math.pow(Math.max(0,f-.26)*1.7,2.15)*band;
    const dust=Math.pow(fbm(u*15+wy,v*15+wx,3),5)*5;
    const hue=(Math.sin(u*9+wy*3)+1)/2;
    const i=(y*768+x)*4,light=clump*(1-Math.min(.86,dust))*2.7;
    pixels.data[i]=3+light*(35+38*hue);pixels.data[i+1]=7+light*(48-12*hue);pixels.data[i+2]=15+light*104;pixels.data[i+3]=255;
  }
  ctx.putImageData(pixels,0,0);nebula.generated=true;}
  const background=tex(nebula);background.colorSpace=THREE.SRGBColorSpace;background.mapping=THREE.EquirectangularReflectionMapping;scene.background=background;
  const turn={map:.3,office:0,interview:1.4,video:2.5,accounting:4.1}[system]||0;
  scene.backgroundRotation.set(-1.869379,1.123263+turn,-2.271589);scene.backgroundIntensity=system==='map'?.10:.17;
  bundledTexture('./assets/milky-way-panorama.jpg',t=>{if(disposed){t.dispose();return;}t.colorSpace=THREE.SRGBColorSpace;t.mapping=THREE.EquirectangularReflectionMapping;textures.push(t);scene.background=t;onChange?.();});

  const positions=[],colors=[],sizes=[],phases=[];
  for(let i=0;i<10500;i++){
    const a=random()*Math.PI*2,b=Math.acos(2*random()-1),r=240+random()*100;
    positions.push(Math.sin(b)*Math.cos(a)*r,Math.cos(b)*r,Math.sin(b)*Math.sin(a)*r);
    const bright=random(),warm=random(),c=new THREE.Color(warm<.18?'#ffd5ad':warm>.8?'#b5d7ff':'#e4eeff');
    c.multiplyScalar(.52+Math.pow(bright,4)*1.1);colors.push(c.r,c.g,c.b);sizes.push(bright>.992?8+random()*5:bright>.92?3+random()*2:1+random()*1.5);phases.push(random()*6.28);
  }
  const stars=geo('stars',new THREE.BufferGeometry());stars.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));stars.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));stars.setAttribute('aSize',new THREE.Float32BufferAttribute(sizes,1));stars.setAttribute('aPhase',new THREE.Float32BufferAttribute(phases,1));
  const starMat=mat('stars',new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uRatio:{value:1}},vertexShader:`attribute float aSize;attribute float aPhase;varying vec3 vColor;varying float vPhase;uniform float uRatio;void main(){vColor=color;vPhase=aPhase;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=aSize*uRatio;}`,fragmentShader:`varying vec3 vColor;varying float vPhase;uniform float uTime;void main(){float d=length(gl_PointCoord-.5)*2.;float core=exp(-d*d*20.);float halo=exp(-d*d*5.)*.18;float alpha=(core+halo)*(1.+sin(uTime*.5+vPhase)*.07);gl_FragColor=vec4(vColor,alpha);}`,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
  const starField=new THREE.Points(stars,starMat);starField.frustumCulled=false;scene.add(starField);

  function sphere(name,parent,r,material,segments=96){const m=new THREE.Mesh(geo(name,new THREE.SphereGeometry(r,segments,segments/2)),material);parent.add(m);return m;}
  function atmosphere(name,parent,r,color,strength){
    const m=mat(name,new THREE.ShaderMaterial({uniforms:{uColor:{value:new THREE.Color(color)},uStrength:{value:strength}},vertexShader:`varying vec3 vNormal;varying vec3 vView;void main(){vec4 p=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,fragmentShader:`varying vec3 vNormal;varying vec3 vView;uniform vec3 uColor;uniform float uStrength;void main(){float facing=abs(dot(normalize(vNormal),normalize(vView)));float glow=pow(1.-facing,4.5)*uStrength;gl_FragColor=vec4(uColor,glow);}`,transparent:true,blending:THREE.AdditiveBlending,side:THREE.FrontSide,depthWrite:false}));return sphere(name,parent,r,m);
  }

  // Ocean world: warped continents, continental shelves, ice caps and clouds.
  const planet=new THREE.Group();planet.position.set(-39,-22,-53);world.add(planet);planet.visible=system==='office';
  const surface=canvas(1024,512,'surface'),cloud=canvas(1024,512,'clouds'),sp=surface.getContext('2d').createImageData(1024,512),cp=cloud.getContext('2d').createImageData(1024,512);
  if(!surface.generated){
  for(let y=0;y<512;y++)for(let x=0;x<1024;x++){
    const u=x/1024,v=y/512,lon=u*Math.PI*2;
    const a=Math.cos(lon)*2.5+8,b=Math.sin(lon)*2.5+v*9;
    const f=fbm(a+fbm(a,b,3)*1.4,b,6),fine=noise(a*80,b*80),i=(y*1024+x)*4;
    let color=f>.56?[46+fine*35,62+fine*42,48+fine*30]:f>.52?[17,67+fine*13,86+fine*18]:[5+fine*5,22+fine*12,48+fine*20];
    if(Math.abs(v-.5)>.43+noise(a*3,b*3)*.03)color=[155+fine*45,180+fine*40,200+fine*35];
    for(let k=0;k<3;k++)sp.data[i+k]=color[k];sp.data[i+3]=255;
    const sx=Math.cos(lon)*Math.sin(v*Math.PI),sy=Math.cos(v*Math.PI),sz=Math.sin(lon)*Math.sin(v*Math.PI),cf=fbm(sx*7+30,sy*7+sz*4+19,5),cover=Math.max(0,(cf-.53)*4);
    cp.data[i]=220;cp.data[i+1]=231;cp.data[i+2]=245;cp.data[i+3]=Math.min(220,cover*255);
  }
  surface.getContext('2d').putImageData(sp,0,0);cloud.getContext('2d').putImageData(cp,0,0);surface.generated=true;}
  const surfaceTex=tex(surface);surfaceTex.colorSpace=THREE.SRGBColorSpace;surfaceTex.anisotropy=4;
  const earthMaterial=mat('ocean-world',new THREE.MeshStandardMaterial({map:surfaceTex,roughness:.78,metalness:.03}));
  sphere('ocean-world',planet,8.3,earthMaterial,128);
  bundledTexture('./assets/earth-blue-marble.jpg',t=>{if(disposed){t.dispose();return;}t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;textures.push(t);earthMaterial.map=t;earthMaterial.needsUpdate=true;onChange?.();});
  const cloudTex=tex(cloud);cloudTex.colorSpace=THREE.SRGBColorSpace;
  const clouds=sphere('cloud-shell',planet,8.39,mat('cloud-shell',new THREE.MeshStandardMaterial({map:cloudTex,transparent:true,opacity:.28,roughness:1,depthWrite:false})),96);
  atmosphere('blue-atmosphere',planet,8.58,'#428cf5',.73);planet.rotation.z=.16;planet.rotation.y=2.4;

  const giant=new THREE.Group();giant.position.set(7,-16,-64);world.add(giant);giant.visible=system!=='map';
  const gas=canvas(1536,768,'gas'),gc=gas.getContext('2d'),gp=gc.createImageData(1536,768);
  if(!gas.generated){
  for(let y=0;y<768;y++)for(let x=0;x<1536;x++){
    const u=x/1536,v=y/768,w=fbm(u*10,v*34,4),band=Math.sin(v*100+w*3),fine=noise(u*65,v*120),i=(y*1536+x)*4;
    const storm=Math.exp(-Math.pow((u-.68)/.065,2)-Math.pow((v-.62)/.037,2));
    gp.data[i]=158+band*24+w*30+storm*30;gp.data[i+1]=133+band*21+w*24-storm*20;gp.data[i+2]=103+band*15+w*22-storm*18;gp.data[i+3]=255;
  }
  gc.putImageData(gp,0,0);gas.generated=true;}const gasTex=tex(gas);gasTex.colorSpace=THREE.SRGBColorSpace;
  sphere('gas-giant',giant,5.2,mat('gas-giant',new THREE.MeshStandardMaterial({map:gasTex,color:system==='accounting'?'#99b7a8':system==='interview'?'#b3a2c7':'#ffffff',roughness:1})),96);
  atmosphere('gas-haze',giant,5.3,'#cab69c',.3);
  const rings=new THREE.RingGeometry(6.5,10.7,256,10);geo('planet-rings',rings);
  const ringMat=mat('planet-rings',new THREE.ShaderMaterial({uniforms:{uColor:{value:new THREE.Color('#bfb09a')}},vertexShader:`varying vec3 vLocal;void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`varying vec3 vLocal;uniform vec3 uColor;void main(){float r=length(vLocal.xy);float grain=.58+.2*sin(r*180.)+.13*sin(r*71.);float gap=1.-smoothstep(.07,.2,abs(r-8.45));float edge=smoothstep(6.5,6.7,r)*(1.-smoothstep(10.5,10.7,r));float shadow=smoothstep(-2.8,-1.5,vLocal.x);gl_FragColor=vec4(uColor*(.45+.55*shadow),max(0.,grain-gap*.8)*edge*.68);}`,side:THREE.DoubleSide,transparent:true,depthWrite:false}));
  const ring=new THREE.Mesh(rings,ringMat);ring.rotation.x=-1.05;ring.rotation.y=.24;giant.add(ring);

  // Four shared rock meshes with cratered displacement and fine surface relief.
  const grain=canvas(512,256,'rocks'),rx=grain.getContext('2d'),rp=rx.createImageData(512,256);
  if(!grain.generated){for(let y=0;y<256;y++)for(let x=0;x<512;x++){const i=(y*512+x)*4,v=fbm(x*.045,y*.045,5)*170+noise(x*.7,y*.7)*60;rp.data[i]=v;rp.data[i+1]=v*.93;rp.data[i+2]=v*.86;rp.data[i+3]=255;}rx.putImageData(rp,0,0);grain.generated=true;}
  const rockTex=tex(grain);rockTex.wrapS=rockTex.wrapT=THREE.RepeatWrapping;rockTex.repeat.set(2,2);
  const rockMat=mat('rock',new THREE.MeshStandardMaterial({color:'#89909b',map:rockTex,bumpMap:rockTex,bumpScale:.2,roughness:.98,metalness:0}));
  const rockGeos=[];
  for(let variant=0;variant<4;variant++){
    const g=geo('rock-'+variant,new THREE.IcosahedronGeometry(1,4)),p=g.attributes.position;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),warp=.8+.28*fbm(x*5+variant*13,y*5+z*7,4)+.09*Math.sin(z*15+x*10);
      p.setXYZ(i,x*warp,y*warp,z*warp);
    }g.computeVertexNormals();rockGeos.push(g);
  }
  const rocks=[[-19,-4,11,4.5],[20,-5,14,3.2],[-22,-2,-8,1.4],[21,-1,-16,1.2],[-13,-3,17,.8],[5,-5,19,.55]];
  for(let i=0;i<90;i++){const a=i*2.399;rocks.push([Math.sin(a)*(19+random()*19),-5-random()*12,Math.cos(a)*(17+random()*25),.14+Math.pow(random(),3)*1.15]);}
  if(system!=='map')rocks.forEach(([x,y,z,r],i)=>{const m=new THREE.Mesh(rockGeos[i%4],rockMat);m.position.set(x,y,z);m.scale.set(r,r*(.6+random()*.4),r*(.8+random()*.3));m.rotation.set(i*.7,i*.41,i*.22);m.castShadow=i<6;world.add(m);});
  return {update(time){starMat.uniforms.uTime.value=time;clouds.rotation.y=time*.0015;},setQuality(quality,ratio){starMat.uniforms.uRatio.value=ratio;stars.setDrawRange(0,quality==='low'?3500:quality==='balanced'?7000:10500);},dispose(){disposed=true;}};
}
