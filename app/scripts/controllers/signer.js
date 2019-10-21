const ObservableStore = require('obs-store')
const EventEmitter = require('safe-event-emitter')
const extend = require('xtend')

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

    const initState = extend({
      accountRings: [],
    }, opts.initState)
    this.store = new ObservableStore(initState)
  }

  /**
   * TO IMPLEMENT:
   */
  async getAccounts() {}
  exportAccount () {}
  removeAccount (address) {}
  async fullUpdate () {}

  async signMessage (msgParams) {}
  async signPersonalMessage (msgParams) {}
  async signTypedData (msgParams) {}
  async exportAppKeyForAddress(account, domain) {}

}

module.exports = AccountsController
