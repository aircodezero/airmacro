import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { MacroPage } from '../../../src/macro/MacroPage'
import { AppShell, NotFound } from './AppShell'
import { validateHomeSearch } from './search'

const rootRoute = createRootRoute({ component: AppShell, notFoundComponent: NotFound })

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: validateHomeSearch,
  component: Home,
})

function Home() {
  const { event } = homeRoute.useSearch()
  const navigate = homeRoute.useNavigate()
  return <MacroPage linkedEvent={event} onLinkClosed={() => void navigate({ search: {}, replace: true })} />
}

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
