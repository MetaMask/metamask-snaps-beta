
// TODO:plugins:launch remove this
console.warn('MetaMask: You are using the experimental plugin version of MetaMask.')

// need to make sure we aren't affected by overlapping namespaces
// and that we dont affect the app with our namespace
// mostly a fix for web3's BigNumber if AMD's "define" is defined...
let __define

/**
 * Caches reference to global define object and deletes it to
 * avoid conflicts with other global define objects, such as
 * AMD's define function
 */
const cleanContextForImports = () => {
  __define = global.define
  try {
    global.define = undefined
  } catch (_) {
    console.warn('MetaMask - global.define could not be deleted.')
  }
}

/**
 * Restores global define object from cached reference
 */
const restoreContextAfterImports = () => {
  try {
    global.define = __define
  } catch (_) {
    console.warn('MetaMask - global.define could not be overwritten.')
  }
}

cleanContextForImports()
const log = require('loglevel')
const { WindowPostMessageStream } = require('post-message-stream')
const { initializeProvider } = require('@metamask/inpage-provider')

restoreContextAfterImports()

log.setDefaultLevel(process.env.METAMASK_DEBUG ? 'debug' : 'warn')

//
// initialize inpage provider
//

initializeProvider({
  connectionStream: new WindowPostMessageStream({
    name: 'inpage',
    target: 'contentscript',
  }),
})
