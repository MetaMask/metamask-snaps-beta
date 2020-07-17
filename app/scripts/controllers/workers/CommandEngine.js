module.exports = class CommandEngine {

  constructor (workerId, commandStream) {
    this.workerId = workerId
    this._currentCommandId = -1
    this._idMap = new Map()
    this._stream = commandStream
    this._stream.on('data', this._onMessage.bind(this))
  }

  async command (message, timeout) {
    if (typeof message !== 'object') {
      throw new Error('Must send object.')
    }
    return this._send(message, timeout)
  }

  _send (message, timeout = 10000) {
    const id = this._getNextId()
    message.id = id
    return (new Promise((resolve, reject) => {
      this._idMap.set(id, { resolve, reject })
      this._stream.write(message)

      setTimeout(() => {
        const commandMetadata = this._idMap.get(id)
        if (commandMetadata) {
          reject(new Error(`Worker:${this.workerId} took too long to respond to ${message.command} command with id ${id}.`))
          this._idMap.delete(id)
        }
      }, timeout)
    }))
  }

  _onMessage (message = {}) {
    const { id, result, error } = message
    const commandMetadata = this._idMap.get(id)
    if ('result' in message && !commandMetadata) {
      console.warn(`Received command response from worker:${this.workerId} with unrecognized command id: ${id}`)
      return
    }
    console.log('Parent: Command Response', message)
    if (error) {
      commandMetadata.reject(error)
    } else {
      commandMetadata.resolve(result)
    }
    this._idMap.delete(id)
  }

  _getNextId () {
    this._currentCommandId += 1
    return this._currentCommandId
  }
}
