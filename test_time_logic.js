const formatters = require('./src/utils/formatters');

const testCases = [
    { hora: '09:00', bol: 'S', expected: '09:00' },
    { hora: '14:30', bol: 'S', expected: '14:30' },
    { hora: '08:00', bol: 'N', expected: 'Manhã - Por Ordem de Chegada' },
    { hora: '11:59', bol: 'N', expected: 'Manhã - Por Ordem de Chegada' },
    { hora: '12:00', bol: 'N', expected: 'Tarde - Por Ordem de Chegada' },
    { hora: '13:00', bol: 'N', expected: 'Tarde - Por Ordem de Chegada' },
    { hora: '17:59', bol: 'N', expected: 'Tarde - Por Ordem de Chegada' },
    { hora: '18:00', bol: 'N', expected: 'Noite - Por Ordem de Chegada' },
    { hora: '20:00', bol: 'N', expected: 'Noite - Por Ordem de Chegada' },
    { hora: '09:00', bol: null, expected: '09:00' }, // Default to S
    { hora: '-', bol: 'N', expected: 'Por Ordem de Chegada' }, // Invalid time
];

console.log("Running Time Logic Tests...\n");
let passed = 0;
testCases.forEach((test, index) => {
    const result = formatters.formatarHorario(test.hora, test.bol);
    if (result === test.expected) {
        console.log(`✅ Test ${index + 1}: Passed`);
        passed++;
    } else {
        console.log(`❌ Test ${index + 1}: Failed`);
        console.log(`   Input: hora='${test.hora}', bol='${test.bol}'`);
        console.log(`   Expected: '${test.expected}'`);
        console.log(`   Got:      '${result}'`);
    }
});

console.log(`\nResult: ${passed}/${testCases.length} passed.`);
