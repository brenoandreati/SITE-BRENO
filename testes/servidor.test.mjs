// Servidor (worker/) com o banco imitado em testes/d1-falso.mjs e o CallMeBot falso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from '../worker/index.mjs';
import { rodarAvisos, limpar } from '../worker/avisos.mjs';
import { criarD1 } from './d1-falso.mjs';

// CallMeBot falso: guarda o que foi mandado
let whats = [];
let respostaWhats = () => ({ status: 200, corpo: '<p>Message queued. You will receive it in a few seconds.</p>' });
globalThis.fetch = async (url) => {
  const u = new URL(url);
  assert.equal(u.origin, 'https://callmebot.teste');
  whats.push({ phone: u.searchParams.get('phone'), text: u.searchParams.get('text'), apikey: u.searchParams.get('apikey') });
  const r = respostaWhats();
  return new Response(r.corpo, { status: r.status });
};

function servidor() {
  whats = [];
  respostaWhats = () => ({ status: 200, corpo: '<p>Message queued. You will receive it in a few seconds.</p>' });
  const db = criarD1();
  const env = { DB: db, CALLMEBOT_URL: 'https://callmebot.teste', ASSETS: { fetch: async (r) => new Response('arquivo ' + new URL(r.url).pathname) } };
  async function api(metodo, caminho, corpo, token, ip = '10.0.0.1') {
    const headers = { 'content-type': 'application/json', 'cf-connecting-ip': ip };
    if (token) headers.authorization = 'Bearer ' + token;
    const r = await worker.fetch(new Request('https://agenda.teste/api/' + caminho, {
      method: metodo, headers, body: metodo === 'GET' ? undefined : JSON.stringify(corpo || {})
    }), env);
    return { status: r.status, ...(await r.json()) };
  }
  return { db, env, api };
}

// No app, a senha vira PBKDF2 antes de sair do aparelho; aqui basta um hash qualquer
const senha = (s) => createHash('sha256').update('senha:' + s).digest('hex');

async function criarConta(s, nome = 'Breno', email = 'breno@exemplo.com', extra = {}) {
  const r = await s.api('POST', 'cadastro', { nome, email, senha: senha('segredo123'), fuso: 'America/Sao_Paulo', ...extra });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r;
}

const evento = (dados) => ({ id: 'e-' + Math.random().toString(36).slice(2), titulo: 'Teste', data: '2026-10-15', atualizado: new Date().toISOString(), avisos: [], ...dados });

test('o que não é /api/ vai para os arquivos do app', async () => {
  const s = servidor();
  const r = await worker.fetch(new Request('https://agenda.teste/index.html'), s.env);
  assert.equal(await r.text(), 'arquivo /index.html');
  assert.equal((await s.api('GET', 'nada')).status, 404);
});

test('criar conta, entrar e sair', async () => {
  const s = servidor();
  const c = await criarConta(s);
  assert.match(c.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(c.usuario.nome, 'Breno');
  assert.equal(c.usuario.email, 'breno@exemplo.com');

  // a senha não fica guardada como veio
  const [linha] = s.db.linhas('SELECT senha_hash FROM usuarios');
  assert.notEqual(linha.senha_hash, senha('segredo123'));
  // nem o token
  assert.equal(s.db.linhas('SELECT * FROM sessoes WHERE token_hash = ?', c.token).length, 0);

  const repetida = await s.api('POST', 'cadastro', { nome: 'Outro', email: 'BRENO@exemplo.com ', senha: senha('x') });
  assert.equal(repetida.status, 409);
  assert.equal(repetida.codigo, 'existe');

  const errada = await s.api('POST', 'entrar', { email: 'breno@exemplo.com', senha: senha('errada') });
  assert.equal(errada.status, 401);
  assert.equal(errada.codigo, 'credenciais');
  const certa = await s.api('POST', 'entrar', { email: 'Breno@Exemplo.com', senha: senha('segredo123') });
  assert.equal(certa.status, 200);
  assert.notEqual(certa.token, c.token, 'cada aparelho tem o seu login');

  assert.equal((await s.api('GET', 'conta', null, certa.token)).usuario.nome, 'Breno');
  assert.equal((await s.api('POST', 'sair', {}, certa.token)).status, 200);
  const depois = await s.api('GET', 'conta', null, certa.token);
  assert.equal(depois.status, 401);
  assert.equal(depois.codigo, 'sessao');
  assert.equal((await s.api('GET', 'conta', null, c.token)).status, 200, 'o outro aparelho continua logado');
});

test('dados inválidos no cadastro', async () => {
  const s = servidor();
  assert.equal((await s.api('POST', 'cadastro', { nome: 'A', email: 'nao-e-email', senha: senha('x') })).codigo, 'email');
  assert.equal((await s.api('POST', 'cadastro', { nome: ' ', email: 'a@b.com', senha: senha('x') })).codigo, 'nome');
  assert.equal((await s.api('POST', 'cadastro', { nome: 'A', email: 'a@b.com', senha: 'senha-em-texto' })).codigo, 'senha');
  const r = await worker.fetch(new Request('https://agenda.teste/api/cadastro', { method: 'POST', body: '{quebrado' }), s.env);
  assert.equal(r.status, 400);
  assert.equal((await s.api('GET', 'conta', null, 'token-inventado-que-nao-existe-123')).status, 401);
});

test('muitas senhas erradas bloqueiam por um tempo', async () => {
  const s = servidor();
  await criarConta(s);
  for (let i = 0; i < 10; i++) {
    assert.equal((await s.api('POST', 'entrar', { email: 'breno@exemplo.com', senha: senha('chute' + i) })).status, 401);
  }
  const bloqueado = await s.api('POST', 'entrar', { email: 'breno@exemplo.com', senha: senha('segredo123') });
  assert.equal(bloqueado.status, 429);
  assert.equal(bloqueado.codigo, 'limite');
});

test('cada conta vê só a própria agenda', async () => {
  const s = servidor();
  const breno = await criarConta(s);
  const ana = await criarConta(s, 'Ana', 'ana@exemplo.com');
  await s.api('POST', 'sincronizar', { cursor: 0, alterados: [evento({ titulo: 'Dentista do Breno' })] }, breno.token);
  await s.api('POST', 'sincronizar', { cursor: 0, alterados: [evento({ titulo: 'Reunião da Ana' })] }, ana.token);

  const doBreno = await s.api('POST', 'sincronizar', { cursor: 0, alterados: [] }, breno.token);
  const daAna = await s.api('POST', 'sincronizar', { cursor: 0, alterados: [] }, ana.token);
  assert.deepEqual(doBreno.eventos.map((e) => e.titulo), ['Dentista do Breno']);
  assert.deepEqual(daAna.eventos.map((e) => e.titulo), ['Reunião da Ana']);

  // Ana não consegue mexer num compromisso do Breno usando o mesmo id
  const id = doBreno.eventos[0].id;
  await s.api('POST', 'sincronizar', { cursor: 0, alterados: [evento({ id, titulo: 'Invadido', atualizado: '2099-01-01T00:00:00.000Z' })] }, ana.token);
  const deNovo = await s.api('POST', 'sincronizar', { cursor: 0, alterados: [] }, breno.token);
  assert.deepEqual(deNovo.eventos.map((e) => e.titulo), ['Dentista do Breno']);
});

test('sincronizar só o que mudou entre computador e celular', async () => {
  const s = servidor();
  const pc = await criarConta(s);
  const cel = await s.api('POST', 'entrar', { email: 'breno@exemplo.com', senha: senha('segredo123') });

  const a = evento({ titulo: 'Dentista', atualizado: '2026-10-10T10:00:00.000Z' });
  const b = evento({ titulo: 'Academia', repete: 'semanal', dias: [1, 3], atualizado: '2026-10-10T10:00:00.000Z' });
  let rPc = await s.api('POST', 'sincronizar', { cursor: 0, alterados: [a, b] }, pc.token);
  assert.equal(rPc.cursor, 2);

  // celular começa do zero e recebe tudo
  let rCel = await s.api('POST', 'sincronizar', { cursor: 0, alterados: [] }, cel.token);
  assert.deepEqual(rCel.eventos.map((e) => e.titulo).sort(), ['Academia', 'Dentista']);
  assert.deepEqual(rCel.eventos.find((e) => e.titulo === 'Academia').dias, [1, 3]);

  // nada mudou: não vem nada
  rCel = await s.api('POST', 'sincronizar', { cursor: rCel.cursor, alterados: [] }, cel.token);
  assert.deepEqual(rCel.eventos, []);

  // celular muda o horário; computador recebe só isso
  rCel = await s.api('POST', 'sincronizar', { cursor: rCel.cursor, alterados: [{ ...a, hora: '15:00', atualizado: '2026-10-10T11:00:00.000Z' }] }, cel.token);
  rPc = await s.api('POST', 'sincronizar', { cursor: rPc.cursor, alterados: [] }, pc.token);
  assert.deepEqual(rPc.eventos.map((e) => [e.titulo, e.hora]), [['Dentista', '15:00']]);

  // computador manda uma versão velha (relógio atrasado): não vale e ele recebe a certa de volta
  rPc = await s.api('POST', 'sincronizar', { cursor: rPc.cursor, alterados: [{ ...a, hora: '09:00', atualizado: '2026-10-10T10:30:00.000Z' }] }, pc.token);
  assert.deepEqual(rPc.rejeitados.map((e) => e.hora), ['15:00']);

  // apagar no computador some no celular
  rPc = await s.api('POST', 'sincronizar', { cursor: rPc.cursor, alterados: [{ ...b, apagado: true, atualizado: '2026-10-10T12:00:00.000Z' }] }, pc.token);
  rCel = await s.api('POST', 'sincronizar', { cursor: rCel.cursor, alterados: [] }, cel.token);
  assert.deepEqual(rCel.eventos.map((e) => [e.titulo, e.apagado]), [['Academia', true]]);
});

test('WhatsApp: salvar, mascarar a chave e mandar teste', async () => {
  const s = servidor();
  const c = await criarConta(s);
  let r = await s.api('POST', 'config', { config: { whatsapp: { numero: '(27) 99971-5520', chave: '3834396' }, resumo: { ativo: true, hora: 7 } } }, c.token);
  assert.equal(r.status, 200);
  assert.equal(r.config.whatsapp.numero, '5527999715520');
  assert.equal(r.config.whatsapp.chave, '••••396');
  assert.equal(s.db.linhas('SELECT whats_ativo FROM usuarios')[0].whats_ativo, 1);

  // mandar a chave mascarada de volta mantém a verdadeira
  r = await s.api('POST', 'config', { config: { whatsapp: { numero: '5527999715520', chave: '••••396' }, avisoPadrao: [60] } }, c.token);
  assert.deepEqual(r.config.avisoPadrao, [60]);
  assert.equal(JSON.parse(s.db.linhas('SELECT config FROM usuarios')[0].config).whatsapp.chave, '3834396');

  r = await s.api('POST', 'testar', {}, c.token);
  assert.equal(r.resultado.whatsapp, 'ok');
  assert.deepEqual(whats.map((w) => [w.phone, w.apikey]), [['5527999715520', '3834396']]);
  assert.match(whats[0].text, /Tudo certo, Breno/);
  assert.match((await s.api('GET', 'conta', null, c.token)).ultimoEnvio.respostaWhats, /Message queued/);

  respostaWhats = () => ({ status: 200, corpo: 'APIKey is invalid' });
  r = await s.api('POST', 'testar', {}, c.token);
  assert.match(r.resultado.whatsapp, /^erro: .*APIKey is invalid/);

  r = await s.api('POST', 'config', { config: { whatsapp: { numero: '123' } } }, c.token);
  assert.equal(r.codigo, 'numero');
});

test('esqueci a senha: código pelo WhatsApp', async () => {
  const s = servidor();
  const c = await criarConta(s);
  assert.equal((await s.api('POST', 'recuperar', { email: 'breno@exemplo.com' })).codigo, 'sem-whats');
  await s.api('POST', 'config', { config: { whatsapp: { numero: '27999715520', chave: 'abc' } } }, c.token);
  assert.equal((await s.api('POST', 'recuperar', { email: 'ninguem@exemplo.com' })).codigo, 'sem-conta');

  const r = await s.api('POST', 'recuperar', { email: 'breno@exemplo.com' });
  assert.equal(r.status, 200);
  assert.equal(r.final, '5520');
  const codigo = whats.at(-1).text.match(/\*(\d{6})\*/)[1];

  const errado = await s.api('POST', 'redefinir', { email: 'breno@exemplo.com', codigo: codigo === '000000' ? '111111' : '000000', nova: senha('nova123') });
  assert.equal(errado.codigo, 'codigo');
  const certo = await s.api('POST', 'redefinir', { email: 'breno@exemplo.com', codigo, nova: senha('nova123') });
  assert.equal(certo.status, 200);
  assert.ok(certo.token);

  assert.equal((await s.api('GET', 'conta', null, c.token)).status, 401, 'os outros aparelhos saem');
  assert.equal((await s.api('POST', 'entrar', { email: 'breno@exemplo.com', senha: senha('segredo123') })).status, 401);
  assert.equal((await s.api('POST', 'entrar', { email: 'breno@exemplo.com', senha: senha('nova123') })).status, 200);
  assert.equal((await s.api('POST', 'redefinir', { email: 'breno@exemplo.com', codigo, nova: senha('outra') })).codigo, 'codigo-velho', 'código só vale uma vez');
});

test('código errado 5 vezes invalida o código', async () => {
  const s = servidor();
  const c = await criarConta(s);
  await s.api('POST', 'config', { config: { whatsapp: { numero: '27999715520', chave: 'abc' } } }, c.token);
  await s.api('POST', 'recuperar', { email: 'breno@exemplo.com' });
  const codigo = whats.at(-1).text.match(/\*(\d{6})\*/)[1];
  const errado = codigo === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await s.api('POST', 'redefinir', { email: 'breno@exemplo.com', codigo: errado, nova: senha('x') });
  assert.equal((await s.api('POST', 'redefinir', { email: 'breno@exemplo.com', codigo, nova: senha('x') })).codigo, 'codigo-velho');
});

test('trocar a senha tira os outros aparelhos', async () => {
  const s = servidor();
  const pc = await criarConta(s);
  const cel = await s.api('POST', 'entrar', { email: 'breno@exemplo.com', senha: senha('segredo123') });
  assert.equal((await s.api('POST', 'senha', { atual: senha('errada'), nova: senha('nova') }, pc.token)).codigo, 'credenciais');
  assert.equal((await s.api('POST', 'senha', { atual: senha('segredo123'), nova: senha('nova') }, pc.token)).status, 200);
  assert.equal((await s.api('GET', 'conta', null, pc.token)).status, 200);
  assert.equal((await s.api('GET', 'conta', null, cel.token)).status, 401);
  assert.equal((await s.api('POST', 'entrar', { email: 'breno@exemplo.com', senha: senha('nova') })).status, 200);
});

test('apagar a conta apaga tudo', async () => {
  const s = servidor();
  const c = await criarConta(s);
  const outra = await criarConta(s, 'Ana', 'ana@exemplo.com');
  await s.api('POST', 'sincronizar', { cursor: 0, alterados: [evento({})] }, c.token);
  await s.api('POST', 'sincronizar', { cursor: 0, alterados: [evento({})] }, outra.token);
  assert.equal((await s.api('POST', 'apagar-conta', { senha: senha('errada') }, c.token)).codigo, 'credenciais');
  assert.equal((await s.api('POST', 'apagar-conta', { senha: senha('segredo123') }, c.token)).status, 200);
  assert.equal(s.db.linhas('SELECT * FROM usuarios').length, 1);
  assert.equal(s.db.linhas('SELECT * FROM eventos').length, 1, 'a agenda da Ana continua');
  assert.equal((await s.api('GET', 'conta', null, c.token)).status, 401);
});

// ---------- avisos (cron) ----------

async function contaComWhats(s, nome, email, extra = {}) {
  const c = await criarConta(s, nome, email, extra);
  await s.api('POST', 'config', { config: { whatsapp: { numero: '27999715520', chave: 'abc' }, ...extra.config } }, c.token);
  return c;
}
const em = (txt) => new Date(txt);

test('lembretes chegam na hora certa, uma vez só, para cada pessoa', async () => {
  const s = servidor();
  const breno = await contaComWhats(s, 'Breno', 'breno@exemplo.com');
  const ana = await criarConta(s, 'Ana', 'ana@exemplo.com'); // sem WhatsApp
  await s.api('POST', 'sincronizar', { cursor: 0, alterados: [evento({ titulo: 'Dentista', data: '2026-10-15', hora: '15:00', avisos: [1440, 60], notas: 'Levar exames' })] }, breno.token);
  await s.api('POST', 'sincronizar', { cursor: 0, alterados: [evento({ titulo: 'Da Ana', data: '2026-10-15', hora: '15:00', avisos: [1440] })] }, ana.token);
  whats = [];

  await rodarAvisos(s.env, em('2026-10-14T14:00:00-03:00'));
  assert.equal(whats.length, 0);
  await rodarAvisos(s.env, em('2026-10-14T15:00:00-03:00'));
  assert.equal(whats.length, 1);
  assert.match(whats[0].text, /Dentista\*\nAmanhã, às 15:00\n📝 Levar exames/);
  await rodarAvisos(s.env, em('2026-10-14T15:05:00-03:00'));
  assert.equal(whats.length, 1, 'não repete');
  await rodarAvisos(s.env, em('2026-10-15T14:00:00-03:00'));
  assert.equal(whats.length, 2);
  assert.match(whats[1].text, /Hoje, às 15:00 \(em 1h\)/);
  await rodarAvisos(s.env, em('2026-10-15T14:05:00-03:00'));
  assert.equal(whats.length, 2);
});

test('cada pessoa no seu fuso horário', async () => {
  const s = servidor();
  const c = await contaComWhats(s, 'Ze', 'ze@exemplo.com', { fuso: 'America/Manaus' }); // 1h a menos que Brasília
  await s.api('POST', 'sincronizar', { cursor: 0, alterados: [evento({ titulo: 'Reunião', data: '2026-10-15', hora: '10:00', avisos: [60] })] }, c.token);
  whats = [];
  await rodarAvisos(s.env, em('2026-10-15T09:00:00-03:00')); // 08:00 em Manaus
  assert.equal(whats.length, 0);
  await rodarAvisos(s.env, em('2026-10-15T10:00:00-03:00')); // 09:00 em Manaus
  assert.equal(whats.length, 1);
});

test('resumo da manhã e repetição semanal', async () => {
  const s = servidor();
  const c = await contaComWhats(s, 'Breno', 'breno@exemplo.com', { config: { resumo: { ativo: true, hora: 7 } } });
  await s.api('POST', 'sincronizar', { cursor: 0, alterados: [
    evento({ titulo: 'Academia', data: '2026-10-12', hora: '18:00', repete: 'semanal', dias: [1, 3], avisos: [60] }),
    evento({ titulo: 'Aniversário da Ana', data: '2026-10-14' })
  ] }, c.token);
  whats = [];
  await rodarAvisos(s.env, em('2026-10-14T07:00:00-03:00'));
  assert.equal(whats.length, 1);
  assert.match(whats[0].text, /Sua agenda de hoje\*\nquarta-feira, 14 de outubro\n\n• Dia todo · Aniversário da Ana\n• 18:00 · Academia/);
  await rodarAvisos(s.env, em('2026-10-14T17:00:00-03:00'));
  assert.equal(whats.length, 2);
  await rodarAvisos(s.env, em('2026-10-19T17:00:00-03:00'));
  assert.equal(whats.length, 3, 'segunda seguinte também');
  // dia sem nada: não manda resumo
  await rodarAvisos(s.env, em('2026-10-17T07:00:00-03:00'));
  assert.equal(whats.length, 3);
});

test('WhatsApp falhando: tenta 3 vezes e mostra o erro em Ajustes', async () => {
  const s = servidor();
  const c = await contaComWhats(s, 'Breno', 'breno@exemplo.com');
  await s.api('POST', 'sincronizar', { cursor: 0, alterados: [evento({ titulo: 'Reunião', data: '2026-10-15', hora: '15:00', avisos: [60] })] }, c.token);
  whats = [];
  respostaWhats = () => ({ status: 200, corpo: 'You have 0 messages left. Please, subscribe' });
  for (let m = 0; m < 25; m += 5) await rodarAvisos(s.env, em(`2026-10-15T14:${String(m).padStart(2, '0')}:00-03:00`));
  assert.equal(whats.length, 3);
  assert.match((await s.api('GET', 'conta', null, c.token)).ultimoEnvio.whatsapp, /0 messages left/);
});

test('faxina apaga o que já não serve', async () => {
  const s = servidor();
  const c = await criarConta(s);
  await s.api('POST', 'sincronizar', { cursor: 0, alterados: [
    evento({ titulo: 'Velho apagado', apagado: true, atualizado: '2026-01-01T00:00:00.000Z' }),
    evento({ titulo: 'Recente apagado', apagado: true, atualizado: '2026-10-01T00:00:00.000Z' }),
    evento({ titulo: 'Ativo', atualizado: '2026-01-01T00:00:00.000Z' })
  ] }, c.token);
  await limpar(s.db, em('2026-10-10T12:00:00Z'));
  assert.deepEqual(s.db.linhas("SELECT json_extract(dados, '$.titulo') AS t FROM eventos ORDER BY t").map((l) => l.t), ['Ativo', 'Recente apagado']);
});
