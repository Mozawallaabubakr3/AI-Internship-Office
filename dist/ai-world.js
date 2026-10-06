// The world is the persistent application shell. Existing tools open inside it.
(() => {
  const priorOffice=office,priorNavigate=navigate,priorRender=render,priorWorker=worker,priorModal=modal;
  let projectCatalog=[],registry={},commonInstructions='',activeRobot='office',chatSystem=null,chatTimer=null,chatState=null;
  const fallbackNames={office:'Internship Office',council:'Council Core',scout:'Signal Scout',writer:'Draft Engineer',operator:'Application Pilot',researcher:'Connection Radar',outreach:'Message Architect',video:'Video Studio',interview:'Finance Interview Studio',accounting:'Accounting Outreach Hub'};
  const title=id=>registry[id]?.name||fallbackNames[id]||id;
  function chatAvatar(id){const colors={scout:'#84d9ba',council:'#b49aff',writer:'#ffc374',operator:'#83bcff',researcher:'#f993b8',outreach:'#8edddc',office:'#b7cde5',interview:'#b49aff',video:'#83bcff',accounting:'#84d9ba'},color=colors[id]||'#b7cde5';return `<svg viewBox="0 0 56 58" role="img" aria-label="${esc(title(id))} robot"><defs><linearGradient id="chat-metal" x2="1" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#526580"/></linearGradient></defs><path d="M28 8V3" stroke="${color}" stroke-width="2"/><circle cx="28" cy="3" r="2.5" fill="${color}"/><rect x="5" y="10" width="46" height="39" rx="12" fill="url(#chat-metal)" stroke="${color}"/><rect x="10" y="16" width="36" height="26" rx="8" fill="#0c192b"/><g class="avatar-eyes" fill="#dff7ff"><ellipse cx="21" cy="28" rx="3" ry="4"/><ellipse cx="35" cy="28" rx="3" ry="4"/></g><path d="M25 36h6" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><rect x="19" y="51" width="18" height="4" rx="2" fill="${color}"/></svg>`;}
  const questionCount=()=>state.approvals.filter(a=>a.kind==='question'&&a.status==='pending').length;
  const destinations=[
    {id:'office',name:'Internship Office',color:'#83bcff'},
    {id:'interview',name:'Interview Lab',color:'#b49aff'},
    {id:'video',name:'Video Studio',color:'#ffc374'},
    {id:'accounting',name:'Outreach Hub',color:'#84d9ba'}
  ];
  let destination='map',travelling=false;
  const destinationName=id=>destinations.find(s=>s.id===id)?.name||'Solar systems';
  const anchorMarkup=()=>destination==='map'?destinations.map(s=>`<button class="station-target" style="--station-color:${s.color}" data-world-travel="${s.id}" data-station-anchor="${s.id}" hidden ${travelling?'disabled':''} aria-label="Travel to ${s.name}"><i></i><span>${s.name}</span><em>↗</em></button>`).join(''):`<button class="station-target station-console" data-station-anchor="control" data-world-control="${destination}" hidden ${travelling?'disabled':''} aria-label="Open ${destinationName(destination)} control room"><span>Station control</span><em>⌘</em></button><button class="station-target station-console" data-station-anchor="gate" data-world-travel="map" hidden ${travelling?'disabled':''} aria-label="Travel back to the solar systems"><span>Jump gate</span><em>↗</em></button>`;
  function shell(){
    if(window.orbitalOffice?.is3D()===false)return priorOffice();
    const graphics=window.orbitalOffice.preferences();
    return `<section class="space-universe ai-world-shell solar-navigation" aria-label="User's interactive solar systems" data-destination="${destination}"><section class="orbital-stage" aria-label="Interactive solar systems"><div class="orbital-scene-host" id="orbital-world-host"><div class="orbital-loading">Charting your solar systems…</div></div><div class="station-anchors" id="station-anchors">${anchorMarkup()}</div><div class="flight-hud"><button class="flight-map" data-world-travel="map" aria-label="Return to the solar systems" ${destination==='map'?'hidden':''}>✧</button><details class="flight-settings"><summary aria-label="World controls">⚙</summary><div class="flight-settings-panel"><button data-orbital-reset aria-label="Reset 3D camera">Reset view</button><button data-orbital-quality aria-pressed="${graphics.quality==='low'}">${graphics.quality==='low'?'Low graphics':graphics.quality==='balanced'?'Balanced graphics':'Cinematic graphics'}</button><button data-orbital-motion aria-pressed="${!graphics.motion}">${graphics.motion?'Ⅱ Pause motion':'▶ Resume motion'}</button><button class="space-expand" data-space-fullscreen aria-label="Enter fullscreen robot office">⛶ Fullscreen</button><button data-orbital-mode>2D office</button><div class="flight-credits">Sky: <a href="https://www.eso.org/public/images/eso0932a/" target="_blank" rel="noopener">ESO/S. Brunier</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a><br>Earth: <a href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/" target="_blank" rel="noopener">NASA Blue Marble</a><br>Exposure and orientation adjusted.<br>Motion is illustrative; graphics make no AI calls.</div></div></details></div><div class="orbital-hover" id="orbital-hover" role="status">${destination==='map'?'Select a station · Drag to orbit · Scroll to zoom':'Explore your station · Select a robot or control room'}</div><div class="sr-only" id="travel-status" aria-live="polite">${destination==='map'?'Solar systems ready.':'Arrived at '+destinationName(destination)+'.'}</div></section></section>`;
  }
  window.aiWorldNavigation=()=>({mode:destination==='map'?'universe':'world',project:destination==='map'?'office':destination});
  window.aiWorldIsTravelling=()=>travelling;
  window.aiWorldAnchors=packet=>{
    for(const point of packet){const el=document.querySelector(`[data-station-anchor="${point.id}"]`);if(!el)continue;el.hidden=!point.visible;el.style.left=`clamp(94px,${point.x}px,calc(100% - 94px))`;el.style.top=`clamp(28px,${point.y}px,calc(100% - 34px))`;}
  };
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function travel(id){
    if(travelling||id===destination||!['map',...destinations.map(s=>s.id)].includes(id))return;
    travelling=true;
    const shell=document.querySelector('.solar-navigation');if(!shell){travelling=false;return;}
    shell.setAttribute('aria-busy','true');document.querySelector('.flight-settings')?.removeAttribute('open');
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches||!window.orbitalOffice.motion();
    const transition=document.createElement('div');transition.className=`lightspeed-transit${reduced?' still-transit':''}`;transition.setAttribute('aria-hidden','true');
    transition.innerHTML=`<div class="warp-core"></div><div class="warp-streaks">${Array.from({length:76},(_,i)=>`<i style="--angle:${i*137.508}deg;--delay:${-(i%13)*.11}s;--reach:${27+(i*17)%64}vmax;--duration:${.65+(i%7)*.06}s"></i>`).join('')}</div><div class="warp-arrival"><span>${id==='map'?'RETURNING TO':'DESTINATION'}</span><b>${esc(destinationName(id))}</b></div>`;
    shell.append(transition);shell.classList.add('is-travelling');document.querySelectorAll('.station-target').forEach(b=>b.disabled=true);
    const status=document.querySelector('#travel-status');if(status)status.textContent=`Travelling to ${destinationName(id)}.`;
    try{
      await delay(reduced?30:800);
      destination=id;shell.dataset.destination=id;
      document.querySelector('#station-anchors').innerHTML=anchorMarkup();
      const map=document.querySelector('.flight-map');if(map)map.hidden=id==='map';
      const ready=await window.orbitalOffice.remount();if(ready===false)throw new Error('The 3D station could not load.');
      const hint=document.querySelector('#orbital-hover');if(hint)hint.textContent=id==='map'?'Select a station · Drag to orbit · Scroll to zoom':'Explore your station · Select a robot or control room';
      await delay(reduced?100:1000);
      transition.classList.add('arrival');await delay(reduced?0:320);
      if(status)status.textContent=`Arrived at ${destinationName(id)}.`;
    }catch(error){if(status)status.textContent='Station graphics unavailable. The 2D office remains available.';console.error('Station travel:',error);}
    finally{transition.remove();shell.classList.remove('is-travelling');shell.removeAttribute('aria-busy');travelling=false;document.querySelectorAll('.station-target').forEach(b=>b.disabled=false);document.querySelector(id==='map'?'[data-world-travel="office"]':'[data-world-control],[data-project-system]')?.focus({preventScroll:true});}
  }
  window.aiWorldTravel=travel;
  function stationControl(id){
    if(id!=='office'){systemDistrict(id);return;}
    activeRobot='office';
    modal(`<div class="space-kicker">INTERNSHIP STATION / CONTROL ROOM</div><h2 class="detail-title">Mission control</h2><div class="station-control-grid"><button data-go="tracker">Opportunities <small>${state.opportunities.length} saved leads</small></button><button data-go="approvals">Inbox <small>${questionCount()} questions waiting</small></button><button data-go="candidate">Candidate profile <small>Your confirmed facts</small></button><button data-go="contacts">Connections <small>People and conversations</small></button><button data-go="pipeline">Flight log <small>Scout and council records</small></button><button data-delivery="all">Delivery studio <small>${dailySubmitted()} submitted today · ${window.spaceOffice.counts().ready} ready</small></button></div><div class="station-crew-controls">${workers.map(w=>`<button data-worker="${w.id}">${esc(fallbackNames[w.id]||w.name)}</button>`).join('')}</div><div class="station-control-actions"><button data-project-system="office">Project systems &amp; source</button><button data-world-chat="office">Talk to the Office</button><button data-space-add>Add opportunity</button><button data-space-refresh>Refresh records</button><button data-world-export>Export records</button></div><p class="component-purpose">These are saved records. The application workflow remains paused; robot motion is illustrative.</p>`);
  }
  window.aiWorldControl=stationControl;
  office=shell;
  modal=function(html){priorModal(html);document.querySelector('#dialog').classList.add('world-window');};
  function updateCounters(){const values={leads:state.opportunities.length,questions:questionCount(),today:`${dailySubmitted()} / 5`,ready:window.spaceOffice.counts().ready};document.querySelectorAll('[data-world-count]').forEach(el=>el.textContent=values[el.dataset.worldCount]);window.officeMotion?.mount(state);}
  render=function(){
    if(state&&view==='office'&&window.orbitalOffice?.is3D()&&document.querySelector('.ai-world-shell')){updateCounters();return;}
    if(state&&!document.querySelector('.orbital-back-3d'))view='office';
    priorRender();document.body.classList.toggle('ai-world-home',!!document.querySelector('.ai-world-shell'));
  };
  function workspace(v){
    query='';filter='all';
    const templates={tracker,approvals,contacts,candidate:candidateView,pipeline:pipelineView};
    if(!templates[v])return;
    activeRobot=v==='contacts'?'researcher':v==='approvals'?'operator':'office';
    modal(`<div class="world-window-heading"><div><span class="space-kicker">INTERNSHIP OFFICE / ${esc(names[v][2])}</span><h2>${esc(names[v][0])}</h2><p>${esc(names[v][1])}</p></div><button class="secondary" data-world-chat="${activeRobot}">Ask this system ↗</button></div><div class="world-window-tabs"><button data-go="tracker">Opportunities</button><button data-go="approvals">Inbox</button><button data-go="candidate">Profile</button><button data-go="contacts">Connections</button><button data-go="pipeline">Flight log</button></div><div class="world-workspace">${templates[v]()}</div>`);
    document.querySelector('#dialog').classList.add('world-workspace-dialog');
  }
  navigate=function(v){if(!document.querySelector('.ai-world-shell'))return priorNavigate(v);if(v==='office'){close();return;}workspace(v);};
  worker=function(id){activeRobot=id;priorWorker(id);attachChat();};
  function attachChat(){const head=document.querySelector('#dialog .inspection-head');if(head&&!head.querySelector('[data-world-chat]')){const b=document.createElement('button');b.className='robot-talk';b.dataset.worldChat=activeRobot;b.textContent='Talk to this robot ↗';head.append(b);}}
  new MutationObserver(attachChat).observe(document.querySelector('#dialog-body'),{childList:true});
  function renderChatLog(packet){
    const log=document.querySelector('#world-chat-log');if(!log)return;
    const follow=log.scrollHeight-log.scrollTop-log.clientHeight<90;
    log.innerHTML=packet.messages.map(m=>`<article class="world-message ${esc(m.role)}"><span>${m.role==='user'?'YOU':esc(title(packet.system).toUpperCase())}</span><p>${esc(m.body)}</p>${m.role==='user'&&m.status!=='completed'?`<small>${m.status==='replying'?'Preparing a reply…':m.status==='queued'?'Queued for a reply':esc(m.error||'Reply failed')}</small>`:''}</article>`).join('')||`<div class="chat-empty"><div>◈</div><h3>Talk with ${esc(title(packet.system))}.</h3><p>Ask about the work, explore an idea, or draft your next move. This is a real model conversation, separate from executing workflows.</p></div>`;
    if(follow)log.scrollTop=log.scrollHeight;
    const u=packet.usage;document.querySelector('#world-chat-usage').textContent=`${u.model} · ${u.messages}/${u.max_messages} messages today · ${u.reported_tokens.toLocaleString()} reported tokens / ${u.max_reported_tokens.toLocaleString()}`;
    const pending=packet.messages.some(m=>['queued','replying'].includes(m.status));
    document.querySelector('.chat-avatar')?.classList.toggle('replying',pending);
    document.querySelector('#world-chat-status').textContent=pending?'Reply in progress':u.unmetered_failure?'Chat paused after an unmetered failure':'Conversation ready';
    document.querySelector('#world-chat-send').disabled=pending||u.unmetered_failure;
    if(pending)startPoll();else{clearInterval(chatTimer);chatTimer=null;}
  }
  async function fetchChat(){const id=chatSystem;if(!id||!document.querySelector('#world-chat-log'))return;try{const p=await api('/api/world-chat?system='+encodeURIComponent(id));if(chatSystem!==id)return;chatState=p;renderChatLog(p);}catch(e){const error=document.querySelector('#world-chat-error');if(error){error.hidden=false;error.textContent=e.message;}clearInterval(chatTimer);chatTimer=null;}}
  function startPoll(){if(!chatTimer)chatTimer=setInterval(()=>{if(!document.hidden)fetchChat();},2500);}
  async function chat(id){
    clearInterval(chatTimer);chatTimer=null;chatSystem=id;activeRobot=id;chatState=null;
    modal(`<section class="world-chat"><div class="chat-head"><div class="chat-avatar">${chatAvatar(id)}</div><div><span class="space-kicker">PRIVATE SYSTEM CONVERSATION</span><h2>${esc(title(id))}</h2><small id="world-chat-status">Loading conversation…</small></div></div><div class="chat-navigation"><button data-world-chat="office">Office</button><button data-world-chat="${id}" class="active">${esc(title(id))}</button><button data-world-source="${id}">Chat instructions</button>${workers.some(w=>w.id===id)?`<button data-worker="${id}">Workflow + records</button>`:''}</div><div id="world-chat-log" class="world-chat-log" aria-live="polite"></div><form id="world-chat-form"><label for="world-chat-input" class="sr-only">Message ${esc(title(id))}</label><textarea id="world-chat-input" name="body" maxlength="3000" required placeholder="Ask ${esc(title(id))}…" rows="2"></textarea><button id="world-chat-send" type="submit">Send ↗</button></form><p id="world-chat-error" class="form-error" hidden></p><div id="world-chat-usage" class="chat-usage">Loading usage…</div><p class="chat-boundary">Replies use your ChatGPT allowance. Graphics and polling use no model calls. Chat does not run, approve, send or submit a workflow.</p></section>`);
    document.querySelector('#dialog').classList.add('world-chat-dialog');
    const form=document.querySelector('#world-chat-form');
    form.onsubmit=async e=>{e.preventDefault();const text=form.elements.body.value.trim();if(!text)return;const send=document.querySelector('#world-chat-send');send.disabled=true;const error=document.querySelector('#world-chat-error');error.hidden=true;try{const packet=await api('/api/world-chat',{system:id,body:text,request_key:crypto.randomUUID()});if(chatSystem!==id)return;form.elements.body.value='';chatState=packet;renderChatLog(packet);}catch(e){error.textContent=e.message;error.hidden=false;send.disabled=false;}};
    await fetchChat();
  }
  function systemDistrict(id){
    activeRobot=id;
    const descriptions={interview:'Practice finance interview questions in a private conversation. The separate graded interview application is not connected yet.',video:'Plan scripts, hooks, editing briefs and demonstrations. Footage upload and the edity rendering workspace are not connected yet.',accounting:'Develop outreach ideas and draft messages. The separate live prospect database, email verification and Gmail sender are not connected yet.'};
    modal(`<div class="space-kicker">YOUR AI WORLD / PROJECT STATION</div><h2 class="detail-title">${esc(title(id))}</h2><p class="component-purpose">${esc(descriptions[id]||'This docking platform is reserved for a future system.')}</p><div class="district-capabilities"><span>◈ Conversational assistant connected</span><span>◎ Separate execution tools not connected</span></div><div class="station-control-actions"><button class="primary" data-project-system="${id}">Project systems &amp; source ↗</button><button data-world-chat="${id}">Enter conversation ↗</button></div>`);
  }
  function projectSystem(id,module=null){
    const p=projectCatalog.find(p=>p.id===id);
    if(!p){modal('<h2>Project information is unavailable</h2><p>Please refresh and try again.</p>');return;}
    const m=module===null?null:p.workflow[Number(module)];
    const repo=p.repository?`<a class="project-link" href="${esc(p.repository)}" target="_blank" rel="noopener noreferrer">View GitHub repository ↗</a>`:'<span class="project-source-status">GitHub repository publication pending</span>';
    const source=p.package?`<a class="project-link secondary" href="/project-source/${esc(p.package)}.zip" download>Download source snapshot ↓</a>`:'';
    modal(`<section class="project-system"><div class="space-kicker">${esc(destinationName(id))} / PROJECT SYSTEMS</div><h2 class="detail-title">${esc(p.name)}</h2><p class="component-purpose">${esc(p.summary)}</p><div class="project-system-actions">${p.preview?`<a class="project-link" href="${esc(p.preview)}" target="_blank" rel="noopener noreferrer">Explore project demo ↗</a>`:''}${repo}${source}</div>${p.visibility==='private'?'<p class="project-source-status">This repository is private. Visitors need GitHub access to read its code.</p>':''}<div class="project-brain"><div class="space-kicker">WORKFLOW CIRCUIT / SELECT A COMPONENT</div><div class="project-circuit">${p.workflow.map((step,i)=>`<button data-project-system="${id}" data-project-module="${i}" class="${m===step?'active':''}"><em>${String(i+1).padStart(2,'0')}</em><span>${esc(step.name)}</span><i>◈</i></button>`).join('')}</div></div>${m?`<article class="project-component"><h3>${esc(m.name)}</h3><p>${esc(m.description)}</p><div class="project-source-files">${m.files.map(file=>p.repository?`<a href="${esc(p.repository)}/blob/main/${esc(file)}" target="_blank" rel="noopener noreferrer">${esc(file)} ↗</a>`:`<code>${esc(file)}</code>`).join('')}</div></article>`:'<p class="component-purpose">Select a workflow component to see how it works and the files behind it.</p>'}<p class="project-source-status">Public demos use sample content. Live application, media and email actions keep their existing authorization requirements.</p></section>`);
  }
  window.aiWorldDistrict=selection=>{if(selection.id==='expansion'){modal('<div class="space-kicker">WORLD EXPANSION</div><h2 class="detail-title">Room for your next system.</h2><p class="component-purpose">New systems can use this shared world renderer and get their own district, workflows and conversation. This docking platform has no connected system yet.</p>');return;}systemDistrict({outreach:'accounting',interview:'interview',video:'video'}[selection.id]);};
  document.addEventListener('click',e=>{
    const t=e.target.closest('[data-world-chat],[data-world-district],[data-world-source],[data-world-export],[data-world-travel],[data-world-control],[data-project-system]');if(!t)return;
    if(t.dataset.projectSystem)projectSystem(t.dataset.projectSystem,t.hasAttribute('data-project-module')?t.dataset.projectModule:null);
    if(t.dataset.worldTravel)travel(t.dataset.worldTravel);
    if(t.dataset.worldControl)stationControl(t.dataset.worldControl);
    if(t.dataset.worldChat)chat(t.dataset.worldChat);
    if(t.dataset.worldDistrict)systemDistrict(t.dataset.worldDistrict);
    if(t.dataset.worldSource)modal(`<div class="space-kicker">EXACT CHAT ROLE / ${esc(title(t.dataset.worldSource))}</div><h2 class="detail-title">Conversation instructions</h2><pre class="chat-role-source">${esc(registry[t.dataset.worldSource]?.role||'Role source unavailable.')}</pre><h3>Common runtime instructions</h3><pre class="chat-role-source">${esc(commonInstructions||'Common source unavailable.')}</pre><p class="component-purpose">Source: config/world-systems.json and config/world-chat-instructions.txt. This is a conversational role; it does not replace the execution workflow or five council reviewers.</p>`);
    if(t.hasAttribute('data-world-export'))document.querySelector('#export').click();
  });
  document.querySelector('#dialog').addEventListener('close',()=>{clearInterval(chatTimer);chatTimer=null;chatSystem=null;document.querySelector('#dialog').classList.remove('world-chat-dialog','world-workspace-dialog');});
  // Replacing a chat with a records/workflow dialog stops its polling.
  new MutationObserver(()=>{if(!document.querySelector('#world-chat-log')){clearInterval(chatTimer);chatTimer=null;chatSystem=null;document.querySelector('#dialog').classList.remove('world-chat-dialog');}if(!document.querySelector('.world-workspace'))document.querySelector('#dialog').classList.remove('world-workspace-dialog');}).observe(document.querySelector('#dialog-body'),{childList:true});
  api('/projects.json').then(r=>projectCatalog=r).catch(()=>{});
  api('/api/world-systems').then(r=>registry=r).catch(()=>{});
  api('/api/world-chat-instructions').then(r=>commonInstructions=r.common).catch(()=>{});
  if(state){view='office';priorRender();document.body.classList.add('ai-world-home');}
})();
