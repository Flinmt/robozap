const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const defaultConfigPath = path.join(projectRoot, 'config', 'runtime-config.json');
const configPath = process.env.RUNTIME_CONFIG_PATH
    ? path.resolve(process.env.RUNTIME_CONFIG_PATH)
    : defaultConfigPath;

function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return String(value).toLowerCase() === 'true';
}

function parseHour(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 23) return fallback;
    return parsed;
}

function parseInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    if (parsed < min) return fallback;
    if (max !== undefined && parsed > max) return fallback;
    return parsed;
}

function parseDateString(value, fallback = '') {
    if (value === undefined || value === null || value === '') return fallback;
    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function getDefaults() {
    return {
        partnerbotUrl: process.env.URL || '',
        showticketUrl: process.env.SHOWTICKET_URL || '',
        clientName: '',
        clientCode: '',
        paused: parseBoolean(process.env.WORKER_PAUSED, true),
        templateNewSchedule: '',
        templateReminder: '',
        partnerbotAuthToken: '',
        useTicketOpenForIsClosed: parseBoolean(process.env.USE_TICKET_OPEN_FOR_IS_CLOSED, false),
        normalizeBrazilMobileNinthDigit: parseBoolean(process.env.NORMALIZE_BRAZIL_MOBILE_NINTH_DIGIT, true),
        partnerbotIsClosed: parseBoolean(process.env.PARTNERBOT_IS_CLOSED, false),
        includeCompany: parseBoolean(process.env.PARTNERBOT_INCLUDE_COMPANY, false),
        includeUnit: parseBoolean(process.env.PARTNERBOT_INCLUDE_UNIT, false),
        includeProcedure: parseBoolean(process.env.PARTNERBOT_INCLUDE_PROCEDURE, false),
        includeConfirmationButton: parseBoolean(process.env.PARTNERBOT_INCLUDE_CONFIRMATION_BUTTON, false),
        defaultUnitAddress: process.env.DEFAULT_UNIT_ADDRESS || '',
        formatTurnSchedule: parseBoolean(process.env.FORMAT_TURN_SCHEDULE, false),
        useAgendaUnitAddress: parseBoolean(process.env.USE_AGENDA_UNIT_ADDRESS, false),
        businessHoursStart: parseHour(process.env.BUSINESS_HOURS_START, 8),
        businessHoursEnd: parseHour(process.env.BUSINESS_HOURS_END, 17),
        queueProducerEnabled: parseBoolean(process.env.QUEUE_PRODUCER_ENABLED, false),
        queueProducerLookaheadDays: parseInteger(process.env.QUEUE_PRODUCER_LOOKAHEAD_DAYS, 7, 0, 365),
        queueProducerLimit: parseInteger(process.env.QUEUE_PRODUCER_LIMIT, 50, 1, 500),
        sendIntervalSeconds: parseInteger(process.env.SEND_INTERVAL_SECONDS, 10, 0, 300),
        testModeEnabled: parseBoolean(process.env.TEST_MODE_ENABLED, true),
        testPatientNameFilter: process.env.TEST_PATIENT_NAME_FILTER || 'TESTE',
        syncAgendaWhatsappStatus: parseBoolean(process.env.SYNC_AGENDA_WHATSAPP_STATUS, false),
        messagingStartDate: parseDateString(process.env.MESSAGING_START_DATE, ''),
        skipPastAppointmentTime: parseBoolean(process.env.SKIP_PAST_APPOINTMENT_TIME, false),
        outboundSendStartDate: parseDateString(process.env.OUTBOUND_SEND_START_DATE, '')
    };
}

function readStoredConfig() {
    if (!fs.existsSync(configPath)) return {};

    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`Falha ao ler configuracao runtime: ${error.message}`);
    }
}

function normalizeConfig(input) {
    const defaults = getDefaults();
    const merged = { ...defaults, ...input };

    return {
        partnerbotUrl: String(merged.partnerbotUrl || ''),
        showticketUrl: String(merged.showticketUrl || ''),
        clientName: String(merged.clientName || ''),
        clientCode: String(merged.clientCode || ''),
        paused: parseBoolean(merged.paused, defaults.paused),
        templateNewSchedule: String(merged.templateNewSchedule || ''),
        templateReminder: String(merged.templateReminder || ''),
        partnerbotAuthToken: String(merged.partnerbotAuthToken || ''),
        useTicketOpenForIsClosed: parseBoolean(merged.useTicketOpenForIsClosed, defaults.useTicketOpenForIsClosed),
        normalizeBrazilMobileNinthDigit: parseBoolean(merged.normalizeBrazilMobileNinthDigit, defaults.normalizeBrazilMobileNinthDigit),
        partnerbotIsClosed: parseBoolean(merged.partnerbotIsClosed, defaults.partnerbotIsClosed),
        includeCompany: parseBoolean(merged.includeCompany, defaults.includeCompany),
        includeUnit: parseBoolean(merged.includeUnit, defaults.includeUnit),
        includeProcedure: parseBoolean(merged.includeProcedure, defaults.includeProcedure),
        includeConfirmationButton: parseBoolean(merged.includeConfirmationButton, defaults.includeConfirmationButton),
        defaultUnitAddress: String(merged.defaultUnitAddress || ''),
        formatTurnSchedule: parseBoolean(merged.formatTurnSchedule, defaults.formatTurnSchedule),
        useAgendaUnitAddress: parseBoolean(merged.useAgendaUnitAddress, defaults.useAgendaUnitAddress),
        businessHoursStart: parseHour(merged.businessHoursStart, defaults.businessHoursStart),
        businessHoursEnd: parseHour(merged.businessHoursEnd, defaults.businessHoursEnd),
        queueProducerEnabled: parseBoolean(merged.queueProducerEnabled, defaults.queueProducerEnabled),
        queueProducerLookaheadDays: parseInteger(merged.queueProducerLookaheadDays, defaults.queueProducerLookaheadDays, 0, 365),
        queueProducerLimit: parseInteger(merged.queueProducerLimit, defaults.queueProducerLimit, 1, 500),
        sendIntervalSeconds: parseInteger(merged.sendIntervalSeconds, defaults.sendIntervalSeconds, 0, 300),
        testModeEnabled: parseBoolean(merged.testModeEnabled, defaults.testModeEnabled),
        testPatientNameFilter: String(merged.testPatientNameFilter || defaults.testPatientNameFilter),
        syncAgendaWhatsappStatus: parseBoolean(merged.syncAgendaWhatsappStatus, defaults.syncAgendaWhatsappStatus),
        messagingStartDate: parseDateString(merged.messagingStartDate, defaults.messagingStartDate),
        skipPastAppointmentTime: parseBoolean(merged.skipPastAppointmentTime, defaults.skipPastAppointmentTime),
        outboundSendStartDate: parseDateString(merged.outboundSendStartDate, defaults.outboundSendStartDate)
    };
}

function getConfig() {
    return normalizeConfig(readStoredConfig());
}

function saveConfig(nextConfig) {
    const normalized = normalizeConfig(nextConfig);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
}

function updateConfig(patch) {
    const current = getConfig();
    return saveConfig({ ...current, ...patch });
}

module.exports = {
    getConfig,
    saveConfig,
    updateConfig,
    configPath
};
