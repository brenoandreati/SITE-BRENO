// Imitação do banco D1 do Cloudflare usando o SQLite do próprio Node.
// Já cria as tabelas de migrations/. Usada nos testes do servidor.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

const PASTA = new URL('../migrations/', import.meta.url);

function valor(v) {
  // O D1 recusa undefined; aqui também, para pegar erro de código cedo
  if (v === undefined) throw new Error('D1_TYPE_ERROR: undefined não é aceito');
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

export function criarD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const arq of readdirSync(PASTA).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(arq, PASTA), 'utf8'));
  }
  let consultas = 0;

  class Instrucao {
    constructor(sql, valores = []) { this.sql = sql; this.valores = valores; }
    bind(...v) { return new Instrucao(this.sql, v.map(valor)); }
    _preparada() { consultas++; return db.prepare(this.sql); }
    async first(coluna) {
      const r = this._preparada().get(...this.valores);
      if (!r) return null;
      const o = { ...r };
      return coluna ? o[coluna] : o;
    }
    async all() { return { success: true, results: this._preparada().all(...this.valores).map((r) => ({ ...r })) }; }
    async run() { const r = this._preparada().run(...this.valores); return { success: true, meta: { changes: Number(r.changes) } }; }
  }

  return {
    prepare: (sql) => new Instrucao(sql),
    async batch(lista) {
      db.exec('BEGIN');
      try {
        const r = lista.map((i) => i._preparada().run(...i.valores));
        db.exec('COMMIT');
        return r;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    linhas: (sql, ...v) => db.prepare(sql).all(...v).map((r) => ({ ...r })),
    get consultas() { return consultas; }
  };
}
