const winston = require('winston');
const path = require('path');

// ========================================================================
// SISTEMA DE LOGS (Winston)
// ========================================================================
// Configura onde os logs serão salvos:
// 1. Arquivos: /logs/app.log (Geral) e /logs/error.log (Apenas erros)
// 2. Console: Exibido no terminal durante o desenvolvimento (colorido)

// Define o diretório onde os logs serão salvos
const logsDir = path.resolve(__dirname, '../../logs');

// ========================================================================
// CRIAÇÃO DO LOGGER (Winston)
// ========================================================================
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'robo-whatsapp-worker' },
    transports: [
        //
        // - Escreve todos os logs com nível 'error' (ou mais graves) em `error.log`
        // - Escreve todos os logs com nível 'info' (ou mais graves) em `app.log`
        //
        new winston.transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error' }),
        new winston.transports.File({ filename: path.join(logsDir, 'app.log') }),
    ],
});

//
// Se NÃO estivermos em ambiente de produção, logar também no `console` (terminal).
// Formato visual: `${timestamp} [service] ${level}: ${message}`
//
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp, service, ...metadata }) => {
                let msg = `${timestamp} [${service}] ${level}: ${message}`;
                if (Object.keys(metadata).length > 0) {
                    msg += ` ${JSON.stringify(metadata)}`;
                }
                return msg;
            })
        ),
    }));
}

module.exports = logger;
