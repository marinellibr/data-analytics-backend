# Data Analytics Backend

API de ingestão de eventos analíticos enviados pela [data-analytics-lib](https://github.com/marinellibr/data-analytics-lib). Recebe os eventos via POST, valida e persiste no MongoDB (ou em arquivos JSON no desenvolvimento local).

## 🚀 Rotas

Todas as rotas de ingestão aceitam `POST` (gravar) e `GET` (listar):

| Rota | Descrição | Campos obrigatórios |
|------|-----------|---------------------|
| `/click-events` | Cliques | `appID, sessionID, where, target, dateTime` |
| `/page-load-events` | Carregamentos de página | `appID, sessionID, where, timeOnPage, dateTime` |
| `/http-calls` | Chamadas HTTP | `appID, sessionID, endpoint, method, httpStatus, duration, dateTime` |
| `/sessions` | Sessões | `appID, sessionID, device, browser, referrer, startedAt` |

`GET /hello-world` é um health check simples.

**Respostas:** `201` ao gravar, `400` em validação inválida, `429` ao exceder o rate limit, `507` quando a coleção atinge o limite de registros, `500` em erro interno.

## 🔒 Segurança

- **Rate limiting** por IP (`RATE_LIMIT_PER_MINUTE`, default 60/min)
- **Body limitado a 10kb**
- **Validação estrita com whitelist de campos**: apenas os campos esperados são gravados — qualquer campo extra (incluindo operadores como `$gt`/`$ne`) é descartado, o que neutraliza tentativas de injeção NoSQL
- **Tipos, enums e formato** validados (ex.: `method`, `device`, formato de data)
- **Teto de registros por coleção** (`MAX_RECORDS_PER_FILE`) para evitar exaustão de armazenamento

## ⚙️ Configuração

Veja `.env.example`. Variáveis principais:

- `MONGODB_URI` — string de conexão do MongoDB. **Se ausente, usa armazenamento em JSON** (`data/`), útil para desenvolvimento local.
- `MONGODB_DB` — nome do banco (default `analytics`)
- `PORT`, `RATE_LIMIT_PER_MINUTE`, `MAX_RECORDS_PER_FILE`

## 💻 Desenvolvimento local

```bash
npm install
npm run dev        # sem MONGODB_URI -> grava em data/*.json
```

Com MongoDB:

```bash
MONGODB_URI="mongodb+srv://..." npm run dev
```

## 🏗️ Build e produção

```bash
npm run build      # compila TypeScript -> dist/
npm start          # node dist/index.js
```

## ☁️ Deploy

1. Provisione um cluster no MongoDB Atlas e copie a connection string.
2. Na plataforma de hospedagem, configure as variáveis de ambiente — em especial `MONGODB_URI` **como secret** (nunca no repositório).
3. Build command: `npm install && npm run build` · Start command: `npm start`.
4. Em Atlas, libere o acesso de rede para os IPs da plataforma (ou `0.0.0.0/0` se o cluster for protegido apenas por usuário/senha).
