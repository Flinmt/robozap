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
 * Formata o horário. Se bolAtendeHoraMarcada for 'N', retorna "Turno - Por Ordem de Chegada".
 * @param {string} horario 
 * @param {string} bolAtendeHoraMarcada 
 * @returns {string}
 */
function formatarHorario(horario, bolAtendeHoraMarcada) {
    // Se "S" (Sim) ou nulo/indefinido (assalume sim para manter compatibilidade), retorna o horário normal (limpo)
    if (!bolAtendeHoraMarcada || bolAtendeHoraMarcada.toUpperCase() === 'S') {
        const limpo = limparTexto(horario);
        return limpo;
    }

    // Se veio aqui, é 'N' -> Ordem de chegada
    // Tenta extrair a hora
    // Formato esperado: "HH:mm" ou "HH:mm:ss"
    const horaLimpa = limparTexto(horario);
    if (horaLimpa === '-') return "Por Ordem de Chegada"; // Fallback

    const match = horaLimpa.match(/^(\d{1,2})/); // Pega o primeiro grupo de digitos
    if (!match) return "Por Ordem de Chegada";

    const horaInt = parseInt(match[1], 10);
    let turno = "";

    if (horaInt >= 0 && horaInt <= 11) {
        turno = "Manhã";
    } else if (horaInt >= 12 && horaInt <= 17) {
        turno = "Tarde";
    } else {
        turno = "Noite";
    }

    return `${horaLimpa} - ${turno} - Por Ordem de Chegada`;
}

/**
 * Remove caracteres não numéricos.
 * @param {string} telefone 
 * @returns {string}
 */
function limparTelefone(telefone) {
    return String(telefone).replace(/\D/g, "");
}

/**
 * Monta o payload JSON para a API do PartnerBot.
 * @param {string} telefoneFinal 
 * @param {object} dados - Objeto com os campos p_agenda, p_data, etc.
 * @returns {object}
 */
function montarPayloadAgendamento(telefoneFinal, dados) {
    return {
        number: telefoneFinal,
        isClosed: true,
        templateData: {
            messaging_product: "whatsapp",
            to: telefoneFinal,
            type: "template",
            template: {
                name: process.env.TEMPLATE_NEW_SCHEDULE,
                language: { code: "pt_BR" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            { type: "text", text: dados.p_agenda },
                            { type: "text", text: dados.p_data },
                            { type: "text", text: dados.p_hora },
                            { type: "text", text: dados.p_profissional },
                            { type: "text", text: dados.p_especialidade },
                            { type: "text", text: dados.p_nome_unidade },
                            { type: "text", text: dados.p_unidade }
                        ]
                    }
                ]
            }
        }
    };
}

/**
 * Monta o payload JSON para a mensagem de lembrete/confirmação.
 * @param {string} telefoneFinal 
 * @param {object} dados - Objeto com os campos formateados.
 * @param {string} link - URL para o botão.
 * @returns {object}
 */
function montarPayloadConfirmacao(telefoneFinal, dados, link) {
    return {
        number: telefoneFinal,
        isClosed: true,
        templateData: {
            messaging_product: "whatsapp",
            to: telefoneFinal,
            type: "template",
            template: {
                name: process.env.TEMPLATE_REMINDER,
                language: { code: "pt_BR" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            { type: "text", text: dados.p_agenda },
                            { type: "text", text: dados.p_data },
                            { type: "text", text: dados.p_hora },
                            { type: "text", text: dados.p_profissional },
                            { type: "text", text: dados.p_especialidade },
                            { type: "text", text: dados.p_nome_unidade },
                            { type: "text", text: dados.p_unidade }
                        ]
                    },
                    {
                        type: "button",
                        sub_type: "url",
                        index: "0",
                        parameters: [
                            { type: "text", text: link }
                        ]
                    }
                ]
            }
        }
    };
}

module.exports = {
    limparTexto,
    limparTelefone,
    formatarHorario,
    montarPayloadAgendamento,
    montarPayloadConfirmacao
};
