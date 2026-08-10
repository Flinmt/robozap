const test = require('node:test');
const assert = require('node:assert/strict');
const MessageRepository = require('../src/repositories/messageRepository');

function createValidationPool(agenda) {
    return {
        request() {
            const request = {
                input() {
                    return request;
                },
                async query() {
                    return { recordset: Array.isArray(agenda) ? agenda : [agenda] };
                }
            };
            return request;
        }
    };
}

function createCapturePool() {
    const queries = [];
    const inputs = [];
    return {
        queries,
        inputs,
        request() {
            const request = {
                input(name, type, value) {
                    inputs.push({ name, type, value });
                    return request;
                },
                async query(query) {
                    queries.push(query);
                    return { recordset: [] };
                }
            };
            return request;
        }
    };
}

function baseAgenda(overrides = {}) {
    return {
        totalLinhasAgenda: 1,
        intAgendaId: 47389,
        strAgenda: 'PACIENTE TESTE',
        strProfissional: 'PROFISSIONAL TESTE',
        strTelefoneAtual: '81999999999',
        bolBloqueado: 'N',
        bolConfirmado: 'N',
        datConfirmacao: null,
        dataAgendamentoIso: '2026-07-22',
        appointmentAtIso: '2026-07-22 13:30:00',
        horarioPassado: 0,
        strEmpresa: 'EMPRESA TESTE',
        ...overrides
    };
}

function baseQueueMessage() {
    return {
        intWhatsAppEnvioId: 18408,
        strAgenda: 'PACIENTE TESTE',
        strProfissional: 'PROFISSIONAL TESTE',
        strtelefone: '5581999999999',
        datDataAlerta: '2026-07-22 13:30:00'
    };
}

async function validate(agenda, options = { bloquearPresencaConfirmada: true }) {
    const repository = new MessageRepository(createValidationPool(agenda));
    return repository.validarAgendamentoAntesDoEnvio(
        47389,
        { testModeEnabled: false, skipPastAppointmentTime: false },
        baseQueueMessage(),
        options
    );
}

test('bloqueia lembrete quando bolConfirmado e A', async () => {
    const result = await validate(baseAgenda({ bolConfirmado: 'A' }));
    assert.deepEqual(result, { valido: false, motivo: 'presenca_ja_confirmada' });
});

test('bloqueia lembrete quando bolConfirmado e S', async () => {
    const result = await validate(baseAgenda({ bolConfirmado: 'S' }));
    assert.deepEqual(result, { valido: false, motivo: 'presenca_ja_confirmada' });
});

test('bloqueia lembrete quando datConfirmacao esta preenchida', async () => {
    const result = await validate(baseAgenda({ datConfirmacao: new Date('2026-07-21T11:43:26Z') }));
    assert.deepEqual(result, { valido: false, motivo: 'presenca_ja_confirmada' });
});

test('mantem elegivel quem esta com N e sem data de confirmacao', async () => {
    const result = await validate(baseAgenda());
    assert.deepEqual(result, { valido: true, motivo: 'ok' });
});

test('nao aplica bloqueio clinico ao fluxo da primeira mensagem', async () => {
    const result = await validate(baseAgenda({ bolConfirmado: 'A' }), {
        bloquearPresencaConfirmada: false
    });
    assert.deepEqual(result, { valido: true, motivo: 'ok' });
});

test('revalidacao localiza a ocupacao pelo slot e data hora da fila', async () => {
    const pool = createCapturePool();
    const repository = new MessageRepository(pool);

    await repository.validarAgendamentoAntesDoEnvio(
        47389,
        { testModeEnabled: false, skipPastAppointmentTime: false },
        baseQueueMessage()
    );

    assert.equal(pool.queries.length, 1);
    assert.match(pool.queries[0], /WITH agendaDoSlot AS[\s\S]*SELECT DISTINCT/i);
    assert.match(pool.queries[0], /a\.intAgendaId = @intAgendaId/i);
    assert.match(pool.queries[0], /appointment\.appointmentAt[\s\S]*= @appointmentAtIso/i);
    assert.equal(
        pool.inputs.find(input => input.name === 'appointmentAtIso')?.value,
        '2026-07-22 13:30:00'
    );
});

test('fila sem data de agendamento e rejeitada antes de consultar o slot', async () => {
    const pool = createCapturePool();
    const repository = new MessageRepository(pool);
    const message = { ...baseQueueMessage(), datDataAlerta: null };

    const result = await repository.validarAgendamentoAntesDoEnvio(
        47389,
        { testModeEnabled: false, skipPastAppointmentTime: false },
        message
    );

    assert.deepEqual(result, { valido: false, motivo: 'fila_sem_data_agendamento' });
    assert.equal(pool.queries.length, 0);
});

test('conflito real na mesma ocupacao continua bloqueado', async () => {
    const result = await validate([
        baseAgenda(),
        baseAgenda({ strTelefoneAtual: '81988888888' })
    ]);
    assert.deepEqual(result, { valido: false, motivo: 'agenda_duplicada' });
});

test('seleciona o paciente correto quando o slot e horario possuem outras ocupacoes', async () => {
    const result = await validate([
        baseAgenda({
            strAgenda: 'OUTRO PACIENTE',
            strProfissional: 'OUTRO PROFISSIONAL',
            strTelefoneAtual: '81977777777'
        }),
        baseAgenda()
    ]);

    assert.deepEqual(result, { valido: true, motivo: 'ok' });
});

test('mantem bloqueio quando o paciente antigo nao ocupa mais o slot', async () => {
    const result = await validate(baseAgenda({ strAgenda: 'NOVO PACIENTE' }));
    assert.deepEqual(result, { valido: false, motivo: 'paciente_divergente' });
});

test('consultas de fila e envio excluem presenca ja confirmada', async () => {
    const pool = createCapturePool();
    const repository = new MessageRepository(pool);
    const config = {
        testModeEnabled: false,
        testPatientNameFilter: 'TESTE',
        templateNewSchedule: 'agendamento_inicio',
        templateReminder: 'cadencia_lembrete_real1',
        skipPastAppointmentTime: true
    };

    await repository.listarFilaPendente(config);
    await repository.buscarConfirmacoesPendentes(config);

    assert.equal(pool.queries.length, 2);
    for (const query of pool.queries) {
        assert.match(query, /TA\.datConfirmacao IS NULL/i);
        assert.match(query, /TA\.bolConfirmado[\s\S]*NOT IN \('A', 'S'\)/i);
    }
});

test('consultas de envio selecionam o numero de protocolo da agenda', async () => {
    const pool = createCapturePool();
    const repository = new MessageRepository(pool);
    const config = {
        testModeEnabled: false,
        testPatientNameFilter: 'TESTE',
        templateNewSchedule: 'agendamento_inicial',
        templateReminder: 'lembrete',
        skipPastAppointmentTime: false
    };

    await repository.buscarMensagensPendentes(config);
    await repository.buscarConfirmacoesPendentes(config);

    assert.equal(pool.queries.length, 2);
    for (const query of pool.queries) {
        assert.match(query, /a\.intNumeroProtocolo/i);
    }
});

test('consultas filtram snapshots divergentes antes do limite do lote', async () => {
    const pool = createCapturePool();
    const repository = new MessageRepository(pool);
    const config = {
        testModeEnabled: false,
        testPatientNameFilter: 'TESTE',
        templateNewSchedule: 'agendamento_inicial',
        templateReminder: 'lembrete',
        skipPastAppointmentTime: false
    };

    await repository.listarFilaPendente(config);
    await repository.buscarMensagensPendentes(config);
    await repository.buscarConfirmacoesPendentes(config);

    assert.equal(pool.queries.length, 3);
    for (const query of pool.queries) {
        assert.match(query, /UPPER\(LTRIM\(RTRIM\(ISNULL\(w\.strAgenda,[\s\S]*UPPER\(LTRIM\(RTRIM\(ISNULL\(a\.strAgenda/i);
        assert.match(query, /w\.strProfissional[\s\S]*a\.strProfissional/i);
    }

    assert.match(pool.queries[1], /SELECT DISTINCT top 20/i);
    assert.match(pool.queries[2], /SELECT DISTINCT top 20/i);
});

test('produtor cria nova fila quando paciente ou profissional do slot muda', async () => {
    const pool = createCapturePool();
    const repository = new MessageRepository(pool);

    await repository.gerarFilaAgendamentos({
        queueProducerLimit: 50,
        queueProducerLookaheadDays: 7,
        testModeEnabled: false,
        testPatientNameFilter: 'TESTE',
        messagingStartDate: null
    });

    assert.equal(pool.queries.length, 1);
    assert.match(pool.queries[0], /w\.datDataAlerta = appointment\.appointmentAt/i);
    assert.match(pool.queries[0], /w\.strAgenda[\s\S]*a\.strAgenda/i);
    assert.match(pool.queries[0], /w\.strProfissional[\s\S]*a\.strProfissional/i);
});
