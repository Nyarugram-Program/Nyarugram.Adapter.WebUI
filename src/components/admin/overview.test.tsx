import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AdminOverviewPage from './overview'

const mockUseInstance = vi.fn()

vi.mock('@/hooks/use-instance', () => ({
  default: () => mockUseInstance()
}))

vi.mock('@/controllers/nyarugram_admin_manager', () => ({
  default: {
    getInfo: vi.fn(),
    getSession: vi.fn(),
    getAccount: vi.fn(),
    getMetrics: vi.fn(),
    getHealth: vi.fn(),
    loginAccount: vi.fn(),
    logoutAccount: vi.fn()
  },
  AdminRequestError: class extends Error {
    status?: number
    constructor(message: string, status?: number) {
      super(message)
      this.status = status
    }
  }
}))

vi.mock('@/components/code_editor', () => ({
  default: () => null
}))

describe('AdminOverviewPage Layout', () => {
  const instance = {
    id: 'test-inst',
    name: 'Test Instance',
    protocol: 'milky' as const,
    managementKind: 'nyarugram-admin-v1' as const,
    managementUrl: 'http://localhost:5000',
    businessUrl: 'http://localhost:5001',
    eventUrl: 'http://localhost:5001/event',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseInstance.mockReturnValue({
      instance,
      generation: 1,
      invalidate: vi.fn()
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders notifications in a full-width container and organizes cards into two columns', async () => {
    const NyarugramAdminManager = (
      await import('@/controllers/nyarugram_admin_manager')
    ).default

    vi.mocked(NyarugramAdminManager.getInfo).mockResolvedValue({
      api_version: '1.0',
      instance_id: 'inst-1',
      adapter_kind: 'nyarugram-milky',
      adapter_version: '1.0.0',
      protocol_version: '1.0.0',
      capabilities: {
        account: { supported: true },
        calls: { supported: false }
      }
    })

    vi.mocked(NyarugramAdminManager.getSession).mockResolvedValue({
      authenticated: true,
      session_id: 'sess-123',
      expires_at: '2026-12-31T23:59:59Z',
      csrf_token: 'csrf-abc'
    })

    vi.mocked(NyarugramAdminManager.getAccount).mockResolvedValue({
      account_id: 'acc-1',
      username: 'bot_user',
      display_name: 'My Bot',
      state: 'active'
    })

    vi.mocked(NyarugramAdminManager.getMetrics).mockResolvedValue({
      account: { logged_in: true, display_name: 'My Bot', generation: '1' },
      storage: { state: 'ok' },
      outbox: { pending: 0, expired: 0 },
      events: { subscribers: 1 },
      media: { engine: 'none', available: false, audio: false }
    })

    vi.mocked(NyarugramAdminManager.getHealth).mockResolvedValue({
      status: 'healthy'
    })

    const { container } = render(
      <MemoryRouter>
        <AdminOverviewPage />
      </MemoryRouter>
    )

    // Wait for data to load
    await screen.findByText('实例与能力')
    await screen.findByText('管理会话有效期至 2026-12-31T23:59:59Z')

    // Top-level grid has xl:grid-cols-2 and xl:items-start
    const mainGrid = container.querySelector('.grid.gap-4.p-4.xl\\:grid-cols-2')
    expect(mainGrid).toBeTruthy()
    expect(mainGrid?.className).toContain('xl:items-start')

    // Banner container spans both columns
    const banner = container.querySelector('.xl\\:col-span-2')
    expect(banner).toBeTruthy()
    expect(banner?.textContent).toContain('管理会话有效期至')

    // Find the two column wrapper divs
    const columns = mainGrid?.querySelectorAll(':scope > div.flex.flex-col')
    expect(columns?.length).toBe(2)

    // Column 1 contains "实例与能力" and "运行指标"
    const col1 = columns?.[0]
    expect(col1?.textContent).toContain('实例与能力')
    expect(col1?.textContent).toContain('运行指标')
    expect(col1?.textContent).not.toContain('机器人账号')
    expect(col1?.textContent).not.toContain('管理与业务入口')

    // Column 2 contains "机器人账号" and "管理与业务入口"
    const col2 = columns?.[1]
    expect(col2?.textContent).toContain('机器人账号')
    expect(col2?.textContent).toContain('管理与业务入口')
    // Check min-w-0 on columns
    columns?.forEach((col) => {
      expect(col.className).toContain('min-w-0')
    })
  })

  it('renders login hint spanning full width when unauthorized', async () => {
    const NyarugramAdminManager = (
      await import('@/controllers/nyarugram_admin_manager')
    ).default

    vi.mocked(NyarugramAdminManager.getInfo).mockResolvedValue({
      api_version: '1.0',
      instance_id: 'inst-1',
      adapter_kind: 'nyarugram-milky',
      adapter_version: '1.0.0',
      protocol_version: '1.0.0',
      capabilities: {}
    })
    vi.mocked(NyarugramAdminManager.getSession).mockResolvedValue(null)
    vi.mocked(NyarugramAdminManager.getAccount).mockResolvedValue({})
    vi.mocked(NyarugramAdminManager.getMetrics).mockResolvedValue({})
    vi.mocked(NyarugramAdminManager.getHealth).mockResolvedValue({})

    const { container } = render(
      <MemoryRouter>
        <AdminOverviewPage />
      </MemoryRouter>
    )

    await screen.findByText(/管理会话未建立或已失效/)

    const banner = container.querySelector('.xl\\:col-span-2')
    expect(banner).toBeTruthy()
    expect(banner?.textContent).toContain('前往管理登录')
  })

  it('renders error line spanning full width when loadError is present', async () => {
    const NyarugramAdminManager = (
      await import('@/controllers/nyarugram_admin_manager')
    ).default

    vi.mocked(NyarugramAdminManager.getInfo).mockRejectedValue(
      new Error('网络请求异常')
    )
    vi.mocked(NyarugramAdminManager.getSession).mockResolvedValue({
      authenticated: true,
      session_id: 'sess-1',
      expires_at: '2026-12-31T23:59:59Z'
    })
    vi.mocked(NyarugramAdminManager.getAccount).mockResolvedValue({})
    vi.mocked(NyarugramAdminManager.getMetrics).mockResolvedValue({})
    vi.mocked(NyarugramAdminManager.getHealth).mockResolvedValue({})

    const { container } = render(
      <MemoryRouter>
        <AdminOverviewPage />
      </MemoryRouter>
    )

    await screen.findByText(/网络请求异常/)

    const banner = container.querySelector('.xl\\:col-span-2')
    expect(banner).toBeTruthy()
    expect(banner?.textContent).toContain('网络请求异常')
  })

  it('does not render banner container when session is not yet loaded and no error exists', async () => {
    const NyarugramAdminManager = (
      await import('@/controllers/nyarugram_admin_manager')
    ).default

    const pending = new Promise<never>(() => {})
    vi.mocked(NyarugramAdminManager.getInfo).mockReturnValue(pending)
    vi.mocked(NyarugramAdminManager.getSession).mockReturnValue(pending)
    vi.mocked(NyarugramAdminManager.getAccount).mockReturnValue(pending)
    vi.mocked(NyarugramAdminManager.getMetrics).mockReturnValue(pending)
    vi.mocked(NyarugramAdminManager.getHealth).mockReturnValue(pending)

    const { container } = render(
      <MemoryRouter>
        <AdminOverviewPage />
      </MemoryRouter>
    )

    // No banner container rendered
    const banner = container.querySelector('.xl\\:col-span-2')
    expect(banner).toBeNull()

    // Columns are still rendered
    const mainGrid = container.querySelector('.grid.gap-4.p-4.xl\\:grid-cols-2')
    const columns = mainGrid?.querySelectorAll(':scope > div.flex.flex-col')
    expect(columns?.length).toBe(2)
  })
})
