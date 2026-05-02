-- =============================================================
--  CHECKLIST DIÁRIO — Schema PostgreSQL
--  Stack: Next.js + PostgreSQL (VPS próprio)
--  Versão: 1.0
-- =============================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- TABELA: users
-- Armazena os dados de autenticação e perfil de cada usuário
-- =============================================================
CREATE TABLE users (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT          NOT NULL,
  email         TEXT          NOT NULL UNIQUE,
  password_hash TEXT          NOT NULL,           -- bcrypt hash
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- =============================================================
-- TABELA: sessions
-- Gerencia as sessões ativas dos usuários
-- =============================================================
CREATE TABLE sessions (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,          -- token JWT ou opaco
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT
);

-- =============================================================
-- TABELA: checklists
-- Um registro por dia por usuário (chave: user_id + date)
-- =============================================================
CREATE TABLE checklists (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        DATE        NOT NULL DEFAULT CURRENT_DATE,
  priority    TEXT,                                -- prioridade do dia
  goal_met    TEXT CHECK (goal_met IN ('Sim', 'Parcialmente', 'Não', NULL)),
  difficult   TEXT,                                -- o que dificultou
  improve     TEXT,                                -- o que melhorar amanhã
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Garante apenas 1 checklist por usuário por dia
  UNIQUE (user_id, date)
);

-- =============================================================
-- TABELA: tasks
-- Até 3 tarefas por checklist
-- =============================================================
CREATE TABLE tasks (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id UUID        NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  position     SMALLINT    NOT NULL CHECK (position BETWEEN 1 AND 3),
  text         TEXT        NOT NULL DEFAULT '',
  done         BOOLEAN     NOT NULL DEFAULT FALSE,
  done_at      TIMESTAMPTZ,                        -- quando foi marcada como feita
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (checklist_id, position)
);

-- =============================================================
-- TABELA: tracking_items
-- 3 itens fixos de acompanhamento por checklist
-- =============================================================
CREATE TABLE tracking_items (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id UUID        NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  label        TEXT        NOT NULL,
  done         BOOLEAN     NOT NULL DEFAULT FALSE,
  done_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (checklist_id, label)
);

-- =============================================================
-- TABELA: checklist_history
-- Histórico completo de cada salvamento (snapshot em JSONB)
-- =============================================================
CREATE TABLE checklist_history (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id UUID        NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot     JSONB       NOT NULL,               -- estado completo no momento do save
  saved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_type  TEXT        NOT NULL DEFAULT 'auto' CHECK (change_type IN ('auto', 'manual'))
);

-- =============================================================
-- ÍNDICES — Performance em consultas frequentes
-- =============================================================
CREATE INDEX idx_checklists_user_date   ON checklists (user_id, date DESC);
CREATE INDEX idx_tasks_checklist        ON tasks (checklist_id, position);
CREATE INDEX idx_tracking_checklist     ON tracking_items (checklist_id);
CREATE INDEX idx_history_checklist      ON checklist_history (checklist_id, saved_at DESC);
CREATE INDEX idx_history_user           ON checklist_history (user_id, saved_at DESC);
CREATE INDEX idx_sessions_token         ON sessions (token);
CREATE INDEX idx_sessions_user          ON sessions (user_id);
CREATE INDEX idx_history_snapshot_gin   ON checklist_history USING GIN (snapshot);

-- =============================================================
-- FUNÇÃO: atualiza updated_at automaticamente
-- =============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers de updated_at
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_checklists_updated_at
  BEFORE UPDATE ON checklists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- FUNÇÃO: registra histórico automaticamente ao atualizar checklist
-- =============================================================
CREATE OR REPLACE FUNCTION record_checklist_history()
RETURNS TRIGGER AS $$
DECLARE
  snap JSONB;
BEGIN
  -- Monta snapshot completo do checklist com tarefas e tracking
  SELECT jsonb_build_object(
    'checklist', row_to_json(NEW),
    'tasks', (
      SELECT jsonb_agg(row_to_json(t))
      FROM tasks t WHERE t.checklist_id = NEW.id
    ),
    'tracking', (
      SELECT jsonb_agg(row_to_json(tr))
      FROM tracking_items tr WHERE tr.checklist_id = NEW.id
    )
  ) INTO snap;

  INSERT INTO checklist_history (checklist_id, user_id, snapshot, change_type)
  VALUES (NEW.id, NEW.user_id, snap, 'auto');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_checklist_history
  AFTER UPDATE ON checklists
  FOR EACH ROW EXECUTE FUNCTION record_checklist_history();

-- =============================================================
-- FUNÇÃO: limpa sessões expiradas (rodar via cron diário)
-- =============================================================
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM sessions WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- FUNÇÃO: busca ou cria checklist do dia
-- =============================================================
CREATE OR REPLACE FUNCTION get_or_create_today_checklist(p_user_id UUID)
RETURNS checklists AS $$
DECLARE
  result checklists;
BEGIN
  -- Tenta buscar o checklist de hoje
  SELECT * INTO result FROM checklists
  WHERE user_id = p_user_id AND date = CURRENT_DATE;

  -- Se não existir, cria um novo com as 3 tarefas e 3 tracking items
  IF NOT FOUND THEN
    INSERT INTO checklists (user_id, date)
    VALUES (p_user_id, CURRENT_DATE)
    RETURNING * INTO result;

    -- Cria as 3 tarefas vazias
    INSERT INTO tasks (checklist_id, position, text, done)
    VALUES
      (result.id, 1, '', FALSE),
      (result.id, 2, '', FALSE),
      (result.id, 3, '', FALSE);

    -- Cria os 3 itens de acompanhamento
    INSERT INTO tracking_items (checklist_id, label, done)
    VALUES
      (result.id, 'Iniciei o dia organizado', FALSE),
      (result.id, 'Revisei minhas tarefas', FALSE),
      (result.id, 'Evitei distrações', FALSE);
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql;
