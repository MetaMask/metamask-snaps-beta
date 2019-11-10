const ObservableStore = require('obs-store')
const extend = require('xtend')

class CombinedResourcesController {

  constructor (opts = {}) {
    this.assetsController = opts.assetsController
    this.pluginAccountsController = opts.pluginAccountsController

    const initAssetsControllerState = this.assetsController.store.getState()
    const initPluginAccountsController = this.pluginAccountsController.store.getState()
    const initState = extend({
      pluginAccountsResources: initPluginAccountsController.resources,
      assetsResources: initAssetsControllerState.resources,
      resources: [ ...initAssetsControllerState.resources, ...initPluginAccountsController.resources ],
    })
    this.store = new ObservableStore(initState)

    this.assetsController.store.subscribe(this.update.bind(this, 'assets'))
    this.pluginAccountsController.store.subscribe(this.update.bind(this, 'pluginAccounts'))
  }

  update (type, state) {
    let assetsResources = this.store.getState().assetsResources
    let pluginAccountsResources = this.store.getState().pluginAccountsResources

    let newResources
    if (type === 'assets') {
      newResources = [ pluginAccountsResources, ...state.resources ]
      assetsResources = state.resources
    } else if (type === 'pluginAccounts') {
      newResources = [ assetsResources, ...state.resources ]
      pluginAccountsResources = state.resources
    }

    this.store.updateState({
      pluginAccountsResources,
      assetsResources,
      resources: newResources,
    })
  }

}

module.exports = CombinedResourcesController
