// Private dashboard adapter. The shared 3D engine only receives labels and click callbacks.
(() => {
  let engine=null,worldScene=null,bodyScene=null,wanted3D=true,motion=!matchMedia('(prefers-reduced-motion: reduce)').matches,quality='cinematic',activeBodyId='council',sceneRevision=0;
  const priorOffice=office,priorWorker=worker,priorBody=window.spaceOffice.robotBody;
  const crew=[['scout','Signal scout'],['council','Council core'],['writer','Draft engineer'],['operator','Application pilot'],['researcher','Connection radar'],['outreach','Message architect']];
  const stage=()=>`<section class="orbital-stage" aria-label="Interactive 3D robot office"><div class="orbital-scene-host" id="orbital-world-host"><div class="orbital-loading">Assembling your orbital office…</div></div><div class="orbital-map-title"><span class="space-kicker">YOUR FIRST 3D AGENT</span><h2>Council Core</h2><p>Five perspectives, one decision.<br>Enter the lavender robot to explore.</p><button class="orbital-enter" data-worker="council">Enter Council Core ↗</button></div><div class="orbital-controls"><button data-orbital-reset aria-label="Reset 3D camera">↺ Reset view</button><button data-orbital-quality aria-pressed="${quality==='low'}">${quality==='low'?'Low graphics':quality==='balanced'?'Balanced graphics':'Cinematic graphics'}</button><button data-orbital-motion aria-pressed="${!motion}">${motion?'Ⅱ Pause motion':'▶ Resume motion'}</button><button data-orbital-mode>2D office</button></div><div class="orbital-hover" id="orbital-hover" role="status">Drag to orbit · Scroll to zoom · Right-drag to pan · Select a robot</div><div class="orbital-crew" aria-label="Choose a robot">${crew.map(([id,title])=>`<button data-worker="${id}" class="${id==='council'?'featured':''}"><i class="crew-dot crew-${id}"></i>${title}</button>`).join('')}</div><div class="orbital-credits">Sky: <a href="https://www.eso.org/public/images/eso0932a/" target="_blank" rel="noopener">ESO/S. Brunier</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a><br>Earth: <a href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/" target="_blank" rel="noopener">NASA Blue Marble</a> · Exposure adjusted</div><div class="orbital-caption"><span id="space-runtime">Loading worker status…</span><span>Illustrative motion · Saved work · No AI calls for graphics</span></div></section>`;
  office=()=>{
    const html=priorOffice();
    if(!wanted3D)return html.replace('<div class="robot-world">','<button class="orbital-back-3d" data-orbital-mode>↗ Return to 3D office</button><div class="robot-world">');
    return html.replace(/<div class="robot-world">[\s\S]*?(?=<button class="delivery-dock")/,stage());
  };
  const priorRender=render;
  render=function(){worldScene?.dispose();worldScene=null;bodyScene?.dispose();bodyScene=null;document.body.classList.toggle('orbital-home',view==='office'&&wanted3D);priorRender();mountWorld();};
  function fail(message){worldScene?.dispose();worldScene=null;wanted3D=false;render();message&&window.setTimeout(()=>{const t=document.querySelector('#toast');if(t){t.textContent='3D graphics unavailable. Your 2D office and all records are still available.';t.hidden=false;}},0);}
  async function library(){if(engine)return engine;engine=await import('/orbital/world.js');return engine;}
  function syncGraphics(){const host=document.querySelector('#orbital-world-host');if(host)host.dataset.engineState=JSON.stringify(worldScene?.stats()||{missing:true});}
  async function mountWorld(){
    const host=document.querySelector('#orbital-world-host');if(!host)return;
    const revision=++sceneRevision;
    try{
      const {createOrbitalScene}=await library();if(!host.isConnected||revision!==sceneRevision)return;
      const navigation=window.aiWorldNavigation?.()||{mode:'world',project:'office'};
      worldScene=createOrbitalScene(host,{...navigation,motion,onFailure:fail,suspended:()=>document.querySelector('#dialog').open,onAnchors:packet=>window.aiWorldAnchors?.(packet),onSelect:selection=>{
        if(window.aiWorldIsTravelling?.())return;
        if(selection.type==='system')window.aiWorldTravel?.(selection.id);
        if(selection.type==='starmap')window.aiWorldTravel?.('map');
        if(selection.type==='workspace')window.aiWorldControl?.(selection.id);
        if(selection.type==='robot')worker(selection.id);
        if(selection.type==='delivery')window.spaceOffice.studio('all');
        if(selection.type==='district')district(selection);
      },onHover:selection=>{const hint=document.querySelector('#orbital-hover');if(hint)hint.textContent=selection?selection.type==='robot'?`Enter ${crew.find(c=>c[0]===selection.id)?.[1]} ↗`:selection.type==='system'?`Travel to ${selection.title}`:selection.type==='starmap'?'Return to the solar systems':selection.type==='workspace'?'Open station control':selection.type==='delivery'?'Open delivery studio ↗':`${selection.title} · Enter station`:navigation.mode==='universe'?'Select a station · Drag to orbit · Scroll to zoom':'Explore your station · Select a robot or control room';}});
      worldScene.setQuality(quality);host.querySelector('.orbital-loading')?.remove();syncGraphics();return true;
    }catch(e){console.error('Orbital office:',e);fail(e.message);return false;}
  }
  function district(selection){
    if(window.aiWorldDistrict)return window.aiWorldDistrict(selection);
    modal(`<div class="space-kicker">WORLD EXPANSION / PREVIEW</div><h2 class="detail-title">${esc(selection.title)}</h2><p class="component-purpose">This district marks where another system can connect to your world. Today’s interactive build is the Internship Office and Council Core. This district does not run a workflow or expose another system’s data.</p><button class="secondary" data-space-return>↙ Return to orbit</button>`);
  }
  async function mountBody(id='council',module=0){
    const host=document.querySelector('#orbital-body-host');if(!host)return;
    try{
      const {createOrbitalScene,CREW}=await library();if(!host.isConnected)return;
      const labels=[...document.querySelectorAll('.orbital-component-controls [data-robot-module] b')].map(b=>b.textContent);
      bodyScene=createOrbitalScene(host,{mode:'robot',agent:CREW.find(c=>c.id===id),modules:labels,selected:module,motion,onModule:n=>openRobot(id,n),onFailure:()=>{bodyScene?.dispose();bodyScene=null;host.innerHTML='<p class="empty-record">Use the component buttons below to explore this robot.</p>';}});
      bodyScene.setQuality(quality);
    }catch(e){host.innerHTML='<p class="empty-record">Use the component buttons below to explore this robot.</p>';}
  }
  function openRobot(id='council',module=0){
    bodyScene?.dispose();bodyScene=null;
    activeBodyId=id;priorBody(id,module);
    const anatomy=document.querySelector('.robot-anatomy');if(!anatomy)return;
    const buttons=[...anatomy.querySelectorAll('[data-robot-module]')];
    anatomy.classList.add('orbital-anatomy');
    anatomy.innerHTML=`<div class="orbital-body-toolbar"><span>LIVE 3D CUTAWAY</span><button data-orbital-body-reset aria-label="Reset robot view">↺</button></div><div class="orbital-body-host" id="orbital-body-host"></div><p class="orbital-body-hint">Drag to turn · Select an illuminated chip</p><div class="orbital-component-controls">${buttons.map(b=>b.outerHTML).join('')}</div><p class="anatomy-note">${buttons.map(b=>esc(b.querySelector('b').textContent)).join(' → ')}<br>Components open the recorded work and source rules.</p>`;
    document.querySelector('#dialog').classList.add('orbital-robot-dialog');
    mountBody(id,module);
  }
  worker=id=>{if(wanted3D&&crew.some(c=>c[0]===id))openRobot(id);else{bodyScene?.dispose();bodyScene=null;priorWorker(id);}};
  // Preserve exact existing source and records views; only replace the robot sculpture.
  document.addEventListener('click',e=>{
    const module=e.target.closest('[data-robot-module]');
    if(module&&document.querySelector('#dialog').classList.contains('orbital-robot-dialog')){
      e.preventDefault();e.stopImmediatePropagation();openRobot(activeBodyId,Number(module.dataset.robotModule));
    }
  },true);
  document.addEventListener('click',e=>{
    if(e.target.closest('[data-orbital-body-reset]'))bodyScene?.reset();
    if(e.target.closest('[data-orbital-reset]'))worldScene?.reset();
    if(e.target.closest('[data-orbital-mode]')){wanted3D=!wanted3D;render();}
    if(e.target.closest('[data-orbital-quality]')){quality=quality==='cinematic'?'balanced':quality==='balanced'?'low':'cinematic';worldScene?.setQuality(quality);bodyScene?.setQuality(quality);const b=e.target.closest('[data-orbital-quality]');b.textContent=quality==='low'?'Low graphics':quality==='balanced'?'Balanced graphics':'Cinematic graphics';b.setAttribute('aria-pressed',quality==='low');}
    if(e.target.closest('[data-orbital-motion]')){motion=!motion;worldScene?.setMotion(motion);bodyScene?.setMotion(motion);syncGraphics();document.body.classList.toggle('space-motion-paused',!motion);const b=e.target.closest('[data-orbital-motion]');b.textContent=motion?'Ⅱ Pause motion':'▶ Resume motion';b.setAttribute('aria-pressed',!motion);}
  });
  document.querySelector('#dialog').addEventListener('close',()=>{bodyScene?.dispose();bodyScene=null;document.querySelector('#dialog').classList.remove('orbital-robot-dialog');worldScene?.wake();});
  // Dispose cutaway graphics when another existing dialog takes its place.
  new MutationObserver(()=>{if(bodyScene&&!document.querySelector('#orbital-body-host')){bodyScene.dispose();bodyScene=null;}if(!document.querySelector('#orbital-body-host'))document.querySelector('#dialog').classList.remove('orbital-robot-dialog');}).observe(document.querySelector('#dialog-body'),{childList:true});
  window.orbitalOffice={is3D:()=>wanted3D,stats:()=>({world:worldScene?.stats()||null,robot:bodyScene?.stats()||null}),reset:()=>worldScene?.reset(),remount:async()=>{sceneRevision++;worldScene?.dispose();worldScene=null;return await mountWorld();},motion:()=>motion,preferences:()=>({motion,quality})};
  if(state)render();
})();
