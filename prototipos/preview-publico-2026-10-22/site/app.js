const carousel = document.querySelector('.carousel');
if (carousel) {
 const frame=carousel.closest('.carousel-frame'), originals=[...carousel.children], count=originals.length;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const clone=card=>{const copy=card.cloneNode(true);copy.dataset.clone='true';copy.setAttribute('aria-hidden','true');copy.querySelectorAll('a,button,[tabindex]').forEach(a=>a.tabIndex=-1);return copy;};
 originals.forEach(card=>carousel.append(clone(card)));
 originals.slice().reverse().forEach(card=>carousel.prepend(clone(card)));
 const step=()=>originals[0].getBoundingClientRect().width+parseFloat(getComputedStyle(carousel).gap);
 const resetPosition=()=>{carousel.scrollLeft=count*step();frame.style.setProperty('--arrow-y',`${originals[0].querySelector('.card-photo').getBoundingClientRect().height+3}px`);};
 let moving=false, settling, paused=false,hover=false,focused=false,visible=true;
 const normalize=()=>{const band=count*step(),left=carousel.scrollLeft;if(left<band-2)carousel.scrollLeft=left+band;else if(left>=2*band-2)carousel.scrollLeft=left-band;moving=false;};
 carousel.addEventListener('scroll',()=>{clearTimeout(settling);settling=setTimeout(normalize,140);});
 const advance=direction=>{if(moving)return;moving=true;carousel.scrollBy({left:direction*step(),behavior:reduced.matches?'instant':'smooth'});if(reduced.matches)normalize();};
 frame.querySelectorAll('[data-direction]').forEach(button=>button.addEventListener('click',()=>advance(Number(button.dataset.direction))));
 frame.addEventListener('pointerenter',()=>hover=true);frame.addEventListener('pointerleave',()=>hover=false);
 frame.addEventListener('focusin',()=>focused=true);frame.addEventListener('focusout',e=>{focused=frame.contains(e.relatedTarget);});
 carousel.addEventListener('touchstart',()=>hover=true,{passive:true});carousel.addEventListener('touchend',()=>{hover=false;},{passive:true});
 const toggle=document.querySelector('#carousel-toggle');
 const syncToggle=()=>{toggle.textContent=paused?'Retomar movimento':'Pausar movimento';toggle.setAttribute('aria-pressed',String(paused));};
 toggle.addEventListener('click',()=>{paused=!paused;syncToggle();});
 reduced.addEventListener('change',()=>{paused=reduced.matches;syncToggle();});paused=reduced.matches;syncToggle();
 new IntersectionObserver(entries=>visible=entries[0].isIntersecting).observe(carousel);
 setInterval(()=>{if(!paused&&!hover&&!focused&&visible&&!document.hidden&&!document.querySelector('dialog[open]'))advance(1);},4000);
 resetPosition();window.addEventListener('resize',resetPosition);
}
document.querySelectorAll('.search-form').forEach(form=>{
 const checkin=form.elements.checkin,checkout=form.elements.checkout;
 const update=()=>{ if(checkin.value){const next=new Date(checkin.value+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);checkout.min=next.toISOString().slice(0,10);} };
 checkin.addEventListener('change',update);update();
});
// Swap the selected photo with the large frame, preserving each image exactly once.
document.querySelectorAll('.gallery').forEach(gallery=>{
 const main=gallery.querySelector('.gallery-main img'),caption=gallery.querySelector('figcaption');
 let current=Number(gallery.dataset.galleryInitial || 1);
 gallery.querySelectorAll('[data-gallery-image]').forEach(button=>button.addEventListener('click',()=>{
  const thumb=button.querySelector('img'),oldSrc=main.getAttribute('src'),next=Number(button.dataset.galleryImage);
  main.src=thumb.getAttribute('src');thumb.src=oldSrc;
  main.alt=main.alt.replace(/Foto \d+/,`Foto ${next}`);caption.textContent=caption.textContent.replace(/^\d+/,String(next));
  button.dataset.galleryImage=String(current);button.setAttribute('aria-label',button.getAttribute('aria-label').replace(/foto \d+/,`foto ${current}`));current=next;
 }));
});

const iso=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const localDate=value=>new Date(value+'T12:00:00');
const dayAfter=value=>{const d=localDate(value);d.setDate(d.getDate()+1);return iso(d);};
const displayDate=value=>value?value.split('-').reverse().join('/'):'Escolha a data';
document.querySelectorAll('.search-form').forEach(form=>{
 const checkin=form.elements.checkin,checkout=form.elements.checkout;
 const dialog=document.createElement('dialog');dialog.className='calendar-dialog';dialog.setAttribute('aria-label','Escolha uma data');
 dialog.innerHTML='<p class="calendar-title"></p><p class="calendar-context"></p><div class="calendar-top"><button type="button" aria-label="Mês anterior">←</button><strong class="calendar-month" aria-live="polite"></strong><button type="button" aria-label="Próximo mês">→</button></div><div class="calendar-weekdays" aria-hidden="true"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div><div class="calendar-grid"></div><button class="calendar-close" type="button">Fechar calendário</button>';
 document.body.append(dialog);
 let active,month,opener;
 const triggers=new Map();
   const refresh=()=>triggers.forEach((button,input)=>{
   const kind=input===checkin?'entrada':'saída',value=displayDate(input.value);
   button.querySelector('span').textContent=value;
   button.setAttribute('aria-label',`Escolher data de ${kind}: ${value}`);
  });
 const position=()=>{if(!opener||!dialog.open)return;const rect=opener.getBoundingClientRect(),w=dialog.offsetWidth,h=dialog.offsetHeight;dialog.style.left=`${Math.max(12,Math.min(rect.left,innerWidth-w-12))}px`;dialog.style.top=`${Math.max(12,Math.min(rect.bottom+10,innerHeight-h-12))}px`;};
 const open=input=>{active=input;opener=triggers.get(input);const base=input===checkout&&checkin.value?(checkout.value>=checkout.min?checkout.value:dayAfter(checkin.value)):(input.value||input.min);month=localDate(base);month.setDate(1);render();if(!dialog.open)dialog.showModal();position();const target=dialog.querySelector('[aria-pressed=true]:not(:disabled)')||dialog.querySelector('.calendar-grid button:not(:disabled)');target?.focus();};
 const render=()=>{
  dialog.querySelector('.calendar-title').textContent=active===checkin?'1 · Escolha a entrada':'2 · Escolha a saída';
  dialog.querySelector('.calendar-context').textContent=active===checkout&&checkin.value?`Entrada: ${displayDate(checkin.value)} · agora escolha a saída`:'Primeiro, o dia de chegada.';
  dialog.querySelector('.calendar-month').textContent=month.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  const grid=dialog.querySelector('.calendar-grid');grid.replaceChildren();
  const last=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  for(let i=0;i<month.getDay();i++)grid.append(document.createElement('span'));
  for(let n=1;n<=last;n++){
   const d=new Date(month.getFullYear(),month.getMonth(),n,12),value=iso(d),button=document.createElement('button');button.type='button';button.textContent=n;button.dataset.date=value;button.disabled=value<active.min;button.setAttribute('aria-label',d.toLocaleDateString('pt-BR',{day:'numeric',month:'long',year:'numeric'}));button.setAttribute('aria-pressed',String(value===active.value));if(active===checkout&&value===checkin.value){button.classList.add('checkin-marker');button.setAttribute('aria-label',button.getAttribute('aria-label')+' — entrada selecionada');}
   button.addEventListener('click',()=>{active.value=value;active.dispatchEvent(new Event('change',{bubbles:true}));if(active===checkin){checkout.min=dayAfter(value);if(checkout.value<checkout.min)checkout.value='';refresh();open(checkout);}else{refresh();dialog.close();}});grid.append(button);
  }
  const endPrevious=new Date(month.getFullYear(),month.getMonth(),0,12);dialog.querySelector('[aria-label="Mês anterior"]').disabled=iso(endPrevious)<active.min;
 };
 [checkin,checkout].forEach(input=>{
  const label=input.closest('label'),button=document.createElement('button');button.type='button';button.className='date-trigger';button.setAttribute('aria-label',input===checkin?'Escolher data de entrada':'Escolher data de saída');button.setAttribute('aria-haspopup','dialog');button.innerHTML='<span></span><span aria-hidden="true">▦</span>';label.classList.add('enhanced');label.append(button);input.tabIndex=-1;input.setAttribute('aria-hidden','true');triggers.set(input,button);
  button.addEventListener('click',()=>open(input));label.addEventListener('click',e=>{if(e.target===label){e.preventDefault();open(input);}});input.addEventListener('invalid',e=>{e.preventDefault();if(!dialog.open)open(input);});
 });
 dialog.querySelector('[aria-label="Mês anterior"]').addEventListener('click',()=>{month.setMonth(month.getMonth()-1);render();});dialog.querySelector('[aria-label="Próximo mês"]').addEventListener('click',()=>{month.setMonth(month.getMonth()+1);render();});dialog.querySelector('.calendar-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>opener?.focus());window.addEventListener('resize',position);
 dialog.querySelector('.calendar-grid').addEventListener('keydown',e=>{if(!e.target.dataset.date)return;const steps={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};if(!(e.key in steps))return;e.preventDefault();const d=localDate(e.target.dataset.date);d.setDate(d.getDate()+steps[e.key]);if(iso(d)<active.min)return;month=new Date(d.getFullYear(),d.getMonth(),1,12);render();dialog.querySelector(`[data-date="${iso(d)}"]`)?.focus();});
 refresh();
});

