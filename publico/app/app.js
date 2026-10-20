/* Agenda · tela
 * Cada pessoa entra com a própria conta (servidor em worker/). A agenda fica
 * guardada neste aparelho, separada por conta, e sincroniza com o servidor:
 * o app manda o que mudou aqui e recebe o que mudou nos outros aparelhos.
 */
(function () {
  'use strict';

  var D = window.AgendaDatas;
  var I = window.AgendaInterpretar;

  var AVISOS = [[0, 'Na hora'], [15, '15 min antes'], [30, '30 min antes'], [60, '1 hora antes'], [120, '2 horas antes'],
    [1440, '1 dia antes'], [2880, '2 dias antes'], [10080, '1 semana antes']];
  var AVISO_PADRAO = [1440, 60];
  var LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  var RODADAS_SENHA = 250000;
  var CHAVE_SESSAO = 'agenda.sessao';
  var CHAVE_ANTIGA = 'agenda.eventos'; // agenda de antes das contas (fica só no aparelho)

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
  function lerEventos(chave) {
    var lista = ler(chave, []);
    return (Array.isArray(lista) ? lista : []).map(D.normalizar).filter(function (e) { return e.id; });
  }

  // { token, usuario: { id, nome, email, fuso } }
  var sessao = ler(CHAVE_SESSAO, null);
  if (!sessao || !sessao.token || !sessao.usuario || !sessao.usuario.id) sessao = null;

  var estado = {
    eventos: [],
    cursor: 0,        // última versão recebida do servidor
    pendentes: {},    // ids mudados aqui e ainda não enviados
    config: null,     // avisos no WhatsApp (vem do servidor)
    ultimoEnvio: null,
    aba: 'agenda',
    diasLista: 30,
    mesCal: '',
    diaSel: '',
    consulta: '',
    sinc: 'ok',
    sincMsg: ''
  };

  // Cada conta tem as suas chaves no localStorage
  function chave(nome) { return 'agenda.u.' + sessao.usuario.id + '.' + nome; }
  function carregarDaConta() {
    estado.eventos = lerEventos(chave('eventos'));
    estado.cursor = +ler(chave('cursor'), 0) || 0;
    estado.pendentes = ler(chave('pendentes'), {}) || {};
    var c = ler(chave('conta'), null) || {};
    estado.config = c.config || null;
    estado.ultimoEnvio = c.ultimoEnvio || null;
  }
  function apagarDaConta() {
    ['eventos', 'cursor', 'pendentes', 'conta'].forEach(function (n) { gravar(chave(n), null); });
  }
  function avisoPadrao() { return estado.config ? estado.config.avisoPadrao : AVISO_PADRAO; }
  function temWhats() { return !!(estado.config && estado.config.whatsapp.numero && estado.config.whatsapp.chave); }
  function temPendentes() { return Object.keys(estado.pendentes).length > 0; }

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
    if (!sessao) return;
    gravar(chave('eventos'), estado.eventos);
    gravar(chave('cursor'), estado.cursor);
    gravar(chave('pendentes'), estado.pendentes);
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
    estado.pendentes[e.id] = true;
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
    if (avisoPadrao().length) tags.push(icone('sino') + esc(cap(avisosTexto(avisoPadrao()))));
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
      dias: r.dias, ate: r.ate, avisos: avisoPadrao().slice(), notas: ''
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
    formAvisos = (dados.avisos || avisoPadrao()).slice();
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
    if (!temWhats()) dicaAviso = 'Para receber os avisos no WhatsApp, configure o seu número em Ajustes.';
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

  // ---------- servidor ----------
  function api(metodo, caminho, dados) {
    var headers = { 'content-type': 'application/json' };
    if (sessao) headers.authorization = 'Bearer ' + sessao.token;
    return fetch('api/' + caminho, {
      method: metodo,
      headers: headers,
      body: metodo === 'GET' ? undefined : JSON.stringify(dados || {}),
      cache: 'no-store'
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, erro: 'O servidor respondeu algo inesperado. Tente de novo.' }; })
        .then(function (json) {
          if (!json.ok) {
            var err = Object.assign(new Error(json.erro || 'Erro no servidor.'), { codigo: json.codigo || 'servidor', status: r.status });
            if (json.codigo === 'sessao' && sessao) sessaoTerminou();
            throw err;
          }
          return json;
        });
    }, function () {
      var offline = navigator.onLine === false;
      throw Object.assign(new Error(offline
        ? 'Sem internet. As mudanças ficam guardadas aqui e vão quando a internet voltar.'
        : 'Não consegui falar com o servidor. Tente de novo em instantes.'), { codigo: offline ? 'offline' : 'rede' });
    });
  }

  // A senha sai do aparelho já embaralhada (PBKDF2, com o e-mail como sal)
  function senhaDoApp(email, senha) {
    var cod = new TextEncoder();
    return crypto.subtle.importKey('raw', cod.encode(senha), 'PBKDF2', false, ['deriveBits']).then(function (k) {
      return crypto.subtle.deriveBits({
        name: 'PBKDF2', hash: 'SHA-256', iterations: RODADAS_SENHA,
        salt: cod.encode('agenda-v1:' + email.trim().toLowerCase())
      }, k, 256);
    }).then(function (bits) {
      return Array.prototype.map.call(new Uint8Array(bits), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    });
  }

  var sincronizando = false, deNovo = false, sincTimer = null, ultimaTentativa = 0;

  function agendarSinc(ms) {
    if (!sessao) return;
    clearTimeout(sincTimer);
    sincTimer = setTimeout(sincronizar, ms == null ? 600 : ms);
  }

  function sincronizar() {
    if (!sessao) return Promise.resolve();
    if (sincronizando) {
      deNovo = true;
      return Promise.resolve();
    }
    sincronizando = true;
    ultimaTentativa = Date.now();
    mostrarSinc('sincronizando');
    // O que mudar enquanto o pedido está no ar fica para a próxima rodada
    var enviando = estado.pendentes;
    estado.pendentes = {};
    var alterados = Object.keys(enviando).map(porId).filter(Boolean);
    var conta = sessao.usuario.id;
    return api('POST', 'sincronizar', { cursor: estado.cursor, alterados: alterados })
      .then(function (r) {
        if (!sessao || sessao.usuario.id !== conta) return;
        var recebidos = r.eventos.concat(r.rejeitados).map(D.normalizar);
        estado.eventos = D.limparApagados(D.mesclar(estado.eventos, recebidos), hoje(), 90);
        estado.cursor = r.cursor;
        salvarLocal();
        renderizar();
        mostrarSinc('ok');
        if (temPendentes()) deNovo = true;
      })
      .catch(function (err) {
        if (!sessao || sessao.usuario.id !== conta) return;
        Object.keys(enviando).forEach(function (id) { estado.pendentes[id] = true; });
        salvarLocal();
        mostrarSinc(err.codigo === 'offline' ? 'offline' : 'erro', err.message);
      })
      .then(function () {
        sincronizando = false;
        if (deNovo && sessao) {
          deNovo = false;
          agendarSinc(300);
        }
      });
  }

  function mostrarSinc(situacao, mensagem) {
    estado.sinc = situacao;
    estado.sincMsg = mensagem || '';
    var textos = { sincronizando: 'Sincronizando…', ok: 'Sincronizado', offline: 'Sem internet', erro: 'Não sincronizou' };
    var el = $('#sinc');
    el.dataset.estado = situacao;
    $('.sinc__texto', el).textContent = textos[situacao];
    el.title = mensagem || (situacao === 'ok' ? 'Computador e celular com a mesma agenda.' : '');
  }

  $('#sinc').addEventListener('click', function () {
    if (estado.sinc === 'erro' || estado.sinc === 'offline') mostrarToast(estado.sincMsg);
    sincronizar();
  });

  // Dados da conta vindos do servidor (nome, e-mail, avisos)
  function aplicarConta(r) {
    if (!sessao) return;
    if (r.usuario) {
      sessao.usuario = r.usuario;
      gravar(CHAVE_SESSAO, sessao);
    }
    if (r.config) estado.config = r.config;
    if ('ultimoEnvio' in r) estado.ultimoEnvio = r.ultimoEnvio;
    gravar(chave('conta'), { config: estado.config, ultimoEnvio: estado.ultimoEnvio });
  }
  function atualizarConta() {
    return api('GET', 'conta').then(function (r) {
      aplicarConta(r);
      if (estado.aba === 'ajustes') renderAjustes();
    }, function () { /* fica com o que estava guardado */ });
  }

  // ---------- entrar / criar conta ----------
  function msg(id, texto, tipo) {
    var el = $(id);
    el.textContent = texto || '';
    el.dataset.tipo = tipo || '';
  }

  function mostrarPorta(aviso) {
    $('#app').hidden = true;
    $('#porta').hidden = false;
    document.body.classList.add('na-porta');
    trocarPorta('entrar');
    if (aviso) msg('#en-msg', aviso, 'erro');
    document.title = 'Agenda · Entrar';
  }
  function mostrarApp() {
    $('#porta').hidden = true;
    $('#app').hidden = false;
    document.body.classList.remove('na-porta');
    document.title = 'Agenda';
    irPara(location.hash.slice(1));
    atualizarPrevia();
  }
  function trocarPorta(qual) {
    $('#form-entrar').hidden = qual !== 'entrar';
    $('#form-cadastro').hidden = qual !== 'cadastro';
    $('#form-recuperar').hidden = qual !== 'recuperar';
    $('.porta__abas').hidden = qual === 'recuperar';
    $('#aba-entrar').setAttribute('aria-selected', String(qual === 'entrar'));
    $('#aba-cadastro').setAttribute('aria-selected', String(qual === 'cadastro'));
  }
  $('#aba-entrar').addEventListener('click', function () { trocarPorta('entrar'); $('#en-email').focus(); });
  $('#aba-cadastro').addEventListener('click', function () { trocarPorta('cadastro'); $('#ca-nome').focus(); });
  $('#porta').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-ver-senha]');
    if (!b) return;
    var campo = b.parentNode.querySelector('input');
    var mostrar = campo.type === 'password';
    campo.type = mostrar ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(mostrar));
    b.setAttribute('aria-label', mostrar ? 'Esconder senha' : 'Mostrar senha');
  });

  function ocupado(formEl, sim) {
    $$('button, input', formEl).forEach(function (el) { el.disabled = sim; });
  }

  function iniciarSessao(r) {
    sessao = { token: r.token, usuario: r.usuario };
    gravar(CHAVE_SESSAO, sessao);
    carregarDaConta();
    aplicarConta(r);
    estado.diaSel = '';
    estado.mesCal = '';
    estado.consulta = '';
    $('#busca-texto').value = '';
    $$('.porta form').forEach(function (f) { f.reset(); });
    ['#en-msg', '#ca-msg', '#re-msg'].forEach(function (id) { msg(id, ''); });
    mostrarApp();
    oferecerAgendaAntiga();
    sincronizar();
  }

  // Ao sair, a agenda some deste aparelho (continua guardada na conta)
  function sairDaConta() {
    if (temPendentes() && !confirm('Algumas mudanças ainda não chegaram ao servidor e vão se perder. Sair mesmo assim?')) return;
    api('POST', 'sair').catch(function () { /* sai mesmo sem internet */ });
    apagarDaConta();
    sessao = null;
    gravar(CHAVE_SESSAO, null);
    estado.eventos = [];
    estado.config = null;
    mostrarPorta();
  }

  // Sessão vencida ou senha trocada em outro aparelho: pede para entrar de novo,
  // mas mantém o que estava guardado aqui (e as mudanças ainda não enviadas)
  function sessaoTerminou() {
    var email = sessao.usuario.email;
    sessao = null;
    gravar(CHAVE_SESSAO, null);
    fecharFolha();
    mostrarPorta('Sua sessão terminou. Entre de novo.');
    $('#en-email').value = email;
  }

  $('#form-entrar').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target, email = f.email.value.trim(), senha = f.senha.value;
    if (!email || !senha) return msg('#en-msg', 'Preencha o e-mail e a senha.', 'erro');
    msg('#en-msg', 'Entrando…');
    ocupado(f, true);
    senhaDoApp(email, senha).then(function (s) {
      return api('POST', 'entrar', { email: email, senha: s });
    }).then(iniciarSessao).catch(function (err) {
      msg('#en-msg', err.message, 'erro');
    }).then(function () { ocupado(f, false); });
  });

  $('#form-cadastro').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target, nome = f.nome.value.trim(), email = f.email.value.trim(), senha = f.senha.value;
    if (!nome) return msg('#ca-msg', 'Diga o seu nome.', 'erro');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return msg('#ca-msg', 'Confira o e-mail.', 'erro');
    if (senha.length < 8) return msg('#ca-msg', 'A senha precisa ter pelo menos 8 caracteres.', 'erro');
    msg('#ca-msg', 'Criando a sua conta…');
    ocupado(f, true);
    var fuso = 'America/Sao_Paulo';
    try { fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || fuso; } catch (e) { /* padrão */ }
    senhaDoApp(email, senha).then(function (s) {
      return api('POST', 'cadastro', { nome: nome, email: email, senha: s, fuso: fuso });
    }).then(function (r) {
      iniciarSessao(r);
      mostrarToast('Conta criada. Boas-vindas, ' + r.usuario.nome.split(' ')[0] + '!');
    }).catch(function (err) {
      msg('#ca-msg', err.message, 'erro');
      if (err.codigo === 'existe') $('#en-email').value = email;
    }).then(function () { ocupado(f, false); });
  });

  // Esqueci a senha: código pelo WhatsApp
  var formRecuperar = $('#form-recuperar');
  $('#esqueci').addEventListener('click', function () {
    formRecuperar.reset();
    $('#re-passo2').hidden = true;
    $('#re-botao').textContent = 'Mandar código pelo WhatsApp';
    formRecuperar.email.value = $('#en-email').value;
    msg('#re-msg', '');
    trocarPorta('recuperar');
    formRecuperar.email.focus();
  });
  $('#re-voltar').addEventListener('click', function () { trocarPorta('entrar'); });
  formRecuperar.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = formRecuperar, email = f.email.value.trim();
    if (!email) return msg('#re-msg', 'Digite o e-mail da conta.', 'erro');
    var passo2 = !$('#re-passo2').hidden;
    if (!passo2) {
      msg('#re-msg', 'Mandando…');
      ocupado(f, true);
      api('POST', 'recuperar', { email: email }).then(function (r) {
        $('#re-passo2').hidden = false;
        $('#re-botao').textContent = 'Salvar senha nova';
        msg('#re-msg', 'Mandamos o código para o WhatsApp terminado em ' + r.final + '. Pode levar alguns minutos.', 'ok');
        setTimeout(function () { f.codigo.focus(); }, 50);
      }).catch(function (err) {
        msg('#re-msg', err.message, 'erro');
      }).then(function () { ocupado(f, false); });
      return;
    }
    var codigo = f.codigo.value.replace(/\D/g, ''), senha = f.senha.value;
    if (codigo.length !== 6) return msg('#re-msg', 'O código tem 6 números.', 'erro');
    if (senha.length < 8) return msg('#re-msg', 'A senha nova precisa ter pelo menos 8 caracteres.', 'erro');
    msg('#re-msg', 'Salvando…');
    ocupado(f, true);
    senhaDoApp(email, senha).then(function (s) {
      return api('POST', 'redefinir', { email: email, codigo: codigo, nova: s });
    }).then(function (r) {
      iniciarSessao(r);
      mostrarToast('Senha nova salva.');
    }).catch(function (err) {
      msg('#re-msg', err.message, 'erro');
    }).then(function () { ocupado(f, false); });
  });

  // Agenda de antes das contas, guardada só neste aparelho
  function oferecerAgendaAntiga() {
    var antigos = lerEventos(CHAVE_ANTIGA).filter(function (e) { return !e.apagado; });
    var el = $('#legado');
    if (!antigos.length) {
      el.hidden = true;
      return;
    }
    el.innerHTML = '<p><strong>' + antigos.length + (antigos.length === 1 ? ' compromisso guardado' : ' compromissos guardados') +
      ' neste aparelho</strong> de antes das contas. Quer levar para a sua conta?</p>' +
      '<div class="botoes"><button class="btn btn--claro" type="button" data-legado="levar">Levar para a minha conta</button>' +
      '<button class="btn btn--texto" type="button" data-legado="descartar">Não, descartar</button></div>';
    el.hidden = false;
  }
  $('#legado').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-legado]');
    if (!b) return;
    if (b.dataset.legado === 'levar') {
      var n = 0;
      lerEventos(CHAVE_ANTIGA).forEach(function (e) {
        if (e.apagado || !e.titulo || !e.data) return;
        var atual = porId(e.id);
        if (atual && !atual.apagado) return;
        estado.eventos = estado.eventos.filter(function (x) { return x.id !== e.id; }).concat([D.normalizar(Object.assign({}, e, { atualizado: new Date().toISOString() }))]);
        estado.pendentes[e.id] = true;
        n++;
      });
      salvarLocal();
      renderizar();
      sincronizar();
      mostrarToast(n + (n === 1 ? ' compromisso levado' : ' compromissos levados') + ' para a sua conta.');
    }
    // Agenda antiga e conexão com o servidor do Google saem deste aparelho
    ['agenda.eventos', 'agenda.conexao', 'agenda.prefs'].forEach(function (k) { gravar(k, null); });
    $('#legado').hidden = true;
  });

  // ---------- Ajustes ----------
  var formAvisosCfg = $('#form-avisos');
  var padraoCfg = [];
  var configNaTela = false; // os campos já mostram a configuração (não apagar o que a pessoa digita)

  (function montarHorasResumo() {
    var html = '';
    for (var h = 5; h <= 12; h++) html += '<option value="' + h + '">' + D.dois(h) + ':00</option>';
    $('#av-resumo-hora').innerHTML = html;
    $('#av-resumo-hora').value = '7';
  })();

  function renderAjustes() {
    if (!sessao) return;
    var u = sessao.usuario;
    $('#conta-texto').innerHTML = '<strong>' + esc(u.nome) + '</strong><br>' + esc(u.email);
    $$('input[name="usuario"]').forEach(function (el) { el.value = u.email; });
    if (!configNaTela && estado.config) preencherConfig();
    else if (!estado.config) {
      padraoCfg = AVISO_PADRAO.slice();
      montarChipsAvisos($('#av-padrao'), padraoCfg);
    }
    mostrarUltimoEnvio();
  }

  function preencherConfig() {
    configNaTela = true;
    var cfg = estado.config, f = formAvisosCfg;
    f.numero.value = cfg.whatsapp.numero || '';
    f.chave.value = cfg.whatsapp.chave || '';
    f.resumoAtivo.checked = cfg.resumo.ativo;
    f.resumoHora.value = String(cfg.resumo.hora);
    padraoCfg = (cfg.avisoPadrao || AVISO_PADRAO).slice();
    montarChipsAvisos($('#av-padrao'), padraoCfg);
  }

  function mostrarUltimoEnvio() {
    var u = estado.ultimoEnvio;
    if (!u || !u.quando) {
      $('#av-ultimo').textContent = '';
      return;
    }
    var quando = new Date(u.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    $('#av-ultimo').textContent = 'Último envio: ' + quando + ' · WhatsApp: ' + u.whatsapp +
      (u.respostaWhats ? ' · Resposta do CallMeBot: “' + u.respostaWhats + '”' : '');
  }

  $('#av-padrao').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-aviso]');
    if (!b) return;
    var n = +b.dataset.aviso, i = padraoCfg.indexOf(n);
    if (i >= 0) padraoCfg.splice(i, 1);
    else padraoCfg.push(n);
    b.setAttribute('aria-pressed', String(i < 0));
  });

  function salvarConfig() {
    var f = formAvisosCfg;
    var numero = f.numero.value.replace(/\D/g, '');
    if (numero && numero.length < 10) return Promise.reject(new Error('Confira o número: precisa ter DDD (ex.: 11 91234-5678).'));
    if (numero && !f.chave.value.trim()) return Promise.reject(new Error('Falta a chave do CallMeBot. Veja “Como pegar a chave”.'));
    var fuso;
    try { fuso = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* o servidor usa o que já tem */ }
    return api('POST', 'config', {
      fuso: fuso,
      config: {
        whatsapp: { numero: numero, chave: f.chave.value.trim() },
        resumo: { ativo: f.resumoAtivo.checked, hora: +f.resumoHora.value },
        avisoPadrao: padraoCfg.slice()
      }
    }).then(function (r) {
      aplicarConta(r);
      preencherConfig();
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
      return api('POST', 'testar');
    }).then(function (r) {
      estado.ultimoEnvio = r.resultado;
      aplicarConta({});
      mostrarUltimoEnvio();
      var ok = r.resultado.whatsapp === 'ok';
      msg('#av-msg', ok ? 'Mensagem enviada. Confira o WhatsApp (pode levar alguns minutos).' : 'WhatsApp: ' + r.resultado.whatsapp, ok ? 'ok' : 'erro');
    }).catch(function (err) {
      msg('#av-msg', err.message, 'erro');
    });
  });

  // Conta: sair, trocar senha, apagar
  $('#conta-sair').addEventListener('click', sairDaConta);
  $('#conta-senha').addEventListener('click', function () {
    var f = $('#form-senha');
    f.hidden = !f.hidden;
    this.setAttribute('aria-expanded', String(!f.hidden));
    msg('#se-msg', '');
    if (!f.hidden) f.atual.focus();
  });
  $('#form-senha').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target, email = sessao.usuario.email;
    if (f.nova.value.length < 8) return msg('#se-msg', 'A senha nova precisa ter pelo menos 8 caracteres.', 'erro');
    msg('#se-msg', 'Salvando…');
    ocupado(f, true);
    Promise.all([senhaDoApp(email, f.atual.value), senhaDoApp(email, f.nova.value)]).then(function (s) {
      return api('POST', 'senha', { atual: s[0], nova: s[1] });
    }).then(function () {
      f.reset();
      msg('#se-msg', 'Senha trocada. Nos outros aparelhos, entre de novo com a senha nova.', 'ok');
    }).catch(function (err) {
      msg('#se-msg', err.message, 'erro');
    }).then(function () { ocupado(f, false); });
  });
  $('#form-apagar').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    if (!f.senha.value) return msg('#ap-msg', 'Digite a sua senha.', 'erro');
    if (!confirm('Apagar a conta e toda a agenda? Não dá para desfazer.')) return;
    msg('#ap-msg', 'Apagando…');
    ocupado(f, true);
    senhaDoApp(sessao.usuario.email, f.senha.value).then(function (s) {
      return api('POST', 'apagar-conta', { senha: s });
    }).then(function () {
      apagarDaConta();
      sessao = null;
      gravar(CHAVE_SESSAO, null);
      f.reset();
      mostrarPorta();
      msg('#en-msg', 'Conta apagada.', 'ok');
    }).catch(function (err) {
      msg('#ap-msg', err.message, 'erro');
    }).then(function () { ocupado(f, false); });
  });

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
    if (aba === 'ajustes') {
      renderAjustes();
      atualizarConta();
    }
    if (mudou) window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', function () { irPara(location.hash.slice(1)); });

  // ---------- início ----------
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !sessao) return;
    renderizar();
    if (Date.now() - ultimaTentativa > 30000) sincronizar();
  });
  window.addEventListener('online', function () { if (sessao) sincronizar(); });
  // Outra aba deste navegador mudou a agenda ou saiu da conta
  window.addEventListener('storage', function (ev) {
    if (ev.key === CHAVE_SESSAO) {
      var nova = ler(CHAVE_SESSAO, null);
      if (!nova && sessao) {
        sessao = null;
        mostrarPorta();
      } else if (nova && (!sessao || nova.usuario.id !== sessao.usuario.id)) {
        location.reload();
      }
    } else if (sessao && ev.key === chave('eventos')) {
      estado.eventos = lerEventos(chave('eventos'));
      renderizar();
    }
  });
  setInterval(function () {
    if (document.visibilityState !== 'visible' || !sessao) return;
    renderAgenda();
    if (Date.now() - ultimaTentativa > 120000) sincronizar();
  }, 60000);

  if (sessao) {
    carregarDaConta();
    mostrarApp();
    oferecerAgendaAntiga();
    sincronizar();
    atualizarConta();
  } else {
    mostrarPorta();
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sem modo offline */ });
    });
  }
})();
