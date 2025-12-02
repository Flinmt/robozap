require('dotenv').config();
const sql = require('mssql');
const axios = require('axios');
const express = require('express');

// --- CONFIGURAÇÃO DO SERVIDOR WEB ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('O Robô do WhatsApp está rodando! 🤖');
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
const PARTNERBOT_URL = process.env.URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

const INTERVALO_CHECK = 10000;

function limparTexto(texto) {
    if (texto === null || texto === undefined) return "-"; 
    const textoLimpo = String(texto).replace(/[\r\n"]/g, " ").trim();
    return textoLimpo === "" ? "-" : textoLimpo;
}

async function processarFila() {
    let pool;
    try {
        pool = await sql.connect(dbConfig);

        // QUERY ORIGINAL (Mantida conforme solicitado por enquanto)
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
                // Definimos 'E' como padrão. Se der tudo certo, muda para 'S'.
                let statusEnvio = 'E';
                let obsErro = '';

                try {
                    // 1. PREPARAÇÃO DOS DADOS
                    const telefoneFinal = String(msg.strtelefone).replace(/\D/g, "");
                    
                    if (!telefoneFinal || telefoneFinal.length < 10) {
                         throw new Error(`Número inválido: '${telefoneFinal}'`);
                    }

                    const p_agenda = limparTexto(msg.strAgenda);
                    const p_data = limparTexto(msg.datagenda);
                    const p_hora = limparTexto(msg.strHora);
                    const p_profissional = limparTexto(msg.strProfissional);
                    const p_empresa = limparTexto(msg.strEmpresa);

                    const end_rua = msg.strEndereco || '';
                    const end_num = msg.strNumero || 'S/N';
                    const end_bairro = msg.strBairro || '';
                    const end_uf = msg.strEstado || '';
                    const enderecoCompleto = `${end_rua}, ${end_num} - ${end_bairro} - ${end_uf}`;
                    const p_unidade = limparTexto(enderecoCompleto);

                    // 2. MONTAGEM DO JSON (Mantido o original por enquanto)
                    const payload = {
                        number: telefoneFinal,
                        isClosed: true,
                        templateData: {
                            messaging_product: "whatsapp",
                            to: telefoneFinal,
                            type: "template",
                            template: {
                                name: "novoagendamento_2",
                                language: { code: "pt_BR" },
                                components: [
                                    {
                                        type: "body",
                                        parameters: [
                                            { type: "text", text: p_agenda },
                                            { type: "text", text: p_data },
                                            { type: "text", text: p_hora },
                                            { type: "text", text: p_profissional },
                                            { type: "text", text: p_empresa },
                                            { type: "text", text: p_unidade }
                                        ]
                                    }
                                ]
                            }
                        }
                    };

                    console.log(`📤 Enviando ID ${msg.intWhatsAppEnvioId} para ${telefoneFinal}...`);
                    
                    // 3. ENVIO COM VALIDAÇÃO DE STATUS
                    // 'validateStatus: () => true' impede que o axios jogue erro em 400/500
                    const response = await axios.post(PARTNERBOT_URL, payload, {
                        headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_TOKEN },
                        validateStatus: () => true 
                    });

                    // 4. VERIFICAÇÃO DO RETORNO (200 = S, Resto = E)
                    if (response.status === 200) {
                        statusEnvio = 'S';
                        console.log(`✅ Sucesso ID: ${msg.intWhatsAppEnvioId} (Status 200)`);
                    } else {
                        statusEnvio = 'E';
                        // Tenta pegar mensagem de erro da API se existir
                        const detalheErro = JSON.stringify(response.data);
                        obsErro = `API Status ${response.status}: ${detalheErro}`;
                        console.error(`❌ Erro API ID ${msg.intWhatsAppEnvioId}: ${obsErro}`);
                    }

                } catch (errEnvio) {
                    // Erros de rede, timeout, ou falha no código de preparação
                    statusEnvio = 'E';
                    obsErro = errEnvio.message;
                    console.error(`❌ Falha Crítica ID ${msg.intWhatsAppEnvioId}: ${obsErro}`);
                }

                // 5. ATUALIZAÇÃO NO BANCO (Agora acontece para S e para E)
                try {
                    await pool.request()
                        .input('id', sql.Int, msg.intWhatsAppEnvioId)
                        .input('status', sql.VarChar, statusEnvio) // Passamos a variável calculada
                        .query(`
                            SET CONTEXT_INFO 0x123456; 
                            UPDATE tblWhatsAppEnvio 
                            SET bolEnviado = @status 
                            WHERE intWhatsAppEnvioId = @id
                        `);
                    
                    // Se quiser, pode logar quando atualiza para E no banco
                    if (statusEnvio === 'E') {
                        console.log(`   -> Status atualizado para 'E' no banco.`);
                    }

                } catch (errDb) {
                    console.error(`⚠️ Erro ao atualizar banco ID ${msg.intWhatsAppEnvioId}: ${errDb.message}`);
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
console.log("🚀 Robô Iniciado. Validação de Status Ativa (200=S, Else=E).");