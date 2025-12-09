# ROBOZAP - Worker de Integração WhatsApp/SQL Server

Worker modular em Node.js responsável por ler dados de agendamento de um banco de dados SQL Server e enviar mensagens de WhatsApp através da API PartnerBot.

O sistema foi projetado para operar em **múltiplos containers**, permitindo que você atenda várias empresas simultaneamente ("One Container, One Database"), garantindo isolamento e escalabilidade.

## 🚀 Funcionalidades

- **Envio de Boas-vindas**: Processa novos agendamentos criados no dia e envia confirmação.
- **Confirmação de Agenda**: Envia lembretes automáticos 1 dia antes do agendamento.
- **Logging Estruturado**: Logs coloridos no console e arquivos JSON (`logs/app.log`, `logs/error.log`) para fácil monitoramento.
- **Multi-Tenant via Docker**: Suporte nativo a múltiplos containers rodando em paralelo, cada um conectado a um banco de dados distinto.

## 🛠️ Configuração

O worker é configurado inteiramente via variáveis de ambiente.

### Variáveis Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `PORT` | Porta do servidor de Health Check | `3000` |
| `COMPANY_NAME` | Nome da empresa (para identificação nos logs) | `Minha Clinica` |
| `DB_SERVER` | Endereço do Servidor SQL | `192.168.1.100` |
| `DB_NAME` | Nome do Banco de Dados | `db_clinica` |
| `DB_USER` | Usuário do Banco | `sa` |
| `DB_PASSWORD` | Senha do Banco | `senha123` |
| `URL` | Endpoint da API PartnerBot | `https://api.partnerbot...` |
| `AUTH_TOKEN` | Token da API PartnerBot | `seu_token_aqui` |
| `TEMPLATE_NEW_SCHEDULE` | Nome do template de novos agendamentos | `novoagendamento_2` |
| `TEMPLATE_REMINDER` | Nome do template de lembretes | `templatelembretev2` |

## 🐳 Como Rodar (Docker)

A estratégia recomendada é rodar um container separado para cada empresa que você atende.

### 1. Construir a Imagem
```bash
docker build -t robozap-worker .
```

### 2. Criar Arquivos de Configuração
Crie um arquivo `.env` para cada cliente (ex: `.env.clienteA`, `.env.clienteB`) preenchendo as variáveis listadas acima com os dados específicos daquele cliente.

### 3. Iniciar os Containers
Rode o comando abaixo para levantar os workers:

```bash
# Worker para o Cliente A
docker run -d \
  --name worker-cliente-a \
  --env-file .env.clienteA \
  --restart always \
  robozap-worker

# Worker para o Cliente B
docker run -d \
  --name worker-cliente-b \
  --env-file .env.clienteB \
  --restart always \
  robozap-worker
```

## 📝 Logs

O sistema gera logs no diretório `/usr/src/app/logs` dentro do container.

- **Console**: Logs formatados e coloridos (visíveis via `docker logs worker-cliente-a`).
- **Arquivo**: Logs em formato JSON para integração com sistemas de monitoramento.

## 📦 Desenvolvimento

Para rodar localmente:
1. `npm install`
2. Crie um arquivo `.env` na raiz.
3. `npm start` ou `npm run dev` (com nodemon).

---

# ROBOZAP - WhatsApp/SQL Server Integration Worker

Modular Node.js worker responsible for reading appointment data from a SQL Server database and sending WhatsApp messages via the PartnerBot API.

The system was designed to operate in **multiple containers**, allowing you to serve multiple companies simultaneously ("One Container, One Database"), ensuring isolation and scalability.

## 🚀 Features

- **Welcome Message**: Processes new appointments created during the day and sends confirmation.
- **Agenda Confirmation**: Automatically sends reminders 1 day before the appointment.
- **Structured Logging**: Colored logs in the console and JSON files (`logs/app.log`, `logs/error.log`) for easy monitoring.
- **Multi-Tenant via Docker**: Native support for multiple containers running in parallel, each connected to a distinct database.

## 🛠️ Configuration

The worker is fully configured via environment variables.

### Required Variables

| Variable | Description | Example |
|----------|-----------|---------|
| `PORT` | Health Check server port | `3000` |
| `COMPANY_NAME` | Company name (for log identification) | `My Clinic` |
| `DB_SERVER` | SQL Server Address | `192.168.1.100` |
| `DB_NAME` | Database Name | `db_clinic` |
| `DB_USER` | Database User | `sa` |
| `DB_PASSWORD` | Database Password | `password123` |
| `URL` | PartnerBot API Endpoint | `https://api.partnerbot...` |
| `AUTH_TOKEN` | PartnerBot API Token | `your_token_here` |
| `TEMPLATE_NEW_SCHEDULE` | New appointment template name | `novoagendamento_2` |
| `TEMPLATE_REMINDER` | Reminder template name | `templatelembretev2` |

## 🐳 How to Run (Docker)

The recommended strategy is to run a separate container for each company you serve.

### 1. Build the Image
```bash
docker build -t robozap-worker .
```

### 2. Create Configuration Files
Create a `.env` file for each client (e.g., `.env.clientA`, `.env.clientB`) filling in the variables listed above with that client's specific data.

### 3. Start the Containers
Run the command below to start the workers:

```bash
# Worker for Client A
docker run -d \
  --name worker-client-a \
  --env-file .env.clientA \
  --restart always \
  robozap-worker

# Worker for Client B
docker run -d \
  --name worker-client-b \
  --env-file .env.clientB \
  --restart always \
  robozap-worker
```

## 📝 Logs

The system generates logs in the `/usr/src/app/logs` directory inside the container.

- **Console**: Formatted and colored logs (visible via `docker logs worker-client-a`).
- **File**: Logs in JSON format for integration with monitoring systems.

## 📦 Development

To run locally:
1. `npm install`
2. Create a `.env` file in the root.
3. `npm start` or `npm run dev` (with nodemon).
