// Configuração de avisos de cada pessoa (fica em usuarios.config, em JSON).
import D from '../publico/app/datas.js';

export const AVISO_PADRAO = [1440, 60];

export function lerConfig(texto) {
  let c = {};
  try {
    c = (typeof texto === 'string' ? JSON.parse(texto || '{}') : texto) || {};
  } catch (e) {
    c = {};
  }
  const w = c.whatsapp || {}, s = c.resumo || {};
  const horaResumo = parseInt(s.hora, 10);
  return {
    whatsapp: { numero: String(w.numero || ''), chave: String(w.chave || '') },
    resumo: { ativo: !!s.ativo, hora: horaResumo >= 0 && horaResumo <= 23 ? horaResumo : 7 },
    avisoPadrao: Array.isArray(c.avisoPadrao) ? D.normalizar({ avisos: c.avisoPadrao }).avisos : AVISO_PADRAO.slice(),
    horaDiaInteiro: D.ehHora(c.horaDiaInteiro) ? c.horaDiaInteiro : '09:00'
  };
}

export const temWhats = (cfg) => !!(cfg.whatsapp.numero && cfg.whatsapp.chave);

// "11 91234-5678" → "5511912345678" (só DDD + número: é do Brasil)
export function numeroWhats(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}

// Junta o que o app mandou com o que já estava salvo
export function mesclarConfig(atual, nova) {
  const w = nova.whatsapp || {}, s = nova.resumo || {};
  const numero = w.numero == null ? atual.whatsapp.numero : numeroWhats(w.numero);
  let chave = String(w.chave == null ? '' : w.chave).trim();
  // O app recebe a chave mascarada; vazio ou mascarada = manter a que já está salva
  if (!chave || /^•/.test(chave)) chave = atual.whatsapp.chave;
  if (w.apagarChave || !numero) chave = '';
  const hora = s.hora == null ? atual.resumo.hora : parseInt(s.hora, 10);
  return lerConfig({
    whatsapp: { numero, chave: chave.slice(0, 64) },
    resumo: { ativo: s.ativo == null ? atual.resumo.ativo : !!s.ativo, hora },
    avisoPadrao: Array.isArray(nova.avisoPadrao) ? nova.avisoPadrao : atual.avisoPadrao,
    horaDiaInteiro: D.ehHora(nova.horaDiaInteiro) ? nova.horaDiaInteiro : atual.horaDiaInteiro
  });
}

// Nunca devolve a chave do WhatsApp inteira para o app
export function configPublica(cfg) {
  const chave = cfg.whatsapp.chave;
  return {
    whatsapp: { numero: cfg.whatsapp.numero, chave: chave ? '••••' + chave.slice(-3) : '' },
    resumo: cfg.resumo,
    avisoPadrao: cfg.avisoPadrao,
    horaDiaInteiro: cfg.horaDiaInteiro
  };
}
