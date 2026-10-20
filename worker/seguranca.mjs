// Senhas, tokens de login e limite de tentativas.
//
// A senha nunca chega aqui em texto: o app manda o resultado do PBKDF2
// (250 mil rodadas, com o e-mail como sal; veja app/conta.js). Aqui ela ganha
// um sal aleatório por pessoa antes de ir para o banco. Quem roubasse o banco
// ainda teria que fazer as 250 mil rodadas para cada senha que quisesse testar.

const codificador = new TextEncoder();

export function hex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function aleatorio(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return a;
}

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(texto) {
  return hex(await crypto.subtle.digest('SHA-256', codificador.encode(texto)));
}

// Compara sem revelar pelo tempo de resposta onde está a diferença
export function iguais(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

export const novoSal = () => hex(aleatorio(16));
export const hashDaSenha = (sal, senhaDoApp) => sha256(sal + ':' + senhaDoApp);
export const novoToken = () => base64url(aleatorio(32));
export const hashDoToken = (token) => sha256('sessao:' + token);

// Código de 6 dígitos para recuperar a senha
export function novoCodigo() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1000000).padStart(6, '0');
}
export const hashDoCodigo = (usuarioId, codigo) => sha256('codigo:' + usuarioId + ':' + codigo);

// Conta uma tentativa para `chave`. Devolve false quando passou de `max` dentro da janela.
export async function dentroDoLimite(db, chave, max, janelaSeg, agoraMs) {
  const agora = Math.floor(agoraMs / 1000);
  const r = await db.prepare(
    `INSERT INTO limites (chave, contagem, inicio) VALUES (?1, 1, ?2)
     ON CONFLICT (chave) DO UPDATE SET
       contagem = CASE WHEN limites.inicio < ?3 THEN 1 ELSE limites.contagem + 1 END,
       inicio = CASE WHEN limites.inicio < ?3 THEN ?2 ELSE limites.inicio END
     RETURNING contagem`
  ).bind(chave, agora, agora - janelaSeg).first();
  return !r || r.contagem <= max;
}
