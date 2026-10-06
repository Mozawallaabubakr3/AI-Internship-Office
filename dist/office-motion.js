// Visuals only: this module reads saved records and never starts workers or writes data.
(() => {
  const fresh = value => Number.isFinite(Date.parse(value)) && Date.now() - Date.parse(value) < 20 * 60 * 1000;
  const submitted = j => (j.history || []).some(h => h.stage === 'Applied' && h.evidence);
  function activity(s) {
    const runs = s.pipeline?.runs || [], councils = s.pipeline?.councils || [];
    const open = s.opportunities.filter(j => !submitted(j) && !['Applied','Interviewing','Offer','Rejected','Withdrawn'].includes(j.stage));
    const pending = s.approvals.filter(a => a.status === 'pending');
    const liveScout = runs.some(r => r.status === 'running' && fresh(r.updated));
    const liveCouncil = councils.some(c => c.current && c.status === 'reviewing' && fresh(c.updated));
    // Preparation is a saved stage, not a claim that a model is currently executing.
    const preparing = open.filter(j => j.stage === 'Preparing');
    const ready = open.filter(j => j.stage === 'Ready for approval');
    return [
      {active:liveScout, label:liveScout?'Researching · recent run':`Last scout · ${runs[0]?.status || 'not started'}`},
      {active:liveCouncil, label:liveCouncil?'Reviewing · recent votes':`${open.filter(j=>j.council_queue==='queued').length} queued for review`},
      {active:false, label:preparing.length?`${preparing.length} draft in preparation`:'Materials ready'},
      {active:false, label:ready.length?`${ready.length} ready to submit`:preparing.length?'Application in preparation':`${s.opportunities.filter(submitted).length} submissions recorded`},
      {active:false, label:`${s.contacts.length} connections recorded`},
      {active:false, label:pending.some(a=>a.kind==='outreach')?'Draft awaiting review':'Ready when needed'}
    ];
  }
  const desks = [[285,246],[765,235],[1210,246],[315,655],[772,657],[1214,660]];
  // Doorways and aisles keep couriers off desks and through the central corridor.
  const doors = [[463,353],[746,439],[1061,351],[516,711],[1010,715],[1060,716]];
  function route(from,to) {
    const a=doors[from],b=doors[to];
    const aisle=i=>i===0||i===3?542:1009;
    return [a,[aisle(from),a[1]],[aisle(from),454],[aisle(to),454],[aisle(to),b[1]],b];
  }
  const colors=['#bbdf83','#9fbff7','#efc084','#c6a3ef','#82d5cf','#f4a9a0'];
  function effects() {
    return `<svg class="office-effects" viewBox="0 0 1536 1024" aria-hidden="true"><defs><filter id="office-glow"><feGaussianBlur stdDeviation="9"/></filter></defs>${desks.map(([x,y],i)=>`<g class="desk-effect" data-desk="${i}" transform="translate(${x} ${y})"><ellipse class="desk-aura" cx="0" cy="20" rx="76" ry="37" fill="${colors[i]}" filter="url(#office-glow)"/><g class="work-lines" fill="${colors[i]}"><rect x="-28" y="-31" width="38" height="3"/><rect x="-28" y="-23" width="50" height="3"/><rect x="-28" y="-15" width="29" height="3"/></g><g class="typing-hands" fill="#e7b98d"><rect class="hand hand-left" x="-20" y="29" width="13" height="7"/><rect class="hand hand-right" x="13" y="29" width="13" height="7"/></g><g class="writing-pencil" transform="translate(31 30)"><path d="M0 0L20 -20" stroke="#ffe294" stroke-width="5"/><path d="M-3 3L0 -3L3 0Z" fill="#fff1d6"/></g></g>`).join('')}<g class="courier" visibility="hidden"><ellipse cx="0" cy="3" rx="20" ry="7" fill="#081a21" opacity=".45"/><g class="courier-body"><path class="leg-left" d="M-12 -14h10V3h-13v-6h3z" fill="#233c51"/><path class="leg-right" d="M2 -14h10V3H2z" fill="#233c51"/><path d="M-15 -42h30v30h-30zM-21 -35h6v17h-6zM15 -35h6v17h-6z" fill="var(--courier-shirt,#bbdf83)"/><path d="M-11 -65h22v23h-22z" fill="#d7a278"/><path d="M-13 -67h26v11H7v-4H-6v7h-7z" fill="#302b32"/><rect x="-8" y="-52" width="4" height="3" fill="#27323b"/><rect x="5" y="-52" width="4" height="3" fill="#27323b"/><g class="courier-paper"><path d="M-9 -31H13V-9H-9Z" fill="#fff0cc"/><path d="M-5 -26H9M-5 -21H7M-5 -16H9" stroke="#a3a17b" stroke-width="2"/></g></g></g></svg>`;
  }
  let preview=false, paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let expanded=false, timer=null, animation=null, cycle=0, currentState=null, lastSignal=null, queued=[];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  window.officeSceneMarkup = () => `<div class="office-toolbar"><div class="office-live"><span class="office-dot"></span><span id="office-mode">Recorded activity</span></div><div class="office-controls"><button type="button" data-office-preview aria-pressed="${preview}">◇ Preview activity</button><button type="button" data-office-pause aria-pressed="${paused}" aria-label="Pause office animation">${paused?'▶ Motion off':'Ⅱ Pause motion'}</button><button type="button" data-office-fullscreen aria-label="${expanded?'Exit fullscreen office':'Enter fullscreen office'}">${expanded?'↙ Exit fullscreen':'⛶ Fullscreen'}</button></div></div><div class="office-stage-wrap"><div class="office-scene"><img src="/assets/office.png" alt="Pixel-art office with six workstations and a five-person council table"><span class="room-sign">User’S TEAM <span>/ SUMMER 2027</span></span>${effects()}${workers.map((w,i)=>`<button class="station" style="--x:${w.x}%;--y:${i<3?38:w.y}%;--worker-color:${colors[i]}" data-worker="${w.id}" aria-label="${esc(w.name)}"><span class="station-name"><i></i>${esc(w.short)}</span><small>${esc(w.status)}</small></button>`).join('')}</div></div><div class="office-bottom"><span id="office-motion-note">Saved work, brought to life</span><span id="office-handoff">6 workstations · 5 council reviewers</span></div>`;
  function stop() {clearTimeout(timer);timer=null;animation?.cancel();animation=null;const courier=document.querySelector('.courier');if(courier)courier.setAttribute('visibility','hidden');}
  function updateLabels() {
    if(!currentState || view!=='office')return;
    const statuses=activity(currentState);
    document.querySelectorAll('.station').forEach((el,i)=>{
      workers[i].status=statuses[i].label;
      el.querySelector('small').textContent=statuses[i].label;
      el.setAttribute('aria-label',`${workers[i].name}: ${statuses[i].label}`);
      el.classList.toggle('is-working',preview||statuses[i].active);
    });
    document.querySelectorAll('.desk-effect').forEach((el,i)=>el.classList.toggle('is-working',preview||statuses[i].active));
    document.querySelector('.office-card')?.classList.toggle('motion-paused',paused||document.hidden);
    document.querySelector('.office-card')?.classList.toggle('is-preview',preview);
    const mode=document.querySelector('#office-mode');if(!mode)return;
    mode.textContent=preview?'Preview · visual only':'Recorded activity';
    document.querySelector('#office-motion-note').textContent=preview?'A preview of your team in motion · no agents started':'Animations illustrate saved activity · not a live screen recording';
    const demo=document.querySelector('[data-office-preview]');demo.setAttribute('aria-pressed',preview);demo.textContent=preview?'■ End preview':'◇ Preview activity';
    const pause=document.querySelector('[data-office-pause]');pause.setAttribute('aria-pressed',paused);pause.textContent=paused?'▶ Resume motion':'Ⅱ Pause motion';pause.setAttribute('aria-label',paused?'Resume office animation':'Pause office animation');
  }
  function signals(s) {return JSON.stringify([s.pipeline?.runs?.map(r=>[r.id,r.status,r.updated]),s.pipeline?.councils?.map(c=>[c.id,c.status,c.updated]),s.opportunities.map(j=>[j.id,j.stage]),s.approvals.map(a=>[a.id,a.status]),s.contacts.map(c=>c.id)]);}
  function transitions(before,after) {
    const routes=[];
    if(!before)return routes;
    const oldJobs=new Map(before.opportunities.map(j=>[j.id,j]));
    if(after.opportunities.some(j=>!oldJobs.has(j.id)))routes.push([0,1]);
    if(after.opportunities.some(j=>j.council.startsWith('Approved')&&!oldJobs.get(j.id)?.council.startsWith('Approved')))routes.push([1,2]);
    if(after.opportunities.some(j=>['Preparing','Ready for approval','Applied'].includes(j.stage)&&j.stage!==oldJobs.get(j.id)?.stage))routes.push([2,3]);
    if(after.contacts.length>before.contacts.length)routes.push([4,5]);
    return routes;
  }
  function nextTrip() {
    if(paused||document.hidden||view!=='office'||!document.querySelector('.courier'))return;
    let pair=queued.shift();
    if(!pair&&preview)pair=[[0,1],[1,2],[2,3],[4,5],[3,4],[5,2]][cycle++%6];
    if(!pair){return;}
    const [from,to]=pair,points=route(from,to),courier=document.querySelector('.courier');
    courier.style.setProperty('--courier-shirt',colors[from]);courier.setAttribute('visibility','visible');
    let distance=0;const distances=points.map((p,i)=>i?(distance+=Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1])):0);
    document.querySelector('#office-handoff').textContent=`${preview?'Preview: ':''}${workers[from].short} → ${workers[to].short} · sharing a brief`;
    animation=courier.animate(points.map((p,i)=>({transform:`translate(${p[0]}px,${p[1]}px)`,offset:distances[i]/distance})),{duration:Math.max(6000,distance*10),easing:'linear',fill:'forwards'});
    animation.onfinish=()=>{courier.setAttribute('visibility','hidden');document.querySelector('#office-handoff').textContent='Brief delivered · ready for the next step';timer=setTimeout(nextTrip,1800);};
  }
  function mount(s) {
    stop();
    const next=signals(s);
    if(lastSignal!==next)queued.push(...transitions(currentState,s));
    lastSignal=next;currentState=s;
    if(view!=='office'){
      queued=[];
      if(expanded){expandedState(false);if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}
      return;
    }
    updateLabels();timer=setTimeout(nextTrip,1000);
  }
  function expandedState(value) {
    expanded=value;document.body.classList.toggle('office-expanded',value);
    const button=document.querySelector('[data-office-fullscreen]');if(button){button.textContent=value?'↙ Exit fullscreen':'⛶ Fullscreen';button.setAttribute('aria-label',value?'Exit fullscreen office':'Enter fullscreen office');}
  }
  async function fullscreen() {
    if(expanded){if(document.fullscreenElement)await document.exitFullscreen();expandedState(false);document.querySelector('[data-office-fullscreen]')?.focus();return;}
    expandedState(true);
    try {await document.querySelector('#main-content').requestFullscreen();}
    catch {message('Expanded office view. Use Exit fullscreen or Esc to return.');}
    document.querySelector('[data-office-fullscreen]')?.focus();
  }
  document.addEventListener('click',e=>{
    if(e.target.closest('[data-office-fullscreen]'))fullscreen();
    if(e.target.closest('[data-office-preview]')){preview=!preview;stop();queued=[];updateLabels();nextTrip();}
    if(e.target.closest('[data-office-pause]')){paused=!paused;stop();updateLabels();if(!paused)nextTrip();}
  });
  document.addEventListener('fullscreenchange',()=>expandedState(!!document.fullscreenElement));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&expanded&&!document.fullscreenElement&&!document.querySelector('#dialog').open)expandedState(false);});
  document.addEventListener('visibilitychange',()=>{stop();updateLabels();if(!document.hidden)nextTrip();});
  reduced.addEventListener('change',e=>{paused=e.matches;stop();updateLabels();if(!paused)nextTrip();});
  window.officeMotion={mount};
})();
