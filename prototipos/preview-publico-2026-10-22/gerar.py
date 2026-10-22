"""Exportação visual isolada; não executa o servidor nem as integrações do acervo."""
from pathlib import Path
import re, json, shutil, hashlib

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / 'scl-publico-main-20261022/scl-reconstrucao-main/prototipos/acervo-visual-2026-10/site-publico'
DEST = ROOT / 'site'
DEST.mkdir(exist_ok=True)
PAGES = ['index.html', 'imoveis.html', 'consulta.html'] + [f'imovel-{n}.html' for n in ['102','103','303','399','403']]
for name in PAGES:
    html = (SOURCE / name).read_text()
    html = html.replace('Prévia privada · Reservas e pagamentos ainda não estão habilitados', 'Estudo visual · catálogo de referência · sem reservas ou pagamentos')
    html = html.replace('action="disponibilidade"', 'action="consulta.html"')
    html = html.replace('Consulte as datas para receber disponibilidade, total e condições.', 'Explore as datas neste estudo. Disponibilidade e valores são consultados no site oficial.')
    html = html.replace('Escolha suas datas. A disponibilidade será confirmada antes de reservar.', 'Experimente a navegação. Esta prévia não verifica disponibilidade.')
    html = re.sub(r' · (102|103|303|399|403)(?=</option>)', '', html)
    html = re.sub(r'SUA CASA (102|103|303|399|403)', 'LEBLON · RIO DE JANEIRO', html)
    html = html.replace('href="privacidade.html"', 'href="https://www.suacasaleblon.com/privacidade"')
    html = html.replace('</footer>', '<div class="preview-legal"><a href="https://www.suacasaleblon.com/termos">Termos de uso atuais ↗</a><a href="https://www.suacasaleblon.com/privacidade">Privacidade atual ↗</a><a href="https://www.suacasaleblon.com/cancelamento">Cancelamento atual ↗</a><span>Estas páginas apresentam o desenho. O catálogo e as condições oficiais são mantidos no sistema atual.</span></div></footer>')
    # Fotos de estabelecimentos do bairro: direitos pendentes no README do acervo.
    html = re.sub(r'<img[^>]+src="images/places/[^>]+>', '<div class="place-art preview-place" aria-hidden="true">↗</div>', html)
    html = html.replace('<script src="app.js" defer>', '<script src="preview.js" defer></script><script src="app.js" defer>')
    html = html.replace('</head>', '<link rel="stylesheet" href="preview.css"></head>')
    if name == 'consulta.html':
        start = html.index('<aside class="checkout-summary">')
        end = html.index('</aside>', start) + len('</aside>')
        html = html[:start] + '''<aside class="checkout-summary"><p class="eyebrow">SUA ESTADIA, SEM SURPRESAS</p><h2>Imagine sua próxima viagem.</h2><p id="trip-summary" aria-live="polite">Escolha as datas e explore as casas deste estudo.</p><p>Esta é uma demonstração de navegação. Não consulta disponibilidade, não calcula preços e não envia dados à equipe.</p><a class="button" href="https://www.suacasaleblon.com/consulta">Abrir o site oficial ↗</a><p class="form-hint">Você sairá desta prévia.</p></aside>''' + html[end:]
        html = html.replace('Tire suas dúvidas por aqui.', 'Explore as casas neste estudo visual.')
        html = html.replace('</main>', '<section class="section preview-results" id="resultados" aria-labelledby="result-title"><p class="eyebrow">CATÁLOGO DE REFERÊNCIA</p><h2 id="result-title">Um lugar para os seus dias.</h2><p>Casas compatíveis com o número de hóspedes informado. Disponibilidade e preços não verificados.</p><div id="preview-results" class="preview-result-grid"></div></section></main>')
    (DEST / name).write_text(html)

(DEST / 'styles.css').write_text((SOURCE / 'styles.css').read_text())
# Somente galeria, carrossel e calendário. O código de POST do acervo fica fora do pacote.
(DEST / 'app.js').write_text((SOURCE / 'app.js').read_text().split('async function submitLocalForm')[0])
for f in SOURCE.joinpath('images').rglob('*'):
    if f.is_file() and 'places' not in f.relative_to(SOURCE).parts:
        out = DEST / f.relative_to(SOURCE)
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, out)
for f in ['preview.js', 'preview.css', 'vercel.json']:
    shutil.copyfile(ROOT / f, DEST / f)
(DEST / 'robots.txt').write_text('User-agent: *\nDisallow: /\n')
manifest = {str(f.relative_to(DEST)): hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(DEST.rglob('*')) if f.is_file()}
(ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(f'{len(manifest)} arquivos; originais preservados.')
