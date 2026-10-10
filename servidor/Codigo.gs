/**
 * AGENDA · servidor no Google (Apps Script)
 *
 * Guarda a sua agenda numa planilha do seu Google Drive, deixa o computador
 * e o celular com a mesma agenda e manda os lembretes pelo WhatsApp
 * (e por e-mail, se você quiser).
 *
 * COMO INSTALAR (uns 5 minutos)
 *  1. Troque a SENHA logo abaixo por uma senha sua (mínimo 6 caracteres).
 *  2. Salve (ícone de disquete). No topo, com "instalar" escolhido, clique
 *     em Executar e autorize o acesso (Avançado > Acessar > Permitir).
 *  3. Implantar > Nova implantação > engrenagem > "App da Web".
 *     Executar como: Eu · Quem pode acessar: Qualquer pessoa > Implantar.
 *  4. Copie o "URL do app da Web" e cole no app, em Ajustes, com a senha.
 *
 * Se um dia você trocar este código, use Implantar > Gerenciar implantações >
 * lápis > Versão: Nova versão. Assim o endereço continua o mesmo.
 */

var SENHA = 'troque-esta-senha';
var FUSO = 'America/Sao_Paulo';

// ---------------------------------------------------------------------------

var VERSAO = 2;
var SENHA_EXEMPLO = ['troque', 'esta', 'senha'].join('-'); // escrito assim para não mudar junto se você usar "substituir" na senha
var COLUNAS = ['id', 'titulo', 'data', 'hora', 'horaFim', 'repete', 'cada', 'dias', 'ate', 'avisos', 'notas', 'excecoes', 'atualizado', 'apagado'];
var COLUNAS_ENVIADOS = ['chave', 'quando', 'situacao'];
var ABA_AGENDA = 'Agenda';
var ABA_ENVIADOS = 'Enviados';
var TOLERANCIA_MIN = 12 * 60;   // aviso atrasado mais que isso não é mandado
var MAX_TENTATIVAS = 3;
var MAX_POR_RODADA = 10;

/** Rode uma vez depois de trocar a SENHA. */
function instalar() {
  conferirSenha_();
  var planilha = planilha_();
  aba_(ABA_ENVIADOS);
  ScriptApp.getProjectTriggers().forEach(function (g) {
    if (g.getHandlerFunction() === 'verificarAvisos') ScriptApp.deleteTrigger(g);
  });
  ScriptApp.newTrigger('verificarAvisos').timeBased().everyMinutes(5).create();
  Logger.log('Pronto! Sua agenda fica nesta planilha: ' + planilha.getUrl());
  Logger.log('Agora vá em Implantar > Nova implantação > App da Web.');
}

/** Roda sozinho a cada 5 minutos e manda os lembretes que chegaram na hora. */
function verificarAvisos() {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(5000)) return;
  try {
    var cfg = lerConfig_();
    if (!temCanal_(cfg)) return;
    var agora = agora_();
    var eventos = lerEventos_();
    var enviados = lerEnviados_();
    var fila = avisosPendentes_(eventos, agora, enviados, cfg);
    var resumo = resumoPendente_(eventos, agora, enviados, cfg);
    if (resumo) fila.unshift(resumo);
    fila.slice(0, MAX_POR_RODADA).forEach(function (item) {
      var r = enviar_(cfg, item.texto, item.assunto);
      item.chaves.forEach(function (chave) { marcar_(enviados, chave, agora, r.ok); });
    });
    salvarEnviados_(enviados, agora);
  } finally {
    trava.releaseLock();
  }
}

/** Para testar pelo editor: manda uma mensagem de teste agora. */
function enviarTeste() {
  Logger.log(JSON.stringify(testar_()));
}

// ---------------------------------------------------------------------------
// App da Web

function doGet() {
  var ok = SENHA !== SENHA_EXEMPLO;
  return ContentService.createTextOutput(ok
    ? 'Agenda: servidor funcionando. Copie este endereço e cole no app, em Ajustes.'
    : 'Agenda: troque a SENHA no código e implante de novo.');
}

function doPost(e) {
  var r;
  try {
    var dados = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    conferirSenha_();
    if (String(dados.chave || '') !== SENHA) throw falha_('Senha errada. Confira a senha em Ajustes.', 'senha');
    var acao = ACOES_[dados.acao];
    if (!acao) throw falha_('Ação desconhecida: ' + dados.acao);
    r = acao(dados) || {};
    r.ok = true;
  } catch (err) {
    r = { ok: false, erro: (err && err.message) || String(err), codigo: (err && err.codigo) || '' };
  }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

var ACOES_ = {
  ping: function () {
    return {
      versao: VERSAO,
      fuso: FUSO,
      email: emailDono_(),
      planilha: planilha_().getUrl(),
      config: configPublica_(lerConfig_()),
      ultimoEnvio: lerJson_('ULTIMO_ENVIO', null)
    };
  },
  sincronizar: function (dados) { return sincronizar_(dados.eventos); },
  salvarConfig: function (dados) { return { config: configPublica_(salvarConfig_(dados.config || {})) }; },
  testar: function () { return testar_(); }
};

// ---------------------------------------------------------------------------
// Agenda

function sincronizar_(recebidos) {
  var trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try {
    var atuais = lerEventos_();
    var novos = (Array.isArray(recebidos) ? recebidos : [])
      .map(AgendaDatas.normalizar)
      .filter(function (ev) { return ev.id; });
    var juntos = AgendaDatas.limparApagados(AgendaDatas.mesclar(atuais, novos), agora_().iso, 60);
    if (JSON.stringify(ordenar_(atuais)) !== JSON.stringify(ordenar_(juntos))) gravarEventos_(juntos);
    return { eventos: juntos };
  } finally {
    trava.releaseLock();
  }
}

function ordenar_(lista) {
  return lista.slice().sort(function (a, b) {
    if (a.apagado !== b.apagado) return a.apagado ? 1 : -1;
    var x = a.data + ' ' + (a.hora || '00:00') + ' ' + a.id, y = b.data + ' ' + (b.hora || '00:00') + ' ' + b.id;
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

function lerEventos_() {
  var aba = aba_(ABA_AGENDA);
  var n = aba.getLastRow() - 1;
  if (n < 1) return [];
  return aba.getRange(2, 1, n, COLUNAS.length).getDisplayValues().map(function (linha) {
    var o = {};
    COLUNAS.forEach(function (c, i) { o[c] = String(linha[i] == null ? '' : linha[i]).trim(); });
    o.data = dataDaPlanilha_(o.data);
    o.ate = dataDaPlanilha_(o.ate);
    o.hora = horaDaPlanilha_(o.hora);
    o.horaFim = horaDaPlanilha_(o.horaFim);
    return AgendaDatas.normalizar(o);
  }).filter(function (ev) { return ev.id; });
}

function gravarEventos_(lista) {
  var aba = aba_(ABA_AGENDA);
  var antigas = aba.getLastRow() - 1;
  if (antigas > 0) aba.getRange(2, 1, antigas, COLUNAS.length).clearContent();
  if (!lista.length) return;
  var linhas = ordenar_(lista).map(function (ev) {
    return COLUNAS.map(function (c) {
      var v = ev[c];
      if (c === 'apagado') return v ? 'sim' : '';
      if (Array.isArray(v)) return v.join(',');
      v = v == null ? '' : String(v);
      // Evita que a planilha trate o texto como fórmula
      return /^[=+\-@]/.test(v) ? "'" + v : v;
    });
  });
  var faixa = aba.getRange(2, 1, linhas.length, COLUNAS.length);
  faixa.setNumberFormat('@');
  faixa.setValues(linhas);
}

// Se alguém editar a planilha à mão, a data pode virar 15/10/2026
function dataDaPlanilha_(v) {
  var m = String(v || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + AgendaDatas.dois(+m[2]) + '-' + AgendaDatas.dois(+m[1]);
  return String(v || '');
}
function horaDaPlanilha_(v) {
  var m = String(v || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? AgendaDatas.dois(+m[1]) + ':' + m[2] : '';
}

// ---------------------------------------------------------------------------
// Avisos

function avisosPendentes_(eventos, agora, enviados, cfg) {
  var D = AgendaDatas;
  var fila = [];
  var de = D.somarDias(agora.iso, -1), ate = D.somarDias(agora.iso, 31);
  eventos.forEach(function (ev) {
    if (ev.apagado || !ev.avisos.length) return;
    D.ocorrencias(ev, de, ate).forEach(function (dia) {
      var inicio = D.minutos(dia, ev.hora || cfg.horaDiaInteiro);
      if (agora.min > inicio + 30) return;
      var chaves = [];
      ev.avisos.forEach(function (antes) {
        var alvo = inicio - antes;
        if (alvo > agora.min || agora.min - alvo > TOLERANCIA_MIN) return;
        var chave = [ev.id, dia, ev.hora || 'dia', antes].join('|');
        if (podeEnviar_(enviados, chave)) chaves.push(chave);
      });
      if (chaves.length) {
        fila.push({ chaves: chaves, texto: textoAviso_(ev, dia, inicio, agora), assunto: assuntoAviso_(ev, dia, agora) });
      }
    });
  });
  return fila;
}

function resumoPendente_(eventos, agora, enviados, cfg) {
  if (!cfg.resumo.ativo) return null;
  var h = parseInt(agora.hora, 10);
  if (h < cfg.resumo.hora || h >= cfg.resumo.hora + 3) return null;
  var chave = 'resumo|' + agora.iso;
  if (!podeEnviar_(enviados, chave)) return null;
  var hoje = eventos.filter(function (ev) { return AgendaDatas.ocorrencias(ev, agora.iso, agora.iso).length; });
  if (!hoje.length) {
    // Dia livre: não manda nada, mas não precisa conferir de novo
    marcar_(enviados, chave, agora, true);
    return null;
  }
  hoje.sort(function (a, b) { return (a.hora || '') < (b.hora || '') ? -1 : (a.hora || '') > (b.hora || '') ? 1 : 0; });
  var linhas = hoje.map(function (ev) {
    var quando = ev.hora ? ev.hora + (ev.horaFim ? '–' + ev.horaFim : '') : 'Dia todo';
    return '• ' + quando + ' · ' + ev.titulo;
  });
  var dia = AgendaDatas.nomeDia(agora.iso) + ', ' + AgendaDatas.diaEMes(agora.iso);
  return {
    chaves: [chave],
    texto: '☀️ *Sua agenda de hoje*\n' + dia + '\n\n' + linhas.join('\n'),
    assunto: 'Sua agenda de hoje (' + hoje.length + ')'
  };
}

function textoAviso_(ev, dia, inicio, agora) {
  var D = AgendaDatas;
  var linha = D.relativa(dia, agora.iso) + ', ' + D.descreverHorario(ev);
  var falta = inicio - agora.min;
  if (ev.hora && falta > 0 && falta < 24 * 60) linha += ' (' + faltaTexto_(falta) + ')';
  var texto = '🔔 *' + ev.titulo + '*\n' + linha;
  if (ev.notas) texto += '\n📝 ' + ev.notas;
  return texto;
}

function assuntoAviso_(ev, dia, agora) {
  var D = AgendaDatas;
  return 'Lembrete: ' + ev.titulo + ' · ' + D.relativa(dia, agora.iso).toLowerCase() + (ev.hora ? ' ' + D.descreverHorario(ev) : '');
}

function faltaTexto_(min) {
  if (min < 60) return 'em ' + min + ' min';
  var h = Math.floor(min / 60), m = min % 60;
  return 'em ' + h + 'h' + (m ? AgendaDatas.dois(m) : '');
}

// ----- registro do que já foi enviado (aba "Enviados") -----

function lerEnviados_() {
  var aba = aba_(ABA_ENVIADOS);
  var n = aba.getLastRow() - 1;
  var itens = {};
  if (n > 0) {
    aba.getRange(2, 1, n, COLUNAS_ENVIADOS.length).getDisplayValues().forEach(function (l) {
      if (l[0]) itens[l[0]] = { quando: l[1], situacao: l[2] };
    });
  }
  return { itens: itens, mudou: false };
}

function podeEnviar_(enviados, chave) {
  var r = enviados.itens[chave];
  if (!r) return true;
  if (r.situacao === 'ok') return false;
  var tentativas = parseInt(String(r.situacao).replace(/\D/g, ''), 10) || 0;
  return tentativas < MAX_TENTATIVAS;
}

function marcar_(enviados, chave, agora, ok) {
  var antes = enviados.itens[chave];
  var tentativas = antes && antes.situacao !== 'ok' ? (parseInt(String(antes.situacao).replace(/\D/g, ''), 10) || 0) : 0;
  enviados.itens[chave] = { quando: agora.iso + ' ' + agora.hora, situacao: ok ? 'ok' : 'falhou ' + (tentativas + 1) };
  enviados.mudou = true;
}

function salvarEnviados_(enviados, agora) {
  var corte = AgendaDatas.somarDias(agora.iso, -30);
  var linhas = [];
  Object.keys(enviados.itens).forEach(function (chave) {
    var r = enviados.itens[chave];
    if (String(r.quando).slice(0, 10) >= corte) linhas.push([chave, r.quando, r.situacao]);
  });
  if (!enviados.mudou && linhas.length === Object.keys(enviados.itens).length) return;
  var aba = aba_(ABA_ENVIADOS);
  var antigas = aba.getLastRow() - 1;
  if (antigas > 0) aba.getRange(2, 1, antigas, COLUNAS_ENVIADOS.length).clearContent();
  if (!linhas.length) return;
  var faixa = aba.getRange(2, 1, linhas.length, COLUNAS_ENVIADOS.length);
  faixa.setNumberFormat('@');
  faixa.setValues(linhas);
}

// ---------------------------------------------------------------------------
// Envio: WhatsApp (CallMeBot) e e-mail

function temCanal_(cfg) {
  return !!((cfg.whatsapp.numero && cfg.whatsapp.chave) || (cfg.email.ativo && cfg.email.endereco));
}

function enviar_(cfg, texto, assunto) {
  var r = { ok: false, whatsapp: '', email: '', respostaWhats: '' };
  if (cfg.whatsapp.numero && cfg.whatsapp.chave) {
    try {
      r.respostaWhats = enviarWhatsApp_(cfg.whatsapp, texto);
      r.whatsapp = 'ok';
      r.ok = true;
    } catch (err) {
      r.whatsapp = 'erro: ' + err.message;
    }
  }
  if (cfg.email.ativo && cfg.email.endereco) {
    try {
      MailApp.sendEmail({ to: cfg.email.endereco, subject: assunto, body: texto.replace(/\*/g, '') });
      r.email = 'ok';
      r.ok = true;
    } catch (err) {
      r.email = 'erro: ' + err.message;
    }
  }
  var agora = agora_();
  gravarJson_('ULTIMO_ENVIO', { quando: agora.iso + ' ' + agora.hora, assunto: assunto, whatsapp: r.whatsapp, email: r.email, respostaWhats: r.respostaWhats });
  return r;
}

// Devolve o texto que o CallMeBot respondeu (para mostrar no app em "Último envio")
function enviarWhatsApp_(w, texto) {
  // Só os dígitos, igual ao link que o CallMeBot manda na ativação (ex.: 5527999999999)
  var url = 'https://api.callmebot.com/whatsapp.php' +
    '?phone=' + encodeURIComponent(String(w.numero).replace(/\D/g, '')) +
    '&text=' + encodeURIComponent(texto) +
    '&apikey=' + encodeURIComponent(w.chave);
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  var codigo = resp.getResponseCode();
  var corpo = String(resp.getContentText() || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  var deuCerto = /queued|sent|enviad/i.test(corpo);
  var deuErro = /invalid|error|wrong|incorrect|not (?:allowed|active|activated|found)|blocked|paused|stopped|0 messages|subscribe|limit|exceeded|unauthori[sz]ed/i.test(corpo);
  if (codigo >= 300 || (deuErro && !deuCerto)) {
    throw new Error('CallMeBot respondeu ' + codigo + ': ' + (corpo.slice(0, 160) || 'sem resposta'));
  }
  return corpo.slice(0, 200);
}

function testar_() {
  var cfg = lerConfig_();
  if (!temCanal_(cfg)) throw falha_('Preencha o WhatsApp (número e chave) ou ative o e-mail e salve antes de testar.');
  var r = enviar_(cfg, '✅ *Agenda*\nTudo certo! É por aqui que vão chegar os seus lembretes.', 'Agenda: teste de aviso');
  return { resultado: r };
}

// ---------------------------------------------------------------------------
// Configuração (fica nas Propriedades do script, fora da planilha)

function lerConfig_() {
  var c = lerJson_('CONFIG', {}) || {};
  var w = c.whatsapp || {}, m = c.email || {}, s = c.resumo || {};
  var horaResumo = parseInt(s.hora, 10);
  return {
    whatsapp: { numero: String(w.numero || ''), chave: String(w.chave || '') },
    email: { ativo: !!m.ativo, endereco: String(m.endereco || '') },
    resumo: { ativo: !!s.ativo, hora: horaResumo >= 0 && horaResumo <= 23 ? horaResumo : 7 },
    avisoPadrao: Array.isArray(c.avisoPadrao) ? c.avisoPadrao.filter(function (n) { return typeof n === 'number' && n >= 0; }) : [1440, 60],
    horaDiaInteiro: AgendaDatas.ehHora(c.horaDiaInteiro) ? c.horaDiaInteiro : '09:00'
  };
}

function salvarConfig_(nova) {
  var atual = lerConfig_();
  var w = nova.whatsapp || {}, m = nova.email || {}, s = nova.resumo || {};
  var numero = String(w.numero == null ? atual.whatsapp.numero : w.numero).replace(/[^\d]/g, '');
  var chave = String(w.chave == null ? '' : w.chave).trim();
  // O app recebe a chave mascarada; vazio ou mascarada = manter a que já está salva
  if (!chave || /^•/.test(chave)) chave = atual.whatsapp.chave;
  if (w.apagarChave) chave = '';
  var endereco = String(m.endereco == null ? atual.email.endereco : m.endereco).trim();
  if (endereco && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(endereco)) throw falha_('E-mail inválido: ' + endereco);
  var cfg = {
    whatsapp: { numero: numero ? '+' + numero : '', chave: chave },
    email: { ativo: m.ativo == null ? atual.email.ativo : !!m.ativo, endereco: endereco },
    resumo: { ativo: s.ativo == null ? atual.resumo.ativo : !!s.ativo, hora: s.hora == null ? atual.resumo.hora : parseInt(s.hora, 10) },
    avisoPadrao: Array.isArray(nova.avisoPadrao) ? AgendaDatas.normalizar({ avisos: nova.avisoPadrao }).avisos : atual.avisoPadrao,
    horaDiaInteiro: AgendaDatas.ehHora(nova.horaDiaInteiro) ? nova.horaDiaInteiro : atual.horaDiaInteiro
  };
  if (!(cfg.resumo.hora >= 0 && cfg.resumo.hora <= 23)) cfg.resumo.hora = 7;
  gravarJson_('CONFIG', cfg);
  return lerConfig_();
}

// Nunca devolve a chave do WhatsApp inteira para o app
function configPublica_(cfg) {
  var chave = cfg.whatsapp.chave;
  return {
    whatsapp: { numero: cfg.whatsapp.numero, chave: chave ? '••••' + chave.slice(-3) : '' },
    email: cfg.email,
    resumo: cfg.resumo,
    avisoPadrao: cfg.avisoPadrao,
    horaDiaInteiro: cfg.horaDiaInteiro
  };
}

// ---------------------------------------------------------------------------
// Utilidades

var planilhaAtual_ = null;

function planilha_() {
  if (planilhaAtual_) return planilhaAtual_;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PLANILHA');
  if (id) {
    try {
      planilhaAtual_ = SpreadsheetApp.openById(id);
      return planilhaAtual_;
    } catch (err) {
      // a planilha foi apagada: cria outra
    }
  }
  var nova = SpreadsheetApp.create('Agenda (dados)');
  var primeira = nova.getSheets()[0];
  primeira.setName(ABA_AGENDA);
  cabecalho_(primeira, COLUNAS);
  props.setProperty('PLANILHA', nova.getId());
  planilhaAtual_ = nova;
  return nova;
}

function aba_(nome) {
  var p = planilha_();
  var aba = p.getSheetByName(nome);
  if (!aba) {
    aba = p.insertSheet(nome);
    cabecalho_(aba, nome === ABA_AGENDA ? COLUNAS : COLUNAS_ENVIADOS);
  }
  return aba;
}

function cabecalho_(aba, colunas) {
  aba.getRange(1, 1, 1, colunas.length).setValues([colunas]).setFontWeight('bold');
  aba.setFrozenRows(1);
}

function agora_() {
  var s = Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd HH:mm');
  var iso = s.slice(0, 10), hora = s.slice(11, 16);
  return { iso: iso, hora: hora, min: AgendaDatas.minutos(iso, hora) };
}

function emailDono_() {
  try {
    return Session.getEffectiveUser().getEmail();
  } catch (err) {
    return '';
  }
}

function lerJson_(nome, padrao) {
  var v = PropertiesService.getScriptProperties().getProperty(nome);
  if (!v) return padrao;
  try {
    return JSON.parse(v);
  } catch (err) {
    return padrao;
  }
}

function gravarJson_(nome, valor) {
  PropertiesService.getScriptProperties().setProperty(nome, JSON.stringify(valor));
}

function conferirSenha_() {
  if (SENHA === SENHA_EXEMPLO || String(SENHA).length < 6) {
    throw falha_('Troque a SENHA no começo do código (mínimo 6 caracteres), salve e implante de novo.', 'senha-padrao');
  }
}

function falha_(mensagem, codigo) {
  var e = new Error(mensagem);
  e.codigo = codigo || '';
  return e;
}

// ===== INÍCIO: cópia de app/datas.js (não edite aqui: edite app/datas.js e rode `npm run servidor`) =====
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
// ===== FIM: cópia de app/datas.js =====
