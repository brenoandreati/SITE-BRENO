// Copia app/datas.js para dentro de servidor/Codigo.gs (o Google precisa de um arquivo só).
// Uso: node ferramentas/servidor.mjs            → atualiza a cópia
//      node ferramentas/servidor.mjs --conferir → só confere se está igual
import { readFileSync, writeFileSync } from 'node:fs';

const raiz = new URL('..', import.meta.url);
const caminhoGs = new URL('servidor/Codigo.gs', raiz);
const INICIO = '// ===== INÍCIO: cópia de app/datas.js';
const FIM = '// ===== FIM: cópia de app/datas.js =====';

export function montar() {
  const gs = readFileSync(caminhoGs, 'utf8');
  const datas = readFileSync(new URL('app/datas.js', raiz), 'utf8').trim();
  const i = gs.indexOf(INICIO);
  const f = gs.indexOf(FIM);
  if (i < 0 || f < 0) throw new Error('Marcadores não encontrados em servidor/Codigo.gs');
  const linhaInicio = gs.indexOf('\n', i) + 1;
  return { atual: gs, novo: gs.slice(0, linhaInicio) + datas + '\n' + gs.slice(f) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { atual, novo } = montar();
  if (process.argv.includes('--conferir')) {
    if (atual !== novo) {
      console.error('servidor/Codigo.gs está desatualizado. Rode: npm run servidor');
      process.exit(1);
    }
    console.log('servidor/Codigo.gs em dia.');
  } else {
    writeFileSync(caminhoGs, novo);
    console.log(atual === novo ? 'servidor/Codigo.gs já estava em dia.' : 'servidor/Codigo.gs atualizado.');
  }
}
