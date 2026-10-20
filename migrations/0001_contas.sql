-- Agenda com contas: cada pessoa vê só a própria agenda.

CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  senha_sal TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  fuso TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  config TEXT NOT NULL DEFAULT '{}',
  whats_ativo INTEGER NOT NULL DEFAULT 0,
  ultimo_envio TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0,   -- contador de versões, para sincronizar só o que mudou
  criado TEXT NOT NULL
);

-- Um login por aparelho. Guardamos só o hash do token.
CREATE TABLE sessoes (
  token_hash TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criado TEXT NOT NULL,
  expira TEXT NOT NULL
);
CREATE INDEX sessoes_usuario ON sessoes(usuario_id);

-- Compromissos. `dados` é o compromisso inteiro em JSON (formato de app/datas.js).
CREATE TABLE eventos (
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  dados TEXT NOT NULL,
  atualizado TEXT NOT NULL,
  apagado INTEGER NOT NULL DEFAULT 0,
  ultimo_dia TEXT NOT NULL DEFAULT '',  -- último dia em que acontece ('' = sem fim)
  seq INTEGER NOT NULL,
  PRIMARY KEY (usuario_id, id)
);
CREATE INDEX eventos_seq ON eventos(usuario_id, seq);

-- Avisos já mandados, para não repetir.
CREATE TABLE enviados (
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  chave TEXT NOT NULL,
  quando TEXT NOT NULL,
  situacao TEXT NOT NULL,
  PRIMARY KEY (usuario_id, chave)
);
CREATE INDEX enviados_quando ON enviados(quando);

-- Código de "esqueci a senha" mandado pelo WhatsApp.
CREATE TABLE recuperacoes (
  usuario_id TEXT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  codigo_hash TEXT NOT NULL,
  expira TEXT NOT NULL,
  tentativas INTEGER NOT NULL DEFAULT 0
);

-- Limite de tentativas (login, cadastro, recuperação).
CREATE TABLE limites (
  chave TEXT PRIMARY KEY,
  contagem INTEGER NOT NULL,
  inicio INTEGER NOT NULL
);
