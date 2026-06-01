const fs = require('fs');
const path = require('path');
const runtimeConfig = require('./runtimeConfig');

const metaPath = path.join(path.dirname(runtimeConfig.configPath), 'runtime-config.meta.json');

function buildDefaultMeta() {
    return {
        version: 1,
        updatedAt: new Date().toISOString(),
        updatedBy: 'system-bootstrap',
        instanceId: process.env.INSTANCE_ID || null,
        configSchemaVersion: 2,
        lastRequestId: null
    };
}

function normalizeMeta(input) {
    const base = buildDefaultMeta();
    const merged = { ...base, ...(input || {}) };
    return {
        version: Number.isInteger(merged.version) && merged.version > 0 ? merged.version : base.version,
        updatedAt: String(merged.updatedAt || base.updatedAt),
        updatedBy: String(merged.updatedBy || base.updatedBy),
        instanceId: merged.instanceId ? String(merged.instanceId) : null,
        configSchemaVersion: Number.isInteger(merged.configSchemaVersion) ? merged.configSchemaVersion : 2,
        lastRequestId: merged.lastRequestId ? String(merged.lastRequestId) : null
    };
}

function writeMeta(meta) {
    const normalized = normalizeMeta(meta);
    fs.mkdirSync(path.dirname(metaPath), { recursive: true });
    const tempPath = `${metaPath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, metaPath);
    return normalized;
}

function getMeta() {
    if (!fs.existsSync(metaPath)) {
        return writeMeta(buildDefaultMeta());
    }

    try {
        const raw = fs.readFileSync(metaPath, 'utf8');
        return normalizeMeta(JSON.parse(raw));
    } catch (error) {
        throw new Error(`Falha ao ler metadata runtime: ${error.message}`);
    }
}

function saveMeta(nextMeta) {
    return writeMeta(nextMeta);
}

function bumpMeta({ updatedBy, requestId }) {
    const current = getMeta();
    return saveMeta({
        ...current,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: String(updatedBy || 'unknown'),
        instanceId: process.env.INSTANCE_ID || current.instanceId || null,
        configSchemaVersion: 2,
        lastRequestId: requestId || null
    });
}

module.exports = {
    getMeta,
    saveMeta,
    bumpMeta,
    metaPath
};
