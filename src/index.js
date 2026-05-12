const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const database = require('./config/database');
const MessageRepository = require('./repositories/messageRepository');
const PartnerBotService = require('./services/partnerBotService');
const formatters = require('./utils/formatters');
const logger = require('./utils/logger');
const runtimeConfig = require('./config/runtimeConfig');
const { requireAdmin, handleLogin, handleLogout, renderLoginPage, renderAdminPage } = require('./admin/panel');

// ==========================================
// 1. CONFIGURACAO
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const PARTNERBOT_URL = process.env.URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const COMPANY_NAME = process.env.COMPANY_NAME || null;
const INTERVALO_CHECK = 10000;

if (COMPANY_NAME) {
    logger.info(`Worker configurado para a empresa: ${COMPANY_NAME}`);
} else {
    logger.info('Worker rodando para TODAS as empresas (Modo Global)');
}

const botService = new PartnerBotService(PARTNERBOT_URL, AUTH_TOKEN);

let isProcessing = false;
let ultimoLogForaHorario = 0;
let ultimoLogPausado = 0;
const workerState = {
    lastCycleAt: null,
    lastCycleResult: 'Aguardando primeiro ciclo',
    lastQueueProducedCount: 0
};

// ==========================================
// 2. SERVIDOR WEB
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => res.send('O Robo do WhatsApp esta rodando.'));

app.get('/admin/login', (req, res) => {
    res.type('html').send(renderLoginPage());
});
app.post('/admin/login', handleLogin);
app.get('/admin/logout', handleLogout);
app.get('/admin', requireAdmin, (req, res) => {
    res.type('html').send(renderAdminPage());
});

app.get('/api/admin/status', requireAdmin, (req, res) => {
    res.json({
        isProcessing,
        lastCycleAt: workerState.lastCycleAt,
        lastCycleResult: workerState.lastCycleResult,
        lastQueueProducedCount: workerState.lastQueueProducedCount,
        configPath: runtimeConfig.configPath,
        config: runtimeConfig.getConfig()
    });
});

app.get('/api/admin/queue', requireAdmin, async (req, res) => {
    let pool;
    try {
        const config = runtimeConfig.getConfig();
        pool = await database.connect();
        const repository = new MessageRepository(pool);
        const queue = await repository.listarFilaPendente(config);
        res.json({ queue });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (pool) pool.close();
    }
});

app.post('/api/admin/pause', requireAdmin, (req, res) => {
    const config = runtimeConfig.updateConfig({ paused: true });
    workerState.lastCycleResult = 'Pausado pelo painel';
    logger.info('Worker pausado pelo painel administrativo');
    res.json({ config });
});

app.post('/api/admin/resume', requireAdmin, (req, res) => {
    const config = runtimeConfig.updateConfig({ paused: false });
    workerState.lastCycleResult = 'Retomado pelo painel';
    logger.info('Worker retomado pelo painel administrativo');
    res.json({ config });
});

app.put('/api/admin/config', requireAdmin, (req, res) => {
    const config = runtimeConfig.updateConfig(req.body || {});
    res.json({ config });
});

app.listen(PORT, () => logger.info(`Servidor Web monitorando na porta ${PORT}`));

function montarDadosFormatados(msg) {
    return {
        p_agenda: formatters.limparTexto(msg.strAgenda),
        p_data: formatters.limparTexto(msg.datagenda),
        p_hora: formatters.limparTexto(msg.strHora),
        p_profissional: formatters.limparTexto(msg.strProfissional),
        p_empresa: formatters.limparTexto(msg.strEmpresa),
        p_unidade: formatters.limparTexto(`${msg.strEndereco || ''}, ${msg.strNumero || 'S/N'} - ${msg.strBairro || ''} - ${msg.strEstado || ''}`)
    };
}

function estaForaDoHorario(agora, config) {
    const options = { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false };
    const horaStr = new Intl.DateTimeFormat('en-US', options).format(agora);
    const hora = parseInt(horaStr, 10);

    return hora < config.businessHoursStart || hora >= config.businessHoursEnd;
}

function envioAindaNaoLiberado(agora, config) {
    if (!config.outboundSendStartDate) return false;

    const hojeBrasil = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(agora);

    return hojeBrasil < config.outboundSendStartDate;
}

// ==========================================
// 3. LOGICA PRINCIPAL
// ==========================================
async function processarFila() {
    const agora = new Date();
    workerState.lastCycleAt = agora.toISOString();

    let config;
    try {
        config = runtimeConfig.getConfig();
    } catch (error) {
        workerState.lastCycleResult = `Erro de configuracao: ${error.message}`;
        logger.error(`Erro de configuracao runtime: ${error.message}`);
        return;
    }

    if (config.paused) {
        if (agora.getTime() - ultimoLogPausado > 60 * 60 * 1000) {
            logger.info('Worker pausado pelo painel administrativo');
            ultimoLogPausado = agora.getTime();
        }
        workerState.lastCycleResult = 'Pausado';
        workerState.lastQueueProducedCount = 0;
        return;
    }

    if (estaForaDoHorario(agora, config)) {
        if (agora.getTime() - ultimoLogForaHorario > 60 * 60 * 1000) {
            logger.info(`Worker em standby: fora do horario comercial (${config.businessHoursStart}h-${config.businessHoursEnd}h Brasil)`);
            ultimoLogForaHorario = agora.getTime();
        }
        workerState.lastCycleResult = 'Fora do horario comercial';
        workerState.lastQueueProducedCount = 0;
        return;
    }

    if (isProcessing) {
        logger.info('Aguardando ciclo anterior terminar...');
        workerState.lastCycleResult = 'Ciclo anterior em andamento';
        return;
    }

    isProcessing = true;

    let pool;
    let totalFilaCriada = 0;
    let totalAgendamentos = 0;
    let totalConfirmacoes = 0;

    try {
        pool = await database.connect();
        const repository = new MessageRepository(pool);

        if (config.queueProducerEnabled) {
            totalFilaCriada = await repository.gerarFilaAgendamentos(config);
            workerState.lastQueueProducedCount = totalFilaCriada;
            logger.info(`Produtor de fila criou ${totalFilaCriada} registro(s).`);
        } else {
            workerState.lastQueueProducedCount = 0;
        }

        if (envioAindaNaoLiberado(agora, config)) {
            workerState.lastCycleResult = `Fila criada: ${totalFilaCriada}. Envios bloqueados ate ${config.outboundSendStartDate}`;
            logger.info(`Envios bloqueados ate ${config.outboundSendStartDate}. Nenhuma mensagem sera enviada neste ciclo.`);
            return;
        }

        const mensagens = await repository.buscarMensagensPendentes(config);
        totalAgendamentos = mensagens.length;

        if (mensagens.length > 0) {
            logger.info(`Encontradas ${mensagens.length} novas mensagens.`);

            for (const msg of mensagens) {
                try {
                    const telefoneFinal = formatters.limparTelefone(msg.strtelefone);

                    if (!telefoneFinal || telefoneFinal.length < 10) {
                        throw new Error(`Numero invalido: '${telefoneFinal}'`);
                    }

                    const dadosFormatados = montarDadosFormatados(msg);
                    const payload = formatters.montarPayloadAgendamento(telefoneFinal, dadosFormatados, config);

                    logger.info(`Enviando Agendamento ID ${msg.intWhatsAppEnvioId}...`);
                    await botService.enviarMensagem(payload);
                    await repository.marcarComoEnviado(msg.intWhatsAppEnvioId, config);
                    logger.info(`Sucesso Agendamento ID: ${msg.intWhatsAppEnvioId}`);
                } catch (error) {
                    logger.error(`Falha Agendamento ID ${msg.intWhatsAppEnvioId}: ${error.message}`);

                    try {
                        await repository.marcarComoErro(msg.intWhatsAppEnvioId);
                    } catch (dbErr) {
                        logger.error(`CRITICO: Falha ao marcar erro no banco: ${dbErr.message}`);
                    }
                }
            }
        }

        const confirmacoes = await repository.buscarConfirmacoesPendentes(config);
        totalConfirmacoes = confirmacoes.length;

        if (confirmacoes.length > 0) {
            logger.info(`Encontrados ${confirmacoes.length} lembretes para enviar.`);

            for (const msg of confirmacoes) {
                try {
                    const telefoneFinal = formatters.limparTelefone(msg.strtelefone);

                    if (!telefoneFinal || telefoneFinal.length < 10) {
                        throw new Error(`Numero invalido: '${telefoneFinal}'`);
                    }

                    const dadosFormatados = montarDadosFormatados(msg);
                    const linkBotao = msg.Link || '-';
                    const payload = formatters.montarPayloadConfirmacao(telefoneFinal, dadosFormatados, linkBotao, config);

                    logger.info(`Enviando Lembrete ID ${msg.intWhatsAppEnvioId}...`);
                    await botService.enviarMensagem(payload);
                    await repository.marcarConfirmacaoComoEnviada(msg.intWhatsAppEnvioId, config);
                    logger.info(`Lembrete enviado ID: ${msg.intWhatsAppEnvioId}`);
                } catch (error) {
                    logger.error(`Falha Lembrete ID ${msg.intWhatsAppEnvioId}: ${error.message}`);

                    try {
                        await repository.marcarComoErro(msg.intWhatsAppEnvioId);
                    } catch (dbErr) {
                        logger.error(`DB Err: ${dbErr.message}`);
                    }
                }
            }
        }

        workerState.lastCycleResult = `Ciclo concluido: ${totalFilaCriada} criados na fila, ${totalAgendamentos} agendamentos, ${totalConfirmacoes} lembretes`;
    } catch (err) {
        logger.error(`Erro Geral no Worker: ${err.message}`);
        workerState.lastCycleResult = `Erro geral: ${err.message}`;
    } finally {
        if (pool) pool.close();
        isProcessing = false;
    }
}

setInterval(processarFila, INTERVALO_CHECK);
logger.info('Worker Modular Iniciado.');
