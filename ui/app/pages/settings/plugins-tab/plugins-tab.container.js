import PluginsTab from './plugins-tab.component'
import { compose } from 'recompose'
import { connect } from 'react-redux'
import { withRouter } from 'react-router-dom'
import {
  showModal,
  removePlugins,
  runStressTestPlugins,
} from '../../../store/actions'
import {
  getAllPlugins,
  getAllWorkers,
} from '../../../selectors/selectors'

const mapStateToProps = state => {
  const { appState: { warning } } = state

  return {
    warning,
    plugins: getAllPlugins(state),
    workerCount: Object.keys(getAllWorkers(state)).length,
  }
}

const mapDispatchToProps = dispatch => {
  return {
    showClearPluginsModal: () => dispatch(
      showModal({ name: 'CLEAR_PLUGINS' })
    ),
    removePlugins: (pluginNames) => dispatch(
      removePlugins(pluginNames)
    ),
    runStressTestPlugins: () => dispatch(
      runStressTestPlugins(10)
    ),
  }
}

export default compose(
  withRouter,
  connect(mapStateToProps, mapDispatchToProps)
)(PluginsTab)
