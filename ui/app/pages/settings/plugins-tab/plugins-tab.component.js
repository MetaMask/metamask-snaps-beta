import React, { Component } from 'react'
import PropTypes from 'prop-types'
import Button from '../../../components/ui/button'
import PluginsList from './plugins-list'

export default class PluginsTab extends Component {

  static propTypes = {
    warning: PropTypes.string,
    plugins: PropTypes.object.isRequired,
    workerCount: PropTypes.number.isRequired,
    removePlugins: PropTypes.func.isRequired,
    runStressTestPlugins: PropTypes.func.isRequired,
    showClearPluginsModal: PropTypes.func.isRequired,
  }

  static contextTypes = {
    t: PropTypes.func,
  }

  renderActionButton (
    mainMessage,
    descriptionMessage,
    clickHandler,
    isDisabled,
    type = 'primary',
    className = 'settings-tab__button',
  ) {
    return (
      <div className="settings-page__content-row">
        <div className="settings-page__content-item">
          <span>{ mainMessage }</span>
          <span className="settings-page__content-description">
            { descriptionMessage }
          </span>
        </div>
        <div className="settings-page__content-item">
          <div className="settings-page__content-item-col">
            <Button
              type={type}
              large
              className={className}
              disabled={isDisabled}
              onClick={event => {
                event.preventDefault()
                clickHandler()
              }}
            >
              { mainMessage }
            </Button>
          </div>
        </div>
      </div>
    )
  }

  render () {
    const { t } = this.context
    const { warning, plugins, workerCount, removePlugins } = this.props
    const hasPlugins = Object.keys(this.props.plugins).length > 0

    return (
      <div className="settings-page__body">
        { warning && <div className="settings-tab__error">{ warning }</div> }
        {
          this.renderActionButton(
            'Run Stress Test Plugins',
            'Runs 10 Stress Test Plugins',
            this.props.runStressTestPlugins,
            false,
          )
        }
        {
          this.renderActionButton(
            t('clearPlugins'),
            t('clearPluginsDescription'),
            this.props.showClearPluginsModal,
            !hasPlugins,
            'warning',
            'settings-tab__button--orange'
          )
        }
        <PluginsList
          plugins={plugins}
          removePlugins={removePlugins}
          workerCount={workerCount}
        />
      </div>
    )
  }
}
