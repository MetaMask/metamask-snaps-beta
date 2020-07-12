const Dnode = require('dnode')
const log = require('loglevel')
const nanoid = require('nanoid')
const pump = require('pump')
const SafeEventEmitter = require('safe-event-emitter')
const { WorkerParentPostMessageStream } = require('post-message-stream')
const { setupMultiplex } = require('../../lib/stream-utils')
const { STREAM_NAMES } = require('./enums')

const WORKER_TYPES = {
  plugin: 'pluginWorker.js'
}

module.exports = class WebWorkerController extends SafeEventEmitter {

  constructor (opts = {}) {
    this.workers = new Map()
  }

  _initWorker (type, getApiFunction) {

    if (!WORKER_TYPES[type]) {
      throw new Error('Unrecognized worker type.')
    }

    const id = nanoid()
    const worker = new Worker(WORKER_TYPES[type])
    const streams = this._initWorkerStream(worker, getApiFunction)

    this.workers.set(id, { id, streams, worker })
    return id
  }

  _initWorkerStreams (worker, getApiFunction) {
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

    const apiStream = mux.createStream(STREAM_NAMES.BACKGROUND_API)
    const commandStream = mux.createStream(STREAM_NAMES.COMMAND)

    const rpcStream = mux.createStream(STREAM_NAMES.JSON_RPC)
    // TODO: MetamaskController.setupProviderConnection(rpcStream)

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
      rpc: rpcStream
    }
  }
}
