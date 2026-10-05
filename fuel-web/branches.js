const branchesPanel=document.createElement('section');branchesPanel.innerHTML='<div class="section-title">Zorro · Cannabis · Soros</div><button id="combined-branches">Open combined map</button><p>Recorded links and unresolved bridges. Search-result co-occurrence is excluded.</p>';
$('#evidence').after(branchesPanel);
function showCombinedBranches(){
 const groups=D.networkBranches;if(!groups)return;
 const chosen=new Set(Object.values(groups).flat().filter(id=>byId.has(id)));
 // Use recorded graph edges only, never search matches or guessed bridge edges.
 const edges=D.edges.filter(e=>chosen.has(e.a)&&chosen.has(e.b)&&!e.id.startsWith('auto_')&&e.sourceStatus!=='missing');
 const saved=new Map([...chosen].map(id=>[id,{x:byId.get(id).x,y:byId.get(id).y}]));
 Object.entries(groups).forEach(([name,ids],column)=>ids.filter(id=>byId.has(id)).forEach((id,i)=>{byId.get(id).x=column*800+(i%3)*245;byId.get(id).y=Math.floor(i/3)*145;}));
 state.view='all';state.focus=null;state.selected=null;state.evidence='all';state.query='';pathIds=chosen;pathEdgeIds=new Set(edges.map(e=>e.id));syncControls();render();fit(false);
 $('#view-title').textContent='Zorro · Cannabis · Soros';$('#path-status').textContent='Three recorded branches · open gaps are not asserted connections';
 tab('inspect');$('#inspector').innerHTML=`<div class="eyebrow">COMBINED RESEARCH MAP</div><h2>Three branches, exact relationship types.</h2><p>${chosen.size} nodes · ${edges.length} recorded relationships</p><h3>Cannabis / petroleum</h3><p>Pinnacle Analytics and the saved SC Labs testing claim connect to the Dallas / Elm Street branch. Address claims remain leads.</p><h3>Zorro</h3><p>This view uses the existing Texas Zorro Ranch LLC node and Ahern branch. It is not a merge with the separate New Mexico entity.</p><h3>Soros</h3><p>Soros Business & Management Foundation retains its archival service-address lead at 80 State Street. Soros Fund Management is a separate entity.</p><h3>Open bridges</h3><p>No independently validated cannabis-to-Zorro or cannabis-to-Soros ownership bridge is present in the recovered sources. Disconnected sections remain visible. Shared addresses and agents retain their stated meaning.</p><p>Click a connection to read its source status. Export HD PNG saves this combined view.</p>`;
 // Keep the branch arrangement for this displayed view; restore coordinates when leaving it.
 const restore=()=>{for(const [id,p] of saved)Object.assign(byId.get(id),p);};
 document.querySelectorAll('[data-view],#reset,#combined-branches').forEach(b=>b.addEventListener('click',restore,{once:true,capture:true}));
}
$('#combined-branches').onclick=showCombinedBranches;
if(location.hash==='#branches')showCombinedBranches();
