const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../publico/app/datas.js');

const evento = (dados) => D.normalizar({ id: 'x', titulo: 'Teste', ...dados });

test('dia da semana', () => {
  assert.equal(D.diaDaSemana('2026-10-10'), 6); // sábado
  assert.equal(D.diaDaSemana('2026-10-11'), 0); // domingo
  assert.equal(D.diaDaSemana('1969-12-31'), 3); // quarta
});

test('compromisso que não repete aparece só no dia', () => {
  const e = evento({ data: '2026-10-15' });
  assert.deepEqual(D.ocorrencias(e, '2026-10-01', '2026-10-31'), ['2026-10-15']);
  assert.deepEqual(D.ocorrencias(e, '2026-10-16', '2026-10-31'), []);
});

test('toda segunda e quarta', () => {
  const e = evento({ data: '2026-10-12', repete: 'semanal', dias: [1, 3] });
  assert.deepEqual(D.ocorrencias(e, '2026-10-01', '2026-10-25'), ['2026-10-12', '2026-10-14', '2026-10-19', '2026-10-21']);
});

test('a cada 2 semanas', () => {
  const e = evento({ data: '2026-10-14', repete: 'semanal', dias: [3], cada: 2 });
  assert.deepEqual(D.ocorrencias(e, '2026-10-01', '2026-11-30'), ['2026-10-14', '2026-10-28', '2026-11-11', '2026-11-25']);
});

test('a cada 2 semanas com dois dias fica na mesma semana', () => {
  const e = evento({ data: '2026-10-13', repete: 'semanal', dias: [2, 4], cada: 2 });
  assert.deepEqual(D.ocorrencias(e, '2026-10-11', '2026-11-01'), ['2026-10-13', '2026-10-15', '2026-10-27', '2026-10-29']);
});

test('todo mês no dia 31 cai no último dia dos meses curtos', () => {
  const e = evento({ data: '2026-10-31', repete: 'mensal' });
  assert.deepEqual(D.ocorrencias(e, '2026-10-01', '2027-03-31'),
    ['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
});

test('a cada 3 meses', () => {
  const e = evento({ data: '2026-01-15', repete: 'mensal', cada: 3 });
  assert.deepEqual(D.ocorrencias(e, '2026-03-01', '2026-12-31'), ['2026-04-15', '2026-07-15', '2026-10-15']);
});

test('todo ano, inclusive 29 de fevereiro', () => {
  const e = evento({ data: '2024-02-29', repete: 'anual' });
  assert.deepEqual(D.ocorrencias(e, '2025-01-01', '2028-12-31'), ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
});

test('data final e exceções', () => {
  const e = evento({ data: '2026-10-12', repete: 'semanal', dias: [1], ate: '2026-11-02', excecoes: ['2026-10-19'] });
  assert.deepEqual(D.ocorrencias(e, '2026-10-01', '2026-12-31'), ['2026-10-12', '2026-10-26', '2026-11-02']);
});

test('apagado não aparece', () => {
  const e = evento({ data: '2026-10-12', apagado: true });
  assert.deepEqual(D.ocorrencias(e, '2026-10-01', '2026-12-31'), []);
});

test('próxima e anterior', () => {
  const e = evento({ data: '2026-10-12', repete: 'semanal', dias: [1] });
  assert.equal(D.proxima(e, '2026-10-13'), '2026-10-19');
  assert.equal(D.anterior(e, '2026-10-18'), '2026-10-12');
  assert.equal(D.anterior(e, '2026-10-11'), '');
  const longe = evento({ data: '2027-09-01' });
  assert.equal(D.proxima(longe, '2026-10-10'), '2027-09-01');
});

test('normalizar corrige campos estranhos', () => {
  const e = D.normalizar({ id: 1, titulo: '  Oi ', data: '2026-10-10', hora: '25:00', horaFim: '10:00', repete: 'xyz', avisos: '60, 1440, abc, 60', excecoes: 'lixo' });
  assert.equal(e.id, '1');
  assert.equal(e.titulo, 'Oi');
  assert.equal(e.hora, '');
  assert.equal(e.horaFim, '');
  assert.equal(e.repete, 'nao');
  assert.deepEqual(e.avisos, [1440, 60]);
  assert.deepEqual(e.excecoes, []);
  const s = D.normalizar({ id: 2, data: '2026-10-10', repete: 'semanal', dias: '' });
  assert.deepEqual(s.dias, [6]);
});

test('mesclar fica com a alteração mais recente', () => {
  const a = [{ id: '1', titulo: 'velho', atualizado: '2026-10-01T10:00:00.000Z' }, { id: '2', titulo: 'só em a', atualizado: '2026-10-01T10:00:00.000Z' }];
  const b = [{ id: '1', titulo: 'novo', atualizado: '2026-10-02T10:00:00.000Z' }, { id: '3', titulo: 'só em b', atualizado: '2026-10-01T10:00:00.000Z' }];
  const r = D.mesclar(a, b);
  assert.deepEqual(r.map((e) => e.titulo), ['novo', 'só em a', 'só em b']);
  assert.deepEqual(D.mesclar(b, a).map((e) => e.titulo), ['novo', 'só em b', 'só em a']);
});

test('limparApagados remove só os apagados antigos', () => {
  const lista = [
    { id: '1', apagado: true, atualizado: '2026-01-01T00:00:00.000Z' },
    { id: '2', apagado: true, atualizado: '2026-10-01T00:00:00.000Z' },
    { id: '3', apagado: false, atualizado: '2020-01-01T00:00:00.000Z' },
  ];
  assert.deepEqual(D.limparApagados(lista, '2026-10-10').map((e) => e.id), ['2', '3']);
});

test('textos', () => {
  assert.equal(D.relativa('2026-10-10', '2026-10-10'), 'Hoje');
  assert.equal(D.relativa('2026-10-11', '2026-10-10'), 'Amanhã');
  assert.equal(D.relativa('2026-10-15', '2026-10-10'), 'quinta, 15 de outubro');
  assert.equal(D.relativa('2027-01-04', '2026-10-10'), 'segunda, 4 de janeiro de 2027');
  assert.equal(D.descreverRepeticao(evento({ data: '2026-10-12', repete: 'semanal', dias: [1, 3] })), 'Toda segunda e quarta');
  assert.equal(D.descreverRepeticao(evento({ data: '2026-10-10', repete: 'semanal', dias: [6] })), 'Todo sábado');
  assert.equal(D.descreverRepeticao(evento({ data: '2026-10-12', repete: 'semanal', dias: [1, 2, 3, 4, 5] })), 'De segunda a sexta');
  assert.equal(D.descreverRepeticao(evento({ data: '2026-10-14', repete: 'semanal', dias: [3], cada: 2 })), 'A cada 2 semanas: quarta');
  assert.equal(D.descreverRepeticao(evento({ data: '2026-11-05', repete: 'mensal' })), 'Todo mês, dia 5');
  assert.equal(D.descreverRepeticao(evento({ data: '2026-11-12', repete: 'anual' })), 'Todo ano, 12 de novembro');
  assert.equal(D.descreverAviso(1440), '1 dia antes');
  assert.equal(D.descreverAviso(60), '1 hora antes');
  assert.equal(D.descreverAviso(30), '30 min antes');
  assert.equal(D.descreverAviso(0), 'na hora');
  assert.equal(D.descreverAviso(10080), '1 semana antes');
});
