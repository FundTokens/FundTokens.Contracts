export default {
  contractName: 'AssetManager',
  constructorInputs: [
    { name: 'outflowToken', type: 'bytes32' },
    { name: 'fundHash', type: 'bytes32' },
    { name: 'assetCategory', type: 'bytes32' },
    { name: 'transactionManager', type: 'bytes' },
    { name: 'linkedAssetManager', type: 'bytes' },
  ],
  abi: [
    { name: 'release', inputs: [] },
  ],
  bytecode: 'OP_2 OP_PICK 0000000000000000000000000000000000000000000000000000000000000000 OP_EQUAL OP_IF OP_INPUTINDEX OP_UTXOTOKENCATEGORY OP_0 OP_EQUALVERIFY OP_ELSE OP_INPUTINDEX OP_UTXOTOKENCATEGORY OP_3 OP_PICK OP_EQUALVERIFY OP_ENDIF OP_INPUTINDEX OP_1SUB OP_UTXOBYTECODE OP_DUP OP_INPUTINDEX OP_UTXOBYTECODE OP_EQUAL OP_SWAP OP_6 OP_PICK OP_EQUAL OP_6 OP_ROLL OP_0 OP_EQUAL OP_NOT OP_BOOLAND OP_BOOLOR OP_NOTIF OP_0 OP_0 OP_INPUTINDEX OP_1SUB OP_BEGIN OP_DUP OP_0 OP_GREATERTHANOREQUAL OP_2 OP_PICK OP_NOT OP_BOOLAND OP_DUP OP_TOALTSTACK OP_IF OP_DUP OP_UTXOTOKENCATEGORY OP_4 OP_PICK OP_EQUAL OP_IF OP_DUP OP_UTXOBYTECODE OP_7 OP_PICK OP_EQUALVERIFY OP_DUP OP_UTXOTOKENCOMMITMENT 41 OP_SPLIT OP_DROP 21 OP_SPLIT OP_NIP OP_5 OP_PICK OP_EQUALVERIFY OP_1 OP_ROT OP_DROP OP_SWAP OP_ELSE OP_2 OP_PICK OP_0 OP_EQUAL OP_IF OP_DUP OP_UTXOBYTECODE OP_2SWAP OP_NIP OP_ROT OP_ELSE OP_3DUP OP_NIP OP_UTXOBYTECODE OP_EQUAL OP_OVER OP_1SUB OP_UTXOTOKENCATEGORY OP_5 OP_PICK OP_EQUAL OP_BOOLOR OP_VERIFY OP_ENDIF OP_ENDIF OP_1SUB OP_ENDIF OP_FROMALTSTACK OP_NOT OP_UNTIL OP_OVER OP_VERIFY OP_2DROP OP_DROP OP_ENDIF OP_2DROP OP_2DROP OP_1',
  source: 'pragma cashscript ^0.14.0;\r\n\r\n/**\r\n * AssetManager: Holds individual assets for funds\r\n *\r\n * This contract gates asset access during redemption (outflow) transactions.\r\n * Amount verification is performed by the TransactionManager contract.\r\n * Each asset in a fund has a dedicated AssetManager contract instance.\r\n *\r\n * Parameters:\r\n *   outflowToken: Token category that authorizes redemption\r\n *   fundHash: Hash of fund parameters (prevents spending wrong fund\'s assets)\r\n *   assetCategory: The specific asset category this contract holds\r\n *                  (0x00...00 = Bitcoin, else = token category)\r\n *   transactionManager: Locking bytecode of this fund\'s TransactionManager (authenticates the outflow)\r\n *   linkedAsset: Locking bytecode of the AssetManager redeemed just before this one\r\n *                (satoshis first, then assets by ascending category), empty for the first\r\n */\r\ncontract AssetManager(bytes32 outflowToken, bytes32 fundHash, bytes32 assetCategory, bytes transactionManager, bytes linkedAssetManager)\r\n{\r\n    /**\r\n     * release(): Releases held assets when outflow is authorized\r\n     *\r\n     * AssetManager relies on TransactionManager for redeeming asset amount verification.\r\n     * To release, checking for the TransactionManager\'s outflow or linking w/ a previous AssetManager.\r\n     *\r\n     * Ensures:\r\n     * - Asset type is verified (Bitcoin or tokens)\r\n     * - Previous input spends from this contract or the linked AssetManager, which release() themselves\r\n     * - Otherwise, the outflow token is spent from this fund\'s TransactionManager (correct redemption)\r\n     */\r\n    function release() {\r\n        //\r\n        // Verify this spends the correct asset\r\n        // Bitcoin for 0x00... otherwise verify token category\r\n        if(assetCategory == 0x0000000000000000000000000000000000000000000000000000000000000000) {\r\n            require(tx.inputs[this.activeInputIndex].tokenCategory == 0x);\r\n        } else {\r\n            require(tx.inputs[this.activeInputIndex].tokenCategory == assetCategory);\r\n        }\r\n\r\n        //\r\n        // Check if the previous input is this AssetManager or the linked AssetManager for this fund\r\n        bytes prevLockingBytecode = tx.inputs[this.activeInputIndex - 1].lockingBytecode;\r\n        bool linked = prevLockingBytecode == tx.inputs[this.activeInputIndex].lockingBytecode || (prevLockingBytecode == linkedAssetManager && linkedAssetManager != 0x);\r\n\r\n        //\r\n        // Must have redemption signal or previous AssetManager contract\r\n        if(!linked) {\r\n            //\r\n            // Tip of the asset chain\r\n            // Find the transaction manager w/ outflow token\r\n            // Check all inputs leading to outflow, should be the same or one a single input for fee contract\r\n            bytes prevFundManager = 0x;\r\n            bool prevOutflow = false;\r\n            int inputIndex = this.activeInputIndex - 1;\r\n            while(inputIndex >= 0 && !prevOutflow) {\r\n                if(tx.inputs[inputIndex].tokenCategory == outflowToken) {\r\n                    require(tx.inputs[inputIndex].lockingBytecode == transactionManager);\r\n                    require(tx.inputs[inputIndex].nftCommitment.slice(33, 65) == fundHash); // type 0x02 + fund category 32 bytes + fund hash 32 bytes\r\n                    prevOutflow = true;\r\n                } else if(prevFundManager == 0x) {\r\n                    prevFundManager = tx.inputs[inputIndex].lockingBytecode;\r\n                } else {\r\n                    require(prevFundManager == tx.inputs[inputIndex].lockingBytecode || tx.inputs[inputIndex - 1].tokenCategory == outflowToken);\r\n                }\r\n                inputIndex = inputIndex - 1;\r\n            }\r\n            require(prevOutflow);\r\n        }\r\n    }\r\n}\r\n',
  fingerprint: '242d36de5b8c7c2efdf754a82a632635e2cac17b0b4bc296e09d728314063d53',
  debug: {
    bytecode: '52792000000000000000000000000000000000000000000000000000000000000000008763c0ce008867c0ce53798868c08cc776c0c7877c567987567a0087919a9b640000c08c657600a25279919a766b6376ce5479876376c757798876cf01417f7501217f77557988517b757c67527900876376c772777b676f77c787788cce5579879b6968688c686c916678696d75686d6d51',
    sourceMap: '36:11:36:24;;:28::94;:11:::1;:96:38:9:0;37:30:37:51;:20::66:1;:70::72:0;:12::74:1;38:15:40:9:0;39:30:39:51;:20::66:1;:70::83:0;;:12::85:1;38:15:40:9;44:46:44:67:0;:::71:1;:36::88;45:22:45:41:0;:55::76;:45::93:1;:22;:98::117:0;:121::139;;:98:::1;:143::161:0;;:165::167;:143:::1;;:98;:22::168;49:11:70:9:0;54:36:54:38;55:31:55:36;56:29:56:50;:::54:1;57:12:68:13:0;:18:57:28;:32::33;:18:::1;:38::49:0;;:37:::1;:18;;;:51:68:13:0;58:29:58:39;:19::54:1;:58::70:0;;:19:::1;:72:62:17:0;59:38:59:48;:28::65:1;:69::87:0;;:20::89:1;60:38:60:48:0;:28::63:1;:74::76:0;:28::77:1;;:70::72:0;:28::77:1;;:81::89:0;;:20::91:1;61:34:61:38:0;:20::39:1;;;62:23:66:17:0;:26:62:41;;:45::47;:26:::1;:49:64:17:0;63:48:63:58;:38::75:1;:20::76;;;64:23:66:17:0;65:28:65:67;;:47::84:1;:28;:98::108:0;:::112:1;:88::127;:131::143:0;;:88:::1;:28;:20::145;64:23:66:17;62;67:16:67:44;57:51:68:13;;:12;;69:20:69:31:0;:12::33:1;49:20:70:9;;;32:23:71:5;;',
    logs: [],
    requires: [
      { ip: 13, line: 37 },
      { ip: 19, line: 39 },
      { ip: 65, line: 59 },
      { ip: 76, line: 60 },
      { ip: 104, line: 65 },
      { ip: 113, line: 69 },
    ],
    sourceTags: '103:106:lc;109:110:sc',
  },
  compiler: {
    name: 'cashc',
    version: '0.14.0-next.7',
    options: {
      enforceFunctionParameterTypes: true,
      enforceLocktimeGuard: true,
    },
  },
  updatedAt: '2026-10-03T16:06:47.050Z',
} as const;
