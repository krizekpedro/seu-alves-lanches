// Gera as páginas estáticas do protótipo a partir dos arquivos .dc.html.
// Uso: node prototipo/build.mjs <pasta-com-os-.dc.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
const LOGO = 'https://assets.olaclick.app/companies/logos/01bf6473-9273-413d-93dd-c51f71faf7b4.webp';

const pages = [
  { file: 'Main.dc.html', out: 'painel.html', title: 'Seu Alves · Painel de gestão', phone: false },
  { file: 'Celular.dc.html', out: 'app-dono.html', title: 'Seu Alves · App do dono', phone: true },
  { file: 'Funcionario.dc.html', out: 'funcionario.html', title: 'Seu Alves · Área do funcionário', phone: true },
  { file: 'Cliente.dc.html', out: 'cliente.html', title: 'Seu Alves · Cardápio e acompanhamento', phone: true },
];

const runtime = readFileSync(join(here, 'runtime.js'), 'utf8');

for (const p of pages) {
  const raw = readFileSync(join(src, p.file), 'utf8');
  const xdc = raw.split('<x-dc>')[1].split('</x-dc>')[0];
  const helmet = xdc.split('<helmet>')[1].split('</helmet>')[0];
  let tpl = xdc.split('</helmet>')[1];
  // Monograma "SA" vira o logo do Seu Alves (com o monograma de reserva se a imagem não carregar)
  tpl = tpl.replace(/(<div style="[^"]*?)display: flex; align-items: center; justify-content: center;([^"]*)">SA<\/div>/g,
    (_, a, b) => `${a}display: flex; align-items: center; justify-content: center;${b} overflow: hidden; padding: 0;"><img src="${LOGO}" alt="Seu Alves Lanches" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.replaceWith('SA')"></div>`);
  const script = raw.split('data-dc-script')[1].split('>').slice(1).join('>').split('</script>')[0];
  const phoneCss = p.phone ? `
html,body{height:100%}
body{display:flex;justify-content:center;align-items:center;min-height:100dvh;background:radial-gradient(circle at 50% 0%,#2a1212 0%,#0F0F0F 60%)}
#app>div{width:min(430px,100vw) !important;height:min(900px,100dvh) !important}
@media (min-width:500px){#app>div{border-radius:28px;border:1px solid rgba(245,158,11,.25);box-shadow:0 30px 80px rgba(0,0,0,.6)}}` : '';
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.title}</title>
<link rel="icon" href="${LOGO}">
${helmet.trim()}
<style>*{box-sizing:border-box}${phoneCss}
.proto-back{position:fixed;left:12px;bottom:12px;z-index:50;padding:8px 12px;border-radius:99px;background:rgba(15,15,15,.85);border:1px solid rgba(245,158,11,.4);color:#FBBF24;font:600 12px Inter,system-ui,sans-serif;text-decoration:none}
@media (max-width:499px){.proto-phone .proto-back{display:none}}</style>
</head>
<body class="${p.phone ? 'proto-phone' : ''}">
<div id="app"></div>
<a class="proto-back" href="./">← Todas as telas</a>
<template id="tpl">${tpl}</template>
<script>
${runtime}
</script>
<script>
${script}
DC.mount(Component);
</script>
</body>
</html>
`;
  writeFileSync(join(here, p.out), html);
  console.log('gerado', p.out, Math.round(html.length / 1024) + ' KB');
}
