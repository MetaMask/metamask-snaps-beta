const Through = require('through2')
const ObjectMultiplex = require('obj-multiplex')
const pump = require('pump')
const makeDuplexPair = require('./duplex-socket')

module.exports = {
  jsonParseStream,
  jsonStringifyStream,
  setupMultiplex,
  makeDuplexPair,
}

/**
 * Returns a stream transform that parses JSON strings passing through
 * @return {stream.Transform}
 */
function jsonParseStream () {
  return Through.obj(function (serialized, _, cb) {
    this.push(JSON.parse(serialized))
    cb()
  })
}

/**
 * Returns a stream transform that calls {@code JSON.stringify}
 * on objects passing through
 * @return {stream.Transform} the stream transform
 */
function jsonStringifyStream () {
  return Through.obj(function (obj, _, cb) {
    this.push(JSON.stringify(obj))
    cb()
  })
}

/**
 * Sets up stream multiplexing for the given stream
 * @param {any} connectionStream - the stream to mux
 * @param {string} streamName - the name of the stream, for identification in errors
 * @return {stream.Stream} the multiplexed stream
 */
function setupMultiplex (connectionStream, streamName) {
  const mux = new ObjectMultiplex()
  pump(
    connectionStream,
    mux,
    connectionStream,
    (err) => {
      if (err) {
        streamName
          ? console.error(`${streamName} stream failure.`, err)
          : console.error(err)
      }
    }
  )
  return mux
}
