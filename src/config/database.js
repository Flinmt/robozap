const sql = require('mssql');

// ========================================================================
// CONEXÃO COM BANCO DE DADOS (SQL SERVER)
// ========================================================================
// Configuração da lib `mssql` para conectar ao SQL Server.
// As credenciais vêm do arquivo .env.

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT, 10) || 60000,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    }
};

async function connect() {
    try {
        const pool = await new sql.ConnectionPool(dbConfig).connect();
        return pool;
    } catch (err) {
        console.error('❌ Erro na conexão com o Banco de Dados:', err);
        throw err;
    }
}

module.exports = {
    connect,
    sql // Exportando também o objeto sql para uso de tipos (sql.Int, etc)
};
