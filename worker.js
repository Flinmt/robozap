require('dotenv').config();
const sql = require('mssql');
const axios = require('axios');
const express = require('express');

// --- CONFIGURAÇÃO DO SERVIDOR WEB ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('O Robô do WhatsApp está rodando! 🤖 (Template: confirma_nova)');
});

app.listen(PORT, () => {
    console.log(`Servidor Web ouvindo na porta ${PORT}`);
});

// --- CONFIGURAÇÃO DO BANCO DE DADOS ---
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME || 'biodata',
    options: {
        encrypt: false, 
        trustServerCertificate: true,
        enableArithAbort: true
    }
};

// --- CONFIGURAÇÕES PARTNERBOT ---
const PARTNERBOT_URL = 'https://painel.partnerbot.com.br/v2/api/external/de10bffc-f911-4d63-ac53-80b6648aa5d4/template';
const AUTH_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0ZW5hbnRJZCI6OSwicHJvZmlsZSI6ImFkbWluIiwic2Vzc2lvbklkIjo4OSwiaWF0IjoxNzY0MzY2NzI1LCJleHAiOjE4Mjc0Mzg3MjV9.GC18WTtV-nqwQCV9b0GbJsx1dvW2RuHeTbwuy-CDCow';

const INTERVALO_CHECK = 10000;

// Função para limpar texto (Remove aspas, quebras de linha e evita vazio)
function limparTexto(texto) {
    if (texto === null || texto === undefined) return "-"; 
    const textoLimpo = String(texto).replace(/[\r\n"]/g, " ").trim();
    return textoLimpo === "" ? "-" : textoLimpo;
}

async function processarFila() {
    let pool;
    try {
        pool = await sql.connect(dbConfig);

        // SELECIONA MENSAGENS PENDENTES (Apenas <> 'S')
        // Alteração: JOIN com tblAgenda e tblEmpresa para montar o endereço dinâmico
        const querySelect = `
            SELECT top 20
                '55' + w.strTelefone as strtelefone,
                w.strTipo,
                CASE WHEN a.strAgenda='' THEN W.strAgenda ELSE a.strAgenda END strAgenda,
                w.intWhatsAppEnvioId, 
                w.intAgendaId,
                convert(varchar, w.datAgendamento, 103) as datagenda,
                w.strHora,
                a.strProfissional,
                -- MONTAGEM DO ENDEREÇO VIA TBLEMPRESA:
                (ISNULL(E.strEndereco, '') + ', ' + ISNULL(E.strNumero, 'S/N') + ' - ' + ISNULL(E.strBairro, '') + ' - ' + ISNULL(E.strEstado, '')) as strunidade,
                dbo.fncBase64_Encode(CONVERT(VARCHAR, w.intagendaid) + '-' + CONVERT(VARCHAR, GETDATE(), 120)) AS Link
            from tblWhatsAppEnvio W
            inner join vwAgenda a on a.intAgendaId = w.intAgendaId
            inner join tblAgenda TA on TA.intAgendaId = w.intAgendaId    -- 1. Pega a Agenda real
            inner join tblEmpresa E on E.intEmpresaId = TA.intEmpresaId  -- 2. Pega a Empresa pelo ID da Agenda
            where IsNull(w.bolEnviado,'N') NOT IN ('S', 'E') 
            and w.strTipo = 'agendainicio' 
            and len(w.strTelefone) >= 10 
            AND CONVERT(DATE, w.datWhatsAppEnvio) = CONVERT(DATE, GETDATE())
            order by w.datWhatsAppEnvio
        `;

        const result = await pool.request().query(querySelect);
        const listaEnvio = result.recordset;

        if (listaEnvio.length > 0) {
            console.log(`🔍 Encontradas ${listaEnvio.length} mensagens.`);
            
            for (const msg of listaEnvio) {
                try {
                    // 1. PREPARAÇÃO DOS DADOS
                    const telefoneFinal = String(msg.strtelefone).replace(/\D/g, ""); // Só números
                    
                    // Validação de segurança do número
                    if (!telefoneFinal || telefoneFinal.length < 10) {
                         throw new Error(`Número inválido: '${telefoneFinal}'`);
                    }

                    // Variáveis mapeadas
                    const p_agenda = limparTexto(msg.strAgenda);
                    const p_data = limparTexto(msg.datagenda);
                    const p_hora = limparTexto(msg.strHora);
                    const p_profissional = limparTexto(msg.strProfissional);
                    const p_unidade = limparTexto(msg.strunidade); // Agora vem da tblEmpresa

                    // 2. MONTAGEM DO JSON
                    const payload = {
                        number: telefoneFinal,
                        isClosed: false,
                        templateData: {
                            messaging_product: "whatsapp",
                            to: telefoneFinal,
                            type: "template",
                            template: {
                                name: "confirma_nova",
                                language: {
                                    code: "pt_BR"
                                },
                                components: [
                                    {
                                        type: "body",
                                        parameters: [
                                            { type: "text", text: p_agenda },       // "paciente"
                                            { type: "text", text: p_data },         // "data"
                                            { type: "text", text: p_hora },         // "hora"
                                            { type: "text", text: p_profissional }, // "médico"
                                            { type: "text", text: p_unidade }       // "endereço" (tblEmpresa)
                                        ]
                                    }
                                ]
                            }
                        }
                    };

                    console.log(`📤 Enviando ID ${msg.intWhatsAppEnvioId} para ${telefoneFinal}...`);
                    
                    // 3. ENVIO
                    await axios.post(PARTNERBOT_URL, payload, {
                        headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_TOKEN }
                    });

                    // 4. ATUALIZAÇÃO (SUCESSO)
                    // Agora enviamos o CONTEXT_INFO 0x123456 antes do UPDATE para passar pelo Trigger
                    await pool.request()
                        .input('id', sql.Int, msg.intWhatsAppEnvioId)
                        .query(`
                            SET CONTEXT_INFO 0x123456; 
                            UPDATE tblWhatsAppEnvio SET bolEnviado = 'S' WHERE intWhatsAppEnvioId = @id
                        `);
                    
                    console.log(`✅ Sucesso ID: ${msg.intWhatsAppEnvioId}`);

                } catch (errEnvio) {
                    // 5. TRATAMENTO DE ERRO
                    // NÃO ATUALIZA O BANCO (Mantém como 'N')
                    let errorMsg = errEnvio.message;
                    if (errEnvio.response && errEnvio.response.data) {
                        try { errorMsg = JSON.stringify(errEnvio.response.data); } catch(e) {}
                    }
                    console.error(`❌ Falha ID ${msg.intWhatsAppEnvioId}: ${errorMsg}`);
                    console.error(`   -> Mensagem mantida na fila (Status 'N').`);
                }
            }
        }
    } catch (err) {
        console.error("⚠️ Erro Geral:", err.message);
    } finally {
        if (pool) pool.close();
    }
}

setInterval(processarFila, INTERVALO_CHECK);
console.log("🚀 Robô Iniciado. Configuração: Template 'confirma_nova'.");