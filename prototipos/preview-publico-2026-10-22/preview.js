// Apenas navegação local. Nenhum fetch, armazenamento, pagamento ou envio de consulta.
const previewParams = new URLSearchParams(location.search);
const previewHomes = [
  ['102', 'Studio Inteligente Leblon', 2], ['103', 'Studio Boutique Leblon', 2],
  ['303', 'Quadra Praia Leblon', 6], ['399', 'Studio Orgânico Leblon', 2],
  ['403', 'Studio Mezanino Leblon', 4],
];
const previewToday = new Date();
const previewMin = `${previewToday.getFullYear()}-${String(previewToday.getMonth()+1).padStart(2,'0')}-${String(previewToday.getDate()).padStart(2,'0')}`;
const previewDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value));
document.querySelectorAll('.search-form').forEach(form => {
  for (const key of ['property','checkin','checkout','guests']) {
    const field = form.elements[key], value = previewParams.get(key);
    if (field.type === 'date') field.min = previewMin;
    if (!value) continue;
    if (field.type === 'date' && previewDate(value) && value >= previewMin) field.value = value;
    else if (field.tagName === 'SELECT' && [...field.options].some(o => o.value === value)) field.value = value;
  }
  form.addEventListener('submit', e => {
    if (form.elements.checkout.value <= form.elements.checkin.value) {
      e.preventDefault(); form.elements.checkout.value = ''; form.reportValidity();
    }
  });
});
const previewResults = document.querySelector('#preview-results');
if (previewResults) {
  const guests = Math.max(1, Math.min(6, Number(previewParams.get('guests')) || 2));
  const property = previewParams.get('property');
  const selected = previewHomes.filter(([id,,capacity]) => (!property || id === property) && capacity >= guests);
  for (const [id,name,capacity] of selected) {
    const card = document.createElement('a'); card.className = 'preview-result';
    const params = new URLSearchParams();
    for (const key of ['checkin','checkout','guests']) if (previewParams.has(key)) params.set(key,previewParams.get(key));
    card.href = `imovel-${id}.html?${params}`;
    const img = document.createElement('img'); img.src = `images/gallery/${id}-1.jpg`; img.alt = name; img.loading = 'lazy';
    const title = document.createElement('h3'); title.textContent = name;
    const note = document.createElement('p'); note.textContent = `Até ${capacity} hóspedes · conhecer a casa ↗`;
    card.append(img,title,note); previewResults.append(card);
  }
  if (!selected.length) previewResults.textContent = 'Nenhuma casa deste estudo corresponde à combinação escolhida. Experimente buscar em todos os imóveis.';
  const checkin = previewParams.get('checkin'), checkout = previewParams.get('checkout');
  if (previewDate(checkin) && previewDate(checkout) && checkout > checkin) document.querySelector('#trip-summary').textContent = `${checkin.split('-').reverse().join('/')} a ${checkout.split('-').reverse().join('/')} · ${guests} hóspede(s). Datas apenas ilustrativas; disponibilidade a confirmar no site oficial.`;
}
