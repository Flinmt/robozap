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
