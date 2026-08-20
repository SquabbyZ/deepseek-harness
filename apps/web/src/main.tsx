import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { startHost } from './dsh/host.ts'
import { queryClient } from './dsh/query/client.ts'
import { App } from './App.tsx'

async function main(): Promise<void> {
  await startHost()
  const element = document.getElementById('root')
  if (element === null) throw new Error('web app: missing #root')

  ReactDOM.createRoot(element).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

void main().catch(console.error)
