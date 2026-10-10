/* Agenda · tela
 * Guarda tudo neste aparelho (localStorage) e, se conectado ao servidor do
 * Google (servidor/Codigo.gs), sincroniza e deixa os avisos com o servidor.
 */
(function () {
  'use strict';

  var D = window.AgendaDatas;
  var I = window.AgendaInterpretar;

  var CHAVES = { eventos: 'agenda.eventos', conexao: 'agenda.conexao', prefs: 'agenda.prefs' };
  var AVISOS = [[0, 'Na hora'], [15, '15 min antes'], [30, '30 min antes'], [60, '1 hora antes'], [120, '2 horas antes'],
    [1440, '1 dia antes'], [2880, '2 dias antes'], [10080, '1 semana antes']];
  var AVISO_PADRAO = [1440, 60];
  var LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  // ---------- armazenamento ----------
  function ler(chave, padrao) {
    try {
      var v = localStorage.getItem(chave);
      return v ? JSON.parse(v) : padrao;
    } catch (e) {
      return padrao;
    }
  }
  function gravar(chave, valor) {
    try {
      if (valor == null) localStorage.removeItem(chave);
      else localStorage.setItem(chave, JSON.stringify(valor));
    } catch (e) { /* modo privado: segue só na memória */ }
  }
  function lerEventos() {
    var lista = ler(CHAVES.eventos, []);
    return (Array.isArray(lista) ? lista : []).map(D.normalizar).filter(function (e) { return e.id; });
  }

  var estado = {
    eventos: lerEventos(),
    conexao: ler(CHAVES.conexao, null),
    prefs: Object.assign({ avisoPadrao: AVISO_PADRAO, pendente: false, ultimaSinc: '' }, ler(CHAVES.prefs, {})),
    aba: 'agenda',
    diasLista: 30,
    mesCal: '',
    diaSel: '',
    consulta: '',
    sinc: 'local',
    sincMsg: '',
    remoto: null
  };

  // ---------- utilidades ----------
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function hoje() {
    var d = new Date();
    return D.montar(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  function agoraHora() {
    var d = new Date();
    return D.dois(d.getHours()) + ':' + D.dois(d.getMinutes());
  }
  function novoId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* segue */ }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function ativos() { return estado.eventos.filter(function (e) { return !e.apagado; }); }
  function porId(id) { return estado.eventos.filter(function (e) { return e.id === id; })[0] || null; }
  function icone(nome) { return '<svg aria-hidden="true"><use href="#i-' + nome + '"/></svg>'; }
  function semDiaFeira(s) { return s.replace('-feira', ''); }

  // "1 dia e 1 hora antes"
  function avisosTexto(lista) {
    var antes = lista.filter(function (m) { return m > 0; }).map(function (m) { return D.descreverAviso(m).replace(' antes', ''); });
    var t = antes.length ? D.juntar(antes) + ' antes' : '';
    if (lista.indexOf(0) >= 0) t = t ? t + ' e na hora' : 'na hora';
    return t;
  }

  // "quinta, 15 de outubro às 15:00" ou "toda segunda e quarta às 18:00"
  function quandoTexto(e) {
    var h = hoje();
    var dia = e.repete === 'nao' ? D.relativa(e.data, h) : D.descreverRepeticao(e);
    return dia.charAt(0).toLowerCase() + dia.slice(1) + (e.hora ? ' ' + D.descreverHorario(e) : '');
  }

  // [{ e, dia }] de `de` até `ate`, em ordem (dia todo primeiro)
  function agendaEntre(de, ate) {
    var r = [];
    ativos().forEach(function (e) {
      D.ocorrencias(e, de, ate).forEach(function (dia) { r.push({ e: e, dia: dia }); });
    });
    r.sort(function (a, b) {
      var x = a.dia + (a.e.hora || ''), y = b.dia + (b.e.hora || '');
      return x < y ? -1 : x > y ? 1 : a.e.titulo.localeCompare(b.e.titulo, 'pt-BR');
    });
    return r;
  }

  // ---------- alterações ----------
  function salvarLocal() {
    gravar(CHAVES.eventos, estado.eventos);
    gravar(CHAVES.prefs, estado.prefs);
  }

  function guardar(dados) {
    var e = D.normalizar(Object.assign({}, dados, { atualizado: new Date().toISOString() }));
    var achou = false;
    estado.eventos = estado.eventos.map(function (x) {
      if (x.id !== e.id) return x;
      achou = true;
      return e;
    });
    if (!achou) estado.eventos.push(e);
    if (estado.conexao) estado.prefs.pendente = true;
    salvarLocal();
    renderizar();
    agendarSinc();
    return e;
  }
  function apagar(id) {
    var e = porId(id);
    if (e) guardar(Object.assign({}, e, { apagado: true }));
  }
  function apagarDia(id, dia) {
    var e = porId(id);
    if (e) guardar(Object.assign({}, e, { excecoes: e.excecoes.concat([dia]) }));
  }
  function restaurar(copia) { guardar(Object.assign({}, copia, { apagado: false })); }

  // ---------- render: Agenda ----------
  function renderizar() {
    renderAgenda();
    if (estado.aba === 'buscar') renderBuscar();
  }

  function renderAgenda() {
    var h = hoje();
    $('#titulo-agenda').innerHTML = esc(cap(semDiaFeira(D.nomeDia(h)))) + ', <em>' + esc(D.diaEMes(h)) + '</em>';

    var fim = D.somarDias(h, estado.diasLista - 1);
    var itens = agendaEntre(h, fim);
    var dias = {};
    itens.forEach(function (it) { (dias[it.dia] = dias[it.dia] || []).push(it); });
    var ordem = Object.keys(dias).filter(function (d) { return d !== h; }).sort();
    var temAlgo = ativos().length > 0;

    var html = '';
    if (!temAlgo) {
      html = '<div class="vazio">' +
        '<p class="vazio__titulo">Sua agenda está vazia.</p>' +
        '<p>Escreva aqui em cima o que você tem e o dia da semana. A agenda entende sozinha e já deixa marcado.</p>' +
        '</div>';
    } else {
      html += secaoDia(h, dias[h] || [], h);
      ordem.forEach(function (d) { html += secaoDia(d, dias[d], h); });
      if (!ordem.length) {
        html += '<p class="lista__fim">Nada marcado nos próximos ' + estado.diasLista + ' dias.</p>';
      }
    }
    $('#lista').innerHTML = html;
    $('#mais-dias').hidden = !temAlgo || estado.diasLista >= 366;
    $('#exemplos').hidden = estado.eventos.length > 3;
  }

  function secaoDia(dia, lista, h) {
    var rel = D.relativa(dia, h);
    var nome = rel === 'Hoje' || rel === 'Amanhã'
      ? rel + ' <span>' + esc(D.diaCurto(dia)) + ', ' + esc(D.curta(dia)) + '</span>'
      : esc(cap(semDiaFeira(D.nomeDia(dia)))) + ' <span>' + esc(D.diaEMes(dia, h)) + '</span>';
    var corpo = lista.length
      ? '<ul class="itens">' + lista.map(function (it) { return itemHtml(it.e, it.dia, h); }).join('') + '</ul>'
      : '<p class="dia__vazio">Nada marcado para hoje.</p>';
    return '<section class="dia' + (dia === h ? ' dia--hoje' : '') + '"><h2 class="dia__rotulo">' + nome + '</h2>' + corpo + '</section>';
  }

  function itemHtml(e, dia, h, opcoes) {
    opcoes = opcoes || {};
    var agora = agoraHora();
    var passou = dia < h || (dia === h && e.hora && (e.horaFim || e.hora) < agora);
    var info = [];
    if (opcoes.linha) info.push('<span>' + esc(opcoes.linha) + '</span>');
    if (e.repete !== 'nao') info.push('<span>' + icone('repete') + esc(D.descreverRepeticao(e)) + '</span>');
    if (e.avisos.length && opcoes.avisos) info.push('<span>' + icone('sino') + esc(cap(avisosTexto(e.avisos))) + '</span>');
    if (e.notas) info.push('<span class="item__nota">' + icone('nota') + esc(e.notas.length > 70 ? e.notas.slice(0, 70) + '…' : e.notas) + '</span>');
    var hora = opcoes.coluna
      ? opcoes.coluna
      : e.hora ? esc(e.hora) + (e.horaFim ? '<small>' + esc(e.horaFim) + '</small>' : '') : '<small>Dia todo</small>';
    return '<li><button class="item' + (passou && !opcoes.coluna ? ' item--passou' : '') + '" type="button" data-id="' + esc(e.id) + '" data-dia="' + esc(dia) + '">' +
      '<span class="item__hora">' + hora + '</span>' +
      '<span class="item__corpo"><span class="item__titulo">' + esc(e.titulo) +
      (e.avisos.length && !opcoes.avisos ? '<svg class="item__sino" role="img" aria-label="com aviso"><title>Aviso: ' + esc(avisosTexto(e.avisos)) + '</title><use href="#i-sino"/></svg>' : '') + '</span>' +
      (info.length ? '<span class="item__info">' + info.join('') + '</span>' : '') +
      '</span></button></li>';
  }

  // ---------- adicionar rápido ----------
  var campoRapido = $('#rapido-texto');

  function atualizarPrevia() {
    var txt = campoRapido.value.trim();
    var el = $('#previa');
    if (!txt) {
      el.innerHTML = '';
      el.classList.remove('previa--visivel');
      return;
    }
    var r = I.interpretar(txt, hoje(), agoraHora());
    var tags = [];
    var h = hoje();
    if (r.repete === 'nao') tags.push(icone('agenda') + esc(D.relativa(r.data, h)));
    else {
      tags.push(icone('repete') + esc(D.descreverRepeticao(r)));
      if (r.data !== h) tags.push('a partir de ' + esc(D.relativa(r.data, h).toLowerCase()));
      if (r.ate) tags.push('até ' + esc(D.curta(r.ate)));
    }
    tags.push(r.hora ? esc(r.hora + (r.horaFim ? '–' + r.horaFim : '')) : 'dia todo');
    if (estado.prefs.avisoPadrao.length) tags.push(icone('sino') + esc(cap(avisosTexto(estado.prefs.avisoPadrao))));
    el.innerHTML =
      '<p class="previa__titulo">' + (r.titulo ? esc(r.titulo) : '<span class="previa__falta">Falta dizer o que é</span>') + '</p>' +
      '<p class="previa__tags">' + tags.map(function (t) { return '<span>' + t + '</span>'; }).join('') + '</p>' +
      '<button class="btn btn--texto previa__ajustar" type="button" data-ajustar>Ajustar detalhes</button>';
    el.classList.add('previa--visivel');
  }

  function dadosDaFrase() {
    var r = I.interpretar(campoRapido.value.trim(), hoje(), agoraHora());
    return {
      titulo: r.titulo, data: r.data, hora: r.hora, horaFim: r.horaFim, repete: r.repete, cada: r.cada,
      dias: r.dias, ate: r.ate, avisos: estado.prefs.avisoPadrao.slice(), notas: ''
    };
  }

  $('#rapido').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!campoRapido.value.trim()) {
      abrirFolha({});
      return;
    }
    var dados = dadosDaFrase();
    if (!dados.titulo) {
      mostrarToast('Diga o que é, por exemplo: “Dentista quinta às 15h”.');
      campoRapido.focus();
      return;
    }
    dados.id = novoId();
    var e = guardar(dados);
    campoRapido.value = '';
    atualizarPrevia();
    mostrarDepoisDeSalvar(e, 'Agendado');
  });
  campoRapido.addEventListener('input', atualizarPrevia);

  $('#previa').addEventListener('click', function (ev) {
    if (ev.target.closest('[data-ajustar]')) abrirFolha(dadosDaFrase());
  });
  $('#exemplos').addEventListener('click', function (ev) {
    var b = ev.target.closest('.exemplo');
    if (!b) return;
    campoRapido.value = b.textContent;
    atualizarPrevia();
    campoRapido.focus();
  });
  $('#mais-dias').addEventListener('click', function () {
    estado.diasLista = Math.min(366, estado.diasLista + 60);
    renderAgenda();
  });

  function mostrarDepoisDeSalvar(e, verbo) {
    var primeira = D.proxima(e, hoje()) || e.data;
    var distancia = D.paraNumero(primeira) - D.paraNumero(hoje());
    if (distancia >= estado.diasLista && distancia < 366) {
      estado.diasLista = distancia + 1;
      renderAgenda();
    }
    mostrarToast(verbo + ': ' + e.titulo + ', ' + quandoTexto(e) + '.', 'Desfazer', function () {
      var antes = porId(e.id);
      if (antes) apagar(e.id);
    });
    destacar(e.id);
  }

  function destacar(id) {
    var el = $('#lista .item[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!el) return;
    el.classList.add('item--novo');
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------- formulário (folha) ----------
  var folha = $('#folha');
  var form = $('#form-evento');
  var edicao = null;      // { id, dia } quando editando
  var formDias = [];
  var formAvisos = [];

  function montarChipsAvisos(el, selecionados) {
    el.innerHTML = AVISOS.map(function (a) {
      var on = selecionados.indexOf(a[0]) >= 0;
      return '<button type="button" class="chip" data-aviso="' + a[0] + '" aria-pressed="' + on + '">' + esc(a[1]) + '</button>';
    }).join('');
  }

  function abrirFolha(dados, dia) {
    dados = dados || {};
    var existente = dados.id ? porId(dados.id) : null;
    edicao = existente ? { id: existente.id, dia: dia || '' } : null;
    $('#folha-titulo').textContent = edicao ? 'Editar compromisso' : 'Novo compromisso';
    form.reset();
    form.classList.remove('form--erro');
    form.titulo.value = dados.titulo || '';
    form.data.value = dados.data || hoje();
    form.hora.value = dados.hora || '';
    form.horaFim.value = dados.horaFim || '';
    form.diaTodo.checked = !dados.hora && !!(dados.titulo || existente);
    form.notas.value = dados.notas || '';
    form.ate.value = dados.ate || '';
    var repete = dados.repete || 'nao';
    $$('input[name="repete"]', form).forEach(function (r) { r.checked = r.value === repete; });
    formDias = (dados.dias || []).slice();
    formAvisos = (dados.avisos || estado.prefs.avisoPadrao).slice();
    montarOpcoesCada(repete, dados.cada || 1);
    montarChipsAvisos($('#ev-avisos'), formAvisos);

    $('#ev-apagar-area').hidden = !edicao;
    $('#ev-apagar-confirma').hidden = true;
    $('#ev-apagar').hidden = false;
    atualizarFolha();
    if (typeof folha.showModal === 'function') folha.showModal();
    else folha.setAttribute('open', '');
    if (!dados.titulo) setTimeout(function () { form.titulo.focus(); }, 50);
  }

  function fecharFolha() {
    if (typeof folha.close === 'function') folha.close();
    else folha.removeAttribute('open');
  }

  function repeteAtual() { return ($('input[name="repete"]:checked', form) || {}).value || 'nao'; }

  function montarOpcoesCada(repete, valor) {
    var nomes = { semanal: ['semana', 'semanas'], mensal: ['mês', 'meses'], anual: ['ano', 'anos'] }[repete] || ['semana', 'semanas'];
    var max = repete === 'mensal' ? 12 : 4;
    var html = '';
    for (var n = 1; n <= max; n++) html += '<option value="' + n + '">' + n + ' ' + nomes[n === 1 ? 0 : 1] + '</option>';
    $('#ev-cada').innerHTML = html;
    $('#ev-cada').value = String(Math.min(valor, max));
  }

  function atualizarFolha() {
    var repete = repeteAtual();
    var data = form.data.value || hoje();
    var semanal = repete === 'semanal';
    if (semanal && !formDias.length) formDias = [D.diaDaSemana(data)];

    var escolhidos = semanal ? formDias : [D.diaDaSemana(data)];
    $('#ev-semana').innerHTML = LETRAS.map(function (l, i) {
      var on = escolhidos.indexOf(i) >= 0;
      return '<button type="button" class="dia-semana" data-semana="' + i + '" aria-pressed="' + on + '" aria-label="' + D.DIAS[i] + '">' + l + '</button>';
    }).join('');
    $('#ev-semana-rotulo').textContent = semanal ? 'Dias da semana' : 'Dia da semana';
    var dica;
    if (semanal) dica = D.descreverRepeticao({ repete: 'semanal', dias: formDias, cada: +$('#ev-cada').value || 1, data: data }) + '. Toque para escolher os dias.';
    else dica = cap(D.relativa(data, hoje())) + (D.relativa(data, hoje()).indexOf(',') < 0 ? ', ' + semDiaFeira(D.nomeDia(data)) + ' ' + D.curta(data) : '');
    $('#ev-semana-dica').textContent = dica;
    $('#ev-data-rotulo').textContent = repete === 'nao' ? 'Data' : 'Começa em';

    $('#ev-repete-extra').hidden = repete === 'nao';
    $('#ev-cada-rotulo').textContent = 'A cada';

    var diaTodo = form.diaTodo.checked;
    form.hora.disabled = diaTodo;
    form.horaFim.disabled = diaTodo;
    var dicaAviso = '';
    if (!estado.conexao) dicaAviso = 'Os avisos chegam no WhatsApp depois que você conectar ao Google, em Ajustes.';
    else if (diaTodo || !form.hora.value) dicaAviso = 'Sem horário, o aviso conta a partir das 9h do dia.';
    $('#ev-avisos-dica').textContent = dicaAviso;
    $('#ev-apagar-dia').hidden = !(edicao && edicao.dia && repete !== 'nao');
    if (edicao && edicao.dia) $('#ev-apagar-dia').textContent = 'Só ' + D.curta(edicao.dia);
    $('#ev-apagar-tudo').textContent = edicao && repete !== 'nao' ? 'Todos os dias' : 'Apagar';
  }

  $('#ev-semana').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-semana]');
    if (!b) return;
    var n = +b.dataset.semana;
    if (repeteAtual() === 'semanal') {
      var i = formDias.indexOf(n);
      if (i >= 0 && formDias.length > 1) formDias.splice(i, 1);
      else if (i < 0) formDias.push(n);
      formDias.sort();
    } else {
      // próximo dia com esse dia da semana, a partir de hoje
      var h = hoje();
      form.data.value = D.somarDias(h, (n - D.diaDaSemana(h) + 7) % 7);
    }
    atualizarFolha();
  });
  $('#ev-avisos').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-aviso]');
    if (!b) return;
    var n = +b.dataset.aviso;
    var i = formAvisos.indexOf(n);
    if (i >= 0) formAvisos.splice(i, 1);
    else formAvisos.push(n);
    b.setAttribute('aria-pressed', String(i < 0));
  });
  form.addEventListener('change', function (ev) {
    if (ev.target.name === 'repete') {
      var repete = repeteAtual();
      montarOpcoesCada(repete, 1);
      if (repete === 'semanal') formDias = [D.diaDaSemana(form.data.value || hoje())];
    }
    if (ev.target.name === 'diaTodo' && ev.target.checked) {
      form.hora.value = '';
      form.horaFim.value = '';
    }
    if (ev.target.name === 'data' && repeteAtual() === 'semanal' && formDias.length === 1) {
      formDias = [D.diaDaSemana(form.data.value || hoje())];
    }
    atualizarFolha();
  });
  form.hora.addEventListener('input', function () {
    if (form.hora.value) form.diaTodo.checked = false;
    atualizarFolha();
  });
  form.titulo.addEventListener('input', function () { form.classList.remove('form--erro'); });

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var titulo = form.titulo.value.trim();
    if (!titulo) {
      form.classList.add('form--erro');
      form.titulo.focus();
      return;
    }
    var repete = repeteAtual();
    var base = edicao ? porId(edicao.id) : { id: novoId() };
    var diaTodo = form.diaTodo.checked;
    var e = guardar(Object.assign({}, base, {
      titulo: titulo,
      data: form.data.value || hoje(),
      hora: diaTodo ? '' : form.hora.value,
      horaFim: diaTodo ? '' : form.horaFim.value,
      repete: repete,
      cada: +$('#ev-cada').value || 1,
      dias: repete === 'semanal' ? formDias : [],
      ate: repete === 'nao' ? '' : form.ate.value,
      avisos: formAvisos,
      notas: form.notas.value.trim()
    }));
    var eraNovo = !edicao;
    fecharFolha();
    if (eraNovo) {
      campoRapido.value = '';
      atualizarPrevia();
      mostrarDepoisDeSalvar(e, 'Agendado');
    } else {
      mostrarToast('Salvo: ' + e.titulo + ', ' + quandoTexto(e) + '.');
    }
  });

  folha.addEventListener('click', function (ev) {
    if (ev.target === folha || ev.target.closest('[data-fechar]')) fecharFolha();
  });

  $('#ev-apagar').addEventListener('click', function () {
    $('#ev-apagar').hidden = true;
    $('#ev-apagar-confirma').hidden = false;
  });
  $('#ev-apagar-confirma').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-apagar]');
    if (!b || !edicao) return;
    var tipo = b.dataset.apagar;
    if (tipo === 'nao') {
      $('#ev-apagar').hidden = false;
      $('#ev-apagar-confirma').hidden = true;
      return;
    }
    var copia = Object.assign({}, porId(edicao.id));
    if (tipo === 'dia') apagarDia(edicao.id, edicao.dia);
    else apagar(edicao.id);
    fecharFolha();
    mostrarToast(tipo === 'dia' ? 'Apagado só no dia ' + D.curta(edicao.dia) + '.' : 'Apagado: ' + copia.titulo + '.', 'Desfazer', function () {
      restaurar(copia);
    });
  });

  // Tocar num compromisso abre para editar
  document.addEventListener('click', function (ev) {
    var item = ev.target.closest('.item[data-id]');
    if (item) {
      var e = porId(item.dataset.id);
      if (e) abrirFolha(e, item.dataset.dia);
      return;
    }
    var novo = ev.target.closest('[data-novo]');
    if (novo) abrirFolha({ data: novo.dataset.novo || hoje() });
  });

  // ---------- Buscar ----------
  var campoBusca = $('#busca-texto');
  var PALAVRAS_PERGUNTA = /\b(?:eu|tenho|terei|teria|vou\s+ter|vai\s+ter|tem|ha|existe|algum|alguma|algo|coisa|eventos?|compromissos?|marcad[oa]s?|agendad[oa]s?|nada|livre|o\s+que|minha|meu|agenda)\b/g;

  function interpretarBusca(q) {
    var n = I.normalizar(q).replace(/[?!.]/g, ' ').replace(PALAVRAS_PERGUNTA, ' ').replace(/\s+/g, ' ').trim();
    if (!n) return { tipo: 'vazia' };
    var r = I.interpretar(n, hoje(), '00:00');
    if (r.temData && !r.titulo) return { tipo: 'data', data: r.data };
    return { tipo: 'texto', texto: n };
  }

  function renderBuscar() {
    var h = hoje();
    if (!estado.diaSel) estado.diaSel = h;
    if (!estado.mesCal) estado.mesCal = estado.diaSel.slice(0, 7);
    renderCalendario(h);
    var busca = estado.consulta ? interpretarBusca(estado.consulta) : { tipo: 'vazia' };
    $('#resultado').innerHTML = busca.tipo === 'texto' ? resultadoTexto(busca.texto, h) : resultadoDia(estado.diaSel, h);
  }

  function renderCalendario(h) {
    var p = estado.mesCal.split('-');
    var ano = +p[0], mes = +p[1];
    var total = D.diasNoMes(ano, mes);
    var primeiro = D.montar(ano, mes, 1);
    var contagem = {};
    agendaEntre(primeiro, D.montar(ano, mes, total)).forEach(function (it) { contagem[it.dia] = (contagem[it.dia] || 0) + 1; });
    var celulas = '';
    for (var i = 0; i < D.diaDaSemana(primeiro); i++) celulas += '<span></span>';
    for (var d = 1; d <= total; d++) {
      var iso = D.montar(ano, mes, d);
      var n = contagem[iso] || 0;
      var classes = 'cal__dia' + (iso === h ? ' cal__dia--hoje' : '') + (iso < h ? ' cal__dia--passado' : '') + (n ? ' cal__dia--tem' : '');
      var rotulo = D.relativa(iso, h) + (n ? ', ' + n + (n === 1 ? ' compromisso' : ' compromissos') : ', livre');
      celulas += '<button type="button" class="' + classes + '" data-dia="' + iso + '" aria-pressed="' + (iso === estado.diaSel) + '" aria-label="' + esc(rotulo) + '">' +
        '<span>' + d + '</span><span class="cal__pontos" aria-hidden="true">' + new Array(Math.min(n, 3) + 1).join('<i></i>') + '</span></button>';
    }
    var foraDeHoje = estado.mesCal !== h.slice(0, 7) || estado.diaSel !== h;
    $('#calendario').innerHTML =
      '<div class="cal__topo">' +
      '<button class="icone-btn" type="button" data-mes="-1" aria-label="Mês anterior">' + icone('seta-esq') + '</button>' +
      '<h2 class="cal__mes">' + esc(cap(D.nomeMes(mes))) + ' <span>' + ano + '</span></h2>' +
      '<button class="icone-btn" type="button" data-mes="1" aria-label="Próximo mês">' + icone('seta-dir') + '</button>' +
      '</div>' +
      '<div class="cal__semana" aria-hidden="true">' + LETRAS.map(function (l) { return '<span>' + l + '</span>'; }).join('') + '</div>' +
      '<div class="cal__grade">' + celulas + '</div>' +
      (foraDeHoje ? '<button class="btn btn--texto cal__hoje" type="button" data-hoje>Voltar para hoje</button>' : '');
  }

  function resultadoDia(dia, h) {
    var lista = agendaEntre(dia, dia);
    var n = lista.length;
    var titulo;
    if (!n) titulo = dia < h ? 'Nada marcado nesse dia.' : 'Nada marcado. <em>Dia livre.</em>';
    else if (dia < h) titulo = 'Você teve ' + n + (n === 1 ? ' compromisso.' : ' compromissos.');
    else if (dia === h) titulo = 'Hoje você tem ' + n + (n === 1 ? ' compromisso.' : ' compromissos.');
    else titulo = 'Sim, você tem ' + n + (n === 1 ? ' compromisso.' : ' compromissos.');
    var rel = D.relativa(dia, h);
    var rotulo = rel.indexOf(',') < 0 ? rel + ' · ' + semDiaFeira(D.nomeDia(dia)) + ', ' + D.diaEMes(dia, h) : cap(rel);
    return '<div class="resposta">' +
      '<p class="rotulo">' + esc(rotulo) + '</p>' +
      '<h2 class="resposta__titulo">' + titulo + '</h2>' +
      (n ? '<ul class="itens">' + lista.map(function (it) { return itemHtml(it.e, it.dia, h); }).join('') + '</ul>' : '') +
      '<button class="btn btn--linha" type="button" data-novo="' + dia + '">' + icone('mais') + 'Marcar algo nesse dia</button>' +
      '</div>';
  }

  function resultadoTexto(texto, h) {
    var palavras = texto.split(' ').filter(Boolean);
    var ontem = D.somarDias(h, -1);
    var achados = ativos().filter(function (e) {
      var alvo = I.normalizar(e.titulo + ' ' + e.notas);
      return palavras.every(function (p) { return alvo.indexOf(p) >= 0; });
    }).map(function (e) {
      return { e: e, proxima: D.proxima(e, h), anterior: D.anterior(e, ontem) };
    }).sort(function (a, b) {
      if (a.proxima && b.proxima) return a.proxima < b.proxima ? -1 : a.proxima > b.proxima ? 1 : 0;
      if (a.proxima) return -1;
      if (b.proxima) return 1;
      return (b.anterior || '') < (a.anterior || '') ? -1 : 1;
    });
    var titulo = achados.length
      ? achados.length + (achados.length === 1 ? ' compromisso encontrado' : ' compromissos encontrados')
      : 'Nada encontrado.';
    return '<div class="resposta">' +
      '<p class="rotulo">Busca por “' + esc(estado.consulta.trim()) + '”</p>' +
      '<h2 class="resposta__titulo">' + titulo + '</h2>' +
      (achados.length ? '<ul class="itens">' + achados.slice(0, 60).map(function (a) {
        var dia = a.proxima || a.anterior || a.e.data;
        var linha = a.proxima
          ? (a.e.repete === 'nao' ? '' : 'Próximo: ') + cap(D.relativa(a.proxima, h)) + (a.e.hora ? ' ' + D.descreverHorario(a.e) : '')
          : 'Foi ' + (D.relativa(dia, h) === 'Ontem' ? 'ontem' : 'em ' + D.diaEMes(dia, h));
        var p = D.partes(dia);
        var coluna = esc(String(p.dia)) + '<small>' + esc(D.MESES_CURTOS[p.mes - 1]) + '</small>';
        return itemHtml(a.e, dia, h, { linha: linha, coluna: coluna, avisos: true });
      }).join('') + '</ul>' : '<p class="resposta__texto">Tente outra palavra, ou uma data como “sexta”, “dia 20” ou “25/12”.</p>') +
      '</div>';
  }

  var buscaTimer = null;
  campoBusca.addEventListener('input', function () {
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(function () {
      estado.consulta = campoBusca.value;
      var busca = interpretarBusca(estado.consulta);
      if (busca.tipo === 'data') {
        estado.diaSel = busca.data;
        estado.mesCal = busca.data.slice(0, 7);
      }
      renderBuscar();
    }, 120);
  });
  campoBusca.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') campoBusca.blur();
  });

  $('#calendario').addEventListener('click', function (ev) {
    var dia = ev.target.closest('[data-dia]');
    var mes = ev.target.closest('[data-mes]');
    if (dia) {
      estado.diaSel = dia.dataset.dia;
      if (interpretarBusca(estado.consulta).tipo === 'texto') {
        estado.consulta = '';
        campoBusca.value = '';
      }
    } else if (mes) {
      var p = estado.mesCal.split('-');
      var m = +p[1] + +mes.dataset.mes, a = +p[0];
      if (m < 1) { m = 12; a--; }
      if (m > 12) { m = 1; a++; }
      estado.mesCal = a + '-' + D.dois(m);
    } else if (ev.target.closest('[data-hoje]')) {
      estado.diaSel = hoje();
      estado.mesCal = estado.diaSel.slice(0, 7);
      estado.consulta = '';
      campoBusca.value = '';
    } else {
      return;
    }
    renderBuscar();
  });

  // ---------- servidor do Google ----------
  function urlValida(url) { return /^https:\/\/script\.google\.com\/.+\/exec\/?$/.test(url); }

  function chamar(acao, dados, conexao) {
    conexao = conexao || estado.conexao;
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 30000);
    var corpo = JSON.stringify(Object.assign({ acao: acao, chave: conexao.chave }, dados || {}));
    // text/plain evita a checagem extra (CORS) que o Google não responde
    return fetch(conexao.url, { method: 'POST', body: corpo, redirect: 'follow', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        return r.text().then(function (t) {
          try {
            return JSON.parse(t);
          } catch (e) {
            throw Object.assign(new Error('O Google não respondeu como esperado. Confira se a implantação está como “Qualquer pessoa”.'), { codigo: 'resposta' });
          }
        });
      })
      .then(function (json) {
        if (!json.ok) throw Object.assign(new Error(json.erro || 'Erro no servidor.'), { codigo: json.codigo || 'servidor' });
        return json;
      })
      .catch(function (err) {
        if (err.codigo) throw err;
        var offline = navigator.onLine === false;
        throw Object.assign(new Error(offline
          ? 'Sem internet. As mudanças ficam guardadas aqui e vão quando a internet voltar.'
          : 'Não consegui falar com o Google. Confira o endereço e se a implantação está como “Qualquer pessoa”.'), { codigo: offline ? 'offline' : 'rede' });
      })
      .finally(function () { clearTimeout(timer); });
  }

  var sincronizando = false, deNovo = false, sincTimer = null, ultimaTentativa = 0;

  function agendarSinc(ms) {
    if (!estado.conexao) return;
    clearTimeout(sincTimer);
    sincTimer = setTimeout(sincronizar, ms == null ? 800 : ms);
  }

  function sincronizar() {
    if (!estado.conexao) {
      mostrarSinc('local');
      return Promise.resolve();
    }
    if (sincronizando) {
      deNovo = true;
      return Promise.resolve();
    }
    sincronizando = true;
    ultimaTentativa = Date.now();
    mostrarSinc('sincronizando');
    var enviados = estado.eventos.slice();
    return chamar('sincronizar', { eventos: enviados })
      .then(function (r) {
        var mudouNoMeioTempo = estado.eventos.length !== enviados.length ||
          estado.eventos.some(function (e, i) { return e !== enviados[i]; });
        estado.eventos = D.limparApagados(D.mesclar(estado.eventos, r.eventos.map(D.normalizar)), hoje(), 60);
        estado.prefs.pendente = mudouNoMeioTempo;
        estado.prefs.ultimaSinc = new Date().toISOString();
        salvarLocal();
        renderizar();
        mostrarSinc('ok');
        if (mudouNoMeioTempo) deNovo = true;
      })
      .catch(function (err) {
        estado.prefs.pendente = true;
        salvarLocal();
        mostrarSinc(err.codigo === 'offline' ? 'offline' : 'erro', err.message);
      })
      .then(function () {
        sincronizando = false;
        if (deNovo) {
          deNovo = false;
          agendarSinc(300);
        }
      });
  }

  function mostrarSinc(situacao, msg) {
    estado.sinc = situacao;
    estado.sincMsg = msg || '';
    var textos = {
      local: 'Só neste aparelho',
      sincronizando: 'Sincronizando…',
      ok: 'Sincronizado',
      offline: 'Sem internet',
      erro: 'Não sincronizou'
    };
    var el = $('#sinc');
    el.dataset.estado = situacao;
    $('.sinc__texto', el).textContent = textos[situacao];
    el.title = msg || (situacao === 'ok' ? 'Computador e celular com a mesma agenda.' : '');
  }

  $('#sinc').addEventListener('click', function () {
    if (!estado.conexao) {
      location.hash = '#ajustes';
      return;
    }
    if (estado.sinc === 'erro' || estado.sinc === 'offline') mostrarToast(estado.sincMsg);
    sincronizar();
  });

  // ---------- Ajustes ----------
  var formConexao = $('#form-conexao');
  var formAvisosCfg = $('#form-avisos');
  var padraoCfg = [];
  var configNaTela = false; // os campos já mostram a configuração do servidor

  (function montarHorasResumo() {
    var html = '';
    for (var h = 5; h <= 12; h++) html += '<option value="' + h + '">' + D.dois(h) + ':00</option>';
    $('#av-resumo-hora').innerHTML = html;
    $('#av-resumo-hora').value = '7';
  })();

  function msg(id, texto, tipo) {
    var el = $(id);
    el.textContent = texto || '';
    el.dataset.tipo = tipo || '';
  }

  function renderAjustes() {
    var c = estado.conexao;
    formConexao.url.value = c ? c.url : formConexao.url.value;
    formConexao.senha.value = c ? c.chave : formConexao.senha.value;
    $('#cx-conectar').textContent = c ? 'Salvar e conectar' : 'Conectar';
    $('#cx-sincronizar').hidden = !c;
    $('#cx-desconectar').hidden = !c;
    $('#guia-google').open = !c && !formConexao.url.value;
    $('#conexao-texto').textContent = c
      ? 'Conectado ao seu Google. Computador e celular ficam com a mesma agenda.' + (estado.prefs.ultimaSinc ? ' Última sincronização: ' + new Date(estado.prefs.ultimaSinc).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) + '.' : '')
      : 'Hoje a agenda fica só neste aparelho. Conecte ao seu Google para ter a mesma agenda no computador e no celular e receber os avisos no WhatsApp.';

    $('#avisos-bloqueio').hidden = !!c;
    $$('input, select, button', formAvisosCfg).forEach(function (el) { el.disabled = !c; });
    if (!c) {
      padraoCfg = estado.prefs.avisoPadrao.slice();
      montarChipsAvisos($('#av-padrao'), padraoCfg);
      $$('#av-padrao button').forEach(function (b) { b.disabled = true; });
      return;
    }
    if (!estado.remoto) carregarConfig();
    else if (!configNaTela) preencherConfig(estado.remoto);
  }

  // silencioso: não mexe na mensagem (para não apagar o resultado do teste)
  function carregarConfig(silencioso) {
    if (!silencioso) msg('#av-msg', 'Carregando…');
    return chamar('ping').then(function (r) {
      estado.remoto = r;
      preencherConfig(r);
      if (!silencioso) msg('#av-msg', '');
    }).catch(function (err) {
      if (!silencioso) msg('#av-msg', err.message, 'erro');
    });
  }

  function preencherConfig(r) {
    configNaTela = true;
    var cfg = r.config;
    var f = formAvisosCfg;
    f.numero.value = cfg.whatsapp.numero || '';
    f.chave.value = cfg.whatsapp.chave || '';
    f.emailAtivo.checked = cfg.email.ativo;
    f.email.value = cfg.email.endereco || '';
    f.email.placeholder = r.email || 'voce@gmail.com';
    f.resumoAtivo.checked = cfg.resumo.ativo;
    f.resumoHora.value = String(cfg.resumo.hora);
    padraoCfg = (cfg.avisoPadrao || AVISO_PADRAO).slice();
    estado.prefs.avisoPadrao = padraoCfg.slice();
    salvarLocal();
    montarChipsAvisos($('#av-padrao'), padraoCfg);
    var u = r.ultimoEnvio;
    $('#av-ultimo').textContent = u
      ? 'Último envio: ' + u.quando.split(' ')[0].split('-').reverse().join('/') + ' às ' + u.quando.split(' ')[1] +
        (u.whatsapp ? ' · WhatsApp: ' + (u.whatsapp === 'ok' ? 'ok' : u.whatsapp) : '') +
        (u.email ? ' · E-mail: ' + (u.email === 'ok' ? 'ok' : u.email) : '') +
        (u.respostaWhats ? ' · Resposta do CallMeBot: “' + u.respostaWhats + '”' : '')
      : '';
  }

  formConexao.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var url = formConexao.url.value.trim();
    var chave = formConexao.senha.value;
    if (/\/dev\/?$/.test(url)) return msg('#cx-msg', 'Esse é o endereço de teste (termina em /dev). Use o “URL do app da Web”, que termina em /exec.', 'erro');
    if (!urlValida(url)) return msg('#cx-msg', 'O endereço deve começar com https://script.google.com/ e terminar em /exec.', 'erro');
    if (!chave) return msg('#cx-msg', 'Digite a senha que você colocou no código.', 'erro');
    var conexao = { url: url, chave: chave };
    msg('#cx-msg', 'Conectando…');
    chamar('ping', {}, conexao).then(function (r) {
      estado.conexao = conexao;
      estado.remoto = r;
      configNaTela = false;
      gravar(CHAVES.conexao, conexao);
      msg('#cx-msg', 'Conectado! Agora a agenda deste aparelho também fica no seu Google.', 'ok');
      return sincronizar();
    }).then(function () {
      renderAjustes();
    }).catch(function (err) {
      msg('#cx-msg', err.message, 'erro');
    });
  });

  $('#cx-sincronizar').addEventListener('click', function () {
    msg('#cx-msg', 'Sincronizando…');
    sincronizar().then(function () {
      if (estado.sinc === 'ok') msg('#cx-msg', 'Tudo sincronizado.', 'ok');
      else msg('#cx-msg', estado.sincMsg, 'erro');
      renderAjustes();
    });
  });

  $('#cx-desconectar').addEventListener('click', function () {
    estado.conexao = null;
    estado.remoto = null;
    configNaTela = false;
    gravar(CHAVES.conexao, null);
    formConexao.reset();
    msg('#cx-msg', 'Desconectado. A agenda continua neste aparelho.', 'ok');
    mostrarSinc('local');
    renderAjustes();
  });

  $('#av-padrao').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-aviso]');
    if (!b) return;
    var n = +b.dataset.aviso, i = padraoCfg.indexOf(n);
    if (i >= 0) padraoCfg.splice(i, 1);
    else padraoCfg.push(n);
    b.setAttribute('aria-pressed', String(i < 0));
  });

  function numeroWhats(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 10 || d.length === 11) d = '55' + d; // só DDD + número: é do Brasil
    return d;
  }

  function configDoForm() {
    var f = formAvisosCfg;
    return {
      whatsapp: { numero: numeroWhats(f.numero.value), chave: f.chave.value.trim() },
      email: { ativo: f.emailAtivo.checked, endereco: f.email.value.trim() || (f.emailAtivo.checked ? f.email.placeholder : '') },
      resumo: { ativo: f.resumoAtivo.checked, hora: +f.resumoHora.value },
      avisoPadrao: padraoCfg.slice()
    };
  }

  function salvarConfig() {
    var cfg = configDoForm();
    if (cfg.whatsapp.numero && cfg.whatsapp.numero.length < 12) {
      return Promise.reject(new Error('Confira o número: precisa ter DDD (ex.: 11 91234-5678).'));
    }
    if (cfg.whatsapp.numero && !cfg.whatsapp.chave) {
      return Promise.reject(new Error('Falta a chave do CallMeBot. Veja “Como pegar a chave”.'));
    }
    return chamar('salvarConfig', { config: cfg }).then(function (r) {
      estado.remoto = Object.assign({}, estado.remoto, { config: r.config });
      preencherConfig(estado.remoto);
      renderAgenda();
    });
  }

  formAvisosCfg.addEventListener('submit', function (ev) {
    ev.preventDefault();
    msg('#av-msg', 'Salvando…');
    salvarConfig().then(function () {
      msg('#av-msg', 'Salvo. Os avisos vão chegar mesmo com o app fechado.', 'ok');
    }).catch(function (err) {
      msg('#av-msg', err.message, 'erro');
    });
  });

  $('#av-testar').addEventListener('click', function () {
    msg('#av-msg', 'Salvando e mandando o teste…');
    salvarConfig().then(function () {
      return chamar('testar');
    }).then(function (r) {
      var res = r.resultado;
      var partes = [];
      if (res.whatsapp) partes.push(res.whatsapp === 'ok' ? 'WhatsApp enviado' : 'WhatsApp: ' + res.whatsapp);
      if (res.email) partes.push(res.email === 'ok' ? 'e-mail enviado' : 'e-mail: ' + res.email);
      msg('#av-msg', cap(partes.join(' · ')) + (res.ok ? '. Confira o celular.' : ''), res.ok ? 'ok' : 'erro');
      return carregarConfig(true);
    }).catch(function (err) {
      msg('#av-msg', err.message, 'erro');
    });
  });

  // Copiar o código do servidor
  $('#copiar-codigo').addEventListener('click', function () {
    fetch('servidor/Codigo.gs', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error();
      return r.text();
    }).then(function (codigo) {
      return navigator.clipboard.writeText(codigo).then(function () {
        mostrarToast('Código copiado. Agora cole no script.google.com.');
      }, function () {
        mostrarCodigo(codigo);
      });
    }).catch(function () {
      mostrarToast('Não consegui buscar o código. Abra o arquivo servidor/Codigo.gs do projeto.');
    });
  });
  function mostrarCodigo(codigo) {
    var area = $('#codigo-servidor');
    if (!area) {
      area = document.createElement('textarea');
      area.id = 'codigo-servidor';
      area.className = 'codigo';
      area.readOnly = true;
      area.rows = 8;
      area.setAttribute('aria-label', 'Código do servidor');
      $('#guia-google').appendChild(area);
    }
    area.value = codigo;
    area.focus();
    area.select();
    mostrarToast('Selecione tudo e copie o código abaixo.');
  }

  // Instalar
  var pedidoInstalar = null;
  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    pedidoInstalar = ev;
    $('#instalar').hidden = false;
  });
  $('#instalar').addEventListener('click', function () {
    if (!pedidoInstalar) return;
    pedidoInstalar.prompt();
    pedidoInstalar = null;
    $('#instalar').hidden = true;
  });
  if ((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone) {
    $('#instalar-texto').textContent = 'O app já está instalado neste aparelho.';
  }

  // Cópia de segurança
  $('#exportar').addEventListener('click', function () {
    var dados = { app: 'agenda', versao: 1, exportado: new Date().toISOString(), eventos: ativos() };
    var blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'agenda-' + hoje() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    msg('#copia-msg', 'Cópia baixada com ' + dados.eventos.length + ' compromissos.', 'ok');
  });
  $('#importar').addEventListener('change', function (ev) {
    var arquivo = ev.target.files && ev.target.files[0];
    if (!arquivo) return;
    var leitor = new FileReader();
    leitor.onload = function () {
      try {
        var dados = JSON.parse(leitor.result);
        var lista = Array.isArray(dados) ? dados : dados.eventos;
        if (!Array.isArray(lista)) throw new Error();
        var trazidos = 0;
        lista.forEach(function (x) {
          var e = D.normalizar(x);
          if (!e.data || !e.titulo) return;
          if (!e.id) e.id = novoId();
          var atual = porId(e.id);
          if (atual && !atual.apagado) return;
          e.apagado = false;
          guardar(e);
          trazidos++;
        });
        msg('#copia-msg', trazidos ? trazidos + ' compromissos trazidos de volta.' : 'Nada novo: a agenda já tinha tudo desse arquivo.', 'ok');
      } catch (err) {
        msg('#copia-msg', 'Esse arquivo não é uma cópia da agenda.', 'erro');
      }
      ev.target.value = '';
    };
    leitor.readAsText(arquivo);
  });

  // ---------- toast ----------
  var toastTimer = null;
  function mostrarToast(texto, acao, fn) {
    var t = $('#toast');
    $('#toast-texto').textContent = texto;
    var b = $('#toast-acao');
    b.hidden = !acao;
    b.textContent = acao || '';
    b.onclick = function () {
      esconderToast();
      if (fn) fn();
    };
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('toast--visivel'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(esconderToast, acao ? 6500 : 4000);
  }
  function esconderToast() {
    var t = $('#toast');
    t.classList.remove('toast--visivel');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 250);
  }

  // ---------- abas ----------
  function irPara(aba) {
    if (['agenda', 'buscar', 'ajustes'].indexOf(aba) < 0) aba = 'agenda';
    var mudou = estado.aba !== aba;
    estado.aba = aba;
    ['agenda', 'buscar', 'ajustes'].forEach(function (s) { $('#aba-' + s).hidden = s !== aba; });
    $$('.abas__item').forEach(function (a) {
      if (a.dataset.aba === aba) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (aba === 'agenda') renderAgenda();
    if (aba === 'buscar') renderBuscar();
    if (aba === 'ajustes') renderAjustes();
    if (mudou) window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', function () { irPara(location.hash.slice(1)); });

  // ---------- início ----------
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    renderizar();
    if (estado.conexao && Date.now() - ultimaTentativa > 30000) sincronizar();
  });
  window.addEventListener('online', function () { if (estado.conexao) sincronizar(); });
  window.addEventListener('storage', function (ev) {
    if (ev.key === CHAVES.eventos) {
      estado.eventos = lerEventos();
      renderizar();
    }
  });
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    renderAgenda();
    if (estado.conexao && Date.now() - ultimaTentativa > 180000) sincronizar();
  }, 60000);

  irPara(location.hash.slice(1));
  atualizarPrevia();
  if (estado.conexao) sincronizar();
  else mostrarSinc('local');

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sem modo offline */ });
    });
  }
})();
