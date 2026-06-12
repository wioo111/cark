import { BrowserRouter, Route, Routes } from 'react-router-dom'

import Home from '@/pages/Home'
import ReaderPage from '@/pages/ReaderPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/reader/:paperId" element={<ReaderPage />} />
      </Routes>
    </BrowserRouter>
  )
}
