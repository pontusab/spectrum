// @flow
import * as React from 'react';
import { connect } from 'react-redux';
import compose from 'recompose/compose';
import Icon from 'src/components/icons';
import { isDesktopApp } from 'src/helpers/desktop-app-utils';
import viewNetworkHandler from 'src/components/viewNetworkHandler';
import { updateNotificationsCount } from 'src/actions/notifications';
import getUnreadDMQuery from 'shared/graphql/queries/notification/getDirectMessageNotifications';
import type { GetDirectMessageNotificationsType } from 'shared/graphql/queries/notification/getDirectMessageNotifications';
import markDirectMessageNotificationsSeenMutation from 'shared/graphql/mutations/notification/markDirectMessageNotificationsSeen';
import { MessageTab, Label } from '../style';
import { track, events } from 'src/helpers/analytics';
import type { Dispatch } from 'redux';
import type {
  WebsocketConnectionType,
  PageVisibilityType,
} from 'src/reducers/connectionStatus';
import { useConnectionRestored } from 'src/hooks/useConnectionRestored';

type Props = {
  active: boolean,
  isLoading: boolean,
  hasError: boolean,
  isRefetching: boolean,
  markDirectMessageNotificationsSeen: Function,
  data: {
    directMessageNotifications: GetDirectMessageNotificationsType,
    refetch: Function,
  },
  subscribeToDMs: Function,
  refetch: Function,
  count: number,
  dispatch: Dispatch<Object>,
  networkOnline: boolean,
  websocketConnection: WebsocketConnectionType,
  pageVisibility: PageVisibilityType,
};

type State = {
  subscription: ?Function,
};

class MessagesTab extends React.Component<Props, State> {
  state = {
    subscription: null,
  };

  componentDidMount() {
    this.subscribe();
    return this.setCount(this.props);
  }

  shouldComponentUpdate(nextProps) {
    const curr = this.props;

    if (curr.networkOnline !== nextProps.networkOnline) return true;
    if (curr.websocketConnection !== nextProps.websocketConnection) return true;
    if (curr.pageVisibility !== nextProps.pageVisibility) return true;

    // if a refetch completes
    if (curr.isRefetching !== nextProps.isRefetching) return true;

    // once the initial query finishes loading
    if (
      !curr.data.directMessageNotifications &&
      nextProps.data.directMessageNotifications
    )
      return true;

    // if a subscription updates the number of records returned
    if (
      curr.data &&
      curr.data.directMessageNotifications &&
      curr.data.directMessageNotifications.edges &&
      nextProps.data &&
      nextProps.data.directMessageNotifications &&
      nextProps.data.directMessageNotifications.edges &&
      curr.data.directMessageNotifications.edges.length !==
        nextProps.data.directMessageNotifications.edges.length
    )
      return true;
    // if the user clicks on the messages tab
    if (curr.active !== nextProps.active) return true;

    // any time the count changes
    if (curr.count !== nextProps.count) return true;

    return false;
  }

  componentDidUpdate(prev: Props) {
    const { data: prevData } = prev;
    const curr = this.props;

    const didReconnect = useConnectionRestored({ curr, prev });
    if (didReconnect && curr.data.refetch) {
      curr.data.refetch();
    }

    // never update the badge if the user is viewing the messages tab
    // set the count to 0 if the tab is active so that if a user loads
    // /messages view directly, the badge won't update

    // if the user is viewing /messages, mark any incoming notifications
    // as seen, so that when they navigate away the message count won't shoot up
    if (!prev.active && this.props.active) {
      return this.markAllAsSeen();
    }

    if (
      curr.active &&
      curr.data.directMessageNotifications &&
      prevData.directMessageNotifications &&
      curr.data.directMessageNotifications.edges.length >
        prevData.directMessageNotifications.edges.length
    )
      return this.markAllAsSeen();

    // if the component updates for the first time
    if (
      !prevData.directMessageNotifications &&
      curr.data.directMessageNotifications
    ) {
      this.subscribe();
      return this.setCount(this.props);
    }

    // if the component updates with changed or new dm notifications
    // if any are unseen, set the counts
    if (
      curr.data.directMessageNotifications &&
      curr.data.directMessageNotifications.edges.length > 0 &&
      curr.data.directMessageNotifications.edges.some(
        n => n && n.node && !n.node.isSeen
      )
    ) {
      return this.setCount(this.props);
    }
  }

  componentWillUnmount() {
    this.unsubscribe();
  }

  subscribe = () => {
    this.setState({
      subscription: this.props.subscribeToDMs(),
    });
  };

  unsubscribe = () => {
    const { subscription } = this.state;
    if (subscription) {
      // This unsubscribes the subscription
      subscription();
    }
  };

  convertEdgesToNodes = notifications => {
    if (
      !notifications ||
      !notifications.edges ||
      notifications.edges.length === 0
    )
      return [];

    return notifications.edges.map(n => n && n.node);
  };

  setCount(props) {
    const {
      data: { directMessageNotifications },
    } = props;
    const { dispatch } = this.props;
    const nodes = this.convertEdgesToNodes(directMessageNotifications);
    // set to 0 if no notifications exist yet
    if (!nodes || nodes.length === 0) {
      return dispatch(
        updateNotificationsCount('directMessageNotifications', 0)
      );
    }

    // bundle dm notifications
    const obj = {};
    nodes.filter(n => n && !n.isSeen).map(o => {
      if (!o) return null;
      if (obj[o.context.id]) return null;
      obj[o.context.id] = o;
      return null;
    });

    // count of unique notifications determined by the thread id
    const count = Object.keys(obj).length;
    return dispatch(
      updateNotificationsCount('directMessageNotifications', count)
    );
  }

  markAllAsSeen = () => {
    const {
      data: { directMessageNotifications },
      markDirectMessageNotificationsSeen,
      refetch,
      dispatch,
    } = this.props;

    const nodes = this.convertEdgesToNodes(directMessageNotifications);

    // force the count to 0
    dispatch(updateNotificationsCount('directMessageNotifications', 0));

    // if there are no unread, escape
    if (nodes && nodes.length === 0) return;

    // otherwise
    return markDirectMessageNotificationsSeen()
      .then(() => {
        // notifs were marked as seen
        // refetch to make sure we're keeping up with the server's state
        return refetch();
      })
      .then(() => this.setCount(this.props))
      .catch(err => {
        console.error('error marking dm notifications seen', err);
      });
  };

  render() {
    const { active, count } = this.props;

    // Keep the dock icon notification count indicator of the desktop app in sync
    if (isDesktopApp()) {
      window.interop.setBadgeCount(count);
    }

    return (
      <MessageTab
        data-active={active}
        aria-current={active ? 'page' : undefined}
        to="/messages"
        rel="nofollow"
        onClick={() => {
          track(events.NAVIGATION_MESSAGES_CLICKED);
          this.markAllAsSeen();
        }}
        data-cy="navbar-messages"
      >
        <Icon
          glyph={count > 0 ? 'message-fill' : 'message'}
          count={count > 10 ? '10+' : count > 0 ? count.toString() : null}
          size={isDesktopApp() ? 28 : 32}
        />
        <Label>Messages</Label>
      </MessageTab>
    );
  }
}

const map = state => ({
  count: state.notifications.directMessageNotifications,
  networkOnline: state.connectionStatus.networkOnline,
  websocketConnection: state.connectionStatus.websocketConnection,
  pageVisibility: state.connectionStatus.pageVisibility,
});
export default compose(
  // $FlowIssue
  connect(map),
  getUnreadDMQuery,
  markDirectMessageNotificationsSeenMutation,
  viewNetworkHandler
)(MessagesTab);
