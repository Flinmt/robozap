const { sql } = require('../config/database');

class MessageRepository {
    constructor(pool) {
        this.pool = pool;
    }

    getCompanyName(config = {}) {
        return null;
    }

    normalizeSnapshotText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();
    }

    presencaJaConfirmada(agenda = {}) {
        const status = String(agenda.bolConfirmado || '').trim().toUpperCase();
        const temDataConfirmacao = agenda.datConfirmacao !== null
            && agenda.datConfirmacao !== undefined;
        return temDataConfirmacao
            || status === 'A'
            || status === 'S';
    }

    async validarAgendamentoAntesDoEnvio(intAgendaId, config = {}, queueMessage = {}, options = {}) {
        const querySelect = `
            SELECT TOP 1
                COUNT(1) OVER () AS totalLinhasAgenda,
                a.intAgendaId,
                a.strAgenda,
                a.strProfissional,
                currentPhone.finalPhone AS strTelefoneAtual,
                a.bolBloqueado,
                TA.bolConfirmado,
                TA.datConfirmacao,
                a.datAgendamento,
                a.strHora,
                CONVERT(varchar(10), a.datAgendamento, 120) AS dataAgendamentoIso,
                CONVERT(varchar(19), appointment.appointmentAt, 120) AS appointmentAtIso,
                CASE
                    WHEN @skipPastAppointmentTime = 1
                     AND appointment.appointmentAt < GETDATE()
                    THEN 1
                    ELSE 0
                END AS horarioPassado,
                COALESCE(a.strEmpresa, EUnidade.strEmpresa, EVw.strEmpresa) AS strEmpresa
            FROM vwAgenda a
            LEFT JOIN tblAgenda TA ON TA.intAgendaId = a.intAgendaId
            LEFT JOIN tblEmpresa EUnidade ON EUnidade.intEmpresaId = TA.intUnidadeId
            LEFT JOIN tblEmpresa EVw ON EVw.intEmpresaId = a.intEmpresaId
            CROSS APPLY (
                SELECT telefoneLimpo = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(a.strTelefone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), '/', '')
            ) telefone
            CROSS APPLY (
                SELECT celularLimpo = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(a.strCelular, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), '/', '')
            ) celular
            CROSS APPLY (
                SELECT rawPhone = CASE
                    WHEN LEN(celular.celularLimpo) >= 10 THEN celular.celularLimpo
                    ELSE telefone.telefoneLimpo
                END
            ) sourcePhone
            CROSS APPLY (
                SELECT finalPhone = CASE
                    WHEN LEN(sourcePhone.rawPhone) > 11 AND LEFT(sourcePhone.rawPhone, 2) = '55'
                        THEN SUBSTRING(sourcePhone.rawPhone, 3, 20)
                    ELSE sourcePhone.rawPhone
                END
            ) currentPhone
            CROSS APPLY (
                SELECT appointmentAt = ISNULL(
                    TRY_CONVERT(datetime, CONVERT(varchar(10), a.datAgendamento, 120) + ' ' + NULLIF(a.strHora, '')),
                    a.datAgendamento
                )
            ) appointment
            WHERE a.intAgendaId = @intAgendaId
        `;

        const result = await this.pool.request()
            .input('intAgendaId', sql.Int, intAgendaId)
            .input('skipPastAppointmentTime', sql.Bit, config.skipPastAppointmentTime ? 1 : 0)
            .query(querySelect);

        const agenda = result.recordset[0];
        if (!agenda) return { valido: false, motivo: 'slot_nao_encontrado' };
        if (Number(agenda.totalLinhasAgenda) > 1) return { valido: false, motivo: 'agenda_duplicada' };

        const nomePaciente = String(agenda.strAgenda || '').trim();
        if (!nomePaciente) return { valido: false, motivo: 'slot_sem_paciente' };

        const pacienteFila = String(queueMessage.strAgenda || '').trim();
        if (!pacienteFila) return { valido: false, motivo: 'fila_sem_paciente' };
        if (this.normalizeSnapshotText(pacienteFila) !== this.normalizeSnapshotText(agenda.strAgenda)) {
            return { valido: false, motivo: 'paciente_divergente' };
        }

        const profissionalFila = String(queueMessage.strProfissional || '').trim();
        if (profissionalFila && this.normalizeSnapshotText(profissionalFila) !== this.normalizeSnapshotText(agenda.strProfissional)) {
            return { valido: false, motivo: 'profissional_divergente' };
        }

        if (options.bloquearPresencaConfirmada && this.presencaJaConfirmada(agenda)) {
            return { valido: false, motivo: 'presenca_ja_confirmada' };
        }

        const telefoneFila = String(queueMessage.strtelefone || queueMessage.strTelefone || '').replace(/\D/g, '');
        const telefoneFilaSemPais = telefoneFila.startsWith('55') ? telefoneFila.slice(2) : telefoneFila;
        if (!telefoneFilaSemPais) return { valido: false, motivo: 'fila_sem_telefone' };
        if (telefoneFilaSemPais !== String(agenda.strTelefoneAtual || '')) {
            await this.pool.request()
                .input('id', sql.Int, queueMessage.intWhatsAppEnvioId)
                .input('novoTelefone', sql.VarChar(20), agenda.strTelefoneAtual)
                .query(`
                    SET CONTEXT_INFO 0x123456;
                    UPDATE tblWhatsAppEnvio SET strTelefone = @novoTelefone WHERE intWhatsAppEnvioId = @id;
                `);
            queueMessage.strtelefone = '55' + agenda.strTelefoneAtual;
        }

        if (queueMessage.datDataAlerta) {
            const dataFila = queueMessage.datDataAlerta instanceof Date
                ? queueMessage.datDataAlerta.toISOString().slice(0, 19).replace('T', ' ')
                : String(queueMessage.datDataAlerta || '').slice(0, 19).replace('T', ' ');
            if (dataFila && dataFila !== agenda.appointmentAtIso) {
                return { valido: false, motivo: 'compromisso_divergente' };
            }
        } else {
            return { valido: false, motivo: 'fila_sem_data_agendamento' };
        }

        const bloqueado = String(agenda.bolBloqueado ?? 'N').trim().toUpperCase();
        if (bloqueado === 'S' || bloqueado === '1') return { valido: false, motivo: 'slot_bloqueado' };

        const companyName = this.getCompanyName(config);
        if (companyName && String(agenda.strEmpresa || '').trim().toUpperCase() !== String(companyName).trim().toUpperCase()) {
            return { valido: false, motivo: 'empresa_divergente' };
        }

        if (config.messagingStartDate) {
            const dataAgendamento = String(agenda.dataAgendamentoIso || '').slice(0, 10);
            if (dataAgendamento && dataAgendamento < config.messagingStartDate) {
                return { valido: false, motivo: 'antes_data_inicio_mensageria' };
            }
        }

        if (Number(agenda.horarioPassado) === 1) {
            return { valido: false, motivo: 'horario_agendamento_passado' };
        }

        if (config.testModeEnabled && !nomePaciente.toUpperCase().includes(String(config.testPatientNameFilter || 'TESTE').toUpperCase())) {
            return { valido: false, motivo: 'fora_filtro_teste' };
        }

        return { valido: true, motivo: 'ok' };
    }

    async gerarFilaAgendamentos(config) {
        const queryInsert = `
            DECLARE @created TABLE (intWhatsAppEnvioId int);

            INSERT INTO tblWhatsAppEnvio (
                strTipo,
                bolEnviado,
                bolMensagemErro,
                bolConfirma,
                strTelefone,
                intEmpresaId,
                datWhatsAppEnvio,
                datDataAlerta,
                intAgendaId,
                strAgenda,
                intClienteId,
                intAtendimentoId,
                strProfissional,
                strProcedimento
            )
            OUTPUT inserted.intWhatsAppEnvioId INTO @created
            SELECT TOP (@limit)
                'AgendaInicio',
                'N',
                0,
                'N',
                phone.finalPhone,
                a.intEmpresaId,
                GETDATE(),
                appointment.appointmentAt,
                a.intAgendaId,
                a.strAgenda,
                a.intClienteId,
                a.intAtendimentoId,
                a.strProfissional,
                a.strProcedimento
            FROM vwAgenda a
            LEFT JOIN tblEmpresa E ON E.intEmpresaId = a.intEmpresaId
            CROSS APPLY (
                SELECT telefoneLimpo = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(a.strTelefone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), '/', '')
            ) telefone
            CROSS APPLY (
                SELECT celularLimpo = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(a.strCelular, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), '/', '')
            ) celular
            CROSS APPLY (
                SELECT rawPhone = CASE
                    WHEN LEN(celular.celularLimpo) >= 10 THEN celular.celularLimpo
                    ELSE telefone.telefoneLimpo
                END
            ) sourcePhone
            CROSS APPLY (
                SELECT finalPhone = CASE
                    WHEN LEN(sourcePhone.rawPhone) > 11 AND LEFT(sourcePhone.rawPhone, 2) = '55'
                        THEN SUBSTRING(sourcePhone.rawPhone, 3, 20)
                    ELSE sourcePhone.rawPhone
                END
            ) phone
            CROSS APPLY (
                SELECT appointmentAt = ISNULL(
                    TRY_CONVERT(datetime, CONVERT(varchar(10), a.datAgendamento, 120) + ' ' + NULLIF(a.strHora, '')),
                    a.datAgendamento
                )
            ) appointment
            WHERE a.intAgendaId IS NOT NULL
              AND NULLIF(LTRIM(RTRIM(a.strAgenda)), '') IS NOT NULL
              AND LEN(phone.finalPhone) >= 10
              AND ISNULL(CONVERT(varchar(5), a.bolBloqueado), 'N') NOT IN ('S', '1')
              AND CONVERT(DATE, a.datAgendamento) BETWEEN CONVERT(DATE, GETDATE()) AND CONVERT(DATE, DATEADD(DAY, @lookaheadDays, GETDATE()))
              AND (@companyName IS NULL OR UPPER(LTRIM(RTRIM(COALESCE(a.strEmpresa, E.strEmpresa)))) = UPPER(@companyName))
              AND (@messagingStartDate IS NULL OR CONVERT(DATE, a.datAgendamento) >= CONVERT(DATE, @messagingStartDate))
              AND (@testModeEnabled = 0 OR a.strAgenda LIKE @testNameFilter)
              AND NOT EXISTS (
                  SELECT 1
                  FROM tblWhatsAppEnvio w
                  WHERE w.intAgendaId = a.intAgendaId
                    AND w.datDataAlerta = appointment.appointmentAt
                    AND w.strTipo IN ('AgendaInicio', 'agendainicio')
                    AND (
                        (
                            ISNULL(a.intClienteId, 0) > 0
                            AND w.intClienteId = a.intClienteId
                        )
                        OR (
                            ISNULL(a.intClienteId, 0) <= 0
                            AND ISNULL(w.intClienteId, 0) <= 0
                            AND UPPER(LTRIM(RTRIM(ISNULL(w.strAgenda, '')))) = UPPER(LTRIM(RTRIM(a.strAgenda)))
                            AND ISNULL(w.strTelefone, '') = phone.finalPhone
                        )
                    )
              )
            ORDER BY a.datAgendamento, a.strHora, a.intAgendaId;

            SELECT COUNT(1) AS totalCriado FROM @created;
        `;

        const result = await this.pool.request()
            .input('limit', sql.Int, config.queueProducerLimit)
            .input('lookaheadDays', sql.Int, config.queueProducerLookaheadDays)
            .input('testModeEnabled', sql.Bit, config.testModeEnabled ? 1 : 0)
            .input('testNameFilter', sql.VarChar, `%${config.testPatientNameFilter}%`)
            .input('companyName', sql.VarChar, this.getCompanyName(config))
            .input('messagingStartDate', sql.Date, config.messagingStartDate || null)
            .query(queryInsert);

        return result.recordset[0]?.totalCriado || 0;
    }

    async listarFilaPendente(config) {
        const querySelect = `
            WITH candidatos AS (
                SELECT TOP 100
                    w.intWhatsAppEnvioId,
                    w.intAgendaId,
                    w.strTipo,
                    w.strAgenda,
                    w.strTelefone,
                    IsNull(w.bolEnviado,'N') AS bolEnviado,
                    IsNull(w.bolConfirma,'N') AS bolConfirma,
                    w.bolMensagemErro,
                    convert(varchar, w.datDataAlerta, 103) as datagenda,
                    w.datDataAlerta AS datAgendamento,
                    CONVERT(varchar(5), w.datDataAlerta, 108) AS strHora,
                    w.strProfissional,
                    COALESCE(NULLIF(LTRIM(RTRIM(w.strProcedimento)), ''), a.strEspecialidadeMedica) AS strEspecialidadeMedica,
                    a.bolAtendeHoraMarcada,
                    COALESCE(a.strEmpresa, EUnidade.strEmpresa, EVw.strEmpresa) AS strEmpresa,
                    COALESCE(a.strUnidade, '') AS strunidade,
                    CONVERT(varchar(19), w.datDataAlerta, 120) AS datDataAlerta,
                    a.strAgenda AS strAgendaAtual,
                    a.strProfissional AS strProfissionalAtual,
                    CASE
                        WHEN UPPER(LTRIM(RTRIM(ISNULL(w.strAgenda, '')))) <> UPPER(LTRIM(RTRIM(ISNULL(a.strAgenda, '')))) THEN 'paciente_divergente'
                        WHEN UPPER(LTRIM(RTRIM(ISNULL(w.strProfissional, '')))) <> UPPER(LTRIM(RTRIM(ISNULL(a.strProfissional, '')))) THEN 'profissional_divergente'
                        ELSE ''
                    END AS divergenciaAgenda,
                    CASE
                        WHEN @templateNewScheduleConfigured = 1 THEN 'agendamento'
                        ELSE 'agendamento_sem_template'
                    END AS tipoFila
                FROM tblWhatsAppEnvio W
                INNER JOIN vwAgenda a ON a.intAgendaId = w.intAgendaId
                LEFT JOIN tblAgenda TA ON TA.intAgendaId = w.intAgendaId
                LEFT JOIN tblEmpresa EUnidade ON EUnidade.intEmpresaId = TA.intUnidadeId
                LEFT JOIN tblEmpresa EVw ON EVw.intEmpresaId = a.intEmpresaId
                CROSS APPLY (
                    SELECT appointmentAt = ISNULL(
                        TRY_CONVERT(datetime, CONVERT(varchar(10), a.datAgendamento, 120) + ' ' + NULLIF(a.strHora, '')),
                        a.datAgendamento
                    )
                ) appointment
                WHERE IsNull(w.bolEnviado,'N') NOT IN ('S')
                  AND w.bolMensagemErro = 0
                  AND w.strTipo IN ('AgendaInicio', 'agendainicio')
                  AND len(w.strTelefone) >= 10
                  AND w.datDataAlerta = appointment.appointmentAt
                  AND NULLIF(LTRIM(RTRIM(a.strAgenda)), '') IS NOT NULL
                  AND NULLIF(LTRIM(RTRIM(w.strAgenda)), '') IS NOT NULL
                  AND ISNULL(CONVERT(varchar(5), a.bolBloqueado), 'N') NOT IN ('S', '1')
                  AND CONVERT(DATE, w.datDataAlerta) > CONVERT(DATE, GETDATE() + 1)
                  AND (@companyName IS NULL OR UPPER(LTRIM(RTRIM(COALESCE(a.strEmpresa, EUnidade.strEmpresa, EVw.strEmpresa)))) = UPPER(@companyName))
                  AND (@messagingStartDate IS NULL OR CONVERT(DATE, w.datDataAlerta) >= CONVERT(DATE, @messagingStartDate))
                  AND (@testModeEnabled = 0 OR w.strAgenda LIKE @testNameFilter)

                UNION ALL

                SELECT TOP 100
                    w.intWhatsAppEnvioId,
                    w.intAgendaId,
                    w.strTipo,
                    w.strAgenda,
                    w.strTelefone,
                    IsNull(w.bolEnviado,'N') AS bolEnviado,
                    IsNull(w.bolConfirma,'N') AS bolConfirma,
                    w.bolMensagemErro,
                    convert(varchar, w.datDataAlerta, 103) as datagenda,
                    w.datDataAlerta AS datAgendamento,
                    CONVERT(varchar(5), w.datDataAlerta, 108) AS strHora,
                    w.strProfissional,
                    COALESCE(NULLIF(LTRIM(RTRIM(w.strProcedimento)), ''), a.strEspecialidadeMedica) AS strEspecialidadeMedica,
                    a.bolAtendeHoraMarcada,
                    COALESCE(a.strEmpresa, EUnidade.strEmpresa, EVw.strEmpresa) AS strEmpresa,
                    COALESCE(a.strUnidade, '') AS strunidade,
                    CONVERT(varchar(19), w.datDataAlerta, 120) AS datDataAlerta,
                    a.strAgenda AS strAgendaAtual,
                    a.strProfissional AS strProfissionalAtual,
                    CASE
                        WHEN UPPER(LTRIM(RTRIM(ISNULL(w.strAgenda, '')))) <> UPPER(LTRIM(RTRIM(ISNULL(a.strAgenda, '')))) THEN 'paciente_divergente'
                        WHEN UPPER(LTRIM(RTRIM(ISNULL(w.strProfissional, '')))) <> UPPER(LTRIM(RTRIM(ISNULL(a.strProfissional, '')))) THEN 'profissional_divergente'
                        ELSE ''
                    END AS divergenciaAgenda,
                    CASE
                        WHEN @templateReminderConfigured = 1 THEN 'confirmacao'
                        WHEN @templateNewScheduleConfigured = 1 THEN 'confirmacao_fallback_agendamento'
                        ELSE 'confirmacao_sem_template'
                    END AS tipoFila
                FROM tblWhatsAppEnvio W
                INNER JOIN vwAgenda a ON a.intAgendaId = w.intAgendaId
                LEFT JOIN tblAgenda TA ON TA.intAgendaId = w.intAgendaId
                LEFT JOIN tblEmpresa EUnidade ON EUnidade.intEmpresaId = TA.intUnidadeId
                LEFT JOIN tblEmpresa EVw ON EVw.intEmpresaId = a.intEmpresaId
                CROSS APPLY (
                    SELECT appointmentAt = ISNULL(
                        TRY_CONVERT(datetime, CONVERT(varchar(10), a.datAgendamento, 120) + ' ' + NULLIF(a.strHora, '')),
                        a.datAgendamento
                    )
                ) appointment
                WHERE IsNull(w.bolConfirma,'N') NOT IN ('S')
                  AND w.bolMensagemErro = 0
                  AND len(w.strTelefone) >= 10
                  AND w.datDataAlerta = appointment.appointmentAt
                  AND NULLIF(LTRIM(RTRIM(a.strAgenda)), '') IS NOT NULL
                  AND NULLIF(LTRIM(RTRIM(w.strAgenda)), '') IS NOT NULL
                  AND ISNULL(CONVERT(varchar(5), a.bolBloqueado), 'N') NOT IN ('S', '1')
                  AND TA.datConfirmacao IS NULL
                  AND ISNULL(UPPER(LTRIM(RTRIM(TA.bolConfirmado))), 'N') NOT IN ('A', 'S')
                  AND CONVERT(DATE, w.datDataAlerta) BETWEEN CONVERT(DATE, GETDATE()) AND CONVERT(DATE, GETDATE() + 1)
                  AND (@companyName IS NULL OR UPPER(LTRIM(RTRIM(COALESCE(a.strEmpresa, EUnidade.strEmpresa, EVw.strEmpresa)))) = UPPER(@companyName))
                  AND (@messagingStartDate IS NULL OR CONVERT(DATE, w.datDataAlerta) >= CONVERT(DATE, @messagingStartDate))
                  AND (
                    @skipPastAppointmentTime = 0
                    OR ISNULL(
                        TRY_CONVERT(datetime, CONVERT(varchar(10), a.datAgendamento, 120) + ' ' + NULLIF(a.strHora, '')),
                        a.datAgendamento
                    ) >= GETDATE()
                  )
                  AND (@testModeEnabled = 0 OR w.strAgenda LIKE @testNameFilter)
                  AND NOT EXISTS (
                    SELECT 1
                    FROM tblWhatsAppEnvio wOk
                    WHERE wOk.intAgendaId = w.intAgendaId
                      AND wOk.datDataAlerta = w.datDataAlerta
                      AND IsNull(wOk.bolConfirma,'N') = 'S'
                      AND (
                        (
                            ISNULL(w.intClienteId, 0) > 0
                            AND wOk.intClienteId = w.intClienteId
                        )
                        OR (
                            ISNULL(w.intClienteId, 0) <= 0
                            AND ISNULL(wOk.intClienteId, 0) <= 0
                            AND UPPER(LTRIM(RTRIM(ISNULL(wOk.strAgenda, '')))) = UPPER(LTRIM(RTRIM(ISNULL(w.strAgenda, ''))))
                            AND ISNULL(wOk.strTelefone, '') = ISNULL(w.strTelefone, '')
                        )
                      )
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM tblWhatsAppEnvio wNewer
                    WHERE wNewer.intAgendaId = w.intAgendaId
                      AND wNewer.datDataAlerta = w.datDataAlerta
                      AND wNewer.intWhatsAppEnvioId > w.intWhatsAppEnvioId
                      AND IsNull(wNewer.bolConfirma,'N') NOT IN ('S')
                      AND wNewer.bolMensagemErro = 0
                      AND (
                        (
                            ISNULL(w.intClienteId, 0) > 0
                            AND wNewer.intClienteId = w.intClienteId
                        )
                        OR (
                            ISNULL(w.intClienteId, 0) <= 0
                            AND ISNULL(wNewer.intClienteId, 0) <= 0
                            AND UPPER(LTRIM(RTRIM(ISNULL(wNewer.strAgenda, '')))) = UPPER(LTRIM(RTRIM(ISNULL(w.strAgenda, ''))))
                            AND ISNULL(wNewer.strTelefone, '') = ISNULL(w.strTelefone, '')
                        )
                      )
                  )
            )
            SELECT TOP 100
                intWhatsAppEnvioId,
                intAgendaId,
                strTipo,
                strAgenda,
                strTelefone,
                bolEnviado,
                bolConfirma,
                bolMensagemErro,
                datagenda,
                strHora,
                strProfissional,
                strEspecialidadeMedica,
                bolAtendeHoraMarcada,
                strEmpresa,
                strunidade,
                datDataAlerta,
                strAgendaAtual,
                strProfissionalAtual,
                divergenciaAgenda,
                tipoFila
            FROM candidatos
            ORDER BY datAgendamento, strHora, intWhatsAppEnvioId
        `;

        const result = await this.pool.request()
            .input('testModeEnabled', sql.Bit, config.testModeEnabled ? 1 : 0)
            .input('testNameFilter', sql.VarChar, `%${config.testPatientNameFilter}%`)
            .input('companyName', sql.VarChar, this.getCompanyName(config))
            .input('templateNewScheduleConfigured', sql.Bit, config.templateNewSchedule ? 1 : 0)
            .input('templateReminderConfigured', sql.Bit, config.templateReminder ? 1 : 0)
            .input('messagingStartDate', sql.Date, config.messagingStartDate || null)
            .input('skipPastAppointmentTime', sql.Bit, config.skipPastAppointmentTime ? 1 : 0)
            .query(querySelect);

        return result.recordset;
    }

    // ========================================================================
    // 1. BOAS-VINDAS (Agendamentos Novos)
    // ========================================================================
    // Busca agendamentos recém-criados que ainda não receberam a mensagem inicial.
    // Regra principal: Data do agendamento deve ser FUTURA (> Hoje).
    async buscarMensagensPendentes(config = {}) {
        const querySelect = `
            SELECT top 20
                '55' + w.strTelefone as strtelefone,
                w.strTipo,
                w.strAgenda,
                w.intWhatsAppEnvioId, 
                w.intAgendaId,
                a.intNumeroProtocolo,
                CONVERT(varchar(19), w.datDataAlerta, 120) AS datDataAlerta,
                convert(varchar, w.datDataAlerta, 103) as datagenda, 
                CONVERT(varchar(5), w.datDataAlerta, 108) AS strHora, 
                w.strProfissional,
                COALESCE(NULLIF(LTRIM(RTRIM(w.strProcedimento)), ''), a.strEspecialidadeMedica) AS strEspecialidadeMedica,
                a.bolAtendeHoraMarcada,
                COALESCE(a.strEmpresa, EUnidade.strEmpresa, EVw.strEmpresa) AS strEmpresa,
                COALESCE(a.strEmpresa, EUnidade.strEmpresa, EVw.strEmpresa) AS nomeUnidade,
                a.strUnidade AS strunidade,
                dbo.fncBase64_Encode(CONVERT(VARCHAR, w.intagendaid) + '-' + CONVERT(VARCHAR, GETDATE(), 120)) AS Link
            from tblWhatsAppEnvio W
            inner join vwAgenda a on a.intAgendaId = w.intAgendaId
            left join tblAgenda TA on TA.intAgendaId = w.intAgendaId    
            left join tblEmpresa EUnidade on EUnidade.intEmpresaId = TA.intUnidadeId
            left join tblEmpresa EVw on EVw.intEmpresaId = a.intEmpresaId  
            cross apply (
                select appointmentAt = ISNULL(
                    TRY_CONVERT(datetime, CONVERT(varchar(10), a.datAgendamento, 120) + ' ' + NULLIF(a.strHora, '')),
                    a.datAgendamento
                )
            ) appointment
            where IsNull(w.bolEnviado,'N') NOT IN ('S') 
            and w.bolMensagemErro = 0
            and w.strTipo IN ('AgendaInicio', 'agendainicio')
            and len(w.strTelefone) >= 10 
            and w.datDataAlerta = appointment.appointmentAt
            and NULLIF(LTRIM(RTRIM(a.strAgenda)), '') IS NOT NULL
            and NULLIF(LTRIM(RTRIM(w.strAgenda)), '') IS NOT NULL
            and ISNULL(CONVERT(varchar(5), a.bolBloqueado), 'N') NOT IN ('S', '1')
            and CONVERT(DATE, w.datDataAlerta) > CONVERT(DATE, GETDATE() + 1)
            and (@companyName IS NULL OR UPPER(LTRIM(RTRIM(COALESCE(a.strEmpresa, EUnidade.strEmpresa, EVw.strEmpresa)))) = UPPER(@companyName))
            and (@messagingStartDate IS NULL OR CONVERT(DATE, w.datDataAlerta) >= CONVERT(DATE, @messagingStartDate))
            and (@testModeEnabled = 0 OR w.strAgenda LIKE @testNameFilter)
            order by w.datDataAlerta
        `;

        const result = await this.pool.request()
            .input('testModeEnabled', sql.Bit, config.testModeEnabled ? 1 : 0)
            .input('testNameFilter', sql.VarChar, `%${config.testPatientNameFilter || 'TESTE'}%`)
            .input('companyName', sql.VarChar, this.getCompanyName(config))
            .input('messagingStartDate', sql.Date, config.messagingStartDate || null)
            .query(querySelect);
        return result.recordset;
    }

    // ========================================================================
    // 2. CONFIRMAÇÃO / LEMBRETE
    // ========================================================================
    // Busca agendamentos que já receberam boas-vindas mas precisam de confirmação.
    // Regra principal: Enviar para agendamentos de HOJE ou AMANHÃ.
    async buscarConfirmacoesPendentes(config = {}) {
        const querySelect = `
            WITH pendentes AS (
                SELECT
                    w.intWhatsAppEnvioId,
                    ROW_NUMBER() OVER (
                        PARTITION BY
                            w.intAgendaId,
                            w.datDataAlerta,
                            CASE
                                WHEN ISNULL(w.intClienteId, 0) > 0 THEN CONVERT(varchar(20), w.intClienteId)
                                ELSE UPPER(LTRIM(RTRIM(ISNULL(w.strAgenda, '')))) + '|' + ISNULL(w.strTelefone, '')
                            END
                        ORDER BY w.intWhatsAppEnvioId DESC
                    ) AS rn
                FROM tblWhatsAppEnvio w
                WHERE IsNull(w.bolConfirma,'N') NOT IN ('S')
                  AND w.bolMensagemErro = 0
                  AND w.datDataAlerta IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1
                    FROM tblWhatsAppEnvio wOk
                    WHERE wOk.intAgendaId = w.intAgendaId
                      AND wOk.datDataAlerta = w.datDataAlerta
                      AND IsNull(wOk.bolConfirma,'N') = 'S'
                      AND (
                        (
                            ISNULL(w.intClienteId, 0) > 0
                            AND wOk.intClienteId = w.intClienteId
                        )
                        OR (
                            ISNULL(w.intClienteId, 0) <= 0
                            AND ISNULL(wOk.intClienteId, 0) <= 0
                            AND UPPER(LTRIM(RTRIM(ISNULL(wOk.strAgenda, '')))) = UPPER(LTRIM(RTRIM(ISNULL(w.strAgenda, ''))))
                            AND ISNULL(wOk.strTelefone, '') = ISNULL(w.strTelefone, '')
                        )
                      )
                  )
            )
            SELECT top 20
                '55' + w.strTelefone as strtelefone,
                w.strAgenda,
                w.intWhatsAppEnvioId, 
                w.intAgendaId,
                a.intNumeroProtocolo,
                CONVERT(varchar(19), w.datDataAlerta, 120) AS datDataAlerta,
                convert(varchar, w.datDataAlerta, 103) as datagenda, 
                CONVERT(varchar(5), w.datDataAlerta, 108) AS strHora, 
                w.strProfissional,
                COALESCE(NULLIF(LTRIM(RTRIM(w.strProcedimento)), ''), a.strEspecialidadeMedica) AS strEspecialidadeMedica,
                a.bolAtendeHoraMarcada,
                COALESCE(a.strEmpresa, EUnidade.strEmpresa, EVw.strEmpresa) AS strEmpresa,
                COALESCE(a.strEmpresa, EUnidade.strEmpresa, EVw.strEmpresa) AS nomeUnidade,
                'Av. Julia Rodrigues Torres' AS strEndereco,
                '855' AS strNumero,
                'Floresta, Belo Jardim' AS strBairro,
                'PE' AS strEstado,
                dbo.fncBase64_Encode(CONVERT(VARCHAR, w.intagendaid) + '-' + CONVERT(VARCHAR, GETDATE(), 120)) AS Link
            from tblWhatsAppEnvio W
            inner join pendentes p on p.intWhatsAppEnvioId = w.intWhatsAppEnvioId and p.rn = 1
            inner join vwAgenda a on a.intAgendaId = w.intAgendaId
            left join tblAgenda TA on TA.intAgendaId = w.intAgendaId    
            left join tblEmpresa EUnidade on EUnidade.intEmpresaId = TA.intUnidadeId
            left join tblEmpresa EVw on EVw.intEmpresaId = a.intEmpresaId  
            cross apply (
                select appointmentAt = ISNULL(
                    TRY_CONVERT(datetime, CONVERT(varchar(10), a.datAgendamento, 120) + ' ' + NULLIF(a.strHora, '')),
                    a.datAgendamento
                )
            ) appointment
            where IsNull(w.bolConfirma,'N') NOT IN ('S')
            and w.bolMensagemErro = 0
            and len(w.strTelefone) >= 10 
            and w.datDataAlerta = appointment.appointmentAt
            and NULLIF(LTRIM(RTRIM(a.strAgenda)), '') IS NOT NULL
            and NULLIF(LTRIM(RTRIM(w.strAgenda)), '') IS NOT NULL
            and ISNULL(CONVERT(varchar(5), a.bolBloqueado), 'N') NOT IN ('S', '1')
            and TA.datConfirmacao IS NULL
            and ISNULL(UPPER(LTRIM(RTRIM(TA.bolConfirmado))), 'N') NOT IN ('A', 'S')
            and (@companyName IS NULL OR UPPER(LTRIM(RTRIM(COALESCE(a.strEmpresa, EUnidade.strEmpresa, EVw.strEmpresa)))) = UPPER(@companyName))
            
            -- Regra: Enviar para agendamentos de hoje e amanhã
            and CONVERT(DATE, w.datDataAlerta) BETWEEN CONVERT(DATE, GETDATE()) AND CONVERT(DATE, GETDATE() + 1)
            and (@messagingStartDate IS NULL OR CONVERT(DATE, w.datDataAlerta) >= CONVERT(DATE, @messagingStartDate))
            and (
                @skipPastAppointmentTime = 0
                OR ISNULL(
                    TRY_CONVERT(datetime, CONVERT(varchar(10), a.datAgendamento, 120) + ' ' + NULLIF(a.strHora, '')),
                    a.datAgendamento
                ) >= GETDATE()
            )
            and (@testModeEnabled = 0 OR w.strAgenda LIKE @testNameFilter)
            order by w.datDataAlerta
        `;

        const result = await this.pool.request()
            .input('testModeEnabled', sql.Bit, config.testModeEnabled ? 1 : 0)
            .input('testNameFilter', sql.VarChar, `%${config.testPatientNameFilter || 'TESTE'}%`)
            .input('companyName', sql.VarChar, this.getCompanyName(config))
            .input('messagingStartDate', sql.Date, config.messagingStartDate || null)
            .input('skipPastAppointmentTime', sql.Bit, config.skipPastAppointmentTime ? 1 : 0)
            .query(querySelect);
        return result.recordset;
    }

    // ========================================================================
    // 3. ATUALIZAÇÃO DE STATUS (Write)
    // ========================================================================

    // Marca a mensagem de BOAS-VINDAS como enviada
    async marcarComoEnviado(id, config = {}) {
        await this.pool.request()
            .input('id', sql.Int, id)
            .input('syncAgendaWhatsappStatus', sql.Bit, config.syncAgendaWhatsappStatus ? 1 : 0)
            .query(`
                SET CONTEXT_INFO 0x123456; 
                UPDATE tblWhatsAppEnvio SET bolEnviado = 'S', bolMensagemErro = 0 WHERE intWhatsAppEnvioId = @id;

                IF @syncAgendaWhatsappStatus = 1
                BEGIN
                    UPDATE A
                    SET bolWhatsAppEnviado = 'S'
                    FROM tblAgenda A
                    INNER JOIN tblWhatsAppEnvio W ON W.intAgendaId = A.intAgendaId
                    WHERE W.intWhatsAppEnvioId = @id;
                END
            `);
    }

    async marcarConfirmacaoComoEnviada(id, config = {}) {
        await this.pool.request()
            .input('id', sql.Int, id)
            .input('syncAgendaWhatsappStatus', sql.Bit, config.syncAgendaWhatsappStatus ? 1 : 0)
            .query(`
                SET CONTEXT_INFO 0x123456; 
                -- Ao confirmar, marcamos também bolEnviado = 'S'.
                -- Isso garante que, para agendamentos do dia (onde pulamos a msg de boas-vindas),
                -- ela não seja enviada depois "atrasada".
                UPDATE tblWhatsAppEnvio 
                SET bolConfirma = 'S', bolEnviado = 'S', bolMensagemErro = 0 
                WHERE intWhatsAppEnvioId = @id;

                IF @syncAgendaWhatsappStatus = 1
                BEGIN
                    UPDATE A
                    SET bolWhatsAppEnviado = 'S'
                    FROM tblAgenda A
                    INNER JOIN tblWhatsAppEnvio W ON W.intAgendaId = A.intAgendaId
                    WHERE W.intWhatsAppEnvioId = @id;
                END
            `);
    }

    async marcarComoErro(id) {
        await this.pool.request()
            .input('idError', sql.Int, id)
            .query(`
                SET CONTEXT_INFO 0x123456; 
                UPDATE tblWhatsAppEnvio SET bolMensagemErro = 1 WHERE intWhatsAppEnvioId = @idError
            `);
    }
}

module.exports = MessageRepository;
