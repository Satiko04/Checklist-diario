# Checklist Diário — Setup no VPS com PostgreSQL + Next.js

## Stack
- **Frontend + Backend:** Next.js 14 (App Router)
- **Banco de dados:** PostgreSQL 15+
- **Autenticação:** JWT via cookie httpOnly
- **Servidor:** VPS com Ubuntu 22.04

---

## 1. Configurar o PostgreSQL no VPS

```bash
# Instalar PostgreSQL
sudo apt update
sudo apt install -y postgresql postgresql-contrib

# Criar banco e usuário
sudo -u postgres psql <<EOF
CREATE USER checklist_user WITH PASSWORD 'sua_senha_aqui';
CREATE DATABASE checklist_db OWNER checklist_user;
GRANT ALL PRIVILEGES ON DATABASE checklist_db TO checklist_user;
EOF

# Rodar o schema
psql -U checklist_user -d checklist_db -f sql/schema.sql
```

---

## 2. Instalar dependências do projeto

```bash
npm install
npm install pg bcryptjs jose
npm install -D @types/pg @types/bcryptjs
```

---

## 3. Configurar variáveis de ambiente

```bash
cp .env.example .env.local
# Edite .env.local com seus dados reais

# Gerar JWT_SECRET seguro:
openssl rand -base64 64
```

---

## 4. Rodar em desenvolvimento

```bash
npm run dev
```

---

## 5. Deploy em produção no VPS

```bash
# Build
npm run build

# Rodar com PM2 (gerenciador de processos)
npm install -g pm2
pm2 start npm --name "checklist" -- start
pm2 save
pm2 startup
```

---

## 6. Cron para limpar sessões expiradas

```bash
# Adicionar ao crontab (roda todo dia às 3h)
crontab -e

# Adicionar linha:
0 3 * * * psql -U checklist_user -d checklist_db -c "SELECT cleanup_expired_sessions();"
```

---

## Estrutura de arquivos

```
checklist-app/
├── sql/
│   └── schema.sql              ← Schema completo do banco
├── src/
│   ├── lib/
│   │   ├── db.ts               ← Pool de conexão PostgreSQL
│   │   └── auth.ts             ← JWT, bcrypt, sessão
│   └── app/
│       └── api/
│           ├── auth/
│           │   └── route.ts    ← POST register / login / logout
│           ├── checklist/
│           │   └── route.ts    ← GET e PUT do checklist do dia
│           └── history/
│               └── route.ts    ← GET e DELETE do histórico
├── .env.example
└── README.md
```

---

## Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/auth?action=register` | Cria conta |
| POST | `/api/auth?action=login` | Login |
| POST | `/api/auth?action=logout` | Logout |
| GET | `/api/checklist` | Busca checklist do dia |
| PUT | `/api/checklist` | Salva alterações |
| GET | `/api/history?limit=20` | Lista histórico |
| DELETE | `/api/history?id=<uuid>` | Apaga entrada do histórico |

---

## Tabelas do banco

| Tabela | Descrição |
|--------|-----------|
| `users` | Cadastro e autenticação |
| `sessions` | Sessões ativas |
| `checklists` | Um registro por usuário por dia |
| `tasks` | Até 3 tarefas por checklist |
| `tracking_items` | 3 itens de acompanhamento |
| `checklist_history` | Histórico completo de cada salvamento (JSONB) |
