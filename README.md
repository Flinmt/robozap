# ROBOZAP

Worker Node.js para criar fila de mensagens a partir do SQL Server e enviar templates de WhatsApp pela API PartnerBot.

O projeto foi pensado para operar por cliente: cada container usa seu proprio `.env`, banco, templates e configuracao operacional.

## Funcionalidades

- Envio da mensagem de agendamento realizado.
- Envio da mensagem de confirmacao/lembrete perto da consulta.
- Produtor opcional de fila: cria registros em `tblWhatsAppEnvio` a partir da `vwAgenda`.
- Painel web em `/admin` com login, pausa/retomada, configuracoes operacionais e visualizacao da fila pendente.
- Modo teste para restringir criacao/envio a pacientes com um texto no nome, por padrao `TESTE`.
- Sincronizacao opcional de `tblAgenda.bolWhatsAppEnviado` apos sucesso no envio.
- Logs em `logs/app.log` e `logs/error.log`.

## Fluxo

1. O produtor opcional busca agendamentos elegiveis na `vwAgenda`.
2. Ele cria linhas ausentes em `tblWhatsAppEnvio` com `strTipo = 'agendainicio'`.
3. O worker envia mensagens pendentes da fila.
4. Ao enviar com sucesso, marca `tblWhatsAppEnvio`.
5. Quando habilitado, tambem marca `tblAgenda.bolWhatsAppEnviado = 'S'`.

O produtor nao cria procedure, trigger ou job no banco. A logica fica versionada neste projeto.

## Configuracao

Crie um `.env` a partir de `.env.example`.

Variaveis principais:

| Variavel | Descricao |
| --- | --- |
| `PORT` | Porta do servidor web e painel. |
| `ADMIN_USER` | Usuario do painel `/admin`. |
| `ADMIN_PASSWORD` | Senha do painel `/admin`. |
| `CLIENT_NAME` | Nome do cliente exibido no topo do painel admin. |
| `CLIENT_CODE` | Codigo interno opcional do cliente no painel admin. |
| `RUNTIME_CONFIG_PATH` | Caminho do JSON persistente do painel. |
| `DB_SERVER` | Host do SQL Server. |
| `DB_NAME` | Nome do banco. |
| `DB_USER` | Usuario do banco. |
| `DB_PASSWORD` | Senha do banco. |
| `URL` | Endpoint PartnerBot. |
| `AUTH_TOKEN` | Token PartnerBot, incluindo `Bearer` quando aplicavel. |
| `TEMPLATE_NEW_SCHEDULE` | Template da mensagem de agendamento realizado. |
| `TEMPLATE_REMINDER` | Template da confirmacao/lembrete. |

Configuracoes operacionais:

| Variavel | Padrao | Descricao |
| --- | --- | --- |
| `PARTNERBOT_IS_CLOSED` | `true` | Valor enviado em `isClosed`. |
| `PARTNERBOT_INCLUDE_COMPANY` | `true` | Inclui empresa nos parametros do template. |
| `PARTNERBOT_INCLUDE_UNIT` | `true` | Inclui unidade/endereco nos parametros do template. |
| `PARTNERBOT_INCLUDE_CONFIRMATION_BUTTON` | `true` | Inclui botao de confirmacao no template de lembrete. |
| `BUSINESS_HOURS_START` | `8` | Hora inicial de envio no fuso de Sao Paulo. |
| `BUSINESS_HOURS_END` | `17` | Hora final de envio no fuso de Sao Paulo. |
| `QUEUE_PRODUCER_ENABLED` | `false` | Habilita criacao de fila a partir da agenda. |
| `QUEUE_PRODUCER_LOOKAHEAD_DAYS` | `365` | Quantos dias futuros o produtor deve descobrir. |
| `QUEUE_PRODUCER_LIMIT` | `25` | Maximo de linhas criadas por ciclo. |
| `SEND_INTERVAL_SECONDS` | `10` | Tempo de espera entre envios de mensagens no worker. |
| `TEST_MODE_ENABLED` | `false` | Restringe produtor e envio ao filtro de teste. |
| `TEST_PATIENT_NAME_FILTER` | `TESTE` | Texto usado no modo teste. |
| `SYNC_AGENDA_WHATSAPP_STATUS` | `false` | Marca `tblAgenda.bolWhatsAppEnviado = 'S'` apos envio. |
| `MESSAGING_START_DATE` | vazio | Data minima da consulta para criar fila/enviar, no formato `YYYY-MM-DD`. |
| `SKIP_PAST_APPOINTMENT_TIME` | `false` | Bloqueia confirmacao/lembrete para consulta de hoje cujo horario ja passou. |
| `OUTBOUND_SEND_START_DATE` | vazio | Data de liberacao dos disparos. Antes dela o worker monta fila, mas nao envia mensagens. |

O painel salva alteracoes em `config/runtime-config.json`. Esse arquivo tem prioridade sobre o `.env` para as configuracoes operacionais.

## Painel Admin

Acesse:

```text
http://localhost:PORT/admin
```

No painel e possivel:

- pausar e retomar o worker;
- identificar para qual cliente o painel atual esta configurado;
- alterar templates e flags de payload;
- sobrescrever o token da PartnerBot por cliente (quando necessario);
- ligar/desligar produtor de fila;
- controlar janela e limite do produtor;
- ligar modo teste;
- ver a fila pendente.

## Validacao Rapida de Historico e Rollback

Exemplo em PowerShell (ajuste host/credenciais conforme ambiente):

```powershell
$base = 'http://localhost:3002/hvisao'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# 1) Login no painel
Invoke-WebRequest -Method Post -Uri "$base/admin/login" -WebSession $session -ContentType 'application/x-www-form-urlencoded' -Body 'user=admin&password=admin' | Out-Null

# 2) Altera uma secao (safety)
$body = @{ paused = $true; testModeEnabled = $false; testPatientNameFilter = 'TESTE'; syncAgendaWhatsappStatus = $true } | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "$base/api/admin/config/safety" -WebSession $session -ContentType 'application/json' -Body $body

# 3) Consulta historico
Invoke-RestMethod -Method Get -Uri "$base/api/admin/config/history?limit=5&offset=0" -WebSession $session

# 4) Reverte ultimo evento
Invoke-RestMethod -Method Post -Uri "$base/api/admin/config/revert/last" -WebSession $session
```

Endpoints de auditoria disponiveis:

- `GET /api/admin/config/history?limit=&offset=`
- `POST /api/admin/config/revert/last`

## Modo Teste

Para testar sem enviar mensagens para pacientes reais:

```env
TEST_MODE_ENABLED=true
TEST_PATIENT_NAME_FILTER=TESTE
QUEUE_PRODUCER_LIMIT=5
```

Com isso, o produtor e o envio so usam pacientes cujo nome contenha `TESTE`.

## Implantacao Segura

Para um cliente sem produtor de fila no banco:

1. Configure `.env`.
2. Inicie com:

```env
QUEUE_PRODUCER_ENABLED=true
QUEUE_PRODUCER_LOOKAHEAD_DAYS=365
QUEUE_PRODUCER_LIMIT=5
TEST_MODE_ENABLED=true
MESSAGING_START_DATE=2026-05-09
SKIP_PAST_APPOINTMENT_TIME=true
OUTBOUND_SEND_START_DATE=2026-05-09
```

3. Valide no painel com pacientes de teste.
4. Para producao gradual:

```env
TEST_MODE_ENABLED=false
QUEUE_PRODUCER_LIMIT=25
```

5. Depois de estabilizar, aumente para `50` se necessario.

## Rodar Localmente

```bash
npm install
npm start
```

Ou em desenvolvimento:

```bash
npm run dev
```

## Docker

Build:

```bash
docker build -t robozap-worker .
```

Compose:

```bash
docker compose up -d --build
```

O `docker-compose.yml` monta:

- `./config:/usr/src/app/config`, para persistir `runtime-config.json`;
- `./logs:/usr/src/app/logs`, para persistir logs.

Para multiplos clientes, crie um servico por cliente com seu proprio `.env`, porta, pasta `config` e pasta `logs`.

## Observacoes de Banco

O worker espera as tabelas/views:

- `tblWhatsAppEnvio`
- `vwAgenda`
- `tblAgenda`
- `tblEmpresa`

Para o controle atual, `tblWhatsAppEnvio` deve possuir:

- `bolMensagemErro bit NOT NULL DEFAULT 0`
- `bolConfirma char(1) NOT NULL DEFAULT 'N'`

Quando `SYNC_AGENDA_WHATSAPP_STATUS=true`, o worker atualiza:

```sql
tblAgenda.bolWhatsAppEnviado = 'S'
```
