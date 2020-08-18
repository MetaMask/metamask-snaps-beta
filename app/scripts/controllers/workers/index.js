const fs = require('fs')
const ObservableStore = require('obs-store')
const Dnode = require('dnode')
const nanoid = require('nanoid')
const pump = require('pump')
const SafeEventEmitter = require('safe-event-emitter')
const { WorkerParentPostMessageStream } = require('post-message-stream')
const { setupMultiplex } = require('../../lib/stream-utils')
const {
  plugin: { STREAM_NAMES: PLUGIN_STREAM_NAMES },
} = require('snap-workers')
const CommandEngine = require('./CommandEngine')

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
    this.store = new ObservableStore({ workers: {} })
    this.workers = new Map()
    this.pluginToWorkerMap = new Map()
    this.workerToPluginMap = new Map()
  }

  _setWorker (workerId, workerObj) {
    this.workers.set(workerId, workerObj)

    const newWorkerState = {
      ...this.store.getState().workers,
      [workerId]: workerObj,
    }
    this.store.updateState({ workers: newWorkerState })
  }

  _deleteWorker (workerId) {
    this.workers.delete(workerId)

    const newWorkerState = { ...this.store.getState().workers }
    delete newWorkerState[workerId]
    this.store.updateState({ workers: newWorkerState })
  }

  async command (workerId, message, timeout) {
    if (typeof message !== 'object') {
      throw new Error('Must send object.')
    }

    const workerObj = this.workers.get(workerId)
    if (!workerObj) {
      throw new Error(`Worker with id ${workerId} not found.`)
    }

    console.log('Parent: Sending Command', message)

    return await workerObj.commandEngine.command(message, timeout)
  }

  terminateAll () {
    for (const workerId of this.workers.keys()) {
      this.terminate(workerId)
    }
  }

  terminateWorkerOf (pluginName) {
    const workerId = this.pluginToWorkerMap.get(pluginName)
    workerId && this.terminate(workerId)
  }

  terminate (workerId) {
    const workerObj = this.workers.get(workerId)
    Object.values(workerObj.streams).forEach(stream => {
      try {
        !stream.destroyed && stream.destroy()
        stream.removeAllListeners()
      } catch (err) {
        console.log('Error while destroying stream', err)
      }
    })
    workerObj.worker.terminate()
    this._removePluginAndWorkerMapping(workerId)
    this._deleteWorker(workerId)
    console.log(`worker:${workerId} terminated`)
  }

  async startPlugin (workerId, pluginData) {

    const _workerId = workerId || this.workers.keys().next()
    if (!_workerId) {
      throw new Error('No workers available.')
    }

    this._mapPluginAndWorker(pluginData.pluginName, workerId)

    return await this.command(_workerId, { command: 'installPlugin', data: pluginData })
  }

  async createPluginWorker (metadata, getApiFunction) {
    return this._initWorker('plugin', metadata, getApiFunction)
  }

  _mapPluginAndWorker (pluginName, workerId) {
    this.pluginToWorkerMap.set(pluginName, workerId)
    this.workerToPluginMap.set(workerId, pluginName)
  }

  _getWorkerForPlugin (pluginName) {
    return this.pluginToWorkerMap.get(pluginName)
  }

  _getPluginForWorker (workerId) {
    return this.workerToPluginMap.get(workerId)
  }

  _removePluginAndWorkerMapping (workerId) {
    const pluginName = this.workerToPluginMap.get(workerId)
    this.workerToPluginMap.delete(workerId)
    this.pluginToWorkerMap.delete(pluginName)
  }

  async _initWorker (type, metadata, getApiFunction) {

    console.log('_initWorker')

    if (!WORKER_TYPES[type]) {
      throw new Error('Unrecognized worker type.')
    }

    const workerId = nanoid()
    const worker = new Worker(WORKER_TYPES[type].url, { name: workerId })
    const streams = this._initWorkerStreams(worker, workerId, getApiFunction, metadata)
    const commandEngine = new CommandEngine(workerId, streams.command)

    this._setWorker(workerId, { id: workerId, streams, commandEngine, worker })
    await this.command(workerId, { command: 'ping' })
    return workerId
  }

  _initWorkerStreams (worker, workerId, getApiFunction, metadata) {
    const workerStream = new WorkerParentPostMessageStream({ worker })
    const mux = setupMultiplex(workerStream, `Worker:${workerId}`)

    const commandStream = mux.createStream(PLUGIN_STREAM_NAMES.COMMAND)

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
      api: apiStream,
      command: commandStream,
      rpc: rpcStream,
      _connection: workerStream,
    }
  }
}
