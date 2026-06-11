const axios = require('axios');

class PartnerBotService {
    // Serviço responsável pela comunicação HTTP com a API externa (PartnerBot).
    // Encapsula a complexidade do Axios e autenticação.
    constructor(apiUrl, authToken, showTicketUrl) {
        this.apiUrl = apiUrl;
        this.authToken = authToken;
        this.showTicketUrl = showTicketUrl;
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

    async verificarTicketAberto(number) {
        if (!this.showTicketUrl) {
            throw new Error('SHOWTICKET_URL nao configurado.');
        }

        try {
            const response = await axios.post(this.showTicketUrl, { number }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.authToken
                }
            });

            return {
                encontrado: this.temTicketAberto(response.data),
                data: response.data
            };
        } catch (error) {
            if (error.response && error.response.data) {
                if (this.isTicketNotFoundResponse(error.response.data)) {
                    return {
                        encontrado: false,
                        data: error.response.data
                    };
                }

                throw new Error(JSON.stringify(error.response.data));
            }
            throw new Error(error.message);
        }
    }

    isTicketNotFoundResponse(data) {
        const apiError = data && data.error;
        return apiError === 'ERR_CONTACT_NOT_FOUND' || apiError === 'ERR_TICKET_NOT_FOUND';
    }

    temTicketAberto(data) {
        if (!data) return false;
        if (typeof data === 'boolean') return data;
        if (Array.isArray(data)) return data.length > 0;
        if (typeof data !== 'object') return false;

        if (this.isTicketNotFoundResponse(data)) return false;
        if (data.success === false) return false;

        for (const key of ['encontrado', 'found', 'exists', 'hasTicket', 'open', 'isOpen']) {
            if (typeof data[key] === 'boolean') return data[key];
        }

        if (data.success === true && data.ticket === undefined && data.data === undefined && data.result === undefined) {
            return true;
        }

        for (const key of ['isClosed', 'closed']) {
            if (typeof data[key] === 'boolean') return !data[key];
        }

        if (typeof data.status === 'string') {
            const status = data.status.toLowerCase();
            if (['open', 'opened', 'aberto'].includes(status)) return true;
            if (['closed', 'fechado', 'finalizado', 'resolved', 'resolvido'].includes(status)) return false;
        }

        for (const key of ['ticket', 'data', 'result']) {
            if (data[key] !== undefined) return this.temTicketAberto(data[key]);
        }

        return Object.keys(data).length > 0;
    }
}

module.exports = PartnerBotService;
