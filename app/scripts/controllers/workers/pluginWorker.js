const Dnode = require('dnode')
const pump = require('pump')
// const { ethErrors, serializeError } = require('eth-json-rpc-errors')
const MetamaskInpageProvider = require('metamask-inpage-provider')
const SES = require('ses')
const { WorkerPostMessageStream } = require('post-message-stream')
const { setupMultiplex } = require('../../lib/stream-utils')
const { STREAM_NAMES } = require('./enums')


init()

async function init () {

  self.backgroundApi = null
  self.rpcStream = null
  self.command = null

  self.plugins = new Map()

  self.rootRealm = SES.makeSESRootRealm({
    consoleMode: 'allow',
    errorStackMode: 'allow',
    mathRandomMode: 'allow',
  })

  await connectToParent()
}

/**
 * Establishes a streamed connection to the background account manager
 */
function connectToParent () {

  const parentStream = new WorkerPostMessageStream()
  const mux = setupMultiplex(parentStream)

  pump(
    parentStream,
    mux,
    parentStream,
    (err) => {
      console.error('Parent stream failure, closing.', err)
      self.close()
    }
  )

  self.command = mux.createStream(STREAM_NAMES.COMMAND)
  self.command.on('data', _onCommandMessage)

  self.rpcStream = mux.createStream(STREAM_NAMES.JSON_RPC)

  const backgroundApiStream = mux.createStream(STREAM_NAMES.BACKGROUND_API)
  return new Promise((resolve, _reject) => {
    const dnode = Dnode()
    backgroundApiStream.pipe(dnode).pipe(backgroundApiStream)
    dnode.once('remote', (metamaskConnection) => {
      self.backgroundApi = metamaskConnection
      resolve()
    })
  })
}

function _onCommandMessage (message) {

  if (typeof message !== 'object') {
    console.error('Command stream received non-object message.')
    return
  }

  const { command, data } = message

  switch (command) {

    case 'installPlugin':
      installPlugin(data)
      break

    default:
      console.error(`Unrecognized command: ${command}.`)
      break
  }
}

function installPlugin ({
  pluginName,
  approvedPermissions,
  sourceCode,
  backgroundApiKeys,
} = {}) {

  const ethereumProvider = new MetamaskInpageProvider(self.rpcStream, false)

  _startPlugin(pluginName, approvedPermissions, sourceCode, ethereumProvider, backgroundApiKeys)
}

/**
 * Attempts to evaluate a plugin in SES.
 * Generates the APIs for the plugin. May throw on error.
 *
 * @param {string} pluginName - The name of the plugin.
 * @param {Array<string>} approvedPermissions - The plugin's approved permissions.
 * Should always be a value returned from the permissions controller.
 * @param {string} sourceCode - The source code of the plugin.
 * @param {Object} ethereumProvider - The plugin's Ethereum provider object.
 */
function _startPlugin (pluginName, approvedPermissions, sourceCode, ethereumProvider, backgroundApiKeys) {

  console.log(`starting plugin '${pluginName}'`)

  Object.assign(ethereumProvider, generateBackgroundApi(backgroundApiKeys, approvedPermissions))

  try {

    const sessedPlugin = self.rootRealm.evaluate(sourceCode, {

      wallet: ethereumProvider,
      console, // Adding console for now for logging purposes.
      BigInt,
      setTimeout,
      crypto,
      SubtleCrypto,
      fetch,
      XMLHttpRequest,
      WebSocket,
      Buffer, // TODO: may not be available? we'll see
      Date,

      window: {
        crypto,
        SubtleCrypto,
        setTimeout,
        fetch,
        XMLHttpRequest,
        WebSocket,
      },
    })
    sessedPlugin()
  } catch (err) {

    console.log(`error encountered trying to run plugin '${pluginName}', removing it`)
    this.removePlugin(pluginName)
    throw err
  }

  this._setPluginToActive(pluginName)
}

function generateBackgroundApi (pluginName, backgroundApiKeys) {
  // TODO: bind background API methods to pluginName
  return backgroundApiKeys.reduce((api, key) => {
    api[key] = self.backgroundApi[key]
    return api
  }, {})
}
