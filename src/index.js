const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const database = require('./config/database');
const MessageRepository = require('./repositories/messageRepository');
const PartnerBotService = require('./services/partnerBotService');
const formatters = require('./utils/formatters');
const logger = require('./utils/logger');
const runtimeConfig = require('./config/runtimeConfig');
const configSections = require('./config/configSections');
const configMetadata = require('./config/configMetadata');
const configHistory = require('./config/configHistory');
const { requireAdmin, handleLogin, handleLogout, renderLoginPage, renderAdminPage } = require('./admin/panel');

function normalizeBasePath(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === '/') return '';
    const withPrefix = raw.startsWith('/') ? raw : `/${raw}`;
    return withPrefix.replace(/\/+$/, '');
}

function withBasePath(basePath, routePath) {
    if (!basePath) return routePath;
    if (routePath === '/') return basePath;
    return `${basePath}${routePath}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==========================================
// 1. CONFIGURACAO
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '');
const PARTNERBOT_URL = process.env.URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const SHOWTICKET_URL = process.env.SHOWTICKET_URL || (PARTNERBOT_URL ? PARTNERBOT_URL.replace(/\/template$/, '/showticket') : null);
const COMPANY_NAME = process.env.COMPANY_NAME || null;
const INTERVALO_CHECK = 10000;
const SEND_BATCH_LIMIT = 20;

function createRequestId() {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

if (COMPANY_NAME) {
    logger.info(`Worker configurado para a empresa: ${COMPANY_NAME}`);
} else {
    logger.info('Worker rodando para TODAS as empresas (Modo Global)');
}

function isInitialConfigPending(config) {
    return config.paused || !config.clientName || !config.templateNewSchedule;
}

function logInitialConfigWarning() {
    try {
        const config = runtimeConfig.getConfig();
        if (!isInitialConfigPending(config)) return;

        logger.warn('Configuracao inicial pendente. Acesse o painel admin para configurar cliente, templates e formato do payload. Worker iniciado pausado e em modo teste por seguranca.');
    } catch (error) {
        logger.warn(`Configuracao inicial pendente. Falha ao ler runtime config: ${error.message}`);
    }
}

logInitialConfigWarning();

const botService = new PartnerBotService(PARTNERBOT_URL, AUTH_TOKEN, SHOWTICKET_URL);

let isProcessing = false;
let ultimoLogForaHorario = 0;
let ultimoLogPausado = 0;
let ultimoLogTemplateAgendamentoAusente = 0;
let ultimoLogTemplateConfirmacaoAusente = 0;
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

if (BASE_PATH) {
    app.get('/', (req, res) => res.send('O Robo do WhatsApp esta rodando.'));
    app.get(withBasePath(BASE_PATH, '/'), (req, res) => res.redirect(withBasePath(BASE_PATH, '/admin/login')));
} else {
    app.get('/', (req, res) => res.send('O Robo do WhatsApp esta rodando.'));
}

app.get(withBasePath(BASE_PATH, '/admin/login'), (req, res) => {
    res.type('html').send(renderLoginPage(BASE_PATH));
});
app.post(withBasePath(BASE_PATH, '/admin/login'), handleLogin(BASE_PATH));
app.get(withBasePath(BASE_PATH, '/admin/logout'), handleLogout(BASE_PATH));
app.get(withBasePath(BASE_PATH, '/admin'), requireAdmin(BASE_PATH), (req, res) => {
    res.type('html').send(renderAdminPage(BASE_PATH));
});

app.get(withBasePath(BASE_PATH, '/api/admin/status'), requireAdmin(BASE_PATH), (req, res) => {
    res.json({
        isProcessing,
        lastCycleAt: workerState.lastCycleAt,
        lastCycleResult: workerState.lastCycleResult,
        lastQueueProducedCount: workerState.lastQueueProducedCount,
        configPath: runtimeConfig.configPath,
        config: runtimeConfig.getConfig()
    });
});

app.get(withBasePath(BASE_PATH, '/api/admin/config'), requireAdmin(BASE_PATH), (req, res) => {
    const requestId = createRequestId();
    try {
        const flat = runtimeConfig.getConfig();
        const meta = configMetadata.getMeta();
        res.json({
            config: configSections.toSections(flat),
            meta,
            requestId
        });
    } catch (error) {
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Falha interna ao processar configuracao.',
            requestId
        });
    }
});

app.post(withBasePath(BASE_PATH, '/api/admin/config/validate/:section'), requireAdmin(BASE_PATH), (req, res) => {
    const requestId = createRequestId();
    const section = String(req.params.section || '');
    const allowed = ['client', 'templates', 'integration', 'businessHours', 'queueProducer', 'safety', 'payload'];
    if (!allowed.includes(section)) {
        return res.status(404).json({
            error: 'SECTION_NOT_FOUND',
            message: 'Secao de configuracao nao suportada.',
            requestId
        });
    }

    const payload = req.body || {};
    const fieldErrors = configSections.validateSection(section, payload);
    if (fieldErrors.length > 0) {
        return res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'Dados de configuracao invalidos.',
            fieldErrors,
            requestId
        });
    }

    return res.json({ ok: true, section, requestId });
});

app.get(withBasePath(BASE_PATH, '/api/admin/config/history'), requireAdmin(BASE_PATH), (req, res) => {
    const requestId = createRequestId();
    try {
        const limit = req.query?.limit;
        const offset = req.query?.offset;
        const data = configHistory.readHistory({ limit, offset });
        return res.json({ ...data, requestId });
    } catch (error) {
        return res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Falha interna ao carregar historico.',
            requestId
        });
    }
});

app.post(withBasePath(BASE_PATH, '/api/admin/config/revert/last'), requireAdmin(BASE_PATH), (req, res) => {
    const requestId = createRequestId();
    try {
        const historyData = configHistory.readHistory({ limit: 1, offset: 0 });
        if (!historyData.items.length) {
            return res.status(404).json({
                error: 'HISTORY_NOT_FOUND',
                message: 'Nenhum evento de configuracao disponivel para rollback.',
                requestId
            });
        }

        const lastEvent = historyData.items[0];
        const currentFlat = runtimeConfig.getConfig();
        const currentSections = configSections.toSections(currentFlat);

        let nextFlat;
        if (lastEvent.section === 'legacy') {
            const legacyPatch = {};
            Object.keys(lastEvent.changes || {}).forEach((key) => {
                legacyPatch[key] = lastEvent.changes[key]?.from;
            });
            nextFlat = runtimeConfig.updateConfig(legacyPatch);
        } else {
            const section = String(lastEvent.section || '');
            const allowed = ['client', 'templates', 'integration', 'businessHours', 'queueProducer', 'safety', 'payload'];
            if (!allowed.includes(section)) {
                return res.status(400).json({
                    error: 'ROLLBACK_NOT_SUPPORTED',
                    message: 'Nao foi possivel identificar secao valida para rollback.',
                    requestId
                });
            }

            const previousSection = { ...(currentSections[section] || {}) };
            Object.keys(lastEvent.changes || {}).forEach((field) => {
                previousSection[field] = lastEvent.changes[field]?.from;
            });

            const patch = configSections.toFlatPatch(section, previousSection);
            nextFlat = runtimeConfig.updateConfig(patch || {});
        }

        const nextSections = configSections.toSections(nextFlat);
        const rollbackDiff = configHistory.buildDiff(currentSections, nextSections);
        configHistory.appendEvent({
            event: 'CONFIG_ROLLBACK',
            section: lastEvent.section || 'legacy',
            revertedEvent: {
                event: lastEvent.event || 'CONFIG_UPDATED',
                updatedAt: lastEvent.updatedAt || null,
                updatedBy: lastEvent.updatedBy || null,
                requestId: lastEvent.requestId || null
            },
            updatedAt: new Date().toISOString(),
            updatedBy: req.adminUser || 'unknown',
            requestId,
            changes: rollbackDiff
        });

        const meta = configMetadata.bumpMeta({ updatedBy: req.adminUser, requestId });
        return res.json({
            config: nextSections,
            meta,
            reverted: {
                section: lastEvent.section || 'legacy',
                requestId: lastEvent.requestId || null
            },
            requestId
        });
    } catch (error) {
        return res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Falha interna ao executar rollback.',
            requestId
        });
    }
});

app.get(withBasePath(BASE_PATH, '/api/admin/queue'), requireAdmin(BASE_PATH), async (req, res) => {
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

app.post(withBasePath(BASE_PATH, '/api/admin/pause'), requireAdmin(BASE_PATH), (req, res) => {
    const config = runtimeConfig.updateConfig({ paused: true });
    workerState.lastCycleResult = 'Pausado pelo painel';
    logger.info('Worker pausado pelo painel administrativo');
    res.json({ config });
});

app.post(withBasePath(BASE_PATH, '/api/admin/resume'), requireAdmin(BASE_PATH), (req, res) => {
    const config = runtimeConfig.updateConfig({ paused: false });
    workerState.lastCycleResult = 'Retomado pelo painel';
    logger.info('Worker retomado pelo painel administrativo');
    res.json({ config });
});

app.put(withBasePath(BASE_PATH, '/api/admin/config'), requireAdmin(BASE_PATH), (req, res) => {
    const requestId = createRequestId();
    try {
        const previous = runtimeConfig.getConfig();
        const config = runtimeConfig.updateConfig(req.body || {});
        const changes = configHistory.buildDiff(previous, config);
        configHistory.appendEvent({
            event: 'CONFIG_UPDATED',
            section: 'legacy',
            updatedAt: new Date().toISOString(),
            updatedBy: req.adminUser || 'unknown',
            requestId,
            changes
        });
        const meta = configMetadata.bumpMeta({ updatedBy: req.adminUser, requestId });
        res.json({ config, meta, requestId });
    } catch (error) {
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Falha interna ao processar configuracao.',
            requestId
        });
    }
});

app.put(withBasePath(BASE_PATH, '/api/admin/config/:section'), requireAdmin(BASE_PATH), (req, res) => {
    const requestId = createRequestId();
    const section = String(req.params.section || '');
    const allowed = ['client', 'templates', 'integration', 'businessHours', 'queueProducer', 'safety', 'payload'];
    if (!allowed.includes(section)) {
        return res.status(404).json({
            error: 'SECTION_NOT_FOUND',
            message: 'Secao de configuracao nao suportada.',
            requestId
        });
    }

    const payload = req.body || {};
    const fieldErrors = configSections.validateSection(section, payload);
    if (fieldErrors.length > 0) {
        return res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'Dados de configuracao invalidos.',
            fieldErrors,
            requestId
        });
    }

    try {
        const current = runtimeConfig.getConfig();
        const currentSections = configSections.toSections(current);
        const patch = configSections.toFlatPatch(section, payload);
        const next = runtimeConfig.updateConfig(patch || {});
        const nextSections = configSections.toSections(next);
        const changes = configHistory.buildDiff(currentSections[section], nextSections[section]);
        configHistory.appendEvent({
            event: 'CONFIG_UPDATED',
            section,
            updatedAt: new Date().toISOString(),
            updatedBy: req.adminUser || 'unknown',
            requestId,
            changes
        });
        const meta = configMetadata.bumpMeta({ updatedBy: req.adminUser, requestId });
        return res.json({
            config: configSections.toSections(next),
            meta,
            requestId
        });
    } catch (error) {
        return res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Falha interna ao processar configuracao.',
            requestId
        });
    }
});

app.listen(PORT, () => logger.info(`Servidor Web monitorando na porta ${PORT} com BASE_PATH='${BASE_PATH || '/'}'`));

function montarDadosFormatados(msg) {
    const config = runtimeConfig.getConfig();
    const agendaUnitAddress = config.useAgendaUnitAddress ? msg.strunidade : '';
    const fallbackAddress = config.defaultUnitAddress || `${msg.strEndereco || ''}, ${msg.strNumero || 'S/N'} - ${msg.strBairro || ''} - ${msg.strEstado || ''}`;

    return {
        p_agenda: formatters.limparTexto(msg.strAgenda),
        p_data: formatters.limparTexto(msg.datagenda),
        p_hora: config.formatTurnSchedule
            ? formatters.formatarHorario(msg.strHora, msg.bolAtendeHoraMarcada)
            : formatters.limparTexto(msg.strHora),
        p_profissional: formatters.limparTexto(msg.strProfissional),
        p_especialidade: formatters.limparTexto(msg.strEspecialidadeMedica),
        p_nome_unidade: formatters.limparTexto(msg.nomeUnidade || msg.strEmpresa),
        p_empresa: formatters.limparTexto(msg.strEmpresa),
        p_unidade: formatters.limparTexto(agendaUnitAddress || fallbackAddress)
    };
}

function logPayloadFailure(context, msg, payload, error) {
    const template = payload?.templateData?.template;
    const body = (template?.components || []).find((component) => component.type === 'body');
    const parameters = body?.parameters || [];

    logger.error(`${context} ID ${msg.intWhatsAppEnvioId}: ${error.message}`);
    logger.error(`${context} payload resumo ID ${msg.intWhatsAppEnvioId}: template=${template?.name || '-'}, numero=${payload?.number || '-'}, isClosed=${payload?.isClosed}, parametros=${parameters.length}, valores=${JSON.stringify(parameters.map((parameter) => parameter.text))}`);
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

function shouldLogTemplateWarning(agora, kind) {
    const lastLog = kind === 'agendamento'
        ? ultimoLogTemplateAgendamentoAusente
        : ultimoLogTemplateConfirmacaoAusente;

    if (agora.getTime() - lastLog <= 60 * 60 * 1000) return false;

    if (kind === 'agendamento') ultimoLogTemplateAgendamentoAusente = agora.getTime();
    else ultimoLogTemplateConfirmacaoAusente = agora.getTime();

    return true;
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
        botService.authToken = config.partnerbotAuthToken || AUTH_TOKEN;
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
            logger.info(`Produtor de fila: limite=${config.queueProducerLimit}, criado(s)=${totalFilaCriada}.`);
        } else {
            workerState.lastQueueProducedCount = 0;
        }

        if (envioAindaNaoLiberado(agora, config)) {
            workerState.lastCycleResult = `Fila criada: ${totalFilaCriada}. Envios bloqueados ate ${config.outboundSendStartDate}`;
            logger.info(`Envios bloqueados ate ${config.outboundSendStartDate}. Nenhuma mensagem sera enviada neste ciclo.`);
            return;
        }

        const mensagens = config.templateNewSchedule
            ? await repository.buscarMensagensPendentes(config)
            : [];
        totalAgendamentos = mensagens.length;

        if (!config.templateNewSchedule) {
            if (shouldLogTemplateWarning(agora, 'agendamento')) {
                logger.warn('Template de agendamento nao configurado. Envio de novas mensagens bloqueado.');
            }
        }

        if (mensagens.length > 0) {
            logger.info(`Envio de agendamentos: selecionado(s)=${mensagens.length}, limite_por_lote=${SEND_BATCH_LIMIT}, cadencia=${config.sendIntervalSeconds}s.`);
            if (mensagens.length === SEND_BATCH_LIMIT) {
                logger.info('Envio de agendamentos atingiu o limite do lote; se houver mais pendentes, serao processados nos proximos ciclos.');
            }

            for (const msg of mensagens) {
                let payload = null;
                try {
                    const telefoneFinal = formatters.limparTelefone(msg.strtelefone, config);

                    if (!telefoneFinal || telefoneFinal.length < 10) {
                        throw new Error(`Numero invalido: '${telefoneFinal}'`);
                    }

                    const dadosFormatados = montarDadosFormatados(msg);
                    let isClosed = config.partnerbotIsClosed;

                    if (config.useTicketOpenForIsClosed) {
                        const ticket = await botService.verificarTicketAberto(telefoneFinal);
                        isClosed = !ticket.encontrado;
                        logger.info(`[TicketCheck] Agendamento ID ${msg.intWhatsAppEnvioId} numero=${telefoneFinal} ticketAberto=${ticket.encontrado}`);
                    }

                    payload = formatters.montarPayloadAgendamento(telefoneFinal, dadosFormatados, { ...config, partnerbotIsClosed: isClosed });

                    logger.info(`Enviando Agendamento ID ${msg.intWhatsAppEnvioId}...`);
                    await botService.enviarMensagem(payload);
                    await repository.marcarComoEnviado(msg.intWhatsAppEnvioId, config);
                    logger.info(`Sucesso Agendamento ID: ${msg.intWhatsAppEnvioId}`);
                } catch (error) {
                    logPayloadFailure('Falha Agendamento', msg, payload, error);

                    try {
                        await repository.marcarComoErro(msg.intWhatsAppEnvioId);
                    } catch (dbErr) {
                        logger.error(`CRITICO: Falha ao marcar erro no banco: ${dbErr.message}`);
                    }
                }

                if (config.sendIntervalSeconds > 0) {
                    await sleep(config.sendIntervalSeconds * 1000);
                }
            }
        }

        const usarTemplateAgendamentoParaConfirmacao = !config.templateReminder && Boolean(config.templateNewSchedule);
        const confirmacoes = (config.templateReminder || usarTemplateAgendamentoParaConfirmacao)
            ? await repository.buscarConfirmacoesPendentes(config)
            : [];
        totalConfirmacoes = confirmacoes.length;

        if (!config.templateReminder) {
            if (usarTemplateAgendamentoParaConfirmacao) {
                if (shouldLogTemplateWarning(agora, 'confirmacao')) {
                    logger.info('Template de confirmacao nao configurado. Confirmacoes serao enviadas com o template de agendamento.');
                }
            } else if (shouldLogTemplateWarning(agora, 'confirmacao')) {
                logger.warn('Template de confirmacao nao configurado. Envio de lembretes bloqueado.');
            }
        }

        if (confirmacoes.length > 0) {
            logger.info(`Envio de confirmacoes: selecionado(s)=${confirmacoes.length}, limite_por_lote=${SEND_BATCH_LIMIT}, cadencia=${config.sendIntervalSeconds}s${usarTemplateAgendamentoParaConfirmacao ? ', fallback=template_agendamento' : ''}.`);
            if (confirmacoes.length === SEND_BATCH_LIMIT) {
                logger.info('Envio de confirmacoes atingiu o limite do lote; se houver mais pendentes, serao processadas nos proximos ciclos.');
            }

            for (const msg of confirmacoes) {
                let payload = null;
                try {
                    const telefoneFinal = formatters.limparTelefone(msg.strtelefone, config);

                    if (!telefoneFinal || telefoneFinal.length < 10) {
                        throw new Error(`Numero invalido: '${telefoneFinal}'`);
                    }

                    const dadosFormatados = montarDadosFormatados(msg);
                    let isClosed = config.partnerbotIsClosed;

                    if (config.useTicketOpenForIsClosed) {
                        const ticket = await botService.verificarTicketAberto(telefoneFinal);
                        isClosed = !ticket.encontrado;
                        logger.info(`[TicketCheck] Lembrete ID ${msg.intWhatsAppEnvioId} numero=${telefoneFinal} ticketAberto=${ticket.encontrado}`);
                    }

                    const payloadConfig = { ...config, partnerbotIsClosed: isClosed };
                    payload = usarTemplateAgendamentoParaConfirmacao
                        ? formatters.montarPayloadAgendamento(telefoneFinal, dadosFormatados, payloadConfig)
                        : formatters.montarPayloadConfirmacao(telefoneFinal, dadosFormatados, msg.Link || '-', payloadConfig);

                    logger.info(`Enviando Lembrete ID ${msg.intWhatsAppEnvioId}${usarTemplateAgendamentoParaConfirmacao ? ' com template de agendamento' : ''}...`);
                    await botService.enviarMensagem(payload);
                    await repository.marcarConfirmacaoComoEnviada(msg.intWhatsAppEnvioId, config);
                    logger.info(`Lembrete enviado ID: ${msg.intWhatsAppEnvioId}`);
                } catch (error) {
                    logPayloadFailure('Falha Lembrete', msg, payload, error);

                    try {
                        await repository.marcarComoErro(msg.intWhatsAppEnvioId);
                    } catch (dbErr) {
                        logger.error(`DB Err: ${dbErr.message}`);
                    }
                }

                if (config.sendIntervalSeconds > 0) {
                    await sleep(config.sendIntervalSeconds * 1000);
                }
            }
        }

        const bloqueios = [];
        if (!config.templateNewSchedule) bloqueios.push('agendamentos bloqueados sem template');
        if (!config.templateReminder && !usarTemplateAgendamentoParaConfirmacao) bloqueios.push('confirmacoes bloqueadas sem template');
        if (usarTemplateAgendamentoParaConfirmacao) bloqueios.push('confirmacoes via template de agendamento');
        workerState.lastCycleResult = `Ciclo concluido: ${totalFilaCriada} criados na fila, ${totalAgendamentos} agendamentos, ${totalConfirmacoes} lembretes${bloqueios.length ? `. ${bloqueios.join('; ')}` : ''}`;
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
