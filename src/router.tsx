import { lazy, Suspense } from 'react';
import { createHashRouter, Navigate } from 'react-router';
import { AppShell } from './ui/AppShell';
import { RequireAuth } from './features/auth/RequireAuth';
import { SignInPage } from './features/auth/SignInPage';
import { HomePage } from './features/dashboard/HomePage';
import { InvoicesPage } from './features/invoices/InvoicesPage';
import { InvoiceEditorPage } from './features/invoices/InvoiceEditor';
import { ExpensesPage } from './features/expenses/ExpensesPage';
import { LogExpensePage } from './features/expenses/LogExpensePage';
import { ExpenseDetail } from './features/expenses/ExpenseDetail';
import { MorePage } from './features/more/MorePage';
import { CustomersPage } from './features/customers/CustomersPage';
import { CustomerDetail } from './features/customers/CustomerDetail';
import { SettingsPage } from './features/settings/SettingsPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { QuotesPage } from './features/quotes/QuotesPage';
import { QuoteEditorPage } from './features/quotes/QuoteEditor';
import { BackupPage } from './features/backup/BackupPage';

// The PDF library is large, so the invoice detail screen (which builds PDFs) loads on first use.
const InvoiceDetail = lazy(() => import('./features/invoices/InvoiceDetail'));
const QuoteDetail = lazy(() => import('./features/quotes/QuoteDetail'));

// Hash routes (#/invoices) because GitHub Pages can't rewrite deep links to index.html.
export const router = createHashRouter([
  { path: '/sign-in', element: <SignInPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'invoices', element: <InvoicesPage /> },
      { path: 'invoices/new', element: <InvoiceEditorPage /> },
      { path: 'invoices/:id/edit', element: <InvoiceEditorPage /> },
      {
        path: 'invoices/:id',
        element: (
          <Suspense fallback={<div className="page" aria-busy="true" />}>
            <InvoiceDetail />
          </Suspense>
        ),
      },
      { path: 'quotes', element: <QuotesPage /> },
      { path: 'quotes/new', element: <QuoteEditorPage /> },
      { path: 'quotes/:id/edit', element: <QuoteEditorPage /> },
      {
        path: 'quotes/:id',
        element: (
          <Suspense fallback={<div className="page" aria-busy="true" />}>
            <QuoteDetail />
          </Suspense>
        ),
      },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'customers/:id', element: <CustomerDetail /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'backup', element: <BackupPage /> },
      { path: 'expenses', element: <ExpensesPage /> },
      { path: 'expenses/new', element: <LogExpensePage /> },
      { path: 'expenses/:id', element: <ExpenseDetail /> },
      { path: 'more', element: <MorePage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
