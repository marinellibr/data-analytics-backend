# Data Analytics Backend

API de ingestão de eventos analíticos enviados pela [data-analytics-lib](https://github.com/marinellibr/data-analytics-lib). Recebe os eventos via POST, valida e persiste no MongoDB (ou em arquivos JSON no desenvolvimento local).

## 🚀 Rotas

Todas as rotas de ingestão aceitam `POST` (gravar) e `GET` (listar):

| Rota | Descrição | Campos obrigatórios |
|------|-----------|---------------------|
| `/events` | Cliques e Page Views | `appID, sessionID, type, location, timestamp` |
| `/http-calls` | Chamadas HTTP | `appID, sessionID, endpoint, method, status, duration, timestamp` |
| `/sessions` | Sessões | `appID, sessionID, context.device, context.browser, context.referrer, startTime` |

**Variações:**
- `/events` com `type: 'click'` → requer `element` (opcional)
- `/events` com `type: 'pageview'` → requer `timeOnPage` (em ms)

### Rota agregada por app

| Rota | Descrição |
|------|-----------|
| `GET /apps/:appID` | Retorna `events`, `httpCalls` e `sessions` daquele `appID` em uma única resposta |

Resposta:
```json
{
  "appID": "creamy-react",
  "events": [ ... ],
  "httpCalls": [ ... ],
  "sessions": [ ... ]
}
```

`GET /hello-world` é um health check simples.

**Respostas:**
- `201` — Evento gravado com sucesso
- `400` — Validação inválida (campos ausentes/incorretos)
- `429` — Rate limit excedido (60 req/min por IP)
- `507` — Limite de registros atingido para a coleção
- `500` — Erro interno do servidor

## 📝 Exemplos de Uso

### POST `/events` - Rastrear Clique

```bash
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d '{
    "appID": "ecommerce-pro",
    "sessionID": "sess-abc123",
    "type": "click",
    "location": "/products/shoes",
    "element": "button.add-to-cart",
    "timestamp": "2026-06-10T14:32:45.123Z"
  }'
```

**Resposta (201):**
```json
{
  "success": true,
  "data": {
    "appID": "ecommerce-pro",
    "sessionID": "sess-abc123",
    "type": "click",
    "location": "/products/shoes",
    "element": "button.add-to-cart",
    "timestamp": "2026-06-10T14:32:45.123Z"
  }
}
```

### POST `/events` - Rastrear Page View

```bash
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d '{
    "appID": "ecommerce-pro",
    "sessionID": "sess-abc123",
    "type": "pageview",
    "location": "/checkout",
    "timeOnPage": 12500,
    "timestamp": "2026-06-10T14:33:12.456Z"
  }'
```

### POST `/http-calls` - Rastrear Chamada HTTP

```bash
curl -X POST http://localhost:3000/http-calls \
  -H "Content-Type: application/json" \
  -d '{
    "appID": "ecommerce-pro",
    "sessionID": "sess-abc123",
    "endpoint": "/api/orders",
    "method": "POST",
    "status": 201,
    "duration": 567,
    "timestamp": "2026-06-10T14:33:20.000Z"
  }'
```

### POST `/sessions` - Inicializar Sessão

```bash
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "appID": "ecommerce-pro",
    "sessionID": "sess-abc123",
    "userID": "user-123",
    "context": {
      "device": "desktop",
      "browser": "Chrome 126.0",
      "referrer": "google.com"
    },
    "startTime": "2026-06-10T14:00:00.000Z"
  }'
```

### GET - Listar Eventos

```bash
curl http://localhost:3000/events
```

Retorna array de todos os eventos gravados.

### GET - Todos os registros de um app

```bash
curl http://localhost:3000/apps/creamy-react
```

Retorna `events`, `httpCalls` e `sessions` filtrados por aquele `appID` em uma única resposta.

## 🔒 Segurança

- **Rate limiting** por IP (`RATE_LIMIT_PER_MINUTE`, default 60/min)
- **Body limitado a 10kb** para prevenir DoS
- **Validação estrita com whitelist de campos**: apenas os campos esperados são gravados — qualquer campo extra (incluindo operadores como `$gt`/`$ne`) é descartado, o que neutraliza tentativas de injeção NoSQL
- **Tipos, enums e formato** validados (ex.: `method`, `device`, timestamps em ISO 8601)
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
