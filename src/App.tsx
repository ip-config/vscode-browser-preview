import * as React from 'react';
import './App.css';

import Toolbar from './components/toolbar/toolbar';
import Viewport from './components/viewport/viewport';
import Connection from './connection';

interface IState {
  frame: object | null;
  url: string;
  verbose: boolean;
  viewportMetadata: {
    height: number;
    width: number;
    isLoading: boolean;
    loadingPercent: number;
  };
  history: {
    canGoBack: boolean;
    canGoForward: boolean;
  };
}

type IStateDefaults = Pick<IState, 'url' | 'verbose'>

interface ExtensionAppConfigurationPayload {
  settings?: Partial<{
    startUrl?: string;
    verbose?: boolean;
  }>
}

class App extends React.Component<any, IState> {
  private connection: Connection;
  private static defaultSettings: IStateDefaults = {
    url: 'about:blank',
    verbose: false
  }

  constructor(props: any) {
    super(props);
    this.state = {
      frame: null,
      url: App.defaultSettings.url,
      verbose: App.defaultSettings.verbose,
      history: {
        canGoBack: false,
        canGoForward: false
      },
      viewportMetadata: {
        height: 0,
        isLoading: false,
        loadingPercent: 0.0,
        width: 0
      }
    };

    this.connection = new Connection();
    this.onToolbarActionInvoked = this.onToolbarActionInvoked.bind(this);
    this.onViewportChanged = this.onViewportChanged.bind(this);

    this.connection.setLoggingMode(this.state.verbose);

    this.connection.on('Page.frameNavigated', (result: any) => {
      const { frame } = result;
      var isMainFrame = !frame.parentId;

      if (isMainFrame) {
        this.requestNavigationHistory();
        this.setState({
          ...this.state,
          viewportMetadata: {
            ...this.state.viewportMetadata,
            isLoading: true,
            loadingPercent: 0.1
          }
        });
      }
    });

    this.connection.on('Page.loadEventFired', (result: any) => {
      this.setState({
        ...this.state,
        viewportMetadata: {
          ...this.state.viewportMetadata,
          loadingPercent: 1.0
        }
      });

      setTimeout(() => {
        this.setState({
          ...this.state,
          viewportMetadata: {
            ...this.state.viewportMetadata,
            isLoading: false,
            loadingPercent: 0
          }
        });
      }, 500);
    });

    this.connection.on('Page.screencastFrame', (result: any) => {
      const { sessionId, data, metadata } = result;
      this.connection.send('Page.screencastFrameAck', { sessionId });
      this.setState({
        ...this.state,
        frame: {
          base64Data: data,
          metadata: metadata
        }
      });
    });

    this.connection.on('Page.windowOpen', (result: any) => {
      this.connection.send('extension.windowOpenRequested', {
        url: result.url
      });
    });

    this.connection.on('extension.appConfiguration', (result: ExtensionAppConfigurationPayload) => {
      const { settings } = result;
      const { defaultSettings } = App;

      if (!settings) {
        return;
      }

      this.setState({
        url: settings.startUrl || defaultSettings.url,
        verbose: settings.verbose || defaultSettings.verbose
      });

      if (settings.startUrl) {
        this.connection.send('Page.navigate', {
          url: settings.startUrl
        });
      }
    });

    // Initialize
    this.connection.send('Page.enable');

    this.requestNavigationHistory();
  }

  public componentDidUpdate() {
    const { verbose } = this.state;

    this.connection.setLoggingMode(verbose);
  }

  public render() {
    return (
      <div className="App">
        <Toolbar
          url={this.state.url}
          onActionInvoked={this.onToolbarActionInvoked}
          canGoBack={this.state.history.canGoBack}
          canGoForward={this.state.history.canGoForward}
        />
        <Viewport
          showLoading={this.state.viewportMetadata.isLoading}
          width={this.state.viewportMetadata.width}
          height={this.state.viewportMetadata.height}
          loadingPercent={this.state.viewportMetadata.loadingPercent}
          frame={this.state.frame}
          onViewportChanged={this.onViewportChanged}
        />
      </div>
    );
  }

  public stopCasting() {
    this.connection.send('Page.stopScreencast');
  }

  public startCasting() {
    this.connection.send('Page.startScreencast', {
      format: 'jpeg',
      maxWidth: Math.floor(
        this.state.viewportMetadata.width * window.devicePixelRatio
      ),
      maxHeight: Math.floor(
        this.state.viewportMetadata.height * window.devicePixelRatio
      )
    });
  }

  private async requestNavigationHistory() {
    const history: any = await this.connection.send(
      'Page.getNavigationHistory'
    );

    if (!history) {
      return;
    }

    let historyIndex = history.currentIndex;
    let historyEntries = history.entries;
    let currentEntry = historyEntries[historyIndex];
    let url = currentEntry.url;

    const pattern = /^http:\/\/(.+)/;
    const match = url.match(pattern);
    if (match) {
      url = match[1];
    }

    this.setState({
      ...this.state,
      url: url,
      history: {
        canGoBack: historyIndex === 0,
        canGoForward: historyIndex === historyEntries.length - 1
      }
    });

    let panelTitle = currentEntry.title || currentEntry.url;

    this.connection.send('extension.updateTitle', {
      title: `Browser Preview (${panelTitle})`
    });
  }

  private onViewportChanged(action: string, data: any) {
    switch (action) {
      case 'interaction':
        this.connection.send(data.action, data.params);
        break;

      case 'size':
        this.stopCasting();

        this.connection
          .send('Page.setDeviceMetricsOverride', {
            deviceScaleFactor: 2,
            height: Math.floor(data.height),
            mobile: false,
            width: Math.floor(data.width)
          })
          .then(() => {
            this.setState({
              ...this.state,
              viewportMetadata: {
                ...this.state.viewportMetadata,
                height: data.height as number,
                width: data.width as number
              }
            });

            this.startCasting();
          });

        break;
    }
  }

  private onToolbarActionInvoked(action: string, data: any) {
    switch (action) {
      case 'forward':
        this.connection.send('Page.goForward');
        break;
      case 'backward':
        this.connection.send('Page.goBackward');
        break;
      case 'refresh':
        this.connection.send('Page.reload');
        break;
      case 'urlChange':
        this.connection.send('Page.navigate', {
          url: data.url
        });
        this.setState({
          ...this.state,
          url: data.url
        });
        break;
    }
  }
}

export default App;
