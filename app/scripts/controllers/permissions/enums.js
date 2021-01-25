
const pluginPrefix = 'wallet_plugin_'

const NOTIFICATION_NAMES = {
  accountsChanged: 'wallet_accountsChanged',
  unlockStateChanged: 'wallet_unlockStateChanged',
  chainChanged: 'wallet_chainChanged',
}

module.exports = {
  WALLET_PREFIX: 'wallet_',
  PLUGIN_PREFIX: pluginPrefix,
  PLUGIN_PREFIX_REGEX: new RegExp(`^${pluginPrefix}`),
  HISTORY_STORE_KEY: 'permissionsHistory',
  LOG_STORE_KEY: 'permissionsLog',
  METADATA_STORE_KEY: 'domainMetadata',
  CAVEAT_NAMES: {
    exposedAccounts: 'exposedAccounts',
  },

  /**
   * All notification names.
   */
  NOTIFICATION_NAMES,

  /**
   * Notifications that should be sent regardless of whether
   * the extension is locked or the domain is permitted.
   */
  SAFE_NOTIFICATIONS: new Set([
    NOTIFICATION_NAMES.unlockStateChanged,
    NOTIFICATION_NAMES.chainChanged,
  ]),

  SAFE_METHODS: [
    'web3_sha3',
    'net_listening',
    'net_peerCount',
    'net_version',
    'eth_blockNumber',
    'eth_call',
    'eth_chainId',
    'eth_coinbase',
    'eth_estimateGas',
    'eth_gasPrice',
    'eth_getBalance',
    'eth_getBlockByHash',
    'eth_getBlockByNumber',
    'eth_getBlockTransactionCountByHash',
    'eth_getBlockTransactionCountByNumber',
    'eth_getCode',
    'eth_getFilterChanges',
    'eth_getFilterLogs',
    'eth_getLogs',
    'eth_getStorageAt',
    'eth_getTransactionByBlockHashAndIndex',
    'eth_getTransactionByBlockNumberAndIndex',
    'eth_getTransactionByHash',
    'eth_getTransactionCount',
    'eth_getTransactionReceipt',
    'eth_getUncleByBlockHashAndIndex',
    'eth_getUncleByBlockNumberAndIndex',
    'eth_getUncleCountByBlockHash',
    'eth_getUncleCountByBlockNumber',
    'eth_getWork',
    'eth_hashrate',
    'eth_mining',
    'eth_newBlockFilter',
    'eth_newFilter',
    'eth_newPendingTransactionFilter',
    'eth_protocolVersion',
    'eth_sendRawTransaction',
    'eth_sendTransaction',
    'eth_sign',
    'personal_sign',
    'eth_signTypedData',
    'eth_signTypedData_v1',
    'eth_signTypedData_v3',
    'eth_signTypedData_v4',
    'eth_submitHashrate',
    'eth_submitWork',
    'eth_syncing',
    'eth_uninstallFilter',
  ],
}
