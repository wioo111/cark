import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { MobileServerGate } from '@/components/MobileServerGate'

const Home = lazy(() => import('@/pages/Home'))
const ReaderPage = lazy(() => import('@/pages/ReaderPage'))

export default function App() {
  return (
    <MobileServerGate>
      <BrowserRouter>
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500">正在加载…</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/reader/:paperId" element={<ReaderPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </MobileServerGate>
  )
}
