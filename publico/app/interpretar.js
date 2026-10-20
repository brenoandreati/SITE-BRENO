/* Agenda · entende frases como "Dentista quinta às 15h"
 *
 * interpretar(texto, hojeIso, agoraHora) devolve:
 *   { titulo, data, hora, horaFim, repete, cada, dias, temData, temHora }
 * O que foi reconhecido como data/hora/repetição sai do título.
 */
var AgendaInterpretar = (function (D) {
  'use strict';

  var ACENTOS = {
    'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i', 'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
    'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ç': 'c'
  };

  // Minúsculas e sem acento, com o MESMO tamanho do texto original
  // (assim as posições encontradas valem para o original).
  function normalizar(s) {
    s = String(s || '');
    var r = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i].toLowerCase();
      if (c.length !== 1) c = s[i];
      r += ACENTOS[c] || c;
    }
    return r;
  }

  var DIAS = [
    'domingos?',
    'segundas?(?:[- ]feiras?)?|seg\\.?',
    'tercas?(?:[- ]feiras?)?',
    'quartas?(?:[- ]feiras?)?|qua\\.?',
    'quintas?(?:[- ]feiras?)?|qui\\.?',
    'sextas?(?:[- ]feiras?)?|sex\\.?',
    'sabados?|sab\\.?'
  ];
  var DIA = '(?:' + DIAS.join('|') + ')(?![a-z])';
  var DIAS_RE = DIAS.map(function (d) { return new RegExp('^(?:' + d + ')$'); });

  var MESES = ['jan(?:eiro)?', 'fev(?:ereiro)?', 'mar(?:co)?', 'abr(?:il)?', 'mai(?:o)?', 'jun(?:ho)?',
    'jul(?:ho)?', 'ago(?:sto)?', 'set(?:embro)?', 'out(?:ubro)?', 'nov(?:embro)?', 'dez(?:embro)?'];
  var MES = '(?:' + MESES.join('|') + ')(?![a-z])';
  var MESES_RE = MESES.map(function (m) { return new RegExp('^(?:' + m + ')$'); });

  var NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, quinze: 15, vinte: 20, trinta: 30 };
  var NUM = '(\\d{1,3}|' + Object.keys(NUMEROS).join('|') + ')';
  function numero(txt) { return NUMEROS[txt] || parseInt(txt, 10); }

  function numeroDoDia(txt) {
    txt = txt.replace(/\s+/g, ' ');
    for (var i = 0; i < DIAS_RE.length; i++) if (DIAS_RE[i].test(txt)) return i;
    return -1;
  }
  function numeroDoMes(txt) {
    for (var i = 0; i < MESES_RE.length; i++) if (MESES_RE[i].test(txt)) return i + 1;
    return -1;
  }
  // "segundas", "quintas-feiras", "sábados"
  function ehPlural(txt) {
    var base = txt.replace(/[- ]feiras?$/, '');
    return base.length > 4 && /s$/.test(base);
  }
  function diasDoTrecho(txt) {
    var r = [], re = new RegExp('\\b' + DIA, 'g'), m;
    while ((m = re.exec(txt)) !== null) {
      var n = numeroDoDia(m[0]);
      if (n >= 0 && r.indexOf(n) < 0) r.push(n);
    }
    return r;
  }
  function intervaloDeDias(a, b) {
    var r = [a];
    while (a !== b) { a = (a + 1) % 7; r.push(a); }
    return r;
  }

  function ajustarPeriodo(h, periodo, temMinutoOuH) {
    if (periodo === 'tarde' || periodo === 'noite') {
      if (h < 12) h += 12;
      else if (h === 12 && periodo === 'noite') h = 0;
    } else if (!periodo && !temMinutoOuH && h >= 1 && h <= 6) {
      // "às 3" quase sempre é de tarde
      h += 12;
    }
    return h;
  }
  function hora(h, m) {
    if (h < 0 || h > 23 || m < 0 || m > 59) return '';
    return D.dois(h) + ':' + D.dois(m);
  }

  var TAM_HORA = '(?:h|hs|hrs?|horas?)';
  var PREFIXO_DATA = '(?:\\b(n[ao]|para|pra|pro|em|d[ao]|ate|a\\s+partir\\s+d[eo])\\s+)?';
  var PREFIXO_HORA = '(?:\\b(?:por volta d[ae]s?|perto d[ae]s?|la pel[ao]s|para as|pras|as|a|ao|aos)\\s+)';
  var PERIODO = '(?:\\s+(?:da|de|a)\\s+(manha|tarde|noite|madrugada))?';

  var CONECTORES_FIM = ['e', 'ou', 'no', 'na', 'nos', 'nas', 'em', 'de', 'do', 'da', 'dos', 'das', 'as', 'a', 'ao', 'aos',
    'o', 'para', 'pra', 'pro', 'com', 'ate', 'que', 'proximo', 'proxima', 'nesta', 'neste', 'nessa', 'nesse', 'todo', 'toda', 'todos', 'todas', 'cada'];
  var CONECTORES_INICIO = ['e', 'no', 'na', 'em', 'as', 'ao', 'pra', 'pro', 'para'];

  function interpretar(texto, hojeIso, agoraHora) {
    var original = String(texto || '');
    var t = normalizar(original);
    var usados = [];
    var r = { titulo: '', data: '', hora: '', horaFim: '', repete: 'nao', cada: 1, dias: [], ate: '', temData: false, temHora: false };

    var dataFixa = '';        // data exata (AAAA-MM-DD)
    var diaDoMes = 0;         // "dia 20"
    var diasSemana = [];      // dias da semana citados
    var semanaPlural = false; // "segundas" indica repetição
    var proximaSemana = false;
    var estrito = false;      // "próxima quinta": nunca hoje

    // Procura `fonte` (sem as partes já usadas) e chama fn(m). fn devolve false para ignorar.
    function achar(fonte, fn, umaVez) {
      var re = new RegExp(fonte, 'g'), m, achou = false;
      while ((m = re.exec(t)) !== null) {
        if (!m[0].length) { re.lastIndex++; continue; }
        if (fn(m) === false) continue;
        consumir(m.index, m.index + m[0].length);
        achou = true;
        if (umaVez) break;
      }
      return achou;
    }
    function consumir(a, b) {
      // Troca o trecho por um caractere que nenhuma regra reconhece
      var miolo = '';
      for (var i = a; i < b; i++) miolo += '\u0001';
      t = t.slice(0, a) + miolo + t.slice(b);
      usados.push([a, b]);
    }
    function semana(dias, cada) {
      r.repete = 'semanal';
      if (cada) r.cada = cada;
      dias.forEach(function (d) { if (r.dias.indexOf(d) < 0) r.dias.push(d); });
    }

    // "até 15/12" numa repetição vira a data final; o resto vira a data do compromisso
    function guardarData(prefixo, iso) {
      if (!iso) return false;
      if (prefixo === 'ate' && r.repete !== 'nao') r.ate = iso;
      else dataFixa = iso;
    }

    var hoje = hojeIso;
    var ano = D.partes(hoje).ano;
    var agora = agoraHora || '00:00';

    // ---------- Frases de abertura ----------
    achar('^\\s*(?:(?:eu\\s+)?tenho\\s+(?:que\\s+)?(?:uma?\\s+)?|vou\\s+ter\\s+(?:uma?\\s+)?|(?:marcar|agendar|anotar)\\s+(?:uma?\\s+)?|(?:me\\s+)?lembr(?:ar|a|e)(?:-me)?\\s+de\\s+|lembrete\\s*:?\\s*)', function () { }, true);

    // ---------- Repetições ----------
    // "de segunda a sexta", "segunda a sábado"
    achar('(?:\\b(?:tod[ao]s?\\s+(?:[ao]s\\s+)?)?(?:de|das?|dos?)\\s+)?\\b(' + DIA + ')\\s+(?:a|ate)\\s+(' + DIA + ')', function (m) {
      semana(intervaloDeDias(numeroDoDia(m[1]), numeroDoDia(m[2])));
    });
    achar('\\b(?:(?:tod[ao]s?\\s+(?:[ao]s\\s+)?|n[ao]s\\s+|em\\s+)?dias?\\s+uteis|(?:tod[ao]s?\\s+(?:[ao]s\\s+)?|n[ao]s\\s+)fi(?:m|ns)\\s+de\\s+semana)\\b', function (m) {
      semana(/uteis/.test(m[0]) ? [1, 2, 3, 4, 5] : [0, 6]);
    });
    // "todo dia 5", "todo dia 5 do mês"
    achar('\\btod[ao]s?\\s+(?:[ao]s\\s+)?dias?\\s+(\\d{1,2})(?!\\d|\\s*(?:[/:h]|horas?|de\\s+' + MES + '))(?:\\s+(?:de\\s+cada|do|de\\s+todo)\\s+mes)?', function (m) {
      var d = +m[1];
      if (d < 1 || d > 31) return false;
      r.repete = 'mensal';
      diaDoMes = d;
    });
    // "toda segunda e quarta", "às terças", "nas quintas"
    achar('\\b(?:tod[ao]s?\\s+(?:[ao]s\\s+)?|cada\\s+|n[ao]s\\s+|aos\\s+|as\\s+)(' + DIA + '(?:(?:\\s*,\\s*|\\s+e\\s+)(?:[ao]s?\\s+)?' + DIA + ')*)', function (m) {
      // "as quinta" (singular, sem "toda") é um dia só, não repetição
      if (/^as\s/.test(m[0]) && !ehPlural(m[1].split(/\s|,/)[0])) return false;
      semana(diasDoTrecho(m[1]));
    });
    // "a cada 2 semanas", "quinzenal", "de 15 em 15 dias"
    achar('\\b(?:a\\s+cada\\s+' + NUM + '\\s+(semanas?|dias|mes(?:es)?|anos?)|de\\s+(\\d{1,2})\\s+em\\s+\\d{1,2}\\s+dias|quinzena(?:l|lmente)|semana\\s+sim,?\\s+semana\\s+nao|(bimestral|trimestral|semestral)(?:mente)?)\\b', function (m) {
      if (/quinzena|semana\s+sim/.test(m[0])) { semana([], 2); return; }
      if (m[4]) { r.repete = 'mensal'; r.cada = { bimestral: 2, trimestral: 3, semestral: 6 }[m[4]]; return; }
      var n = m[3] ? +m[3] : numero(m[1]);
      var unidade = m[3] ? 'dias' : m[2];
      if (!n || n < 1) return false;
      if (/^semana/.test(unidade)) semana([], n);
      else if (/^dia/.test(unidade)) {
        if (n === 1) { semana([0, 1, 2, 3, 4, 5, 6]); return; }
        if (n % 7 !== 0 && n !== 15) return false;
        semana([], n === 15 ? 2 : n / 7);
      } else if (/^mes/.test(unidade)) { r.repete = 'mensal'; r.cada = n; }
      else { r.repete = 'anual'; r.cada = n; }
    });
    achar('\\b(?:tod[ao]s?\\s+(?:[ao]s\\s+)?(?:santa\\s+)?semanas?|semanal(?:mente)?|uma\\s+vez\\s+por\\s+semana)\\b', function () {
      if (r.repete === 'nao') r.repete = 'semanal';
    });
    achar('\\b(?:tod[ao]s?\\s+(?:[ao]s\\s+)?mes(?:es)?|mensal(?:mente)?|uma\\s+vez\\s+por\\s+mes)(?![a-z])', function () {
      if (r.repete === 'nao') r.repete = 'mensal';
    });
    achar('\\b(?:tod[ao]s?\\s+(?:[ao]s\\s+)?anos?|anual(?:mente)?|uma\\s+vez\\s+por\\s+ano)\\b', function () {
      if (r.repete === 'nao') r.repete = 'anual';
    });
    achar('\\b(?:tod[ao]s?\\s+(?:[ao]s\\s+)?(?:santo\\s+)?dias?|diariamente|diario)\\b', function () {
      semana([0, 1, 2, 3, 4, 5, 6]);
    });

    // ---------- Datas ----------
    achar('\\b(?:(?:para|pra|pro)\\s+)?depois\\s+de\\s+amanha\\b', function () { dataFixa = D.somarDias(hojeIso, 2); });
    achar('\\b(?:(?:para|pra|pro|de)\\s+)?(hoje|hj|amanha)\\b', function (m) {
      dataFixa = D.somarDias(hojeIso, m[1] === 'amanha' ? 1 : 0);
    });
    achar('\\b(?:daqui\\s+(?:a\\s+)?|em\\s+|dentro\\s+de\\s+)' + NUM + '\\s+(dias?|semanas?|mes(?:es)?)\\b', function (m) {
      var n = numero(m[1]);
      if (!n) return false;
      if (/^dia/.test(m[2])) dataFixa = D.somarDias(hojeIso, n);
      else if (/^semana/.test(m[2])) dataFixa = D.somarDias(hojeIso, n * 7);
      else {
        var p = D.partes(hojeIso), mes = p.mes + n, a = p.ano + Math.floor((mes - 1) / 12);
        mes = ((mes - 1) % 12) + 1;
        dataFixa = D.montar(a, mes, Math.min(p.dia, D.diasNoMes(a, mes)));
      }
    });
    // 15/10, 15/10/2026, 15/10/26
    achar(PREFIXO_DATA + '(?:\\b(?:o\\s+)?dia\\s+)?\\b(\\d{1,2})\\s*/\\s*(\\d{1,2})(?:\\s*/\\s*(\\d{4}|\\d{2}))?(?!\\d)', function (m) {
      var a = m[4] ? +m[4] : 0;
      if (a && a < 100) a += 2000;
      return guardarData(m[1], proximaData(a, +m[3], +m[2]));
    });
    // 15 de outubro, 1º de maio de 2027, 15 out
    achar(PREFIXO_DATA + '(?:\\b(?:o\\s+)?dia\\s+)?\\b(\\d{1,2})(?:\\s*[ºo°])?\\s+(?:de\\s+)?(' + MES + ')(?:\\s+(?:de\\s+)?(\\d{4}))?', function (m) {
      var mes = numeroDoMes(m[3]);
      if (mes < 0) return false;
      return guardarData(m[1], proximaData(m[4] ? +m[4] : 0, mes, +m[2]));
    });
    // dia 20
    achar('(?:\\b(?:n[ao]|para|pra|pro|em|ate|a\\s+partir\\s+d[eo])\\s+)?\\b(?:o\\s+)?dia\\s+(\\d{1,2})(?!\\d|\\s*(?:[/:h]|horas?))(?:\\s+(?:de|d)?\\s*(?:este|esse|deste|desse)\\s+mes)?', function (m) {
      var d = +m[1];
      if (d < 1 || d > 31) return false;
      diaDoMes = d;
    });
    // quinta, na próxima quinta, sexta que vem, quinta da semana que vem
    achar('(?:\\b(?:n[ao]|nest[ae]|ness[ae]|est[ae]|ess[ae]|para|pra|pro|em|d[ao]|ate)\\s+)?(?:\\b(proxim[ao]|outr[ao])\\s+)?\\b(' + DIA + ')(?:\\s+(que\\s+vem|da\\s+(?:semana\\s+que\\s+vem|proxima\\s+semana)))?', function (m) {
      var n = numeroDoDia(m[2]);
      if (n < 0) return false;
      if (diasSemana.indexOf(n) < 0) diasSemana.push(n);
      if (ehPlural(m[2])) semanaPlural = true;
      if (m[1] || /que\s+vem$/.test(m[3] || '')) estrito = true;
      if (m[3] && /semana/.test(m[3])) proximaSemana = true;
    });

    // ---------- Horários ----------
    // das 14h às 16h, entre 9h e 11h, 14h-15h30, 14-16h
    achar('(\\b(?:das?|de|entre)\\s+)?\\b(\\d{1,2})(?:\\s*(?:h|:)\\s*(\\d{2}))?\\s*(' + TAM_HORA + ')?\\s*(-|–|\\ba\\b|\\bas\\b|\\bate\\b|\\be\\b)\\s*(\\d{1,2})(?:\\s*(?:h|:)\\s*(\\d{2}))?\\s*(' + TAM_HORA + ')?(?![a-z\\d])' + PERIODO, function (m) {
      var marcado1 = !!(m[3] || m[4]), marcado2 = !!(m[7] || m[8]), traco = /^[-–]$/.test(m[5]);
      var ok = (m[1] && (marcado1 || marcado2 || m[9])) || (marcado1 && marcado2) || (traco && (marcado1 || marcado2)) ||
        // "14 às 16h" (mas "sala 2 às 15h" não é intervalo)
        (marcado2 && /^(?:as|ate)$/.test(m[5]) && +m[2] >= 6 && +m[2] < +m[6]);
      if (!ok) return false;
      var h1 = ajustarPeriodo(+m[2], m[9], true), h2 = ajustarPeriodo(+m[6], m[9], true);
      if (m[9] && h1 > h2) h1 = +m[2];
      var a = hora(h1, +(m[3] || 0)), b = hora(h2, +(m[7] || 0));
      if (!a || !b || b <= a) return false;
      r.hora = a; r.horaFim = b;
    }, true);
    if (!r.hora) {
      achar('(?:' + PREFIXO_HORA + ')?\\b(meio[- ]?dia|meia[- ]?noite)(?:\\s+e\\s+(meia|quinze))?', function (m) {
        r.hora = hora(/meio/.test(m[1]) ? 12 : 0, m[2] === 'meia' ? 30 : m[2] ? 15 : 0);
      }, true);
    }
    if (!r.hora) {
      achar('(' + PREFIXO_HORA + ')?\\b(\\d{1,2})(?:\\s*(?:h|:)\\s*(\\d{2})(?:\\s*(?:h|hs|min))?|\\s*(' + TAM_HORA + ')(?![a-z]))?(?:\\s+e\\s+(meia|quinze))?' + PERIODO + '(?![a-z\\d/])', function (m) {
        if (!m[1] && !m[3] && !m[4] && !m[6]) return false;
        var h = ajustarPeriodo(+m[2], m[6], !!(m[3] || m[4]) || /^0/.test(m[2]));
        var min = m[3] ? +m[3] : m[5] === 'meia' ? 30 : m[5] ? 15 : 0;
        var hh = hora(h, min);
        if (!hh) return false;
        r.hora = hh;
      }, true);
    }
    r.temHora = !!r.hora;

    // ---------- Resolver a data ----------
    if (dataFixa) {
      r.data = dataFixa;
    } else if (diaDoMes) {
      r.data = proximoDiaDoMes(diaDoMes);
    } else if (diasSemana.length) {
      if (diasSemana.length > 1 || semanaPlural || r.repete === 'semanal') {
        semana(diasSemana);
      } else {
        r.data = proximoDiaDaSemana(diasSemana[0]);
      }
    } else if (r.repete === 'nao' && r.hora && r.hora <= agora) {
      r.data = D.somarDias(hoje, 1);
    }
    if (!r.data) r.data = hoje;
    if (r.repete === 'semanal') {
      if (!r.dias.length) r.dias = [D.diaDaSemana(r.data)];
      r.dias.sort();
      // começa no primeiro dia da lista a partir da data
      for (var i = 0; i < 7 && r.dias.indexOf(D.diaDaSemana(r.data)) < 0; i++) r.data = D.somarDias(r.data, 1);
    } else {
      r.dias = [];
    }
    if (r.repete === 'nao') r.cada = 1;
    r.temData = !!dataFixa || !!diaDoMes || diasSemana.length > 0 || r.repete !== 'nao';
    if (r.repete === 'nao' || r.ate < r.data) r.ate = '';

    r.titulo = montarTitulo(original, usados);
    return r;

    // ----- auxiliares que dependem de "hoje" -----
    function proximaData(a, mes, d) {
      if (a) return D.existe(a, mes, d) ? D.montar(a, mes, d) : '';
      for (var y = ano; y <= ano + 4; y++) {
        if (!D.existe(y, mes, d)) continue;
        var iso = D.montar(y, mes, d);
        if (iso >= hoje) return iso;
      }
      return '';
    }
    function proximoDiaDoMes(d) {
      var p = D.partes(hoje);
      for (var k = 0; k < 14; k++) {
        var mes = ((p.mes - 1 + k) % 12) + 1, y = p.ano + Math.floor((p.mes - 1 + k) / 12);
        if (!D.existe(y, mes, d)) continue;
        var iso = D.montar(y, mes, d);
        if (iso >= hoje) return iso;
      }
      return hoje;
    }
    function proximoDiaDaSemana(n) {
      var hojeN = D.diaDaSemana(hoje);
      if (proximaSemana) {
        // a semana que vem começa no próximo domingo
        return D.somarDias(hoje, 7 - hojeN + n);
      }
      var dif = (n - hojeN + 7) % 7;
      if (dif === 0 && (estrito || (r.hora && r.hora <= agora))) dif = 7;
      return D.somarDias(hoje, dif);
    }
  }

  function montarTitulo(original, usados) {
    var fora = [];
    usados.forEach(function (u) { for (var i = u[0]; i < u[1]; i++) fora[i] = true; });
    var s = '';
    for (var i = 0; i < original.length; i++) s += fora[i] ? ' ' : original[i];
    var palavras = s.replace(/\s+([,;.!?])/g, '$1').split(/\s+/).filter(Boolean);

    function limpa(p) { return normalizar(p).replace(/[,;:.!?\-–—]+$/, '').replace(/^[,;:.!?\-–—]+/, ''); }
    // tira pontuação solta
    palavras = palavras.filter(function (p) { return /[\p{L}\p{N}]/u.test(p); });
    var mudou = true;
    while (mudou && palavras.length) {
      mudou = false;
      if (CONECTORES_FIM.indexOf(limpa(palavras[palavras.length - 1])) >= 0 && palavras.length > 1) { palavras.pop(); mudou = true; }
      else if (CONECTORES_INICIO.indexOf(limpa(palavras[0])) >= 0 && palavras.length > 1) { palavras.shift(); mudou = true; }
    }
    if (palavras.length === 1 && CONECTORES_FIM.indexOf(limpa(palavras[0])) >= 0) palavras = [];
    var titulo = palavras.join(' ').replace(/[\s,;:\-–—]+$/, '').replace(/^[\s,;:\-–—]+/, '').replace(/,(?=\S)/g, ', ');
    return titulo ? titulo.charAt(0).toUpperCase() + titulo.slice(1) : '';
  }

  return { interpretar: interpretar, normalizar: normalizar };
})(typeof AgendaDatas !== 'undefined' ? AgendaDatas : require('./datas.js'));

if (typeof module === 'object' && module.exports) module.exports = AgendaInterpretar;
