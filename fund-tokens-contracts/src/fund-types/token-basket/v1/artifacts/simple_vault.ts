export default {
  contractName: 'SimpleVault',
  constructorInputs: [
    { name: 'authToken', type: 'bytes32' },
  ],
  abi: [
    { name: 'release', inputs: [] },
    { name: 'verify', inputs: [] },
  ],
  bytecode: 'OP_OVER OP_0 OP_NUMEQUAL OP_IF 0002 OP_0 OP_0 OP_BEGIN OP_DUP OP_UTXOTOKENCATEGORY OP_4 OP_PICK OP_EQUAL OP_OVER OP_UTXOBYTECODE OP_INPUTINDEX OP_UTXOBYTECODE OP_EQUAL OP_NOT OP_BOOLAND OP_IF OP_DUP OP_UTXOTOKENCOMMITMENT OP_3 OP_SPLIT OP_DROP OP_1 OP_SPLIT OP_NIP OP_3 OP_PICK OP_AND OP_3 OP_PICK OP_EQUAL OP_IF OP_1 OP_ROT OP_DROP OP_SWAP OP_ENDIF OP_ENDIF OP_1ADD OP_DUP OP_TXINPUTCOUNT OP_LESSTHAN OP_2 OP_PICK OP_NOT OP_BOOLAND OP_NOT OP_UNTIL OP_DROP OP_NIP OP_NIP OP_NIP OP_ELSE OP_SWAP OP_1 OP_NUMEQUALVERIFY OP_INPUTINDEX OP_1SUB OP_UTXOBYTECODE OP_INPUTINDEX OP_UTXOBYTECODE OP_EQUAL OP_NIP OP_ENDIF',
  source: 'pragma cashscript ^0.14.0;\r\n\r\nimport "./lib/authority.cash";\r\n\r\n/**\r\n * SimpleVault: A simple gated vault with token authorization\r\n * \r\n * Holds assets that can only be spent when a the authorization token is present in the transaction.\r\n * \r\n * Parameters:\r\n *   authToken: Token category that authorizes releasing\r\n */\r\ncontract SimpleVault(bytes32 authToken)\r\n{\r\n    /**\r\n     * release(): Allows spending only when authToken is present\r\n     *\r\n     * Release is dependent only on the authorization token being found in the tx w/ the correct permission bit.\r\n     *\r\n     * Ensures:\r\n     * - Authorization token exists in tx w/ correct permission bit\r\n     */\r\n    function release() {\r\n        //\r\n        // Check if authorization token is present in ANY input with permission bit 0x0002\r\n        require(hasAuthority(authToken, 0x0002), "unauthorized user");\r\n    }\r\n\r\n    /**\r\n     * verify(): An efficient contract linking method to rely on the first UTXO to authorize release\r\n     *\r\n     * Ensures:\r\n     * - Previous input was spent from this contract\r\n     */\r\n    function verify() {\r\n        require(tx.inputs[this.activeInputIndex - 1].lockingBytecode == tx.inputs[this.activeInputIndex].lockingBytecode);\r\n    }\r\n}',
  fingerprint: '85e05eda01f4a6946636e8e6f1ebbf23c3728f1f008c264da831dd5b6fa85f69',
  debug: {
    bytecode: '78009c6302000200006576ce54798778c7c0c787919a6376cf537f75517f7753798453798763517b757c68688b76c39f5279919a916675777777677c519dc08cc7c0c7877768',
    sourceMap: '23:4:27:5;;;;26:40:26:46;:16::47:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:8::70;23:23:27:5;:4;35::37::0;;;36:26:36:47;:::51:1;:16::68;:82::103:0;:72::120:1;:8::122;35:22:37:5;13:0:38:1',
    logs: [],
    requires: [
      { ip: 56, line: 26, message: 'unauthorized user' },
      { ip: 67, line: 36 },
    ],
    sourceTags: '52:54:sc;55:55:sc;66:66:sc',
    functions: [
      {
        name: 'hasAuthority',
        inputs: [
          { name: 'authorization', type: 'bytes' },
          { name: 'permission', type: 'bytes' },
        ],
        bytecode: '00006576ce54798778c7c0c787919a6376cf537f75517f7753798453798763517b757c68688b76c39f5279919a9166757777',
        sourceMap: '21:22:21:27;22:21:22:22;23:4:30:58;24:21:24:31;:11::46:1;:50::63:0;;:11:::1;:77::87:0;:67::104:1;:118::139:0;:108::156:1;:67;;:11;:158:28:9:0;25:32:25:42;:22::57:1;:67::68:0;:22::69:1;;:64::65:0;:22::69:1;;:73::83:0;;:16:::1;:88::98:0;;:15:::1;:100:27:13:0;26:29:26:33;:16::34:1;;;25:100:27:13;24:158:28:9;29:8:29:36;30:12:30:22:0;:25::41;:12:::1;:46::56:0;;:45:::1;:12;23:4::58;;20:76:32:1;;',
        sourceTags: '47:49:sc',
        sourceFile: 'lib/authority.cash',
        logs: [],
        requires: [],
      },
    ],
    sources: {
      'lib/authority.cash': 'pragma cashscript ^0.14.0;\r\n\r\n/**\r\n * Authorization token checks shared by the contracts it gates.\r\n *\r\n * Authorization token commitment: [auth_type (1 byte)][permission_flags (2 bytes)][serial_number]\r\n * (see docs/11-AUTHORIZATION_TOKEN.md for the permission bits).\r\n */\r\n\r\n/**\r\n * hasAuthority(): Whether an input carries an authorization token granting a permission\r\n *\r\n * Parameters:\r\n *   authorization: Authorization token category\r\n *   permission: Permission bit(s) required, as 2 bytes (e.g. 0x0004)\r\n *\r\n * Authority held by the calling contract (its own input or another UTXO at its address) does not\r\n * count, so an authorization token sent to a contract cannot authorize its own release.\r\n */\r\nfunction hasAuthority(bytes authorization, bytes permission) returns (bool) {\r\n    bool authorized = false;\r\n    int inputIndex = 0;\r\n    do {\r\n        if(tx.inputs[inputIndex].tokenCategory == authorization && tx.inputs[inputIndex].lockingBytecode != tx.inputs[this.activeInputIndex].lockingBytecode) {\r\n            if((bytes(tx.inputs[inputIndex].nftCommitment.slice(1, 3)) & permission) == permission) {\r\n                authorized = true;\r\n            }\r\n        }\r\n        inputIndex = inputIndex + 1;\r\n    } while(inputIndex < tx.inputs.length && !authorized);\r\n    return authorized;\r\n}\r\n',
    },
    inlineRanges: '6:55:hasAuthority',
  },
  compiler: {
    name: 'cashc',
    version: '0.14.0-next.7',
    options: {
      enforceFunctionParameterTypes: true,
      enforceLocktimeGuard: true,
    },
  },
  updatedAt: '2026-10-03T17:52:57.849Z',
} as const;
