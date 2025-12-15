const { sql } = require('../config/database');

class MessageRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async buscarMensagensPendentes() {
        const querySelect = `
            SELECT TOP 20
                '55' + w.strTelefone AS strtelefone,
                CONVERT(NVARCHAR(2000), strWhatsAppEnvio) AS strMensagem,
                strTipo,
                
                CASE 
                    WHEN a.strAgenda = '' THEN W.strAgenda 
                    ELSE a.strAgenda 
                END AS strAgenda,
                
                intWhatsAppEnvioId, 
                W.intAgendaId,
                CONVERT(VARCHAR, datAgendamento, 103) AS datagenda,
                strHora,
                a.strProfissional,
                a.strEspecialidadeMedica,
                a.strEmpresa as nomeUnidade,
                a.bolAtendeHoraMarcada,
                
                ISNULL(strUnidade, 'Av. Júlia Rodrigues Torres 855 - Floresta, Belo Jardim - PE, CEP:55150-000') AS strunidade,
                
                dbo.fncBase64_Encode(CONVERT(VARCHAR, w.intagendaid) + '-' + CONVERT(VARCHAR, GETDATE(), 120)) AS Link
            
            FROM tblWhatsAppEnvio W
            INNER JOIN vwAgenda a ON a.intAgendaId = w.intAgendaId
            
            WHERE ISNULL(bolEnviado, 'N') <> 'S' 
              AND strTipo IN ('agenda', 'agendainicio', 'Cadencia')
              AND LEN(W.strTelefone) >= 10 
              AND CONVERT(DATE, datWhatsAppEnvio) = CONVERT(DATE, GETDATE())
            
            ORDER BY datWhatsAppEnvio
        `;

        const result = await this.pool.request().query(querySelect);
        return result.recordset;
    }

    async buscarConfirmacoesPendentes() {
        const querySelect = `
            SELECT top 20
                '55' + w.strTelefone as strtelefone,
                CASE WHEN a.strAgenda='' THEN W.strAgenda ELSE a.strAgenda END strAgenda,
                w.intWhatsAppEnvioId, 
                w.intAgendaId,
                convert(varchar, a.datAgendamento, 103) as datagenda, 
                a.strHora, 
                a.strProfissional,
                a.strEspecialidadeMedica,
                a.strEmpresa as nomeUnidade,
                a.bolAtendeHoraMarcada,
                
                -- Original query selected separated address fields. 
                -- To match formatters.js usage for confirmation, we previously constructed "strEndereco...".
                -- Let's provide the same keys expected by index.js -> formatters.js
                 'Av. Júlia Rodrigues Torres' as strEndereco,
                 '855' as strNumero,
                 'Floresta' as strBairro,
                 'PE' as strEstado,

                dbo.fncBase64_Encode(CONVERT(VARCHAR, w.intagendaid) + '-' + CONVERT(VARCHAR, GETDATE(), 120)) AS Link
            from tblWhatsAppEnvio W
            inner join vwAgenda a on a.intAgendaId = w.intAgendaId
            where IsNull(w.bolConfirma,'N') NOT IN ('S')
            and IsNull(w.bolEnviado,'S') NOT IN ('N')
            and w.bolMensagemErro = 0
            and len(w.strTelefone) >= 10 
            -- Regra: Enviar 1 dia antes do agendamento
            and CONVERT(DATE, a.datAgendamento) = CONVERT(DATE, GETDATE() + 1)
            order by w.datWhatsAppEnvio
        `;

        const result = await this.pool.request().query(querySelect);
        return result.recordset;
    }

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
                UPDATE tblWhatsAppEnvio SET bolConfirma = 'S', bolMensagemErro = 0 WHERE intWhatsAppEnvioId = @id
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
