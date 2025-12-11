const axios = require('axios');

const logger = require('../utils/logger');

class PartnerBotService {
    constructor(apiUrl, authToken) {
        this.apiUrl = apiUrl;
        this.authToken = authToken;
    }

    async enviarMensagem(payload) {
        try {
            logger.info(`[PartnerBotService] Enviando para: ${this.apiUrl}`);
            const response = await axios.post(this.apiUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.authToken
                }
            });
            return response.data;
        } catch (error) {
            // Log full error details for debugging
            if (error.response) {
                logger.error(`[PartnerBotService] Erro API WhatsApp: Status ${error.response.status}`);
                logger.error(`[PartnerBotService] Headers: ${JSON.stringify(error.response.headers)}`);
                logger.error(`[PartnerBotService] Data: ${JSON.stringify(error.response.data)}`);
            } else {
                logger.error(`[PartnerBotService] Erro sem response: ${error.message}`);
            }

            // Repassa o erro com detalhes úteis
            if (error.response && error.response.data) {
                // Tenta pegar a mensagem de erro específica do Facebook
                const fbError = error.response.data.error;
                if (fbError) {
                    throw new Error(`WhatsApp API Error: ${fbError.message} (Type: ${fbError.type}, Code: ${fbError.code}) - ${JSON.stringify(fbError)}`);
                }
                throw new Error(JSON.stringify(error.response.data));
            }
            throw new Error(error.message);
        }
    }
}

module.exports = PartnerBotService;
