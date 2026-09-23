import {beginDemo,eventDemo} from './payment-demo.mjs';
const root=document.querySelector('[data-payment-demo]');
if(root){
 let state,sequence=0;
 const status=root.querySelector('[role=status]'),start=root.querySelector('[data-start]'),controls=root.querySelector('fieldset');
 const labels={PENDING:'Aguardando pagamento fictício. Sua reserva ainda não está confirmada.',CONFIRMED_DEMO:'Simulação concluída: pagamento e datas verificados no cenário fictício. Nenhuma reserva real foi criada e nenhum e-mail foi enviado.',REFUSED:'Pagamento fictício recusado. Nada foi cobrado.',EXPIRED:'Tentativa fictícia expirada. É necessário revalidar as datas antes de uma nova tentativa.',CANCELLED:'Tentativa fictícia cancelada. Nenhuma cobrança real.',REVIEW_REQUIRED:'Precisamos conferir esta tentativa. Um pagamento informado sem datas garantidas, com dados divergentes ou fora de prazo não confirma a reserva.',BLOCKED:'Disponibilidade não confirmada. Não é possível iniciar nem a tentativa deste cenário.'};
 const render=()=>{status.textContent=labels[state.state];root.querySelector('[data-reference]').textContent=state.id||'Nenhuma tentativa';};
 start.addEventListener('click',()=>{state=beginDemo({totalCents:Number(root.dataset.total),availability:root.dataset.availability,id:'DEMO-'+crypto.randomUUID()});start.disabled=true;controls.disabled=state.state==='BLOCKED';render();});
 root.querySelector('[data-apply]').addEventListener('click',()=>{const scenario=root.querySelector('select').value;const event={id:'event-'+(++sequence),type:scenario,amountCents:state.totalCents,currency:'BRL',reference:state.id,inventoryVerified:true};if(scenario==='inventory_lost'){event.type='approved';event.inventoryVerified=false;}state=eventDemo(state,event);render();});
 root.querySelector('[data-reset]').addEventListener('click',()=>{state=undefined;start.disabled=false;controls.disabled=true;status.textContent='Revise o total e inicie uma nova simulação. Nada será cobrado.';root.querySelector('[data-reference]').textContent='Nenhuma tentativa';});
}
