/* Agenda · datas e repetições
 *
 * Este arquivo roda no navegador e também no servidor do Google (Apps Script):
 * ele é copiado para dentro de servidor/Codigo.gs. Depois de editar aqui,
 * rode `npm run servidor` para atualizar a cópia. Nada de DOM neste arquivo.
 *
 * Datas são texto 'AAAA-MM-DD' e horas 'HH:MM', sempre no horário local.
 * As contas usam o número do dia (dias desde 01/01/1970), sem fuso horário.
 */
var AgendaDatas = (function () {
  'use strict';

  var DIA_MS = 86400000;

  var DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  var DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var DIAS_PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var REPETICOES = ['nao', 'semanal', 'mensal', 'anual'];

  function dois(n) { return (n < 10 ? '0' : '') + n; }

  function ehData(iso) { return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso); }
  function ehHora(h) { return typeof h === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h); }

  function paraNumero(iso) {
    var p = iso.split('-');
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / DIA_MS);
  }
  function paraIso(n) {
    var d = new Date(n * DIA_MS);
    return d.getUTCFullYear() + '-' + dois(d.getUTCMonth() + 1) + '-' + dois(d.getUTCDate());
  }
  function montar(ano, mes, dia) { return ano + '-' + dois(mes) + '-' + dois(dia); }
  function partes(iso) {
    var p = iso.split('-');
    return { ano: +p[0], mes: +p[1], dia: +p[2] };
  }
  function somarDias(iso, n) { return paraIso(paraNumero(iso) + n); }
  function diasNoMes(ano, mes) { return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); }
  function existe(ano, mes, dia) { return mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasNoMes(ano, mes); }

  // 0 = domingo ... 6 = sábado. 01/01/1970 foi uma quinta (4).
  function semanaDoNumero(n) { return ((n % 7) + 11) % 7; }
  function diaDaSemana(iso) { return semanaDoNumero(paraNumero(iso)); }
  // Índice da semana; a semana vira no domingo.
  function indiceSemana(n) { return Math.floor((n + 4) / 7); }

  function minutosDaHora(h) {
    var p = h.split(':');
    return +p[0] * 60 + +p[1];
  }
  // Minutos absolutos de uma data + hora locais. Serve para comparar momentos.
  function minutos(iso, hora) { return paraNumero(iso) * 1440 + (hora ? minutosDaHora(hora) : 0); }

  function listaDeNumeros(v, min, max) {
    if (typeof v === 'string') v = v.split(/[,;\s]+/);
    if (!Array.isArray(v)) return [];
    var vistos = {}, r = [];
    v.forEach(function (x) {
      var n = parseInt(x, 10);
      if (!isNaN(n) && n >= min && n <= max && !vistos[n]) { vistos[n] = true; r.push(n); }
    });
    return r;
  }
  function listaDeDatas(v) {
    if (typeof v === 'string') v = v.split(/[,;\s]+/);
    if (!Array.isArray(v)) return [];
    return v.filter(ehData).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort();
  }

  // Deixa um compromisso com todos os campos no formato certo.
  function normalizar(e) {
    e = e || {};
    var repete = REPETICOES.indexOf(e.repete) >= 0 ? e.repete : 'nao';
    var hora = ehHora(e.hora) ? e.hora : '';
    var horaFim = hora && ehHora(e.horaFim) && e.horaFim > hora ? e.horaFim : '';
    var dias = repete === 'semanal' ? listaDeNumeros(e.dias, 0, 6).sort() : [];
    var data = ehData(e.data) ? e.data : '';
    if (repete === 'semanal' && !dias.length && data) dias = [diaDaSemana(data)];
    return {
      id: String(e.id || ''),
      titulo: String(e.titulo || '').trim().slice(0, 200),
      data: data,
      hora: hora,
      horaFim: horaFim,
      repete: repete,
      cada: repete === 'nao' ? 1 : Math.min(52, Math.max(1, parseInt(e.cada, 10) || 1)),
      dias: dias,
      ate: repete !== 'nao' && ehData(e.ate) && e.ate >= data ? e.ate : '',
      avisos: listaDeNumeros(e.avisos, 0, 60 * 24 * 30).sort(function (a, b) { return b - a; }),
      notas: String(e.notas || '').slice(0, 2000),
      excecoes: repete === 'nao' ? [] : listaDeDatas(e.excecoes),
      atualizado: String(e.atualizado || ''),
      apagado: e.apagado === true || e.apagado === 'sim' || e.apagado === 'true'
    };
  }

  // Dias (AAAA-MM-DD) em que o compromisso acontece entre `de` e `ate`, inclusive.
  function ocorrencias(e, de, ate) {
    if (!e || e.apagado || !ehData(e.data)) return [];
    var ini = paraNumero(e.data);
    var a = Math.max(paraNumero(de), ini);
    var b = paraNumero(ate);
    if (e.repete !== 'nao' && ehData(e.ate)) b = Math.min(b, paraNumero(e.ate));
    if (a > b) return [];

    var fora = {};
    (e.excecoes || []).forEach(function (x) { fora[x] = true; });
    var r = [];
    function incluir(n) {
      var iso = paraIso(n);
      if (!fora[iso]) r.push(iso);
    }
    var cada = Math.max(1, e.cada || 1);
    var p, ano, mes, dia, n;

    if (e.repete === 'semanal') {
      var dias = e.dias && e.dias.length ? e.dias : [semanaDoNumero(ini)];
      var s0 = indiceSemana(ini);
      for (n = a; n <= b; n++) {
        if (dias.indexOf(semanaDoNumero(n)) >= 0 && (indiceSemana(n) - s0) % cada === 0) incluir(n);
      }
    } else if (e.repete === 'mensal') {
      p = partes(e.data);
      var pa = partes(paraIso(a));
      ano = pa.ano; mes = pa.mes;
      while (paraNumero(montar(ano, mes, 1)) <= b) {
        var meses = (ano - p.ano) * 12 + (mes - p.mes);
        if (meses >= 0 && meses % cada === 0) {
          dia = Math.min(p.dia, diasNoMes(ano, mes));
          n = paraNumero(montar(ano, mes, dia));
          if (n >= a && n <= b) incluir(n);
        }
        mes++;
        if (mes > 12) { mes = 1; ano++; }
      }
    } else if (e.repete === 'anual') {
      p = partes(e.data);
      var ultimo = partes(paraIso(b)).ano;
      for (ano = partes(paraIso(a)).ano; ano <= ultimo; ano++) {
        if ((ano - p.ano) % cada !== 0) continue;
        dia = Math.min(p.dia, diasNoMes(ano, p.mes));
        n = paraNumero(montar(ano, p.mes, dia));
        if (n >= a && n <= b) incluir(n);
      }
    } else if (ini >= a && ini <= b) {
      incluir(ini);
    }
    return r;
  }

  // Próximo dia (a partir de `de`, inclusive) em que o compromisso acontece, ou ''.
  function proxima(e, de, limiteDias) {
    var limite = limiteDias || 800;
    for (var i = 0; i < limite; i += 120) {
      var ini = somarDias(de, i);
      var lista = ocorrencias(e, ini, somarDias(ini, 119));
      if (lista.length) return lista[0];
    }
    return '';
  }

  // Último dia (até `ate`, inclusive) em que o compromisso aconteceu, ou ''.
  function anterior(e, ate) {
    if (!ehData(e.data) || e.data > ate) return '';
    for (var i = 0; i < 800; i += 120) {
      var fim = somarDias(ate, -i);
      if (fim < e.data) break;
      var lista = ocorrencias(e, somarDias(fim, -119), fim);
      if (lista.length) return lista[lista.length - 1];
    }
    return '';
  }

  // Junta duas listas de compromissos. Para o mesmo id, vale a alteração mais recente.
  function mesclar(a, b) {
    var mapa = {}, ordem = [];
    function por(e) {
      if (!e || !e.id) return;
      var atual = mapa[e.id];
      if (!atual) { ordem.push(e.id); mapa[e.id] = e; return; }
      if (String(e.atualizado || '') > String(atual.atualizado || '')) mapa[e.id] = e;
    }
    (a || []).forEach(por);
    (b || []).forEach(por);
    return ordem.map(function (id) { return mapa[id]; });
  }

  // Remove os apagados há mais de `dias` dias (o "apagado" serve só para avisar os outros aparelhos).
  function limparApagados(lista, hojeIso, dias) {
    var corte = somarDias(hojeIso, -(dias || 60));
    return lista.filter(function (e) {
      return !e.apagado || String(e.atualizado || '').slice(0, 10) >= corte;
    });
  }

  // ---------- Textos ----------

  function nomeDia(iso) { return DIAS[diaDaSemana(iso)]; }
  function diaCurto(iso) { return DIAS_CURTOS[diaDaSemana(iso)]; }
  function nomeMes(m) { return MESES[m - 1]; }

  // "15 de outubro" (com o ano se for outro ano)
  function diaEMes(iso, hojeIso) {
    var p = partes(iso);
    var txt = p.dia + ' de ' + MESES[p.mes - 1];
    if (hojeIso && partes(hojeIso).ano !== p.ano) txt += ' de ' + p.ano;
    return txt;
  }
  // "15/10"
  function curta(iso) {
    var p = partes(iso);
    return dois(p.dia) + '/' + dois(p.mes);
  }
  // "Hoje", "Amanhã", "Ontem" ou "quinta, 15 de outubro"
  function relativa(iso, hojeIso) {
    var dif = paraNumero(iso) - paraNumero(hojeIso);
    if (dif === 0) return 'Hoje';
    if (dif === 1) return 'Amanhã';
    if (dif === -1) return 'Ontem';
    return nomeDia(iso).replace('-feira', '') + ', ' + diaEMes(iso, hojeIso);
  }

  function juntar(itens) {
    if (itens.length <= 1) return itens.join('');
    return itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1];
  }

  function descreverRepeticao(e) {
    var cada = e.cada || 1;
    if (e.repete === 'semanal') {
      var dias = (e.dias && e.dias.length ? e.dias : [diaDaSemana(e.data)]).slice().sort();
      var chave = dias.join();
      var nomes;
      if (dias.length === 7) nomes = 'todos os dias';
      else if (chave === '1,2,3,4,5') nomes = 'de segunda a sexta';
      else nomes = juntar(dias.map(function (d) { return DIAS[d].replace('-feira', ''); }));
      if (cada > 1) return 'A cada ' + cada + ' semanas: ' + nomes;
      if (dias.length === 7) return 'Todos os dias';
      if (chave === '1,2,3,4,5') return 'De segunda a sexta';
      // "Todo sábado", "Toda segunda", "Toda segunda e quarta"
      return (dias[0] === 0 || dias[0] === 6 ? 'Todo ' : 'Toda ') + nomes;
    }
    if (e.repete === 'mensal') {
      var dia = partes(e.data).dia;
      return (cada === 1 ? 'Todo mês' : 'A cada ' + cada + ' meses') + ', dia ' + dia;
    }
    if (e.repete === 'anual') {
      var p = partes(e.data);
      return (cada === 1 ? 'Todo ano' : 'A cada ' + cada + ' anos') + ', ' + p.dia + ' de ' + MESES[p.mes - 1];
    }
    return '';
  }

  function descreverAviso(min) {
    if (min === 0) return 'na hora';
    if (min % 10080 === 0) return (min / 10080 === 1 ? '1 semana' : min / 10080 + ' semanas') + ' antes';
    if (min % 1440 === 0) return (min / 1440 === 1 ? '1 dia' : min / 1440 + ' dias') + ' antes';
    if (min % 60 === 0) return (min / 60 === 1 ? '1 hora' : min / 60 + ' horas') + ' antes';
    return min + ' min antes';
  }

  // "às 15:00", "das 15:00 às 16:00" ou "o dia todo"
  function descreverHorario(e) {
    if (!e.hora) return 'o dia todo';
    if (e.horaFim) return 'das ' + e.hora + ' às ' + e.horaFim;
    return 'às ' + e.hora;
  }

  var api = {
    DIAS: DIAS, DIAS_CURTOS: DIAS_CURTOS, DIAS_PLURAL: DIAS_PLURAL, MESES: MESES, MESES_CURTOS: MESES_CURTOS,
    dois: dois, ehData: ehData, ehHora: ehHora,
    paraNumero: paraNumero, paraIso: paraIso, montar: montar, partes: partes, somarDias: somarDias,
    diasNoMes: diasNoMes, existe: existe, diaDaSemana: diaDaSemana, minutos: minutos, minutosDaHora: minutosDaHora,
    normalizar: normalizar, ocorrencias: ocorrencias, proxima: proxima, anterior: anterior,
    mesclar: mesclar, limparApagados: limparApagados,
    nomeDia: nomeDia, diaCurto: diaCurto, nomeMes: nomeMes, diaEMes: diaEMes, curta: curta, relativa: relativa,
    juntar: juntar, descreverRepeticao: descreverRepeticao, descreverAviso: descreverAviso, descreverHorario: descreverHorario
  };
  return api;
})();

if (typeof module === 'object' && module.exports) module.exports = AgendaDatas;
