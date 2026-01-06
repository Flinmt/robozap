const axios = require('axios');

class PartnerBotService {
    // Serviço responsável pela comunicação HTTP com a API externa (PartnerBot).
    // Encapsula a complexidade do Axios e autenticação.
    constructor(apiUrl, authToken) {
        this.apiUrl = apiUrl;
        this.authToken = authToken;
    }

    // Envia o payload (JSON) para a API.
    // Retorna a resposta da API ou lança um erro detalhado em falha.
    async enviarMensagem(payload) {
        try {
            const response = await axios.post(this.apiUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.authToken
                }
            });
            return response.data;
        } catch (error) {
            // Repassa o erro com detalhes úteis par facilitar o debug
            if (error.response && error.response.data) {
                throw new Error(JSON.stringify(error.response.data));
            }
            throw new Error(error.message);
        }
    }
}

module.exports = PartnerBotService;
