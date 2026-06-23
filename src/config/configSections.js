function toSections(flat) {
    return {
        client: {
            name: String(flat.clientName || ''),
            code: String(flat.clientCode || '')
        },
        templates: {
            newSchedule: String(flat.templateNewSchedule || ''),
            reminder: String(flat.templateReminder || '')
        },
        integration: {
            partnerbotUrl: String(flat.partnerbotUrl || ''),
            showticketUrl: String(flat.showticketUrl || ''),
            partnerbotAuthToken: String(flat.partnerbotAuthToken || ''),
            useTicketOpenForIsClosed: Boolean(flat.useTicketOpenForIsClosed),
            normalizeBrazilMobileNinthDigit: Boolean(flat.normalizeBrazilMobileNinthDigit)
        },
        businessHours: {
            start: Number(flat.businessHoursStart),
            end: Number(flat.businessHoursEnd),
            messagingStartDate: String(flat.messagingStartDate || ''),
            outboundSendStartDate: String(flat.outboundSendStartDate || ''),
            skipPastAppointmentTime: Boolean(flat.skipPastAppointmentTime)
        },
        queueProducer: {
            enabled: Boolean(flat.queueProducerEnabled),
            lookaheadDays: Number(flat.queueProducerLookaheadDays),
            limit: Number(flat.queueProducerLimit)
        },
        safety: {
            paused: Boolean(flat.paused),
            testModeEnabled: Boolean(flat.testModeEnabled),
            testPatientNameFilter: String(flat.testPatientNameFilter || ''),
            syncAgendaWhatsappStatus: Boolean(flat.syncAgendaWhatsappStatus),
            sendIntervalSeconds: Number(flat.sendIntervalSeconds)
        },
        payload: {
            partnerbotIsClosed: Boolean(flat.partnerbotIsClosed),
            includeProcedure: Boolean(flat.includeProcedure),
            includeCompany: Boolean(flat.includeCompany),
            includeUnit: Boolean(flat.includeUnit),
            includeConfirmationButton: Boolean(flat.includeConfirmationButton),
            defaultUnitAddress: String(flat.defaultUnitAddress || ''),
            formatTurnSchedule: Boolean(flat.formatTurnSchedule),
            useAgendaUnitAddress: Boolean(flat.useAgendaUnitAddress)
        }
    };
}

function isDateOrEmpty(value) {
    return value === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function validateSection(section, payload) {
    const errors = [];
    const pushError = (field, code, message) => errors.push({ field, code, message });

    if (section === 'client') {
        if (typeof payload.name !== 'string' || payload.name.trim().length < 2) {
            pushError('name', 'VALIDATION_CLIENT_NAME', 'Nome do cliente deve ter pelo menos 2 caracteres.');
        }
        if (typeof payload.code !== 'string' || payload.code.trim().length < 2) {
            pushError('code', 'VALIDATION_CLIENT_CODE', 'Codigo do cliente deve ter pelo menos 2 caracteres.');
        }
    }

    if (section === 'templates') {
        if (typeof payload.newSchedule !== 'string') pushError('newSchedule', 'VALIDATION_TEMPLATE_NEW_SCHEDULE', 'Template de agendamento invalido.');
        if (typeof payload.reminder !== 'string') pushError('reminder', 'VALIDATION_TEMPLATE_REMINDER', 'Template de lembrete invalido.');
    }

    if (section === 'integration') {
        if (typeof payload.partnerbotUrl !== 'string') {
            pushError('partnerbotUrl', 'VALIDATION_PARTNERBOT_URL', 'URL da PartnerBot deve ser texto.');
        }
        if (typeof payload.showticketUrl !== 'string') {
            pushError('showticketUrl', 'VALIDATION_SHOWTICKET_URL', 'URL do ShowTicket deve ser texto.');
        }
        if (typeof payload.partnerbotAuthToken !== 'string') {
            pushError('partnerbotAuthToken', 'VALIDATION_PARTNERBOT_AUTH_TOKEN', 'Token da PartnerBot invalido.');
        }
        if (typeof payload.useTicketOpenForIsClosed !== 'boolean') {
            pushError('useTicketOpenForIsClosed', 'VALIDATION_USE_TICKET_IS_CLOSED', 'Flag de ticket para isClosed deve ser booleana.');
        }
        if (typeof payload.normalizeBrazilMobileNinthDigit !== 'boolean') {
            pushError('normalizeBrazilMobileNinthDigit', 'VALIDATION_NORMALIZE_MOBILE_NINTH_DIGIT', 'Flag de normalizacao do 9o digito deve ser booleana.');
        }
    }

    if (section === 'businessHours') {
        if (!Number.isInteger(payload.start) || payload.start < 0 || payload.start > 23) pushError('start', 'VALIDATION_BUSINESS_START', 'Hora inicial deve estar entre 0 e 23.');
        if (!Number.isInteger(payload.end) || payload.end < 0 || payload.end > 23) pushError('end', 'VALIDATION_BUSINESS_END', 'Hora final deve estar entre 0 e 23.');
        if (Number.isInteger(payload.start) && Number.isInteger(payload.end) && payload.end <= payload.start) pushError('end', 'VALIDATION_BUSINESS_END', 'Hora final deve ser maior que hora inicial.');
        if (!isDateOrEmpty(payload.messagingStartDate)) pushError('messagingStartDate', 'VALIDATION_MESSAGING_START_DATE', 'Data minima de consulta invalida.');
        if (!isDateOrEmpty(payload.outboundSendStartDate)) pushError('outboundSendStartDate', 'VALIDATION_OUTBOUND_START_DATE', 'Data de liberacao de disparos invalida.');
        if (typeof payload.skipPastAppointmentTime !== 'boolean') pushError('skipPastAppointmentTime', 'VALIDATION_SKIP_PAST_APPOINTMENT', 'Valor deve ser booleano.');
    }

    if (section === 'queueProducer') {
        if (typeof payload.enabled !== 'boolean') pushError('enabled', 'VALIDATION_QUEUE_ENABLED', 'Habilitacao do produtor deve ser booleana.');
        if (!Number.isInteger(payload.lookaheadDays) || payload.lookaheadDays < 0 || payload.lookaheadDays > 365) pushError('lookaheadDays', 'VALIDATION_QUEUE_LOOKAHEAD', 'Janela do produtor deve estar entre 0 e 365.');
        if (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 500) pushError('limit', 'VALIDATION_QUEUE_LIMIT', 'Limite por ciclo deve estar entre 1 e 500.');
    }

    if (section === 'safety') {
        if (typeof payload.paused !== 'boolean') pushError('paused', 'VALIDATION_SAFETY_PAUSED', 'Estado de pausa deve ser booleano.');
        if (typeof payload.testModeEnabled !== 'boolean') pushError('testModeEnabled', 'VALIDATION_SAFETY_TEST_MODE', 'Modo teste deve ser booleano.');
        if (typeof payload.testPatientNameFilter !== 'string' || payload.testPatientNameFilter.trim().length < 2) pushError('testPatientNameFilter', 'VALIDATION_SAFETY_TEST_FILTER', 'Filtro de paciente deve ter pelo menos 2 caracteres.');
        if (typeof payload.syncAgendaWhatsappStatus !== 'boolean') pushError('syncAgendaWhatsappStatus', 'VALIDATION_SAFETY_SYNC_AGENDA', 'Sincronizacao de agenda deve ser booleana.');
        if (!Number.isInteger(payload.sendIntervalSeconds) || payload.sendIntervalSeconds < 0 || payload.sendIntervalSeconds > 300) {
            pushError('sendIntervalSeconds', 'VALIDATION_SEND_INTERVAL_SECONDS', 'Cadencia deve estar entre 0 e 300 segundos.');
        }
    }

    if (section === 'payload') {
        ['partnerbotIsClosed', 'includeProcedure', 'includeCompany', 'includeUnit', 'includeConfirmationButton', 'formatTurnSchedule', 'useAgendaUnitAddress'].forEach((field) => {
            if (typeof payload[field] !== 'boolean') pushError(field, 'VALIDATION_PAYLOAD_FIELD', `${field} deve ser booleano.`);
        });
        if (typeof payload.defaultUnitAddress !== 'string') {
            pushError('defaultUnitAddress', 'VALIDATION_DEFAULT_UNIT_ADDRESS', 'Endereco padrao deve ser texto.');
        }
    }

    return errors;
}

function toFlatPatch(section, payload) {
    if (section === 'client') return { clientName: payload.name, clientCode: payload.code };
    if (section === 'templates') return { templateNewSchedule: payload.newSchedule, templateReminder: payload.reminder };
    if (section === 'integration') return {
        partnerbotUrl: payload.partnerbotUrl,
        showticketUrl: payload.showticketUrl,
        partnerbotAuthToken: payload.partnerbotAuthToken,
        useTicketOpenForIsClosed: payload.useTicketOpenForIsClosed,
        normalizeBrazilMobileNinthDigit: payload.normalizeBrazilMobileNinthDigit
    };
    if (section === 'businessHours') return {
        businessHoursStart: payload.start,
        businessHoursEnd: payload.end,
        messagingStartDate: payload.messagingStartDate,
        outboundSendStartDate: payload.outboundSendStartDate,
        skipPastAppointmentTime: payload.skipPastAppointmentTime
    };
    if (section === 'queueProducer') return { queueProducerEnabled: payload.enabled, queueProducerLookaheadDays: payload.lookaheadDays, queueProducerLimit: payload.limit };
    if (section === 'safety') return {
        paused: payload.paused,
        testModeEnabled: payload.testModeEnabled,
        testPatientNameFilter: payload.testPatientNameFilter,
        syncAgendaWhatsappStatus: payload.syncAgendaWhatsappStatus,
        sendIntervalSeconds: payload.sendIntervalSeconds
    };
    if (section === 'payload') return {
        partnerbotIsClosed: payload.partnerbotIsClosed,
        includeProcedure: payload.includeProcedure,
        includeCompany: payload.includeCompany,
        includeUnit: payload.includeUnit,
        includeConfirmationButton: payload.includeConfirmationButton,
        defaultUnitAddress: payload.defaultUnitAddress,
        formatTurnSchedule: payload.formatTurnSchedule,
        useAgendaUnitAddress: payload.useAgendaUnitAddress
    };
    return null;
}

module.exports = {
    toSections,
    validateSection,
    toFlatPatch
};
