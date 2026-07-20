# ROBOZAP

Worker Node.js CommonJS que consulta o SQL Server a cada 10 segundos, opcionalmente cria uma fila em `tblWhatsAppEnvio` e envia templates de WhatsApp por um endpoint compatível com a PartnerBot.

Cada processo/container deve representar um cliente e ter ambiente, porta, `BASE_PATH`, banco, `config/` e `logs/` próprios. O código, porém, não filtra registros por empresa: `COMPANY_NAME` é apenas exibido no log e `MessageRepository.getCompanyName()` sempre retorna `null`.

## Estado atual

- Runtime principal: `src/index.js`.
- Acesso ao banco: `src/repositories/messageRepository.js`.
- Payload e telefone: `src/utils/formatters.js`.
- Integração HTTP: `src/services/partnerBotService.js`.
- Configuração persistente: `src/config/runtimeConfig.js`.
- Painel server-side: `src/admin/panel.js` (não existe build de frontend).
- Node.js mínimo: 18.
- Não existem scripts de lint, teste ou typecheck; a validação disponível é operacional/manual.

## Funcionalidades

- Produção opcional da fila a partir de `dbo.vwAgenda`.
- Envio de mensagem de novo agendamento.
- Envio de confirmação/lembrete para consultas de hoje e amanhã.
- Fallback: se o template de confirmação estiver vazio, usa o template de novo agendamento.
- Revalidação do paciente, profissional, telefone, horário e bloqueio imediatamente antes do envio.
- Consulta opcional de ticket aberto para definir `isClosed` dinamicamente.
- Modo de teste por trecho do nome do paciente.
- Pausa, configuração, fila, histórico e rollback pelo painel administrativo.
- Sincronização opcional de `tblAgenda.bolWhatsAppEnviado`.
- Logs em `logs/app.log` e `logs/error.log`.

## Fluxo executado

O worker agenda um ciclo a cada 10 segundos. Não há execução imediata na inicialização.

1. Lê `runtime-config.json` e atualiza URL/token da integração.
2. Interrompe o ciclo se estiver pausado.
3. Interrompe o ciclo fora do horário comercial, calculado em `America/Sao_Paulo`.
4. Conecta ao SQL Server.
5. Se habilitado, produz até `queueProducerLimit` registros em `tblWhatsAppEnvio`.
6. Se `outboundSendStartDate` ainda não chegou, mantém a fila, mas não envia.
7. Envia até 20 novos agendamentos cuja consulta ocorre depois de amanhã.
8. Envia até 20 confirmações/lembretes de consultas de hoje ou amanhã.
9. Aguarda `sendIntervalSeconds` entre mensagens de cada fila.

Antes de cada POST, o worker consulta novamente a agenda. Um item é ignorado se o slot sumiu, ficou duplicado/bloqueado, o paciente ou profissional mudou, o compromisso mudou, saiu do filtro de teste ou já passou quando essa proteção está habilitada. Se apenas o telefone mudou, a fila é atualizada com o telefone atual.

Após sucesso:

- novo agendamento: define `bolEnviado = 'S'`;
- confirmação: define `bolConfirma = 'S'` e `bolEnviado = 'S'`;
- opcionalmente: define `tblAgenda.bolWhatsAppEnviado = 'S'`.

Após erro de envio, define `bolMensagemErro = 1`. Todas as escritas executam antes `SET CONTEXT_INFO 0x123456`; não remova esse marcador sem validar os triggers do banco.

## Regras SQL de seleção

| Fluxo | Janela e condições principais |
| --- | --- |
| Produtor | Agenda entre hoje e `queueProducerLookaheadDays`, paciente e telefone válidos, slot não bloqueado e sem item equivalente na fila. |
| Novo agendamento | `strTipo` igual a `AgendaInicio`/`agendainicio`, não enviado, sem erro e data posterior a amanhã. |
| Confirmação | Não confirmada, sem erro e data entre hoje e amanhã. A consulta elimina duplicidades e itens já confirmados equivalentes. |

O modo de teste acrescenta um `LIKE %filtro%` ao nome. `messagingStartDate` limita a data mínima consultada. `skipPastAppointmentTime` afeta confirmação e revalidação; novos agendamentos já são sempre futuros.

## Configuração e precedência

Crie o `.env` da raiz a partir de `.env.example`.

As fontes são aplicadas assim:

1. variáveis de processo/container;
2. `.env` da raiz, sem sobrescrever variáveis já existentes;
3. valores operacionais persistidos em `RUNTIME_CONFIG_PATH`, com prioridade sobre os defaults do ambiente.

`npm start` sempre carrega `.env` da raiz. Arquivos como `.env.imagemcor` só são usados se forem copiados para `.env` ou declarados em `env_file` no Compose/container.

### Variáveis estáticas

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP. |
| `BASE_PATH` | vazio | Prefixo de todas as rotas administrativas; exemplo: `/imagemcor`. |
| `INSTANCE_ID` | vazio | Identificador gravado nos metadados de auditoria. |
| `RUNTIME_CONFIG_PATH` | `config/runtime-config.json` | JSON persistido pelo painel. |
| `ADMIN_USER` | `admin` | Usuário do painel. |
| `ADMIN_PASSWORD` | vazio | Obrigatório; painel/API retornam 503 sem ele. |
| `ADMIN_SESSION_SECRET` | senha admin | Segredo HMAC da sessão; use um valor independente. |
| `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | sem padrão | Conexão SQL Server. |
| `DB_REQUEST_TIMEOUT` | `60000` | Timeout das consultas, em ms. |
| `URL` | vazio | URL inicial de envio. |
| `SHOWTICKET_URL` | derivada de `URL` | URL da consulta de ticket. A derivação só troca o sufixo `/template` por `/showticket`. |
| `AUTH_TOKEN` | vazio | Valor integral do header `Authorization`. |

`CLIENT_NAME`, `CLIENT_CODE`, `TEMPLATE_NEW_SCHEDULE` e `TEMPLATE_REMINDER` não são lidas do ambiente pelo runtime atual. Cliente e templates devem ser configurados no painel/JSON persistido.

### Defaults operacionais

Todos podem ser sobrescritos pelo painel e persistidos como nomes camelCase no JSON.

| Variável de ambiente | Campo persistido | Padrão |
| --- | --- | --- |
| `WORKER_PAUSED` | `paused` | `true` |
| — | `clientName`, `clientCode` | vazio |
| — | `templateNewSchedule`, `templateReminder` | vazio |
| — | `partnerbotUrl`, `showticketUrl`, `partnerbotAuthToken` | defaults de `URL`, `SHOWTICKET_URL`, `AUTH_TOKEN` |
| `USE_TICKET_OPEN_FOR_IS_CLOSED` | `useTicketOpenForIsClosed` | `false` |
| `NORMALIZE_BRAZIL_MOBILE_NINTH_DIGIT` | `normalizeBrazilMobileNinthDigit` | `true` |
| `PARTNERBOT_IS_CLOSED` | `partnerbotIsClosed` | `false` |
| `PARTNERBOT_INCLUDE_PROCEDURE` | `includeProcedure` | `false` |
| `PARTNERBOT_INCLUDE_COMPANY` | `includeCompany` | `false` |
| `PARTNERBOT_INCLUDE_UNIT` | `includeUnit` | `false` |
| `PARTNERBOT_INCLUDE_CONFIRMATION_BUTTON` | `includeConfirmationButton` | `false` |
| `DEFAULT_UNIT_ADDRESS` | `defaultUnitAddress` | vazio |
| `FORMAT_TURN_SCHEDULE` | `formatTurnSchedule` | `false` |
| `USE_AGENDA_UNIT_ADDRESS` | `useAgendaUnitAddress` | `false` |
| `BUSINESS_HOURS_START` | `businessHoursStart` | `8` |
| `BUSINESS_HOURS_END` | `businessHoursEnd` | `17` |
| `QUEUE_PRODUCER_ENABLED` | `queueProducerEnabled` | `false` |
| `QUEUE_PRODUCER_LOOKAHEAD_DAYS` | `queueProducerLookaheadDays` | `7` |
| `QUEUE_PRODUCER_LIMIT` | `queueProducerLimit` | `50` |
| `SEND_INTERVAL_SECONDS` | `sendIntervalSeconds` | `10` |
| `TEST_MODE_ENABLED` | `testModeEnabled` | `true` |
| `TEST_PATIENT_NAME_FILTER` | `testPatientNameFilter` | `TESTE` |
| `SYNC_AGENDA_WHATSAPP_STATUS` | `syncAgendaWhatsappStatus` | `false` |
| `MESSAGING_START_DATE` | `messagingStartDate` | vazio |
| `SKIP_PAST_APPOINTMENT_TIME` | `skipPastAppointmentTime` | `false` |
| `OUTBOUND_SEND_START_DATE` | `outboundSendStartDate` | vazio |

Quando `runtime-config.json` ainda não existe, o worker começa pausado, em modo de teste, sem cliente e sem templates. Faça a configuração inicial pelo painel antes de retomar.

## Payload de template

O POST usa `Content-Type: application/json`, header `Authorization` e o formato:

```json
{
  "number": "55DDDNUMERO",
  "isClosed": false,
  "templateData": {
    "messaging_product": "whatsapp",
    "to": "55DDDNUMERO",
    "type": "template",
    "template": {
      "name": "nome_do_template",
      "language": { "code": "pt_BR" },
      "components": [
        { "type": "body", "parameters": [] }
      ]
    }
  }
}
```

Os parâmetros do corpo são posicionais:

1. paciente;
2. data;
3. horário;
4. profissional;
5. procedimento/especialidade, se `includeProcedure=true`;
6. empresa, se `includeCompany=true`;
7. unidade/endereço, se `includeUnit=true`.

Na confirmação, `includeConfirmationButton=true` acrescenta um componente `button` de URL com o token produzido por `dbo.fncBase64_Encode`. A quantidade e a ordem precisam coincidir com o template aprovado no WhatsApp.

Com `normalizeBrazilMobileNinthDigit=true`, celulares brasileiros no formato `55 + DDD + 9 dígitos`, com `9` após o DDD, perdem esse nono dígito antes do envio.

## Painel administrativo

Sem `BASE_PATH`: `http://localhost:3000/admin`.

Com `BASE_PATH=/imagemcor`: `http://localhost:3001/imagemcor/admin`.

A sessão usa cookie HMAC, `HttpOnly`, `SameSite=Lax` e expira em 8 horas. Todas as rotas `/admin` e `/api/admin/*` exigem autenticação.

| Método e rota | Finalidade |
| --- | --- |
| `GET /api/admin/status` | Estado do ciclo e eventos recentes. |
| `GET /api/admin/config` | Configuração em sete seções e metadados. |
| `POST /api/admin/config/validate/:section` | Validação sem persistência. |
| `PUT /api/admin/config/:section` | Atualização auditada da seção. |
| `PUT /api/admin/config` | Atualização flat legada. |
| `GET /api/admin/queue` | Até 100 itens de cada categoria pendente; timeout de 25 s. |
| `POST /api/admin/pause` | Pausa o worker. |
| `POST /api/admin/resume` | Retoma o worker. |
| `GET /api/admin/config/history?limit=&offset=` | Histórico paginado, mais recente primeiro. |
| `POST /api/admin/config/revert/last` | Reverte o último evento registrado. |

Os arquivos persistentes e gitignored são:

- `runtime-config.json`: configuração flat;
- `runtime-config.history.jsonl`: trilha de alterações;
- `runtime-config.meta.json`: versão e identificação da instância.

## Banco de dados

O contrato completo e compartilhável está em [docs/BANCO_DE_DADOS.md](docs/BANCO_DE_DADOS.md). Ele contém todos os objetos e todas as colunas exigidas por leitura, filtro, join, deduplicação, produção da fila, envio e atualização de status.

Resumo dos objetos:

- `dbo.tblWhatsAppEnvio` — fila e estado do envio;
- `dbo.vwAgenda` — origem consolidada dos dados da agenda;
- `dbo.tblAgenda` — unidade e sincronização opcional do status;
- `dbo.tblEmpresa` — nome da empresa/unidade;
- `dbo.fncBase64_Encode` — token do botão de confirmação.

O usuário SQL precisa de `SELECT` nos quatro objetos de dados e na função, `INSERT`/`UPDATE` em `tblWhatsAppEnvio` e, se a sincronização estiver habilitada, `UPDATE` em `tblAgenda`.

## Execução local

```bash
npm install
npm start
```

Desenvolvimento com reinício automático:

```bash
npm run dev
```

## Docker e múltiplos clientes

```bash
docker compose up -d --build
```

O Compose incluído possui apenas o serviço genérico `app`, usa `.env` e monta `./config` e `./logs`. Para múltiplos clientes, duplique o serviço e use, para cada um:

- `env_file` diferente;
- `PORT` e `BASE_PATH` diferentes;
- diretórios diferentes para `/usr/src/app/config` e `/usr/src/app/logs`.

Nunca compartilhe `config/runtime-config.json` entre clientes: ele sobrescreve URL, token, cliente, templates e regras vindas do ambiente.

O exemplo de proxy reverso está em `deploy/nginx/worker.partnerbot.com.br.conf`.

## Checklist de implantação segura

1. Configure credenciais, porta, `BASE_PATH` e volumes isolados.
2. Inicie pausado e com `testModeEnabled=true`.
3. Configure cliente, templates, integração e parâmetros do payload no painel.
4. Confirme que o template aprovado possui a mesma quantidade e ordem de parâmetros.
5. Valide a fila e um paciente contendo o filtro de teste.
6. Verifique a resposta da integração e os logs.
7. Só então desative o modo de teste e retome os disparos.

Não use apenas uma resposta HTTP do webhook como prova de entrega: ela pode confirmar somente que o workflow foi iniciado. Verifique também a execução do integrador e o status final na PartnerBot/WhatsApp.
