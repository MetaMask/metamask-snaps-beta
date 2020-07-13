const Dnode = require('dnode')
const log = require('loglevel')
const nanoid = require('nanoid')
const pump = require('pump')
const SafeEventEmitter = require('safe-event-emitter')
const { WorkerParentPostMessageStream } = require('post-message-stream')
const { setupMultiplex } = require('../../lib/stream-utils')
const { STREAM_NAMES } = require('./enums')
// const { resolve: pathResolve } = require('path')
// const path = require('path')
const pluginWorker = require('./pluginWorker')

const WORKER_TYPES = {
  plugin: {
    // path: joinPath(__dirname, 'pluginWorker.js'),
    // path: pathResolve('.', 'pluginWorker.js'),
    url: getWorkerUrl (pluginWorker),
    // path: path.
  },
}

function getWorkerUrl (fn) {
  var blob = new Blob(['('+fn.toString()+')()'], { type: 'application/javascript' })
  return URL.createObjectURL(blob)
}

module.exports = class WebWorkerController extends SafeEventEmitter {

  constructor ({
    setupWorkerConnection,
  } = {}) {
    super()
    this._setupWorkerConnection = setupWorkerConnection
    this.workers = new Map()
  }

  command (id, message) {
    if (typeof message !== 'object') {
      throw new Error('Must send object.')
    }

    const workerObj = this.workers.get(id)
    if (!workerObj) {
      throw new Error(`Worker with id ${id} not found.`)
    }

    workerObj.streams.command.write(message)
  }

  terminate (id) {
    const workerObj = this.workers.get(id)
    Object.keys(workerObj.streams).forEach(stream => {
      try {
        stream.removeAllListeners()
        stream.destroy()
      } catch (err) {
        console.log('Error while destroying stream', err)
      }
    })
    workerObj.worker.terminate()
    this.workers.delete(id)
  }

  async startPlugin (pluginData, workerId) {

    const id = workerId || this.workers.keys().next()
    if (!id) {
      throw new Error('No workers available.')
    }

    this.get(workerId).streams.command.once('data', (message) => {
      if (message.response === 'OK') {
        return true
      } else {
        throw new Error(`Failed to start plugin: ${message.error}`)
      }
    })

    this.command(id, { command: 'installPlugin', data: pluginData })
  }

  async createPluginWorker (metadata, getApiFunction) {
    return this._initWorker('plugin', metadata, getApiFunction)
  }

  async _initWorker (type, metadata, getApiFunction) {

    if (!WORKER_TYPES[type]) {
      throw new Error('Unrecognized worker type.')
    }

    const id = nanoid()
    const worker = new Worker(WORKER_TYPES[type].url)
    const streams = this._initWorkerStreams(worker, getApiFunction, metadata)

    this.workers.set(id, { id, streams, worker })
    return new Promise((resolve, reject) => {

      let acknowledged = false
      const initializationError = new Error('Failed to initialize worker.')

      streams.command.once('data', (message) => {
        if (message.response === 'OK') {
          acknowledged = true
          resolve(id)
        } else {
          reject(initializationError)
        }
      })

      this.command(id, { command: 'ping' })

      setTimeout(() => {
        if (!acknowledged) {
          reject(initializationError)
        }
      }, 1000)
    })
  }

  _initWorkerStreams (worker, getApiFunction, metadata) {
    const workerStream = new WorkerParentPostMessageStream({ worker })
    const mux = setupMultiplex(workerStream)

    pump(
      workerStream,
      mux,
      workerStream,
      (err) => {
        if (err) {
          log.error('Worker stream failure', err)
        }
      }
    )

    const commandStream = mux.createStream(STREAM_NAMES.COMMAND)

    const rpcStream = mux.createStream(STREAM_NAMES.JSON_RPC)
    this._setupWorkerConnection(metadata, rpcStream)

    const apiStream = mux.createStream(STREAM_NAMES.BACKGROUND_API)
    const dnode = Dnode(getApiFunction())
    pump(
      apiStream,
      dnode,
      apiStream,
      (err) => {
        if (err) {
          log.error(err)
        }
      }
    )

    return {
      api: apiStream,
      command: commandStream,
      rpc: rpcStream,
    }
  }
}
