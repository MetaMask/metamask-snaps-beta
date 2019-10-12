const ObservableStore = require('obs-store')
const EventEmitter = require('safe-event-emitter')
const extend = require('xtend')

/**
 * Resource Controller
 *
 * An abstract class intended to describe a particular resource that is managed by plugins.
 * Example resources are resources and assets.
 *
 * These are things that MetaMask treats as first-class objects with distinct properties within its own UI.
 */

class ResourceController extends EventEmitter {

  constructor (opts = {}) {
    super()
    const { requiredFields } = opts
    this.requiredFields = requiredFields

    const initState = extend({
      resources: [],
    }, opts.initState)
    this.store = new ObservableStore(initState)
  }

  // Resource management
  get resources () {
    return this.store.getState().resources
  }

  set resources (resources) {
    this.store.updateState({
      resources,
    })
  }

  add (fromDomain, opts) {
    this.validateResource(fromDomain, opts)
    const priors = this.getPriorResources(fromDomain, opts)
    if (priors.length > 0) {
      return this.update(fromDomain, opts)
    }

    const resource = {
      ...opts,
    }
    resource.fromDomain = fromDomain
    this.resources.push(resource)
    return resource
  }

  getPriorResources (fromDomain, resource) {
    return this.resources.filter((resource2) => {
      return resource2.fromDomain === fromDomain && resource.identifier === resource2.identifier
    })
  }

  validateResource (fromDomain, opts) {
    this.requiredFields.forEach((requiredField) => {
      if (!(requiredField in opts)) {
        throw new Error(`Resource from ${fromDomain} missing required field: ${requiredField}`)
      }
    })
  }

  update (fromDomain, resource) {
    this.validateResource(fromDomain, resource)
    this.resources = this.resources.map((resource2) => {
      if (resource2.fromDomain === fromDomain && resource.identifier === resource2.identifier) {
        return resource
      } else {
        return resource2
      }
    })
    return resource
  }

  remove (fromDomain, resource) {
    let deleted
    this.resources = this.resources.filter((resource2) => {
      const requested = resource2.fromDomain === fromDomain && resource.identifier === resource2.identifier
      deleted = requested
      return !requested
    })
    return deleted
  }

}

module.exports = ResourceController
