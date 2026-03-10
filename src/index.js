const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const database = require('./config/database');
const MessageRepository = require('./repositories/messageRepository');
const PartnerBotService = require('./services/partnerBotService');
const formatters = require('./utils/formatters');
const logger = require('./utils/logger');

// ==========================================
// 1. CONFIGURAÇÃO (INSTANCIAMENTO)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const PARTNERBOT_URL = process.env.URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const SHOWTICKET_URL = process.env.SHOWTICKET_URL || (PARTNERBOT_URL ? PARTNERBOT_URL.replace(/\/template$/, '/showticket') : null);
const COMPANY_NAME = process.env.COMPANY_NAME || null;
const INTERVALO_CHECK = 10000;

if (COMPANY_NAME) {
    logger.info(`🏢 Worker configurado para a empresa: ${COMPANY_NAME}`);
} else {
    logger.info(`🌍 Worker rodando para TODAS as empresas (Modo Global)`);
}

// Serviço de envio (Stateful, configurado uma vez)
const botService = new PartnerBotService(PARTNERBOT_URL, AUTH_TOKEN, SHOWTICKET_URL);

// Variável de controle de concorrência
let isProcessing = false;
let ultimoLogForaHorario = 0;

// ==========================================
// 2. SERVIDOR WEB (HEALTH CHECK)
// ==========================================
app.get('/', (req, res) => res.send('O Robô do WhatsApp está rodando! 🤖'));
app.listen(PORT, () => logger.info(`✅ Servidor Web monitorando na porta ${PORT}`));

// ==========================================
// 3. LOGICA PRINCIPAL (WORKER)
// ==========================================
async function processarFila() {
    const agora = new Date();

    // ------------------------------------------------------------------------
    // VERIFICAÇÃO DE HORÁRIO E FUSO
    // ------------------------------------------------------------------------
    // Forçamos o fuso horário 'America/Sao_Paulo' para garantir que o worker obedeça
    // o horário comercial do Brasil, independentemente de onde o servidor esteja (UTC, etc).
    const options = { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false };
    const horaStr = new Intl.DateTimeFormat('en-US', options).format(agora);
    const hora = parseInt(horaStr, 10);

    // Regra de Horário: 08:00 às 17:00
    if (hora < 8 || hora > 17) {
        // Log apenas a cada 1 hora para não spammar
        if (agora.getTime() - ultimoLogForaHorario > 60 * 60 * 1000) {
            logger.info("zzz Worker em Standby: Fora do horário de envio (08h-17h)");
            ultimoLogForaHorario = agora.getTime();
        }
        return;
    }

    // ------------------------------------------------------------------------
    // CONTROLE DE CONCORRÊNCIA (Lock)
    // ------------------------------------------------------------------------
    // Evita que uma nova execução comece se a anterior ainda não terminou.
    // Isso é crucial para não enviar mensagens duplicadas ou sobrecarregar o banco.
    if (isProcessing) {
        logger.info("⏳ Aguardando ciclo anterior terminar...");
        return;
    }
    isProcessing = true;

    let pool;
    try {
        pool = await database.connect();
        const repository = new MessageRepository(pool);

        // ============================================================
        // [ETAPA 1] ENVIO DE NOVOS AGENDAMENTOS (BOAS-VINDAS)
        // ============================================================
        const mensagens = await repository.buscarMensagensPendentes();

        if (mensagens.length > 0) {
            logger.info(`🔍 Encontradas ${mensagens.length} novas mensagens.`);

            for (const msg of mensagens) {
                try {
                    // Validar e Formatar
                    const telefoneFinal = formatters.limparTelefone(msg.strtelefone);

                    if (!telefoneFinal || telefoneFinal.length < 10) {
                        throw new Error(`Número inválido: '${telefoneFinal}'`);
                    }

                    const dadosFormatados = {
                        p_agenda: formatters.limparTexto(msg.strAgenda),
                        p_data: formatters.limparTexto(msg.datagenda),
                        p_hora: formatters.formatarHorario(msg.strHora, msg.bolAtendeHoraMarcada),
                        p_profissional: formatters.limparTexto(msg.strProfissional),
                        p_especialidade: formatters.limparTexto(msg.strEspecialidadeMedica),
                        p_nome_unidade: formatters.limparTexto(msg.nomeUnidade),
                        p_empresa: formatters.limparTexto(msg.strEmpresa),
                        p_unidade: formatters.limparTexto(msg.strunidade)
                    };

                    const ticket = await botService.verificarTicketAberto(telefoneFinal);
                    const isClosed = !ticket.encontrado;
                    logger.info(`[TicketCheck] Agendamento ID ${msg.intWhatsAppEnvioId} numero=${telefoneFinal} ticketAberto=${ticket.encontrado}`);
                    const payload = formatters.montarPayloadAgendamento(telefoneFinal, dadosFormatados, isClosed);

                    logger.info(`📤 Enviando Agendamento ID ${msg.intWhatsAppEnvioId} com isClosed=${isClosed}...`);

                    // Enviar
                    await botService.enviarMensagem(payload);

                    // Atualizar Sucesso
                    await repository.marcarComoEnviado(msg.intWhatsAppEnvioId);
                    logger.info(`✅ Sucesso Agendamento ID: ${msg.intWhatsAppEnvioId}`);

                } catch (error) {
                    logger.error(`❌ Falha Agendamento ID ${msg.intWhatsAppEnvioId}: ${error.message}`);

                    // Atualizar Erro
                    try {
                        await repository.marcarComoErro(msg.intWhatsAppEnvioId);
                    } catch (dbErr) {
                        logger.error(`   -> CRÍTICO: Falha ao marcar erro no banco: ${dbErr.message}`);
                    }
                }
            }
        }

        // ============================================================
        // [ETAPA 2] ENVIO DE LEMBRETES/CONFIRMAÇÃO (DIA ANTERIOR)
        // ============================================================
        const confirmacoes = await repository.buscarConfirmacoesPendentes();

        if (confirmacoes.length > 0) {
            logger.info(`🔔 Encontrados ${confirmacoes.length} lembretes para enviar.`);

            for (const msg of confirmacoes) {
                try {
                    const telefoneFinal = formatters.limparTelefone(msg.strtelefone);

                    if (!telefoneFinal || telefoneFinal.length < 10) {
                        throw new Error(`Número inválido: '${telefoneFinal}'`);
                    }

                    const dadosFormatados = {
                        p_agenda: formatters.limparTexto(msg.strAgenda),
                        p_data: formatters.limparTexto(msg.datagenda),
                        p_hora: formatters.formatarHorario(msg.strHora, msg.bolAtendeHoraMarcada),
                        p_profissional: formatters.limparTexto(msg.strProfissional),
                        p_especialidade: formatters.limparTexto(msg.strEspecialidadeMedica),
                        p_nome_unidade: formatters.limparTexto(msg.nomeUnidade),
                        p_empresa: formatters.limparTexto(msg.strEmpresa),
                        p_unidade: formatters.limparTexto(`${msg.strEndereco || ''}, ${msg.strNumero || 'S/N'} - ${msg.strBairro || ''} - ${msg.strEstado || ''}`)
                    };

                    // Link para o botão (conteúdo da coluna Link)
                    const linkBotao = msg.Link || '-';

                    const ticket = await botService.verificarTicketAberto(telefoneFinal);
                    const isClosed = !ticket.encontrado;
                    logger.info(`[TicketCheck] Lembrete ID ${msg.intWhatsAppEnvioId} numero=${telefoneFinal} ticketAberto=${ticket.encontrado}`);
                    const payload = formatters.montarPayloadConfirmacao(telefoneFinal, dadosFormatados, linkBotao, isClosed);

                    logger.info(`📤 Enviando Lembrete ID ${msg.intWhatsAppEnvioId} com isClosed=${isClosed}...`);

                    await botService.enviarMensagem(payload);

                    await repository.marcarConfirmacaoComoEnviada(msg.intWhatsAppEnvioId);
                    logger.info(`✅ Lembrete enviado ID: ${msg.intWhatsAppEnvioId}`);

                } catch (error) {
                    logger.error(`❌ Falha Lembrete ID ${msg.intWhatsAppEnvioId}: ${error.message}`);
                    try {
                        await repository.marcarComoErro(msg.intWhatsAppEnvioId);
                    } catch (dbErr) {
                        logger.error(`   -> DB Err: ${dbErr.message}`);
                    }
                }
            }
        }

    } catch (err) {
        logger.error(`⚠️ Erro Geral no Worker: ${err.message}`);
    } finally {
        // [IMPORTANTE]:
        // Sempre fechar a conexão com o banco ao final do ciclo.
        // Liberar a flag 'isProcessing' permite que o próximo ciclo (daqui 10s) possa rodar.
        if (pool) pool.close();
        isProcessing = false;
    }
}

// Inicia
setInterval(processarFila, INTERVALO_CHECK);
logger.info("🚀 Worker Modular Iniciado.");
