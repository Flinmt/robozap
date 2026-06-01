const fs = require('fs');
const path = require('path');
const runtimeConfig = require('./runtimeConfig');

const historyPath = path.join(path.dirname(runtimeConfig.configPath), 'runtime-config.history.jsonl');

function appendEvent(event) {
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.appendFileSync(historyPath, `${JSON.stringify(event)}\n`, 'utf8');
}

function readHistory({ limit = 20, offset = 0 } = {}) {
    if (!fs.existsSync(historyPath)) return { items: [], total: 0 };

    const raw = fs.readFileSync(historyPath, 'utf8');
    const rows = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch (_) {
                return null;
            }
        })
        .filter(Boolean)
        .reverse();

    const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
    const safeLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 20));
    return {
        items: rows.slice(safeOffset, safeOffset + safeLimit),
        total: rows.length
    };
}

function buildDiff(previousSection, nextSection) {
    const keys = new Set([...Object.keys(previousSection || {}), ...Object.keys(nextSection || {})]);
    const changes = {};

    keys.forEach((key) => {
        const from = previousSection ? previousSection[key] : undefined;
        const to = nextSection ? nextSection[key] : undefined;
        if (JSON.stringify(from) !== JSON.stringify(to)) {
            changes[key] = { from, to };
        }
    });

    return changes;
}

module.exports = {
    appendEvent,
    readHistory,
    buildDiff,
    historyPath
};
