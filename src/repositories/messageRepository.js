const { sql } = require('../config/database');

class MessageRepository {
    constructor(pool) {
        this.pool = pool;
    }

    // ========================================================================
    // 1. BOAS-VINDAS (Agendamentos Novos)
    // ========================================================================
    // Busca agendamentos recem-criados que ainda nao receberam a mensagem inicial.
    async buscarMensagensPendentes() {
        const querySelect = `
            ;WITH Ranked AS (
                SELECT
                    w.intWhatsAppEnvioId,
                    w.intAgendaId,
                    w.strWhatsAppEnvio,
                    w.strTipo,
                    w.strAgenda AS strAgendaFila,
                    w.bolEnviado,
                    w.bolMensagemErro,
                    w.datWhatsAppEnvio,
                    a.strTelefone,
                    a.strAgenda,
                    a.datAgendamento,
                    a.strHora,
                    a.strProfissional,
                    a.strEspecialidadeMedica,
                    a.strEmpresa,
                    a.bolAtendeHoraMarcada,
                    a.strUnidade,
                    ROW_NUMBER() OVER (
                        PARTITION BY w.intAgendaId
                        ORDER BY w.intWhatsAppEnvioId DESC
                    ) AS rn
                FROM tblWhatsAppEnvio w
                INNER JOIN vwAgenda a ON a.intAgendaId = w.intAgendaId
            ),
            Base AS (
                SELECT *
                FROM Ranked
                WHERE rn = 1
                  AND ISNULL(bolEnviado, 'N') <> 'S'
                  AND strTipo IN ('agenda', 'agendainicio', 'Cadencia')
                  AND LEN(strTelefone) >= 10
                  AND CONVERT(DATE, datWhatsAppEnvio) = CONVERT(DATE, GETDATE())
                  AND CONVERT(DATE, datAgendamento) > CONVERT(DATE, GETDATE() + 1)
            )
            SELECT TOP 20
                '55' + strTelefone AS strtelefone,
                CONVERT(NVARCHAR(2000), strWhatsAppEnvio) AS strMensagem,
                strTipo,
                CASE
                    WHEN strAgenda = '' THEN strAgendaFila
                    ELSE strAgenda
                END AS strAgenda,
                intWhatsAppEnvioId,
                intAgendaId,
                CONVERT(VARCHAR, datAgendamento, 103) AS datagenda,
                strHora,
                strProfissional,
                strEspecialidadeMedica,
                strEmpresa AS nomeUnidade,
                bolAtendeHoraMarcada,
                ISNULL(strUnidade, 'Av. Julia Rodrigues Torres 855 - Floresta, Belo Jardim - PE, CEP:55150-000') AS strunidade,
                dbo.fncBase64_Encode(CONVERT(VARCHAR, intAgendaId) + '-' + CONVERT(VARCHAR, GETDATE(), 120)) AS Link
            FROM Base
            ORDER BY datWhatsAppEnvio
        `;

        const result = await this.pool.request().query(querySelect);
        return result.recordset;
    }

    // ========================================================================
    // 2. CONFIRMACAO / LEMBRETE
    // ========================================================================
    // Busca agendamentos que ja receberam boas-vindas mas precisam de confirmacao.
    // Regra principal: enviar para agendamentos de hoje ou amanha.
    async buscarConfirmacoesPendentes() {
        const querySelect = `
            ;WITH Ranked AS (
                SELECT
                    w.intWhatsAppEnvioId,
                    w.intAgendaId,
                    w.strAgenda AS strAgendaFila,
                    w.strTipo,
                    w.bolConfirma,
                    w.bolEnviado,
                    w.bolMensagemErro,
                    w.datWhatsAppEnvio,
                    a.strTelefone,
                    a.strAgenda,
                    a.datAgendamento,
                    a.strHora,
                    a.strProfissional,
                    a.strEspecialidadeMedica,
                    a.strEmpresa,
                    a.bolAtendeHoraMarcada,
                    ROW_NUMBER() OVER (
                        PARTITION BY w.intAgendaId
                        ORDER BY w.intWhatsAppEnvioId DESC
                    ) AS rn
                FROM tblWhatsAppEnvio w
                INNER JOIN vwAgenda a ON a.intAgendaId = w.intAgendaId
            ),
            Base AS (
                SELECT *
                FROM Ranked
                WHERE rn = 1
                  AND ISNULL(bolConfirma, 'N') NOT IN ('S')
                  AND CONVERT(DATE, datAgendamento)
                      BETWEEN CONVERT(DATE, GETDATE()) AND CONVERT(DATE, GETDATE() + 1)
                  AND bolMensagemErro = 0
                  AND LEN(strTelefone) >= 10
            )
            SELECT TOP 20
                '55' + strTelefone AS strtelefone,
                CASE
                    WHEN strAgenda = '' THEN strAgendaFila
                    ELSE strAgenda
                END AS strAgenda,
                intWhatsAppEnvioId,
                intAgendaId,
                CONVERT(VARCHAR, datAgendamento, 103) AS datagenda,
                strHora,
                strProfissional,
                strEspecialidadeMedica,
                strEmpresa AS nomeUnidade,
                bolAtendeHoraMarcada,
                'Av. Julia Rodrigues Torres' AS strEndereco,
                '855' AS strNumero,
                'Floresta, Belo Jardim' AS strBairro,
                'PE' AS strEstado,
                dbo.fncBase64_Encode(CONVERT(VARCHAR, intAgendaId) + '-' + CONVERT(VARCHAR, GETDATE(), 120)) AS Link
            FROM Base
            ORDER BY datWhatsAppEnvio
        `;

        const result = await this.pool.request().query(querySelect);
        return result.recordset;
    }

    // ========================================================================
    // 3. ATUALIZACAO DE STATUS (Write)
    // ========================================================================

    async marcarComoEnviado(id) {
        await this.pool.request()
            .input('id', sql.Int, id)
            .query(`
                SET CONTEXT_INFO 0x123456;
                UPDATE tblWhatsAppEnvio SET bolEnviado = 'S', bolMensagemErro = 0 WHERE intWhatsAppEnvioId = @id
            `);
    }

    async marcarConfirmacaoComoEnviada(id) {
        await this.pool.request()
            .input('id', sql.Int, id)
            .query(`
                SET CONTEXT_INFO 0x123456;
                UPDATE tblWhatsAppEnvio
                SET bolConfirma = 'S', bolEnviado = 'S', bolMensagemErro = 0
                WHERE intWhatsAppEnvioId = @id
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
