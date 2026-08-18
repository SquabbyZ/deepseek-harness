import ReactDOM from 'react-dom/client'
import { startHost } from './dsh/host.ts'

async function main(): Promise<void> {
  await startHost()
  const element = document.getElementById('root')
  if (element === null) throw new Error('web app: missing #root')

  ReactDOM.createRoot(element).render(<h1>DSH Runtime — Phase 1</h1>)
}

void main().catch(console.error)
