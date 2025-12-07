const axios = require('axios');

class PartnerBotService {
    constructor(apiUrl, authToken) {
        this.apiUrl = apiUrl;
        this.authToken = authToken;
    }

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
            // Repassa o erro com detalhes úteis
            if (error.response && error.response.data) {
                throw new Error(JSON.stringify(error.response.data));
            }
            throw new Error(error.message);
        }
    }
}

module.exports = PartnerBotService;
