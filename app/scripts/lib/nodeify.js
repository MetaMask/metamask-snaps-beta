const promiseToCallback = require('promise-to-callback')
const callbackNoop = function (err) {
  if (err) {
    throw err
  }
}

/**
 * A generator that returns a function which, when passed a promise, can treat that promise as a node style callback.
 * The prime advantage being that callbacks are better for error handling.
 *
 * @param {Function} fn The function to handle as a callback
 * @param {Object} context The context in which the fn is to be called, most often a this reference
 *
 */
module.exports = function nodeify (fn, context, ...boundArgs) {
  return function () {
    // parse arguments
    const args = [].slice.call(arguments)
    const lastArgIsCallback = typeof args[args.length - 1] === 'function'
    let callback
    if (lastArgIsCallback) {
      callback = args.pop()
    } else {
      callback = callbackNoop
    }
    // call the provided function and ensure result is a promise
    let result
    try {
      result = Promise.resolve(fn.apply(context, [ ...boundArgs, ...args ]))
    } catch (err) {
      result = Promise.reject(err)
    }
    // wire up promise resolution to callback
    promiseToCallback(result)(callback)
  }
}
