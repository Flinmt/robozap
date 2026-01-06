const { sql } = require('../config/database');

class MessageRepository {
    constructor(pool) {
        this.pool = pool;
    }

    // ========================================================================
    // 1. BOAS-VINDAS (Agendamentos Novos)
    // ========================================================================
    // Busca agendamentos recém-criados que ainda não receberam a mensagem inicial.
    // Regra principal: Data do agendamento deve ser FUTURA (> Hoje).
    async buscarMensagensPendentes() {
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
            order by a.datAgendamento
        `;

        const result = await this.pool.request().query(querySelect);
        return result.recordset;
    }

    // ========================================================================
    // 2. CONFIRMAÇÃO / LEMBRETE
    // ========================================================================
    // Busca agendamentos que já receberam boas-vindas mas precisam de confirmação.
    // Regra principal: Enviar para agendamentos de HOJE ou AMANHÃ.
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
            order by a.datAgendamento
        `;

        const result = await this.pool.request().query(querySelect);
        return result.recordset;
    }

    // ========================================================================
    // 3. ATUALIZAÇÃO DE STATUS (Write)
    // ========================================================================

    // Marca a mensagem de BOAS-VINDAS como enviada
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
                -- Ao confirmar, marcamos também bolEnviado = 'S'.
                -- Isso garante que, para agendamentos do dia (onde pulamos a msg de boas-vindas),
                -- ela não seja enviada depois "atrasada".
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
