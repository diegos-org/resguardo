export const initialProperties = [
 {id:'DEMO-01',title:'Studio Jardim',district:'Leblon',capacity:2,description:'Um exemplo de cadastro para experimentar o painel.',amenities:['Wi-Fi','Ar-condicionado'],photo:'illustration',mode:'full'},
 {id:'DEMO-02',title:'Studio Varanda',district:'Leblon',capacity:2,description:'',amenities:['Wi-Fi'],photo:'',mode:'full'},
 {id:'DEMO-03',title:'Apartamento Horizonte',district:'Leblon',capacity:4,description:'Cadastro fictício, sem vínculo com imóvel real.',amenities:['Wi-Fi','Cozinha'],photo:'illustration',mode:'full'}
];
export function missingFields(p){
 const missing=[];
 if(!p.title?.trim())missing.push('Título');
 if(!p.district?.trim())missing.push('Bairro');
 if(!Number.isInteger(p.capacity)||p.capacity<1||p.capacity>20)missing.push('Capacidade entre 1 e 20');
 if(!p.description?.trim())missing.push('Descrição');
 if(!Array.isArray(p.amenities)||p.amenities.filter(a=>a.trim()).length<2)missing.push('Pelo menos duas comodidades');
 if(p.photo!=='illustration')missing.push('Imagem demonstrativa');
 if(p.mode!=='full')missing.push('Gestão completa');
 return missing;
}
export function updateDraft(items,id,values){
 const previous=items.find(p=>p.id===id);
 if(!previous)throw new Error('Cadastro não encontrado');
 const next={...previous,title:String(values.title||'').trim().slice(0,100),district:String(values.district||'').trim().slice(0,80),capacity:Number(values.capacity),description:String(values.description||'').trim().slice(0,1500),amenities:values.amenities.filter(x=>typeof x==='string').map(x=>x.trim()).filter(Boolean).slice(0,12),photo:values.photo==='illustration'?'illustration':'',mode:'full'};
 return items.map(p=>p.id===id?next:p);
}
