import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from '@/App.tsx'
import { Provider } from '@/provider.tsx'
import '@/styles/globals.css'

import key from './const/key'

const theme = localStorage.getItem(key.theme)

// 兼容 useLocalStorage 旧数据。
if (theme && !theme.startsWith('"')) {
  localStorage.setItem(key.theme, JSON.stringify(theme))
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  // <React.StrictMode>
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <Provider>
      <App />
    </Provider>
  </BrowserRouter>
  // </React.StrictMode>
)
