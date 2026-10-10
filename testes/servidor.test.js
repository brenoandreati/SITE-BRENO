// Roda servidor/Codigo.gs com imitações dos serviços do Google (testes/google-falso.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarGoogle } = require('./google-falso.js');

const evento = (dados) => ({ id: 'e' + Math.random().toString(36).slice(2), titulo: 'Teste', atualizado: '2026-10-10T12:00:00.000Z', avisos: [], ...dados });

test('instalar cria a planilha e o gatilho de 5 em 5 minutos', () => {
  const g = criarGoogle();
  g.contexto.instalar();
  assert.ok(g.planilha.getSheetByName('Agenda'));
  assert.ok(g.planilha.getSheetByName('Enviados'));
  assert.equal(g.gatilhos.length, 1);
  assert.equal(g.gatilhos[0].n, 5);
  g.contexto.instalar();
  assert.equal(g.gatilhos.length, 1, 'rodar de novo não duplica o gatilho');
});

test('sem trocar a senha o servidor recusa', () => {
  const g = criarGoogle({ senha: 'troque-esta-senha' });
  assert.throws(() => g.contexto.instalar(), /Troque a SENHA/);
  const r = g.post({ acao: 'ping' });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'senha-padrao');
});

test('senha errada é recusada', () => {
  const g = criarGoogle();
  const r = g.post({ acao: 'ping' }, 'outra');
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'senha');
});

test('sincronizar junta computador e celular', () => {
  const g = criarGoogle();
  const a = evento({ titulo: 'Dentista', data: '2026-10-15', hora: '15:00' });
  const b = evento({ titulo: '=Academia', data: '2026-10-12', repete: 'semanal', dias: [1, 3], notas: 'levar toalha, garrafa' });

  // computador manda "a"
  let r = g.post({ acao: 'sincronizar', eventos: [a] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.eventos.map((e) => e.titulo), ['Dentista']);

  // celular manda "b" e recebe os dois
  r = g.post({ acao: 'sincronizar', eventos: [b] });
  assert.deepEqual(r.eventos.map((e) => e.titulo).sort(), ['=Academia', 'Dentista']);
  const academia = r.eventos.find((e) => e.id === b.id);
  assert.deepEqual(academia.dias, [1, 3]);
  assert.equal(academia.notas, 'levar toalha, garrafa');

  // computador apaga "a" (alteração mais nova vence)
  r = g.post({ acao: 'sincronizar', eventos: [{ ...a, apagado: true, atualizado: '2026-10-10T13:00:00.000Z' }] });
  assert.equal(r.eventos.find((e) => e.id === a.id).apagado, true);

  // uma versão velha de "a" não ressuscita
  r = g.post({ acao: 'sincronizar', eventos: [a] });
  assert.equal(r.eventos.find((e) => e.id === a.id).apagado, true);
});

test('configuração guarda a chave do WhatsApp sem devolver ela inteira', () => {
  const g = criarGoogle();
  let r = g.post({ acao: 'salvarConfig', config: { whatsapp: { numero: '55 (11) 91234-5678', chave: '123456' }, resumo: { ativo: true, hora: 7 } } });
  assert.equal(r.ok, true);
  assert.equal(r.config.whatsapp.numero, '+5511912345678');
  assert.equal(r.config.whatsapp.chave, '••••456');
  // mandar a chave mascarada de volta mantém a original
  r = g.post({ acao: 'salvarConfig', config: { whatsapp: { numero: '5511912345678', chave: '••••456' } } });
  assert.equal(JSON.parse(g.props.CONFIG).whatsapp.chave, '123456');
  r = g.post({ acao: 'ping' });
  assert.equal(r.email, 'breno@gmail.com');
  assert.equal(r.config.resumo.ativo, true);
  r = g.post({ acao: 'salvarConfig', config: { email: { endereco: 'nao-e-email' } } });
  assert.equal(r.ok, false);
});

test('lembretes chegam no WhatsApp na hora certa, uma vez só', () => {
  const g = criarGoogle({ agora: '2026-10-14T14:00:00-03:00' }); // quarta, 14h
  g.post({ acao: 'salvarConfig', config: { whatsapp: { numero: '5511912345678', chave: 'abc123' } } });
  g.post({ acao: 'sincronizar', eventos: [evento({ titulo: 'Dentista', data: '2026-10-15', hora: '15:00', avisos: [1440, 60], notas: 'Levar exames' })] });

  g.rodarGatilho(); // 14:00 de quarta: ainda não (aviso de 1 dia é às 15:00)
  assert.equal(g.whats.length, 0);

  g.avancar(60); // 15:00 de quarta → aviso de 1 dia antes
  g.rodarGatilho();
  assert.equal(g.whats.length, 1);
  assert.equal(g.whats[0].phone, '5511912345678');
  assert.equal(g.whats[0].apikey, 'abc123');
  assert.match(g.whats[0].text, /Dentista/);
  assert.match(g.whats[0].text, /Amanhã, às 15:00/);
  assert.match(g.whats[0].text, /Levar exames/);

  g.avancar(5);
  g.rodarGatilho(); // não repete
  assert.equal(g.whats.length, 1);

  g.avancar(23 * 60 - 5); // 14:00 de quinta → aviso de 1 hora antes
  g.rodarGatilho();
  assert.equal(g.whats.length, 2);
  assert.match(g.whats[1].text, /Hoje, às 15:00 \(em 1h\)/);

  g.avancar(5);
  g.rodarGatilho();
  assert.equal(g.whats.length, 2);
});

test('compromisso criado em cima da hora manda um aviso só', () => {
  const g = criarGoogle({ agora: '2026-10-15T14:30:00-03:00' });
  g.post({ acao: 'salvarConfig', config: { whatsapp: { numero: '5511912345678', chave: 'abc' } } });
  g.post({ acao: 'sincronizar', eventos: [evento({ titulo: 'Reunião', data: '2026-10-15', hora: '15:00', avisos: [1440, 60, 30] })] });
  g.rodarGatilho();
  assert.equal(g.whats.length, 1);
  assert.match(g.whats[0].text, /em 30 min/);
  g.avancar(10);
  g.rodarGatilho();
  assert.equal(g.whats.length, 1);
});

test('repetição semanal avisa toda semana', () => {
  const g = criarGoogle({ agora: '2026-10-12T17:00:00-03:00' }); // segunda 17h
  g.post({ acao: 'salvarConfig', config: { whatsapp: { numero: '5511912345678', chave: 'abc' } } });
  g.post({ acao: 'sincronizar', eventos: [evento({ titulo: 'Academia', data: '2026-10-12', hora: '18:00', repete: 'semanal', dias: [1], avisos: [60] })] });
  g.rodarGatilho();
  assert.equal(g.whats.length, 1);
  g.avancar(7 * 24 * 60);
  g.rodarGatilho();
  assert.equal(g.whats.length, 2);
});

test('resumo do dia pela manhã, só quando tem compromisso', () => {
  const g = criarGoogle({ agora: '2026-10-15T06:55:00-03:00' });
  g.post({ acao: 'salvarConfig', config: { whatsapp: { numero: '5511912345678', chave: 'abc' }, resumo: { ativo: true, hora: 7 } } });
  g.post({ acao: 'sincronizar', eventos: [
    evento({ titulo: 'Dentista', data: '2026-10-15', hora: '15:00' }),
    evento({ titulo: 'Aniversário da Ana', data: '2026-10-15' }),
  ] });
  g.rodarGatilho();
  assert.equal(g.whats.length, 0);
  g.avancar(5); // 07:00
  g.rodarGatilho();
  assert.equal(g.whats.length, 1);
  assert.match(g.whats[0].text, /Sua agenda de hoje/);
  assert.match(g.whats[0].text, /Dia todo · Aniversário da Ana\n• 15:00 · Dentista/);
  g.avancar(5);
  g.rodarGatilho();
  assert.equal(g.whats.length, 1);
  // dia seguinte, sem nada marcado: não manda
  g.avancar(24 * 60);
  g.rodarGatilho();
  assert.equal(g.whats.length, 1);
});

test('se o WhatsApp falhar, tenta de novo até 3 vezes e avisa no último envio', () => {
  const g = criarGoogle({ agora: '2026-10-15T14:00:00-03:00', respostaWhats: { codigo: 200, corpo: 'APIKey is invalid' } });
  // respostas de limite do CallMeBot também contam como falha
  for (const corpo of ['You have 0 messages left. Please, subscribe', 'Phone not found']) {
    const h = criarGoogle({ respostaWhats: { codigo: 200, corpo } });
    h.post({ acao: 'salvarConfig', config: { whatsapp: { numero: '5511912345678', chave: 'x' } } });
    assert.match(h.post({ acao: 'testar' }).resultado.whatsapp, /^erro/);
  }
  g.post({ acao: 'salvarConfig', config: { whatsapp: { numero: '5511912345678', chave: 'errada' } } });
  g.post({ acao: 'sincronizar', eventos: [evento({ titulo: 'Reunião', data: '2026-10-15', hora: '15:00', avisos: [60] })] });
  for (let i = 0; i < 5; i++) { g.rodarGatilho(); g.avancar(5); }
  assert.equal(g.whats.length, 3);
  const r = g.post({ acao: 'ping' });
  assert.match(r.ultimoEnvio.whatsapp, /APIKey is invalid/);
});

test('e-mail como reserva', () => {
  const g = criarGoogle({ agora: '2026-10-15T14:00:00-03:00' });
  g.post({ acao: 'salvarConfig', config: { email: { ativo: true, endereco: 'breno@gmail.com' } } });
  g.post({ acao: 'sincronizar', eventos: [evento({ titulo: 'Reunião', data: '2026-10-15', hora: '15:00', avisos: [60] })] });
  g.rodarGatilho();
  assert.equal(g.whats.length, 0);
  assert.equal(g.emails.length, 1);
  assert.equal(g.emails[0].to, 'breno@gmail.com');
  assert.match(g.emails[0].subject, /Reunião/);
  assert.doesNotMatch(g.emails[0].body, /\*/);
});

test('testar manda mensagem e reclama se nada estiver configurado', () => {
  const g = criarGoogle();
  let r = g.post({ acao: 'testar' });
  assert.equal(r.ok, false);
  g.post({ acao: 'salvarConfig', config: { whatsapp: { numero: '5511912345678', chave: 'abc' } } });
  r = g.post({ acao: 'testar' });
  assert.equal(r.ok, true);
  assert.equal(r.resultado.whatsapp, 'ok');
  assert.equal(g.whats.length, 1);
  assert.equal(g.whats[0].phone, '5511912345678');
  // a resposta do CallMeBot fica guardada para aparecer no app
  assert.match(g.post({ acao: 'ping' }).ultimoEnvio.respostaWhats, /Message queued/);
});
