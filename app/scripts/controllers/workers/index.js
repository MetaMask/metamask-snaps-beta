const fs = require('fs')
const Dnode = require('dnode')
const nanoid = require('nanoid')
const pump = require('pump')
const SafeEventEmitter = require('safe-event-emitter')
const { WorkerParentPostMessageStream } = require('post-message-stream')
const { setupMultiplex } = require('../../lib/stream-utils')
const {
  plugin: { STREAM_NAMES: PLUGIN_STREAM_NAMES },
} = require('snap-workers')

// Our brfs transform is extremely cranky, and will not apply itself unless
// fs.readFileSync is called here, at the top-level, outside any function, with
// a string literal path, and no encoding parameter ._.
const WORKER_TYPES = {
  plugin: {
    url: getWorkerUrl(
      fs.readFileSync(
        require.resolve('snap-workers/dist/pluginWorker.js')
      ).toString()
    ),
  },
}

function getWorkerUrl (workerSrc) {
  // the worker must be an IIFE file
  return URL.createObjectURL(
    new Blob(
      [ workerSrc ],
      { type: 'application/javascript' },
    )
  )
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

    this.workers.get(workerId).streams.command.once('data', (message) => {
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

  _getWorkerProxy (worker) {
    return new Proxy(worker, {
      get (target, propKey, _receiver) {
        if (propKey !== 'postMessage') {
          return target[propKey]
        }
        const origMethod = target[propKey]
        return (...args) => {
          console.log('POST MESSAGE ARGS', args)
          return Reflect.apply(origMethod, undefined, args)
        }
      },
    })
    // const handler = {
    //   apply: function (target, _thisArg, args) {
    //     console.log('POST MESSAGE ARGS', args)
    //     return target(args)
    //   }
    // }
    // worker.postMessage = new Proxy(worker.postMessage, handler)
  }

  async _initWorker (type, metadata, getApiFunction) {

    console.log('_initWorker')

    if (!WORKER_TYPES[type]) {
      throw new Error('Unrecognized worker type.')
    }

    const id = nanoid()
    const worker = new Worker(WORKER_TYPES[type].url)
    // const worker = this._getWorkerProxy(new Worker(WORKER_TYPES[type].url))
    const streams = this._initWorkerStreams(worker, id, getApiFunction, metadata)

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
      }, 10000)
    })
  }

  _handleCommandData (data) {
    console.log('controller _handleCommandData', data)
  }

  _initWorkerStreams (worker, workerId, getApiFunction, metadata) {
    const workerStream = new WorkerParentPostMessageStream({ worker })
    const mux = setupMultiplex(workerStream, `Worker:${workerId}`)

    const commandStream = mux.createStream(PLUGIN_STREAM_NAMES.COMMAND)
    // commandStream.on('data', this._handleCommandData.bind(this))

    const rpcStream = mux.createStream(PLUGIN_STREAM_NAMES.JSON_RPC)
    this._setupWorkerConnection(metadata, rpcStream)

    const apiStream = mux.createStream(PLUGIN_STREAM_NAMES.BACKGROUND_API)
    const dnode = Dnode(getApiFunction())
    pump(
      apiStream,
      dnode,
      apiStream,
      (err) => {
        if (err) {
          console.error(`Worker:${workerId} dnode stream failure.`, err)
        }
      }
    )

    return {
      // api: apiStream,
      command: commandStream,
      // rpc: rpcStream,
      connection: workerStream, // TODO:WW temp
    }
  }
}
