const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const database = require('./config/database');
const MessageRepository = require('./repositories/messageRepository');
const PartnerBotService = require('./services/partnerBotService');
const formatters = require('./utils/formatters');

// ==========================================
// 1. CONFIGURAÇÃO (INSTANCIAMENTO)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const PARTNERBOT_URL = process.env.URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const INTERVALO_CHECK = 10000;

// Serviço de envio (Stateful, configurado uma vez)
const botService = new PartnerBotService(PARTNERBOT_URL, AUTH_TOKEN);

// Variável de controle de concorrência
let isProcessing = false;

// ==========================================
// 2. SERVIDOR WEB (HEALTH CHECK)
// ==========================================
app.get('/', (req, res) => res.send('O Robô do WhatsApp está rodando! 🤖'));
app.listen(PORT, () => console.log(`✅ Servidor Web monitorando na porta ${PORT}`));

// ==========================================
// 3. LOGICA PRINCIPAL (WORKER)
// ==========================================
async function processarFila() {
    if (isProcessing) {
        console.log("⏳ Aguardando ciclo anterior...");
        return;
    }
    isProcessing = true;

    let pool;
    try {
        pool = await database.connect();
        const repository = new MessageRepository(pool);

        // [PASSO 1] Buscar
        const mensagens = await repository.buscarMensagensPendentes();

        if (mensagens.length > 0) {
            console.log(`🔍 Encontradas ${mensagens.length} mensagens.`);

            for (const msg of mensagens) {
                try {
                    // [PASSO 2] Validar e Formatar
                    const telefoneFinal = formatters.limparTelefone(msg.strtelefone);

                    if (!telefoneFinal || telefoneFinal.length < 10) {
                        throw new Error(`Número inválido: '${telefoneFinal}'`);
                    }

                    const dadosFormatados = {
                        p_agenda: formatters.limparTexto(msg.strAgenda),
                        p_data: formatters.limparTexto(msg.datagenda),
                        p_hora: formatters.limparTexto(msg.strHora),
                        p_profissional: formatters.limparTexto(msg.strProfissional),
                        p_empresa: formatters.limparTexto(msg.strEmpresa),
                        p_unidade: formatters.limparTexto(`${msg.strEndereco || ''}, ${msg.strNumero || 'S/N'} - ${msg.strBairro || ''} - ${msg.strEstado || ''}`)
                    };

                    const payload = formatters.montarPayloadAgendamento(telefoneFinal, dadosFormatados);

                    console.log(`📤 Enviando ID ${msg.intWhatsAppEnvioId}...`);

                    // [PASSO 3] Enviar
                    await botService.enviarMensagem(payload);

                    // [PASSO 4] Atualizar Sucesso
                    await repository.marcarComoEnviado(msg.intWhatsAppEnvioId);
                    console.log(`✅ Sucesso ID: ${msg.intWhatsAppEnvioId}`);

                } catch (error) {
                    console.error(`❌ Falha ID ${msg.intWhatsAppEnvioId}: ${error.message}`);

                    // [PASSO 5] Atualizar Erro
                    try {
                        await repository.marcarComoErro(msg.intWhatsAppEnvioId);
                    } catch (dbErr) {
                        console.error(`   -> CRÍTICO: Falha ao marcar erro no banco: ${dbErr.message}`);
                    }
                }
            }
        }
    } catch (err) {
        console.error("⚠️ Erro Geral:", err.message);
    } finally {
        if (pool) pool.close();
        isProcessing = false;
    }
}

// Inicia
setInterval(processarFila, INTERVALO_CHECK);
console.log("🚀 Worker Modular Iniciado.");