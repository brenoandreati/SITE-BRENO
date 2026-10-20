const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretar } = require('../publico/app/interpretar.js');

// Sábado, 10/10/2026, 10:00
const HOJE = '2026-10-10';
const AGORA = '10:00';
const ler = (texto, hoje = HOJE, agora = AGORA) => interpretar(texto, hoje, agora);

function confere(texto, esperado, hoje, agora) {
  const r = ler(texto, hoje, agora);
  for (const [campo, valor] of Object.entries(esperado)) {
    assert.deepEqual(r[campo], valor, `"${texto}" → ${campo}: ${JSON.stringify(r[campo])} (esperava ${JSON.stringify(valor)})`);
  }
}

const casos = [
  ['Dentista quinta às 15h', { titulo: 'Dentista', data: '2026-10-15', hora: '15:00', repete: 'nao' }],
  ['Reunião com João amanhã às 14:30', { titulo: 'Reunião com João', data: '2026-10-11', hora: '14:30' }],
  ['Academia toda segunda e quarta 18h', { titulo: 'Academia', repete: 'semanal', dias: [1, 3], data: '2026-10-12', hora: '18:00' }],
  ['Aniversário da mãe 12/11', { titulo: 'Aniversário da mãe', data: '2026-11-12', hora: '', repete: 'nao' }],
  ['Pagar aluguel dia 5 todo mês', { titulo: 'Pagar aluguel', repete: 'mensal', data: '2026-11-05' }],
  ['Aula de inglês todas as terças 19h30', { titulo: 'Aula de inglês', repete: 'semanal', dias: [2], data: '2026-10-13', hora: '19:30' }],
  ['Churrasco sábado', { titulo: 'Churrasco', data: '2026-10-10', hora: '' }],
  ['Churrasco próximo sábado', { titulo: 'Churrasco', data: '2026-10-17' }],
  ['Viagem 25 de dezembro', { titulo: 'Viagem', data: '2026-12-25' }],
  ['Consulta dia 20 às 10h', { titulo: 'Consulta', data: '2026-10-20', hora: '10:00' }],
  ['Jantar hoje 20h', { titulo: 'Jantar', data: '2026-10-10', hora: '20:00' }],
  ['Dentista 9h', { titulo: 'Dentista', data: '2026-10-11', hora: '09:00' }],
  ['Natal 25/12/2027', { titulo: 'Natal', data: '2027-12-25' }],
  ['Reunião de segunda a sexta às 9', { titulo: 'Reunião', repete: 'semanal', dias: [1, 2, 3, 4, 5], data: '2026-10-12', hora: '09:00' }],
  ['Remédio todo dia 8h', { titulo: 'Remédio', repete: 'semanal', dias: [0, 1, 2, 3, 4, 5, 6], hora: '08:00', data: '2026-10-10' }],
  ['Futebol às 3 da tarde no domingo', { titulo: 'Futebol', data: '2026-10-11', hora: '15:00' }],
  ['Reunião das 14h às 16h quinta', { titulo: 'Reunião', data: '2026-10-15', hora: '14:00', horaFim: '16:00' }],
  ['Terapia a cada 2 semanas na quarta 17h', { titulo: 'Terapia', repete: 'semanal', cada: 2, dias: [3], data: '2026-10-14', hora: '17:00' }],
  ['Médico 1º de maio', { titulo: 'Médico', data: '2027-05-01' }],
  ['Almoço com a Ana sábado que vem ao meio-dia', { titulo: 'Almoço com a Ana', data: '2026-10-17', hora: '12:00' }],
  ['Aniversário do pai todo ano 03/02', { titulo: 'Aniversário do pai', repete: 'anual', data: '2027-02-03' }],
  ['Prova daqui a 3 dias', { titulo: 'Prova', data: '2026-10-13' }],
  ['Reunião seg. 10h', { titulo: 'Reunião', data: '2026-10-12', hora: '10:00' }],
  ['Comprar 2 pães', { titulo: 'Comprar 2 pães', data: '2026-10-10', hora: '', temData: false }],
  ['Dentista, quinta, 15h', { titulo: 'Dentista', data: '2026-10-15', hora: '15:00' }],
  ['tenho dentista na quinta', { titulo: 'Dentista', data: '2026-10-15' }],
  ['Inglês segundas e quartas 19h', { titulo: 'Inglês', repete: 'semanal', dias: [1, 3], hora: '19:00' }],
  ['Encontro 15/10 às 7 da noite', { titulo: 'Encontro', data: '2026-10-15', hora: '19:00' }],
  ['Reunião 14h-15h30 amanhã', { titulo: 'Reunião', data: '2026-10-11', hora: '14:00', horaFim: '15:30' }],
  ['sexta', { titulo: '', data: '2026-10-16', temData: true }],
  ['quinta-feira 16h Psicólogo', { titulo: 'Psicólogo', data: '2026-10-15', hora: '16:00' }],
  ['Feira toda semana', { titulo: 'Feira', repete: 'semanal', dias: [6], data: '2026-10-10' }],
  ['Pilates terça e quinta às 7h', { titulo: 'Pilates', repete: 'semanal', dias: [2, 4], hora: '07:00' }],
  ['Reunião na quinta com o Pedro', { titulo: 'Reunião com o Pedro', data: '2026-10-15' }],
  ['Curso aos sábados das 9h às 12h', { titulo: 'Curso', repete: 'semanal', dias: [6], hora: '09:00', horaFim: '12:00' }],
  ['Pagar cartão todo dia 10', { titulo: 'Pagar cartão', repete: 'mensal', data: '2026-10-10' }],
  ['Pagar luz todo dia 3', { titulo: 'Pagar luz', repete: 'mensal', data: '2026-11-03' }],
  ['Inglês toda segunda até 15/12', { titulo: 'Inglês', repete: 'semanal', dias: [1], data: '2026-10-12', ate: '2026-12-15' }],
  ['Vacina do cachorro em 2 semanas', { titulo: 'Vacina do cachorro', data: '2026-10-24' }],
  ['Copa 2026 final 19/07', { titulo: 'Copa 2026 final', data: '2027-07-19' }],
  // Hoje é sábado, então a "semana que vem" começa amanhã (domingo, 11/10)
  ['Reunião quinta da semana que vem 9:30', { titulo: 'Reunião', data: '2026-10-15', hora: '09:30' }],
  ['Mandar bom dia pro grupo amanhã', { titulo: 'Mandar bom dia pro grupo', data: '2026-10-11' }],
  ['Show 31/10 às 21h', { titulo: 'Show', data: '2026-10-31', hora: '21:00' }],
  ['Dia das crianças 12 de outubro', { titulo: 'Dia das crianças', data: '2026-10-12' }],
  ['Faxina quinzenal sexta', { titulo: 'Faxina', repete: 'semanal', cada: 2, dias: [5] }],
  ['lembrar de pagar o boleto amanhã', { titulo: 'Pagar o boleto', data: '2026-10-11' }],
  ['Reunião depois de amanhã 16h', { titulo: 'Reunião', data: '2026-10-12', hora: '16:00' }],
  ['Meia-noite festa 31/12', { titulo: 'Festa', data: '2026-12-31', hora: '00:00' }],
  ['Feira de domingo a domingo', {}],
  ['Reunião 14 às 16h', { titulo: 'Reunião', hora: '14:00', horaFim: '16:00' }],
  ['Sala 2 às 15h', { titulo: 'Sala 2', hora: '15:00', horaFim: '' }],
  ['Buscar filho na escola de segunda a sexta 17h30', { titulo: 'Buscar filho na escola', repete: 'semanal', dias: [1, 2, 3, 4, 5], hora: '17:30' }],
  ['Pagar IPVA todo ano 15/03', { titulo: 'Pagar IPVA', repete: 'anual', data: '2027-03-15' }],
  ['Médico às 10 e meia', { titulo: 'Médico', hora: '10:30' }],
  ['Prova sexta às 8h da manhã', { titulo: 'Prova', data: '2026-10-16', hora: '08:00' }],
];

for (const [texto, esperado] of casos) {
  test(texto, () => confere(texto, esperado));
}

test('dia da semana igual a hoje: hoje se ainda não passou, senão semana que vem', () => {
  // Quinta, 15/10/2026
  confere('Dentista quinta 15h', { data: '2026-10-15' }, '2026-10-15', '10:00');
  confere('Dentista quinta 9h', { data: '2026-10-22' }, '2026-10-15', '10:00');
  confere('Dentista próxima quinta', { data: '2026-10-22' }, '2026-10-15', '10:00');
  // Segunda, 12/10/2026
  confere('Reunião quinta da semana que vem', { data: '2026-10-22' }, '2026-10-12', '10:00');
  confere('Reunião quinta', { data: '2026-10-15' }, '2026-10-12', '10:00');
});

test('dia do mês que já passou vai para o mês seguinte', () => {
  confere('Consulta dia 5', { data: '2026-11-05' });
  confere('Consulta dia 31', { data: '2026-10-31' });
  confere('Consulta dia 31', { data: '2026-12-31' }, '2026-11-02');
});

test('data sem ano que já passou vai para o ano seguinte', () => {
  confere('Viagem 02/01', { data: '2027-01-02' });
  confere('29/02 festa', { data: '2028-02-29' });
});

test('nunca quebra com texto qualquer', () => {
  const textos = ['', '   ', '???', 'às', 'dia', 'toda', '99/99', '25:99', 'de a', 'quinta quinta quinta', '😀 festa amanhã', 'a'.repeat(500)];
  for (const t of textos) {
    const r = ler(t);
    assert.match(r.data, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof r.titulo, 'string');
  }
});
