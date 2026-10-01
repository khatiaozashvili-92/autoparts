import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './styles.css'
import { configured } from './lib/supabase'
import Login from './pages/Login'
import ReportHub from './pages/ReportHub'
import Income from './pages/Income'
import Expenses from './pages/Expenses'
import CashMovement from './pages/CashMovement'
import OtherSales from './pages/OtherSales'
import Result from './pages/Result'
import Admin from './pages/Admin'
import AdminReport from './pages/AdminReport'

function App() {
  if (!configured) {
    return (
      <div className="page">
        <h1>კონფიგურაცია აკლია</h1>
        <p>დააყენეთ <code>VITE_SUPABASE_URL</code> და <code>VITE_SUPABASE_ANON_KEY</code>.</p>
      </div>
    )
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/r/:id" element={<ReportHub />} />
        <Route path="/r/:id/income" element={<Income />} />
        <Route path="/r/:id/expenses" element={<Expenses />} />
        <Route path="/r/:id/cash" element={<CashMovement />} />
        <Route path="/r/:id/other" element={<OtherSales />} />
        <Route path="/r/:id/result" element={<Result />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/:id" element={<AdminReport />} />
      </Routes>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
