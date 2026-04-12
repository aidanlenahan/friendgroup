import { expect, test } from '@playwright/test'

test('mobile smoke: home to diagnostics flow works', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile viewport only')

  await page.route('**/api/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', service: 'api' }),
    })
  })

  await page.route('**/api/notifications/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        vapidPublicKey: null,
        pushConfigured: false,
        emailConfigured: false,
      }),
    })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Project Control Center' })).toBeVisible()
  await page.getByRole('link', { name: 'Open Phase 9 Diagnostics' }).click()
  await expect(page).toHaveURL(/\/phase-9\/diagnostics/)
  await page.getByRole('button', { name: 'Check API /health' }).click()
  await expect(page.getByText('API health endpoint is reachable.')).toBeVisible()
  await page.getByRole('button', { name: 'Check /notifications/config' }).click()
  await expect(page.getByText('Notification config fetched successfully.')).toBeVisible()
  await expect(page.getByText('pushConfigured: no')).toBeVisible()
})

test('phase 7 PWA console smoke: auth, config, and subscribe flow works', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop-only PWA console smoke')

  await page.addInitScript(() => {
    const registration = {
      active: true,
      installing: null,
      waiting: null,
      pushManager: {
        getSubscription: async () => null,
        subscribe: async () => ({
          toJSON: () => ({
            endpoint: 'https://push.example.com/subscriptions/demo',
            keys: { auth: 'auth-key', p256dh: 'p256dh-key' },
          }),
        }),
      },
      unregister: async () => true,
      scope: '/',
    }

    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: {
        permission: 'default',
        requestPermission: async () => 'granted',
      },
    })

    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: function PushManager() {},
    })

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve(registration),
        getRegistration: async () => null,
        getRegistrations: async () => [registration],
        register: async () => registration,
      },
    })

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: false,
        media: '(display-mode: standalone)',
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  })

  await page.route('**/api/auth/dev-token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'phase9-browser-token',
        user: {
          id: 'user_1',
          email: 'owner@friendgroup.dev',
          name: 'Owner User',
        },
      }),
    })
  })

  await page.route('**/api/notifications/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        vapidPublicKey: 'BEl6h0FakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeF',
        pushConfigured: true,
        emailConfigured: false,
      }),
    })
  })

  await page.route('**/api/notifications/subscribe', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ subscription: { id: 'sub_1' } }),
    })
  })

  await page.goto('/phase-7/debug')
  await expect(page.getByRole('heading', { name: 'Phase 7 PWA Console' })).toBeVisible()

  await page.getByRole('button', { name: 'Get Dev Token' }).click()
  await expect(page.getByText('Authenticated as owner@friendgroup.dev via /api.')).toBeVisible()

  await page.getByRole('button', { name: 'Load /notifications/config' }).click()
  await expect(page.getByText('Loaded notification config from API.')).toBeVisible()

  await page.getByRole('button', { name: 'Request Permission + Subscribe' }).click()
  await expect(page.getByText('Push subscription saved successfully.')).toBeVisible()
  await expect(page.getByText(/https:\/\/push\.example\.com\/subscriptions\/demo/)).toBeVisible()
})