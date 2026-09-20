import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

const NAV: Array<{ to: string; label: string; exact?: boolean }> = [
  { to: '/', label: 'Overview', exact: true },
  { to: '/signaux', label: 'Signals' },
  { to: '/sentiment', label: 'Sentiment' },
  { to: '/cycles', label: 'Cycles' },
  { to: '/funding', label: 'Funding & Basis' },
  { to: '/classe-actifs', label: 'Cross-Asset' },
  { to: '/actualites', label: 'News' },
]

export const Route = createRootRoute({ component: RootLayout })

function RootLayout() {
  return (
    <>
      <a className="skip-link" href="#contenu">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <span className="brand-name">AirCrypto</span>
          <span className="brand-sub">MONITOR</span>
        </div>
        <nav className="topnav" aria-label="Sections">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact ?? false }}
              activeProps={{ className: 'active', 'aria-current': 'page' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <span className="topbar-note">Public data · Not advice</span>
      </header>
      <main id="contenu" className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <span>AirCrypto — market information tool.</span>
        <span>
          No wallet or exchange connected · No orders are sent · Not investment
          advice.
        </span>
      </footer>
    </>
  )
}
