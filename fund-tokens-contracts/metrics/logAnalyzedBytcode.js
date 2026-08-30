export default function logAnalyzedBytecode(report, contract) {
    let message = `
=== ${contract.name} Execution Cost Summary ===
Overall VM Cost:      ${report.totalCost} units
Opcode Count:         ${report.opcodeCount}
Push Data Bytes:      ${report.pushDataBytes} bytes
`;
    console.log(message);
}