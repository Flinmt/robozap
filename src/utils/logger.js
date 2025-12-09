const winston = require('winston');
const path = require('path');

// Define logs directory
const logsDir = path.resolve(__dirname, '../../logs');

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
        // - Write all logs with importance level of `error` or less to `error.log`
        // - Write all logs with importance level of `info` or less to `app.log`
        //
        new winston.transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error' }),
        new winston.transports.File({ filename: path.join(logsDir, 'app.log') }),
    ],
});

//
// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
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
