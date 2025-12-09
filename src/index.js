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

        // ============================================================
        // [ETAPA 1] ENVIO DE NOVOS AGENDAMENTOS (BOAS-VINDAS)
        // ============================================================
        const mensagens = await repository.buscarMensagensPendentes();

        if (mensagens.length > 0) {
            console.log(`🔍 Encontradas ${mensagens.length} novas mensagens.`);

            for (const msg of mensagens) {
                try {
                    // Validar e Formatar
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

                    console.log(`📤 Enviando Agendamento ID ${msg.intWhatsAppEnvioId}...`);

                    // Enviar
                    await botService.enviarMensagem(payload);

                    // Atualizar Sucesso
                    await repository.marcarComoEnviado(msg.intWhatsAppEnvioId);
                    console.log(`✅ Sucesso Agendamento ID: ${msg.intWhatsAppEnvioId}`);

                } catch (error) {
                    console.error(`❌ Falha Agendamento ID ${msg.intWhatsAppEnvioId}: ${error.message}`);

                    // Atualizar Erro
                    try {
                        await repository.marcarComoErro(msg.intWhatsAppEnvioId);
                    } catch (dbErr) {
                        console.error(`   -> CRÍTICO: Falha ao marcar erro no banco: ${dbErr.message}`);
                    }
                }
            }
        }

        // ============================================================
        // [ETAPA 2] ENVIO DE LEMBRETES/CONFIRMAÇÃO (DIA ANTERIOR)
        // ============================================================
        const confirmacoes = await repository.buscarConfirmacoesPendentes();

        if (confirmacoes.length > 0) {
            console.log(`🔔 Encontrados ${confirmacoes.length} lembretes para enviar.`);

            for (const msg of confirmacoes) {
                try {
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

                    // Link para o botão (conteúdo da coluna Link)
                    const linkBotao = msg.Link || '-';

                    const payload = formatters.montarPayloadConfirmacao(telefoneFinal, dadosFormatados, linkBotao);

                    console.log(`📤 Enviando Lembrete ID ${msg.intWhatsAppEnvioId}...`);

                    await botService.enviarMensagem(payload);

                    await repository.marcarConfirmacaoComoEnviada(msg.intWhatsAppEnvioId);
                    console.log(`✅ Lembrete enviado ID: ${msg.intWhatsAppEnvioId}`);

                } catch (error) {
                    console.error(`❌ Falha Lembrete ID ${msg.intWhatsAppEnvioId}: ${error.message}`);
                    try {
                        await repository.marcarComoErro(msg.intWhatsAppEnvioId);
                    } catch (dbErr) {
                        console.error(`   -> DB Err: ${dbErr.message}`);
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