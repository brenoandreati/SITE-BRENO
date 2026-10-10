// Imitação dos serviços do Google (planilha, propriedades, gatilhos, UrlFetchApp…)
// para rodar servidor/Codigo.gs fora do Google. Usada nos testes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODIGO = fs.readFileSync(path.join(__dirname, '../servidor/Codigo.gs'), 'utf8');

function criarGoogle({ senha = 'minha-senha-123', agora = '2026-10-10T10:00:00-03:00', respostaWhats } = {}) {
  let instante = new Date(agora).getTime();
  const props = {};
  const whats = [];
  const emails = [];
  const gatilhos = [];

  class Aba {
    constructor(nome) { this.nome = nome; this.celulas = []; }
    getName() { return this.nome; }
    setName(n) { this.nome = n; return this; }
    getLastRow() {
      for (let i = this.celulas.length - 1; i >= 0; i--) if ((this.celulas[i] || []).some((v) => v !== '' && v != null)) return i + 1;
      return 0;
    }
    getRange(linha, coluna, nLinhas = 1, nColunas = 1) {
      const aba = this;
      return {
        setValues(valores) {
          assert.equal(valores.length, nLinhas);
          valores.forEach((l, i) => {
            assert.equal(l.length, nColunas);
            aba.celulas[linha - 1 + i] = aba.celulas[linha - 1 + i] || [];
            l.forEach((v, j) => {
              // A planilha esconde o apóstrofo do começo
              aba.celulas[linha - 1 + i][coluna - 1 + j] = typeof v === 'string' && v[0] === "'" ? v.slice(1) : v;
            });
          });
          return this;
        },
        getDisplayValues() {
          return Array.from({ length: nLinhas }, (_, i) =>
            Array.from({ length: nColunas }, (_, j) => String((aba.celulas[linha - 1 + i] || [])[coluna - 1 + j] ?? '')));
        },
        clearContent() {
          for (let i = 0; i < nLinhas; i++) for (let j = 0; j < nColunas; j++) {
            if (aba.celulas[linha - 1 + i]) aba.celulas[linha - 1 + i][coluna - 1 + j] = '';
          }
          return this;
        },
        setNumberFormat() { return this; },
        setFontWeight() { return this; },
      };
    }
    setFrozenRows() { return this; }
  }
  class Planilha {
    constructor() { this.abas = [new Aba('Página1')]; }
    getId() { return 'planilha-1'; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/planilha-1'; }
    getSheets() { return this.abas; }
    getSheetByName(n) { return this.abas.find((a) => a.nome === n) || null; }
    insertSheet(n) { const a = new Aba(n); this.abas.push(a); return a; }
  }
  let planilha = null;

  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(instante); }
    static now() { return instante; }
  }

  const contexto = {
    Date: FakeDate,
    JSON, Math, String, Number, Array, Object, RegExp, Error, parseInt, isNaN, encodeURIComponent,
    Logger: { log() {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
      }),
    },
    SpreadsheetApp: {
      create: () => (planilha = new Planilha()),
      openById: (id) => { if (!planilha || id !== 'planilha-1') throw new Error('não existe'); return planilha; },
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      formatDate(data, fuso, formato) {
        assert.equal(formato, 'yyyy-MM-dd HH:mm');
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
          timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(data).map((x) => [x.type, x.value]));
        return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
      },
    },
    UrlFetchApp: {
      fetch(url) {
        const u = new URL(url);
        whats.push({ phone: u.searchParams.get('phone'), text: u.searchParams.get('text'), apikey: u.searchParams.get('apikey') });
        const r = respostaWhats || { codigo: 200, corpo: '<html><p>Message queued. You will receive it in a few seconds.</p></html>' };
        return { getResponseCode: () => r.codigo, getContentText: () => r.corpo };
      },
    },
    MailApp: { sendEmail: (m) => emails.push(m) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ conteudo: s, setMimeType() { return this; } }),
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'breno@gmail.com' }) },
    ScriptApp: {
      getProjectTriggers: () => gatilhos,
      deleteTrigger: (g) => gatilhos.splice(gatilhos.indexOf(g), 1),
      newTrigger: (fn) => ({
        timeBased: () => ({ everyMinutes: (n) => ({ create: () => gatilhos.push({ fn, n, getHandlerFunction: () => fn }) }) }),
      }),
    },
  };
  vm.createContext(contexto);
  vm.runInContext(CODIGO.replace("var SENHA = 'troque-esta-senha';", `var SENHA = '${senha}';`), contexto);

  const g = {
    contexto, whats, emails, gatilhos, props,
    get planilha() { return planilha; },
    avancar(minutos) { instante += minutos * 60000; },
    post(dados, chave = senha) {
      const r = contexto.doPost({ postData: { contents: JSON.stringify({ chave, ...dados }) } });
      return JSON.parse(r.conteudo);
    },
    rodarGatilho() { contexto.verificarAvisos(); },
  };
  return g;
}

module.exports = { criarGoogle };
