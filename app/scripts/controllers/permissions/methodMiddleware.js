
const createAsyncMiddleware = require('json-rpc-engine/src/createAsyncMiddleware')
const { ethErrors } = require('eth-json-rpc-errors')

/**
 * Create middleware for preprocessing permissions requests.
 */
module.exports = function createRequestMiddleware ({
  store, storeKey, getAccounts, requestAccountsPermission, handleInstallPlugins,
}) {
  return createAsyncMiddleware(async (req, res, next) => {

    if (typeof req.method !== 'string') {
      res.error = ethErrors.rpc.invalidRequest({ data: req })
      return
    }

    const prefix = 'wallet_'
    const pluginPrefix = prefix + 'plugin_'

    switch (req.method) {

      // intercepting eth_accounts requests for backwards compatibility,
      // i.e. return an empty array instead of an error
      case 'eth_accounts':

        res.result = await getAccounts()
        return

      case 'eth_requestAccounts':

        // first, just try to get accounts
        let accounts = await getAccounts()
        if (accounts.length > 0) {
          res.result = accounts
          return
        }

        // if no accounts, request the accounts permission
        try {
          await requestAccountsPermission()
        } catch (err) {
          res.error = err
          return
        }

        // get the accounts again
        accounts = await getAccounts()
        if (accounts.length > 0) {
          res.result = accounts
        } else {
          // this should never happen
          res.error = ethErrors.rpc.internal(
            'Accounts unexpectedly unavailable. Please report this bug.'
          )
        }

        return

      case 'wallet_installPlugins':

        if (
          !Array.isArray(req.params) || typeof req.params[0] !== 'object'
        ) {
          res.error = ethErrors.rpc.invalidParams({ data: req })
          return
        }

        const requestedPlugins = Object.keys(req.params[0]).filter(
          p => p.startsWith(pluginPrefix)
        )

        if (requestedPlugins.length === 0) {
          res.error = ethErrors.rpc.invalidParams({
            message: 'Must request at least one plugin.', data: req,
          })
        }

        try {
          res.result = await handleInstallPlugins(req.origin, requestedPlugins)
        } catch (err) {
          res.error = err
        }
        return

      // custom method for getting metadata from the requesting domain
      case 'wallet_sendDomainMetadata':

        if (
          req.domainMetadata &&
          typeof req.domainMetadata.name === 'string'
        ) {
          addDomainMetadata(req.origin, req.domainMetadata)
        }

        res.result = true
        return

      default:
        break
    }

    if (
      req.origin !== 'metamask' && (
        getOwnState() && !getOwnState()[req.origin]
      )
    ) {
      // plugin metadata is handled here for now?
      // TODO:plugin handle this better, rename siteMetadata to domainMetadata everywhere
      let name = 'Unknown Domain'
      try {
        name = new URL(req.origin).hostname
      } catch (err) {} // noop
      addDomainMetadata(req.origin, { name })
    }

    return next()
  })

  function addDomainMetadata (origin, metadata) {

    // extensionId added higher up the stack, preserve it if it exists
    const currentState = store.getState()[storeKey]
    if (currentState[origin] && currentState[origin].extensionId) {
      metadata.extensionId = currentState[origin].extensionId
    }

    store.updateState({
      [storeKey]: {
        ...currentState,
        [origin]: {
          ...metadata,
        },
      },
    })
  }

  function getOwnState () {
    return store.getState()[storeKey]
  }
}
