// Rotas /api/*: contas, login e a agenda de cada pessoa.
import D from '../publico/app/datas.js';
import * as S from './seguranca.mjs';
import { lerConfig, mesclarConfig, configPublica, temWhats } from './config.mjs';
import { enviarWhatsApp } from './avisos.mjs';

const LIMITE_CORPO = 2_000_000;
const DIAS_SESSAO = 180;
const MAX_EVENTOS = 5000;
const MAX_POR_SINCRONIA = 2000;
const MINUTOS_CODIGO = 15;

class Falha extends Error {
  constructor(status, mensagem, codigo) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo || '';
  }
}

const ROTAS = {
  'POST /api/cadastro': { publica: true, fn: cadastro },
  'POST /api/entrar': { publica: true, fn: entrar },
  'POST /api/recuperar': { publica: true, fn: recuperar },
  'POST /api/redefinir': { publica: true, fn: redefinir },
  'POST /api/sair': { fn: sair },
  'GET /api/conta': { fn: conta },
  'POST /api/sincronizar': { fn: sincronizar },
  'POST /api/config': { fn: salvarConfig },
  'POST /api/testar': { fn: testar },
  'POST /api/senha': { fn: trocarSenha },
  'POST /api/apagar-conta': { fn: apagarConta }
};

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function tratarApi(request, env) {
  const url = new URL(request.url);
  const rota = ROTAS[request.method + ' ' + url.pathname.replace(/\/+$/, '')];
  try {
    if (!rota) throw new Falha(404, 'Endereço não encontrado.', 'rota');
    const ctx = { env, db: env.DB, agora: Date.now(), ip: request.headers.get('cf-connecting-ip') || 'local' };
    const corpo = request.method === 'GET' ? {} : await lerCorpo(request);
    if (!rota.publica) ctx.usuario = await autenticar(ctx, request);
    return json({ ok: true, ...(await rota.fn(ctx, corpo)) });
  } catch (err) {
    if (err instanceof Falha) return json({ ok: false, erro: err.message, codigo: err.codigo }, err.status);
    console.error(err && err.stack ? err.stack : err);
    return json({ ok: false, erro: 'Erro no servidor. Tente de novo em instantes.', codigo: 'interno' }, 500);
  }
}

async function lerCorpo(request) {
  if ((+request.headers.get('content-length') || 0) > LIMITE_CORPO) throw new Falha(413, 'Dados grandes demais.', 'grande');
  const texto = await request.text();
  if (texto.length > LIMITE_CORPO) throw new Falha(413, 'Dados grandes demais.', 'grande');
  if (!texto) return {};
  try {
    const v = JSON.parse(texto);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) {
    throw new Falha(400, 'Pedido inválido.', 'json');
  }
}

// ---------- validação ----------

const iso = (ms) => new Date(ms).toISOString();

function lerEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  if (e.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Falha(400, 'Confira o e-mail.', 'email');
  return e;
}
function lerSenha(v) {
  if (!/^[0-9a-f]{64}$/.test(String(v || ''))) throw new Falha(400, 'Senha inválida.', 'senha');
  return v;
}
function lerNome(v) {
  const n = String(v || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!n) throw new Falha(400, 'Diga o seu nome.', 'nome');
  return n;
}
function lerFuso(v) {
  if (typeof v !== 'string' || !v || v.length > 64) return 'America/Sao_Paulo';
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: v });
    return v;
  } catch (e) {
    return 'America/Sao_Paulo';
  }
}

async function limite(ctx, chave, max, janelaSeg) {
  if (!(await S.dentroDoLimite(ctx.db, chave, max, janelaSeg, ctx.agora))) {
    throw new Falha(429, 'Muitas tentativas. Espere alguns minutos e tente de novo.', 'limite');
  }
}

async function senhaConfere(usuario, senhaDoApp) {
  return S.iguais(await S.hashDaSenha(usuario.senha_sal, senhaDoApp), usuario.senha_hash);
}

// ---------- sessão ----------

async function autenticar(ctx, request) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(request.headers.get('authorization') || '');
  if (!m) throw new Falha(401, 'Entre na sua conta.', 'sessao');
  const tokenHash = await S.hashDoToken(m[1]);
  const u = await ctx.db.prepare(
    'SELECT u.*, s.expira AS sessao_expira FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?1'
  ).bind(tokenHash).first();
  if (!u || u.sessao_expira < iso(ctx.agora)) throw new Falha(401, 'Sua sessão terminou. Entre de novo.', 'sessao');
  // Renova sozinho: quem usa sempre não precisa entrar de novo
  if (Date.parse(u.sessao_expira) - ctx.agora < 90 * 86400000) {
    await ctx.db.prepare('UPDATE sessoes SET expira = ?2 WHERE token_hash = ?1').bind(tokenHash, iso(ctx.agora + DIAS_SESSAO * 86400000)).run();
  }
  u.tokenHash = tokenHash;
  return u;
}

async function abrirSessao(ctx, usuario) {
  const token = S.novoToken();
  await ctx.db.prepare('INSERT INTO sessoes (token_hash, usuario_id, criado, expira) VALUES (?1, ?2, ?3, ?4)')
    .bind(await S.hashDoToken(token), usuario.id, iso(ctx.agora), iso(ctx.agora + DIAS_SESSAO * 86400000)).run();
  return { token, ...dadosDaConta(usuario) };
}

function dadosDaConta(u) {
  let ultimoEnvio = null;
  try { ultimoEnvio = u.ultimo_envio ? JSON.parse(u.ultimo_envio) : null; } catch (e) { /* nada */ }
  return {
    usuario: { id: u.id, nome: u.nome, email: u.email, fuso: u.fuso },
    config: configPublica(lerConfig(u.config)),
    ultimoEnvio
  };
}

// ---------- contas ----------

async function cadastro(ctx, corpo) {
  await limite(ctx, 'cadastro:' + ctx.ip, 10, 3600);
  const email = lerEmail(corpo.email), nome = lerNome(corpo.nome), senha = lerSenha(corpo.senha);
  const existe = await ctx.db.prepare('SELECT 1 FROM usuarios WHERE email = ?1').bind(email).first();
  if (existe) throw new Falha(409, 'Já existe uma conta com esse e-mail. Toque em “Entrar”.', 'existe');
  const sal = S.novoSal();
  const usuario = {
    id: crypto.randomUUID(), email, nome, senha_sal: sal, senha_hash: await S.hashDaSenha(sal, senha),
    fuso: lerFuso(corpo.fuso), config: JSON.stringify(lerConfig({})), ultimo_envio: ''
  };
  try {
    await ctx.db.prepare(
      'INSERT INTO usuarios (id, email, nome, senha_sal, senha_hash, fuso, config, criado) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)'
    ).bind(usuario.id, email, nome, sal, usuario.senha_hash, usuario.fuso, usuario.config, iso(ctx.agora)).run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err && err.message))) throw new Falha(409, 'Já existe uma conta com esse e-mail. Toque em “Entrar”.', 'existe');
    throw err;
  }
  return abrirSessao(ctx, usuario);
}

async function entrar(ctx, corpo) {
  const email = lerEmail(corpo.email), senha = lerSenha(corpo.senha);
  await limite(ctx, 'entrar-ip:' + ctx.ip, 30, 900);
  await limite(ctx, 'entrar:' + email, 10, 900);
  const u = await ctx.db.prepare('SELECT * FROM usuarios WHERE email = ?1').bind(email).first();
  if (!u || !(await senhaConfere(u, senha))) throw new Falha(401, 'E-mail ou senha errados.', 'credenciais');
  return abrirSessao(ctx, u);
}

async function sair(ctx) {
  await ctx.db.prepare('DELETE FROM sessoes WHERE token_hash = ?1').bind(ctx.usuario.tokenHash).run();
  return {};
}

async function conta(ctx) {
  return dadosDaConta(ctx.usuario);
}

async function trocarSenha(ctx, corpo) {
  const atual = lerSenha(corpo.atual), nova = lerSenha(corpo.nova);
  await limite(ctx, 'senha:' + ctx.usuario.id, 10, 900);
  if (!(await senhaConfere(ctx.usuario, atual))) throw new Falha(400, 'A senha atual está errada.', 'credenciais');
  const sal = S.novoSal();
  await ctx.db.batch([
    ctx.db.prepare('UPDATE usuarios SET senha_sal = ?2, senha_hash = ?3 WHERE id = ?1').bind(ctx.usuario.id, sal, await S.hashDaSenha(sal, nova)),
    // Sai dos outros aparelhos
    ctx.db.prepare('DELETE FROM sessoes WHERE usuario_id = ?1 AND token_hash <> ?2').bind(ctx.usuario.id, ctx.usuario.tokenHash)
  ]);
  return {};
}

async function apagarConta(ctx, corpo) {
  const senha = lerSenha(corpo.senha);
  await limite(ctx, 'senha:' + ctx.usuario.id, 10, 900);
  if (!(await senhaConfere(ctx.usuario, senha))) throw new Falha(400, 'Senha errada.', 'credenciais');
  const id = ctx.usuario.id;
  await ctx.db.batch(['eventos', 'enviados', 'sessoes', 'recuperacoes'].map((t) => ctx.db.prepare(`DELETE FROM ${t} WHERE usuario_id = ?1`).bind(id))
    .concat([ctx.db.prepare('DELETE FROM usuarios WHERE id = ?1').bind(id)]));
  return {};
}

// ---------- esqueci a senha (código pelo WhatsApp) ----------

async function recuperar(ctx, corpo) {
  const email = lerEmail(corpo.email);
  await limite(ctx, 'recuperar-ip:' + ctx.ip, 10, 3600);
  await limite(ctx, 'recuperar:' + email, 3, 3600);
  const u = await ctx.db.prepare('SELECT * FROM usuarios WHERE email = ?1').bind(email).first();
  if (!u) throw new Falha(404, 'Não existe conta com esse e-mail.', 'sem-conta');
  const cfg = lerConfig(u.config);
  if (!temWhats(cfg)) {
    throw new Falha(400, 'Essa conta ainda não tem WhatsApp configurado, então não dá para mandar o código. Fale com quem administra a agenda.', 'sem-whats');
  }
  const codigo = S.novoCodigo();
  await ctx.db.prepare(
    `INSERT INTO recuperacoes (usuario_id, codigo_hash, expira, tentativas) VALUES (?1, ?2, ?3, 0)
     ON CONFLICT (usuario_id) DO UPDATE SET codigo_hash = excluded.codigo_hash, expira = excluded.expira, tentativas = 0`
  ).bind(u.id, await S.hashDoCodigo(u.id, codigo), iso(ctx.agora + MINUTOS_CODIGO * 60000)).run();
  try {
    await enviarWhatsApp(ctx.env, cfg.whatsapp,
      '🔐 *Agenda*\nSeu código para criar uma senha nova: *' + codigo + '*\nVale por ' + MINUTOS_CODIGO + ' minutos. Se não foi você, ignore esta mensagem.');
  } catch (err) {
    throw new Falha(502, 'Não consegui mandar o código pelo WhatsApp agora. Tente de novo em alguns minutos.', 'whats');
  }
  return { final: cfg.whatsapp.numero.slice(-4) };
}

async function redefinir(ctx, corpo) {
  const email = lerEmail(corpo.email), nova = lerSenha(corpo.nova);
  const codigo = String(corpo.codigo || '').replace(/\D/g, '');
  await limite(ctx, 'redefinir-ip:' + ctx.ip, 20, 3600);
  const u = await ctx.db.prepare('SELECT * FROM usuarios WHERE email = ?1').bind(email).first();
  const rec = u && await ctx.db.prepare('SELECT * FROM recuperacoes WHERE usuario_id = ?1').bind(u.id).first();
  if (!rec || rec.expira < iso(ctx.agora) || rec.tentativas >= 5) {
    throw new Falha(400, 'Esse código não vale mais. Peça um novo.', 'codigo-velho');
  }
  if (!S.iguais(await S.hashDoCodigo(u.id, codigo), rec.codigo_hash)) {
    await ctx.db.prepare('UPDATE recuperacoes SET tentativas = tentativas + 1 WHERE usuario_id = ?1').bind(u.id).run();
    throw new Falha(400, 'Código errado. Confira no WhatsApp.', 'codigo');
  }
  const sal = S.novoSal();
  u.senha_sal = sal;
  u.senha_hash = await S.hashDaSenha(sal, nova);
  await ctx.db.batch([
    ctx.db.prepare('UPDATE usuarios SET senha_sal = ?2, senha_hash = ?3 WHERE id = ?1').bind(u.id, sal, u.senha_hash),
    ctx.db.prepare('DELETE FROM recuperacoes WHERE usuario_id = ?1').bind(u.id),
    ctx.db.prepare('DELETE FROM sessoes WHERE usuario_id = ?1').bind(u.id)
  ]);
  return abrirSessao(ctx, u);
}

// ---------- agenda ----------

// Último dia em que o compromisso pode acontecer ('' = repete sem fim)
function ultimoDia(e) {
  if (e.repete === 'nao') return e.data;
  return e.ate || '';
}

// O app manda o que mudou desde a última vez (`alterados`) e o número da última
// versão que recebeu (`cursor`). Vale a alteração mais recente de cada compromisso.
async function sincronizar(ctx, corpo) {
  const id = ctx.usuario.id;
  const cursor = Math.max(0, parseInt(corpo.cursor, 10) || 0);
  const recebidos = (Array.isArray(corpo.alterados) ? corpo.alterados : [])
    .slice(0, MAX_POR_SINCRONIA)
    .map(D.normalizar)
    .filter((e) => e.id && e.id.length <= 80 && e.atualizado && e.data);

  const rejeitados = [];
  if (recebidos.length) {
    const atuais = new Map();
    const linhas = (await ctx.db.prepare(
      'SELECT id, dados, atualizado FROM eventos WHERE usuario_id = ?1 AND id IN (SELECT value FROM json_each(?2))'
    ).bind(id, JSON.stringify(recebidos.map((e) => e.id))).all()).results;
    for (const l of linhas) atuais.set(l.id, l);

    // Um mesmo id repetido no pedido: fica o mais recente
    const porId = new Map();
    for (const e of recebidos) if (!porId.has(e.id) || e.atualizado > porId.get(e.id).atualizado) porId.set(e.id, e);
    const aceitos = [];
    for (const e of porId.values()) {
      const a = atuais.get(e.id);
      // Já tinha uma versão igual ou mais nova: o aparelho recebe ela de volta
      if (a && a.atualizado >= e.atualizado) rejeitados.push(JSON.parse(a.dados));
      else aceitos.push(e);
    }

    const novos = aceitos.filter((e) => !atuais.has(e.id)).length;
    if (novos) {
      const total = await ctx.db.prepare('SELECT COUNT(*) AS n FROM eventos WHERE usuario_id = ?1').bind(id).first();
      if (total.n + novos > MAX_EVENTOS) throw new Falha(413, 'A agenda chegou ao limite de ' + MAX_EVENTOS + ' compromissos.', 'cheia');
    }

    if (aceitos.length) {
      const lote = aceitos.map((e) => ({
        id: e.id, dados: JSON.stringify(e), atualizado: e.atualizado, apagado: e.apagado ? 1 : 0, ultimo_dia: ultimoDia(e)
      }));
      // Cada linha ganha uma versão nova (seq); as duas instruções rodam juntas, numa transação
      await ctx.db.batch([
        ctx.db.prepare(
          `INSERT INTO eventos (usuario_id, id, dados, atualizado, apagado, ultimo_dia, seq)
           SELECT ?1, json_extract(j.value, '$.id'), json_extract(j.value, '$.dados'), json_extract(j.value, '$.atualizado'),
                  json_extract(j.value, '$.apagado'), json_extract(j.value, '$.ultimo_dia'),
                  (SELECT seq FROM usuarios WHERE id = ?1) + j.key + 1
           FROM json_each(?2) AS j WHERE true
           ON CONFLICT (usuario_id, id) DO UPDATE SET
             dados = excluded.dados, atualizado = excluded.atualizado, apagado = excluded.apagado,
             ultimo_dia = excluded.ultimo_dia, seq = excluded.seq
           WHERE excluded.atualizado > eventos.atualizado`
        ).bind(id, JSON.stringify(lote)),
        ctx.db.prepare('UPDATE usuarios SET seq = seq + ?2 WHERE id = ?1').bind(id, lote.length)
      ]);
    }
  }

  const mudancas = (await ctx.db.prepare(
    'SELECT dados FROM eventos WHERE usuario_id = ?1 AND seq > ?2 ORDER BY seq'
  ).bind(id, cursor).all()).results;
  const fim = await ctx.db.prepare('SELECT seq FROM usuarios WHERE id = ?1').bind(id).first();
  return {
    cursor: fim ? fim.seq : cursor,
    eventos: mudancas.map((l) => JSON.parse(l.dados)),
    rejeitados
  };
}

// ---------- avisos ----------

async function salvarConfig(ctx, corpo) {
  const atual = lerConfig(ctx.usuario.config);
  const cfg = mesclarConfig(atual, corpo.config || {});
  if (cfg.whatsapp.numero && cfg.whatsapp.numero.length < 12) throw new Falha(400, 'Confira o número: precisa ter DDD (ex.: 11 91234-5678).', 'numero');
  const fuso = corpo.fuso ? lerFuso(corpo.fuso) : ctx.usuario.fuso;
  await ctx.db.prepare('UPDATE usuarios SET config = ?2, whats_ativo = ?3, fuso = ?4 WHERE id = ?1')
    .bind(ctx.usuario.id, JSON.stringify(cfg), temWhats(cfg) ? 1 : 0, fuso).run();
  ctx.usuario.config = JSON.stringify(cfg);
  ctx.usuario.fuso = fuso;
  return dadosDaConta(ctx.usuario);
}

async function testar(ctx) {
  const cfg = lerConfig(ctx.usuario.config);
  if (!temWhats(cfg)) throw new Falha(400, 'Preencha o número e a chave do CallMeBot e salve antes de testar.', 'sem-whats');
  await limite(ctx, 'testar:' + ctx.usuario.id, 10, 3600);
  const primeiro = ctx.usuario.nome.split(' ')[0];
  const envio = { quando: iso(ctx.agora), whatsapp: 'ok', respostaWhats: '' };
  try {
    envio.respostaWhats = await enviarWhatsApp(ctx.env, cfg.whatsapp,
      '✅ *Agenda*\nTudo certo, ' + primeiro + '! É por aqui que vão chegar os seus lembretes.');
  } catch (err) {
    envio.whatsapp = 'erro: ' + err.message;
  }
  await ctx.db.prepare('UPDATE usuarios SET ultimo_envio = ?2 WHERE id = ?1').bind(ctx.usuario.id, JSON.stringify(envio)).run();
  return { resultado: envio };
}
