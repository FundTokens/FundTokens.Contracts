export default {
  contractName: 'FeeMinter',
  constructorInputs: [
    { name: 'authorization', type: 'bytes32' },
    { name: 'token', type: 'bytes32' },
    { name: 'next', type: 'bytes' },
  ],
  abi: [
    { name: 'mint', inputs: [] },
  ],
  bytecode: '0010 OP_0 OP_0 OP_BEGIN OP_DUP OP_UTXOTOKENCATEGORY OP_4 OP_PICK OP_EQUAL OP_OVER OP_UTXOBYTECODE OP_INPUTINDEX OP_UTXOBYTECODE OP_EQUAL OP_NOT OP_BOOLAND OP_IF OP_DUP OP_UTXOTOKENCOMMITMENT OP_3 OP_SPLIT OP_DROP OP_1 OP_SPLIT OP_NIP OP_3 OP_PICK OP_AND OP_3 OP_PICK OP_EQUAL OP_IF OP_1 OP_ROT OP_DROP OP_SWAP OP_ENDIF OP_ENDIF OP_1ADD OP_DUP OP_TXINPUTCOUNT OP_LESSTHAN OP_2 OP_PICK OP_NOT OP_BOOLAND OP_NOT OP_UNTIL OP_DROP OP_NIP OP_NIP OP_VERIFY OP_0 OP_BEGIN OP_DUP OP_INPUTINDEX OP_NUMNOTEQUAL OP_OVER OP_OUTPUTTOKENCATEGORY OP_0 OP_EQUAL OP_NOT OP_BOOLAND OP_IF OP_DUP OP_OUTPUTTOKENCATEGORY 20 OP_SPLIT OP_DROP OP_2 OP_PICK OP_EQUAL OP_IF OP_DUP OP_OUTPUTBYTECODE OP_3 OP_PICK OP_EQUALVERIFY OP_DUP OP_OUTPUTTOKENCATEGORY OP_2 OP_PICK OP_EQUALVERIFY OP_DUP OP_OUTPUTTOKENCOMMITMENT OP_1 OP_SPLIT OP_OVER OP_1 OP_EQUAL OP_2 OP_PICK OP_2 OP_EQUAL OP_BOOLOR OP_VERIFY OP_OVER OP_1 OP_EQUAL OP_IF OP_DUP 20 OP_SPLIT OP_OVER OP_0 OP_EQUAL OP_NOT OP_VERIFY OP_DUP OP_8 OP_SPLIT OP_DROP OP_DUP OP_BIN2NUM OP_0 OP_GREATERTHAN OP_VERIFY OP_2DROP OP_DROP OP_ENDIF OP_OVER OP_2 OP_EQUAL OP_IF OP_DUP OP_0 OP_EQUALVERIFY OP_ENDIF OP_2DROP OP_ENDIF OP_ENDIF OP_1ADD OP_DUP OP_TXOUTPUTCOUNT OP_GREATERTHANOREQUAL OP_UNTIL OP_INPUTINDEX OP_UTXOTOKENCATEGORY OP_DUP OP_3 OP_ROLL OP_2 OP_CAT OP_EQUALVERIFY OP_INPUTINDEX OP_OUTPUTTOKENCATEGORY OP_EQUALVERIFY OP_INPUTINDEX OP_UTXOBYTECODE OP_INPUTINDEX OP_OUTPUTBYTECODE OP_EQUALVERIFY OP_INPUTINDEX OP_UTXOTOKENCOMMITMENT OP_INPUTINDEX OP_OUTPUTTOKENCOMMITMENT OP_EQUAL OP_NIP OP_NIP',
  source: 'pragma cashscript ^0.14.0;\r\n\r\nimport "./lib/authority.cash";\r\n\r\n/**\r\n * FeeMinter: Vault to holding fee minting token with strict minting enforcement and authorization requirements\r\n * \r\n * Minting fee tokens provides a way to compose a flexible fee structure into the protocol.\r\n * Operations are authorized via token using commitment as permission bits.\r\n * \r\n * Parameters:\r\n *   authorization: Token category that authorizes operations\r\n *   token: Fee token category being minted\r\n *   next: Destination for newly minted fee tokens (fee enforcement contract)\r\n */\r\ncontract FeeMinter(bytes32 authorization, bytes32 token, bytes next)\r\n{\r\n    /**\r\n     * mint(): Mints fee tokens with commitment encoding\r\n     * \r\n     * Acts as a vault for long term fee token holding.\r\n     * Allows authorized fee token minting to FeeManager with NFT commitment structure validation.\r\n     * Ensures this minting token UTXO is preserved\r\n     *\r\n     * Ensures:\r\n     * - Action is authorized with permission bit 0x0010\r\n     * - Enforces minted tokens destination to FeeManager\r\n     * - Ensures proper NFT commitment structure (type and additional data as needed)\r\n     */\r\n    function mint() {\r\n        //\r\n        // Check for authorization token in ANY input\r\n        // Bit 0x0010 in commitment indicates fee minting permission\r\n        require(hasAuthority(authorization, 0x0010), "unauthorized user");\r\n\r\n        //\r\n        // Verify ALL outputs with locking bytecode enforcement\r\n        int outputIndex = 0;\r\n        do {\r\n            if(outputIndex != this.activeInputIndex && tx.outputs[outputIndex].tokenCategory != 0x) {\r\n                if(tx.outputs[outputIndex].tokenCategory.slice(0, 32) == token) {\r\n                    //\r\n                    // Validate minted token output including NFT commitment\r\n                    require(tx.outputs[outputIndex].lockingBytecode == next);\r\n                    require(tx.outputs[outputIndex].tokenCategory == token);\r\n\r\n                    bytes fee_type, bytes fee_next0 = tx.outputs[outputIndex].nftCommitment.split(1);\r\n                    require(fee_type == 0x01 || fee_type == 0x02); // minting type not allowed\r\n\r\n                    if(fee_type == 0x01) {\r\n                        bytes fee_category, bytes fee_next1 = fee_next0.split(32);\r\n                        require(fee_category != 0x);\r\n                        \r\n                        bytes fee_amount = fee_next1.slice(0, 8);\r\n                        require(int(fee_amount) > 0); // treat as int\r\n                        \r\n                        // Destination is optional (0x for default, or locking bytecode)\r\n                    }\r\n\r\n                    if(fee_type == 0x02) {\r\n                        require(fee_next0 == 0x); // No additional commitment needed\r\n                    }\r\n                }\r\n            }\r\n            outputIndex = outputIndex + 1;\r\n        } while(outputIndex < tx.outputs.length);\r\n\r\n\r\n        //\r\n        // Verify this is a fee minting token and the UTXO is preserved\r\n        bytes thisInputCategory = tx.inputs[this.activeInputIndex].tokenCategory;\r\n        require(thisInputCategory == (token + 0x02));\r\n        require(thisInputCategory == tx.outputs[this.activeInputIndex].tokenCategory);\r\n        require(tx.inputs[this.activeInputIndex].lockingBytecode == tx.outputs[this.activeInputIndex].lockingBytecode);\r\n        require(tx.inputs[this.activeInputIndex].nftCommitment == tx.outputs[this.activeInputIndex].nftCommitment);\r\n    }\r\n}',
  fingerprint: '841a8b85a2b3fd99790e3a36f85ce913b5fecbbae7c660446ce6b10bf2ed7fe5',
  debug: {
    bytecode: '02001000006576ce54798778c7c0c787919a6376cf537f75517f7753798453798763517b757c68688b76c39f5279919a916675777769006576c09e78d10087919a6376d101207f755279876376cd53798876d152798876d2517f785187527952879b69785187637601207f780087916976587f75768100a0696d756878528763760088686d68688b76c4a266c0ce76537a527e88c0d188c0c7c0cd88c0cfc0d2877777',
    sourceMap: '34:44:34:50;:16::51:1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:8::74;38:26:38:27:0;39:8:66:49;40:15:40:26;:30::51;:15:::1;:66::77:0;:55::92:1;:96::98:0;:55:::1;;:15;:100:64:13:0;41:30:41:41;:19::56:1;:66::68:0;:19::69:1;;:73::78:0;;:19:::1;:80:63:17:0;44:39:44:50;:28::67:1;:71::75:0;;:20::77:1;45:39:45:50:0;:28::65:1;:69::74:0;;:20::76:1;47:65:47::0;:54::91:1;:98::99:0;:54::100:1;48:28:48:36:0;:40::44;:28:::1;:48::56:0;;:60::64;:48:::1;:28;:20::66;50:23:50:31:0;:35::39;:23:::1;:41:58:21:0;51:62:51:71;:78::80;:62::81:1;52:32:52:44:0;:48::50;:32:::1;;:24::52;54:43:54::0;:62::63;:43::64:1;;55:36:55:46:0;:32::47:1;:50::51:0;:32:::1;:24::53;50:41:58:21;;;60:23:60:31:0;:35::39;:23:::1;:41:62:21:0;61:32:61:41;:45::47;:24::49:1;60:41:62:21;41:80:63:17;;40:100:64:13;65:12:65:42;66:16:66:27:0;:30::47;39:8::49:1;;71:44:71:65:0;:34::80:1;72:16:72:33:0;:38::43;;:46::50;:38:::1;:8::53;73:48:73:69:0;:37::84:1;:8::86;74:26:74:47:0;:16::64:1;:79::100:0;:68::117:1;:8::119;75:26:75:47:0;:16::62:1;:77::98:0;:66::113:1;:8::115;30:20:76:5;',
    logs: [],
    requires: [
      { ip: 54, line: 34, message: 'unauthorized user' },
      { ip: 80, line: 44 },
      { ip: 85, line: 45 },
      { ip: 98, line: 48 },
      { ip: 110, line: 52 },
      { ip: 119, line: 55 },
      { ip: 129, line: 61 },
      { ip: 146, line: 72 },
      { ip: 149, line: 73 },
      { ip: 154, line: 74 },
      { ip: 160, line: 75 },
    ],
    sourceTags: '48:50:sc;117:118:sc;128:128:sc;157:158:sc',
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
    inlineRanges: '4:53:hasAuthority',
  },
  compiler: {
    name: 'cashc',
    version: '0.14.0-next.7',
    options: {
      enforceFunctionParameterTypes: true,
      enforceLocktimeGuard: true,
    },
  },
  updatedAt: '2026-10-03T17:52:57.773Z',
} as const;
