import assert from 'node:assert/strict';
import { test } from 'node:test';
// Import the platform-neutral parser directly so the test does not load React Native's app entrypoint.
import { getStateFromPath } from '../node_modules/@react-navigation/native/node_modules/@react-navigation/core/src/getStateFromPath';
import { webLinking } from '../src/navigation/linking';

function leafRouteName(state: any): string | undefined {
  let current = state;

  while (current?.routes?.length) {
    const route = current.routes[current.index ?? 0];
    if (!route?.state) return route?.name;
    current = route.state;
  }

  return undefined;
}

test('admin web paths resolve to every admin tab and stack screen', () => {
  const paths: [string, string][] = [
    ['/admin', 'Dashboard'],
    ['/admin/requests', 'Requests'],
    ['/orders', 'Orders'],
    ['/admin/team', 'Team'],
    ['/admin/more', 'More'],
    ['/admin/orders/order-1/review', 'OrderReview'],
    ['/admin/customers', 'Customers'],
    ['/admin/reports', 'Reports'],
    ['/admin/payment-details', 'PaymentDetails'],
    ['/admin/attendance', 'Attendance'],
    ['/admin/pincodes', 'Pincodes'],
    ['/admin/partners/partner-1/areas', 'PartnerAreas'],
    ['/admin/orders/status/requested', 'OrdersByStatus'],
    ['/admin/revenue', 'Revenue'],
    ['/admin/cash', 'Cash'],
    ['/admin/announcements', 'Announcements'],
    ['/admin/shop', 'ShopDetails'],
    ['/admin/reviews', 'AdminReviews'],
    ['/admin/chats', 'AdminChats'],
    ['/admin/chats/thread-1', 'AdminChat'],
    ['/admin/customers/customer-1', 'CustomerDetail'],
    ['/admin/customers/new', 'CustomerForm'],
    ['/admin/account-requests', 'AccountRequests'],
    ['/admin/broadcast', 'Broadcast'],
    ['/admin/exports', 'Exports'],
    ['/admin/terms', 'Terms'],
    ['/admin/settings', 'StoreSettings'],
    ['/language', 'Language'],
    ['/notifications', 'Notifications'],
    ['/admin/sms', 'SmsSettings'],
  ];

  for (const [path, expectedRoute] of paths) {
    const state = getStateFromPath(path, webLinking.config);
    assert.ok(state, `Expected ${path} to resolve`);
    assert.equal(leafRouteName(state), expectedRoute, `Unexpected route for ${path}`);
  }
});
