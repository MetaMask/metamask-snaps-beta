const ObservableStore = require('obs-store')
const EventEmitter = require('safe-event-emitter')
const { ethErrors, serializeError } = require('eth-json-rpc-errors')
const nodeify = require('../lib/nodeify')

const {
  pluginRestrictedMethodDescriptions,
} = require('./permissions/restrictedMethods')
const { PLUGIN_PREFIX } = require('./permissions/enums')
const WorkerController = require('./workers')
const getInlinePlugin = require('./inlinePlugins')

const ENUMS = {
  // which plugin properties should be serialized
  // we include excluded prop names for completeness
  shouldSerialize: {
    initialPermissions: true,
    name: true,
    permissionName: true,
    isActive: false,
    sourceCode: false,
  },
}

const isTest = process.env.IN_TEST === 'true' || process.env.METAMASK_ENV === 'test'
const SES = (
  isTest
    ? {
      makeSESRootRealm: () => {
        return {
          evaluate: () => {
            return () => true
          },
        }
      },
    }
    : require('ses')
)

// const createGetDomainMetadataFunction = (pluginName) => {
//   return async () => {
//     return { name: pluginName }
//   }
// }

/*
 * A plugin is initialized in three phases:
 * - Add: Loads the plugin from a remote source and parses it.
 * - Authorize: Requests the plugin's required permissions from the user.
 * - Start: Initializes the plugin in its SES realm with the authorized permissions.
 */

class PluginsController extends EventEmitter {

  constructor (opts = {}) {

    super()
    const initState = {
      plugins: {},
      pluginStates: {},
      ...opts.initState,
    }
    this.store = new ObservableStore({})
    this.memStore = new ObservableStore({
      inlinePluginIsRunning: false,
    })
    this.updateState(initState)

    this.rootRealm = SES.makeSESRootRealm({
      consoleMode: 'allow',
      errorStackMode: 'allow',
      mathRandomMode: 'allow',
    })

    this.setupProvider = opts.setupProvider
    this.workerController = new WorkerController({
      setupWorkerConnection: opts.setupWorkerPluginProvider,
    })

    this._getAccounts = opts._getAccounts
    this._removeAllPermissionsFor = opts._removeAllPermissionsFor
    this._getPermissionsFor = opts._getPermissionsFor
    this.getApi = opts.getApi
    this.getAppKeyForDomain = opts.getAppKeyForDomain
    this.closeAllConnections = opts.closeAllConnections
    this._requestPermissions = opts.requestPermissions
    this._eventNamesToEventEmitters = this._getEventNamesToEventEmitters(
      opts._metaMaskEventEmitters
    )

    this.pluginHandlerHooks = new Map()
    // this.rpcMessageHandlers = new Map()
    // this.apiRequestHandlers = new Map()
    // this.accountMessageHandlers = new Map()
    // this.metamaskEventListeners = new Map()
    this.adding = {}
  }

  updateState (newState) {
    this.store.updateState(newState)
    this.memStore.updateState(this._filterMemStoreState(newState))
  }

  _filterMemStoreState (newState) {
    const memState = {
      ...newState,
      plugins: {},
    }

    // remove sourceCode from memState plugin objects
    if (newState.plugins) {
      Object.keys(newState.plugins).forEach((name) => {
        const plugin = { ...newState.plugins[name] }
        delete plugin.sourceCode
        memState.plugins[name] = plugin
      })
    }

    return memState
  }

  /**
   * Runs existing (installed) plugins.
   */
  runExistingPlugins () {

    const { plugins } = this.store.getState()

    if (Object.keys(plugins).length > 0) {
      console.log('running existing plugins', plugins)
    } else {
      console.log('no existing plugins to run')
      return
    }

    Object.values(plugins).forEach(({ name: pluginName, sourceCode }) => {

      console.log(`running: ${pluginName}`)
      const approvedPermissions = this._getPermissionsFor(pluginName).map(
        perm => perm.parentCapability
      )

      // const ethereumProvider = this.setupProvider(
      //   { hostname: pluginName },
      //   // createGetDomainMetadataFunction(pluginName),
      //   // true
      // )

      try {

        // this._startPlugin(pluginName, approvedPermissions, sourceCode, ethereumProvider)
        this._startPluginInWorker(pluginName, approvedPermissions, sourceCode)
      } catch (err) {

        console.warn(`failed to start '${pluginName}', deleting it`)
        // Clean up failed plugins:
        this.removePlugin(pluginName)
      }
    })
  }

  /**
   * Gets the plugin with the given name if it exists, including all data.
   * This should not be used if the plugin is to be serializable, as e.g.
   * the plugin sourceCode may be quite large.
   *
   * @param {string} pluginName - The name of the plugin to get.
   */
  get (pluginName) {
    return this.store.getState().plugins[pluginName]
  }

  /**
   * Gets the plugin with the given name if it exists, excluding any
   * non-serializable or expensive-to-serialize data.
   *
   * @param {string} pluginName - The name of the plugin to get.
   */
  getSerializable (pluginName) {

    const plugin = this.get(pluginName)

    return plugin && Object.keys(plugin).reduce((acc, key) => {

      if (ENUMS.shouldSerialize[key]) {
        acc[key] = plugin[key]
      }
      return acc
    }, {})
  }

  /**
   * Updates the own state of the plugin with the given name.
   * This is distinct from the state MetaMask uses to manage plugins.
   *
   * @param {string} pluginName - The name of the plugin whose state should be updated.
   * @param {Object} newPluginState - The new state of the plugin.
   */
  async updatePluginState (pluginName, newPluginState) {
    const state = this.store.getState()

    const newPluginStates = { ...state.pluginStates, [pluginName]: newPluginState }

    this.updateState({
      pluginStates: newPluginStates,
    })
  }

  /**
   * Gets the own state of the plugin with the given name.
   * This is distinct from the state MetaMask uses to manage plugins.
   *
   * @param {string} pluginName - The name of the plugin whose state to get.
   */
  async getPluginState (pluginName) {
    return this.store.getState().pluginStates[pluginName]
  }

  /**
   * Completely clear the controller's state: delete all associated data,
   * handlers, event listeners, and permissions; tear down all plugin providers.
   */
  clearState () {
    // this._removeAllMetaMaskEventListeners()
    // this.rpcMessageHandlers.clear()
    // this.apiRequestHandlers.clear()
    // this.accountMessageHandlers.clear()
    this.pluginHandlerHooks.clear()
    const pluginNames = Object.keys(this.store.getState().plugins)
    this.updateState({
      plugins: {},
      pluginStates: {},
    })
    pluginNames.forEach(name => {
      this.closeAllConnections(name)
    })
    this.workerController.terminateAll()
    this._removeAllPermissionsFor(pluginNames)
  }

  /**
   * Gets the event listener method names so that they can be mapped to
   * permissions in the permissions controller.
   * The method names are at this point the same as the event names.
   */
  getListenerMethods () {
    return Object.keys(this._eventNamesToEventEmitters)
  }

  /**
   * Removes all plugin MetaMask event listeners and clears all listener maps.
   */
  _removeAllMetaMaskEventListeners () {
    this.metamaskEventListeners.forEach((listenerRemovalMap) => {
      listenerRemovalMap.forEach((removeListener) => {
        removeListener()
      })
      listenerRemovalMap.clear()
    })
    this.metamaskEventListeners.clear()
  }

  /**
   * Removes all MetaMask event listeners for the given plugin and deletes
   * the associated listener map.
   * Should only be called when a plugin is removed.
   *
   * @param {string} pluginName - The name of the plugin.
   */
  _removeMetaMaskEventListeners (pluginName) {

    const listenerRemovalMap = this.metamaskEventListeners.get(pluginName)
    if (!listenerRemovalMap) {
      return
    }

    listenerRemovalMap.forEach((removeListener) => {
      removeListener()
    })
    listenerRemovalMap.clear()

    this.metamaskEventListeners.delete(pluginName)
  }

  /**
   * Removes the given plugin from state, and clears all associated handlers
   * and listeners.
   *
   * @param {string} pluginName - The name of the plugin.
   */
  removePlugin (pluginName) {
    this.removePlugins([pluginName])
  }

  /**
   * Removes the given plugins from state, and clears all associated handlers
   * and listeners.
   *
   * @param {Array<string>} pluginName - The name of the plugins.
   */
  removePlugins (pluginNames) {

    if (!Array.isArray(pluginNames)) {
      throw new Error('Expected Array of plugin names.')
    }

    const state = this.store.getState()
    const newPlugins = { ...state.plugins }
    const newPluginStates = { ...state.pluginStates }

    pluginNames.forEach(name => {
      // this._removeMetaMaskEventListeners(name)
      // this.rpcMessageHandlers.delete(name)
      // this.apiRequestHandlers.delete(name)
      // this.accountMessageHandlers.delete(name)
      this._removePluginHandlerHooks(name)
      this.closeAllConnections(name)
      this.workerController.terminateWorkerOf(name)
      delete newPlugins[name]
      delete newPluginStates[name]
    })
    this._removeAllPermissionsFor(pluginNames)

    this.updateState({
      plugins: newPlugins,
      pluginStates: newPluginStates,
    })
  }

  /**
   * Adds, authorizes, and runs the given plugin with a plugin provider.
   * Results from this method should be efficiently serializable.
   *
   * @param {string} - pluginName - The name of the plugin.
   */
  async processRequestedPlugin (pluginName) {

    // if the plugin is already installed and active, just return it
    const plugin = this.get(pluginName)
    if (plugin && plugin.isActive) {
      return this.getSerializable(pluginName)
    }

    try {

      // const ethereumProvider = this.setupProvider(
      //   { hostname: pluginName },
      //   // createGetDomainMetadataFunction(pluginName),
      //   // true
      // )

      const { sourceCode } = await this.add(pluginName)

      const approvedPermissions = await this.authorize(pluginName)

      // await this._startPlugin(
      //   pluginName, approvedPermissions, sourceCode, ethereumProvider
      // )
      await this._startPluginInWorker(
        pluginName, approvedPermissions, sourceCode
      )

      return this.getSerializable(pluginName)

    } catch (err) {

      console.warn(`Error when adding plugin:`, err)
      return { error: serializeError(err) }
    }
  }

  /**
   * Returns a promise representing the complete installation of the requested plugin.
   * If the plugin is already being installed, the previously pending promise will be returned.
   *
   * @param {string} pluginName - The name of the plugin.
   * @param {string} [sourceUrl] - The URL of the source code.
   */
  add (pluginName, sourceUrl) {
    if (!sourceUrl) {
      sourceUrl = pluginName
    }
    console.log(`Adding ${sourceUrl}`)

    // Deduplicate multiple add requests:
    if (!(pluginName in this.adding)) {
      this.adding[pluginName] = this._add(pluginName)
    }

    return this.adding[pluginName]
  }

  /**
   * Internal method. See the add method.
   *
   * @param {string} pluginName - The name of the plugin.
   * @param {string} [sourceUrl] - The URL of the source code.
   */
  async _add (pluginName, sourceUrl) {

    if (!sourceUrl) {
      sourceUrl = pluginName
    }

    if (!pluginName || typeof pluginName !== 'string') {
      throw new Error(`Invalid plugin name: ${pluginName}`)
    }

    let plugin
    try {

      console.log(`Fetching ${sourceUrl}`)
      const pluginSource = await fetch(sourceUrl)
      const pluginJson = await pluginSource.json()

      console.log(`Destructuring`, pluginJson)
      const { web3Wallet: { bundle, initialPermissions } } = pluginJson

      console.log(`Fetching bundle ${bundle.url}`)
      const pluginBundle = await fetch(bundle.url)
      const sourceCode = await pluginBundle.text()

      // map permissions to metamask_ namespaced permissions if necessary
      // remove if and when we stop supporting 'metamask_' permissions
      const namespacedInitialPermissions = initialPermissions
      for (const permission in initialPermissions) {
        if (pluginRestrictedMethodDescriptions[permission]) {
          namespacedInitialPermissions['metamask_' + permission] = initialPermissions[permission]
          delete namespacedInitialPermissions[permission]
        }
      }

      console.log(`Constructing plugin`)
      plugin = {
        // manifest: {}, // relevant manifest metadata
        name: pluginName,
        initialPermissions: namespacedInitialPermissions,
        permissionName: PLUGIN_PREFIX + pluginName, // so we can easily correlate them
        sourceCode,
      }
    } catch (err) {
      throw new Error(`Problem loading plugin ${pluginName}: ${err.message}`)
    }

    const pluginsState = this.store.getState().plugins

    // restore relevant plugin state if it exists
    if (pluginsState[pluginName]) {
      plugin = { ...pluginsState[pluginName], ...plugin }
    }

    // store the plugin back in state
    this.updateState({
      plugins: {
        ...pluginsState,
        [pluginName]: plugin,
      },
    })

    return plugin
  }

  /**
   * Initiates a request for the given plugin's initial permissions.
   * Must be called in order. See processRequestedPlugin.
   *
   * @param {string} pluginName - The name of the plugin.
   * @returns {Promise} - Resolves to the plugin's approvedPermissions, or rejects on error.
   */
  async authorize (pluginName) {
    console.log(`authorizing ${pluginName}`)
    const pluginsState = this.store.getState().plugins
    const plugin = pluginsState[pluginName]
    const { initialPermissions } = plugin

    // Don't prompt if there are no permissions requested:
    if (Object.keys(initialPermissions).length === 0) {
      return {}
    }

    try {
      const approvedPermissions = await this._requestPermissions(
        pluginName, initialPermissions
      )
      return approvedPermissions.map(perm => perm.parentCapability)
    } catch (err) {
      throw err
    } finally {
      delete this.adding[pluginName]
    }
  }

  async apiRequest (plugin, origin) {
    const handler = this.apiRequestHandlers.get(plugin)
    if (!handler) {
      throw ethErrors.rpc.methodNotFound({
        message: 'Method Not Found: Plugin apiRequest: ' + plugin,
      })
    }

    return handler(origin)
  }

  /**
   * Takes an array of EventEmitters and maps their event names to their emitter
   * for reverse lookup.
   * Used for adding and removing plugin event listeners.
   * See. _createMetaMaskEventListener.
   *
   * @param {Array<EventEmitter>} eventEmitters - The EventEmitters to get event names from.
   * @returns {Object<string, EventEmitter>} - An object of event names to EventEmitter objects.
   */
  _getEventNamesToEventEmitters (eventEmitters) {
    return eventEmitters.reduce((eventToEmitterMap, eventEmitter) => {

      // get the map for the current emitter
      const currentMap = eventEmitter.eventNames().reduce((acc, eventName) => {

        // add to possible events to listen for if the permissions system
        // knows about it
        if (pluginRestrictedMethodDescriptions[eventName]) {
          acc[eventName] = {
            eventEmitter,
          }
        }
        return acc
      }, {})

      // merge the current map into the complete map
      return { ...eventToEmitterMap, ...currentMap }
    }, {})
  }

  /**
   * Creates a function for the given plugin to listen to MetaMask events.
   *
   * @param {string} pluginName - The name of the plugin.
   * @param {Array<string>} approvedPermissions - The names of the plugin's approved permissions.
   */
  _createMetaMaskEventListener (pluginName, approvedPermissions) {

    const approvedListenerMethods = {}
    approvedPermissions.forEach(approvedPermission => {
      if (this._eventNamesToEventEmitters[approvedPermission]) {
        approvedListenerMethods[approvedPermission] = this._eventNamesToEventEmitters[approvedPermission]
      }
    })

    // keep track of listeners for later removal
    const listenerRemovalMap = new Map()
    this.metamaskEventListeners.set(pluginName, listenerRemovalMap)

    return (eventName, cb) => {

      // plugin may have been removed and not yet garbage collected
      if (!this.metamaskEventListeners.has(pluginName)) {
        return
      }

      // throw error if method is unknown or unpermitted
      if (!approvedListenerMethods[eventName]) {
        if (!this._eventNamesToEventEmitters[eventName]) {
          throw new Error('Unknown event name.')
        } else {
          throw new Error('Unpermitted event name.')
        }
      }

      // remove any existing listener
      if (listenerRemovalMap.has(eventName)) {
        // call the stored removal function, it is about to be replaced
        listenerRemovalMap.get(eventName)()
      }

      const { eventEmitter } = approvedListenerMethods[eventName]

      // add listener
      eventEmitter.on(eventName, cb)

      // store reference to removal function
      listenerRemovalMap.set(
        eventName,
        () => eventEmitter.removeListener(eventName, cb),
      )
    }
  }

  /**
   * Generate the APIs to provide for the given plugin.
   *
   * @param {string} pluginName - The name of the plugin.
   * @param {Array<string>} approvedPermissions - The plugin's approved permissions.
   */
  _generateApisToProvide (pluginName, approvedPermissions) {

    const apiList = approvedPermissions
      ? approvedPermissions.map(perm => {
        const metamaskMethod = perm.match(/metamask_(.+)/)
        return metamaskMethod
          ? metamaskMethod[1]
          : perm
      })
      : []

    const onMetaMaskEvent = this._createMetaMaskEventListener(pluginName, apiList)

    const possibleApis = {
      updatePluginState: this.updatePluginState.bind(this, pluginName),
      getPluginState: this.getPluginState.bind(this, pluginName),
      onNewTx: () => {},
      ...this.getApi(),
    }

    const registerRpcMessageHandler = this._registerRpcMessageHandler.bind(this, pluginName)
    const registerApiRequestHandler = this._registerApiRequestHandler.bind(this, pluginName)
    const registerAccountMessageHandler = this._registerAccountMessageHandler.bind(this, pluginName)

    const apisToProvide = {
      onMetaMaskEvent,
      registerRpcMessageHandler,
      registerAccountMessageHandler,
      registerApiRequestHandler,
      getAppKey: () => this.getAppKeyForDomain(pluginName),
    }
    apiList.forEach(apiKey => {
      apisToProvide[apiKey] = possibleApis[apiKey]
    })

    return apisToProvide
  }

  /**
   * Generate the APIs to provide for the given plugin.
   *
   * @param {string} pluginName - The name of the plugin.
   * @param {Array<string>} approvedPermissions - The plugin's approved permissions.
   */
  _generateApisToProvideForWorker (pluginName, approvedPermissions) {

    const apiList = approvedPermissions
      ? approvedPermissions.map(perm => {
        const metamaskMethod = perm.match(/metamask_(.+)/)
        return metamaskMethod
          ? metamaskMethod[1]
          : perm
      })
      : []

    // TODO:WW: event support
    // const onMetaMaskEvent = this._createMetaMaskEventListener(pluginName, apiList)

    const possibleApis = {
      updatePluginState: nodeify(this.updatePluginState, this, pluginName),
      getPluginState: nodeify(this.getPluginState, this, pluginName),
      // onNewTx: () => {},
      ...this.getApi(),
    }

    // const registerRpcMessageHandler = this._registerRpcMessageHandler.bind(this, pluginName)

    // TODO:WW account message handlers
    // const registerAccountMessageHandler = this._registerAccountMessageHandler.bind(this, pluginName)

    // TODO:WW capnode support? Could we just have a single routing/forwarding layer? :thinking_face:
    // const registerApiRequestHandler = this._registerApiRequestHandler.bind(this, pluginName)

    const apisToProvide = {
      // These handlers are now created in the snap worker
      // onMetaMaskEvent,
      // registerRpcMessageHandler,
      // registerAccountMessageHandler,
      // registerApiRequestHandler,
      getAppKey: nodeify(this.getAppKeyForDomain, this, pluginName),
    }
    apiList.forEach(apiKey => {
      apisToProvide[apiKey] = possibleApis[apiKey]
    })

    return { api: apisToProvide, apiKeys: Object.keys(apisToProvide) }
  }

  _registerRpcMessageHandler (pluginName, handler) {
    this.rpcMessageHandlers.set(pluginName, handler)
  }

  _registerAccountMessageHandler (pluginName, handler) {
    this.accountMessageHandlers.set(pluginName, handler)
  }

  _registerApiRequestHandler (pluginName, handler) {
    this.apiRequestHandlers.set(pluginName, handler)
  }

  runDummyWorkerPlugin () {
    this._startPluginInWorker(
      'inlinePlugin',
      [],
      getInlinePlugin(),
    )
    this.memStore.updateState({
      inlinePluginIsRunning: true,
    })
  }

  removeDummyWorkerPlugin () {
    this.memStore.updateState({
      inlinePluginIsRunning: false,
    })
    this.removePlugin('inlinePlugin')
  }

  async _startPluginInWorker (pluginName, approvedPermissions, sourceCode) {
    const { api, apiKeys } = this._generateApisToProvideForWorker(pluginName, approvedPermissions)
    const workerId = await this.workerController.createPluginWorker(
      { hostname: pluginName },
      () => api
    )
    this._createPluginHandlerHooks(pluginName, workerId)
    await this.workerController.startPlugin(workerId, {
      pluginName,
      sourceCode,
      backgroundApiKeys: apiKeys,
    })
  }

  getRpcMessageHandler (pluginName) {
    const handlers = this.pluginHandlerHooks.get(pluginName)
    return handlers ? handlers.rpcHook : undefined
  }

  _createPluginHandlerHooks (pluginName, workerId) {
    const rpcHook = async (origin, request) => {
      return await this.workerController.command(workerId, {
        command: 'pluginRpc',
        data: {
          origin,
          request,
        },
      })
    }
    this.pluginHandlerHooks.set(pluginName, { rpcHook })
  }

  _removePluginHandlerHooks (pluginName) {
    this.pluginHandlerHooks.delete(pluginName)
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
  _startPlugin (pluginName, approvedPermissions, sourceCode, ethereumProvider) {

    console.log(`starting plugin '${pluginName}'`)

    const apisToProvide = this._generateApisToProvide(
      pluginName, approvedPermissions
    )
    Object.assign(ethereumProvider, apisToProvide)

    try {

      const sessedPlugin = this.rootRealm.evaluate(sourceCode, {

        wallet: ethereumProvider,
        console, // Adding console for now for logging purposes.
        BigInt,
        setTimeout,
        crypto,
        SubtleCrypto,
        fetch,
        XMLHttpRequest,
        WebSocket,
        Buffer,
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
    return true
  }

  async _setPluginToActive (pluginName) {
    this._updatePlugin(pluginName, 'isActive', true)
  }

  async _setPluginToInActive (pluginName) {
    this._updatePlugin(pluginName, 'isActive', false)
  }

  async _updatePlugin (pluginName, property, value) {
    const plugins = this.store.getState().plugins
    const plugin = plugins[pluginName]
    const newPlugin = { ...plugin, [property]: value }
    const newPlugins = { ...plugins, [pluginName]: newPlugin }
    this.updateState({
      plugins: newPlugins,
    })
  }
}

module.exports = PluginsController
