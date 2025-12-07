const sql = require('mssql');

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    }
};

async function connect() {
    try {
        const pool = await sql.connect(dbConfig);
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
