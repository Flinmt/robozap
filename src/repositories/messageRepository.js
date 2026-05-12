const { sql } = require('../config/database');

class MessageRepository {
    constructor(pool) {
        this.pool = pool;
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
                intAgendaId,
                strAgenda,
                intClienteId,
                intAtendimentoId,
                strProfissional,
                strProcedimento
            )
            OUTPUT inserted.intWhatsAppEnvioId INTO @created
            SELECT TOP (@limit)
                'agendainicio',
                'N',
                0,
                'N',
                phone.finalPhone,
                a.intEmpresaId,
                GETDATE(),
                a.intAgendaId,
                a.strAgenda,
                a.intClienteId,
                a.intAtendimentoId,
                a.strProfissional,
                a.strProcedimento
            FROM vwAgenda a
            CROSS APPLY (
                SELECT telefoneLimpo = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(a.strTelefone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), '/', '')
            ) telefone
            CROSS APPLY (
                SELECT celularLimpo = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(a.strCelular, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), '/', '')
            ) celular
            CROSS APPLY (
                SELECT rawPhone = CASE
                    WHEN LEN(telefone.telefoneLimpo) >= 10 THEN telefone.telefoneLimpo
                    ELSE celular.celularLimpo
                END
            ) sourcePhone
            CROSS APPLY (
                SELECT finalPhone = CASE
                    WHEN LEN(sourcePhone.rawPhone) > 11 AND LEFT(sourcePhone.rawPhone, 2) = '55'
                        THEN SUBSTRING(sourcePhone.rawPhone, 3, 20)
                    ELSE sourcePhone.rawPhone
                END
            ) phone
            WHERE a.intAgendaId IS NOT NULL
              AND NULLIF(LTRIM(RTRIM(a.strAgenda)), '') IS NOT NULL
              AND LEN(phone.finalPhone) >= 10
              AND ISNULL(CONVERT(varchar(5), a.bolBloqueado), 'N') NOT IN ('S', '1')
              AND CONVERT(DATE, a.datAgendamento) BETWEEN CONVERT(DATE, GETDATE()) AND CONVERT(DATE, DATEADD(DAY, @lookaheadDays, GETDATE()))
              AND (@messagingStartDate IS NULL OR CONVERT(DATE, a.datAgendamento) >= CONVERT(DATE, @messagingStartDate))
              AND (@testModeEnabled = 0 OR a.strAgenda LIKE @testNameFilter)
              AND NOT EXISTS (
                  SELECT 1
                  FROM tblWhatsAppEnvio w
                  WHERE w.intAgendaId = a.intAgendaId
                    AND w.strTipo = 'agendainicio'
              )
            ORDER BY a.datAgendamento, a.strHora, a.intAgendaId;

            SELECT COUNT(1) AS totalCriado FROM @created;
        `;

        const result = await this.pool.request()
            .input('limit', sql.Int, config.queueProducerLimit)
            .input('lookaheadDays', sql.Int, config.queueProducerLookaheadDays)
            .input('testModeEnabled', sql.Bit, config.testModeEnabled ? 1 : 0)
            .input('testNameFilter', sql.VarChar, `%${config.testPatientNameFilter}%`)
            .input('messagingStartDate', sql.Date, config.messagingStartDate || null)
            .query(queryInsert);

        return result.recordset[0]?.totalCriado || 0;
    }

    async listarFilaPendente(config) {
        const querySelect = `
            SELECT TOP 100
                w.intWhatsAppEnvioId,
                w.intAgendaId,
                w.strTipo,
                CASE WHEN a.strAgenda='' THEN W.strAgenda ELSE a.strAgenda END strAgenda,
                w.strTelefone,
                IsNull(w.bolEnviado,'N') AS bolEnviado,
                IsNull(w.bolConfirma,'N') AS bolConfirma,
                w.bolMensagemErro,
                convert(varchar, a.datAgendamento, 103) as datagenda,
                a.strHora,
                a.strProfissional,
                E.strEmpresa,
                CASE
                    WHEN IsNull(w.bolEnviado,'N') NOT IN ('S')
                     AND w.bolMensagemErro = 0
                     AND w.strTipo = 'agendainicio'
                     AND len(w.strTelefone) >= 10
                     AND CONVERT(DATE, a.datAgendamento) > CONVERT(DATE, GETDATE())
                     AND (@messagingStartDate IS NULL OR CONVERT(DATE, a.datAgendamento) >= CONVERT(DATE, @messagingStartDate))
                    THEN 'agendamento'
                    WHEN IsNull(w.bolConfirma,'N') NOT IN ('S')
                     AND w.bolMensagemErro = 0
                     AND len(w.strTelefone) >= 10
                     AND (
                        (IsNull(w.bolEnviado,'S') NOT IN ('N'))
                        OR (CONVERT(DATE, a.datAgendamento) = CONVERT(DATE, GETDATE()))
                     )
                     AND CONVERT(DATE, a.datAgendamento) BETWEEN CONVERT(DATE, GETDATE()) AND CONVERT(DATE, GETDATE() + 1)
                     AND (@messagingStartDate IS NULL OR CONVERT(DATE, a.datAgendamento) >= CONVERT(DATE, @messagingStartDate))
                     AND (
                        @skipPastAppointmentTime = 0
                        OR ISNULL(
                            TRY_CONVERT(datetime, CONVERT(varchar(10), a.datAgendamento, 120) + ' ' + NULLIF(a.strHora, '')),
                            a.datAgendamento
                        ) >= GETDATE()
                     )
                    THEN 'confirmacao'
                    ELSE 'fora_dos_filtros'
                END AS tipoFila
            from tblWhatsAppEnvio W
            inner join vwAgenda a on a.intAgendaId = w.intAgendaId
            inner join tblAgenda TA on TA.intAgendaId = w.intAgendaId
            inner join tblEmpresa E on E.intEmpresaId = TA.intUnidadeId
            where w.bolMensagemErro = 0
            and (
                IsNull(w.bolEnviado,'N') NOT IN ('S')
                OR IsNull(w.bolConfirma,'N') NOT IN ('S')
            )
            and (@messagingStartDate IS NULL OR CONVERT(DATE, a.datAgendamento) >= CONVERT(DATE, @messagingStartDate))
            and (@testModeEnabled = 0 OR a.strAgenda LIKE @testNameFilter OR W.strAgenda LIKE @testNameFilter)
            order by a.datAgendamento, a.strHora, w.intWhatsAppEnvioId
        `;

        const result = await this.pool.request()
            .input('testModeEnabled', sql.Bit, config.testModeEnabled ? 1 : 0)
            .input('testNameFilter', sql.VarChar, `%${config.testPatientNameFilter}%`)
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
                CASE WHEN a.strAgenda='' THEN W.strAgenda ELSE a.strAgenda END strAgenda,
                w.intWhatsAppEnvioId, 
                w.intAgendaId,
                convert(varchar, a.datAgendamento, 103) as datagenda, 
                a.strHora, 
                a.strProfissional,
                E.strEmpresa,
                E.strEndereco,
                E.strNumero,
                E.strBairro,
                E.strEstado,
                dbo.fncBase64_Encode(CONVERT(VARCHAR, w.intagendaid) + '-' + CONVERT(VARCHAR, GETDATE(), 120)) AS Link
            from tblWhatsAppEnvio W
            inner join vwAgenda a on a.intAgendaId = w.intAgendaId
            inner join tblAgenda TA on TA.intAgendaId = w.intAgendaId    
            inner join tblEmpresa E on E.intEmpresaId = TA.intUnidadeId  
            where IsNull(w.bolEnviado,'N') NOT IN ('S') 
            and w.bolMensagemErro = 0
            and w.strTipo = 'agendainicio' 
            and len(w.strTelefone) >= 10 
            and CONVERT(DATE, a.datAgendamento) > CONVERT(DATE, GETDATE())
            and (@messagingStartDate IS NULL OR CONVERT(DATE, a.datAgendamento) >= CONVERT(DATE, @messagingStartDate))
            and (@testModeEnabled = 0 OR a.strAgenda LIKE @testNameFilter OR W.strAgenda LIKE @testNameFilter)
            order by a.datAgendamento
        `;

        const result = await this.pool.request()
            .input('testModeEnabled', sql.Bit, config.testModeEnabled ? 1 : 0)
            .input('testNameFilter', sql.VarChar, `%${config.testPatientNameFilter || 'TESTE'}%`)
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
            SELECT top 20
                '55' + w.strTelefone as strtelefone,
                CASE WHEN a.strAgenda='' THEN W.strAgenda ELSE a.strAgenda END strAgenda,
                w.intWhatsAppEnvioId, 
                w.intAgendaId,
                convert(varchar, a.datAgendamento, 103) as datagenda, 
                a.strHora, 
                a.strProfissional,
                E.strEmpresa,
                E.strEndereco,
                E.strNumero,
                E.strBairro,
                E.strEstado,
                dbo.fncBase64_Encode(CONVERT(VARCHAR, w.intagendaid) + '-' + CONVERT(VARCHAR, GETDATE(), 120)) AS Link
            from tblWhatsAppEnvio W
            inner join vwAgenda a on a.intAgendaId = w.intAgendaId
            inner join tblAgenda TA on TA.intAgendaId = w.intAgendaId    
            inner join tblEmpresa E on E.intEmpresaId = TA.intUnidadeId  
            where IsNull(w.bolConfirma,'N') NOT IN ('S')
            and w.bolMensagemErro = 0
            and len(w.strTelefone) >= 10 
            
            -- Lógica complexa de envio:
            -- 1. Se for agendamento futuro: Só envia lembrete se JÁ tiver enviado boas-vindas (bolEnviado != 'N')
            -- 2. Se for agendamento HOJE: Envia lembrete DIRETO (ignora checagem de boas-vindas), pois servirá como confirmação dupla.
            and (
                (IsNull(w.bolEnviado,'S') NOT IN ('N')) -- Regra padrão
                OR 
                (CONVERT(DATE, a.datAgendamento) = CONVERT(DATE, GETDATE())) -- Exceção para o dia
            ) 
            -- Regra: Enviar para agendamentos de hoje e amanhã
            and CONVERT(DATE, a.datAgendamento) BETWEEN CONVERT(DATE, GETDATE()) AND CONVERT(DATE, GETDATE() + 1)
            and (@messagingStartDate IS NULL OR CONVERT(DATE, a.datAgendamento) >= CONVERT(DATE, @messagingStartDate))
            and (
                @skipPastAppointmentTime = 0
                OR ISNULL(
                    TRY_CONVERT(datetime, CONVERT(varchar(10), a.datAgendamento, 120) + ' ' + NULLIF(a.strHora, '')),
                    a.datAgendamento
                ) >= GETDATE()
            )
            and (@testModeEnabled = 0 OR a.strAgenda LIKE @testNameFilter OR W.strAgenda LIKE @testNameFilter)
            order by a.datAgendamento
        `;

        const result = await this.pool.request()
            .input('testModeEnabled', sql.Bit, config.testModeEnabled ? 1 : 0)
            .input('testNameFilter', sql.VarChar, `%${config.testPatientNameFilter || 'TESTE'}%`)
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
