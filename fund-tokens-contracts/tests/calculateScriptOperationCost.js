import {
  disassembleBytecodeBCH,
  hexToBin,
  OpcodesBCH,
} from '@bitauth/libauth';

/**
 * Parses script bytecode via Libauth disassembly and calculates Operation Cost.
 */
export default function calculateScriptOperationCost(
  bytecodeHex,
  estimatedSigPreimageBytes = 180
) {
  const bytecodeBin = hexToBin(bytecodeHex);
  
  // Disassemble raw binary into space-delimited ASM string (e.g. "OP_1 OP_ADD 0x1234 OP_EQUAL")
  const asm = disassembleBytecodeBCH(bytecodeBin);
  const tokens = asm.split(' ').filter((t) => t.length > 0);

  let totalCost = 0;
  let opcodeCount = 0;
  let pushDataBytes = 0;
  const breakdown = [];

  for (const token of tokens) {
    let opCost = 100; // Base cost per instruction

    // 1. Data Push Literal (Hex literals starting with "0x")
    if (token.startsWith('0x')) {
      const hexPayload = token.slice(2);
      const dataLen = hexPayload.length / 2;
      pushDataBytes += dataLen;
      opCost = 100 + dataLen;
      breakdown.push({ token: `PUSH (${dataLen}b)`, cost: opCost });
    }
    // 2. Opcode Instructions (OP_*)
    else if (token.startsWith('OP_')) {
      opcodeCount++;

      switch (token) {
        // Signatures (~26,101 base + preimage hash chunks)
        case 'OP_CHECKSIG':
        case 'OP_CHECKSIGVERIFY':
        case 'OP_CHECKDATASIG':
        case 'OP_CHECKDATASIGVERIFY': {
          const preimageChunks = Math.ceil((estimatedSigPreimageBytes + 9) / 64);
          opCost = 100 + 26000 + preimageChunks * 192 + 1;
          break;
        }

        // Hashing
        case 'OP_SHA256':
        case 'OP_RIPEMD160':
        case 'OP_SHA1': {
          const chunks = Math.ceil((32 + 9) / 64); // Assuming standard 32b payload
          opCost = 100 + chunks * 192 + 32;
          break;
        }
        case 'OP_HASH256':
        case 'OP_HASH160': {
          const chunks = Math.ceil((32 + 9) / 64);
          opCost = 100 + (chunks + 1) * 192 + 32;
          break;
        }

        // Concatenation & Splitting
        case 'OP_CAT':
        case 'OP_SPLIT':
          opCost = 100 + 64; // Base + estimated combined input byte lengths
          break;

        default:
          opCost = 100;
          break;
      }

      breakdown.push({ token, cost: opCost });
    }
    // 3. Small Push / Numeric Literals (e.g., OP_1 -> "1")
    else {
      opCost = 100;
      breakdown.push({ token: `PUSH_NUM (${token})`, cost: opCost });
    }

    totalCost += opCost;
  }

  return { totalCost, opcodeCount, pushDataBytes, breakdown };
}