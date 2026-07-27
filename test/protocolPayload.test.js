const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const configSections = require('../src/config/configSections');
const formatters = require('../src/utils/formatters');

function baseData(overrides = {}) {
    return {
        p_agenda: 'PACIENTE TESTE',
        p_protocolo: '1234',
        p_data: '28/07/2026',
        p_hora: '14:00',
        p_profissional: 'DR. TESTE',
        p_especialidade: 'ESPECIALIDADE TESTE',
        p_nome_unidade: 'SERVIMED',
        p_empresa: 'SERVIMED',
        p_unidade: 'ENDERECO TESTE',
        ...overrides
    };
}

function baseConfig(overrides = {}) {
    return {
        partnerbotIsClosed: true,
        templateNewSchedule: 'agendamento_inicial',
        templateReminder: 'lembrete',
        includeProtocol: false,
        includeProcedure: false,
        includeCompany: false,
        includeUnit: false,
        includeConfirmationButton: false,
        ...overrides
    };
}

function bodyValues(payload) {
    const body = payload.templateData.template.components.find((component) => component.type === 'body');
    return body.parameters.map((parameter) => parameter.text);
}

test('mantem payload original quando includeProtocol esta desligado', () => {
    const payload = formatters.montarPayloadAgendamento('5581992946508', baseData(), baseConfig());

    assert.deepEqual(bodyValues(payload), [
        'PACIENTE TESTE',
        '28/07/2026',
        '14:00',
        'DR. TESTE'
    ]);
});

test('inclui protocolo como segundo parametro nos dois tipos de mensagem', () => {
    const config = baseConfig({
        includeProtocol: true,
        includeProcedure: true,
        includeCompany: true,
        includeUnit: true
    });
    const expected = [
        'PACIENTE TESTE',
        '1234',
        '28/07/2026',
        '14:00',
        'DR. TESTE',
        'ESPECIALIDADE TESTE',
        'SERVIMED',
        'ENDERECO TESTE'
    ];

    const schedule = formatters.montarPayloadAgendamento('5581992946508', baseData(), config);
    const reminder = formatters.montarPayloadConfirmacao('5581992946508', baseData(), 'token', config);

    assert.deepEqual(bodyValues(schedule), expected);
    assert.deepEqual(bodyValues(reminder), expected);
});

test('usa hifen para protocolo nulo', () => {
    const data = baseData({ p_protocolo: formatters.limparTexto(null) });
    const payload = formatters.montarPayloadAgendamento(
        '5581992946508',
        data,
        baseConfig({ includeProtocol: true })
    );

    assert.equal(bodyValues(payload)[1], '-');
});

test('expoe e persiste includeProtocol na secao payload', () => {
    const sections = configSections.toSections({ includeProtocol: true });
    assert.equal(sections.payload.includeProtocol, true);

    const payloadSection = {
        partnerbotIsClosed: false,
        includeProcedure: false,
        includeProtocol: true,
        includeCompany: false,
        includeUnit: false,
        includeConfirmationButton: false,
        defaultUnitAddress: '',
        formatTurnSchedule: false,
        useAgendaUnitAddress: false
    };

    assert.deepEqual(configSections.validateSection('payload', payloadSection), []);
    assert.equal(configSections.toFlatPatch('payload', payloadSection).includeProtocol, true);
});

test('le PARTNERBOT_INCLUDE_PROTOCOL como default de ambiente', () => {
    const configPath = path.join(os.tmpdir(), `robozap-runtime-config-${process.pid}.json`);
    const script = "process.stdout.write(String(require('./src/config/runtimeConfig').getConfig().includeProtocol))";
    const output = execFileSync(process.execPath, ['-e', script], {
        cwd: path.resolve(__dirname, '..'),
        env: {
            ...process.env,
            RUNTIME_CONFIG_PATH: configPath,
            PARTNERBOT_INCLUDE_PROTOCOL: 'true'
        },
        encoding: 'utf8'
    });

    assert.equal(output, 'true');
});
