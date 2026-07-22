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
                    return { recordset: [agenda] };
                }
            };
            return request;
        }
    };
}

function createCapturePool() {
    const queries = [];
    return {
        queries,
        request() {
            const request = {
                input() {
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
