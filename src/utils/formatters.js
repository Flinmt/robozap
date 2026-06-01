// ========================================================================
// FORMATADORES E CONSTRUTORES DE PAYLOAD
// ========================================================================
// Este modulo limpa os dados vindos do banco e monta o JSON que a PartnerBot
// espera. O formato do payload vem da configuracao operacional ativa.

/**
 * Remove quebras de linha, aspas e retorna "-" se for vazio/nulo.
 * @param {string} texto
 * @returns {string}
 */
function limparTexto(texto) {
    if (texto === null || texto === undefined) return "-";
    const textoLimpo = String(texto).replace(/[\r\n"]/g, " ").trim();
    return textoLimpo === "" ? "-" : textoLimpo;
}

/**
 * Remove caracteres nao numericos.
 * @param {string} telefone
 * @returns {string}
 */
function limparTelefone(telefone, config = {}) {
    const apenasDigitos = String(telefone).replace(/\D/g, "");

    if (!config.normalizeBrazilMobileNinthDigit) {
        return apenasDigitos;
    }

    if (apenasDigitos.startsWith("55")) {
        const numeroNacional = apenasDigitos.slice(2);
        if (numeroNacional.length === 11 && numeroNacional[2] === "9") {
            return "55" + numeroNacional.slice(0, 2) + numeroNacional.slice(3);
        }
        return apenasDigitos;
    }

    if (apenasDigitos.length === 11 && apenasDigitos[2] === "9") {
        return apenasDigitos.slice(0, 2) + apenasDigitos.slice(3);
    }

    return apenasDigitos;
}

function montarParametrosCorpo(dados, config) {
    const parameters = [
        { type: "text", text: dados.p_agenda },
        { type: "text", text: dados.p_data },
        { type: "text", text: dados.p_hora },
        { type: "text", text: dados.p_profissional }
    ];

    if (config.includeCompany) {
        parameters.push({ type: "text", text: dados.p_empresa });
    }

    if (config.includeUnit) {
        parameters.push({ type: "text", text: dados.p_unidade });
    }

    return parameters;
}

/**
 * Monta o payload JSON para a mensagem de novo agendamento.
 * @param {string} telefoneFinal
 * @param {object} dados
 * @param {object} config
 * @returns {object}
 */
function montarPayloadAgendamento(telefoneFinal, dados, config) {
    return {
        number: telefoneFinal,
        isClosed: config.partnerbotIsClosed,
        templateData: {
            messaging_product: "whatsapp",
            to: telefoneFinal,
            type: "template",
            template: {
                name: config.templateNewSchedule,
                language: { code: "pt_BR" },
                components: [
                    {
                        type: "body",
                        parameters: montarParametrosCorpo(dados, config)
                    }
                ]
            }
        }
    };
}

/**
 * Monta o payload JSON para a mensagem de lembrete/confirmacao.
 * @param {string} telefoneFinal
 * @param {object} dados
 * @param {string} link
 * @param {object} config
 * @returns {object}
 */
function montarPayloadConfirmacao(telefoneFinal, dados, link, config) {
    const components = [
        {
            type: "body",
            parameters: montarParametrosCorpo(dados, config)
        }
    ];

    if (config.includeConfirmationButton) {
        components.push({
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [
                { type: "text", text: link }
            ]
        });
    }

    return {
        number: telefoneFinal,
        isClosed: config.partnerbotIsClosed,
        templateData: {
            messaging_product: "whatsapp",
            to: telefoneFinal,
            type: "template",
            template: {
                name: config.templateReminder,
                language: { code: "pt_BR" },
                components
            }
        }
    };
}

module.exports = {
    limparTexto,
    limparTelefone,
    montarPayloadAgendamento,
    montarPayloadConfirmacao
};
