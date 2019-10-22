const ObservableStore = require('obs-store')
const EventEmitter = require('safe-event-emitter')
const extend = require('xtend')
const sigUtil = require('eth-sig-util')
const normalizeAddress = sigUtil.normalize

/**
 * Accounts Controller
 *
 * Provides methods with the same interface as KeyringController
 * except will also fallback route requests to the IdentitiesController,
 * which allows Plugin account management.
 *
 */

class AccountsController extends EventEmitter {

  constructor (opts = {}) {
    super()

    const { keyringController, pluginAccountsController } = opts
    this.keyringController = keyringController
    this.pluginAccountsController = pluginAccountsController

    const initState = extend({
      accountRings: [],
    }, opts.initState)
    this.store = new ObservableStore(initState)
  }

  async getAccounts() {
    const keyAccounts = await this.keyringController.getAccounts()
    const pluginAccounts = this.pluginAccountsController.resources.map(acct => acct.address)
    return [...keyAccounts, ...pluginAccounts]
  }

  async exportAccount (address) {
    return this.keyringController.exportAccount(address)
  }

  async removeAccount (address) {
    return this.keyringController.removeAccount(address)
  }

  async fullUpdate () {
    const update = await this.keyringController.fullUpdate()
    const pluginAccounts = this.pluginAccounts.resources

    const pluginTypes = pluginAccounts.filter((account) => {
      return account.fromDomain
    })
    update.keyringTypes = update.keyringTypes.concat(pluginTypes)

    const pluginKeyrings = pluginTypes.map((domain) => {
      const accounts = pluginAccounts.filter((account) => {
        return account.fromDomain === domain
      })
      .map(account => account.address)

      return {
        type: domain,
        accounts,
      }
    })

    update.keyrings = update.keyrings.concat(pluginKeyrings)
    return update
  }

  async signMessage (msgParams) {
    try {
      return this.keyringController.signMessage(msgParams)
    } catch (err) {
      const address = normalizeAddress(msgParams.from)
      if (!this.pluginManagesAddress(address)) {
        throw new Error('No keyring or plugin found for the requested account.')
      }

      throw new Error('MetaMask needs to impelment this method for plugins.')
    }
  }

  pluginManagesAddress (address) {
    const pluginAccounts = this.pluginAccounts.resources
    const normalized = pluginAccounts.map(acct => normalizeAddress(acct.address))
    return normalized.includes(address)
  }

  /**
   * TO IMPLEMENT:
   */


  async signMessage (msgParams) {}
  async signPersonalMessage (msgParams) {}
  async signTypedData (msgParams) {}
  async exportAppKeyForAddress(account, domain) {}

}

module.exports = AccountsController
