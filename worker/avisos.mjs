// Avisos no WhatsApp (CallMeBot). Roda a cada 5 minutos (triggers.crons em wrangler.jsonc).
import D from '../publico/app/datas.js';
import { lerConfig, temWhats } from './config.mjs';

const TOLERANCIA_MIN = 12 * 60;  // aviso atrasado mais que isso não é mandado
const MAX_TENTATIVAS = 3;
const MAX_ENVIOS_POR_RODADA = 30; // o Cloudflare limita as chamadas externas por execução

// Data e hora de agora no fuso da pessoa
export function agoraNoFuso(data, fuso) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso || 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(data).forEach((x) => { p[x.type] = x.value; });
  const iso = `${p.year}-${p.month}-${p.day}`, hora = `${p.hour}:${p.minute}`;
  return { iso, hora, min: D.minutos(iso, hora) };
}

// Devolve o texto que o CallMeBot respondeu; dá erro se ele recusou
export async function enviarWhatsApp(env, whatsapp, texto) {
  const base = (env && env.CALLMEBOT_URL) || 'https://api.callmebot.com';
  const url = base + '/whatsapp.php' +
    '?phone=' + encodeURIComponent(String(whatsapp.numero).replace(/\D/g, '')) +
    '&text=' + encodeURIComponent(texto) +
    '&apikey=' + encodeURIComponent(whatsapp.chave);
  let resp;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new Error('não consegui falar com o CallMeBot (' + (err && err.name) + ')');
  }
  const corpo = (await resp.text())
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const deuCerto = /queued|sent|enviad/i.test(corpo);
  const deuErro = /invalid|error|wrong|incorrect|not (?:allowed|active|activated|found)|blocked|paused|stopped|0 messages|subscribe|limit|exceeded|unauthori[sz]ed/i.test(corpo);
  if (resp.status >= 300 || (deuErro && !deuCerto)) {
    throw new Error('CallMeBot respondeu ' + resp.status + ': ' + (corpo.slice(0, 160) || 'sem resposta'));
  }
  return corpo.slice(0, 200);
}

// ---------- o que mandar ----------

function podeEnviar(enviados, chave) {
  const r = enviados.get(chave);
  if (!r) return true;
  if (r === 'ok') return false;
  return (parseInt(String(r).replace(/\D/g, ''), 10) || 0) < MAX_TENTATIVAS;
}

function faltaTexto(min) {
  if (min < 60) return 'em ' + min + ' min';
  const h = Math.floor(min / 60), m = min % 60;
  return 'em ' + h + 'h' + (m ? D.dois(m) : '');
}

export function textoAviso(ev, dia, inicio, agora) {
  let linha = D.relativa(dia, agora.iso) + ', ' + D.descreverHorario(ev);
  const falta = inicio - agora.min;
  if (ev.hora && falta > 0 && falta < 24 * 60) linha += ' (' + faltaTexto(falta) + ')';
  let texto = '🔔 *' + ev.titulo + '*\n' + linha;
  if (ev.notas) texto += '\n📝 ' + ev.notas;
  return texto;
}

export function avisosPendentes(eventos, agora, enviados, cfg) {
  const fila = [];
  const de = D.somarDias(agora.iso, -1), ate = D.somarDias(agora.iso, 31);
  for (const ev of eventos) {
    if (ev.apagado || !ev.avisos.length) continue;
    for (const dia of D.ocorrencias(ev, de, ate)) {
      const inicio = D.minutos(dia, ev.hora || cfg.horaDiaInteiro);
      if (agora.min > inicio + 30) continue;
      const chaves = [];
      for (const antes of ev.avisos) {
        const alvo = inicio - antes;
        if (alvo > agora.min || agora.min - alvo > TOLERANCIA_MIN) continue;
        const chave = [ev.id, dia, ev.hora || 'dia', antes].join('|');
        if (podeEnviar(enviados, chave)) chaves.push(chave);
      }
      if (chaves.length) fila.push({ chaves, texto: textoAviso(ev, dia, inicio, agora) });
    }
  }
  return fila;
}

// Resumo da manhã. Devolve { chaves, texto } ou, num dia livre, { chaves, texto: '' }.
export function resumoPendente(eventos, agora, enviados, cfg) {
  if (!cfg.resumo.ativo) return null;
  const h = parseInt(agora.hora, 10);
  if (h < cfg.resumo.hora || h >= cfg.resumo.hora + 3) return null;
  const chave = 'resumo|' + agora.iso;
  if (!podeEnviar(enviados, chave)) return null;
  const hoje = eventos
    .filter((ev) => D.ocorrencias(ev, agora.iso, agora.iso).length)
    .sort((a, b) => ((a.hora || '') < (b.hora || '') ? -1 : (a.hora || '') > (b.hora || '') ? 1 : 0));
  if (!hoje.length) return { chaves: [chave], texto: '' };
  const linhas = hoje.map((ev) => '• ' + (ev.hora ? ev.hora + (ev.horaFim ? '–' + ev.horaFim : '') : 'Dia todo') + ' · ' + ev.titulo);
  const dia = D.nomeDia(agora.iso) + ', ' + D.diaEMes(agora.iso);
  return { chaves: [chave], texto: '☀️ *Sua agenda de hoje*\n' + dia + '\n\n' + linhas.join('\n') };
}

// ---------- rodada do cron ----------

export async function rodarAvisos(env, quando = new Date()) {
  const db = env.DB;
  const agoraIso = quando.toISOString();
  const usuarios = (await db.prepare('SELECT id, fuso, config FROM usuarios WHERE whats_ativo = 1').all()).results;

  if (usuarios.length) {
    const corteDia = D.somarDias(agoraIso.slice(0, 10), -2);
    const linhas = (await db.prepare(
      `SELECT e.usuario_id, e.dados FROM eventos e JOIN usuarios u ON u.id = e.usuario_id
       WHERE u.whats_ativo = 1 AND e.apagado = 0 AND (e.ultimo_dia = '' OR e.ultimo_dia >= ?1)`
    ).bind(corteDia).all()).results;
    const jaEnviados = (await db.prepare('SELECT usuario_id, chave, situacao FROM enviados WHERE quando >= ?1')
      .bind(new Date(quando.getTime() - 3 * 86400000).toISOString()).all()).results;

    const eventosDe = new Map(), enviadosDe = new Map();
    for (const l of linhas) {
      if (!eventosDe.has(l.usuario_id)) eventosDe.set(l.usuario_id, []);
      try { eventosDe.get(l.usuario_id).push(D.normalizar(JSON.parse(l.dados))); } catch (e) { /* linha estragada */ }
    }
    for (const l of jaEnviados) {
      if (!enviadosDe.has(l.usuario_id)) enviadosDe.set(l.usuario_id, new Map());
      enviadosDe.get(l.usuario_id).set(l.chave, l.situacao);
    }

    const fila = [];
    for (const u of usuarios) {
      const cfg = lerConfig(u.config);
      if (!temWhats(cfg)) continue;
      const agora = agoraNoFuso(quando, u.fuso);
      const eventos = eventosDe.get(u.id) || [];
      const enviados = enviadosDe.get(u.id) || new Map();
      const resumo = resumoPendente(eventos, agora, enviados, cfg);
      if (resumo) fila.push({ usuario: u.id, cfg, ...resumo });
      for (const item of avisosPendentes(eventos, agora, enviados, cfg)) fila.push({ usuario: u.id, cfg, ...item });
    }

    const marcas = [], ultimos = new Map();
    for (const item of fila.slice(0, MAX_ENVIOS_POR_RODADA)) {
      let situacao = 'ok';
      if (item.texto) {
        const envio = { quando: agoraIso, whatsapp: 'ok', respostaWhats: '' };
        try {
          envio.respostaWhats = await enviarWhatsApp(env, item.cfg.whatsapp, item.texto);
        } catch (err) {
          envio.whatsapp = 'erro: ' + err.message;
          situacao = 'falhou';
        }
        ultimos.set(item.usuario, envio);
      }
      const antes = (enviadosDe.get(item.usuario) || new Map());
      for (const chave of item.chaves) {
        const tentativas = situacao === 'ok' ? 0 : (parseInt(String(antes.get(chave) || '').replace(/\D/g, ''), 10) || 0) + 1;
        marcas.push({ u: item.usuario, c: chave, s: situacao === 'ok' ? 'ok' : 'falhou ' + tentativas });
      }
    }

    const escritas = [];
    if (marcas.length) {
      escritas.push(db.prepare(
        `INSERT INTO enviados (usuario_id, chave, quando, situacao)
         SELECT json_extract(value, '$.u'), json_extract(value, '$.c'), ?2, json_extract(value, '$.s') FROM json_each(?1) WHERE true
         ON CONFLICT (usuario_id, chave) DO UPDATE SET quando = excluded.quando, situacao = excluded.situacao`
      ).bind(JSON.stringify(marcas), agoraIso));
    }
    if (ultimos.size) {
      const lista = JSON.stringify([...ultimos].map(([u, envio]) => ({ u, t: JSON.stringify(envio) })));
      escritas.push(db.prepare(
        `UPDATE usuarios SET ultimo_envio = (SELECT json_extract(value, '$.t') FROM json_each(?1) WHERE json_extract(value, '$.u') = usuarios.id)
         WHERE id IN (SELECT json_extract(value, '$.u') FROM json_each(?1))`
      ).bind(lista));
    }
    if (escritas.length) await db.batch(escritas);
  }

  // Uma vez por hora: faxina
  if (quando.getUTCMinutes() < 5) await limpar(db, quando);
}

export async function limpar(db, quando = new Date()) {
  const ms = quando.getTime();
  await db.batch([
    db.prepare('DELETE FROM enviados WHERE quando < ?1').bind(new Date(ms - 4 * 86400000).toISOString()),
    db.prepare('DELETE FROM sessoes WHERE expira < ?1').bind(quando.toISOString()),
    db.prepare('DELETE FROM recuperacoes WHERE expira < ?1').bind(quando.toISOString()),
    db.prepare('DELETE FROM limites WHERE inicio < ?1').bind(Math.floor(ms / 1000) - 86400),
    // Apagados ficam 90 dias para os outros aparelhos ficarem sabendo
    db.prepare('DELETE FROM eventos WHERE apagado = 1 AND atualizado < ?1').bind(new Date(ms - 90 * 86400000).toISOString())
  ]);
}
